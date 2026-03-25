# Plan: Add GPX File Upload & Route Overlay

## TL;DR
Add a GPX file upload button to the control panel that lets users select a `.gpx` file, parses the track/route/waypoint data with the native `DOMParser`, and overlays the route as a Leaflet polyline on the map. The map auto-fits to the route bounds. The route has its own dedicated clear button within the GPX section.

## Steps

### Phase 1: HTML — Add GPX Upload UI

1. In `index.html`, add a new section between the slope section and the "Clear Results" button (around line 258). Add:
   - A horizontal rule separator (matching existing style)
   - A hidden `<input type="file" id="gpx-file-input" accept=".gpx">` element
   - A styled button `<button id="gpx-btn">` that triggers the file input click
   - A clear button `<button id="gpx-clear-btn">` (initially hidden, shown when a GPX is loaded) to remove the route
   - An `id="gpx-section"` wrapper div for the section

### Phase 2: CSS — Style the GPX Button

2. In `style.css`, add a `.gpx-btn` class styled consistently with existing section buttons (similar to `.slope-btn` or `.climb-btn`) — use a distinct color (e.g., teal/green `#00897B`) to differentiate it from scan (red), climb (orange), slope (purple). Add a `.gpx-clear-btn` class for the clear route button (small, secondary style, initially `display:none`).

### Phase 3: JavaScript — GPX Parsing & Overlay Logic

3. In `script.js`, add a global variable `let gpxLayer = null;` alongside the existing overlay tracking variables (near line 189).

4. Add a `loadGpxFile()` function that:
   - Reads the selected file using `FileReader.readAsText()`
   - Parses the XML text using `new DOMParser().parseFromString(text, 'application/xml')`
   - Validates that the parsed document contains no `<parsererror>` elements
   - Extracts coordinates from `<trkpt>`, `<rtept>`, and `<wpt>` elements (supporting tracks, routes, and waypoints)
   - For tracks (`<trk>` → `<trkseg>` → `<trkpt>`): creates a polyline per segment
   - For routes (`<rte>` → `<rtept>`): creates a polyline per route
   - Groups all polylines/markers into a single `L.layerGroup()` stored in `gpxLayer`
   - Adds the layer group to the map
   - Calls `map.fitBounds(gpxLayer.getBounds().pad(0.1))` to zoom to the route
   - Updates the status bar with a success/error message
   - Resets the file input value so re-uploading the same file works

5. Wire the hidden file input's `change` event to `loadGpxFile()`.

6. Wire the GPX button's `click` to trigger `document.getElementById('gpx-file-input').click()`.

7. Add a `clearGpxRoute()` function that removes `gpxLayer` from the map, resets it to `null`, and hides the clear button. Wire it to the `#gpx-clear-btn` click.

8. In `loadGpxFile()`, after successfully adding the layer, show the `#gpx-clear-btn` button. If a previous GPX layer exists, remove it before adding the new one.

### Phase 4: Localization

9. In `lang/en.js`, add:
   - `btn_gpx: "📂 Load GPX Route"`
   - `btn_gpx_clear: "✕ Clear Route"`
   - `status_gpx_loaded: "GPX route loaded ({n} points)."`
   - `status_gpx_error: "Failed to load GPX file."`
   - `status_gpx_empty: "No track data found in GPX file."`
   - `status_gpx_cleared: "GPX route cleared."`

10. In `lang/sv.js`, add equivalent Swedish translations:
   - `btn_gpx: "📂 Ladda GPX-spår"`
   - `btn_gpx_clear: "✕ Rensa spår"`
   - `status_gpx_loaded: "GPX-spår laddat ({n} punkter)."`
   - `status_gpx_error: "Kunde inte läsa GPX-filen."`
   - `status_gpx_empty: "Ingen spårdata hittades i GPX-filen."`
   - `status_gpx_cleared: "GPX-spår rensat."`

11. In `script.js`, update the `applyLanguage()` function (or equivalent) to set both the GPX load and clear button texts from translation keys.

### Phase 5: Service Worker Cache Update

12. In `service-worker.js`, bump the cache version string (e.g., `elevation-finder-v2.2`) so that clients pick up the updated files.

## Relevant Files

- [index.html](index.html) — Add the GPX section HTML between the slope section `</div>` (line ~258) and the clear button (line ~260)
- [script.js](script.js) — Add `gpxLayer` variable (near line 189), `loadGpxFile()` function, `clearGpxRoute()` function, event wiring
- [style.css](style.css) — Add `.gpx-btn` class (near the existing `.slope-btn` styles)
- [lang/en.js](lang/en.js) — Add 6 new translation keys at the end
- [lang/sv.js](lang/sv.js) — Add 6 matching Swedish translation keys at the end (using "spår" not "rutt")
- [service-worker.js](service-worker.js) — Bump cache version

## Verification

1. Open the app in a browser, confirm the "Load GPX Route" button appears between the slope section and the clear button
2. Upload a valid `.gpx` file with `<trk>` data — verify a polyline is drawn and the map zooms to fit the route
3. Upload a GPX file with `<rte>` (route) data — verify it also draws correctly
4. Upload an invalid file (e.g., a `.txt`) — verify a descriptive error appears in the status bar
5. Upload an empty GPX (valid XML but no tracks) — verify the "No track data" message shows
6. Verify the "Clear Route" button appears after loading a GPX, and clicking it removes only the GPX route (not peaks/climbs/slope)
7. Verify "Clear Results" does NOT affect the GPX route
8. Re-upload the same GPX file — verify it works (file input resets properly)
9. Upload a new GPX while one is already loaded — verify the old one is replaced
10. Switch language to Swedish — verify button text shows "Ladda GPX-spår" and status messages use "spår"
11. Verify the GPX button is visually consistent with other section buttons and responsive on mobile

## Decisions

- **No external library**: Parse GPX with native `DOMParser` — consistent with the app's vanilla JS, zero-dependency approach. No need to add `leaflet-gpx` plugin.
- **Polyline style**: Orange/teal polyline with moderate weight (e.g., `{ color: '#00897B', weight: 4, opacity: 0.85 }`) to be visually distinct from the existing red climb polylines.
- **GPX elements supported**: `<trk>` (tracks), `<rte>` (routes). Waypoints (`<wpt>`) will be added as circle markers for completeness.
- **Scope exclusions**: No elevation profile chart, no GPX export, no drag-and-drop upload (button-only for simplicity). These can be added later.
- **Route persists across scans**: The GPX overlay is independent of peak/climb/slope results — it has its own dedicated clear button and is NOT affected by the existing "Clear Results" button.
- **Swedish terminology**: Use "GPX-spår" (track) instead of "GPX-rutt" (route) per user preference.
