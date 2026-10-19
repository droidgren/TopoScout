# Architecture of TopoScout

## Bird's Eye View

TopoScout is a browser-based terrain analysis and route-editing tool: find the highest points in an area, compare climbs, visualize slope, and create or edit GPX routes on a topographic map. The core experience is entirely client-side — a single classic-script `script.js` renders a MapLibre GL map and does all terrain analysis (highest points, climbs, slope) by sampling elevation-tile pixel data in the browser. No custom backend is required for the map to work.

An optional FastAPI backend (`main.py`) adds account-scoped persistence on top of that static app: GPX file storage/sharing, saved Points of Interest, Google Sign-In, a Strava heatmap tile proxy, and a snap-to-road proxy for the track editor (openrouteservice). The frontend probes for this backend at startup (`isBackendEnabled()` / `probeBackendHealth()` in `script.js`) and degrades gracefully to local-only behavior when it's absent — e.g. on a plain static host like GitHub Pages.

A third piece, a small Cloudflare Worker (`worker.js`), proxies basemap tile requests (Lantmäteriet WMTS/WMS and a Mapbox style) so upstream credentials and referer requirements never reach the browser directly.

## Code Map

### `script.js`

The entire frontend application (~10,000 lines), loaded as a classic deferred script and driving the page through inline `onclick=` handlers in `index.html` — there is no bundler or module graph for app code. Organized into numbered top-level sections marked with `// ====` banners:

1. **CONFIGURATION & CONSTANTS** — tile URLs, storage keys, GPX-edit tuning constants, `APP_VERSION`/`BUILD_NUMBER`.
2. **DOM ELEMENTS** — cached element references.
3. **LANGUAGE & TRANSLATIONS** — wiring for `lang/en.js` / `lang/sv.js`.
4. **MAP & VARIABLE INITIALIZATION** — includes a Leaflet-API-compatible adapter (`L`, `createMapAdapter()`, `createMarkerLayer()`, `createPolylineLayer()`, etc., around line 300-1600) that wraps MapLibre GL so the rest of the app can be written against a Leaflet-shaped surface. This is why `maplibre-boot.mjs` publishes `maplibregl` as a global instead of the app importing it as an ES module.
5. **FUNCTIONS** — the bulk of the app: terrain analysis (highest points, climbs, slope), POIs, route-names legend, geo-coordinate parsing (DD/DDM/DMS/Plus Code, its own labeled sub-section), GPX download/export, Google Sign-In, the elevation profile bar, service worker update handling, the tutorial engine, manual climb entry, **GPX track editing** (5d — drag-to-reshape with routing-service snapping; see the block comment at the top of that section for the handle-index invariants), **create route** (5e — click-to-click routed route creation), and the **route info panel** (5f).
6. **START LOGIC** — event listener wiring and app init, plus print-map export (PDF via `vendor/jspdf.umd.min.js`).

Terrain analysis works by reading pixel values from the Mapterhorn elevation-tile source (`DATA_TILE_URL`) and decoding them client-side; it does not call a server-side elevation API.

### `index.html`

The single HTML shell: control panel, map container, and all modals (`info-modal`, `key-modal`, `gpx-modal`, `poi-modal`, `poi-form-modal`, `ios-install-modal`) plus the GPX edit/route-create/route-info side panels. Loads `vendor/maplibre-gl.css`, `style.css`, `maplibre-boot.mjs` (module), `vendor/maplibre-contour.min.js`, then `script.js` (classic, deferred) in that fixed order — module and deferred classic scripts share one execution queue, so this guarantees `maplibregl` exists as a global before `script.js` runs. Local asset tags carry a `?v=<build>` query string that must match `CACHE_NAME` in `service-worker.js` (see Architectural Invariants).

### `style.css`

All app styling in one file, organized with `/* --- SECTION --- */` banner comments (control panel, data box, mobile overrides, collapsible sections, POIs, modals, map controls, GPX modal, elevation profile bar, route info panel, print-map mode, etc.). Mobile-specific overrides are separate rule blocks that must be ordered *after* the base rule they override, since there's no CSS layering — see `style-css-cascade-order` invariant below.

### `lang/en.js`, `lang/sv.js`

Flat key/value translation tables (`LANG_EN`, `LANG_SV`) consumed by `updateLanguage()` in `script.js`. Every user-facing string lives here, not inline in HTML or JS.

### `service-worker.js`

PWA offline support. Precaches the app shell on `install` (`STATIC` + version-stamped `VERSIONED` assets under their `?v=<CACHE_NAME>` URL) and evicts old shell caches on `activate`, keeping only `CACHE_NAME` and the separate `toposcout-tiles-v1` runtime cache. Same-origin requests are cache-first and **search-sensitive**; cross-origin map/elevation tiles (hosts listed in `TILE_HOSTS`) are stale-while-revalidate and capped at `TILE_CACHE_MAX` entries. `/api/*` and navigations bypass the shell cache (network-first) so the backend and HTML are always fresh when online.

### `maplibre-boot.mjs`

A one-purpose ES module shim: imports self-hosted MapLibre GL v6 from `vendor/`, points it at the self-hosted worker script, and republishes it as `window.maplibregl` for the classic-script `script.js` to consume.

### `main.py`

Optional FastAPI backend, single file, organized by comment-delimited sections: session signing, GPX index storage, POI index storage, then route handlers. Runs alongside the static app and is entirely additive — if unreachable, the frontend falls back to local-only behavior. Responsibilities:

- **Static serving**: `GET /` and `GET /{asset_name}` serve `index.html` and a fixed allowlist (`PUBLIC_ROOT_FILES`) of root assets directly from `APP_DIR` — no templating, no build step.
- **Auth**: Google ID token verification (`verify_google_token`) plus a self-issued HMAC-signed, HttpOnly session cookie (`SESSION_COOKIE_NAME`) so sign-in survives reloads without ever exposing a credential to JS. Anonymous sessions get an `OWNER_COOKIE_NAME` cookie as their sole identity; `claim_anonymous_files()` migrates anonymous uploads to a Google account on sign-in.
- **GPX file storage** (`/api/files*`, `/api/upload`): flat-file storage under `GPX_UPLOAD_DIR`, indexed by a single JSON file (`load_index()`/`save_index()`, atomic write via temp-file rename) rather than a database. Per-owner quotas (`MAX_FILES_PER_OWNER`, `MAX_BYTES_PER_OWNER`) and upload rate limiting are enforced in-process.
- **POI storage** (`/api/pois*`): same JSON-index pattern, Google-account-scoped only (`require_google_owner_id`).
- **Heatmap proxy** (`/api/heatmap/...`): forwards to `STRAVA_HEATMAP_PROXY_URL` with allowlisted activity/color params.
- **Routing proxy** (`/api/route/{profile}`): the GPX editor's snap-to-road support. Tries a local openrouteservice container (`ORS_BASE_URL`) first, then an optional public fallback (`ORS_FALLBACK_URL`/`ORS_API_KEY`), widening the snap radius (`ORS_RADIUS_ESCALATION_M`) when the local graph has no match. Both upstreams are optional — with neither set, `/api/health` reports `routing:false` and the editor degrades to freehand editing.
- **Rate limiting**: a minimal in-process limiter (`enforce_rate_limit`), not a shared/external store — see Architectural Invariants for what that implies.

### `worker.js`

Standalone Cloudflare Worker (deployed separately, not by this repo's CI) that proxies Lantmäteriet basemap tiles and a Mapbox style, keeping the Mapbox token and Lantmäteriet's required Referer header server-side. Enforces a Referer allowlist and dynamic CORS based on `Origin`.

### `ors/`

Configuration for the two openrouteservice deployment targets referenced by `main.py`'s routing proxy: `ors-config.yml` (the on-prem container's profile config — must enable the same profiles as `ORS_PROFILES` in `main.py`, currently `foot-hiking`/`cycling-mountain`/`foot-walking`/`cycling-regular`, or requests 400) and `openrouteservice.yaml`.

### `vendor/`

Self-hosted third-party libraries checked into the repo (MapLibre GL v6, maplibre-contour, jsPDF) so the PWA installs and boots fully offline. Not build artifacts — treat as pinned dependencies to be updated deliberately, not regenerated.

### `tests/`

Playwright end-to-end tests (`coords.spec.ts`, `gps-center.spec.ts`, `gpx-edit.spec.ts`, `example.spec.ts`) that drive the app in a real browser via `static-server.mjs`. Run via `npm test` (`playwright test`) and in CI (`.github/workflows/playwright.yml`) on every push/PR to `main`/`master`.

### `toposcout.yaml`, `Dockerfile`, `requirements.txt`

Deployment: `Dockerfile` builds the FastAPI app into a `python:3.12-slim` image; `toposcout.yaml` is the docker-compose service definition for the actual production deployment (reverse-proxied, `FORWARDED_ALLOW_IPS` scoped to the proxy's Docker subnet, GPX storage on a bind-mounted volume).

## Cross-Cutting Concerns

- **Versioning/caching**: every deploy bumps three numbers in lockstep — `CACHE_NAME` in `service-worker.js`, the `?v=` query string on `style.css`/`script.js`/`lang/en.js`/`lang/sv.js` in `index.html`, and `BUILD_NUMBER` in `script.js`. All are search-sensitively matched by the service worker; a mismatch serves a stale asset on refresh. See `CLAUDE.md` for the exact procedure.
- **i18n**: no string is ever hardcoded in `index.html` or `script.js` — everything routes through `translations[currentLang]` keys defined in `lang/en.js`/`lang/sv.js`.
- **Persistence backend**: `main.py` uses flat JSON index files with atomic (`temp.replace()`) writes instead of a database. This is a deliberate scale choice, not an oversight — see invariant below.
- **Auth boundary**: Google credentials and session-signing secrets never reach the browser; the frontend only ever holds a short-lived Google ID token (used once, server-side) or an opaque HttpOnly session cookie.
- **Graceful degradation**: every backend-dependent feature (GPX cloud storage, POIs, routing snap, heatmap) has a client-side fallback path and is optional at both the network layer (`isBackendEnabled()`) and the service layer (`main.py` works with `ORS_BASE_URL`/`ORS_API_KEY` unset).
- **Testing**: Playwright drives the real static-served app end-to-end; there are no unit tests for `script.js`. `coords.spec.ts` runs flaky under high worker parallelism due to browser-launch contention, not app regressions.

## Architectural Invariants

- `script.js` is a classic script relying on globals, not an ES module — the only ES module in the app is `maplibre-boot.mjs`, whose sole job is to bridge MapLibre into a global for `script.js` to consume. Do not convert app code to `import`/`export` without also reworking the inline `onclick=` handlers in `index.html` that call it.
- The frontend never imports MapLibre GL directly; all map operations go through the Leaflet-shaped adapter (`L`, `createMapAdapter()`) defined early in `script.js`'s "MAP & VARIABLE INITIALIZATION" section.
- `main.py` never receives or stores a long-lived Google credential — only a one-time ID token it verifies and discards, replaced by its own signed session cookie.
- GPX/POI storage has no database; `load_index()`/`save_index()` and their POI equivalents are the only access path to the JSON index files, and writes are always atomic via temp-file rename.
- Snap-to-road profiles are defined in several places that must stay in sync: `ORS_PROFILES` (`main.py`), `GPX_EDIT_PROFILES` (`script.js`), `ors/ors-config.yml`, and — once per panel, for the track editor and Create Route — the `<option>` list in `index.html` and the `optionKeys` label map in `script.js`. `GPX_EDIT_PROFILES` only relabels `<option>`s that already exist rather than building them, so a profile added to the array alone never appears; one missing from `ors-config.yml` fails at request time, not at deploy time.
- CSS has no cascade layers — mobile override blocks in `style.css` must be physically ordered after the base rule they override, or they silently lose.
- The public root-asset surface served by `main.py`'s `serve_public_asset()` is an explicit allowlist (`PUBLIC_ROOT_FILES`), not "serve anything in `APP_DIR`" — adding a new root-level static file requires adding it to that set.
- `worker.js` and `ors/` are deployed independently of `main.py` (a separate Cloudflare Worker and a separate container network); nothing in this repo's CI deploys them.
