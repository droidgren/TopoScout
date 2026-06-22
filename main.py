from __future__ import annotations

import json
import os
import re
import secrets
import threading
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import FastAPI, File, HTTPException, Request, Response, UploadFile
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

import requests

try:
    from google.auth.transport import requests as google_requests
    from google.oauth2 import id_token as google_id_token

    _google_request = google_requests.Request()
except Exception:  # pragma: no cover - optional dependency / offline install
    google_id_token = None
    _google_request = None


BASE_DIR = Path(__file__).resolve().parent
APP_DIR = Path(os.getenv("GPX_APP_DIR", BASE_DIR))
UPLOAD_DIR = Path(os.getenv("GPX_UPLOAD_DIR", BASE_DIR / "gpx-files"))
INDEX_PATH = Path(os.getenv("GPX_INDEX_PATH", UPLOAD_DIR / "gpx-index.json"))
MAX_UPLOAD_BYTES = int(os.getenv("GPX_MAX_UPLOAD_BYTES", 10 * 1024 * 1024))
OWNER_COOKIE_NAME = "elevf_owner"
OWNER_COOKIE_MAX_AGE = 60 * 60 * 24 * 365 * 5
GOOGLE_CLIENT_ID = os.getenv(
    "GOOGLE_CLIENT_ID",
    "79515767501-5p4cbnfq111dqnuv8h6fp91t33k6gcbt.apps.googleusercontent.com",
)
GOOGLE_OWNER_PREFIX = "google:"
GOOGLE_ISSUERS = {"accounts.google.com", "https://accounts.google.com"}
# Tolerance for minor server-clock drift when validating token iat/exp. This is a
# safety net for NTP jitter only — a badly wrong clock must still be fixed.
GOOGLE_TOKEN_CLOCK_SKEW = int(os.getenv("GOOGLE_TOKEN_CLOCK_SKEW_SECONDS", "30"))

STRAVA_HEATMAP_PROXY_URL = os.getenv("STRAVA_HEATMAP_PROXY_URL", "http://strava-heatmap-proxy:8080")
# Allowlists guard the values forwarded to the internal proxy (avoid SSRF / path abuse).
HEATMAP_ACTIVITIES = {"all", "ride", "run", "winter", "water"}
HEATMAP_COLORS = {"bluered", "hot", "blue", "purple", "gray", "mobileblue"}

PUBLIC_ROOT_FILES = {
    "index.html",
    "style.css",
    "script.js",
    "manifest.json",
    "service-worker.js",
    "icon.svg",
}

DEFAULT_INDEX = {
    "files_by_id": {},
    "filename_to_id": {},
}

_index_lock = threading.Lock()

app = FastAPI(title="Elevation Finder Backend")
app.mount("/lang", StaticFiles(directory=APP_DIR / "lang"), name="lang")


def ensure_storage_dirs() -> None:
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)


def load_index() -> dict[str, Any]:
    if not INDEX_PATH.exists():
        return {
            "files_by_id": {},
            "filename_to_id": {},
        }

    try:
        with INDEX_PATH.open("r", encoding="utf-8") as handle:
            payload = json.load(handle)
    except (OSError, json.JSONDecodeError):
        return {
            "files_by_id": {},
            "filename_to_id": {},
        }

    files_by_id = payload.get("files_by_id")
    filename_to_id = payload.get("filename_to_id")
    if not isinstance(files_by_id, dict) or not isinstance(filename_to_id, dict):
        return {
            "files_by_id": {},
            "filename_to_id": {},
        }

    return {
        "files_by_id": files_by_id,
        "filename_to_id": filename_to_id,
    }


def save_index(index_payload: dict[str, Any]) -> None:
    ensure_storage_dirs()
    temp_path = INDEX_PATH.with_suffix(".tmp")
    with temp_path.open("w", encoding="utf-8") as handle:
        json.dump(index_payload, handle, indent=2, sort_keys=True)
    temp_path.replace(INDEX_PATH)


def sanitize_filename(filename: str) -> str:
    candidate = Path(filename or "").name.strip()
    if not candidate:
        raise HTTPException(status_code=400, detail="Filename is required")

    sanitized = re.sub(r"[^A-Za-z0-9._ -]", "_", candidate)
    sanitized = sanitized.lstrip(".")
    if not sanitized:
        raise HTTPException(status_code=400, detail="Invalid filename")
    if not sanitized.lower().endswith(".gpx"):
        raise HTTPException(status_code=400, detail="Only .gpx files are allowed")
    return sanitized


def get_owner_id_from_request(request: Request) -> str | None:
    owner_id = request.cookies.get(OWNER_COOKIE_NAME, "").strip()
    return owner_id or None


def get_bearer_token(request: Request) -> str | None:
    header = request.headers.get("Authorization", "")
    if not header.lower().startswith("bearer "):
        return None
    token = header[7:].strip()
    return token or None


def verify_google_token(token: str) -> dict[str, Any] | None:
    """Verify a Google ID token (JWT) and return its claims, or None if invalid.

    Returns None when the optional google-auth dependency is missing or no
    client id is configured, so the app falls back to the anonymous flow.
    """
    if not token or not GOOGLE_CLIENT_ID or google_id_token is None:
        return None
    try:
        claims = google_id_token.verify_oauth2_token(
            token, _google_request, GOOGLE_CLIENT_ID,
            clock_skew_in_seconds=GOOGLE_TOKEN_CLOCK_SKEW,
        )
    except Exception:
        return None
    if claims.get("iss") not in GOOGLE_ISSUERS:
        return None
    if not claims.get("sub"):
        return None
    return claims


def resolve_google_owner(request: Request) -> tuple[str | None, dict[str, Any] | None]:
    """Return (owner_id, claims) for a valid Google bearer token, else (None, None)."""
    token = get_bearer_token(request)
    if not token:
        return None, None
    claims = verify_google_token(token)
    if not claims:
        return None, None
    return f"{GOOGLE_OWNER_PREFIX}{claims['sub']}", claims


def ensure_owner_id(request: Request, response: Response) -> str:
    # A verified Google identity always wins, so uploads follow the account
    # across devices/sessions regardless of the anonymous cookie.
    google_owner, _claims = resolve_google_owner(request)
    if google_owner:
        return google_owner

    owner_id = get_owner_id_from_request(request)
    if owner_id:
        return owner_id

    owner_id = secrets.token_urlsafe(18)
    response.set_cookie(
        key=OWNER_COOKIE_NAME,
        value=owner_id,
        max_age=OWNER_COOKIE_MAX_AGE,
        httponly=True,
        samesite="lax",
        secure=False,
        path="/",
    )
    return owner_id


def build_owner_filename_key(owner_id: str, filename: str) -> str:
    return f"{owner_id}:{filename}"


def require_owner_id(request: Request) -> str:
    google_owner, _claims = resolve_google_owner(request)
    if google_owner:
        return google_owner

    owner_id = get_owner_id_from_request(request)
    if not owner_id:
        raise HTTPException(status_code=403, detail="Missing owner session")
    return owner_id


def claim_anonymous_files(anon_owner_id: str, google_owner_id: str) -> None:
    """Reassign every file owned by an anonymous cookie session to a Google account.

    Runs once on sign-in so previously uploaded (anonymous) files are not lost.
    Idempotent: after the first run the anonymous id owns nothing.
    """
    if not anon_owner_id or anon_owner_id == google_owner_id:
        return

    with _index_lock:
        index_payload = load_index()
        files_by_id = index_payload["files_by_id"]
        filename_to_id = index_payload["filename_to_id"]
        changed = False

        for record in files_by_id.values():
            if record.get("owner_id") != anon_owner_id:
                continue
            filename = record.get("filename") or ""
            record["owner_id"] = google_owner_id
            changed = True

            old_key = build_owner_filename_key(anon_owner_id, filename)
            if filename_to_id.get(old_key) == record["id"]:
                del filename_to_id[old_key]

            new_key = build_owner_filename_key(google_owner_id, filename)
            existing_id = filename_to_id.get(new_key)
            if existing_id is None:
                filename_to_id[new_key] = record["id"]
            else:
                # Filename collision with an existing account file: keep both
                # records (both stay listable) and let the newer one own the
                # dedup key used for in-place re-uploads.
                existing_rec = files_by_id.get(existing_id, {})
                if (record.get("uploaded_at") or "") >= (existing_rec.get("uploaded_at") or ""):
                    filename_to_id[new_key] = record["id"]

        if changed:
            save_index(index_payload)


def validate_gpx_payload(payload: bytes) -> None:
    if not payload:
        raise HTTPException(status_code=400, detail="Empty GPX file")

    try:
        root = ET.fromstring(payload)
    except ET.ParseError as exc:
        raise HTTPException(status_code=400, detail="Invalid GPX XML") from exc

    tag_name = root.tag.split("}")[-1].lower()
    if tag_name != "gpx":
        raise HTTPException(status_code=400, detail="Invalid GPX root element")


def build_share_url(request: Request, gpx_id: str) -> str:
    base_url = str(request.base_url).rstrip("/")
    return f"{base_url}/?gpx={gpx_id}"


def serialize_record(record: dict[str, Any], request: Request) -> dict[str, Any]:
    return {
        "id": record["id"],
        "filename": record["filename"],
        "size": record.get("size"),
        "uploaded_at": record.get("uploaded_at"),
        "share_url": build_share_url(request, record["id"]),
    }


def get_record_or_404(gpx_id: str) -> dict[str, Any]:
    with _index_lock:
        index_payload = load_index()
        record = index_payload["files_by_id"].get(gpx_id)
    if not record:
        raise HTTPException(status_code=404, detail="File not found")
    return record


@app.on_event("startup")
def on_startup() -> None:
    APP_DIR.mkdir(parents=True, exist_ok=True)
    ensure_storage_dirs()


@app.get("/api/health")
def health_check() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/api/auth/login")
async def auth_login(request: Request) -> dict[str, Any]:
    google_owner, claims = resolve_google_owner(request)
    if not google_owner:
        # Fallback: accept the credential in the JSON body. This survives reverse
        # proxies that strip the Authorization header before it reaches the app.
        body_token = await _credential_from_body(request)
        if body_token:
            body_claims = verify_google_token(body_token)
            if body_claims:
                claims = body_claims
                google_owner = f"{GOOGLE_OWNER_PREFIX}{body_claims['sub']}"
    if not google_owner or not claims:
        raise HTTPException(status_code=401, detail="Invalid Google credential")

    # First sign-in on this browser: absorb the anonymous session's uploads.
    anon_owner = get_owner_id_from_request(request)
    if anon_owner and not anon_owner.startswith(GOOGLE_OWNER_PREFIX):
        claim_anonymous_files(anon_owner, google_owner)

    return {
        "owner_id": google_owner,
        "email": claims.get("email"),
        "name": claims.get("name"),
        "picture": claims.get("picture"),
        "sub": claims.get("sub"),
    }


async def _credential_from_body(request: Request) -> str | None:
    try:
        body = await request.json()
    except Exception:
        return None
    if isinstance(body, dict):
        token = body.get("credential")
        if isinstance(token, str) and token.strip():
            return token.strip()
    return None


@app.post("/api/auth/debug")
async def auth_debug(request: Request) -> dict[str, Any]:
    """Safe diagnostics for the Google sign-in flow (no secrets exposed).

    Reveals what actually reached the backend so misconfigured deployments are
    obvious: an old build (this route 404s), a proxy stripping Authorization,
    clock skew, a wrong client id, or missing google-auth.
    """
    auth_header = request.headers.get("Authorization", "")
    header_token = get_bearer_token(request)
    body_token = await _credential_from_body(request)

    info: dict[str, Any] = {
        "build": "google-signin-v1",
        "authorization_header_present": bool(auth_header),
        "bearer_token_from_header": bool(header_token),
        "token_in_body": bool(body_token),
        "google_libs_loaded": google_id_token is not None,
        "client_id_configured": bool(GOOGLE_CLIENT_ID),
        "client_id_suffix": GOOGLE_CLIENT_ID[-14:] if GOOGLE_CLIENT_ID else "",
        "server_time_utc": datetime.now(timezone.utc).isoformat(),
        "cookie_owner_present": bool(get_owner_id_from_request(request)),
    }

    token = header_token or body_token
    if not token:
        info["verification"] = "no_token_reached_backend"
        return info
    if google_id_token is None:
        info["verification"] = "google_auth_not_installed"
        return info

    try:
        verified = google_id_token.verify_oauth2_token(
            token, _google_request, GOOGLE_CLIENT_ID,
            clock_skew_in_seconds=GOOGLE_TOKEN_CLOCK_SKEW,
        )
        info["verification"] = "ok"
        info["owner_id"] = f"{GOOGLE_OWNER_PREFIX}{verified.get('sub')}"
        info["token_email"] = verified.get("email")
        info["token_iss"] = verified.get("iss")
        info["token_aud_matches_client_id"] = (verified.get("aud") == GOOGLE_CLIENT_ID)
    except Exception as exc:
        info["verification"] = "error"
        info["error"] = f"{type(exc).__name__}: {exc}"
    return info


@app.get("/api/files")
def list_files(request: Request, response: Response) -> dict[str, list[dict[str, Any]]]:
    owner_id = ensure_owner_id(request, response)
    with _index_lock:
        index_payload = load_index()

    files: list[dict[str, Any]] = []
    for record in index_payload["files_by_id"].values():
        if record.get("owner_id") != owner_id:
            continue
        stored_filename = record.get("stored_filename")
        if not stored_filename:
            continue
        if not (UPLOAD_DIR / stored_filename).exists():
            continue
        files.append(serialize_record(record, request))

    files.sort(key=lambda item: item.get("uploaded_at") or "", reverse=True)
    return {"files": files}


@app.post("/api/upload")
async def upload_file(
    request: Request,
    response: Response,
    file: UploadFile = File(...),
) -> dict[str, Any]:
    filename = sanitize_filename(file.filename or "")
    payload = await file.read(MAX_UPLOAD_BYTES + 1)
    if len(payload) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="GPX file exceeds upload limit")

    validate_gpx_payload(payload)
    ensure_storage_dirs()
    timestamp = datetime.now(timezone.utc).isoformat()
    owner_id = ensure_owner_id(request, response)
    filename_key = build_owner_filename_key(owner_id, filename)

    with _index_lock:
        index_payload = load_index()
        existing_id = index_payload["filename_to_id"].get(filename_key)
        record_id = existing_id or secrets.token_urlsafe(9)
        existing_record = index_payload["files_by_id"].get(record_id, {})
        stored_filename = existing_record.get("stored_filename") or f"{record_id}.gpx"

        destination = UPLOAD_DIR / stored_filename
        destination.write_bytes(payload)

        record = {
            "id": record_id,
            "filename": filename,
            "owner_id": owner_id,
            "stored_filename": stored_filename,
            "size": len(payload),
            "uploaded_at": timestamp,
        }
        index_payload["files_by_id"][record_id] = record
        index_payload["filename_to_id"][filename_key] = record_id
        save_index(index_payload)

    return serialize_record(record, request)


@app.delete("/api/files/{gpx_id}")
def delete_file(gpx_id: str, request: Request) -> dict[str, str]:
    owner_id = require_owner_id(request)

    with _index_lock:
        index_payload = load_index()
        record = index_payload["files_by_id"].get(gpx_id)
        if not record or record.get("owner_id") != owner_id:
            raise HTTPException(status_code=404, detail="File not found")

        stored_filename = record.get("stored_filename")
        filename = record.get("filename")

        del index_payload["files_by_id"][gpx_id]

        owner_filename_key = build_owner_filename_key(owner_id, filename or "")
        if filename and index_payload["filename_to_id"].get(owner_filename_key) == gpx_id:
            del index_payload["filename_to_id"][owner_filename_key]
        if filename and index_payload["filename_to_id"].get(filename) == gpx_id:
            del index_payload["filename_to_id"][filename]

        save_index(index_payload)

    if stored_filename:
        file_path = UPLOAD_DIR / stored_filename
        try:
            file_path.unlink(missing_ok=True)
        except OSError:
            pass

    return {"status": "deleted", "id": gpx_id}


@app.patch("/api/files/{gpx_id}")
async def rename_file(gpx_id: str, request: Request) -> dict[str, Any]:
    owner_id = require_owner_id(request)

    try:
        body = await request.json()
    except Exception as exc:
        raise HTTPException(status_code=400, detail="Invalid request body") from exc
    new_filename_raw = body.get("filename") if isinstance(body, dict) else None
    if not isinstance(new_filename_raw, str) or not new_filename_raw.strip():
        raise HTTPException(status_code=400, detail="Filename is required")
    new_filename = sanitize_filename(new_filename_raw)

    with _index_lock:
        index_payload = load_index()
        record = index_payload["files_by_id"].get(gpx_id)
        if not record or record.get("owner_id") != owner_id:
            raise HTTPException(status_code=404, detail="File not found")

        old_filename = record.get("filename") or ""
        if new_filename != old_filename:
            new_key = build_owner_filename_key(owner_id, new_filename)
            existing_id = index_payload["filename_to_id"].get(new_key)
            if existing_id and existing_id != gpx_id:
                raise HTTPException(status_code=409, detail="A file with that name already exists")

            # Only the display name and dedup mapping change; the file on disk is
            # keyed by record id (stored_filename), so it stays put.
            old_key = build_owner_filename_key(owner_id, old_filename)
            if old_filename and index_payload["filename_to_id"].get(old_key) == gpx_id:
                del index_payload["filename_to_id"][old_key]
            if old_filename and index_payload["filename_to_id"].get(old_filename) == gpx_id:
                del index_payload["filename_to_id"][old_filename]

            record["filename"] = new_filename
            index_payload["filename_to_id"][new_key] = gpx_id
            save_index(index_payload)

    return serialize_record(record, request)


@app.get("/api/files/{gpx_id}/raw", name="get_raw_file")
def get_raw_file(gpx_id: str) -> FileResponse:
    record = get_record_or_404(gpx_id)
    stored_filename = record.get("stored_filename")
    if not stored_filename:
        raise HTTPException(status_code=404, detail="File not found")

    file_path = UPLOAD_DIR / stored_filename
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="File not found")

    return FileResponse(
        file_path,
        media_type="application/gpx+xml",
        filename=record["filename"],
    )


@app.get("/api/heatmap/{activity}/{color}/{z}/{x}/{y}.png", include_in_schema=False)
def get_heatmap_tile(activity: str, color: str, z: int, x: int, y: int) -> Response:
    """Proxy a Strava Global Heatmap tile from the internal strava-heatmap-proxy.

    Served same-origin so MapLibre can use the tiles (the upstream proxy is plain HTTP with
    no CORS headers). A plain def so the blocking request runs in FastAPI's threadpool.
    """
    if activity not in HEATMAP_ACTIVITIES or color not in HEATMAP_COLORS:
        raise HTTPException(status_code=404, detail="Unknown heatmap layer")

    upstream = (
        f"{STRAVA_HEATMAP_PROXY_URL}/identified/globalheat/"
        f"{activity}/{color}/{z}/{x}/{y}.png"
    )
    try:
        upstream_response = requests.get(upstream, timeout=10)
    except requests.RequestException as exc:
        raise HTTPException(status_code=502, detail="Heatmap proxy unreachable") from exc

    if upstream_response.status_code != 200:
        # Tiles with no heat legitimately 404; expired/missing cookies 401. Either way return
        # an empty tile so MapLibre simply renders nothing there instead of erroring.
        return Response(status_code=204)

    return Response(
        content=upstream_response.content,
        media_type="image/png",
        headers={"Cache-Control": "public, max-age=86400"},
    )


@app.get("/", include_in_schema=False)
def serve_index() -> FileResponse:
    return FileResponse(APP_DIR / "index.html")


@app.get("/{asset_name}", include_in_schema=False)
def serve_public_asset(asset_name: str) -> FileResponse:
    if asset_name not in PUBLIC_ROOT_FILES:
        raise HTTPException(status_code=404, detail="Not found")
    return FileResponse(APP_DIR / asset_name)
