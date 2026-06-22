# Elevation Finder

Elevation Finder is a browser-based terrain analysis tool for finding high points, comparing climbs, visualizing slope, and overlaying GPX routes directly on the map. The app runs fully client-side, so terrain analysis happens in the browser without a custom backend.

🌐 Open the [Live demo](https://elevation-finder.dedyn.io/) with GPX store.

🌐 Live [demo](https://droidgren.github.io/elevation_finder/) without GPX store (Hosted on github).

## Core Capabilities

- **Live center elevation** for the current map position.
- **Find Highest Points** within a configurable search radius.
- **Find Climbs** by scanning many directions and ranking routes by cumulative ascent.
- **Slope Map** overlay with opacity and slope-angle filtering.
- **GPX route overlay** with customizable styling and route stats.
- **Map tools** for overzoom, tilt, and 3D terrain exaggeration.
- **Share Map View** links that restore language, center, zoom, and selected layer.
- **Multiple map sources** including topographic, satellite, national, and debug elevation layers.
- **PWA install support** for desktop and mobile.
- **English and Swedish** localization.

## Feature Overview

### Terrain analysis

Elevation Finder focuses on terrain discovery rather than just displaying a single height sample.

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
- **Download** the loaded route back to a `.gpx` file (saved under its current name).
- Optionally upload, list, share, rename, and delete GPX routes when the [optional backend](#optional-backend-gpx-upload-and-sharing) is running.
- To acess your GPX file you log i with your Google account

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

### 4. Add GPX context

- Expand **Add Routes**.
- Load a GPX file.
- Tune track styling and visibility options.
- Compare the route against peak, climb, and slope results already on the map.

### 5. Share or install

- Click the share button in the header to copy a map-state link.
- Install the app from the About dialog or the mobile install prompt when supported.

## State, Sharing, And Storage

- The app remembers language, map position, zoom, and selected layer in `localStorage`.
- Shared URLs restore the current language and map state.
- API keys are stored locally in the browser.
- No terrain analysis results are uploaded to a project server.

## Optional Backend (GPX Upload And Sharing)

The frontend works fully on static hosting (GitHub Pages and the live demo) with no backend. An optional FastAPI backend adds GPX upload, a per-browser upload history, and shareable `?gpx=<id>` links.

The frontend auto-detects the backend by probing `/api/health` on load. When it is reachable, the **Load GPX Route** button opens an upload/history modal and share links include the uploaded route. When it is not reachable, the same button opens the local file picker directly — no upload UI, no errors, and any `?gpx=` parameter is stripped silently.

Run it locally:

```bash
pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 8000
```

Then open `http://localhost:8000/`. The backend serves the static files and stores uploads under `gpx-files/` (configurable via `GPX_UPLOAD_DIR`).

Or with Docker:

```bash
docker build -t elevation-finder .
docker run -p 8000:8000 -v "$(pwd)/gpx-files:/app/gpx-files" elevation-finder
```

## Progressive Web App Notes

- The app can be installed on mobile and desktop.
- A service worker caches the core app shell for faster repeat visits.
- When shipping a new release, bump both the displayed app version and the cache name so clients refresh cleanly.

## Repository Layout

- `index.html` - application shell and modal markup
- `script.js` - map adapter, terrain analysis, GPX overlay, elevation profile, localization, and app logic
- `style.css` - control panel, modal, and map styling
- `service-worker.js` - offline asset caching
- `manifest.json` - PWA metadata
- `lang/en.js` - English strings
- `lang/sv.js` - Swedish strings
- `main.py` - optional FastAPI backend for GPX upload/list/delete/share/rename
- `requirements.txt` - Python dependencies for the optional backend
- `Dockerfile` - container image for the optional backend
- `gpx-files/` - uploaded GPX storage (created at runtime; git-ignored)

## Changelog

- **v2.6.1:** Made the "new version available" update prompt far more reliable for the iOS home-screen (PWA) app. The app now re-checks for updates when it's reopened or brought back to the foreground (not only on a cold start), surfaces an update that finished downloading in a previous session (previously it could sit unprompted until the browser's automatic ~24h check), and registers the service worker with `updateViaCache: 'none'` so the worker script is always fetched fresh. Also removed a stray reload on first launch and hardened the worker's message handler.
- **v2.6:** Added a **Strava Global Heatmap** to the Route Overlay dropdown. Tiles are served privately through the optional backend (`/api/heatmap/...`), which proxies a self-hosted [strava-heatmap-proxy](https://github.com/patrickziegler/strava-heatmap-proxy) over the internal Docker network — so there are no CORS/mixed-content issues and the Strava cookies never reach the browser. The option appears only when the backend is available. A route selected in the Routes-in-view legend stays drawn when you switch the overlay to the heatmap. See `strava-heatmap-proxy.yaml`.
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

Elevation Finder is client-side by default.

- No location data is sent to the creator's server.
- No search history is stored on a backend.
- API keys are only stored locally in the browser and sent directly to the relevant map provider when used.
- The optional backend only stores the GPX files you explicitly upload, and only on the server you choose to run. The public live demo and static hosting run without it.

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

## License

This project is open source. See the repository for the applicable license and distribution terms.
