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
- **Download** the loaded route back to a `.gpx` file (saved under its current name).
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

### 4. Add routes and POIs

- Expand **Add Routes and POIs**.
- Load a GPX file, or sign in and tap **Add POI** to drop a saved Point of Interest.
- Tune track styling and visibility options, and toggle pins with **Show POIs**.
- Compare routes and POIs against peak, climb, and slope results already on the map.

### 5. Share or install

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
- `vendor/jspdf.umd.min.js` - vendored jsPDF library for Print map PDF export (precached for offline use)
- `fonts/` - self-hosted, same-origin glyph sets for contour labels (`noto-sans-regular`, `open-sans-regular`)
- `icon.svg` - app icon source
- `icon-set.html` - helper page for generating the app icon set
- `main.py` - optional FastAPI backend for GPX upload/list/delete/share/rename
- `requirements.txt` - Python dependencies for the optional backend
- `Dockerfile` - container image for the optional backend
- `gpx-files/` - uploaded GPX storage (created at runtime; git-ignored)

## Changelog

- **v2.14.0:** Added a **Print map** mode that exports the framed map area to a print-ready **PDF**. It is launched **on desktop** by clicking the app logo/title in the Control Panel header (bound to the whole `.title-group` for a reliable hit target; not offered on mobile, where the modal has no room). A framing "window" is drawn over the live map (the area outside is shadowed out) so you can pan/zoom to frame the area, and a compact left-aligned settings panel offers **A4 / A3 / A2**, **portrait / landscape**, a **coordinate-system selector** (**WGS 84** default, or **SWEREF 99**), and independent toggles for the **scale ruler**, **map source**, **coordinates**, **north arrow** and **map border** (border off by default). On **Generate PDF**, a dedicated off-screen MapLibre map is created with `preserveDrawingBuffer: true` (the main map is not, so its WebGL canvas can't be read) by cloning the live style — capturing the base layer, hillshade, contours, route overlays and the GPX track line automatically at ~200 DPI; DOM markers (POI pins, analysis result pins, GPX labels/waypoints) are composited on top by projecting their coordinates onto the print canvas. `jsPDF` (vendored locally at `vendor/jspdf.umd.min.js` and precached for offline use) assembles the page: the scale is drawn **next to the scale ruler** as `1:X · <CRS>` with the map **source** following it (all bottom-left, just below the map at the same tight gap as the coordinates); a north arrow (rendered from an SVG, rotated to true north) sits top-left inside the map and a small **TopoScout.org** stamp top-right; and corner coordinates print at the **upper-left and lower-right corners** just outside the map (compact font, tight gap), each with **N (northing/latitude) horizontal** and **E (easting/longitude) vertical** (rotated 90°), formatted per the chosen coordinate system (`wgs84ToSweref99tm()` Gauss-conformal conversion for the SWEREF grid). `getPrintLayout()` computes per-side margins from the enabled options, so disabling an annotation **reclaims its margin for the map** (all off ≈ full-page map), and the on-map framing window's aspect updates live as options change. New `print_*` strings are localized in English and Swedish.
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
