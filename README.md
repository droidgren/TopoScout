# Topo Elevation Search

Topo Elevation Search is a client-side web application designed to analyze terrain elevation data directly in the browser. It allows users to identify the highest points within a specific radius and calculate maximum ascent (climbing potential) over a set distance.

The application relies on global elevation tiles and runs entirely in the browser without sending user data or search queries to a backend server.

To access the webapp go here: https://droidgren.github.io/elevation_finder/

## Features

* **Real-time Elevation:** Displays the elevation above sea level for the map center dynamically.
* **Peak Finding:** Scans a user-defined radius to identify and rank the highest points in the area.
* **Climb Analysis:** Calculates the steepest ascent over a specific distance (e.g., max elevation gain over 200m), useful for hikers and cyclists.
* **Multiple Map Layers:**
    * OpenTopoMap (Default)
    * OpenStreetMap
    * Satellite (ESRI)
    * Elevation Data (Debug view)
    * *Optional:* Tracetrack and Thunderforest (requires API keys).
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
4.  **Map Layers:** Use the dropdown menu to switch layers. If a layer requires an API key, a prompt will appear where you can enter and save it.

## Technical Details

This application uses **Leaflet.js** for map rendering. Elevation data is fetched using high-resolution 512x512 WebP terrain tiles from **Mapterhorn**. 

### How it works
1.  The application loads invisible elevation tiles onto an HTML5 Canvas element corresponding to the current map view.
2.  When an analysis is triggered, the script reads pixel data (R, G, B) from the canvas.
3.  Elevation is decoded using the Terrarium formula: `(R * 256 + G + B / 256) - 32768`.
4.  The algorithm iterates through the pixel data to find local maxima (peaks) or maximum differentials (climbs) based on the user's parameters.

## Changelog

* **v1.3:** Made app installable (PWA), added custom numbered map pins, improved touch UI for number inputs, and fixed alignment on high-res screens.
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