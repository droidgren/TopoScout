from __future__ import annotations

import base64
import hashlib
import hmac
import json
import logging
import math
import mimetypes
import os
import re
import secrets
import threading
import time
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import Body, FastAPI, File, HTTPException, Request, Response, UploadFile
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

try:
    # Hardened XML parser for untrusted GPX uploads: rejects entity-expansion (billion
    # laughs), external entities and DTD retrieval. Falls back to the stdlib parser if the
    # optional dependency is missing (offline install); modern expat already blocks the
    # classic billion-laughs case, but defusedxml is the belt-and-suspenders choice.
    import defusedxml.ElementTree as DET
except Exception:  # pragma: no cover - optional dependency
    DET = None


BASE_DIR = Path(__file__).resolve().parent
APP_DIR = Path(os.getenv("GPX_APP_DIR", BASE_DIR))
UPLOAD_DIR = Path(os.getenv("GPX_UPLOAD_DIR", BASE_DIR / "gpx-files"))
INDEX_PATH = Path(os.getenv("GPX_INDEX_PATH", UPLOAD_DIR / "gpx-index.json"))
POI_INDEX_PATH = Path(os.getenv("POI_INDEX_PATH", UPLOAD_DIR / "pois-index.json"))
MAX_UPLOAD_BYTES = int(os.getenv("GPX_MAX_UPLOAD_BYTES", 10 * 1024 * 1024))
# Per-owner storage ceiling so an anonymous cookie session cannot fill the disk.
MAX_FILES_PER_OWNER = int(os.getenv("GPX_MAX_FILES_PER_OWNER", "500"))
MAX_BYTES_PER_OWNER = int(os.getenv("GPX_MAX_BYTES_PER_OWNER", str(200 * 1024 * 1024)))
# Lightweight per-client rate limits (events per 60s) on the abuse-prone endpoints.
UPLOAD_RATE_PER_MIN = int(os.getenv("GPX_UPLOAD_RATE_PER_MIN", "30"))
LOGIN_RATE_PER_MIN = int(os.getenv("GPX_LOGIN_RATE_PER_MIN", "60"))
# Diagnostic endpoints (e.g. /api/auth/debug) are 404 unless explicitly enabled.
DEBUG_ENDPOINTS = os.getenv("GPX_DEBUG_ENDPOINTS", "false").strip().lower() in ("1", "true", "yes")
OWNER_COOKIE_NAME = "elevf_owner"
OWNER_COOKIE_MAX_AGE = 60 * 60 * 24 * 365 * 5
# The owner cookie is the sole credential for anonymous sessions, so mark it Secure by
# default (production is HTTPS behind the reverse proxy). Set GPX_COOKIE_SECURE=false only
# for plain-HTTP local development where the browser would otherwise drop the cookie.
COOKIE_SECURE = os.getenv("GPX_COOKIE_SECURE", "true").strip().lower() not in ("0", "false", "no")
# --- Long-lived sign-in session ------------------------------------------------------
# A Google ID token lives ~1h and the frontend never persists it, so sign-in used to
# survive a reload only if a silent One Tap re-auth happened to succeed (frequently
# suppressed under FedCM / third-party-cookie rules). On a verified sign-in we now issue
# our own HMAC-signed, HttpOnly session cookie so the account sticks across reloads,
# restarts and a blocked Google script — without ever exposing a credential to JS.
SESSION_COOKIE_NAME = "elevf_session"
SESSION_MAX_AGE = int(os.getenv("GPX_SESSION_MAX_AGE_DAYS", "90")) * 86400
# Sliding expiry: re-issue the cookie once a session is past halfway to its expiry, so a
# regularly used browser is never signed out while an abandoned one still ages out.
SESSION_REFRESH_AFTER = SESSION_MAX_AGE // 2
# The signing key must survive container restarts or every restart signs everyone out, and
# it must live in the writable upload volume — the app directory is mounted read-only.
SESSION_SECRET_PATH = Path(os.getenv("GPX_SESSION_SECRET_PATH", UPLOAD_DIR / ".session-secret"))
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

# --- openrouteservice (GPX track editor's snap-to-route) -----------------------------
# Two upstreams, tried in order. The on-prem container holds a regional extract and is
# preferred: fast, private, no quota. The public API covers the rest of the planet and is
# only reached when the local graph has no route for those points — which is what a
# request outside the extract looks like.
#
# Both are optional. With neither set /api/health reports routing:false and the frontend
# degrades to freehand editing instead of failing per drag.
ORS_BASE_URL = os.getenv("ORS_BASE_URL", "").strip()
# Public openrouteservice. ORS_API_KEY is what enables this leg; the key stays server-side
# and is never sent to the browser, same as the local container's address.
#
# HeiGIT deprecated api.openrouteservice.org on 2026-04-28 in favour of api.heigit.org and
# shuts the old host down on 2026-08-24; quota on the old URL is already restricted, which
# shows up here as 502s. Existing keys work unchanged on the new host — only the base URL
# moved, gaining an /openrouteservice path segment.
ORS_API_KEY = os.getenv("ORS_API_KEY", "").strip()
ORS_FALLBACK_URL = os.getenv("ORS_FALLBACK_URL", "https://api.heigit.org/openrouteservice").strip()
# The public free tier allows far fewer calls than a local instance (40/min, 2000/day at
# the time of writing) and a drag costs up to two. Cap our own use of it so a burst of
# editing outside the extract cannot burn the daily quota in a couple of minutes.
ORS_FALLBACK_RATE_PER_MIN = int(os.getenv("ORS_FALLBACK_RATE_PER_MIN", "30"))
ORS_TIMEOUT_SECONDS = float(os.getenv("ORS_TIMEOUT_SECONDS", "20"))
ORS_RATE_PER_MIN = int(os.getenv("ORS_RATE_PER_MIN", "120"))
ORS_MAX_RESPONSE_BYTES = int(os.getenv("ORS_MAX_RESPONSE_BYTES", str(2 * 1024 * 1024)))
# Snap radius ceiling, and the widening ladder used when the requested radius finds no
# routable way. Sparse mapping (alpine trails, forest tracks) routinely puts the nearest
# way a few hundred metres from the recorded track, where the editor's 50 m default is a
# guaranteed 2010. Each extra rung costs one more upstream call per drag, so keep it short.
ORS_MAX_RADIUS_M = float(os.getenv("ORS_MAX_RADIUS_M", "2000"))
# 300 m is about the limit where a snap still means anything: past that the match is a
# different path, and the editor rejects the route anyway (GPX_EDIT_SNAP_MAX_DRIFT_M).
ORS_RADIUS_ESCALATION_M = [
    float(r) for r in os.getenv("ORS_RADIUS_ESCALATION_M", "300").split(",") if r.strip()
]
# Mirrors the profile dropdown in the edit panel; anything else 404s before we call out.
# Must also match ors/ors-config.yml — a profile enabled here but not built there answers
# every request with 400/code 2003, which _ors_local_missing below learns and routes around.
ORS_PROFILES = {"foot-hiking", "cycling-mountain"}
# How long a profile stays marked as absent from the local graph. The mark lives in this
# container, not in ORS, so a graph rebuild cannot clear it — the TTL is what lets a
# rebuild take effect without restarting toposcout.
ORS_LOCAL_MISS_TTL_SECONDS = float(os.getenv("ORS_LOCAL_MISS_TTL_SECONDS", "600"))

PUBLIC_ROOT_FILES = {
    "index.html",
    "style.css",
    "script.js",
    "maplibre-boot.mjs",
    "manifest.json",
    "service-worker.js",
    "icon.svg",
}

DEFAULT_INDEX = {
    "files_by_id": {},
    "filename_to_id": {},
}

DEFAULT_POI_INDEX = {"pois_by_id": {}}

# A POI's color (hex) drives its pin tint; the palette lives in the frontend.
POI_DEFAULT_COLOR = "#2e8b57"
POI_COLOR_RE = re.compile(r"^#[0-9a-fA-F]{6}$")
POI_NAME_MAX = 120
POI_DESC_MAX = 500

_index_lock = threading.Lock()
_poi_index_lock = threading.Lock()

# --- Minimal in-process rate limiter -------------------------------------------------
# Sliding-window counters keyed by "<scope>:<client-ip>". Sufficient for the single-worker
# deployment; swap for a shared store (e.g. Redis) if this ever runs multiple workers.
_rate_lock = threading.Lock()
_rate_buckets: dict[str, list[float]] = {}
_RATE_MAX_KEYS = 20000


def client_ip(request: Request) -> str:
    return request.client.host if request.client else "unknown"


def enforce_rate_limit(scope: str, request: Request, max_events: int, window_seconds: float = 60.0) -> None:
    if max_events <= 0:
        return
    key = f"{scope}:{client_ip(request)}"
    now = time.monotonic()
    cutoff = now - window_seconds
    with _rate_lock:
        bucket = _rate_buckets.get(key)
        if bucket is None:
            bucket = _rate_buckets[key] = []
        while bucket and bucket[0] < cutoff:
            bucket.pop(0)
        if len(bucket) >= max_events:
            raise HTTPException(status_code=429, detail="Too many requests, please slow down.")
        bucket.append(now)
        # Opportunistic cleanup so idle clients don't accumulate unbounded keys.
        if len(_rate_buckets) > _RATE_MAX_KEYS:
            for stale_key in [k for k, v in _rate_buckets.items() if not v or v[-1] < cutoff]:
                _rate_buckets.pop(stale_key, None)

app = FastAPI(title="TopoScout Backend")
app.mount("/lang", StaticFiles(directory=APP_DIR / "lang"), name="lang")
app.mount("/fonts", StaticFiles(directory=APP_DIR / "fonts"), name="fonts")
app.mount("/vendor", StaticFiles(directory=APP_DIR / "vendor"), name="vendor")


# The app shell must always be revalidated so a new release is picked up immediately and
# Cloudflare's edge can't keep serving a stale service worker; the ?v=-versioned assets and
# other static files are safe to cache hard because their URL changes every release. Set
# here at the origin: the reverse proxy / compose add no cache headers, and FastAPI's
# FileResponse / StaticFiles send none by default (Cloudflare was filling the gap with 4h).
SHELL_NO_CACHE = {"/", "/index.html", "/service-worker.js", "/manifest.json"}
STATIC_ASSET_SUFFIXES = (".js", ".mjs", ".css", ".pbf", ".svg")

# MapLibre v6 ships as ES modules (.mjs). A wrong Content-Type is a hard block for a module
# script, so register it here rather than trusting the interpreter's mimetypes table (the
# entry is version-dependent, and on Windows the registry can override it).
mimetypes.add_type("text/javascript", ".mjs")

# Third-party hosts the map, geocoder, and Google sign-in legitimately reach. Mirrors the
# tile allowlist in service-worker.js; keep the two in sync when adding a map source.
_CSP_REMOTE_HOSTS = (
    "https://tiles.mapterhorn.com "
    "https://tile.openstreetmap.org https://*.tile.openstreetmap.org "
    "https://tile.opentopomap.org https://*.tile.opentopomap.org "
    "https://*.basemaps.cartocdn.com https://server.arcgisonline.com "
    "https://cache.kartverket.no https://*.waymarkedtrails.org "
    "https://tile.tracestrack.com https://tile.thunderforest.com https://tile.jawg.io "
    "https://lm.clackspark.workers.dev"
)

# Enforced immediately: no-breakage hardening — blocks click-jacking (frame-ancestors),
# plugin/object embeds, <base> hijacking and off-site form posts.
CSP_ENFORCED = "frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self'"

# Report-Only for now: the resource allowlist we intend to enforce, shipped in observe-only
# mode so violations surface in the console without breaking the app (which still relies on
# inline event handlers/styles). Promote to Content-Security-Policy once the inline handlers
# are refactored out and the console is clean.
CSP_REPORT_ONLY = (
    "default-src 'self'; "
    "script-src 'self' 'unsafe-inline' https://accounts.google.com https://apis.google.com https://www.gstatic.com; "
    "style-src 'self' 'unsafe-inline'; "
    f"img-src 'self' data: blob: {_CSP_REMOTE_HOSTS}; "
    f"connect-src 'self' https://accounts.google.com https://nominatim.openstreetmap.org {_CSP_REMOTE_HOSTS}; "
    "font-src 'self'; worker-src 'self'; frame-src https://accounts.google.com; "
    "frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self'"
)


@app.middleware("http")
async def set_response_headers(request: Request, call_next):
    response = await call_next(request)
    path = request.url.path
    if path in SHELL_NO_CACHE:
        response.headers["Cache-Control"] = "no-cache"
    elif path.startswith(("/lang/", "/fonts/")) or path.endswith(STATIC_ASSET_SUFFIXES):
        response.headers["Cache-Control"] = "public, max-age=31536000, immutable"
    # Everything else (the /api/* endpoints) keeps whatever Cache-Control it set itself.

    # Security headers: nosniff/Referrer-Policy on every response; the CSP + framing pair
    # only makes sense on HTML documents, not tiles or JSON.
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
    if response.headers.get("content-type", "").startswith("text/html"):
        response.headers["X-Frame-Options"] = "DENY"
        response.headers.setdefault("Content-Security-Policy", CSP_ENFORCED)
        response.headers.setdefault("Content-Security-Policy-Report-Only", CSP_REPORT_ONLY)
    return response


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


# ==========================================================================
# Signed session cookie: keeps a verified Google identity valid for
# SESSION_MAX_AGE without the frontend holding on to the ID token.
# ==========================================================================
def _load_session_secret() -> bytes:
    """Return the HMAC key for session cookies, generating and persisting one if needed.

    Order: GPX_SESSION_SECRET env -> SESSION_SECRET_PATH file -> ephemeral fallback.
    The ephemeral case still works, but every restart invalidates existing sessions,
    so a writable upload volume (or the env var) is strongly preferred.
    """
    env_secret = os.getenv("GPX_SESSION_SECRET", "").strip()
    if env_secret:
        return env_secret.encode("utf-8")
    try:
        if SESSION_SECRET_PATH.exists():
            existing = SESSION_SECRET_PATH.read_text(encoding="utf-8").strip()
            if existing:
                return existing.encode("utf-8")
        SESSION_SECRET_PATH.parent.mkdir(parents=True, exist_ok=True)
        generated = secrets.token_urlsafe(32)
        # O_EXCL so two workers racing on first boot don't clobber each other; the loser
        # falls through to the re-read below and both end up with the same key.
        try:
            fd = os.open(SESSION_SECRET_PATH, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        except FileExistsError:
            return SESSION_SECRET_PATH.read_text(encoding="utf-8").strip().encode("utf-8")
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            handle.write(generated)
        return generated.encode("utf-8")
    except OSError:
        return secrets.token_bytes(32)


_SESSION_SECRET = _load_session_secret()


def _b64u_encode(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def _b64u_decode(value: str) -> bytes:
    return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))


def sign_session(claims: dict[str, Any]) -> tuple[str, int]:
    """Return (cookie_value, exp) for a session describing the given Google claims."""
    now = int(time.time())
    exp = now + SESSION_MAX_AGE
    payload = {
        "sub": claims.get("sub"),
        "email": claims.get("email") or "",
        "name": claims.get("name") or "",
        "picture": claims.get("picture") or "",
        "iat": now,
        "exp": exp,
    }
    body = _b64u_encode(json.dumps(payload, separators=(",", ":"), sort_keys=True).encode("utf-8"))
    signature = _b64u_encode(hmac.new(_SESSION_SECRET, body.encode("ascii"), hashlib.sha256).digest())
    return f"v1.{body}.{signature}", exp


def verify_session(value: str) -> dict[str, Any] | None:
    """Return the session payload for a valid, unexpired cookie, else None."""
    if not value:
        return None
    parts = value.split(".")
    if len(parts) != 3 or parts[0] != "v1":
        return None
    _version, body, signature = parts
    expected = _b64u_encode(hmac.new(_SESSION_SECRET, body.encode("ascii"), hashlib.sha256).digest())
    if not hmac.compare_digest(expected, signature):
        return None
    try:
        payload = json.loads(_b64u_decode(body))
    except Exception:
        return None
    if not isinstance(payload, dict) or not payload.get("sub"):
        return None
    try:
        if int(payload.get("exp", 0)) <= int(time.time()):
            return None
    except (TypeError, ValueError):
        return None
    return payload


def set_session_cookie(response: Response, claims: dict[str, Any]) -> int:
    """Issue a fresh session cookie for the given claims; returns its expiry (epoch s)."""
    value, exp = sign_session(claims)
    response.set_cookie(
        key=SESSION_COOKIE_NAME,
        value=value,
        max_age=SESSION_MAX_AGE,
        httponly=True,
        samesite="lax",
        secure=COOKIE_SECURE,
        path="/",
    )
    return exp


def clear_session_cookie(response: Response) -> None:
    # Leaves the anonymous owner cookie alone, so uploads made before sign-in
    # remain reachable after signing out.
    response.delete_cookie(
        key=SESSION_COOKIE_NAME,
        httponly=True,
        samesite="lax",
        secure=COOKIE_SECURE,
        path="/",
    )


def resolve_session_owner(request: Request) -> tuple[str | None, dict[str, Any] | None]:
    """Return (owner_id, payload) for a valid session cookie, else (None, None)."""
    payload = verify_session(request.cookies.get(SESSION_COOKIE_NAME, "").strip())
    if not payload:
        return None, None
    return f"{GOOGLE_OWNER_PREFIX}{payload['sub']}", payload


def resolve_account_owner(request: Request) -> tuple[str | None, dict[str, Any] | None]:
    """Resolve a signed-in account: fresh Google bearer token first, session cookie second."""
    google_owner, claims = resolve_google_owner(request)
    if google_owner:
        return google_owner, claims
    return resolve_session_owner(request)


def ensure_owner_id(request: Request, response: Response) -> str:
    # A verified Google identity always wins, so uploads follow the account
    # across devices/sessions regardless of the anonymous cookie.
    google_owner, _claims = resolve_account_owner(request)
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
        secure=COOKIE_SECURE,
        path="/",
    )
    return owner_id


def build_owner_filename_key(owner_id: str, filename: str) -> str:
    return f"{owner_id}:{filename}"


def require_owner_id(request: Request) -> str:
    google_owner, _claims = resolve_account_owner(request)
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

    parser = DET if DET is not None else ET
    try:
        root = parser.fromstring(payload)
    except ET.ParseError as exc:
        raise HTTPException(status_code=400, detail="Invalid GPX XML") from exc
    except Exception as exc:
        # defusedxml rejects entity-expansion / external-entity / DTD attacks here.
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


# ==========================================================================
# Points of Interest (POI) storage. Account-scoped (no anonymous fallback) and
# parallels the GPX index above: a single JSON file keyed by record id.
# ==========================================================================
def load_poi_index() -> dict[str, Any]:
    if not POI_INDEX_PATH.exists():
        return {"pois_by_id": {}}
    try:
        with POI_INDEX_PATH.open("r", encoding="utf-8") as handle:
            payload = json.load(handle)
    except (OSError, json.JSONDecodeError):
        return {"pois_by_id": {}}
    pois_by_id = payload.get("pois_by_id")
    if not isinstance(pois_by_id, dict):
        return {"pois_by_id": {}}
    return {"pois_by_id": pois_by_id}


def save_poi_index(index_payload: dict[str, Any]) -> None:
    ensure_storage_dirs()
    temp_path = POI_INDEX_PATH.with_suffix(".tmp")
    with temp_path.open("w", encoding="utf-8") as handle:
        json.dump(index_payload, handle, indent=2, sort_keys=True)
    temp_path.replace(POI_INDEX_PATH)


def require_google_owner_id(request: Request) -> str:
    """POIs are account-scoped: require a verified Google identity (no anon cookie)."""
    google_owner, _claims = resolve_account_owner(request)
    if not google_owner:
        raise HTTPException(status_code=401, detail="Google sign-in required")
    return google_owner


def _coerce_coord(value: Any, low: float, high: float, label: str) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail=f"{label} is required")
    if not math.isfinite(number) or number < low or number > high:
        raise HTTPException(status_code=400, detail=f"{label} out of range")
    return number


def validate_poi_body(body: Any, *, partial: bool = False) -> dict[str, Any]:
    """Validate/normalize a POI create (partial=False) or update (partial=True) body."""
    if not isinstance(body, dict):
        raise HTTPException(status_code=400, detail="Invalid request body")

    cleaned: dict[str, Any] = {}

    if not partial or "name" in body:
        name = (body.get("name") or "").strip()
        if not name:
            raise HTTPException(status_code=400, detail="Name is required")
        cleaned["name"] = name[:POI_NAME_MAX]

    if not partial or "description" in body:
        description = body.get("description")
        cleaned["description"] = ("" if description is None else str(description)).strip()[:POI_DESC_MAX]

    if not partial or "color" in body:
        color = body.get("color")
        cleaned["color"] = color.lower() if isinstance(color, str) and POI_COLOR_RE.match(color) else POI_DEFAULT_COLOR

    if not partial or "lat" in body or "lng" in body:
        cleaned["lat"] = _coerce_coord(body.get("lat"), -90.0, 90.0, "Latitude")
        cleaned["lng"] = _coerce_coord(body.get("lng"), -180.0, 180.0, "Longitude")

    if not partial or "elevation" in body:
        elevation = body.get("elevation")
        if elevation is None:
            cleaned["elevation"] = None
        else:
            try:
                cleaned["elevation"] = round(float(elevation))
            except (TypeError, ValueError):
                cleaned["elevation"] = None

    return cleaned


def serialize_poi(record: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": record["id"],
        "name": record.get("name"),
        "description": record.get("description", ""),
        "color": record.get("color", POI_DEFAULT_COLOR),
        "lat": record.get("lat"),
        "lng": record.get("lng"),
        "elevation": record.get("elevation"),
        "created_at": record.get("created_at"),
        "updated_at": record.get("updated_at"),
    }


@app.on_event("startup")
def on_startup() -> None:
    APP_DIR.mkdir(parents=True, exist_ok=True)
    ensure_storage_dirs()


@app.get("/api/health")
def health_check() -> dict[str, Any]:
    # "routing" lets the track editor disable snap-to-route up front instead of
    # discovering it through a failed drag. Either upstream is enough.
    return {"status": "ok", "routing": bool(ORS_BASE_URL or ORS_API_KEY)}


@app.post("/api/auth/login")
async def auth_login(request: Request, response: Response) -> dict[str, Any]:
    enforce_rate_limit("login", request, LOGIN_RATE_PER_MIN)
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

    # Hand back a long-lived session so the browser stays signed in once the
    # short-lived Google ID token expires or the page is reloaded.
    session_exp = set_session_cookie(response, claims)

    return {
        "owner_id": google_owner,
        "email": claims.get("email"),
        "name": claims.get("name"),
        "picture": claims.get("picture"),
        "sub": claims.get("sub"),
        "session_exp": session_exp,
    }


@app.get("/api/auth/session")
def auth_session(request: Request, response: Response) -> dict[str, Any]:
    """Report (and slide) the current sign-in session. Never 401s — absence is a valid answer."""
    enforce_rate_limit("login", request, LOGIN_RATE_PER_MIN)
    payload = verify_session(request.cookies.get(SESSION_COOKIE_NAME, "").strip())
    if not payload:
        # Drop an expired/tampered cookie so it stops being sent.
        if request.cookies.get(SESSION_COOKIE_NAME):
            clear_session_cookie(response)
        return {"signed_in": False}

    session_exp = int(payload["exp"])
    if int(time.time()) - int(payload.get("iat", 0)) >= SESSION_REFRESH_AFTER:
        session_exp = set_session_cookie(response, payload)

    return {
        "signed_in": True,
        "owner_id": f"{GOOGLE_OWNER_PREFIX}{payload['sub']}",
        "email": payload.get("email"),
        "name": payload.get("name"),
        "picture": payload.get("picture"),
        "sub": payload.get("sub"),
        "session_exp": session_exp,
    }


@app.post("/api/auth/logout")
def auth_logout(response: Response) -> dict[str, Any]:
    clear_session_cookie(response)
    return {"signed_in": False}


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

    Off by default: it discloses configuration and acts as a token-verification oracle, so
    it 404s unless GPX_DEBUG_ENDPOINTS is explicitly enabled for a debugging session.
    """
    if not DEBUG_ENDPOINTS:
        raise HTTPException(status_code=404, detail="Not found")
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
    enforce_rate_limit("upload", request, UPLOAD_RATE_PER_MIN)
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

        # Per-owner quota. An in-place re-upload replaces its own record, so exclude that
        # record (record_id) from the current usage before checking the new payload.
        owner_records = [
            r for r in index_payload["files_by_id"].values()
            if r.get("owner_id") == owner_id and r.get("id") != record_id
        ]
        if len(owner_records) + 1 > MAX_FILES_PER_OWNER:
            raise HTTPException(status_code=429, detail="Upload limit reached: too many files for this account.")
        used_bytes = sum(int(r.get("size") or 0) for r in owner_records)
        if used_bytes + len(payload) > MAX_BYTES_PER_OWNER:
            raise HTTPException(status_code=413, detail="Upload limit reached: storage quota exceeded.")

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


@app.get("/api/pois")
def list_pois(request: Request) -> dict[str, list[dict[str, Any]]]:
    owner_id = require_google_owner_id(request)
    with _poi_index_lock:
        index_payload = load_poi_index()

    pois = [
        serialize_poi(record)
        for record in index_payload["pois_by_id"].values()
        if record.get("owner_id") == owner_id
    ]
    pois.sort(key=lambda item: item.get("created_at") or "")
    return {"pois": pois}


@app.post("/api/pois")
async def create_poi(request: Request) -> dict[str, Any]:
    owner_id = require_google_owner_id(request)
    try:
        body = await request.json()
    except Exception as exc:
        raise HTTPException(status_code=400, detail="Invalid request body") from exc
    fields = validate_poi_body(body, partial=False)

    timestamp = datetime.now(timezone.utc).isoformat()
    with _poi_index_lock:
        index_payload = load_poi_index()
        poi_id = secrets.token_urlsafe(9)
        record = {
            "id": poi_id,
            "owner_id": owner_id,
            "created_at": timestamp,
            "updated_at": timestamp,
            **fields,
        }
        index_payload["pois_by_id"][poi_id] = record
        save_poi_index(index_payload)

    return serialize_poi(record)


@app.patch("/api/pois/{poi_id}")
async def update_poi(poi_id: str, request: Request) -> dict[str, Any]:
    owner_id = require_google_owner_id(request)
    try:
        body = await request.json()
    except Exception as exc:
        raise HTTPException(status_code=400, detail="Invalid request body") from exc
    fields = validate_poi_body(body, partial=True)

    with _poi_index_lock:
        index_payload = load_poi_index()
        record = index_payload["pois_by_id"].get(poi_id)
        if not record or record.get("owner_id") != owner_id:
            raise HTTPException(status_code=404, detail="POI not found")
        record.update(fields)
        record["updated_at"] = datetime.now(timezone.utc).isoformat()
        save_poi_index(index_payload)

    return serialize_poi(record)


@app.delete("/api/pois/{poi_id}")
def delete_poi(poi_id: str, request: Request) -> dict[str, str]:
    owner_id = require_google_owner_id(request)
    with _poi_index_lock:
        index_payload = load_poi_index()
        record = index_payload["pois_by_id"].get(poi_id)
        if not record or record.get("owner_id") != owner_id:
            raise HTTPException(status_code=404, detail="POI not found")
        del index_payload["pois_by_id"][poi_id]
        save_poi_index(index_payload)

    return {"status": "deleted", "id": poi_id}


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


# Routing failures are invisible from the browser — the editor just draws a straight line
# — so the reason has to reach the container log or it is lost. uvicorn's logger is used
# because it is guaranteed to have handlers attached under the deployment's run command.
_route_log = logging.getLogger("uvicorn.error")

# Profiles the local instance has told us it does not have (ORS error code 2003), with the
# time we learned it. A missing profile is a configuration mismatch between ors-config.yml
# and ORS_PROFILES, not a transient failure: retrying it per request wastes a round trip on
# every drag and — worse — pushes traffic that belongs on the free local instance onto the
# metered public API. Learned from the real response rather than pre-flighted against
# /ors/v2/status, whose profile keys are config keys and need not match the path parameter.
_ors_miss_lock = threading.Lock()
_ors_local_missing: dict[str, float] = {}


def _ors_local_has_profile(profile: str) -> bool:
    """False while `profile` is known-absent from the local graph and the mark is fresh."""
    with _ors_miss_lock:
        marked_at = _ors_local_missing.get(profile)
        if marked_at is None:
            return True
        if time.monotonic() - marked_at >= ORS_LOCAL_MISS_TTL_SECONDS:
            # Expired: let the next request find out whether a rebuild has landed.
            _ors_local_missing.pop(profile, None)
            return True
        return False


def _ors_mark_local_missing(profile: str) -> bool:
    """Mark `profile` absent locally. Returns True the first time, for one-shot logging."""
    with _ors_miss_lock:
        first = profile not in _ors_local_missing
        _ors_local_missing[profile] = time.monotonic()
        return first


def _ors_clear_local_missing(profile: str) -> None:
    with _ors_miss_lock:
        _ors_local_missing.pop(profile, None)


def _is_unknown_profile_error(response: requests.Response) -> bool:
    """True for ORS code 2003 — 'Parameter profile has incorrect value'."""
    if response.status_code != 400:
        return False
    try:
        return response.json().get("error", {}).get("code") == 2003
    except (ValueError, AttributeError):
        # Malformed or non-JSON body: fall back to matching the code in the raw text.
        return '"code":2003' in response.text.replace(" ", "")


def _ors_directions(base_url: str, profile: str, body: dict[str, Any], api_key: str = "") -> requests.Response:
    """One directions call. Raises requests.RequestException if the host is unreachable."""
    headers = {"Accept": "application/geo+json", "Content-Type": "application/json"}
    if api_key:
        # openrouteservice takes the bare key, with no "Bearer " prefix.
        headers["Authorization"] = api_key
    return requests.post(
        f"{base_url.rstrip('/')}/v2/directions/{profile}/geojson",
        json=body,
        headers=headers,
        timeout=ORS_TIMEOUT_SECONDS,
    )


@app.post("/api/route/{profile}", include_in_schema=False)
def post_route(profile: str, request: Request, payload: dict[str, Any] = Body(...)) -> Response:
    """Proxy a two-point directions request to openrouteservice.

    Tries the on-prem container first and falls back to the public API when it cannot
    answer — the local graph only covers its extract, and a request outside it is
    indistinguishable from "no routable way nearby". Neither upstream is reachable from
    the browser: only this endpoint can call them, only for the allowlisted profiles, and
    only with a request body we build ourselves. A plain def so the blocking requests run
    in FastAPI's threadpool.
    """
    enforce_rate_limit("route", request, ORS_RATE_PER_MIN)

    if profile not in ORS_PROFILES:
        raise HTTPException(status_code=404, detail="Unknown routing profile")
    if not ORS_BASE_URL and not ORS_API_KEY:
        raise HTTPException(status_code=503, detail="Routing is not configured")

    raw = payload.get("coordinates")
    if not isinstance(raw, list) or len(raw) != 2:
        raise HTTPException(status_code=400, detail="coordinates must be exactly two points")
    coordinates: list[list[float]] = []
    for pair in raw:
        if not isinstance(pair, (list, tuple)) or len(pair) != 2:
            raise HTTPException(status_code=400, detail="each coordinate must be [lon, lat]")
        try:
            lon, lat = float(pair[0]), float(pair[1])
        except (TypeError, ValueError):
            raise HTTPException(status_code=400, detail="coordinates must be numbers")
        if not (-180.0 <= lon <= 180.0) or not (-90.0 <= lat <= 90.0):
            raise HTTPException(status_code=400, detail="coordinate out of range")
        coordinates.append([lon, lat])

    try:
        radius = float(payload.get("radius", 50))
    except (TypeError, ValueError):
        radius = 50.0
    radius = max(10.0, min(ORS_MAX_RADIUS_M, radius))

    # Local first, public second. ORS answers 404/code 2010 when a point has no routable
    # way within `radiuses`, which is exactly what a point outside the local extract looks
    # like — so any non-200 from the local instance is a reason to try the public API,
    # not to give up.
    attempts: list[tuple[str, str, str]] = []
    if ORS_BASE_URL and _ors_local_has_profile(profile):
        attempts.append(("local", ORS_BASE_URL, ""))
    if ORS_API_KEY:
        attempts.append(("public", ORS_FALLBACK_URL, ORS_API_KEY))

    # Widen the snap radius and try again if nobody could reach the track. The requested
    # radius suits dense mapping; in sparse terrain (alpine trails, forest tracks) the
    # nearest routable way is routinely a few hundred metres off, and a 2010 there is not
    # "no road exists" but "you did not look far enough". The client decides whether a
    # far-away snap is worth taking, so widening here cannot silently move a handle.
    radii = [radius] + [r for r in ORS_RADIUS_ESCALATION_M if r > radius]

    last_detail = "Could not route between those points"
    quota_exhausted = False
    local_disabled = False
    for attempt_radius in radii:
        # Built here, never forwarded from the client: the browser cannot smuggle extra ORS
        # options (alternative_routes, avoid_polygons, huge radiuses) through this endpoint.
        upstream_body = {
            "coordinates": coordinates,
            "elevation": True,
            "instructions": False,
            "geometry_simplify": False,
            "radiuses": [attempt_radius, attempt_radius],
        }

        for source, base_url, api_key in attempts:
            if source == "local" and local_disabled:
                continue
            if source == "public":
                # Quota guard, separate from the per-client limit above. Raising 502 rather
                # than 429 keeps the editor's straight-line fallback behaviour consistent.
                try:
                    enforce_rate_limit("route-public", request, ORS_FALLBACK_RATE_PER_MIN)
                except HTTPException:
                    last_detail = "Public routing quota exceeded"
                    quota_exhausted = True
                    break

            try:
                upstream_response = _ors_directions(base_url, profile, upstream_body, api_key)
            except requests.RequestException as exc:
                last_detail = "Routing service unreachable"
                _route_log.warning("route[%s] %s unreachable: %s", source, base_url, exc)
                continue

            if upstream_response.status_code != 200:
                last_detail = "Could not route between those points"
                # A local 2003 is a configuration mismatch, not an unroutable point: the
                # graph was built without this profile and no radius or retry will help.
                # Say so once, at ERROR, and stop calling it until the TTL expires.
                if source == "local" and _is_unknown_profile_error(upstream_response):
                    if _ors_mark_local_missing(profile):
                        _route_log.error(
                            "route[local] %s has no '%s' profile (ORS code 2003). Its graph was "
                            "built from a different profile list, so every request will fall "
                            "through to the public API and spend quota. Fix: enable the profile "
                            "in ors-config.yml and rebuild with REBUILD_GRAPHS=True. Skipping "
                            "the local instance for this profile for %.0fs.",
                            base_url, profile, ORS_LOCAL_MISS_TTL_SECONDS,
                        )
                    # Skip local for the remaining radii of *this* request too — widening
                    # cannot conjure a profile — but still fall through to public below.
                    local_disabled = True
                    continue
                # 401/403 means a missing or rejected key, not an unroutable point — worth
                # calling out, because it looks identical from the browser.
                hint = " (check ORS_API_KEY)" if upstream_response.status_code in (401, 403) else ""
                _route_log.warning(
                    "route[%s] %s r=%.0fm -> HTTP %s%s: %.200s",
                    source, base_url, attempt_radius, upstream_response.status_code, hint,
                    upstream_response.text.replace("\n", " "),
                )
                continue
            if len(upstream_response.content) > ORS_MAX_RESPONSE_BYTES:
                last_detail = "Routing response too large"
                _route_log.warning(
                    "route[%s] response %d bytes exceeds ORS_MAX_RESPONSE_BYTES (%d)",
                    source, len(upstream_response.content), ORS_MAX_RESPONSE_BYTES,
                )
                continue

            if source == "local":
                # A local success means the profile is there after all (a rebuild landed
                # while a stale mark was still counting down) — drop the mark immediately.
                _ors_clear_local_missing(profile)
            if attempt_radius != radius:
                _route_log.info(
                    "route[%s] succeeded at widened radius %.0fm (requested %.0fm)",
                    source, attempt_radius, radius,
                )
            return Response(
                content=upstream_response.content,
                media_type="application/geo+json",
                headers={
                    "Cache-Control": "no-store",
                    "X-Route-Source": source,
                    "X-Route-Radius": str(int(attempt_radius)),
                },
            )

        if quota_exhausted:
            break

    # Every upstream declined. The editor falls back to a straight line either way, so the
    # exact reason only matters in the log.
    if not attempts:
        _route_log.warning("route[%s] no upstream configured", profile)
    raise HTTPException(status_code=502, detail=last_detail)


@app.get("/", include_in_schema=False)
def serve_index() -> FileResponse:
    return FileResponse(APP_DIR / "index.html")


@app.get("/{asset_name}", include_in_schema=False)
def serve_public_asset(asset_name: str) -> FileResponse:
    if asset_name not in PUBLIC_ROOT_FILES:
        raise HTTPException(status_code=404, detail="Not found")
    return FileResponse(APP_DIR / asset_name)
