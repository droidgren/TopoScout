# Topo Elevation Search

Topo Elevation Search is a client-side web application designed to analyze terrain elevation data directly in the browser. It allows users to identify the highest points within a specific radius and calculate maximum ascent (climbing potential) over a set distance.

The application relies on global elevation tiles and runs entirely in the browser without sending user data or search queries to a backend server.

Live demo: [Topo Elevation Search](https://droidgren.github.io/elevation_finder/)

Also check out [Topo GPX Viewer](https://github.com/droidgren/topo_gpx_viewer), a companion project focused on visualizing GPX tracks with elevation-aware map tools.
Try it live here: [Topo GPX Viewer Demo](https://droidgren.github.io/topo_gpx_viewer/)

## Features

* **Real-time Elevation:** Displays the elevation above sea level for the map center dynamically.
* **Peak Finding:** Scans a user-defined radius to identify and rank the highest points in the area.
* **Climb Analysis:** Calculates true cumulative elevation gain (Total Ascent) over a specific distance by sampling terrain in 10m steps.
* **Detailed Stats:** Climb results include vertical drop, slope percentage, and straight-line distance.
* **Multiple Map Layers:**
    * OpenTopoMap (Default)
    * OpenStreetMap
    * Satellite (ESRI)
    * Lantmäteriet (Sweden)
    * Elevation Data (Debug view)
    * *Optional:* Tracetrack and Thunderforest (requires API keys).
* **Slope Map:** Generates a color-coded overlay within the search radius, visualizing terrain steepness by slope angle, with adjustable opacity and angle filters.
* **GPX Route Overlay:** Upload GPX files to display routes on the map with customizable track color, width, distance labels (km/mi), slope-based coloring, waypoints, and min/max elevation markers. Includes track stats: length, elevation gain/loss, and min/max elevation.
* **PWA Support:** Installable as a Progressive Web App via an install button in the info modal or a mobile install prompt bar.
* **Geolocation:** Quickly locate your current position.
* **Address Search:** Integrated search using Nominatim (OSM).
* **State Persistence:** Automatically saves your last position, zoom level, selected language, and map layer settings locally in the browser.
* **Bilingual Support:** Full support for English and Swedish.

## Getting Started

### Prerequisites

No installation or backend server is required. This is a static HTML/JS application.

### Running Locally

1.  Clone the repository or download the files.
2.  Ensure you have the following file structure:
    * `index.html`
    * `style.css`
    * `script.js`
3.  Open `index.html` in any modern web browser.

### Hosting

This project is ready to be hosted on GitHub Pages or any static web server (Apache, Nginx, Netlify, Vercel).

## Usage

1.  **Navigation:** Drag the map or use the search bar to find a location.
2.  **Settings:**
    * **Radius:** Sets the search area in kilometers.
    * **Points:** Sets how many top peaks to display.
    * **Measure Dist:** Sets the distance over which to calculate elevation gain (for climb analysis).
3.  **Analysis:**
    * Click **Find Highest Points** to scan the visible area for peaks.
    * Click **Find Climbs** to identify the steepest sections.
4.  **GPX Routes:** Expand the **Add Routes** section to load a GPX file. Customize track color, width, and toggle distance labels, slope coloring, waypoints, and min/max elevation markers.
5.  **Map Layers:** Use the dropdown menu to switch layers. If a layer requires an API key, a prompt will appear where you can enter and save it.
6.  **Debug Settings:** Accessible via the info modal. Includes a **Water Analysis** toggle (filters water from results), adjustable **Climb Step Resolution**, and **Scan Angles**.

## Technical Details

This application uses **Leaflet.js** for map rendering. Elevation data is fetched using high-resolution 512x512 WebP terrain tiles from **Mapterhorn**. 

### Shared foundation
1.  Elevation tiles are silently rendered onto a hidden HTML5 Canvas element that covers the current map view.
2.  When an analysis is triggered, the script reads raw pixel data (R, G, B, A) from that canvas.
3.  Each pixel's elevation (in metres) is decoded using the **Terrarium formula**: `(R × 256 + G + B / 256) − 32768`.
4.  If **Water Analysis** is enabled, a second canvas is populated with OpenStreetMap water tiles; pixels that match a water colour are excluded from results.

### Find Highest Points
1.  Every second pixel (2-pixel step) within the canvas is decoded to an elevation value.
2.  Only pixels that fall inside the user-defined **search radius** (measured from the map centre) are kept as candidates.
3.  Candidates are sorted by elevation in descending order.
4.  A **minimum separation filter** (40 px ≈ a few hundred metres depending on zoom) removes points that are too close together, ensuring spatially diverse results.
5.  The top **N** results (as set by *Num Points*) are placed as numbered markers on the map.

### Find Climbs
1.  Candidate **start points** are sampled on a 4-pixel grid across the visible canvas, filtered to those within the search radius.
2.  For each start point, **N evenly-spaced angles** are scanned (default 32, covering the full 360°). An end point is projected at exactly the user-defined **Measure Dist** distance in each direction.
3.  Each start→end path is walked in steps of **climbStepRes** metres (default 10 m). The elevation at every step is read from the canvas using the Terrarium formula.
4.  A **3-sample moving average** is applied to the elevation profile to suppress tile-level noise.
5.  **Cumulative ascent** is calculated by summing only the positive elevation differences between consecutive smoothed samples — downhill sections are ignored.
6.  Candidates with cumulative ascent > 1 m are sorted in descending order.
7.  The same 40-px **minimum separation filter** is applied to avoid duplicate nearby results.
8.  The top **N** climbs (as set by *Num Climbs*) are drawn as polylines on the map, with start and peak markers showing elevation, total ascent, slope %, and straight-line distance.

## Changelog

* **v1.8.1:** Added map rotation with Ctrl+drag and two-finger touch support, compass indicator with reset-north button.
* **v1.8:** Added GPX file upload with route overlay, track styling, distance labels, slope coloring, waypoints, and elevation stats.
* **v1.7:** Added Slope Map feature to color-code terrain by steepness, with filter and opacity controls.
* **v1.6:** Added interactive tutorial, reordered tutorial steps, and added GitHub Project link in the info modal.
* **v1.5:** Added PWA install button in the info modal and a mobile install prompt bar.
* **v1.4:** Improved 'Find Climbs' accuracy (cumulative ascent, noise filtering, 32-angle scan). Added detailed climb stats and debug settings for step resolution and scan angles.
* **v1.3:** Made app installable (PWA), added custom numbered map pins, improved touch UI for number inputs, and fixed alignment on high-res screens.
* **v1.2.1:** Fixed incorrect results at zoom level 15+. Added toggleable water analysis in debug settings.
* **v1.2:** Migrated elevation tiles to Mapterhorn (512px resolution).
* **v1.1:** Added "Find Climbs" feature, Lantmäteriet map, and multi-language support.
* **v1.0:** Initial release.

## Privacy Policy

**Topo Elevation Search is 100% client-side.**

* No location data is sent to the creator's server.
* No search history is tracked.
* API keys (if used) are stored locally in your browser's `localStorage` and are only communicated directly to the respective tile providers (e.g., Thunderforest).

## Credits

**Created by:** [droidgren.github.io](http://droidgren.github.io/) mostly using Gemini Pro.

### Third-party libraries and data:
* **Leaflet:** Interactive maps.
* **OpenTopoMap:** Topographic map tiles.
* **OpenStreetMap:** Map data and geocoding.
* **Mapterhorn:** High-resolution WebP elevation tiles.

## License

This project is open source. Please refer to the repository for license details.