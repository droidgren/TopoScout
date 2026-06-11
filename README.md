# Elevation Finder

Elevation Finder is a browser-based terrain analysis tool for finding high points, comparing climbs, visualizing slope, and overlaying GPX routes directly on the map. The app runs fully client-side, so terrain analysis happens in the browser without a custom backend.

Live demo: [Elevation Finder](https://droidgren.github.io/elevation_finder/)

Repository: [droidgren/elevation_finder](https://github.com/droidgren/elevation_finder)

Companion project: [Topo GPX Viewer](https://github.com/droidgren/topo_gpx_viewer/)


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

## Progressive Web App Notes

- The app can be installed on mobile and desktop.
- A service worker caches the core app shell for faster repeat visits.
- When shipping a new release, bump both the displayed app version and the cache name so clients refresh cleanly.

## Repository Layout

- `index.html` - application shell and modal markup
- `script.js` - map adapter, terrain analysis, GPX overlay, localization, and app logic
- `style.css` - control panel, modal, and map styling
- `service-worker.js` - offline asset caching
- `manifest.json` - PWA metadata
- `lang/en.js` - English strings
- `lang/sv.js` - Swedish strings

## Changelog

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

Elevation Finder is fully client-side.

- No location data is sent to the creator's server.
- No search history is stored on a backend.
- API keys are only stored locally in the browser and sent directly to the relevant map provider when used.

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
