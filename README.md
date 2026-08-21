# TopoScout

TopoScout is a browser-based terrain analysis tool for finding high points, comparing climbs, visualizing slope, and overlaying GPX routes directly on the map. The app runs fully client-side, so terrain analysis happens in the browser without a custom backend. Its designed to work on mobile devices as well, and can be [installed as an app](#installing-as-an-app-pwa).

🌐 Open the [Live demo](https://toposcout.org/) with GPX store.

## Core Capabilities

- **Live center elevation** for the current map position.
- **Find Highest Points** within a configurable search radius.
- **Find Climbs** by scanning many directions and ranking routes by cumulative ascent.
- **Slope Map** overlay with opacity and slope-angle filtering.
- **GPX route overlay** with customizable styling and route stats.
- **Points of Interest (POIs)** saved to your Google account, with a custom name, description, and color.
- **Print map** export of the framed area to a print-ready PDF (A4/A3/A2, WGS 84 or SWEREF 99), desktop only.
- **Map tools** for overzoom, tilt, and 3D terrain exaggeration.
- **Share Map View** links that restore language, center, zoom, and selected layer.
- **Multiple map sources** including topographic, satellite, national, and debug elevation layers.
- **PWA install support** for desktop and mobile.
- **English and Swedish** localization.

## Feature Overview

### Terrain analysis

TopoScout focuses on terrain discovery rather than just displaying a single height sample.

- **Highest-point scanning** ranks the tallest candidates inside the current search radius.
- **Climb analysis** estimates the strongest uphill routes by summing positive elevation changes over a chosen distance.
- **Slope visualization** renders a color-coded raster overlay that highlights shallow terrain, steep hillsides, and very steep ground.
- **Water filtering** can exclude water-colored areas from analysis to reduce false positives.

### GPX route tools

The built-in GPX overlay lets you add route context while inspecting the terrain.

- Load a local `.gpx` file directly in the browser.
- Customize track color and line width.
- Toggle distance labels in kilometers or miles.
- Color the route by slope.
- Show waypoints and min/max elevation markers.
- View route summary stats including distance, elevation gain/loss, and min/max elevation.
- Open an **elevation profile bar** for the loaded route: hover or drag to scrub along the track, scroll to zoom the profile, and use the arrow keys to step (hold `Shift` for larger steps).
- Enable **Sync Map with Profile** to pan the map to a blue marker that follows the profile cursor.
- **Edit track**: reshape a loaded route by dragging handles along it. Three handles (start, midpoint, end) are placed automatically, and clicking the track adds more; right-click (or long-press) removes one. Each drag re-routes the two sub-segments either side of the moved handle, snapping to real trails and roads via [self-hosted routing](#self-hosted-routing-openrouteservice) — turn **Snap to roads/paths** off for freehand editing. The panel has Undo, Redo, Save and Cancel, and the routing profile can be set to running/walking (default) or bike/mountain bike, and applies per drag rather than per session.
- **Download** the loaded route back to a `.gpx` file (saved under its current name). After saving edits the file is regenerated from the edited geometry, so per-point timestamps and sensor extensions from the original are not preserved.
- Optionally upload, list, share, rename, and delete GPX routes when the [optional backend](#optional-backend-gpx-upload-and-sharing) is running.
- To acess your GPX file you log i with your Google account

### Points of Interest

Save your own marked spots and keep them on every device.

- Sign in with Google, then tap **Add POI** and tap the map to drop a pin.
- Give each POI a name, a description (URLs become clickable links), and a color.
- POI pins use a star marker tinted with the chosen color, show the point's elevation, and include a copy-coordinates button.
- Open a POI from the list to recenter the map on it, or move, rename, edit, and delete it.
- POIs are stored per Google account through the [optional backend](#optional-backend-gpx-upload-and-sharing) and load automatically wherever you're signed in.
- Toggle all POI pins on or off with the **Show POIs** checkbox.

### Print map (PDF export)

Export the current view as a print-ready PDF. Print map is **desktop only** (the framing UI needs the room) and is launched by **clicking the app logo** in the Control Panel header.

- A framing **window** is drawn over the live map (the area outside is shadowed), so you can pan and zoom to frame exactly what you want to print.
- Choose the **paper size** (A4, A3, or A2) and **orientation** (portrait or landscape).
- Pick the **coordinate system** — **WGS 84** (default) or **SWEREF 99 TM**.
- Toggle each annotation independently: **scale ruler**, **map source**, **coordinates**, **north arrow**, and **map border** (border off by default). Disabling an annotation reclaims its margin for the map, so the printed area grows.
- The export captures your base layer, hillshade, contours, route overlays, and the GPX track at print resolution (~200 DPI), then composites POI pins, analysis result pins, and GPX labels/waypoints on top.
- The finished PDF shows the **scale** (`1:X`) and map **source** by the scale ruler, a **north arrow** rotated to true north, a small **TopoScout.org** stamp, and **corner coordinates** at the upper-left and lower-right (northing horizontal, easting vertical).

### Map and navigation tools

- Search by place name or coordinates.
- Jump to your current position with the GPS button.
- Rotate the map with `Ctrl` + drag on desktop or two-finger rotation on touch devices.
- Reset north using the compass control.
- Toggle 3D terrain with the **3D** button next to the search box.
- Enable overzoom, tilt, and 3D exaggeration from **Advanced settings** in the About menu.
- Switch between multiple map layers without leaving the current map state.

## Map Layers And Data Sources

Built-in layers include:

- OpenTopoMap
- Tracetrack Topo
- ThunderForest Outdoors
- Lantmateriet (Sweden)
- Norgeskart (Norway)
- OpenStreetMap
- Satellite (ESRI)
- Elevation Data (debug view)

Some third-party layers require an API key. When needed, the app prompts for the key and stores it locally in the browser.

Elevation analysis uses Terrarium-format DEM tiles from Mapterhorn.

### Route overlays

Optional overlays can be drawn on top of any base layer from the **Route Overlay** dropdown:

- **Waymarked Trails** — hiking, cycling, MTB, and skating route networks, with a "Routes in view" legend (click a route to isolate just that trail).
- **OSM Path layer** — OpenStreetMap paths and trails from a Mapbox raster style, proxied through the Cloudflare worker so no API key reaches the browser.
- **Strava Global Heatmap** — aggregated activity heatmap
## How The Analysis Works

### Shared analysis pipeline

1. The app loads terrain raster tiles for the current viewport into an off-screen analysis surface.
2. Pixel values are decoded with the Terrarium elevation formula: `(R * 256 + G + B / 256) - 32768`.
3. The same viewport data can then be reused by the peak scan, climb scan, and slope renderer.
4. Optional water analysis masks out likely water pixels before ranking terrain results.

### Find Highest Points

1. The visible analysis surface is sampled for candidate elevations.
2. Only candidates inside the selected search radius are kept.
3. Candidates are sorted by elevation.
4. A minimum-distance filter removes near-duplicates so the result list stays geographically useful.
5. The best matches are rendered as numbered markers with result popups.

### Find Climbs

1. Candidate start points are sampled across the analysis surface.
2. Multiple headings are tested from each start point.
3. Each path is walked in small elevation steps.
4. A smoothing pass reduces tile noise.
5. The route is scored by cumulative positive ascent.
6. The best climbs are drawn on the map with distance, slope, vertical drop, and elevation details.

### Slope Map

1. The app compares neighboring elevation samples to estimate slope angle.
2. Each pixel is assigned a slope class color.
3. The overlay can be clipped to the search radius or shown across the full visible viewport.
4. Users can filter by minimum and maximum slope angle, then adjust overlay opacity.

## Using The App

### 1. Choose the map context

- Pick a base layer from the layer selector.
- Search for a place or center the map on your current location.
- Adjust the search radius and decide whether to show or lock it.

### 2. Enable map tools when needed

- Click the **3D** button next to search to turn on 3D terrain relief.
- Use **Advanced settings** (in the About menu) for **Overzoom**, **Tilt**, and **3D Exaggeration**.

### 3. Run analysis

- Open **Find Highest Points** to rank peaks inside the active radius.
- Open **Find Climbs** to look for strong uphill routes over a fixed measurement distance.
- Open **Generate Slope Map** to paint the terrain by steepness.

### 4. Add routes and POIs

- Expand **Add Routes and POIs**.
- Load a GPX file, or sign in and tap **Add POI** to drop a saved Point of Interest.
- Tune track styling and visibility options, and toggle pins with **Show POIs**.
- Compare routes and POIs against peak, climb, and slope results already on the map.

### 5. Print a map (desktop)

- Click the **app logo** in the Control Panel header to open Print map.
- Pan and zoom to frame the area inside the print window, then pick the paper size, orientation, and coordinate system.
- Toggle the annotations you want and click **Generate PDF** to download the print-ready file.

### 6. Share or install

- Click the share button in the header to copy a map-state link.
- Install the app from the About dialog or the mobile install prompt when supported.

## Installing as an App (PWA)

TopoScout is a Progressive Web App, so you can install it to your home screen or desktop for a full-screen, app-like experience. Once installed, the core app shell works offline.

### Android (Chrome)

- Open [toposcout.org](https://toposcout.org/) in Chrome.
- Tap the **⋮** menu → **Install app** (or **Add to Home screen**).
- You can also use the in-app install prompt, or the **Install as App** button in the About dialog.

### iPhone / iPad (Safari)

- Open [toposcout.org](https://toposcout.org/) in **Safari** (installing isn't available in other iOS browsers).
- Tap the **Share** button.
- Scroll down and tap **Add to Home Screen**, then tap **Add**.

### Desktop (Chrome / Edge)

- Click the install icon in the address bar, or use the **Install as App** button in the About dialog.

## State, Sharing, And Storage

- The app remembers language, map position, zoom, and selected layer in `localStorage`.
- Shared URLs restore the current language and map state.
- API keys are stored locally in the browser.
- Points of Interest are saved per Google account on the optional backend, so they sync across devices.
- No terrain analysis results are uploaded to a project server.

## Optional Backend (GPX Upload And Sharing)

The frontend works fully on static hosting (GitHub Pages and the live demo) with no backend. An optional FastAPI backend adds GPX upload, a per-browser upload history, shareable `?gpx=<id>` links, and saved Points of Interest.

The frontend auto-detects the backend by probing `/api/health` on load. When it is reachable, the **Load GPX Route** button opens an upload/history modal and share links include the uploaded route. When it is not reachable, the same button opens the local file picker directly — no upload UI, no errors, and any `?gpx=` parameter is stripped silently.

Saved **Points of Interest** also require the backend: each POI is tied to your Google account through the `/api/pois` endpoints, so signing in shows your pins on any device. Without the backend, the **Add POI** flow reports that POIs need the online backend.

Run it locally:

```bash
pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 8000
```

Then open `http://localhost:8000/`. The backend serves the static files and stores uploads under `gpx-files/` (configurable via `GPX_UPLOAD_DIR`).

Or with Docker:

```bash
docker build -t toposcout .
docker run -p 8000:8000 -v "$(pwd)/gpx-files:/app/gpx-files" toposcout
```

## Self-Hosted Routing (openrouteservice)

The track editor's **Snap to route** needs a routing engine. It talks to a self-hosted [openrouteservice](https://openrouteservice.org/) instance through the backend's `/api/route/{profile}` proxy — the browser never reaches ORS directly, so no port is published, no CORS is configured, and no host is added to the CSP. Without it (or on static hosting) the checkbox is disabled and editing falls back to freehand lines.

Compose file: `ors/openrouteservice.yaml`. Config: `ors/ors-config.yml`.

Two profiles are built, matching the editor's dropdown:

| Profile | Dropdown | Routes over |
|---|---|---|
| `foot-hiking` | Running/Walking (default) | Footways, paths, tracks and residential/service/living-street roads unpenalised; cycleways and tertiary/secondary/primary allowed but penalised; motorway/trunk and anything `foot=no` excluded. Weighted by SAC scale and hiking-route relations, so it will route alpine trails that `foot-walking` refuses — at the cost of some trail bias on mixed street/trail terrain. |
| `cycling-mountain` | Bike/Mountain bike | Tracks, paths and roads suitable for an MTB — the legs a runner shares with bikes. |

The profile applies per drag, not per session, so one leg can follow a trail and the next a road without leaving edit mode. The enabled set must stay identical in three places — `ors/ors-config.yml`, `ORS_PROFILES` in `main.py`, and `GPX_EDIT_PROFILES` plus the `<option>` list in the frontend — or the dropdown offers profiles that 502.

The dropdown label says **Running** but the profile is `foot-hiking`: the label names the use case, the profile is whichever ORS profile serves it best. `foot-walking` was tried first and dropped — at 45.846 N, 7.034 E it could not route at any snap radius while `cycling-mountain` at the same coordinates could, so the path is mapped in OSM and the walking profile was the blocker. `driving-car` was dropped outright; car routing has no use in a running app. Re-adding a profile means a full graph rebuild.

### Two upstreams

`/api/route/{profile}` tries two openrouteservice instances in order:

1. **On-prem** (`ORS_BASE_URL`) — the container below, holding a regional extract. Fast, private, no quota.
2. **Public API** (`ORS_API_KEY`) — `https://api.heigit.org/openrouteservice`, tried only when the local instance cannot answer.

ORS returns 404 with code 2010 when a point has no routable way nearby, which is exactly what a point outside the local extract looks like — so any non-200 from the local instance is a reason to try the public API, not to give up. The response carries `X-Route-Source: local` or `public` so you can tell which answered.

**A profile the local graph doesn't have.** `ORS_PROFILES` in `main.py` and the enabled profiles in `ors/ors-config.yml` must match. If they drift — say the profile list changed but the graph was never rebuilt — the local instance answers every request with HTTP 400 / ORS code 2003 (`Parameter 'profile' has incorrect value`). That is a configuration mismatch, not an unroutable point: no radius or retry can help, and left alone it silently pushes every drag onto the metered public API.

The proxy detects that specific code, logs it **once** at ERROR naming the fix, and then skips the local instance for that profile for `ORS_LOCAL_MISS_TTL_SECONDS` (default 600). The mark lives in the app container, not in ORS, so a graph rebuild cannot clear it — the TTL is what lets a rebuild take effect without restarting `toposcout`, and the first successful local response drops the mark immediately. A 400 from the *public* leg never marks anything.

The cure is always the same: enable the profile in `ors-config.yml` and rebuild with `REBUILD_GRAPHS: "True"`.

**Snap radius widening.** The editor asks for a 50 m snap radius, which suits dense mapping. In sparse terrain — alpine trails, forest tracks — the nearest routable way is routinely a few hundred metres from the recorded track, and 2010 there means "you did not look far enough", not "no path exists". So when every upstream declines, the proxy retries the whole ladder at progressively wider radii (`ORS_RADIUS_ESCALATION_M`, default `300,1500`), and reports the one that worked as `X-Route-Radius`.

The cost is upstream calls: a drag over genuinely unroutable ground (a glacier, say) burns one call per radius per upstream — six with both legs configured, three of them against the public quota. `ORS_FALLBACK_RATE_PER_MIN` bounds the damage. Shorten or empty the ladder if you only ever edit in well-mapped areas.

Widening never moves a handle on its own: the editor adopts a routed endpoint only when it lands within `GPX_EDIT_SNAP_ADOPT_MAX_M` (80 m) of where the handle was dropped. Past that the routed path is still used, but the handle stays put and a straight connector bridges the gap — the same treatment neighbour handles already get.

This is what makes whole-world snapping possible on a host too small to build a planet graph: keep the area you run in on-prem, let the rest fall through. Both legs are optional — with only `ORS_BASE_URL` set, routing is strictly on-prem and stops at the extract boundary; with only `ORS_API_KEY`, no container is needed at all; with neither, `/api/health` reports `routing:false` and the editor degrades to freehand.

Get a free key at [openrouteservice.org/dev](https://openrouteservice.org/dev/#/signup) and set `ORS_API_KEY` in `toposcout.yaml`. **The key never reaches the browser** — that is the whole point of the proxy — and `toposcout.yaml` is gitignored, so it stays out of the repo. The free tier allows 40 directions/minute and 2000/day at the time of writing; a handle drag costs up to two calls, so `ORS_FALLBACK_RATE_PER_MIN` (default 30) caps how fast a burst of editing outside the extract can spend that quota. Note that coordinates sent to the public API leave your network.

**1. Create the data directories and download an OSM extract.** Build time, RAM and disk all scale with the `.pbf`, and the local instance only needs to cover where you edit most — anything outside it falls through to the public API (see [Two upstreams](#two-upstreams) below). From [Geofabrik](https://download.geofabrik.de/):

```bash
sudo mkdir -p /share/www/openrouteservice/{config,files,graphs,elevation_cache,logs}
sudo wget -O /share/www/openrouteservice/files/sweden-latest.osm.pbf \
    https://download.geofabrik.de/europe/sweden-latest.osm.pbf
```

**2. Install the config.** ORS v9 reads it from `/home/ors/config/ors-config.yml`, not the v7-era root location.

```bash
sudo cp ors/ors-config.yml /share/www/openrouteservice/config/ors-config.yml
# Only if you downloaded something other than sweden-latest.osm.pbf.
# sudo sed -i 's#sweden-latest.osm.pbf#region-latest.osm.pbf#' \
#     /share/www/openrouteservice/config/ors-config.yml
# The image runs as uid/gid 1000; without this ORS cannot write graphs or the elevation cache.
sudo chown -R 1000:1000 /share/www/openrouteservice
```

**3. Size the JVM.** Set `XMX` in `ors/openrouteservice.yaml` from the `.pbf` size, and give the host at least `XMX` + 6 GB — the graph build holds its index in heap, and `graphs_data_access: MMAP` pages graphs off disk at query time, so the OS still needs page cache.

Only the Sweden row is measured (16 GB host, `XMX 10g`, the two profiles above); the rest are scaled from it and are rough. Contraction is superlinear in graph size, so the large rows are the least trustworthy:

| Extract | `.pbf` size | `XMX` | Host RAM | Graph build (2 profiles) | Disk (graphs) |
|---|---|---|---|---|---|
| Single region (Västra Götaland) | ~120 MB | `6g` | 8 GB | ~5 min | ~2–4 GB |
| Small country (Denmark, Switzerland) | ~400 MB | `8g` | 16 GB | ~10–15 min | ~5–8 GB |
| **Sweden / Norway** | **~700 MB–1 GB** | **`10g`** | **16 GB** | **~20 min** (measured) | **~10–17 GB** |
| Germany / France | ~4 GB | `28g`+ | 48 GB+ | ~2–4 h | ~40 GB+ |
| Europe | ~28 GB | `96g`+ | 128 GB+ | ~12–24 h | ~150 GB+ |
| Whole planet | ~80 GB | `200g`+ | 256 GB+ | 1–3 days | ~300 GB+ |

The elevation cache adds roughly 1 GB per 10°×10° SRTM tile touched; a few GB for a country.

**The ceiling is memory, not time.** A country extract builds in minutes, so it is tempting to read the planet row as "just leave it overnight" — but the import holds its node index in heap, and an undersized heap does not fail fast: it thrashes and then OOMs, losing the whole build however long you waited. On a 16 GB host a country extract is the limit regardless of patience; use the public-API fallback for everything beyond it rather than trimming `XMX`.


**4. First build.** Set `REBUILD_GRAPHS: "True"`, then:

```bash
docker compose -f ors/openrouteservice.yaml up -d
docker logs -f openrouteservice
```

Watch for one `Building graph ...` block per profile, then `Started Application in … seconds`. The first start also downloads SRTM tiles into `elevation_cache` — normal and one-off. A country extract finishes in minutes, but the healthcheck's `start_period` in `openrouteservice.yaml` must still cover the whole build or Docker restarts the container partway through and you start over; use `nohup`/`tmux` for anything larger than a country.

**5. Turn the rebuild off.** Set `REBUILD_GRAPHS: "False"` and bring it up again. Subsequent restarts then load the prebuilt graphs in seconds. Forgetting this is the most common ORS operational mistake — every restart would otherwise rebuild from scratch.

**6. Verify from inside the network**, the way the backend reaches it:

```bash
docker exec toposcout python - <<'PY'
import requests
print(requests.get("http://ors-app:8082/ors/v2/health", timeout=10).text)
r = requests.post("http://ors-app:8082/ors/v2/directions/foot-hiking/geojson",
    json={"coordinates": [[12.0918, 57.8113], [12.1000, 57.8150]],
          "elevation": True, "instructions": False, "radiuses": [50, 50]}, timeout=30)
print(r.status_code, r.json()["features"][0]["geometry"]["coordinates"][:3])
PY
```

Expect `{"status":"ready"}` and **3-element** `[lon, lat, ele]` coordinates. Two-element coordinates mean the elevation config in step 2 did not take effect — routed points would land in the GPX with no `<ele>` and flatline the elevation profile.

**7. Wire it into the app.** `toposcout.yaml` already sets `ORS_BASE_URL=http://ors-app:8082/ors` on the `gpx-editor` service, plus an empty `ORS_API_KEY` for the public fallback — paste your key there to enable it. Recreate the container (`up -d`, not `restart`, or the environment is reused) and confirm:

```bash
curl -s http://localhost:8003/api/health   # -> {"status":"ok","routing":true}
```

**8. Refreshing map data.** Replace the `.pbf`, set `REBUILD_GRAPHS: "True"`, restart, wait for the build, then set it back to `"False"`. The local instance is unavailable for the whole rebuild; with `ORS_API_KEY` set, snapping keeps working through the public fallback in the meantime, otherwise the editor degrades to freehand.

Both services join the pre-existing external `immich_default` network. Docker's embedded DNS resolves container aliases within a user-defined network, and the explicit `aliases: [ors-app]` guarantees the name regardless of compose project prefixing, so `http://ors-app:8082/ors` resolves from `gpx-editor` without publishing any port.

Backend environment variables: `ORS_BASE_URL` (on-prem instance), `ORS_API_KEY` (enables the public fallback), `ORS_FALLBACK_URL` (default `https://api.heigit.org/openrouteservice`), `ORS_FALLBACK_RATE_PER_MIN` (default 30), `ORS_RADIUS_ESCALATION_M` (default `300`), `ORS_MAX_RADIUS_M` (default 2000), `ORS_LOCAL_MISS_TTL_SECONDS` (default 600), `ORS_TIMEOUT_SECONDS` (default 20), `ORS_RATE_PER_MIN` (default 120), `ORS_MAX_RESPONSE_BYTES` (default 2 MiB). With neither `ORS_BASE_URL` nor `ORS_API_KEY` set, routing is disabled.

Routing failures are logged to the container log with the upstream, radius and status — `docker logs -f toposcout` — because from the browser every failure looks identical: the editor just draws a straight line.

## Progressive Web App Notes

- The app can be installed on mobile and desktop.
- A service worker caches the core app shell for faster repeat visits.
- When shipping a new release, bump both the displayed app version and the cache name so clients refresh cleanly.
- "Works offline" means the **installed** app, served over http/https and backed by the service worker. Opening `index.html` straight from disk (a `file://` URL) is **not supported**: MapLibre GL JS 6 is ESM-only, so the app loads it through a module script, and browsers block module fetches from `file://` (null origin). The app detects this and says so instead of showing a blank page. To run from a local checkout, serve the folder over http — the `uvicorn` command under [Optional Backend](#optional-backend-gpx-upload-and-sharing), or any static server (`python -m http.server 8000`, `npx serve`).

## Repository Layout

- `index.html` - application shell and modal markup
- `script.js` - map adapter, terrain analysis, GPX overlay, elevation profile, localization, and app logic
- `style.css` - control panel, modal, and map styling
- `service-worker.js` - offline asset caching
- `manifest.json` - PWA metadata
- `lang/en.js` - English strings
- `lang/sv.js` - Swedish strings
- `vendor/jspdf.umd.min.js` - vendored jsPDF library for Print map PDF export (precached for offline use)
- `fonts/` - self-hosted, same-origin glyph sets for contour labels (`noto-sans-regular`, `open-sans-regular`)
- `icon.svg` - app icon source
- `icon-set.html` - helper page for generating the app icon set
- `main.py` - optional FastAPI backend for GPX upload/list/delete/share/rename
- `requirements.txt` - Python dependencies for the optional backend
- `Dockerfile` - container image for the optional backend
- `ors/openrouteservice.yaml` - compose file for the self-hosted openrouteservice used by track editing
- `ors/ors-config.yml` - openrouteservice configuration (profiles, elevation, source extract)
- `gpx-files/` - uploaded GPX storage (created at runtime; git-ignored)
- `tests/` - self-contained Playwright end-to-end suite: specs, `playwright.config.ts`, its own `package.json`, and `static-server.mjs` (serves the repo root over http, since the app cannot boot from `file://`). Run it with `cd tests && npm ci && npm test`; report and results land in `tests/playwright-report/` and `tests/test-results/`.

## Changelog

- **v2.24.0:** The blue elevation box became a **data box** holding every live readout in the panel. Elevation keeps the 24 px hero slot; **Zoom** and **Scale** sit beside it as tiles behind thin dividers, and the optional **distance to GPS** and **coordinates** share a divided line below. This replaces the separate readout row added in 2.23.1, which left the panel with two competing surfaces — a bare unlabelled monospace line floating on the panel background, and under it a bordered box that existed to hold one number. Blue is kept but re-read: it now means *live data* rather than *elevation*. The footer line carries no word labels at all — a pin glyph stands in for "Center to GPS" and a coordinate pair introduces itself — which is also what keeps that line inside the box in Swedish, where `Centrum till GPS` and `Koordinater` were the two longest strings in the panel. Height tracks what you have switched on: the dividers are a CSS sibling rule so they appear and vanish with the tiles themselves, the footer line hides when both its items are off, and with every readout disabled the box collapses to exactly the elevation box it replaced. In the shipping default (Zoom only) it is 3 px *shorter* than 2.23.1, because the tile sits beside the elevation rather than on its own line. Two things fell out of the restructure. The box is no longer hidden below 600 px, so phones get Zoom, Scale and coordinates for the first time — and `updateCenterElevation()` no longer mirrors the elevation into the status line there, a workaround that existed only because the box was hidden, which means the mobile status line is finally free for status. And because each readout is now a wrapper with its label written once by the translation pass and only its value rewritten on pan, the hardcoded English `'Zoom: '` prefix is gone; the zoom label is translated like every other label in the panel.
- **v2.23.1:** GUI consistency pass on the two things v2.23.0 left mismatched. The **Route info** panel now wears the control panel's glass — `rgba(255,255,255,0.5)` with a 5 px backdrop blur, a 12 px radius and the panel's shadow, in place of the near-opaque 94% card it shipped as — so the two cards flanking the map read as one system instead of two. Its minimize control changed with it: the bordered chevron that rotated on collapse is now the same borderless **+**/**−** button the control panel and every section header use, reusing the existing `.toggle-btn` rules rather than duplicating them. The phone sheet deliberately stays near-opaque, since a full-bleed sheet is read against whatever tile happens to be under it. Second, the optional **Zoom**, **Scale**, **Center to GPS** and **Coordinates** readouts moved out of the footer. They had been a right-hand column sharing `.footer-row` with the status text, and with all four enabled they took roughly a third of the panel's width and stood four rows tall, so anything longer than a few words wrapped — on a phone that is worse still, because the status line doubles as the elevation readout there. They are now a single right-aligned line under the header buttons, which keeps them on the edge they already occupied (flush left they would have read as a subtitle to the app name) and hands the status bar the full width. The row hides itself when every readout is switched off, so the header sits straight on the elevation box rather than over an empty gap, and it stays outside `#controls-content` exactly as the footer was — still visible with the panel minimized, and tap-to-copy on the coordinates still works.
- **v2.23.0:** Moved the route metrics and the track-edit actions out of the control panel into a new **route panel** that floats over the map. On desktop it is a card in the map's top-left; under 600 px it becomes a collapsible bottom sheet stacked directly above the elevation profile, minimizing to a header strip the same way that bar does. It carries **Length**, **Elevation Gain/Loss** and **Min/Max Elevation** plus **Undo**, **Redo**, **Save** and **Cancel**, and it is headed with the loaded track's name — *Route info (UTMB_2025)* — so the panel says which route it is describing. The two layouts diverge deliberately: desktop has the vertical room, so it stacks every stat on its own line with full labels, while the phone sheet keeps one non-wrapping line of abbreviations and promotes the distance up into the header beside the name, which is what keeps a 172 km track's figures on screen without growing the sheet. A long name shrinks the header text down to a 9 px floor before the name (and only the name) ellipsizes, so the distance stays readable. It is read-only when you are simply viewing a loaded track — the four edit buttons appear only while editing, instead of sitting there dead. This fixes the awkwardness the track editor shipped with: on a phone the control panel is a full-width sheet, so reaching Save meant covering the track you were shaping, and Create Route's workaround of folding the panel away on entry then springing it back open on exit buried the route the moment you finished drawing it. That re-open is gone; the panel now stays out of the way, because nothing editing needs is left inside it. Under the hood both bottom panels moved into one `#bottom-dock` flex column, so the browser stacks them and a single `ResizeObserver` reports their combined height to the code that keeps the zoom controls, attribution and slider stack clear of the bottom edge — previously that measured the elevation bar alone, and anything stacked above it would have been overlapped. The dock also carries `env(safe-area-inset-bottom)`, which the elevation bar never had, so a collapsed bar no longer sits under the home indicator on a notched phone. The stats are now chips that wrap horizontally rather than five stacked rows, since vertical space is what a bottom sheet is short of, and disabled Undo/Redo finally have an explicit style instead of relying on the browser's default greying, which was near-invisible on the panel's translucent background. Print map hides the panel while it is open, since both want the same corner. Two fixes to the editor itself came along with it: the **Start/End labels are hidden while editing**, because the drag path deliberately skips `rebuildGpxMarkers()` for performance and they were therefore left marking where the track *used* to begin and end — sitting on top of the very handles you were reaching for — and the **end handle is now red** where the start stays green, so the two ends of a track are no longer identical green rings.
- **v2.22.1:** Fixed the **GPS button** recentering the map twice. `locateUser()` centered on the coarse first fix from `getCurrentPosition`, then centered again whenever the accuracy ring was removed because a later `watchPosition` update tightened to pinpoint accuracy (≤ 5 m) — and would repeat this on every subsequent tighten if accuracy degraded and recovered, even after the user had panned away. A single `gpsHasCentered` flag now gates centering to the first fix of a tracking session; the marker and accuracy ring keep updating live as before.
- **v2.22.0:** Added **Create Route** — drawing a route from scratch instead of importing one. A new button between **Load GPX Route** and **Add POI** enters a placement mode: click a start point, click an end point, and the app builds the track between them and hands it straight to the v2.21.0 track editor, seeded with the usual start/midpoint/end handles so the next thing you do is shape it. The geometry is deliberately made the same way an edit is — the same `/api/route/{profile}` proxy, the same 150 m drift rejection (a route whose snapped endpoints land far from where you clicked is discarded in favour of a straight line rather than detouring to a valley road), the same 80 m adopt threshold for pulling an endpoint onto the path, and the same ~50 m densified straight line with DEM-sampled elevations when snapping is off or routing fails — so the first drag after creating a route behaves exactly like every drag after it. The routing profile and **Snap to roads/paths** toggle are now a **single shared setting** between the create panel and the editor, which also fixes the old annoyance of Edit track resetting to Running/Walking every time it opened. Nothing is committed until the second click resolves: Cancel and Esc work throughout, including mid-request (the backend can spend the better part of a minute retrying two upstreams at two radii), and a late response is discarded rather than dropped on top of whatever you did instead. Guards run before any network call — a second click within the editor's click tolerance of the first is refused as "that is the start point" (which also absorbs the two `click` events a browser reports for one double-click-to-zoom, alongside a `detail > 1` check), and a pair more than 100 km apart is refused outright rather than left to 502 and then densify a continent-spanning straight line through 200 DEM lookups. Creating a route replaces the loaded one — the app holds a single track by design — so it asks first, before you start clicking rather than after. The result is an ordinary in-memory route: it is serialized to GPX immediately, so **Download GPX** works right away and **Save** skips the "this rewrite loses your file's extras" warning, since there was never a file. On a phone the control panel folds away on entry (as the POI modal already does) and unfolds on exit, with the step prompt in the status line, which stays visible while minimized. Without the routing backend the feature still works, as a straight editable line with the snap toggle disabled.
- **v2.21.0:** Added **Edit track** — reshaping an already-loaded GPX route in the browser. Clicking **Edit** (between Clear Route and Download GPX) seeds three draggable handles on the track — start, midpoint and end — and drops an editing panel below the button row with a routing-profile picker, a **Snap to route** toggle, and Undo / Redo / Save / Cancel. Clicking the track adds a handle at that spot (rejected beyond ~18 px of the line, measured in meters from the live map scale); right-clicking or long-pressing one removes it, never below three and never an endpoint. Dragging a handle shows a dashed rubber band and, on release, re-routes the two sub-segments either side of it. With snapping on, each sub-segment is fetched from **openrouteservice** — an on-prem instance for the local extract, falling back to the public API elsewhere; `foot-walking` for running by default, plus `cycling-mountain` and the dragged handle adopts the routed position; with it off — or when routing fails — the leg becomes a straight line densified at ~50 m with elevations sampled from the existing DEM tiles, so gain/loss, the elevation profile and slope colouring keep working across hand-drawn stretches. ORS is reached **only** through a new `/api/route/{profile}` proxy in the backend (profile allowlist, two-coordinate validation, clamped snap radius, rate limit, upstream body built server-side), so the browser never talks to it: no published port, no CORS, no CSP change, and `/api/health` now reports `routing` so the frontend disables the snap toggle up front instead of discovering the absence through a failed drag — on static hosting the editor simply becomes freehand. Internally the working geometry is installed straight into `gpxTrackData.segments`, so the existing draw path renders edits live; every handle indexes a real track point, and a single splice primitive is the only thing that changes point counts and handle indices. Undo/redo keeps full geometry snapshots (capped at 20 and 400k points) and rebuilds handle markers from indices. Saving required a **GPX 1.1 serializer** — until now Download GPX re-emitted the bytes of the loaded file, which after an edit no longer matched what was on screen; it warns once per session that the rewrite drops per-point timestamps, sensor extensions and other extras the parser never kept, and it drops the `?gpx=` share link since the stored copy is still the original. Multi-segment tracks are edited on their longest segment with the rest untouched and exported verbatim. Slope colouring is paused during editing (it emits one map feature per vertex pair) and restored on exit; POI placement and Manual mode refuse to start mid-edit rather than silently discarding unsaved work, and Esc cancels with a confirm. See [Self-Hosted Routing](#self-hosted-routing-openrouteservice) for the ORS install.
- **v2.20.0:** The search box now accepts **four more coordinate formats** on top of plain decimal degrees. **DMS** — `57° 44' 24.0", 12° 06' 36.0"` — and **DDM** — `57° 44.400', 12° 06.600'` — are parsed with the degree mark optional, all the Unicode prime/quote variants accepted (`′ ″ ’ ” ´`, plus `''` for seconds), hemisphere letters allowed before or after the number, and the Swedish/Nordic `Ö`/`Ø`/`O` (öst) and `V` (väst) understood alongside `N/S/E/W`; if the letters say the first value is a longitude, the axes are swapped, so `12°06'36"E, 57°44'24"N` lands in the same place as `57°44'24"N, 12°06'36"E`. Decimal degrees may now be written with a **decimal comma** — `57,8112660, 12,0918247` — with the pair separated by a comma+space, a plain space, or nothing at all; the legacy reading of a two-number `57,81` as *latitude 57, longitude 81* is deliberately preserved, and genuinely ambiguous input like `57,811,12` is rejected rather than guessed at. Finally, **Plus Codes (Open Location Code)** are decoded locally: a full code (`9C3XGV4C+X9`) resolves offline, and a short code resolves against a reference point — the locality that follows it (`R36R+GP4 Göteborg`, geocoded through the same Nominatim endpoint the search box already used) or, with no locality given, the current map view. All of this applies to the search box only; share links, the coordinate readout and the PDF export are untouched. Every parser validates strictly — latitude ±90, longitude ±180, minutes and seconds under 60 — and returns *nothing* rather than a guess, so anything unrecognised still falls through to the place-name search exactly as before (`E6` and `Malmö` remain place lookups). A recognised coordinate now zooms to **level 15** instead of 12, since a 2.5 m Plus Code cell is invisible at ~38 m/px; coarse input and place-name results keep the old zoom 12. Also fixed: a failed search used to leave the status bar stuck on "Searching…" forever when the network was down — it now reports the error.
- **v2.19.2:** Updated the vendored map engine from **MapLibre GL JS 6.2.0 to 6.3.0** — a drop-in patch of the four self-hosted `vendor/maplibre-gl*` dist files (`.mjs`, `-shared.mjs`, `-worker.mjs`, `.css`), taken verbatim from the npm package as before. No app code changed: the CSS class names are byte-for-byte the same set (the stylesheet grew ~13 kB purely because the inline SVG control icons are now fully percent-encoded), the ESM loading path through `maplibre-boot.mjs` is unchanged, and nothing the app calls was touched. Two upstream fixes land directly on features this app uses: **terrain gestures are now solved against the elevation under the pointer** instead of the frozen center elevation, so panning and zooming in 3D/tilt mode no longer drifts off the point you grabbed; and **`ImageSource` no longer leaks a GPU texture on every image update and on removal** (a resized texture also keeps its wrap and filter settings), which matters for the slope map — the Leaflet-compat shim's `_renderOverlay` removes and re-adds the image layer on every opacity-slider tick, so each drag used to strand a texture. Also fixed upstream: globe scroll/pinch zoom drifting away from the pointer when the globe is small, projective rendering of non-parallelogram image quads, and an "Out of bounds" race in `queryRenderedFeatures()` (unused here). Requirements are unchanged from v2.17.0 — WebGL2, and served over http/https.
- **v2.19.1:** Opening `index.html` directly from disk (a `file://` URL) has shown a **blank page** since the v2.17.0 MapLibre 6 upgrade. MapLibre 6 is ESM-only, so the library is loaded through the `maplibre-boot.mjs` **module** script — and module scripts are CORS-fetched, which browsers refuse for a `file://` page (null origin: *"Cross origin requests are only supported for protocol schemes: chrome, data, http, https"*). `maplibregl` was therefore never published to the global scope and the first top-level `L.map('map', …)` threw `maplibregl is not defined`, aborting the rest of `script.js` with nothing on screen. The v5 UMD bundle was a classic script (not CORS-fetched) that inlined its worker as a blob, which is why this used to work. Restoring it is not practical — from a `file://` page a browser also blocks *module* workers from blob URLs and *any* worker loaded from a `file://` URL, so v6 would need both a classic main script and a classic blob worker, and `maplibre-gl@6.2.0` publishes no UMD/CJS build. So `file://` stays unsupported, but it now **fails loudly**: a guard in front of the map construction renders a localized explanation over the map container (English and Swedish, inserted with `textContent`) naming the fix — serve the folder over http. The installed-PWA offline mode is unaffected; it runs over http/https with the service worker.
- **v2.19.0:** **Google sign-in now persists.** Since v2.15.2 the Google ID token has been kept in memory only (an anti-XSS measure), which left Google One Tap as the sole way to restore a session on load — and under FedCM / third-party-cookie restrictions One Tap is routinely suppressed, so a reload, PWA relaunch, or the service worker's `controllerchange` reload silently signed the user out. ID tokens also expire after ~1 h, so even a long-lived tab depended on the same flaky silent re-auth. On a verified sign-in the backend now issues its own **HMAC-SHA256-signed, HttpOnly session cookie** (`elevf_session`, `SameSite=Lax`, `Secure` by default) valid for **90 days with a sliding expiry** — re-issued whenever a session passes the halfway mark, so a regularly used browser is never signed out while an abandoned one still ages out (`GPX_SESSION_MAX_AGE_DAYS`). The cookie is a stateless `v1.<payload>.<sig>` token verified with `hmac.compare_digest`; its signing key comes from `GPX_SESSION_SECRET` or is generated once into `.session-secret` in the **writable upload volume** (the app directory is mounted read-only), so container restarts no longer sign everyone out. Owner resolution gained `resolve_account_owner()` — a fresh Google bearer token first, the session cookie second — which `ensure_owner_id`, `require_owner_id` and the account-scoped `require_google_owner_id` (POIs) now use; `/api/auth/login` returns `session_exp` alongside the profile, and two endpoints join it: `GET /api/auth/session` (reports and slides the session; never 401s, and actively expires a tampered or stale cookie) and `POST /api/auth/logout` (clears the session cookie only, leaving the anonymous `elevf_owner` cookie intact so pre-sign-in uploads stay reachable). No credential is exposed to JavaScript at any point — this is strictly safer than the pre-v2.15.2 `localStorage` token. Client-side, `googleAuth` gained a `source` field (`'token'` vs `'session'`): `initGoogleAuth()` is now async and restores the server session **before** waiting on the Google script, so a returning user is signed in immediately even when `accounts.google.com` is slow or blocked, and One Tap only fires when there is no session to restore; after `/api/auth/login` the identity is handed over to the cookie, so the ID token's 1 h life stops mattering and the pre-expiry refresh timer is dropped. Two related sign-out bugs are fixed: `clearGoogleAuthState()` is now **soft by default** — the three automatic 401 paths no longer wipe the `topo_google_seen` flag or call `disableAutoSelect()`, so a single transient backend 401 can no longer permanently disable silent re-auth on that device (only an explicit Sign out does, via `{ forget: true }`, which also ends the server session) — and the backend health probe's 1500 ms timeout, which on a slow first load hid the entire sign-in UI for the session, is raised to 4000 ms with one automatic retry.
- **v2.18.0:** Added an **OSM Path layer** route overlay — OpenStreetMap paths and trails rendered from a Mapbox raster style. Because the Mapbox tile URL carries an `access_token`, the layer is served through the **existing Cloudflare worker** rather than fetched directly: `worker.js` — until now a single-upstream Lantmäteriet proxy that parsed its path positionally as `/{z}/{x}/{y}` — now recognises a named `/osmpaths/` prefix and shifts the coordinate segments accordingly, so the original URL shape keeps working byte-for-byte for deployed clients and already-cached tiles. The worker appends the token and the `@2x` suffix server-side, and the client only ever sees `lm.clackspark.workers.dev/osmpaths/{z}/{x}/{y}`. The upstream request differs per route: the Lantmäteriet branch keeps spoofing `Referer: minkarta.lantmateriet.se`, while the Mapbox branch **forwards the page's own (already validated) Referer**, so a URL-restricted Mapbox token still authorises through the proxy. Edge caching for the Mapbox branch uses `cacheTtlByStatus` instead of a flat `cacheTtl` so an error response (e.g. a `401` from a bad token) can't be pinned in Cloudflare's cache for a week, and the browser `Cache-Control` header is now conditional on `imageResponse.ok` for both routes. The tile-bounds check gained a per-route zoom cap (22 for Mapbox, the previous 20 for Lantmäteriet). Client-side the change is a single `OVERLAY_SOURCES` entry plus a dropdown `<option>`: the overlay is deliberately left out of `OVERLAY_WMT_ACTIVITY`, so `handleExtraLayerChange` takes the non-Waymarkedtrails branch (no "Routes in view" legend, an isolated trail is preserved and re-lifted) exactly as the Strava heatmap does, and share links pick the new key up for free since `&route=` is validated against `OVERLAY_SOURCES`. No service-worker or CSP change was needed — `lm.clackspark.workers.dev` is already in both allowlists, so the new tiles join the offline tile cache automatically.
- **v2.17.1:** Fixed the **GPX track being hidden underneath other map layers**. The track's `gpx-line-0` line layer was added without a `beforeId`, so it only sat on top of the style *at the moment it was added* — anything drawn afterwards covered it. The most visible case was the extra-overlay picker: selecting **Waymarkedtrails** or the **Strava heatmap** appended an opaque raster over the loaded track (`applyExtraOverlay` → `L.tileOverlay(...).addTo(map)`), but the same happened with the **slope map** (whose *opacity slider* re-added the image on every tick, since the Leaflet-compat shim's `_renderOverlay` removes and re-adds a layer to re-render it), **climb result / manual climb lines**, the **isolated trail** (`liftIsolatedTrailToTop` explicitly moved it to the very top) and the **GPS accuracy circle**. Rather than re-lifting the track from each of those call sites, the ordering is now enforced at the single choke point where overlays are inserted: a new `getGpxTopBeforeId()` helper returns `GPX_LINE_LAYER_ID` while a track is loaded (and `undefined` otherwise), and all six `addLayer` calls in `_renderOverlay` — circle fill/line, circleMarker, polyline, image and tileOverlay — pass it as `beforeId`, so every overlay slots *underneath* the track automatically, including on re-render. `liftIsolatedTrailToTop` now moves its layers to directly below the track instead of to the absolute top (casing/line relative order is unchanged), and `updateGpxTrackLine` re-raises the track with `moveLayer` on its repaint path as a safety net. A newly loaded track is still appended on top, so it also wins when an overlay was enabled first. Basemap, hillshade and contours already used a `beforeId` and are unaffected; GPX waypoint/start-end/min-max labels are DOM markers and were never subject to layer order.
- **v2.17.0:** Upgraded the map engine from **MapLibre GL JS 5.24.0 to 6.2.0**. v6 ships as **ES modules only** — the UMD bundle and the separate CSP build are gone — so the loading path changed: the vendored set under `vendor/` is now `maplibre-gl.mjs`, `maplibre-gl-shared.mjs` (imported by *both* the main bundle and the worker) and `maplibre-gl-worker.mjs`, all three precached by the service worker so the installed PWA still boots fully offline. Because `script.js` is a classic script whose API lives in global scope (`index.html` drives it from inline handlers), a small first-party ES-module shim, **`maplibre-boot.mjs`**, imports the v6 namespace, pins the worker URL and republishes it as the `maplibregl` global; module scripts and `defer` scripts share one execution queue, so it is guaranteed to run before `maplibre-contour.min.js` and `script.js`. It joins `style.css` / `script.js` / `lang/*.js` as the fifth `?v=`-stamped shell asset. The backend now registers `text/javascript` for `.mjs` explicitly (`mimetypes.add_type`, since the interpreter's table is version-dependent and the Windows registry can override it) and includes `.mjs` in `STATIC_ASSET_SUFFIXES` so the modules get the same immutable cache header as `.js`. No CSP change was needed: a self-hosted, same-origin ESM build constructs its worker directly from the URL rather than laundering it through a blob, so `worker-src 'self'` remains valid. The rest of the app needed no changes — the v5→v6 CSS class names are identical (v6 only *adds* `.maplibregl-marker-draggable`), so `style.css` and the mobile control-corner relocation are untouched; every `Map` / camera / style method and every `MapOptions` key the app passes survives; `Evented.fire(string)` still works for the synthetic `zoomend` / `moveend`; and `addProtocol`'s signature is unchanged, so **maplibre-contour 0.1.0** keeps working as a UMD classic script. v6 also adopts `zoomLevelsToOverscale: 4` by default, slicing vector tiles instead of overscaling them — MapLibre reports this fixes a range of labelling issues, and the new default is taken as-is rather than pinned back to the v5 behaviour, so the contour overlay is the part of this release worth a visual pass. Separately fixed a latent bug this migration surfaced: the off-screen **Print map** map passed `preserveDrawingBuffer: true` as a top-level option, but MapLibre groups the WebGL context attributes under `canvasContextAttributes`, so it had been silently ignored and `getCanvas()` could read an empty buffer; it is now nested correctly. **Note:** v6 removes WebGL 1 support — the map now requires a WebGL2-capable browser.
- **v2.16.0:** Mobile usability around the route legend and the control panel. On phones (≤ 600 px), showing the route-names legend no longer hides the on-map **GPS + zoom/compass controls** — `updateZoomControlVisibility()` now moves the two control groups into the **bottom-left corner** (GPS above the navigation group, same 10 px inset; MapLibre's own corner CSS provides the mirrored stacking) and moves them back when the legend is turned off or the viewport crosses the mobile breakpoint (re-checked from the shared `resize` listener, so device rotation is handled). While the controls occupy that corner the **attribution banner is temporarily hidden**; desktop behavior is unchanged (controls still hide under the legend, attribution untouched). Supporting fixes: `updateMapSliderChrome()` now hides only the attribution and slope legend via a `body.map-sliders-on` class instead of hiding the whole bottom-left corner (so the relocated controls survive the on-map opacity/exaggeration sliders), and `adjustMapControlsForElevation()` raises the `#map-slider-stack` by the measured height of the occupied corner, so sliders, relocated controls and the elevation-profile bar stack without overlapping (the measurement tracks the compass auto-hiding while north-up, re-checked on `rotateend`). Also on mobile, **tapping the minimized control panel now maximizes it** — its own controls (Share, About, the minimize toggle and the tap-to-copy coordinates readout) keep their function — mirroring the elevation profile's expand-on-tap pattern. The Control Panel tutorial step now mentions both gestures (minimize by tapping the map outside the panel, maximize by tapping the minimized panel), in English and Swedish.
- **v2.15.3:** Contour elevation label density now follows the zoom level, like the [Mapterhorn contour example](https://mapterhorn.com/examples/contour/). The `contour-labels` symbol layer's fixed major-only filter is replaced by a zoom-stepped filter (`['step', ['zoom'], ['==', ['get', 'level'], 1], 14, true]`): below native zoom 14 only major contours are labelled (as before), and from native zoom 14 — where the interval thresholds switch to 20 m / 40 ft minors — every contour line is labelled. Label spacing along each line is now zoom-interpolated via `symbol-spacing` (500 px at native z11 → 250 px at z15), and `text-size` scales from 9 px to 11 px over the same range, so labels are sparse and unobtrusive when zoomed out and progressively denser when zoomed in. Works identically in metric and imperial since the layer is rebuilt on unit change.
- **v2.15.2:** Security hardening. Fixed a DOM **cross-site scripting (XSS)** hole where a waypoint `name` from an uploaded or shared GPX file (`?gpx=` link) was rendered with `innerHTML` in the map label markers (`rebuildGpxLayer`); the six GPX label sinks (waypoint, start/end, min/max elevation) now use `textContent`, so GPX-supplied text can no longer inject markup or scripts — closing a zero-click, cross-user account-takeover path (a malicious shared link could otherwise run script in the victim's origin and exfiltrate the Google ID token from `localStorage`). Added HTTP security headers from the backend response middleware in `main.py`: an enforced `Content-Security-Policy` (`frame-ancestors 'none'`, `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`) plus a **Report-Only** resource allowlist (mirroring the service-worker tile hosts) staged for enforcement once the app's inline event handlers are refactored, together with `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, and `X-Frame-Options: DENY` on HTML documents. The anonymous owner session cookie (`elevf_owner`) is now marked **`Secure`** by default (overridable with `GPX_COOKIE_SECURE=false` for plain-HTTP local development). The Google ID token is no longer written to `localStorage` — it is kept **in memory only** and returning users are re-authenticated silently via Google One Tap on load, so a future injection cannot read it from storage (any token an older build persisted is proactively cleared). On the backend: GPX uploads are parsed with **`defusedxml`** (rejecting entity-expansion / XXE / DTD attacks); each owner has a **file-count and total-byte quota** (`GPX_MAX_FILES_PER_OWNER` / `GPX_MAX_BYTES_PER_OWNER`) so an anonymous cookie can't fill the disk; `/api/upload` and `/api/auth/login` are **rate-limited per client IP**; the diagnostic `/api/auth/debug` route is **disabled by default** (enable with `GPX_DEBUG_ENDPOINTS=true`); and the reverse-proxy trust list is now configurable via `FORWARDED_ALLOW_IPS` so `--forwarded-allow-ips` can be narrowed from `*` to the proxy's address.
- **v2.15.1:** Reliability, performance and offline improvements to terrain analysis. The **Scan / Climb / Slope** buttons no longer get stuck disabled after a failed elevation-tile load (offline or no-data areas) — `updateCenterElevation` re-enables them in a `finally`, a run-id guard prevents a slow older lookup from clobbering a newer result, and the three analysis entry points share an `analysisInProgress` lock and always release through `finishAnalysisRun` (including on mobile and when the analysis throws). The on-thread scan loops are substantially faster: a new `buildRadiusLookup` replaces the per-pixel Mercator unproject + haversine radius check in `findPeaks`, `calculateMaxClimb` and `_renderSlopeMap` with precomputed per-row/per-column tables (mathematically identical results — zero inclusion mismatches, distances agree to ~1 nm), `getClimbStepMeters()` is read once per run instead of in the innermost loop, result coordinates/distances are computed only for the ranked winners, and analysis DEM tiles reuse the shared `loadElevationTile` LRU cache. **MapLibre GL 5.24.0** (JS + CSS) and **maplibre-contour 0.1.0** are now **vendored under `vendor/`** (byte-identical to the unpkg copies) and precached by the service worker, so the installed PWA boots **fully offline** (previously it failed without unpkg); the unpkg preconnect hints were removed. Also removed dead code (`_shadowUrl` / shadow icon options, the unused `gpxLayer` and the `gpx-line-{i}` removal loop), extracted `terrariumToMeters()` to replace eight copy-pasted decode expressions, and corrected the stale Build fallback in the About modal. Separately fixed **`_renderSlopeMap`** so the slope cell size uses `metersPerPixelAtZoom` rather than `metersPerPixelAtZoom / 2`, correcting computed slope values.
- **v2.15.0:** Added a third optional footer readout beneath **Zoom**: **Coordinates**, the WGS84 latitude/longitude of the map center/crosshair, formatted as decimal degrees (`lat, lng` to 5 decimals). It is toggled by a new **Show coordinates** checkbox under Advanced settings (`showCoords`, persisted as `topo_show_coords`, default off) and honored by `updateUI()` via `isCoordsShown()`, reusing the same show/hide pattern as the Scale and Center-to-GPS readouts. Tapping the readout copies `lat, lng` to the clipboard through the existing `copyTextToClipboard()` helper (robust `execCommand` fallback + status confirmation). New `coords_label` / `coords_copy_hint` plus `lbl_show_coords` / `tip_show_coords` / `status_coords_copied` strings are localized in English and Swedish.
- **v2.14.0:** Added a **Print map** mode that exports the framed map area to a print-ready **PDF**. It is launched **on desktop** by clicking the app logo in the Control Panel header (the app title is not a trigger; not offered on mobile, where the modal has no room). A framing "window" is drawn over the live map (the area outside is shadowed out) so you can pan/zoom to frame the area, and a compact left-aligned settings panel offers **A4 / A3 / A2**, **portrait / landscape**, a **coordinate-system selector** (**WGS 84** default, or **SWEREF 99**), and independent toggles for the **scale ruler**, **map source**, **coordinates**, **north arrow** and **map border** (border off by default). On **Generate PDF**, a dedicated off-screen MapLibre map is created with `preserveDrawingBuffer: true` (the main map is not, so its WebGL canvas can't be read) by cloning the live style — capturing the base layer, hillshade, contours, route overlays and the GPX track line automatically at ~200 DPI; DOM markers (POI pins, analysis result pins, GPX labels/waypoints) are composited on top by projecting their coordinates onto the print canvas. `jsPDF` (vendored locally at `vendor/jspdf.umd.min.js` and precached for offline use) assembles the page: the scale is drawn **next to the scale ruler** as `1:X · <CRS>` with the map **source** following it (all bottom-left, just below the map at the same tight gap as the coordinates); a north arrow (rendered from an SVG, rotated to true north) sits top-left inside the map and a small **TopoScout.org** stamp top-right; and corner coordinates print at the **upper-left and lower-right corners** just outside the map (compact font, tight gap), each with **N (northing/latitude) horizontal** and **E (easting/longitude) vertical** (rotated 90°), formatted per the chosen coordinate system (`wgs84ToSweref99tm()` Gauss-conformal conversion for the SWEREF grid). `getPrintLayout()` computes per-side margins from the enabled options, so disabling an annotation **reclaims its margin for the map** (all off ≈ full-page map), and the on-map framing window's aspect updates live as options change. New `print_*` strings are localized in English and Swedish.
- **v2.13.1:** Fixed an ordinary refresh sometimes loading an **older build** than the one deployed — in any browser, not just the installed PWA (desktop merely hid it behind Ctrl+F5). The service worker matched same-origin subresources with `ignoreSearch: true`, which strips the `?v=<build>` stamp, so `script.js?v=<new>` resolved to the cached query-less `./script.js` of whatever cache generation controlled the page; a network-first (fresh) `index.html` was stitched to a stale cached `script.js`, and since the About modal's build number lives in `script.js` (`BUILD_NUMBER`), it read the old build. The four version-stamped shell assets (`style.css`, `script.js`, `lang/en.js`, `lang/sv.js`) are now precached under their `?v=` key (derived from `CACHE_NAME`) and matched **search-sensitively**, so a new build's URL misses the old cache and falls through to the network while offline still hits; `ignoreSearch` is kept only for the navigation fallback (`caches.match('./index.html', …)`, which may carry `?app-refresh=`). Install now precaches per-asset via `Promise.allSettled` instead of the all-or-nothing `cache.addAll`, so a single failed fetch can no longer abort the install and strand users on the previous worker. No backend change — `main.py` already serves and caches `?v=` URLs correctly.
- **v2.13.0:** Added two live readouts to the footer, stacked beneath the existing **Zoom** value. **Scale** shows the current map scale (e.g. `1:50 000`): `computeScaleDenominator()` measures the ground distance across 100 CSS pixels at the map center (via two `map._map.unproject()` points and `haversineDistance()`), divides by the OGC standard pixel size (0.28 mm), and `niceScaleDenominator()` snaps the result to a readable round value formatted as `1:X` with space thousands separators. **Center to GPS** shows the straight-line distance from the live GPS fix to the map crosshair (center); a new `lastGpsPosition` is captured in `updateGpsMarker()` and cleared in `stopGpsTracking()`, and `updateUI()` (already run on pan/zoom) reuses `formatDistance()` (whole metres below 1 km, then km) and hides the row whenever GPS tracking is off. Three **Advanced settings** checkboxes (`showZoom` / `showScale` / `showCenterGps`, persisted as `topo_show_zoom` / `topo_show_scale` / `topo_show_center_gps`; Zoom defaults on, Scale and Center to GPS default off) let each footer readout be shown or hidden individually; `updateUI()` honours them via `isZoomShown()` / `isScaleShown()` / `isCenterGpsShown()`. New `scale_label` / `center_to_gps_label` plus the `lbl_show_*` / `tip_show_*` setting strings are localized in English and Swedish.
- **v2.12.0:** Added an in-app **install path for iPhone & iPad**. Because iOS/iPadOS Safari never fires `beforeinstallprompt`, the **Install as App** button (and the bottom install bar) previously never appeared on Apple devices. A new `isIOSInstallEligible()` check now shows them on non-standalone iOS/iPadOS — including iPadOS that reports as desktop `MacIntel` with touch points — and tapping either opens a new instructions modal (`#ios-install-modal`) with the manual **Share → Add to Home Screen** steps instead of the unavailable native prompt. The UI hides itself automatically once the app is already running standalone (`navigator.standalone` / `display-mode: standalone`), and the modal text is localized in English and Swedish.
- **v2.11.0:** The app now updates itself automatically — no more tapping **Update**. The service worker activates new builds immediately (`skipWaiting` + `clients.claim`), and the page checks for a waiting update whenever it returns to the foreground (key for iOS home-screen PWAs) and periodically while it stays open; when an update applies it shows a brief "Updated to v{version}" note instead of an Update prompt. Static assets are served with explicit cache-control headers so refreshes reliably pick up the newest build.
- **v2.10.0:** Added an optional **contour lines** overlay, toggled by **Enable contour line layer** under Advanced settings (persisted as `topo_contours`). Contours are generated client-side with [`maplibre-contour`](https://github.com/onthegomap/maplibre-contour) from the same Mapterhorn terrarium DEM (`tiles.mapterhorn.com`, `terrarium`, maxzoom 15) the app already uses for terrain and hillshade — no extra backend or tile provider. A `contour-source` vector source feeds a topographic-brown `contour-lines` layer (thicker major contours, a low-zoom opacity fade) inserted directly above the basemap/hillshade but below every overlay, route and marker, so it reuses the same layer-ordering pattern as the hillshade. Elevation labels along the major contours are shown by a separate `contour-labels` symbol layer, toggled by **Enable contour labels** (persisted as `topo_contour_labels`, default on); rendering them required adding a `glyphs` font source to the otherwise raster style, served from a **self-hosted, same-origin** glyph set bundled under `fonts/` (Noto Sans Regular, with Open Sans Regular also bundled to compare; precached by the service worker, so labels keep working offline with no third-party font CDN). The contour interval and the labels follow the global **Metric/Imperial** setting (metre intervals with `m` labels, or feet intervals with `'` labels), regenerating via `map.refreshContours()` when units change. The library is loaded from unpkg like MapLibre and degrades gracefully (the overlay simply no-ops) if it fails to load.
- **v2.9.0:** Added a global **Metric/Imperial** units setting in the About modal (a dropdown directly below the language selector, persisted as `topo_units`, migrating the legacy per-route `topo_distance_unit` on first load). Metric stays the canonical internal unit; a new `getUnitSystem()` drives `getDistanceUnit()`, `formatDistance()`, and a new `formatElevation()`, while `getRadiusMeters()` / `getClimbDistMeters()` / `getClimbStepMeters()` convert the numeric inputs at the boundary. Switching to Imperial shows distances in mi/ft and **all** elevations in ft everywhere — live center elevation, peak/climb popups, GPX gain/loss/min-max and the min/max markers, and the elevation-profile axes + readout — and converts the **Search Radius** (mi), **Measure Dist.** (ft) and **Climb Step Res.** (ft) input fields and their labels (with unit-appropriate min/max/step). The old per-route **Distance Unit** (km/mi) dropdown is removed in favor of this single global control. Also polished in this release: result popups raise their `maxWidth` so long (4-digit) values size the box to fit instead of crowding the right padding, and the Add-routes-and-POIs checkboxes are arranged in a 2-column grid (3 per side).
- **v2.8.2:** Performance and fixes. The service worker now keeps a capped runtime cache (`toposcout-tiles-v1`, ~400 tiles, stale-while-revalidate) for cross-origin map/elevation tiles, so revisited areas render instantly and the map keeps working offline; the cache is version-independent and preserved across releases (the `activate` cleanup keeps both the shell cache and the tile cache). The render-blocking `<script>` tags (MapLibre, language files, `script.js`) are now `defer`red with `preconnect`/`dns-prefetch` hints for the library CDN and the elevation-tile host, the per-frame `map.on('move')` UI work is `requestAnimationFrame`-throttled, and the center/POI elevation lookups now share an LRU tile cache (`loadElevationTile`, ~64 tiles) instead of refetching a tile per call. Fixes: the popup copy-coordinates tooltip uses the active language instead of hardcoded Swedish, peak/climb popup distances honor the km/mi unit picker (via a shared `formatDistance` helper), the viewport meta no longer disables pinch-zoom (WCAG 1.4.4), the slope filter max is capped at 90°, and the `[GPX auth]` debug console logging (and its `/api/auth/debug` probe) was removed.
- **v2.8.1:** Added a **Max tilt angle** slider to Advanced settings (0–85°, persisted as `topo_max_pitch`, default 60°). It sets the map's `maxPitch` so manual pitch gestures can go beyond MapLibre's default 60° cap (up to its 85° hard limit), and the **Tilt** and **3D** buttons now ease to the chosen angle instead of a fixed 60°. While 3D is enabled, dragging the slider re-tilts the view live; the value is clamped to MapLibre's 0–85° range.
- **v2.8.0:** Added an optional **hillshade** relief layer. A **Hillshade** toggle button in the search bar (replacing the redundant GPS button there — GPS stays available via the on-map control) enables a MapLibre `hillshade` layer rendered from the existing Mapterhorn `raster-dem` source (`elevation-dem`), inserted directly above the basemap and below every overlay and marker, so route overlays, climbs, GPX tracks, and POI/GPS markers are unaffected and the basemap stays beneath it across layer switches. An optional on-map opacity slider — shown by **Enable Hillshade opacity slider** under Advanced settings — adjusts the relief strength via `hillshade-exaggeration` (0–100%) live. The on/off state (`topo_hillshade`), slider visibility (`topo_hillshade_slider`), and strength (`topo_hillshade_opacity`) persist in `localStorage`, and the layer reuses the shared DEM source so 3D terrain keeps working alongside it. The 3D terrain exaggeration is now adjusted with the same kind of on-map slider (enabled via **Enable 3D exaggeration slider**, persisted as `topo_3d_exaggeration`), and the Advanced settings are sorted alphabetically.
- **v2.7.4:** The UI now defaults to Swedish automatically when the browser/device language is Swedish (detected from `navigator.languages`/`navigator.language`). Detection re-runs on every visit until the user picks a language manually from the menu, which sets a `topo_lang_chosen` flag in `localStorage` that pins their choice. An explicit `?lang=` URL parameter still takes precedence over both.
- **v2.7.3:** Added a dynamic accuracy ring around the live GPS marker. The shaded blue ring is sized to the reported margin of error (`pos.coords.accuracy`): it shrinks as the fix tightens and disappears entirely for a pinpoint fix (accuracy of 5 m or better). The rendered radius is capped at 1 km so a coarse "Approximate Location" fix doesn't swamp the map. The ring reuses the existing meter-radius circle primitive and is removed when GPS tracking is toggled off.
- **v2.7.2:** Points of Interest now persist on your device. The most recently synced POIs are cached in `localStorage`, so their pins stay visible on the map after you sign out of Google or reload the page. Signing in re-syncs and overwrites the cache; creating, editing, moving, and deleting POIs still require a signed-in Google account through the backend (`/api/pois`). Also fixed the copy-coordinates button in popups, whose clipboard icon had been corrupted into stray text.
- **v2.7.1:** Made the in-app **Refresh app** button and automatic updates refresh reliably on mobile browsers and the home-screen (PWA) app. The service worker now caches updated files with `cache: 'reload'` so a new release never re-caches stale copies from the browser HTTP cache, and the local scripts/styles are version-stamped (`?v=`) so a refresh can no longer be served stale assets. The service worker matches requests with `ignoreSearch` so the stamped URLs still resolve to their cached entries (offline still works).
- **v2.7.0:** Added saved **Points of Interest (POIs)**. Sign in with Google, then tap the map to drop a colored **star** pin and give it a name, a description (URLs become clickable links), and a color. POI pins show the point's elevation and a copy-coordinates button, and can be opened (recenters the map), **moved**, edited, or deleted. POIs are stored per Google account through the optional backend (`/api/pois`) and load automatically on every device while you're signed in.
- **v2.6.2:** Renamed the app to **TopoScout**.
- **v2.6.1:** Made the "new version available" update prompt far more reliable for the iOS home-screen (PWA) app. The app now re-checks for updates when it's reopened or brought back to the foreground (not only on a cold start), surfaces an update that finished downloading in a previous session (previously it could sit unprompted until the browser's automatic ~24h check), and registers the service worker with `updateViaCache: 'none'` so the worker script is always fetched fresh. Also removed a stray reload on first launch and hardened the worker's message handler.
- **v2.6:** Added a **Strava Global Heatmap** to the Route Overlay dropdown. Tiles are served privately through the optional backend (`/api/heatmap/...`).
- **v2.5.1:** Moved the language switcher from the header into the About menu as a **Select Language** dropdown and removed the flag icons. Placed the **Install as App** button beside **Refresh app**, and put the GitHub Project and droidgren.github.io links on one row.
- **v2.5.0:** The GPS button now toggles live positioning: it drops a moving marker that follows you in real time (tap again to stop). Added a center crosshair you can show/hide, with a selectable high-contrast color (Dark, White, Magenta, Cyan, Yellow, Red, Lime) under Advanced settings. The center dot now shows only when the search radius is locked, so it no longer overlaps the crosshair.
- **v2.4.0:** Added a **Download GPX** button (next to Clear Route) that saves the currently loaded route back to a `.gpx` file, and a **Rename** action for uploaded routes in the GPX upload history (renames the file on the optional backend). Also unified some secondary button colors.
- **v2.3.0:** Redesigned the control icons: replaced all emoji and glyph icons with a crisp, consistent inline SVG icon set that highlights on hover, refreshed the Sweden/UK language flags, switched the collapsible sections and panel toggle to + / − icons, and gave the 3D toggle a clear active state.
- **v2.2.0:** Added an elevation profile bar for loaded GPX routes (hover/drag to scrub, scroll to zoom, arrow keys to step, with an optional "Sync Map with Profile" marker), and an optional FastAPI backend for uploading, listing, and sharing GPX routes by link. The frontend auto-detects the backend and stays fully functional on static hosting when none is present.
- **v2.1.2:** Misc GUI fixes: added an Advanced settings section and a 3D-terrain toggle button next to search, simplified the route overlay to a single dropdown (route names always shown, legend collapsed by default), and refined the panel layout, dropdowns, and tutorial.
- **v2.1.1:** Route-names legend now shows each route's symbol with a manual refresh button, and you can click a route to show only that trail ("Show all" to restore). Plus compass-placement, tutorial, and Find Climbs refinements.
- **v2.1:** Added a Waymarkedtrails route overlay (hiking, cycling, MTB, skating) and an optional route-names legend that lists the routes in the current view with their official route symbols.
- **v2.0.2:** Reworked the analysis section accordion so only one section stays open at a time, moved the Search Radius / Show Radius / Lock Radius controls into the active analysis section, and auto-enabled Show Radius when opening analysis sections.
- **v2.0.1:** Added Manual mode tutorial guidance (including a spotlight step), explained the difference between automatic and manual climb modes in the tutorial, and fixed manual-route ascent smoothing for multi-point routes.
- **v2.0:** Migrated frontend map rendering to MapLibre GL JS and added overzoom, tilt, 3D terrain, and shareable map views.
- **v1.8.2:** Added Norgeskart (Norway) map layer.
- **v1.8.1:** Added map rotation with `Ctrl` + drag and two-finger touch support, plus a compass indicator with reset-north button.
- **v1.8:** Added GPX file upload with route overlay, track styling, distance labels, slope coloring, waypoints, and elevation stats.
- **v1.7:** Added the Slope Map feature to color-code terrain by steepness, with filter and opacity controls.
- **v1.6:** Added an interactive tutorial, reordered tutorial steps, and added the GitHub Project link in the info modal.
- **v1.5:** Added a PWA install button in the info modal and a mobile install prompt bar.
- **v1.4:** Improved Find Climbs accuracy with cumulative ascent, noise filtering, and higher scan resolution. Added detailed climb stats and new debug settings.
- **v1.3:** Made the app installable, added custom numbered map pins, improved touch UI for number inputs, and fixed alignment on high-resolution screens.
- **v1.2.1:** Fixed incorrect results at zoom level 15+ and added toggleable water analysis in debug settings.
- **v1.2:** Migrated elevation tiles to Mapterhorn with 512 px terrain tiles.
- **v1.1:** Added Find Climbs, the Lantmateriet map layer, and multilingual support.
- **v1.0:** Initial release.

## Privacy

TopoScout is client-side by default.

- No location data is sent to the creator's server.
- No search history is stored on a backend.
- API keys are only stored locally in the browser and sent directly to the relevant map provider when used.
- The optional backend only stores the GPX files you explicitly upload, and only on the server you choose to run. The public live demo and static hosting run without it.

## Feedback

I'd love to hear from you — feedback helps shape where TopoScout goes next.

- **Ideas, feature requests, and general feedback:** start a thread in [GitHub Discussions](https://github.com/droidgren/TopoScout/discussions).
- **Bug reports:** open an issue on [GitHub Issues](https://github.com/droidgren/TopoScout/issues).

## Credits

Created by [droidgren.github.io](http://droidgren.github.io/).

Libraries, services, and data sources used by the project include:

- MapLibre GL JS
- OpenTopoMap
- OpenStreetMap and Nominatim
- Esri World Imagery
- Lantmateriet
- Kartverket / Norgeskart
- ThunderForest
- Tracestrack
- Mapterhorn
- maplibre-contour (client-side contour generation)
- Noto Sans and Open Sans (SIL OFL 1.1 / Apache License 2.0) — bundled glyphs for contour labels

## License

This project is open source. See the repository for the applicable license and distribution terms.
