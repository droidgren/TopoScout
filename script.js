// ==========================================
// 1. CONFIGURATION & CONSTANTS
// ==========================================
const APP_VERSION = "2.24.0";
const BUILD_NUMBER = "3036";
const ANALYSIS_SECTION_IDS = ['section-points', 'section-climbs', 'section-slope'];
const ALL_SECTION_IDS = ['section-points', 'section-climbs', 'section-slope', 'section-routes'];
const APP_REFRESH_PARAM = 'app-refresh';

// --- Optional GPX upload/sharing backend (auto-detected; absent on static hosting) ---
const API_BASE = '/api';
// Generous enough that a cold/slow first load still detects the backend: losing this race
// hides the whole sign-in UI (initGoogleAuth never runs), which looks like being signed out.
const BACKEND_DETECTION_TIMEOUT_MS = 4000;

let backendAvailable = false;
let backendDetectionPromise = null;
// Reported by /api/health: true when the backend has an openrouteservice configured. Gates
// the track editor's snap-to-route, which degrades to freehand lines without it.
let routingAvailable = false;

function isBackendEnabled() {
    return backendAvailable;
}

// --- Google Sign-In (optional; ties uploads to a Google account so previous
// uploads appear on any device/session, independent of the anonymous cookie) ---
const GOOGLE_CLIENT_ID = '79515767501-5p4cbnfq111dqnuv8h6fp91t33k6gcbt.apps.googleusercontent.com';
const GOOGLE_AUTH_STORAGE_KEY = 'topo_google_auth';
// Non-sensitive "signed in on this device before" flag (not a credential). Lets us offer a
// silent One Tap re-auth to returning users on load without nagging brand-new visitors,
// now that the token itself is no longer persisted.
const GOOGLE_SEEN_KEY = 'topo_google_seen';
// { token, exp, email, name, picture, sub, source }. source 'token' means a fresh Google ID
// token is in hand (sent as a Bearer header); 'session' means the identity is carried by the
// backend's HttpOnly session cookie and `token` is null.
let googleAuth = null;
let googleAuthInitialized = false;
let googleRefreshTimer = null;   // proactive pre-expiry silent re-auth timer
let pendingAuthRefresh = null;   // { promise, resolve, timeout } while a silent refresh is in flight
// Google ID tokens live ~1h. Re-auth silently this long before they expire.
const GOOGLE_AUTH_REFRESH_LEAD_MS = 5 * 60 * 1000;
// Cap on how long we wait for a silent One Tap re-auth before treating it as failed.
const GOOGLE_AUTH_REFRESH_TIMEOUT_MS = 8 * 1000;

function probeBackendHealth() {
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timeoutId = controller
        ? window.setTimeout(() => controller.abort(), BACKEND_DETECTION_TIMEOUT_MS)
        : null;

    return fetch(API_BASE + '/health', {
        cache: 'no-store',
        credentials: 'same-origin',
        signal: controller ? controller.signal : undefined
    })
        .then(async response => {
            if (!response.ok) {
                return false;
            }
            const payload = await response.json().catch(() => null);
            const ok = !!(payload && payload.status === 'ok');
            if (ok) routingAvailable = !!payload.routing;
            return ok;
        })
        .catch(() => false)
        .finally(() => {
            if (timeoutId !== null) {
                window.clearTimeout(timeoutId);
            }
        });
}

async function detectBackendAvailability() {
    if (backendDetectionPromise) {
        return backendDetectionPromise;
    }

    // One retry: a single slow/aborted probe on a cold network would otherwise leave the
    // app in its backend-less mode (no uploads, no POIs, no sign-in) for the whole session.
    backendDetectionPromise = probeBackendHealth()
        .then(available => (available ? true : probeBackendHealth()));

    backendAvailable = await backendDetectionPromise;
    backendDetectionPromise = null;
    return backendAvailable;
}

// Water analysis (CartoDB Light No Labels)
const WATER_COLOR = { r: 203, g: 210, b: 211 }; // #cbd2d3
const WATER_TOLERANCE = 25;
const WATER_CHECK_URL = "https://basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}.png";

// Services requiring API keys
const lockedServices = {
    'tracetrack': {
        name: 'Tracetrack Topo',
        storageKey: 'tracetrack_key',
        link: 'https://www.tracestrack.com/',
        urlTemplate: 'https://tile.tracestrack.com/topo_sv/{z}/{x}/{y}.webp?key={key}'
    },
    'thunderforest': {
        name: 'ThunderForest Outdoors',
        storageKey: 'thunderforest_key',
        link: 'https://www.thunderforest.com/',
        urlTemplate: 'https://tile.thunderforest.com/outdoors/{z}/{x}/{y}.png?apikey={key}'
    },
    'jawg_terrain': {
        name: 'Jawg Terrain',
        storageKey: 'jawg_key',
        link: 'https://www.jawg.io/',
        urlTemplate: 'https://tile.jawg.io/jawg-terrain/{z}/{x}/{y}.png?access-token={key}'
    }
};

// Map URLs
const OPENTOPO_URL = "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png";
const OSM_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const SATELLITE_URL = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
const NORGES_MAP_URL = "https://cache.kartverket.no/v1/wmts/1.0.0/topo/default/webmercator/{z}/{y}/{x}.png";
const DATA_TILE_URL = "https://tiles.mapterhorn.com/{z}/{x}/{y}.webp"; // UPDATED TO MAPTERHORN
const WORKER_URL = "https://lm.clackspark.workers.dev";
const ELEVATION_TILE_MAX_ZOOM = 15;
const OVERZOOM_STORAGE_KEY = 'topo_overzoom';
const OVERZOOM_MAX_ZOOM = 22;
const TERRAIN_SOURCE_ID = 'elevation-dem';
// Contour overlay: client-side contour lines generated from the same Mapterhorn DEM
// via maplibre-contour. Labels need a glyphs/font source (the raster basemap has none).
const GLYPHS_URL = 'fonts/{fontstack}/{range}.pbf'; // self-hosted, same-origin (offline-capable)
const CONTOUR_FONT = 'noto-sans-regular';           // bundled under fonts/; swap to 'open-sans-regular' to compare
const CONTOUR_SOURCE_ID = 'contour-source';
const CONTOUR_LINE_LAYER_ID = 'contour-lines';
const CONTOUR_LABEL_LAYER_ID = 'contour-labels';
const CONTOURS_ENABLED_KEY = 'topo_contours';        // 'true' when the contour overlay is on
const CONTOUR_LABELS_KEY = 'topo_contour_labels';    // 'true' when elevation labels are shown
const DEFAULT_TERRAIN_EXAGGERATION = 1.5;

// The GPX track line. It must stay above every other map layer, so every layer added while a
// track is loaded is inserted *below* it via this beforeId (MapLibre throws on an unknown
// beforeId, hence the getLayer guard; undefined means "append to the top" as before).
const GPX_LINE_LAYER_ID = 'gpx-line-0';
function getGpxTopBeforeId(nativeMap) {
    return nativeMap && nativeMap.getLayer && nativeMap.getLayer(GPX_LINE_LAYER_ID)
        ? GPX_LINE_LAYER_ID
        : undefined;
}

// --- GPX track editing ---
// Dashed rubber-band shown while a handle is being dragged. Created fresh per drag so it
// always lands above the track (updateGpxTrackLine re-raises the track on every update).
const GPX_EDIT_PREVIEW_SOURCE_ID = 'gpx-edit-preview';
const GPX_EDIT_PREVIEW_LAYER_ID = 'gpx-edit-preview-line';
const GPX_EDIT_MIN_HANDLES = 3;
const GPX_EDIT_UNDO_MAX = 20;
const GPX_EDIT_UNDO_MAX_POINTS = 400000;   // total points across all stacked snapshots
const GPX_EDIT_CLICK_TOLERANCE_PX = 18;    // click-to-add-handle hit radius
const GPX_EDIT_ORS_RADIUS_M = 50;          // snap radius sent to the routing service
// How far the dragged handle may be pulled to the routed path. The backend widens the
// snap radius when nothing is found nearby (sparse alpine/forest mapping), so a routed
// endpoint can come back hundreds of metres away — adopting that would teleport the
// handle out from under the cursor. Past this distance the route is still used, but the
// handle stays where it was dropped and a straight connector bridges the gap.
const GPX_EDIT_SNAP_ADOPT_MAX_M = 80;
// How far a routed endpoint may sit from the point that was asked for before the whole
// route is thrown away as unusable. Answers a different question from the constant above:
// that one decides whether the handle moves, this one decides whether the geometry is
// about the right stretch of ground at all.
const GPX_EDIT_SNAP_MAX_DRIFT_M = 150;
const GPX_EDIT_FREEHAND_SPACING_M = 50;    // densification spacing when snapping is off
const GPX_EDIT_FREEHAND_MAX_POINTS = 200;  // cap per sub-segment
// Must match ORS_PROFILES in main.py and the enabled profiles in ors/ors-config.yml.
const GPX_EDIT_PROFILES = ['foot-hiking', 'cycling-mountain'];
const GPX_EDIT_DEFAULT_PROFILE = 'foot-hiking';

// --- Create route ---
// Two map clicks become a routed track. Both span guards run before any network call.
// Floor for "the two clicks are the same place". The live threshold is the editor's click
// tolerance converted to meters, so it scales with zoom; this floor keeps a deeply
// zoomed-in map from accepting the two clicks a browser reports for one double-click.
const ROUTE_CREATE_MIN_SPAN_M = 15;
// Refuse beyond this rather than fail slowly. openrouteservice caps a single directions
// request well below this, so the request would 502 and drop through to the freehand
// fallback — which would then densify a continent-spanning straight line and fire
// GPX_EDIT_FREEHAND_MAX_POINTS DEM lookups for a route nobody meant to draw.
const ROUTE_CREATE_MAX_SPAN_M = 100000;

// Footer readout visibility. Zoom defaults to shown (only an explicit 'false' hides it);
// scale and center GPS default to hidden (only an explicit 'true' shows them).
const SHOW_ZOOM_KEY = 'topo_show_zoom';
const SHOW_SCALE_KEY = 'topo_show_scale';
const SHOW_CENTER_GPS_KEY = 'topo_show_center_gps';
const SHOW_COORDS_KEY = 'topo_show_coords';
function isZoomShown() { try { return localStorage.getItem(SHOW_ZOOM_KEY) !== 'false'; } catch (e) { return true; } }
function isScaleShown() { try { return localStorage.getItem(SHOW_SCALE_KEY) === 'true'; } catch (e) { return false; } }
function isCenterGpsShown() { try { return localStorage.getItem(SHOW_CENTER_GPS_KEY) !== 'false'; } catch (e) { return true; } }
function isCoordsShown() { try { return localStorage.getItem(SHOW_COORDS_KEY) !== 'false'; } catch (e) { return true; } }

const MAP_SOURCES = {
    "opentopo": { url: OPENTOPO_URL, attribution: 'OpenTopoMap', maxZoom: 17 },
    "tracetrack": { url: '', attribution: 'Tracetrack', maxZoom: 20 },
    "thunderforest": { url: '', attribution: 'ThunderForest', maxZoom: 22 },
    "jawg_terrain": { url: '', attribution: '&copy; <a href="https://www.jawg.io/">Jawg</a> &copy; OpenStreetMap contributors', maxZoom: 22 },
    "carto_voyager": { url: "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png", attribution: '&copy; <a href="https://carto.com/attributions">CARTO</a>, &copy; OpenStreetMap contributors', maxZoom: 20 },
    "carto_positron": { url: "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png", attribution: '&copy; <a href="https://carto.com/attributions">CARTO</a>, &copy; OpenStreetMap contributors', maxZoom: 20 },
    "lm_map": { url: `${WORKER_URL}/{z}/{x}/{y}`, attribution: '&copy; <a href="https://www.lantmateriet.se/">Lantm\u00e4teriet</a> - CC BY 4.0', maxZoom: 20 },
    "norges_map": { url: NORGES_MAP_URL, attribution: '&copy; <a href="http://www.kartverket.no/">Kartverket</a>', maxZoom: 19 },
    "osm": { url: OSM_URL, attribution: 'OpenStreetMap', maxZoom: 19 },
    "satellite": { url: SATELLITE_URL, attribution: 'Esri', maxZoom: 19 },
    "debug": { url: DATA_TILE_URL, attribution: '<a href="https://github.com/mapterhorn/mapterhorn">Mapterhorn</a> ', maxZoom: ELEVATION_TILE_MAX_ZOOM, opacity: 1 }
};

const WAYMARKED_ATTRIBUTION = '&copy; <a href="https://waymarkedtrails.org/">Waymarked Trails</a> (CC-BY-SA)';
const OVERLAY_SOURCES = {
    "waymarked_hiking": { url: 'https://tile.waymarkedtrails.org/hiking/{z}/{x}/{y}.png', attribution: WAYMARKED_ATTRIBUTION, maxZoom: 18 },
    "waymarked_cycling": { url: 'https://tile.waymarkedtrails.org/cycling/{z}/{x}/{y}.png', attribution: WAYMARKED_ATTRIBUTION, maxZoom: 18 },
    "waymarked_mtb": { url: 'https://tile.waymarkedtrails.org/mtb/{z}/{x}/{y}.png', attribution: WAYMARKED_ATTRIBUTION, maxZoom: 18 },
    "waymarked_skating": { url: 'https://tile.waymarkedtrails.org/skating/{z}/{x}/{y}.png', attribution: WAYMARKED_ATTRIBUTION, maxZoom: 18 },
    // Mapbox raster style, proxied through the same Cloudflare worker as lm_map so the
    // access token stays server-side (the worker adds it, plus @2x, behind /osmpaths).
    "osm_paths": { url: `${WORKER_URL}/osmpaths/{z}/{x}/{y}`, attribution: '&copy; <a href="https://www.mapbox.com/about/maps/">Mapbox</a> &copy; OpenStreetMap contributors', maxZoom: 19 },
    "strava_heatmap": { url: `${API_BASE}/heatmap/all/bluered/{z}/{x}/{y}.png`, attribution: '&copy; <a href="https://www.strava.com/">Strava</a>', maxZoom: 15 }
};
const EXTRA_OVERLAY_STORAGE_KEY = 'topo_extra_overlay'; // selected overlay key, or '' when off
const ROUTE_LEGEND_COLLAPSED_KEY = 'topo_route_legend_collapsed'; // 'true' when the route-names legend is collapsed
const ROUTE_ISOLATED_ID_KEY = 'topo_route_isolated_id';       // relation id of the persisted isolated trail
const ROUTE_ISOLATED_COLOR_KEY = 'topo_route_isolated_color'; // its draw color
const HILLSHADE_ENABLED_KEY = 'topo_hillshade';               // 'true' when the hillshade relief layer is on
const HILLSHADE_OPACITY_KEY = 'topo_hillshade_opacity';       // hillshade strength as a 0-100 percentage
const HILLSHADE_SLIDER_KEY = 'topo_hillshade_slider';        // 'true' when the on-map opacity slider is shown
const EXAGGERATION_VALUE_KEY = 'topo_3d_exaggeration';        // 3D terrain exaggeration multiplier
const EXAGGERATION_SLIDER_KEY = 'topo_3d_exaggeration_slider';// 'true' when the on-map exaggeration slider is shown
const MAX_PITCH_KEY = 'topo_max_pitch';                       // tilt cap in degrees (0-85); the Tilt/3D buttons ease to it
const DEFAULT_MAX_PITCH = 60;                                 // MapLibre's default pitch cap
const MAPLIBRE_MAX_PITCH = 85;                                // MapLibre's hard upper limit for pitch

const OVERLAY_WMT_ACTIVITY = {
    "waymarked_hiking": 'hiking',
    "waymarked_cycling": 'cycling',
    "waymarked_mtb": 'mtb',
    "waymarked_skating": 'skating'
    // (extend with 'riding'/'slopes' if those overlays are added later)
};
const ROUTE_LEGEND_MIN_ZOOM = 12;                   // below this, prompt to zoom in

const EARTH_RADIUS_M = 6371000;
let mapOverlayId = 0;

function isOverzoomEnabled() {
    try {
        return localStorage.getItem(OVERZOOM_STORAGE_KEY) === 'true';
    } catch (error) {
        return false;
    }
}

function getEffectiveLayerMaxZoom(maxZoom) {
    const resolvedMaxZoom = Number(maxZoom) || 19;
    return isOverzoomEnabled() ? Math.max(resolvedMaxZoom, OVERZOOM_MAX_ZOOM) : resolvedMaxZoom;
}

function getHillshadeExaggeration() {
    let pct;
    try {
        pct = parseInt(localStorage.getItem(HILLSHADE_OPACITY_KEY), 10);
    } catch (error) {
        pct = NaN;
    }
    return (Number.isFinite(pct) ? pct : 50) / 100;
}

function getTerrainSourceDefinition() {
    return {
        type: 'raster-dem',
        tiles: getTileUrls(DATA_TILE_URL),
        encoding: 'terrarium',
        tileSize: 512,
        maxzoom: ELEVATION_TILE_MAX_ZOOM
    };
}

function getTileUrls(urlTemplate) {
    if (!urlTemplate) return [];
    if (urlTemplate.includes('{s}')) {
        return ['a', 'b', 'c'].map((subdomain) => urlTemplate.replace('{s}', subdomain));
    }
    return [urlTemplate];
}

function normalizeControlPosition(position) {
    const positions = {
        topleft: 'top-left',
        topright: 'top-right',
        bottomleft: 'bottom-left',
        bottomright: 'bottom-right'
    };
    return positions[position] || position || 'top-right';
}

function toLngLat(input) {
    if (Array.isArray(input)) {
        return { lat: Number(input[0]), lng: Number(input[1]) };
    }
    return { lat: Number(input.lat), lng: Number(input.lng) };
}

function createLatLng(lat, lng) {
    return {
        lat: Number(lat),
        lng: Number(lng),
        distanceTo(other) {
            const target = toLngLat(other);
            const lat1 = this.lat * Math.PI / 180;
            const lat2 = target.lat * Math.PI / 180;
            const dLat = (target.lat - this.lat) * Math.PI / 180;
            const dLng = (target.lng - this.lng) * Math.PI / 180;
            const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
            return 2 * EARTH_RADIUS_M * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        }
    };
}

function createPoint(x, y) {
    return {
        x: Number(x),
        y: Number(y),
        add(other) {
            const point = createPoint(other.x, other.y);
            return createPoint(this.x + point.x, this.y + point.y);
        },
        subtract(other) {
            const point = createPoint(other.x, other.y);
            return createPoint(this.x - point.x, this.y - point.y);
        },
        divideBy(num) {
            return createPoint(this.x / num, this.y / num);
        },
        multiplyBy(num) {
            return createPoint(this.x * num, this.y * num);
        },
        floor() {
            return createPoint(Math.floor(this.x), Math.floor(this.y));
        },
        round() {
            return createPoint(Math.round(this.x), Math.round(this.y));
        },
        ceil() {
            return createPoint(Math.ceil(this.x), Math.ceil(this.y));
        },
        distanceTo(other) {
            const point = createPoint(other.x, other.y);
            return Math.hypot(this.x - point.x, this.y - point.y);
        }
    };
}

function normalizeBoundsInput(input) {
    if (Array.isArray(input) && input.length === 2 && !Array.isArray(input[0]) && typeof input[0] === 'object' && 'lat' in input[0]) {
        return [toLngLat(input[0]), toLngLat(input[1])];
    }
    if (Array.isArray(input) && input.length === 2 && Array.isArray(input[0])) {
        return [toLngLat(input[0]), toLngLat(input[1])];
    }
    const points = Array.isArray(input) ? input.map(toLngLat) : [toLngLat(input)];
    let minLat = points[0].lat;
    let maxLat = points[0].lat;
    let minLng = points[0].lng;
    let maxLng = points[0].lng;
    for (const point of points) {
        minLat = Math.min(minLat, point.lat);
        maxLat = Math.max(maxLat, point.lat);
        minLng = Math.min(minLng, point.lng);
        maxLng = Math.max(maxLng, point.lng);
    }
    return [createLatLng(minLat, minLng), createLatLng(maxLat, maxLng)];
}

function createBounds(inputA, inputB) {
    const [southWest, northEast] = inputB ? [toLngLat(inputA), toLngLat(inputB)] : normalizeBoundsInput(inputA);
    return {
        getSouthWest() {
            return createLatLng(southWest.lat, southWest.lng);
        },
        getNorthEast() {
            return createLatLng(northEast.lat, northEast.lng);
        },
        getNorthWest() {
            return createLatLng(northEast.lat, southWest.lng);
        },
        getSouthEast() {
            return createLatLng(southWest.lat, northEast.lng);
        },
        toMapLibreBounds() {
            return [[southWest.lng, southWest.lat], [northEast.lng, northEast.lat]];
        },
        contains(latlng) {
            const point = toLngLat(latlng);
            return point.lat >= southWest.lat &&
                point.lat <= northEast.lat &&
                point.lng >= southWest.lng &&
                point.lng <= northEast.lng;
        },
        pad(ratio) {
            const latPad = (northEast.lat - southWest.lat) * ratio;
            const lngPad = (northEast.lng - southWest.lng) * ratio;
            return createBounds(
                createLatLng(southWest.lat - latPad, southWest.lng - lngPad),
                createLatLng(northEast.lat + latPad, northEast.lng + lngPad)
            );
        }
    };
}

function getOverlayIds(baseId, kind) {
    switch (kind) {
        case 'circle':
            return { sourceId: `${baseId}-source`, fillLayerId: `${baseId}-fill`, lineLayerId: `${baseId}-line` };
        case 'circleMarker':
            return { sourceId: `${baseId}-source`, layerId: `${baseId}-circle` };
        case 'polyline':
            return { sourceId: `${baseId}-source`, layerId: `${baseId}-line` };
        case 'image':
            return { sourceId: `${baseId}-source`, layerId: `${baseId}-raster` };
        case 'tileOverlay':
            return { sourceId: `${baseId}-source`, layerId: `${baseId}-raster` };
        default:
            return { sourceId: `${baseId}-source`, layerId: `${baseId}-layer` };
    }
}

function ensureRemoved(nativeMap, overlay) {
    const ids = overlay._ids || {};
    if (ids.fillLayerId && nativeMap.getLayer(ids.fillLayerId)) nativeMap.removeLayer(ids.fillLayerId);
    if (ids.lineLayerId && nativeMap.getLayer(ids.lineLayerId)) nativeMap.removeLayer(ids.lineLayerId);
    if (ids.layerId && nativeMap.getLayer(ids.layerId)) nativeMap.removeLayer(ids.layerId);
    if (ids.sourceId && nativeMap.getSource(ids.sourceId)) nativeMap.removeSource(ids.sourceId);
}

function circleToPolygon(center, radiusMeters, points = 64) {
    const coords = [];
    const latRad = center.lat * Math.PI / 180;
    for (let index = 0; index <= points; index++) {
        const angle = (index / points) * Math.PI * 2;
        const dLat = (radiusMeters * Math.cos(angle)) / EARTH_RADIUS_M;
        const dLng = (radiusMeters * Math.sin(angle)) / (EARTH_RADIUS_M * Math.cos(latRad));
        coords.push([
            center.lng + (dLng * 180 / Math.PI),
            center.lat + (dLat * 180 / Math.PI)
        ]);
    }
    return {
        type: 'Feature',
        geometry: {
            type: 'Polygon',
            coordinates: [coords]
        }
    };
}

function projectToWorldPoint(latlng, zoom) {
    const point = toLngLat(latlng);
    const scale = 256 * Math.pow(2, zoom);
    const sinLat = Math.sin((point.lat * Math.PI) / 180);
    const clampedSin = Math.min(Math.max(sinLat, -0.9999), 0.9999);
    const x = ((point.lng + 180) / 360) * scale;
    const y = (0.5 - Math.log((1 + clampedSin) / (1 - clampedSin)) / (4 * Math.PI)) * scale;
    return createPoint(x, y);
}

function unprojectWorldPoint(point, zoom) {
    const scale = 256 * Math.pow(2, zoom);
    const lng = (point.x / scale) * 360 - 180;
    const y = 0.5 - (point.y / scale);
    const lat = 90 - (360 * Math.atan(Math.exp(-y * 2 * Math.PI))) / Math.PI;
    return createLatLng(lat, lng);
}

function createMarkerElement(options = {}) {
    if (options.icon && options.icon.options) {
        const iconOptions = options.icon.options;
        const img = document.createElement('img');
        img.src = iconOptions.iconUrl;
        img.alt = '';
        img.draggable = false;
        const size = iconOptions.iconSize || [25, 41];
        img.style.width = `${size[0]}px`;
        img.style.height = `${size[1]}px`;
        img.style.display = 'block';
        return img;
    }
    if (options.icon && options.icon.type === 'divIcon') {
        const wrapper = document.createElement('div');
        wrapper.className = options.icon.options.className || '';
        wrapper.innerHTML = options.icon.options.html || '';
        return wrapper;
    }
    return null;
}

function getMarkerOffset(options = {}, element) {
    if (!options.icon || !options.icon.options) return [0, 0];
    const iconOptions = options.icon.options;
    if (!iconOptions.iconAnchor || !iconOptions.iconSize) return [0, 0];
    const [width, height] = iconOptions.iconSize;
    const [anchorX, anchorY] = iconOptions.iconAnchor;
    return [width / 2 - anchorX, height / 2 - anchorY];
}

function getPopupOptions(options = {}) {
    const popupGap = 8;
    const popupOptions = {
        className: 'result-popup',
        // Raise MapLibre's 240px default so long (4+ digit) result lines size the box
        // to fit instead of crowding the right padding. Short popups stay compact.
        maxWidth: '320px'
    };
    if (!options.icon || !options.icon.options) {
        popupOptions.offset = 18 + popupGap;
        return popupOptions;
    }
    const iconOptions = options.icon.options;
    if (iconOptions.popupAnchor) {
        popupOptions.anchor = 'bottom';
        popupOptions.offset = [iconOptions.popupAnchor[0], iconOptions.popupAnchor[1] - popupGap];
        return popupOptions;
    }
    popupOptions.offset = 18 + popupGap;
    return popupOptions;
}

function createTileLayer(url, options = {}) {
    return {
        type: 'tile',
        url,
        options,
        setUrl(nextUrl) {
            this.url = nextUrl;
            return this;
        },
        addTo(mapInstance) {
            mapInstance.addLayer(this);
            return this;
        },
        remove() {
            if (this._map) {
                this._map.removeLayer(this);
            }
        }
    };
}

function createTileOverlayLayer(url, options = {}) {
    return {
        type: 'tileOverlay',
        _url: url,
        _options: { ...options },
        addTo(mapInstance) {
            mapInstance.addLayer(this);
            return this;
        },
        remove() {
            if (this._map) {
                this._map.removeLayer(this);
            }
        }
    };
}

function createCircleLayer(center, options = {}, isMarker = false) {
    const overlay = {
        type: isMarker ? 'circleMarker' : 'circle',
        _center: toLngLat(center),
        _options: { ...options },
        addTo(mapInstance) {
            mapInstance.addLayer(this);
            return this;
        },
        remove() {
            if (this._map) {
                this._map.removeLayer(this);
            }
        },
        setLatLng(nextCenter) {
            this._center = toLngLat(nextCenter);
            if (this._map) {
                this._map._renderOverlay(this);
            }
            return this;
        },
        setStyle(nextOptions) {
            Object.assign(this._options, nextOptions);
            if (this._map) {
                this._map._renderOverlay(this);
            }
            return this;
        },
        setRadius(radius) {
            this._options.radius = radius;
            if (this._map) {
                this._map._renderOverlay(this);
            }
            return this;
        },
        setOpacity(opacity) {
            this._options.opacity = opacity;
            if (this._map) {
                this._map._renderOverlay(this);
            }
            return this;
        }
    };
    return overlay;
}

function createPolylineLayer(latlngs, options = {}) {
    // Accept either a flat array of points (single line) or a nested array of
    // lines (multi-line), mirroring real Leaflet. A multi-line is detected when
    // the first element is itself an array of points (its first element is an array).
    const isMulti = Array.isArray(latlngs[0]) && Array.isArray(latlngs[0][0]);
    return {
        type: 'polyline',
        _multi: isMulti,
        _latlngs: isMulti
            ? latlngs.map((line) => line.map(toLngLat))
            : latlngs.map(toLngLat),
        _options: { ...options },
        addTo(mapInstance) {
            mapInstance.addLayer(this);
            return this;
        },
        remove() {
            if (this._map) {
                this._map.removeLayer(this);
            }
        }
    };
}

function createMarkerLayer(latlng, options = {}) {
    return {
        type: 'marker',
        _latlng: toLngLat(latlng),
        _options: { ...options },
        _marker: null,
        _popup: null,
        addTo(mapInstance) {
            mapInstance.addLayer(this);
            return this;
        },
        bindPopup(html) {
            this._popup = new maplibregl.Popup(getPopupOptions(this._options)).setHTML(html);
            if (this._marker) {
                this._marker.setPopup(this._popup);
            }
            return this;
        },
        openPopup() {
            if (this._marker && this._popup) {
                const popup = this._marker.getPopup ? this._marker.getPopup() : this._popup;
                if (popup && typeof popup.isOpen === 'function' && !popup.isOpen()) {
                    this._marker.togglePopup();
                }
            }
            return this;
        },
        setLatLng(nextLatLng) {
            this._latlng = toLngLat(nextLatLng);
            if (this._marker) {
                this._marker.setLngLat([this._latlng.lng, this._latlng.lat]);
            }
            return this;
        },
        remove() {
            if (this._popup) {
                this._popup.remove();
            }
            if (this._marker) {
                this._marker.remove();
                this._marker = null;
            }
            this._map = null;
        }
    };
}

function createImageOverlay(url, bounds, options = {}) {
    return {
        type: 'image',
        _url: url,
        _bounds: bounds,
        _options: { ...options },
        addTo(mapInstance) {
            mapInstance.addLayer(this);
            return this;
        },
        setOpacity(opacity) {
            this._options.opacity = opacity;
            if (this._map) {
                this._map._renderOverlay(this);
            }
            return this;
        },
        remove() {
            if (this._map) {
                this._map.removeLayer(this);
            }
        }
    };
}

function createLayerGroup(layersToAdd = []) {
    return {
        type: 'group',
        _layers: layersToAdd,
        addTo(mapInstance) {
            this._map = mapInstance;
            for (const layer of this._layers) {
                layer.addTo(mapInstance);
            }
            return this;
        },
        remove() {
            for (const layer of this._layers) {
                if (layer && typeof layer.remove === 'function') {
                    layer.remove();
                }
            }
            this._map = null;
        }
    };
}

function createControl(options = {}) {
    return {
        options,
        _controlContainer: null,
        addTo(mapInstance) {
            const control = {
                onAdd: () => {
                    const container = this.onAdd(mapInstance);
                    this._controlContainer = container;
                    return container;
                },
                onRemove: () => {
                    if (typeof this.onRemove === 'function') {
                        this.onRemove(mapInstance);
                    }
                    if (this._controlContainer && this._controlContainer.parentNode) {
                        this._controlContainer.parentNode.removeChild(this._controlContainer);
                    }
                    this._controlContainer = null;
                    this._map = null;
                }
            };
            this._control = control;
            this._map = mapInstance;
            mapInstance._map.addControl(control, normalizeControlPosition(options.position));
            return this;
        },
        remove() {
            if (this._map && this._control) {
                this._map._map.removeControl(this._control);
            }
            return this;
        }
    };
}

function toNativeZoom(leafletZoom) {
    return Number(leafletZoom) - 1;
}

function fromNativeZoom(nativeZoom) {
    return Number(nativeZoom) + 1;
}

function createMapAdapter(containerId, options) {
    const initialTileLayer = options.initialTileLayer || null;
    const initialMaxZoom = initialTileLayer
        ? (initialTileLayer.options.maxZoom || 19)
        : 19;
    const initialStyle = initialTileLayer ? {
        version: 8,
        glyphs: GLYPHS_URL,
        sources: {
            basemap: {
                type: 'raster',
                tiles: getTileUrls(initialTileLayer.url),
                tileSize: 256,
                maxzoom: initialTileLayer.options.maxZoom || 19,
                attribution: initialTileLayer.options.attribution || ''
            }
        },
        layers: [{
            id: 'basemap-layer',
            type: 'raster',
            source: 'basemap',
            paint: {
                'raster-opacity': initialTileLayer.options.opacity == null ? 1 : initialTileLayer.options.opacity
            }
        }]
    } : {
        version: 8,
        glyphs: GLYPHS_URL,
        sources: {},
        layers: []
    };

    const nativeMap = new maplibregl.Map({
        container: containerId,
        attributionControl: false,
        style: initialStyle,
        center: [options.center.lng, options.center.lat],
        zoom: toNativeZoom(options.zoom),
        maxZoom: toNativeZoom(getEffectiveLayerMaxZoom(initialMaxZoom)),
        bearing: options.bearing || 0,
        pitch: 0,
        maxPitch: getMaxPitch(),
        dragRotate: true,
        pitchWithRotate: true,
        touchPitch: true,
        boxZoom: options.boxZoom !== false,
        cooperativeGestures: false
    });

    function hasUsableStyle() {
        return Boolean(nativeMap.style && (nativeMap.style.stylesheet || nativeMap.style._loaded));
    }

    const adapter = {
        _map: nativeMap,
        _eventHandlers: new Map(),
        _isLoaded: false,
        _styleReady: false,
        _pendingTileLayer: null,
        _pendingOverlayLayers: new Set(),
        _tileLayer: null,
        _terrain: null,
        _hillshade: { enabled: false, exaggeration: 0.5 },
        _contours: { enabled: false, labels: true },
        _tiltEnabled: options.tiltEnabled !== false,
        _maxZoom: initialMaxZoom,
        _controls: [],
        _overlayOrder: [],
        getContainer() {
            return nativeMap.getContainer();
        },
        setView(center, zoom) {
            const nextCenter = toLngLat(center);
            nativeMap.jumpTo({ center: [nextCenter.lng, nextCenter.lat], zoom: toNativeZoom(zoom) });
            return this;
        },
        addLayer(layer) {
            if (!layer) return this;
            layer._map = this;
            if (layer.type === 'tile') {
                if (!this._styleReady) {
                    this._pendingTileLayer = layer;
                    return this;
                }
                this._setTileLayer(layer);
                return this;
            }
            if (layer.type === 'marker') {
                const element = createMarkerElement(layer._options);
                const markerOptions = element ? { element, offset: getMarkerOffset(layer._options, element) } : {};
                if (element && layer._options.interactive === false) {
                    element.style.pointerEvents = 'none';
                }
                layer._marker = new maplibregl.Marker(markerOptions)
                    .setLngLat([layer._latlng.lng, layer._latlng.lat])
                    .addTo(nativeMap);
                if (layer._popup) {
                    layer._marker.setPopup(layer._popup);
                }
                return this;
            }
            if (layer.type === 'group') {
                layer.addTo(this);
                return this;
            }
            if (!this._styleReady) {
                this._pendingOverlayLayers.add(layer);
                return this;
            }
            this._renderOverlay(layer);
            return this;
        },
        removeLayer(layer) {
            if (!layer) return this;
            if (layer.type === 'tile') {
                if (this._pendingTileLayer === layer) {
                    this._pendingTileLayer = null;
                }
                if (this._tileLayer === layer) {
                    if (nativeMap.getLayer('basemap-layer')) nativeMap.removeLayer('basemap-layer');
                    if (nativeMap.getSource('basemap')) nativeMap.removeSource('basemap');
                    this._tileLayer = null;
                }
                layer._map = null;
                return this;
            }
            if (layer.type === 'marker') {
                layer.remove();
                return this;
            }
            if (layer.type === 'group') {
                layer.remove();
                return this;
            }
            this._pendingOverlayLayers.delete(layer);
            ensureRemoved(nativeMap, layer);
            layer._map = null;
            return this;
        },
        _setTileLayer(layer) {
            if (nativeMap.getLayer('basemap-layer')) nativeMap.removeLayer('basemap-layer');
            if (nativeMap.getSource('basemap')) nativeMap.removeSource('basemap');
            nativeMap.addSource('basemap', {
                type: 'raster',
                tiles: getTileUrls(layer.url),
                tileSize: 256,
                maxzoom: layer.options.maxZoom || 19,
                attribution: layer.options.attribution || ''
            });
            const basemapLayer = {
                id: 'basemap-layer',
                type: 'raster',
                source: 'basemap',
                paint: {
                    'raster-opacity': layer.options.opacity == null ? 1 : layer.options.opacity
                }
            };

            const styleLayers = nativeMap.getStyle() && nativeMap.getStyle().layers
                ? nativeMap.getStyle().layers
                : [];
            const firstOverlayLayer = styleLayers.find((styleLayer) => styleLayer.id !== 'basemap-layer');

            if (firstOverlayLayer) {
                nativeMap.addLayer(basemapLayer, firstOverlayLayer.id);
            } else {
                nativeMap.addLayer(basemapLayer);
            }

            this.setMaxZoom(layer.options.maxZoom || 19);
            this._tileLayer = layer;
        },
        _renderOverlay(layer) {
            if (!this._styleReady) {
                this._pendingOverlayLayers.add(layer);
                return;
            }
            if (!layer._id) {
                layer._id = `overlay-${++mapOverlayId}`;
            }
            layer._ids = getOverlayIds(layer._id, layer.type);
            // Keep every overlay below the GPX track. This is also the re-render path
            // (ensureRemoved + addLayer), so e.g. dragging the slope opacity slider no
            // longer lifts the slope image back over the track.
            const gpxBeforeId = getGpxTopBeforeId(nativeMap);

            if (layer.type === 'circle') {
                const source = nativeMap.getSource(layer._ids.sourceId);
                const circleData = circleToPolygon(layer._center, layer._options.radius || 0);
                if (source) {
                    source.setData(circleData);
                } else {
                    nativeMap.addSource(layer._ids.sourceId, {
                        type: 'geojson',
                        data: circleData
                    });
                }
                if (!nativeMap.getLayer(layer._ids.fillLayerId)) {
                    nativeMap.addLayer({
                        id: layer._ids.fillLayerId,
                        type: 'fill',
                        source: layer._ids.sourceId,
                        paint: {
                            'fill-color': layer._options.fillColor || layer._options.color || '#007bff',
                            'fill-opacity': layer._options.fillOpacity == null ? 0.1 : layer._options.fillOpacity
                        }
                    }, gpxBeforeId);
                }
                if (!nativeMap.getLayer(layer._ids.lineLayerId)) {
                    nativeMap.addLayer({
                        id: layer._ids.lineLayerId,
                        type: 'line',
                        source: layer._ids.sourceId,
                        paint: {
                            'line-color': layer._options.color || '#007bff',
                            'line-width': layer._options.weight || 1,
                            'line-opacity': layer._options.opacity == null ? 1 : layer._options.opacity
                        }
                    }, gpxBeforeId);
                }
                nativeMap.setPaintProperty(layer._ids.fillLayerId, 'fill-color', layer._options.fillColor || layer._options.color || '#007bff');
                nativeMap.setPaintProperty(layer._ids.fillLayerId, 'fill-opacity', layer._options.fillOpacity == null ? 0.1 : layer._options.fillOpacity);
                nativeMap.setPaintProperty(layer._ids.lineLayerId, 'line-color', layer._options.color || '#007bff');
                nativeMap.setPaintProperty(layer._ids.lineLayerId, 'line-width', layer._options.weight || 1);
                nativeMap.setPaintProperty(layer._ids.lineLayerId, 'line-opacity', layer._options.opacity == null ? 1 : layer._options.opacity);
                return;
            }

            if (layer.type === 'circleMarker') {
                const markerSource = nativeMap.getSource(layer._ids.sourceId);
                const markerData = {
                    type: 'Feature',
                    geometry: {
                        type: 'Point',
                        coordinates: [layer._center.lng, layer._center.lat]
                    }
                };
                if (markerSource) {
                    markerSource.setData(markerData);
                } else {
                    nativeMap.addSource(layer._ids.sourceId, {
                        type: 'geojson',
                        data: markerData
                    });
                }
                if (!nativeMap.getLayer(layer._ids.layerId)) {
                    nativeMap.addLayer({
                        id: layer._ids.layerId,
                        type: 'circle',
                        source: layer._ids.sourceId,
                        paint: {
                            'circle-radius': layer._options.radius || 5,
                            'circle-color': layer._options.fillColor || layer._options.color || '#fff',
                            'circle-stroke-color': layer._options.color || '#000',
                            'circle-stroke-width': layer._options.weight || 2,
                            'circle-opacity': layer._options.opacity == null ? 1 : layer._options.opacity
                        }
                    }, gpxBeforeId);
                }
                nativeMap.setPaintProperty(layer._ids.layerId, 'circle-radius', layer._options.radius || 5);
                nativeMap.setPaintProperty(layer._ids.layerId, 'circle-color', layer._options.fillColor || layer._options.color || '#fff');
                nativeMap.setPaintProperty(layer._ids.layerId, 'circle-stroke-color', layer._options.color || '#000');
                nativeMap.setPaintProperty(layer._ids.layerId, 'circle-stroke-width', layer._options.weight || 2);
                nativeMap.setPaintProperty(layer._ids.layerId, 'circle-opacity', layer._options.opacity == null ? 1 : layer._options.opacity);
                return;
            }

            ensureRemoved(nativeMap, layer);

            if (layer.type === 'polyline') {
                const geometry = layer._multi
                    ? {
                        type: 'MultiLineString',
                        coordinates: layer._latlngs.map((line) => line.map((point) => [point.lng, point.lat]))
                    }
                    : {
                        type: 'LineString',
                        coordinates: layer._latlngs.map((point) => [point.lng, point.lat])
                    };
                nativeMap.addSource(layer._ids.sourceId, {
                    type: 'geojson',
                    data: {
                        type: 'Feature',
                        geometry
                    }
                });
                nativeMap.addLayer({
                    id: layer._ids.layerId,
                    type: 'line',
                    source: layer._ids.sourceId,
                    layout: {
                        'line-cap': 'round',
                        'line-join': 'round'
                    },
                    paint: {
                        'line-color': layer._options.color || '#007bff',
                        'line-width': layer._options.weight || 3,
                        'line-opacity': layer._options.opacity == null ? 1 : layer._options.opacity
                    }
                }, gpxBeforeId);
                return;
            }

            if (layer.type === 'image') {
                const bounds = layer._bounds;
                nativeMap.addSource(layer._ids.sourceId, {
                    type: 'image',
                    url: layer._url,
                    coordinates: [
                        [bounds.getNorthWest().lng, bounds.getNorthWest().lat],
                        [bounds.getNorthEast().lng, bounds.getNorthEast().lat],
                        [bounds.getSouthEast().lng, bounds.getSouthEast().lat],
                        [bounds.getSouthWest().lng, bounds.getSouthWest().lat]
                    ]
                });
                nativeMap.addLayer({
                    id: layer._ids.layerId,
                    type: 'raster',
                    source: layer._ids.sourceId,
                    paint: {
                        'raster-opacity': layer._options.opacity == null ? 1 : layer._options.opacity
                    }
                }, gpxBeforeId);
                return;
            }

            if (layer.type === 'tileOverlay') {
                nativeMap.addSource(layer._ids.sourceId, {
                    type: 'raster',
                    tiles: getTileUrls(layer._url),
                    tileSize: 256,
                    maxzoom: layer._options.maxZoom || 19,
                    attribution: layer._options.attribution || ''
                });
                nativeMap.addLayer({
                    id: layer._ids.layerId,
                    type: 'raster',
                    source: layer._ids.sourceId,
                    paint: {
                        'raster-opacity': layer._options.opacity == null ? 1 : layer._options.opacity
                    }
                }, gpxBeforeId);
                return;
            }
        },
        addControl(control, position) {
            nativeMap.addControl(control, normalizeControlPosition(position));
            this._controls.push(control);
            return this;
        },
        removeControl(control) {
            nativeMap.removeControl(control && control._control ? control._control : control);
            return this;
        },
        on(eventName, handler, context) {
            const wrapped = context ? handler.bind(context) : handler;
            this._eventHandlers.set(handler, wrapped);
            const mapped = eventName === 'zoomend' ? 'zoomend' : eventName;
            nativeMap.on(mapped, wrapped);
            return this;
        },
        off(eventName, handler) {
            const wrapped = this._eventHandlers.get(handler) || handler;
            nativeMap.off(eventName, wrapped);
            return this;
        },
        getCenter() {
            const center = nativeMap.getCenter();
            return createLatLng(center.lat, center.lng);
        },
        getZoom() {
            return fromNativeZoom(nativeMap.getZoom());
        },
        setMaxZoom(maxZoom) {
            const nextMaxZoom = Number(maxZoom) || 19;
            this._maxZoom = nextMaxZoom;
            const effectiveMaxZoom = getEffectiveLayerMaxZoom(nextMaxZoom);
            nativeMap.setMaxZoom(toNativeZoom(effectiveMaxZoom));
            if (this.getZoom() > effectiveMaxZoom) {
                nativeMap.jumpTo({ zoom: toNativeZoom(effectiveMaxZoom) });
            }
            return this;
        },
        getMaxZoom() {
            return getEffectiveLayerMaxZoom(this._maxZoom);
        },
        setBearing(bearing) {
            nativeMap.rotateTo(bearing, { duration: 0 });
            return this;
        },
        getBearing() {
            return nativeMap.getBearing();
        },
        setTerrain(terrainOptions) {
            if (!terrainOptions) {
                this._terrain = null;
                if (this._styleReady) {
                    nativeMap.setTerrain(null);
                }
                return this;
            }
            const exaggeration = typeof terrainOptions.exaggeration === 'number'
                ? terrainOptions.exaggeration
                : DEFAULT_TERRAIN_EXAGGERATION;
            this._terrain = {
                source: TERRAIN_SOURCE_ID,
                exaggeration
            };
            if (this._styleReady) {
                ensureTerrainSource();
                nativeMap.setTerrain(this._terrain);
            }
            return this;
        },
        setHillshade(enabled, exaggeration) {
            this._hillshade = {
                enabled: !!enabled,
                exaggeration: typeof exaggeration === 'number' ? exaggeration : this._hillshade.exaggeration
            };
            if (this._styleReady) {
                applyHillshade();
            }
            return this;
        },
        setHillshadeExaggeration(exaggeration) {
            if (typeof exaggeration !== 'number') return this;
            this._hillshade.exaggeration = exaggeration;
            if (this._styleReady && nativeMap.getLayer('hillshade-layer')) {
                nativeMap.setPaintProperty('hillshade-layer', 'hillshade-exaggeration', exaggeration);
            }
            return this;
        },
        setContours(enabled) {
            this._contours.enabled = !!enabled;
            if (this._styleReady) {
                applyContours();
            }
            return this;
        },
        setContourLabels(labels) {
            this._contours.labels = !!labels;
            if (this._styleReady) {
                applyContours();
            }
            return this;
        },
        // Tear the contour source/layers down and rebuild them; used when the unit
        // system changes so the interval and labels regenerate for metres/feet.
        refreshContours() {
            if (!this._styleReady) return this;
            removeContourLayers();
            applyContours();
            return this;
        },
        getPitch() {
            return nativeMap.getPitch();
        },
        setMaxPitch(maxPitch) {
            if (typeof maxPitch === 'number' && Number.isFinite(maxPitch)) {
                nativeMap.setMaxPitch(maxPitch);
            }
            return this;
        },
        setTiltEnabled(enabled) {
            this._tiltEnabled = enabled !== false;
            if (nativeMap.dragRotate) {
                if (this._tiltEnabled && typeof nativeMap.dragRotate.enable === 'function') {
                    nativeMap.dragRotate.enable();
                }
                if (!this._tiltEnabled && typeof nativeMap.dragRotate.disable === 'function') {
                    nativeMap.dragRotate.disable();
                }
            }
            if (nativeMap.touchPitch) {
                if (this._tiltEnabled && typeof nativeMap.touchPitch.enable === 'function') {
                    nativeMap.touchPitch.enable();
                }
                if (!this._tiltEnabled && typeof nativeMap.touchPitch.disable === 'function') {
                    nativeMap.touchPitch.disable();
                }
            }
            return this;
        },
        isTiltEnabled() {
            return this._tiltEnabled;
        },
        easeTo(options) {
            if (!options) return this;
            const nextOptions = { ...options };
            if (typeof nextOptions.zoom === 'number') {
                nextOptions.zoom = toNativeZoom(nextOptions.zoom);
            }
            if (nextOptions.center) {
                const center = toLngLat(nextOptions.center);
                nextOptions.center = [center.lng, center.lat];
            }
            nativeMap.easeTo(nextOptions);
            return this;
        },
        project(latlng, zoom = fromNativeZoom(nativeMap.getZoom())) {
            return projectToWorldPoint(latlng, zoom);
        },
        unproject(point, zoom = fromNativeZoom(nativeMap.getZoom())) {
            return unprojectWorldPoint(point, zoom);
        },
        getSize() {
            const canvasSize = nativeMap.getCanvas();
            return createPoint(canvasSize.clientWidth, canvasSize.clientHeight);
        },
        fitBounds(bounds) {
            nativeMap.fitBounds(bounds.toMapLibreBounds(), { padding: 40, duration: 0 });
            return this;
        },
        getBounds() {
            const bounds = nativeMap.getBounds();
            return createBounds(
                createLatLng(bounds.getSouth(), bounds.getWest()),
                createLatLng(bounds.getNorth(), bounds.getEast())
            );
        },
        dragging: {
            disable() {
                nativeMap.dragPan.disable();
            },
            enable() {
                nativeMap.dragPan.enable();
            }
        }
    };

    function ensureTerrainSource() {
        if (!adapter._styleReady) return false;
        if (nativeMap.getSource(TERRAIN_SOURCE_ID)) {
            return true;
        }
        nativeMap.addSource(TERRAIN_SOURCE_ID, getTerrainSourceDefinition());
        return true;
    }

    function syncTerrain() {
        if (!adapter._styleReady) return;
        ensureTerrainSource();
        nativeMap.setTerrain(adapter._terrain);
    }

    function applyHillshade() {
        if (!adapter._styleReady) return;
        const id = 'hillshade-layer';
        if (adapter._hillshade && adapter._hillshade.enabled) {
            ensureTerrainSource();
            const exaggeration = adapter._hillshade.exaggeration;
            if (!nativeMap.getLayer(id)) {
                // Insert directly above the basemap but below every overlay/marker so the
                // hillshade only shades the basemap (waymarks, climbs, GPX, POI/GPS stay on top).
                const styleLayers = (nativeMap.getStyle() && nativeMap.getStyle().layers) || [];
                const firstOverlayLayer = styleLayers.find((styleLayer) => styleLayer.id !== 'basemap-layer' && styleLayer.id !== id);
                const hillshadeLayer = {
                    id,
                    type: 'hillshade',
                    source: TERRAIN_SOURCE_ID,
                    paint: { 'hillshade-exaggeration': exaggeration }
                };
                if (firstOverlayLayer) {
                    nativeMap.addLayer(hillshadeLayer, firstOverlayLayer.id);
                } else {
                    nativeMap.addLayer(hillshadeLayer);
                }
            } else {
                nativeMap.setPaintProperty(id, 'hillshade-exaggeration', exaggeration);
            }
        } else if (nativeMap.getLayer(id)) {
            nativeMap.removeLayer(id);
        }
    }

    let contourDemSource = null;

    // Lazily build the maplibre-contour DEM source and register its protocol once.
    // Returns false when the library failed to load, so the overlay quietly no-ops.
    function ensureContourSetup() {
        if (contourDemSource) return true;
        if (typeof mlcontour === 'undefined') return false;
        contourDemSource = new mlcontour.DemSource({
            url: getTileUrls(DATA_TILE_URL)[0],
            encoding: 'terrarium',
            maxzoom: ELEVATION_TILE_MAX_ZOOM,
            worker: true
        });
        contourDemSource.setupMaplibre(maplibregl);
        return true;
    }

    // Vector source backed by maplibre-contour. The interval (and the unit the
    // elevations are emitted in) follow the active metric/imperial setting.
    function getContourSourceDefinition() {
        const imperial = getUnitSystem() === 'imperial';
        return {
            type: 'vector',
            tiles: [contourDemSource.contourProtocolUrl({
                multiplier: imperial ? 3.28084 : 1,
                overzoom: 1,
                elevationKey: 'ele',
                levelKey: 'level',
                contourLayer: 'contours',
                thresholds: imperial
                    ? { 11: [500, 2500], 12: [200, 1000], 13: [100, 500], 14: [40, 200], 15: [20, 100] }
                    : { 11: [200, 1000], 12: [100, 500], 13: [50, 250], 14: [20, 100], 15: [10, 50] }
            })],
            maxzoom: ELEVATION_TILE_MAX_ZOOM
        };
    }

    function removeContourLayers() {
        [CONTOUR_LABEL_LAYER_ID, CONTOUR_LINE_LAYER_ID].forEach((layerId) => {
            if (nativeMap.getLayer(layerId)) nativeMap.removeLayer(layerId);
        });
        if (nativeMap.getSource(CONTOUR_SOURCE_ID)) nativeMap.removeSource(CONTOUR_SOURCE_ID);
    }

    // Draw (or remove) the contour line + label layers. Lines sit just above the
    // basemap/hillshade but below every overlay, route and marker.
    function applyContours() {
        if (!adapter._styleReady) return;
        if (!adapter._contours || !adapter._contours.enabled) {
            removeContourLayers();
            return;
        }
        if (!ensureContourSetup()) return; // maplibre-contour unavailable

        if (!nativeMap.getSource(CONTOUR_SOURCE_ID)) {
            nativeMap.addSource(CONTOUR_SOURCE_ID, getContourSourceDefinition());
        }

        // Insert above the basemap/hillshade but below the first overlay/marker layer.
        const styleLayers = (nativeMap.getStyle() && nativeMap.getStyle().layers) || [];
        const reserved = ['basemap-layer', 'hillshade-layer', CONTOUR_LINE_LAYER_ID, CONTOUR_LABEL_LAYER_ID];
        const firstOverlayLayer = styleLayers.find((styleLayer) => !reserved.includes(styleLayer.id));
        const beforeId = firstOverlayLayer ? firstOverlayLayer.id : undefined;

        if (!nativeMap.getLayer(CONTOUR_LINE_LAYER_ID)) {
            nativeMap.addLayer({
                id: CONTOUR_LINE_LAYER_ID,
                type: 'line',
                source: CONTOUR_SOURCE_ID,
                'source-layer': 'contours',
                paint: {
                    'line-color': 'rgba(120, 72, 48, 0.6)',
                    'line-width': ['match', ['get', 'level'], 1, 1.4, 0.6],
                    'line-opacity': ['interpolate', ['linear'], ['zoom'], 10, 0, 11.5, 0.85]
                }
            }, beforeId);
        }

        const wantLabels = !!adapter._contours.labels;
        const hasLabels = !!nativeMap.getLayer(CONTOUR_LABEL_LAYER_ID);
        if (wantLabels && !hasLabels) {
            const imperial = getUnitSystem() === 'imperial';
            nativeMap.addLayer({
                id: CONTOUR_LABEL_LAYER_ID,
                type: 'symbol',
                source: CONTOUR_SOURCE_ID,
                'source-layer': 'contours',
                // Majors only when zoomed out; from native z14 (20 m / 40 ft minors)
                // every line is labelled, so density grows with zoom like the
                // interval thresholds above. Zoom in filters snaps to integers.
                filter: ['step', ['zoom'], ['==', ['get', 'level'], 1], 14, true],
                layout: {
                    'symbol-placement': 'line',
                    'symbol-spacing': ['interpolate', ['linear'], ['zoom'], 11, 500, 15, 250],
                    'text-size': ['interpolate', ['linear'], ['zoom'], 11, 9, 15, 11],
                    'text-field': ['concat', ['number-format', ['get', 'ele'], {}], imperial ? "'" : ' m'],
                    'text-font': [CONTOUR_FONT]
                },
                paint: {
                    'text-color': '#5a3a26',
                    'text-halo-color': 'rgba(255, 255, 255, 0.85)',
                    'text-halo-width': 1
                }
            }, beforeId);
        } else if (!wantLabels && hasLabels) {
            nativeMap.removeLayer(CONTOUR_LABEL_LAYER_ID);
        }
    }

    function flushPendingStyleLayers() {
        if (!adapter._styleReady) return;
        ensureTerrainSource();
        if (adapter._pendingTileLayer) {
            adapter._setTileLayer(adapter._pendingTileLayer);
            adapter._pendingTileLayer = null;
        }
        if (adapter._pendingOverlayLayers.size > 0) {
            const pendingLayers = Array.from(adapter._pendingOverlayLayers);
            adapter._pendingOverlayLayers.clear();
            for (const layer of pendingLayers) {
                if (layer && layer._map === adapter) {
                    adapter._renderOverlay(layer);
                }
            }
        }
        syncTerrain();
        applyHillshade();
        applyContours();
    }

    function markStyleReady() {
        if (!adapter._styleReady && hasUsableStyle()) {
            adapter._styleReady = true;
        }
        if (!adapter._styleReady) {
            return false;
        }
        flushPendingStyleLayers();
        if (!adapter._isLoaded) {
            adapter._isLoaded = true;
            nativeMap.fire('zoomend');
        }
        return true;
    }

    function pollStyleReady() {
        if (markStyleReady()) {
            return;
        }
        window.setTimeout(pollStyleReady, 50);
    }

    nativeMap.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-left');
    nativeMap.on('load', markStyleReady);
    nativeMap.on('styledata', markStyleReady);
    nativeMap.on('zoomend', () => {
        nativeMap.fire('moveend');
    });
    window.requestAnimationFrame(() => {
        nativeMap.resize();
        markStyleReady();
    });
    adapter.setTiltEnabled(adapter._tiltEnabled);
    pollStyleReady();

    return adapter;
}

const L = {
    tileLayer: createTileLayer,
    tileOverlay: createTileOverlayLayer,
    Icon: function Icon(options) { this.options = options; },
    divIcon(options) {
        return { type: 'divIcon', options };
    },
    map(containerId, options) {
        const center = createLatLng(savedLat, savedLng);
        return createMapAdapter(containerId, { ...options, center, zoom: savedZoom });
    },
    control(options = {}) {
        return createControl(options);
    },
    DomUtil: {
        create(tagName, className, parent) {
            const element = document.createElement(tagName);
            if (className) element.className = className;
            if (parent) parent.appendChild(element);
            return element;
        }
    },
    DomEvent: {
        disableClickPropagation(element) {
            ['click', 'dblclick', 'mousedown', 'mouseup', 'touchstart', 'touchend', 'contextmenu'].forEach((eventName) => {
                element.addEventListener(eventName, (event) => event.stopPropagation());
            });
        },
        on(element, eventName, handler) {
            element.addEventListener(eventName, handler);
        },
        preventDefault(event) {
            event.preventDefault();
        }
    },
    Control: {
        extend(definition) {
            return function ControlCtor() {
                Object.assign(this, createControl(definition.options || {}), definition);
                this.options = definition.options || {};
            };
        }
    },
    latLng: createLatLng,
    point: createPoint,
    Point: createPoint,
    latLngBounds: createBounds,
    marker(latlng, options) {
        return createMarkerLayer(latlng, options);
    },
    circle(latlng, options) {
        return createCircleLayer(latlng, options, false);
    },
    circleMarker(latlng, options) {
        return createCircleLayer(latlng, options, true);
    },
    imageOverlay(url, bounds, options) {
        return createImageOverlay(url, bounds, options);
    },
    polyline(latlngs, options) {
        return createPolylineLayer(latlngs, options);
    },
    layerGroup(layersToAdd) {
        return createLayerGroup(layersToAdd);
    }
};

// ==========================================
// 2. DOM ELEMENTS
// ==========================================
const canvas = document.getElementById('analysis-canvas');
const ctx = canvas.getContext('2d', { willReadFrequently: true });
const spCanvas = document.getElementById('single-point-canvas');
const spCtx = spCanvas.getContext('2d', { willReadFrequently: true });

// Create a separate canvas for water analysis (not shown in UI)
const waterCanvas = document.createElement('canvas');
const waterCtx = waterCanvas.getContext('2d', { willReadFrequently: true });

const controls = document.getElementById('controls');
const crosshair = document.getElementById('crosshair');
const centerHeightDisplay = document.getElementById('center-h');

// Crosshair shows when the user preference is on (default) OR while the center is locked.
function syncCrosshairVisibility() {
    if (!crosshair) return;
    const pref = (localStorage.getItem('topo_show_crosshair') !== 'false') || isLocked;
    // Hide while scrubbing the elevation profile so it doesn't overlap the track cursor.
    crosshair.style.display = (pref && !isElevationCursorActive) ? 'block' : 'none';
}

function applyCrosshairColor(c) {
    document.documentElement.style.setProperty('--crosshair-color', c);
}
const scanBtn = document.getElementById('scan-btn');
const climbBtn = document.getElementById('climb-btn');
const slopeBtn = document.getElementById('slope-btn');
const zoomLabel = document.getElementById('zoom-level');
const radiusInput = document.getElementById('radiusInput');
const climbDistInput = document.getElementById('climbDistInput');
const numClimbsInput = document.getElementById('numClimbsInput');
const circleCheckbox = document.getElementById('show-circle');
const lockCheckbox = document.getElementById('lock-circle');
const searchInput = document.getElementById('searchInput');
const statusDiv = document.getElementById('status');
const layerSelect = document.getElementById('layerSelect');
const editKeyBtn = document.getElementById('edit-key-btn');
const shareMapBtn = document.getElementById('share-map-btn');
const extraLayerSelect = document.getElementById('extraLayerSelect');
const overzoomCheckbox = document.getElementById('enableOverzoom');
const tiltCheckbox = document.getElementById('enableTilt');
const enable3dBtn = document.getElementById('enable3dBtn');
const hillshadeBtn = document.getElementById('hillshadeBtn');

// ==========================================
// 3. LANGUAGE & TRANSLATIONS
// ==========================================
const translations = {
    sv: LANG_SV,
    en: LANG_EN
};

clearRefreshUrlFlag();

let waterAnalysisEnabled = false;
let climbStepRes = 10;
let climbScanAngles = 32;
let peakMinPixelDistance = normalizePeakMinPixelDistance(localStorage.getItem('topo_peak_min_pixel_dist'));

function normalizePeakMinPixelDistance(value) {
    const parsed = parseInt(value, 10);
    if (!Number.isFinite(parsed)) return 40;
    return Math.min(200, Math.max(1, parsed));
}

function parseStoredCoordinate(key, fallback) {
    const parsed = parseFloat(localStorage.getItem(key));
    return Number.isFinite(parsed) ? parsed : fallback;
}

function parseStoredZoom(key, fallback) {
    const parsed = parseInt(localStorage.getItem(key), 10);
    return Number.isFinite(parsed) ? parsed : fallback;
}

// ==========================================
// 4. MAP & VARIABLE INITIALIZATION
// ==========================================

const layers = Object.fromEntries(Object.entries(MAP_SOURCES).map(([key, source]) => [key, L.tileLayer(source.url, { attribution: source.attribution, maxZoom: source.maxZoom, opacity: source.opacity })]));

// Icons
const rankIcons = [
    new L.Icon({
        iconUrl: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNSA0MSIgc2hhcGUtcmVuZGVyaW5nPSJnZW9tZXRyaWNQcmVjaXNpb24iPjxwYXRoIGQ9Ik0gMTIuNSAxIEMgNi4xIDEgMSA2LjEgMSAxMi41IEMgMSAyMiAxMi41IDM5LjUgMTIuNSAzOS41IEMgMTIuNSAzOS41IDI0IDIyIDI0IDEyLjUgQyAyNCA2LjEgMTguOSAxIDEyLjUgMSBaIiBmaWxsPSIjRkZCMzAwIiBzdHJva2U9IiNmZmZmZmYiIHN0cm9rZS13aWR0aD0iMS41IiBzdHJva2UtbGluZWpvaW49InJvdW5kIiBzdHJva2UtbGluZWNhcD0icm91bmQiLz48Y2lyY2xlIGN4PSIxMi41IiBjeT0iMTIuNSIgcj0iNy44IiBmaWxsPSIjZmZmZmZmIi8+PHRleHQgeD0iMTIuNSIgeT0iMTYuNSIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iMTEiIGZvbnQtd2VpZ2h0PSI5MDAiIHRleHQtYW5jaG9yPSJtaWRkbGUiIGZpbGw9IiNGRkIzMDAiPjE8L3RleHQ+PC9zdmc+',        iconSize: [28, 45], iconAnchor: [14, 45], popupAnchor: [1, -38]    }),
    new L.Icon({
        iconUrl: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNSA0MSIgc2hhcGUtcmVuZGVyaW5nPSJnZW9tZXRyaWNQcmVjaXNpb24iPjxwYXRoIGQ9Ik0gMTIuNSAxIEMgNi4xIDEgMSA2LjEgMSAxMi41IEMgMSAyMiAxMi41IDM5LjUgMTIuNSAzOS41IEMgMTIuNSAzOS41IDI0IDIyIDI0IDEyLjUgQyAyNCA2LjEgMTguOSAxIDEyLjUgMSBaIiBmaWxsPSIjMkE4MUNCIiBzdHJva2U9IiNmZmZmZmYiIHN0cm9rZS13aWR0aD0iMS41IiBzdHJva2UtbGluZWpvaW49InJvdW5kIiBzdHJva2UtbGluZWNhcD0icm91bmQiLz48Y2lyY2xlIGN4PSIxMi41IiBjeT0iMTIuNSIgcj0iNy44IiBmaWxsPSIjZmZmZmZmIi8+PHRleHQgeD0iMTIuNSIgeT0iMTYuNSIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iMTEiIGZvbnQtd2VpZ2h0PSI5MDAiIHRleHQtYW5jaG9yPSJtaWRkbGUiIGZpbGw9IiMyQTgxQ0IiPjI8L3RleHQ+PC9zdmc+',        iconSize: [25, 41], iconAnchor: [12, 41], popupAnchor: [1, -34]    }),
    new L.Icon({
        iconUrl: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNSA0MSIgc2hhcGUtcmVuZGVyaW5nPSJnZW9tZXRyaWNQcmVjaXNpb24iPjxwYXRoIGQ9Ik0gMTIuNSAxIEMgNi4xIDEgMSA2LjEgMSAxMi41IEMgMSAyMiAxMi41IDM5LjUgMTIuNSAzOS41IEMgMTIuNSAzOS41IDI0IDIyIDI0IDEyLjUgQyAyNCA2LjEgMTguOSAxIDEyLjUgMSBaIiBmaWxsPSIjMkE4MUNCIiBzdHJva2U9IiNmZmZmZmYiIHN0cm9rZS13aWR0aD0iMS41IiBzdHJva2UtbGluZWpvaW49InJvdW5kIiBzdHJva2UtbGluZWNhcD0icm91bmQiLz48Y2lyY2xlIGN4PSIxMi41IiBjeT0iMTIuNSIgcj0iNy44IiBmaWxsPSIjZmZmZmZmIi8+PHRleHQgeD0iMTIuNSIgeT0iMTYuNSIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iMTEiIGZvbnQtd2VpZ2h0PSI5MDAiIHRleHQtYW5jaG9yPSJtaWRkbGUiIGZpbGw9IiMyQTgxQ0IiPjM8L3RleHQ+PC9zdmc+',        iconSize: [25, 41], iconAnchor: [12, 41], popupAnchor: [1, -34]    })
];
const greenIcon = new L.Icon({
    iconUrl: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNSA0MSIgc2hhcGUtcmVuZGVyaW5nPSJnZW9tZXRyaWNQcmVjaXNpb24iPjxwYXRoIGQ9Ik0gMTIuNSAxIEMgNi4xIDEgMSA2LjEgMSAxMi41IEMgMSAyMiAxMi41IDM5LjUgMTIuNSAzOS41IEMgMTIuNSAzOS41IDI0IDIyIDI0IDEyLjUgQyAyNCA2LjEgMTguOSAxIDEyLjUgMSBaIiBmaWxsPSIjMkFBRDI3IiBzdHJva2U9IiNmZmZmZmYiIHN0cm9rZS13aWR0aD0iMS41IiBzdHJva2UtbGluZWpvaW49InJvdW5kIiBzdHJva2UtbGluZWNhcD0icm91bmQiLz48Y2lyY2xlIGN4PSIxMi41IiBjeT0iMTIuNSIgcj0iNCIgZmlsbD0iI2ZmZmZmZiIvPjwvc3ZnPg==',    iconSize: [25, 41], iconAnchor: [12, 41], popupAnchor: [1, -34]});
const redIcon = new L.Icon({
    iconUrl: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNSA0MSIgc2hhcGUtcmVuZGVyaW5nPSJnZW9tZXRyaWNQcmVjaXNpb24iPjxwYXRoIGQ9Ik0gMTIuNSAxIEMgNi4xIDEgMSA2LjEgMSAxMi41IEMgMSAyMiAxMi41IDM5LjUgMTIuNSAzOS41IEMgMTIuNSAzOS41IDI0IDIyIDI0IDEyLjUgQyAyNCA2LjEgMTguOSAxIDEyLjUgMSBaIiBmaWxsPSIjQ0IyQjNFIiBzdHJva2U9IiNmZmZmZmYiIHN0cm9rZS13aWR0aD0iMS41IiBzdHJva2UtbGluZWpvaW49InJvdW5kIiBzdHJva2UtbGluZWNhcD0icm91bmQiLz48Y2lyY2xlIGN4PSIxMi41IiBjeT0iMTIuNSIgcj0iNCIgZmlsbD0iI2ZmZmZmZiIvPjwvc3ZnPg==',    iconSize: [25, 41], iconAnchor: [12, 41], popupAnchor: [1, -34]});

// --- Points of Interest (POI) ---------------------------------------------
// Every POI uses the same teardrop pin (like the rank markers) with a star in
// the white center; only the color varies. Colors come from a fixed palette.
const POI_COLORS = ['#2e8b57', '#2A81CB', '#CB2B3E', '#F39C12', '#7E57C2', '#D81B60', '#546E7A'];
const POI_DEFAULT_COLOR = '#2e8b57';

function makePoiIcon(color) {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 25 41" shape-rendering="geometricPrecision">'
        + '<path d="M 12.5 1 C 6.1 1 1 6.1 1 12.5 C 1 22 12.5 39.5 12.5 39.5 C 12.5 39.5 24 22 24 12.5 C 24 6.1 18.9 1 12.5 1 Z" fill="' + color + '" stroke="#ffffff" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/>'
        + '<circle cx="12.5" cy="12.5" r="7.8" fill="#ffffff"/>'
        + '<polygon points="12.5,6 14,10.4 18.7,10.5 15,13.3 16.3,17.8 12.5,15.1 8.7,17.8 10,13.3 6.3,10.5 11,10.4" fill="' + color + '"/>'
        + '</svg>';
    return new L.Icon({
        iconUrl: 'data:image/svg+xml,' + encodeURIComponent(svg),        iconSize: [28, 45], iconAnchor: [14, 45], popupAnchor: [1, -38]    });
}

const poiIconCache = {};
function poiIconFor(color) {
    const c = color || POI_DEFAULT_COLOR;
    if (!poiIconCache[c]) poiIconCache[c] = makePoiIcon(c);
    return poiIconCache[c];
}

let markers = [];
let polylines = [];
let poiList = [];
let poiMarkers = [];
let poiLayerVisible = (localStorage.getItem('topo_show_poi') !== '0'); // default on
// Cache the signed-in POIs so their pins stay visible after logout / on reload.
const POI_CACHE_STORAGE_KEY = 'topo_poi_cache';
function savePoiCache() {
    try { localStorage.setItem(POI_CACHE_STORAGE_KEY, JSON.stringify(poiList)); } catch (e) { /* storage unavailable */ }
}
function loadPoiCache() {
    try {
        const parsed = JSON.parse(localStorage.getItem(POI_CACHE_STORAGE_KEY));
        return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
        return [];
    }
}
let poiPlacementMode = false;
let poiPlacementMoveId = null; // id of the POI being relocated, or null when placing a new one
let poiFormState = null; // { id?, lat, lng, elevation } while the form modal is open
let poiFormSelectedColor = POI_DEFAULT_COLOR;
let manualClimbMode = false;
let manualClimbPoints = [];    // L.latLng objects
let manualClimbMarkers = [];   // native maplibregl.Marker objects (preview dots)
let manualClimbPolyline = null; // L.polyline (blue preview line)
let gpsMarker = null;          // native maplibregl.Marker for live GPS position
let gpsAccuracyCircle = null;  // L.circle showing GPS margin of error (meters)
let gpsWatchId = null;         // navigator.geolocation watch id (null = tracking off)
let lastGpsPosition = null;    // {lat, lng} of the most recent GPS fix, or null when tracking is off
let gpsHasCentered = false;    // true once a fix has recentered the map; keeps later fixes from moving it
let slopeOverlay = null;
let extraOverlayLayer = null;
let slopeLegend = null;
let gpxSlopeLegend = null;
let routeLegend = null;        // L.control instance for the route-names legend
let routeLegendEl = null;      // live .route-legend DOM element (for the stale/refresh state)
let routeLegendStatus = null;  // last rendered legend status ('list'|'zoom'|'empty'|'error'|'loading')
let routeLegendCollapsed = localStorage.getItem(ROUTE_LEGEND_COLLAPSED_KEY) !== 'false'; // legend collapsed to its title bar (collapsed by default)
let lastRouteItems = [];       // last rendered list items (for re-render on isolate/clear)
let isolatedRouteId = null;    // relation id of the trail isolated on the map, or null
let isolatedColor = '#1565C0'; // draw color for the isolated trail
let isolatedTrailLayers = [];  // drawn L.polyline layers for the isolated trail
let isolatedFetchAbort = null; // AbortController for the segments request
let restoreIsolatedPending = null; // { id, color } to re-isolate once the legend list first loads
let routeNamesOn = false;      // "Show route names" toggle state
let routeFetchAbort = null;    // AbortController for the in-flight Overpass request
let routeRefreshTimer = null;  // debounce timer for legend refresh
let slopeMapCenter = null;
let slopeMapRadius = 0;
let slopeMapUsesRadius = false;
let gpxTrackData = null; // stores parsed GPX stats for info panel
let currentMarkers = [];
let currentKmMarkers = [];
// Active GPX source + uploaded-files list (backend-only; inert without a backend)
let currentSharedGpxId = null;
let currentGpxFilename = null;
let currentGpxShareUrl = null;
let currentGpxRawText = null;     // raw GPX text of the active route (for download/rename)
let currentGpxRawFilename = null; // original filename of the active route (download default name)
let uploadedGpxFiles = [];
let uploadedGpxListState = 'idle';
// Track editing. gpxEditState holds the working copy + handles while gpxEditMode is on;
// gpxTextIsGenerated marks currentGpxRawText as re-serialized (no longer the user's bytes).
let gpxEditMode = false;
let gpxEditState = null;
let _gpxEditRenderDebounce = null;
let gpxTextIsGenerated = false;
// Last routing choice, shared by the Create Route panel and the track editor: the profile a
// route is drawn with is the one its later edits should re-route with, and a user who turned
// snapping off once did not mean "until you next open the editor".
let routingPrefs = { profile: GPX_EDIT_DEFAULT_PROFILE, snap: true };
// Create route. routeCreateState.start is the first click; `busy` covers the routing
// request, during which further map clicks are ignored but Cancel still works.
let routeCreateMode = false;
let routeCreateState = null;
let searchCircle = null;
let centerMarker = null;
let isLocked = false;
let lockedCenterCoords = null;
let isControlsMinimized = false;
let currentLayer = null;
let previousLayerValue = "opentopo";
let pendingServiceKey = null;
let analysisZoom = null;
let analysisNwOrigin = null;
let analysisBounds = null;
let deferredInstallPrompt = null;

function isSupportedLayer(layerKey) {
    return Boolean(layerKey) && Boolean(layers[layerKey]);
}

function parseSharedMapHash(hashValue) {
    const hash = (hashValue || '').replace(/^#/, '');
    if (!hash) return null;
    const segments = hash.split('&');
    const mapSeg = segments.find((s) => s.startsWith('map='));
    if (!mapSeg) return null;

    const parts = mapSeg.slice(4).split('/');
    if (parts.length < 3) return null;

    const zoom = parseInt(parts[0], 10);
    const lat = parseFloat(parts[1]);
    const lng = parseFloat(parts[2]);
    const layer = parts[3] || null;

    if (!Number.isFinite(zoom) || !Number.isFinite(lat) || !Number.isFinite(lng)) {
        return null;
    }

    if (zoom < 1 || zoom > 22 || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
        return null;
    }

    // Optional shared trail selection (&route=<overlay>/<id>/<colorHexNoHash>).
    let route = null;
    const routeSeg = segments.find((s) => s.startsWith('route='));
    if (routeSeg) {
        const rp = routeSeg.slice(6).split('/');
        const overlay = decodeURIComponent(rp[0] || '');
        const id = parseInt(rp[1], 10);
        const color = rp[2] ? '#' + rp[2] : '#1565C0';
        const name = rp[3] ? decodeURIComponent(rp[3]) : '';
        if (OVERLAY_SOURCES[overlay] && Number.isFinite(id) && id > 0) {
            route = { overlay, id, color, name };
        }
    }

    return {
        zoom,
        lat,
        lng,
        layer: isSupportedLayer(layer) ? layer : null,
        route
    };
}

// Browser-language fallback: Swedish ('sv', 'sv-SE', ...) -> sv, anything else -> en.
// Only sv/en exist in translations, so non-Swedish collapses to the en default.
function detectBrowserLang() {
    const candidates = navigator.languages && navigator.languages.length
        ? navigator.languages
        : [navigator.language || ''];
    return candidates.some(l => /^sv\b/i.test(l)) ? 'sv' : 'en';
}

function resolveInitialAppState() {
    const params = new URLSearchParams(location.search);
    const requestedLang = params.get('lang');
    const storedLang = localStorage.getItem('topo_lang');
    const langChosen = localStorage.getItem('topo_lang_chosen');
    const sharedMapState = parseSharedMapHash(location.hash);
    // Precedence: explicit ?lang= -> a previously chosen language -> auto-detect
    // from the browser. Auto-detect re-runs every visit until the user overrides.
    let initialLang;
    if (translations[requestedLang]) {
        initialLang = requestedLang;
    } else if (langChosen && translations[storedLang]) {
        initialLang = storedLang;
    } else {
        initialLang = detectBrowserLang();
    }

    let initialLayer = localStorage.getItem('topo_layer') || 'opentopo';
    if (!isSupportedLayer(initialLayer)) {
        initialLayer = 'opentopo';
    }

    if (sharedMapState && sharedMapState.layer) {
        initialLayer = sharedMapState.layer;
    }

    return {
        lang: initialLang,
        lat: sharedMapState ? sharedMapState.lat : parseStoredCoordinate('topo_lat', 67.89),
        lng: sharedMapState ? sharedMapState.lng : parseStoredCoordinate('topo_lng', 18.52),
        zoom: sharedMapState ? sharedMapState.zoom : parseStoredZoom('topo_zoom', 11),
        layer: initialLayer
    };
}

const initialAppState = resolveInitialAppState();
const hasSharedMapView = Boolean(parseSharedMapHash(location.hash));
const hasSharedGpxLink = new URLSearchParams(location.search).has('gpx');
const sharedRoute = (parseSharedMapHash(location.hash) || {}).route || null;
let pendingRouteFit = false; // fit map to the full shared trail once it draws
let currentLang = initialAppState.lang;
const savedLat = initialAppState.lat;
const savedLng = initialAppState.lng;
const savedZoom = initialAppState.zoom;
let savedLayer = initialAppState.layer;

if (!layers[savedLayer]) {
    savedLayer = "opentopo";
}

const initialMapLayer = layers.opentopo;

// MapLibre v6 is ESM-only, so maplibre-boot.mjs loads as a module script — and browsers block
// module fetches from file:// URLs (null origin). Opening index.html straight from disk
// therefore leaves `maplibregl` undefined and every call below throws "maplibregl is not
// defined" into the console while the page just sits there blank. Say what happened instead.
function showMapEngineError() {
    const t = translations[currentLang] || translations.en || {};
    const message = location.protocol === 'file:'
        ? (t.err_map_engine_file || "TopoScout can't run from a file:// URL: the map engine loads as an ES module, which browsers refuse to fetch from the local filesystem. Serve the folder over http instead — for example `uvicorn main:app --port 8000`, then open http://localhost:8000/. Installing the app still gives you full offline use.")
        : (t.err_map_engine || 'The map engine failed to load. Check your connection and reload the page.');
    const overlay = document.createElement('div');
    overlay.className = 'map-boot-error';
    const paragraph = document.createElement('p');
    paragraph.textContent = message; // never innerHTML — same rule as the rest of the app
    overlay.appendChild(paragraph);
    (document.getElementById('map') || document.body).appendChild(overlay);
}

if (typeof maplibregl === 'undefined') {
    showMapEngineError();
    // Deliberately aborts the rest of script.js: nothing below works without a map, and the
    // overlay covers the control panel that would otherwise sit there looking operational.
    throw new Error('MapLibre GL JS did not load'
        + (location.protocol === 'file:' ? ' (file:// is unsupported — serve the app over http)' : ''));
}

// Create the map
const map = L.map('map', {
    zoomControl: false,
    boxZoom: false,
    rotate: true,
    touchRotate: true,
    rotateControl: false,
    bearing: 0,
    initialTileLayer: initialMapLayer
}).setView([savedLat, savedLng], savedZoom);
// Default MapLibre navigation controls: zoom in/out + built-in compass (reset
// north + visualize pitch). The compass is auto-hidden while north-up below.
map.addControl(new maplibregl.NavigationControl({ showCompass: true, visualizePitch: true }), 'bottom-right');

// Hide the built-in compass when the map is north-up (bearing 0) and reveal it
// once rotated, keeping the corner uncluttered while still matching the default look.
function updateNorthUpState() {
    document.body.classList.toggle('north-up', map.getBearing() === 0);
}
map.on('rotate', updateNorthUpState);
map.on('rotateend', updateNorthUpState);
updateNorthUpState();

// GPS / locate control — a single-button group placed above the navigation
// controls. Reuses locateUser() so it shares the live-tracking toggle and marker
// with the search-panel GPS button (both carry the .gps-toggle active state).
const GpsControl = L.Control.extend({
    options: { position: 'bottomright' },
    onAdd: function () {
        const container = L.DomUtil.create('div', 'maplibregl-ctrl maplibregl-ctrl-group gps-control');
        const btn = L.DomUtil.create('button', 'maplibregl-ctrl-geolocate gps-ctrl-btn gps-toggle', container);
        const t = translations[currentLang] || {};
        const label = t.btn_gps || 'GPS';
        btn.type = 'button';
        btn.title = label;
        btn.setAttribute('aria-label', label);
        // Use MapLibre's official geolocate icon (supplied by maplibre-gl.css via the
        // .maplibregl-ctrl-geolocate class) rather than an inline SVG.
        btn.innerHTML = '<span class="maplibregl-ctrl-icon" aria-hidden="true"></span>';
        L.DomEvent.disableClickPropagation(container);
        L.DomEvent.on(btn, 'click', function (e) {
            L.DomEvent.preventDefault(e);
            locateUser();
        });
        return container;
    }
});
new GpsControl().addTo(map);

// Lift the GPS control to the top of the bottom-right corner so it sits above
// the navigation controls (it is added after the NavigationControl above).
(function placeGpsAboveNav() {
    const corner = document.querySelector('.maplibregl-ctrl-bottom-right');
    const gps = corner && corner.querySelector('.gps-control');
    if (corner && gps && corner.firstChild !== gps) {
        corner.insertBefore(gps, corner.firstChild);
    }
})();

// ==========================================
// 5. FUNCTIONS
// ==========================================

function isWaterPixel(r, g, b) {
    return Math.abs(r - WATER_COLOR.r) <= WATER_TOLERANCE &&
        Math.abs(g - WATER_COLOR.g) <= WATER_TOLERANCE &&
        Math.abs(b - WATER_COLOR.b) <= WATER_TOLERANCE;
}

function getCurrentMapHash() {
    const center = map.getCenter();
    const zoom = Math.round(map.getZoom());
    const lat = center.lat.toFixed(5);
    const lng = center.lng.toFixed(5);
    const activeLayer = (layerSelect && layerSelect.value) || localStorage.getItem('topo_layer') || savedLayer || 'opentopo';
    let hash = '#map=' + zoom + '/' + lat + '/' + lng + '/' + activeLayer;
    // Include the selected (isolated) trail so the recipient sees the same route.
    if (isolatedRouteId != null && isOverlayOn()) {
        const overlayKey = extraLayerSelect ? extraLayerSelect.value : '';
        const colorHex = String(isolatedColor || '').replace('#', '');
        // Carry the route name too, so the recipient's minimized legend can show it
        // even when zoomed out (the by_area list that supplies names won't have loaded).
        const isolatedItem = lastRouteItems.find((it) => it.id === isolatedRouteId);
        const nameEnc = encodeURIComponent(isolatedItem ? isolatedItem.name : '');
        hash += '&route=' + encodeURIComponent(overlayKey) + '/' + isolatedRouteId + '/' + colorHex + '/' + nameEnc;
    }
    return hash;
}

function getCurrentShareLink() {
    const params = new URLSearchParams();
    if (isBackendEnabled() && currentSharedGpxId) {
        params.set('gpx', currentSharedGpxId);
    }
    params.set('lang', currentLang);
    return location.origin + location.pathname + '?' + params.toString() + getCurrentMapHash();
}

function fallbackCopyTextToClipboard(text) {
    const textArea = document.createElement('textarea');
    textArea.value = text;
    textArea.setAttribute('readonly', '');
    textArea.style.position = 'fixed';
    textArea.style.top = '0';
    textArea.style.left = '-9999px';
    document.body.appendChild(textArea);

    const selection = document.getSelection();
    const previousRange = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;

    textArea.focus();
    textArea.select();
    textArea.setSelectionRange(0, textArea.value.length);

    let didCopy = false;
    try {
        didCopy = document.execCommand('copy');
    } catch (err) {
        didCopy = false;
    }

    document.body.removeChild(textArea);
    if (selection) {
        selection.removeAllRanges();
        if (previousRange) {
            selection.addRange(previousRange);
        }
    }

    return didCopy;
}

async function copyTextToClipboard(text, successMessage, errorMessage) {
    let didCopy = false;

    if (navigator.clipboard && navigator.clipboard.writeText) {
        try {
            await navigator.clipboard.writeText(text);
            didCopy = true;
        } catch (err) {
            didCopy = fallbackCopyTextToClipboard(text);
        }
    } else {
        didCopy = fallbackCopyTextToClipboard(text);
    }

    if (didCopy) {
        statusDiv.textContent = successMessage;
        return;
    }

    window.prompt('Copy this link:', text);
    statusDiv.textContent = errorMessage;
}

window.generateShareLink = function () {
    const t = translations[currentLang];
    const link = getCurrentShareLink();
    const successMessage = isBackendEnabled() && currentSharedGpxId
        ? (t.status_gpx_share_copied || t.status_link_copied || 'Link copied to clipboard.')
        : (t.status_link_copied || 'Link copied to clipboard.');
    copyTextToClipboard(
        link,
        successMessage,
        t.status_clipboard_error || 'Could not copy link.'
    );
};

window.copyUploadedGpxLink = function (gpxId) {
    const t = translations[currentLang];
    if (!isBackendEnabled()) {
        return copyTextToClipboard(
            getCurrentShareLink(),
            t.status_link_copied || 'Link copied to clipboard.',
            t.status_clipboard_error || 'Could not copy link.'
        );
    }
    const params = new URLSearchParams();
    params.set('gpx', gpxId);
    const link = location.origin + location.pathname + '?' + params.toString();
    copyTextToClipboard(
        link,
        t.status_gpx_share_copied || t.status_link_copied || 'Link copied to clipboard.',
        t.status_clipboard_error || 'Could not copy link.'
    );
};

window.deleteUploadedGpx = async function (gpxId) {
    const t = translations[currentLang];
    if (!gpxId) return;
    if (!isBackendEnabled()) {
        statusDiv.textContent = t.status_backend_disabled || 'Backend sharing is disabled in this build.';
        return;
    }

    const fileEntry = uploadedGpxFiles.find(file => file.id === gpxId);
    const filename = fileEntry && fileEntry.filename ? fileEntry.filename : 'GPX file';
    const confirmMessage = (t.confirm_delete_uploaded_gpx || 'Delete "{name}"?').replace('{name}', filename);
    if (!window.confirm(confirmMessage)) {
        return;
    }

    statusDiv.textContent = t.status_deleting_gpx || t.status_loading || 'Loading data...';
    try {
        const response = await fetchWithAuthRetry(() => fetch(API_BASE + '/files/' + encodeURIComponent(gpxId), {
            method: 'DELETE',
            credentials: 'same-origin',
            headers: authHeaders()
        }));
        if (!response.ok) {
            throw new Error('Failed to delete GPX');
        }

        if (currentSharedGpxId === gpxId) {
            window.clearGpxRoute();
        }

        await refreshUploadedFiles();
        statusDiv.textContent = (t.status_gpx_deleted || 'GPX file deleted.').replace('{name}', filename);
    } catch (err) {
        statusDiv.textContent = t.status_delete_gpx_error || 'Could not delete the GPX file.';
    }
};

window.renameUploadedGpx = async function (gpxId) {
    const t = translations[currentLang];
    if (!gpxId) return;
    if (!isBackendEnabled()) {
        statusDiv.textContent = t.status_backend_disabled || 'Backend sharing is disabled in this build.';
        return;
    }

    const fileEntry = uploadedGpxFiles.find(file => file.id === gpxId);
    const currentName = fileEntry && fileEntry.filename ? fileEntry.filename : 'GPX file';
    const promptMessage = (t.prompt_rename_gpx || 'New name for "{name}":').replace('{name}', currentName);
    const input = window.prompt(promptMessage, currentName);
    if (input === null) return;
    const newName = sanitizeGpxFilename(input) + '.gpx';

    statusDiv.textContent = t.status_renaming_gpx || t.status_loading || 'Loading data...';
    try {
        const response = await fetchWithAuthRetry(() => fetch(API_BASE + '/files/' + encodeURIComponent(gpxId), {
            method: 'PATCH',
            credentials: 'same-origin',
            headers: Object.assign({ 'Content-Type': 'application/json' }, authHeaders()),
            body: JSON.stringify({ filename: newName })
        }));
        if (!response.ok) {
            throw new Error('Failed to rename GPX');
        }

        // Keep the active route's displayed/download filename in sync.
        if (currentSharedGpxId === gpxId) {
            currentGpxFilename = newName;
            currentGpxRawFilename = newName;
        }

        await refreshUploadedFiles();
        statusDiv.textContent = (t.status_gpx_renamed || 'Renamed to {name}.').replace('{name}', newName);
    } catch (err) {
        statusDiv.textContent = t.status_rename_gpx_error || 'Could not rename the GPX file.';
    }
};

function updateLanguage() {
    const t = translations[currentLang];
    const isEn = currentLang === 'en';

    const languageSelect = document.getElementById('language-select');
    if (languageSelect) languageSelect.value = '';

    if (document.getElementById('app-title')) {
        document.getElementById('app-title').textContent = t.title;
        document.title = t.title;
        document.getElementById('liveLabel').textContent = t.live_label;
        // Tile labels are static text now, written here rather than rebuilt on every pan.
        const zoomLbl = document.getElementById('lbl-zoom');
        if (zoomLbl) zoomLbl.textContent = t.zoom_label || 'Zoom';
        const scaleLbl = document.getElementById('lbl-scale');
        if (scaleLbl) scaleLbl.textContent = t.scale_label || 'Scale';
        // The footer shows no words, so the label that used to explain the distance survives
        // only as the pin's tooltip and its accessible name.
        const gpsPair = document.getElementById('center-gps-dist');
        if (gpsPair) {
            const gpsLabel = t.center_to_gps_label || 'Center to GPS';
            gpsPair.title = gpsLabel;
            gpsPair.setAttribute('aria-label', gpsLabel);
        }
        document.getElementById('lbl-layers').textContent = t.lbl_layers;
        document.getElementById('lbl-radius').textContent = t.lbl_radius + ' (' + distUnitLabel() + '):';
        document.getElementById('lbl-points').textContent = t.lbl_points;
        document.getElementById('lbl-show-circle').textContent = t.lbl_show_circle;
        document.querySelector('#lbl-lock-circle .btn-label').textContent = t.lbl_lock_circle;
        if (document.getElementById('lbl-enable-overzoom')) document.getElementById('lbl-enable-overzoom').textContent = t.lbl_enable_overzoom;
        if (document.getElementById('lbl-show-crosshair')) document.getElementById('lbl-show-crosshair').textContent = t.lbl_show_crosshair;
        if (document.getElementById('lbl-crosshair-color')) document.getElementById('lbl-crosshair-color').textContent = t.lbl_crosshair_color;
        if (document.getElementById('lbl-enable-hillshade-slider')) document.getElementById('lbl-enable-hillshade-slider').textContent = t.lbl_enable_hillshade_slider;
        if (document.getElementById('lbl-enable-contours')) document.getElementById('lbl-enable-contours').textContent = t.lbl_enable_contours;
        if (document.getElementById('lbl-enable-contour-labels')) document.getElementById('lbl-enable-contour-labels').textContent = t.lbl_enable_contour_labels;
        if (document.getElementById('lbl-show-zoom')) document.getElementById('lbl-show-zoom').textContent = t.lbl_show_zoom;
        if (document.getElementById('lbl-show-scale')) document.getElementById('lbl-show-scale').textContent = t.lbl_show_scale;
        if (document.getElementById('lbl-show-center-gps')) document.getElementById('lbl-show-center-gps').textContent = t.lbl_show_center_gps;
        if (document.getElementById('lbl-show-coords')) document.getElementById('lbl-show-coords').textContent = t.lbl_show_coords;
        // Advanced-settings help tooltips: fill each row's tip text + the icon's accessible label.
        ['crosshair-color', 'enable-exaggeration-slider', 'enable-hillshade-slider', 'enable-contours', 'enable-contour-labels', 'show-zoom', 'show-scale', 'show-center-gps', 'show-coords', 'elev-map-sync', 'enable-tilt', 'max-pitch', 'enable-overzoom', 'show-crosshair', 'water-analysis', 'step-size', 'peak-min-pixels', 'scan-angles'].forEach((base) => {
            const tipText = t['tip_' + base.replace(/-/g, '_')];
            if (!tipText) return;
            const tipEl = document.getElementById('tip-' + base);
            if (tipEl) tipEl.textContent = tipText;
            const helpEl = document.getElementById('help-' + base);
            if (helpEl) helpEl.setAttribute('aria-label', tipText);
        });
        if (hillshadeBtn) {
            const hillshadeLabel = t.btn_hillshade || 'Hillshade';
            hillshadeBtn.title = hillshadeLabel;
            hillshadeBtn.setAttribute('aria-label', hillshadeLabel);
        }
        const hillshadeSliderControl = document.getElementById('hillshade-slider-control');
        if (hillshadeSliderControl) {
            const opacityLabel = t.lbl_hillshade_opacity || 'Hillshade opacity';
            hillshadeSliderControl.title = opacityLabel;
            hillshadeSliderControl.setAttribute('aria-label', opacityLabel);
        }
        if (document.getElementById('lbl-extra-layer-select')) document.getElementById('lbl-extra-layer-select').textContent = t.lbl_extra_layer_select;
        if (extraLayerSelect) {
            const noneOpt = extraLayerSelect.querySelector('option[value="none"]');
            if (noneOpt) noneOpt.textContent = t.overlay_none;
        }
        if (routeLegend) refreshRouteLegend();
        if (document.getElementById('lbl-enable-tilt')) document.getElementById('lbl-enable-tilt').textContent = t.lbl_enable_tilt;
        if (document.getElementById('lbl-max-pitch')) document.getElementById('lbl-max-pitch').textContent = t.lbl_max_pitch;
        if (enable3dBtn) enable3dBtn.title = t.lbl_enable_3d;
        if (document.getElementById('lbl-enable-exaggeration-slider')) document.getElementById('lbl-enable-exaggeration-slider').textContent = t.lbl_enable_exaggeration_slider;
        const exaggerationSliderControl = document.getElementById('exaggeration-slider-control');
        if (exaggerationSliderControl) {
            const exaggerationLabel = t.lbl_3d_exaggeration || '3D Exaggeration';
            exaggerationSliderControl.title = exaggerationLabel;
            exaggerationSliderControl.setAttribute('aria-label', exaggerationLabel);
        }
        document.querySelector('#scan-btn .btn-label').textContent = t.btn_scan;
        document.getElementById('lbl-climb-dist').textContent = t.lbl_climb_dist + ' (' + elevUnitLabel() + '):';
        document.getElementById('lbl-num-climbs').textContent = t.lbl_num_climbs;
        document.querySelector('#climb-btn .btn-label').textContent = t.btn_climb;
        document.querySelector('#clear-btn .btn-label').textContent = t.btn_clear;

        document.getElementById('searchInput').placeholder = t.input_search_ph;
        document.getElementById('searchInput').title = t.input_search_title || '';
        document.getElementById('status').textContent = t.status_ready;

        document.getElementById('info-title').textContent = t.info_title;
        document.getElementById('info-desc').innerHTML = t.info_desc;

        const tutBtn = document.getElementById('start-tutorial-btn');
        if (tutBtn) tutBtn.querySelector('.btn-label').textContent = t.btn_tutorial;
        document.getElementById('lbl-version').textContent = t.lbl_version;
        document.getElementById('app-version').textContent = APP_VERSION;
        if (document.getElementById('app-build')) document.getElementById('app-build').textContent = BUILD_NUMBER;
        if (document.getElementById('info-changelog-title')) document.getElementById('info-changelog-title').textContent = t.info_changelog_title;
        document.getElementById('info-privacy').textContent = t.info_privacy;
        if (document.getElementById('info-advanced-title')) document.getElementById('info-advanced-title').textContent = t.advanced_settings;
        if (document.getElementById('info-debug-title')) document.getElementById('info-debug-title').textContent = t.debug_settings;
        if (document.getElementById('lbl-water-analysis')) document.getElementById('lbl-water-analysis').textContent = t.lbl_water_analysis;
        if (document.getElementById('lbl-step-size')) document.getElementById('lbl-step-size').textContent = t.lbl_step_size + ' (' + elevUnitLabel() + '):';
        if (document.getElementById('lbl-peak-min-pixels')) document.getElementById('lbl-peak-min-pixels').textContent = t.lbl_peak_min_pixels;
        if (document.getElementById('lbl-scan-angles')) document.getElementById('lbl-scan-angles').textContent = t.lbl_scan_angles;
        if (document.getElementById('slope-btn')) document.querySelector('#slope-btn .btn-label').textContent = t.btn_slope;
        if (document.getElementById('lbl-slope-filter')) document.getElementById('lbl-slope-filter').textContent = t.lbl_slope_filter;
        if (document.getElementById('lbl-slope-min')) document.getElementById('lbl-slope-min').textContent = t.lbl_slope_min;
        if (document.getElementById('lbl-slope-max')) document.getElementById('lbl-slope-max').textContent = t.lbl_slope_max;
        if (document.getElementById('lbl-slope-opacity')) document.getElementById('lbl-slope-opacity').textContent = t.lbl_slope_opacity;
        if (document.getElementById('section-points-title')) document.getElementById('section-points-title').textContent = t.section_points_title;
        if (document.getElementById('section-climbs-title')) document.getElementById('section-climbs-title').textContent = t.section_climbs_title;
        if (document.getElementById('section-slope-title')) document.getElementById('section-slope-title').textContent = t.section_slope_title;
        if (document.getElementById('section-routes-title')) document.getElementById('section-routes-title').textContent = t.section_routes_title;
        if (document.getElementById('gpx-btn')) document.querySelector('#gpx-btn .btn-label').textContent = t.btn_gpx;
        if (document.getElementById('gpx-clear-btn')) document.querySelector('#gpx-clear-btn .btn-label').textContent = t.btn_gpx_clear;
        if (document.getElementById('gpx-download-btn')) document.querySelector('#gpx-download-btn .btn-label').textContent = t.btn_gpx_download;
        // Covers the Edit button label, the panel labels/options and the button states.
        _updateGpxEditUI();
        // Covers the Create Route button label, its panel labels/options and step text.
        _updateRouteCreateUI();
        // Covers the floating route panel's title and toggle label.
        _updateRouteInfoUI();
        const mcToggle = document.getElementById('manual-climb-toggle-btn');
        if (mcToggle) {
            mcToggle.querySelector('.btn-label').textContent = t.btn_manual_climb;
        }
        const mcCalc = document.getElementById('manual-climb-calc-btn');
        if (mcCalc) mcCalc.textContent = t.btn_manual_climb_calculate;
        const mcCancel = document.getElementById('manual-climb-cancel-btn');
        if (mcCancel) {
            mcCancel.title = t.btn_cancel || 'Cancel';
            mcCancel.setAttribute('aria-label', t.btn_cancel || 'Cancel');
        }
        _updateManualClimbUI();
        if (document.getElementById('lbl-track-color')) document.getElementById('lbl-track-color').textContent = t.lbl_track_color;
        if (document.getElementById('lbl-track-width')) document.getElementById('lbl-track-width').textContent = t.lbl_track_width;
        if (document.getElementById('lbl-km-labels')) document.getElementById('lbl-km-labels').textContent = t.lbl_km_labels;
        if (document.getElementById('lbl-color-slope')) document.getElementById('lbl-color-slope').textContent = t.lbl_color_slope;
        if (document.getElementById('lbl-show-waypoints')) document.getElementById('lbl-show-waypoints').textContent = t.lbl_show_waypoints;
        if (document.getElementById('lbl-show-minmax')) document.getElementById('lbl-show-minmax').textContent = t.lbl_show_minmax;
        if (document.getElementById('opt-units-metric')) document.getElementById('opt-units-metric').textContent = t.units_metric;
        if (document.getElementById('opt-units-imperial')) document.getElementById('opt-units-imperial').textContent = t.units_imperial;
        if (document.getElementById('lbl-show-elev-profile')) document.getElementById('lbl-show-elev-profile').textContent = t.lbl_show_elev_profile;
        if (document.getElementById('lbl-elev-map-sync')) document.getElementById('lbl-elev-map-sync').textContent = t.lbl_elev_map_sync;
        if (document.getElementById('elevation-profile-title')) document.getElementById('elevation-profile-title').textContent = t.elevation_profile;
        const gpxModalTitle = document.getElementById('gpx-modal-title');
        if (gpxModalTitle) gpxModalTitle.textContent = t.modal_gpx_title || t.btn_gpx;
        const gpxModalDesc = document.getElementById('gpx-modal-desc');
        if (gpxModalDesc) gpxModalDesc.textContent = isBackendEnabled() ? (t.modal_gpx_desc || '') : (t.modal_gpx_desc_local || '');
        const gpxUploadBtn = document.getElementById('gpx-upload-btn');
        if (gpxUploadBtn) gpxUploadBtn.textContent = isBackendEnabled() ? (t.btn_upload_gpx || t.btn_gpx) : (t.btn_open_local_gpx || t.btn_gpx);
        const gpxModalClose = document.getElementById('gpx-modal-close');
        if (gpxModalClose) gpxModalClose.textContent = t.btn_close;
        const gpxAuthDesc = document.getElementById('gpx-auth-desc');
        if (gpxAuthDesc) gpxAuthDesc.textContent = t.gpx_auth_desc || '';
        const gpxSignoutBtn = document.getElementById('gpx-signout-btn');
        if (gpxSignoutBtn) gpxSignoutBtn.textContent = t.btn_sign_out || '';
        const uploadedGpxTitle = document.getElementById('uploaded-gpx-title');
        if (uploadedGpxTitle) uploadedGpxTitle.textContent = isBackendEnabled() ? (t.uploaded_gpx_title || '') : (t.uploaded_gpx_title_local || '');
        renderUploadedFiles();
        _updateRouteInfoPanel();

        // POI labels
        if (document.getElementById('poi-btn')) document.querySelector('#poi-btn .btn-label').textContent = t.btn_add_poi;
        if (document.getElementById('lbl-show-poi')) document.getElementById('lbl-show-poi').textContent = t.lbl_show_poi;
        const poiPlaceLabel = document.getElementById('btn-place-poi-label');
        if (poiPlaceLabel) poiPlaceLabel.textContent = t.btn_place_poi;
        const poiModalTitle = document.getElementById('poi-modal-title');
        if (poiModalTitle) poiModalTitle.textContent = t.poi_modal_title || '';
        const poiModalDesc = document.getElementById('poi-modal-desc');
        if (poiModalDesc) poiModalDesc.textContent = t.poi_modal_desc || '';
        const poiAuthDesc = document.getElementById('poi-auth-desc');
        if (poiAuthDesc) poiAuthDesc.textContent = t.poi_auth_desc || '';
        const poiSignout = document.getElementById('poi-signout-btn');
        if (poiSignout) poiSignout.textContent = t.btn_sign_out || '';
        const poiListTitle = document.getElementById('poi-list-title');
        if (poiListTitle) poiListTitle.textContent = t.poi_list_title || '';
        const poiModalClose = document.getElementById('poi-modal-close');
        if (poiModalClose) poiModalClose.textContent = t.btn_close;
        const poiNameLabel = document.getElementById('poi-form-name-label');
        if (poiNameLabel) poiNameLabel.textContent = t.poi_form_name_label || '';
        const poiDescLabel = document.getElementById('poi-form-desc-label');
        if (poiDescLabel) poiDescLabel.textContent = t.poi_form_desc_label || '';
        const poiColorLabel = document.getElementById('poi-form-color-label');
        if (poiColorLabel) poiColorLabel.textContent = t.poi_form_color_label || '';
        const poiFormCancel = document.getElementById('poi-form-cancel');
        if (poiFormCancel) poiFormCancel.textContent = t.btn_cancel;
        const poiFormSave = document.getElementById('poi-form-save');
        if (poiFormSave) poiFormSave.textContent = t.btn_save;
        renderPoiList();
        const waterToggle = document.getElementById('water-analysis-toggle');
        if (waterToggle) waterToggle.checked = waterAnalysisEnabled;
        const stepInput = document.getElementById('stepSizeInput');
        if (stepInput) stepInput.value = climbStepDisplayValue();
        const peakMinPixelInput = document.getElementById('peakMinPixelDistInput');
        if (peakMinPixelInput) peakMinPixelInput.value = peakMinPixelDistance;
        const anglesInput = document.getElementById('scanAnglesInput');
        if (anglesInput) anglesInput.value = climbScanAngles;
        document.getElementById('info-close').textContent = t.btn_close;
        const infoRefresh = document.getElementById('info-refresh');
        if (infoRefresh && !infoRefresh.disabled) infoRefresh.textContent = t.btn_refresh_app;

        document.getElementById('modal-save').textContent = t.btn_save;
        document.getElementById('modal-cancel').textContent = t.btn_cancel;
        document.getElementById('api-key-input').placeholder = t.input_api_ph;

        if (layerSelect) {
            for (let i = 0; i < layerSelect.options.length; i++) {
                const val = layerSelect.options[i].value;
                if (val === 'lm_map') layerSelect.options[i].text = t.layer_lm_map;
                else if (val === 'norges_map') layerSelect.options[i].text = t.layer_norges_map;
                else if (val === 'satellite') layerSelect.options[i].text = t.layer_satellite + " (ESRI)";
                else if (val === 'debug') layerSelect.options[i].text = t.layer_debug;
            }
        }

        // Install button and mobile install bar
        const installBtn = document.getElementById('install-app-btn');
        if (installBtn) installBtn.querySelector('.btn-label').textContent = t.btn_install_app;
        const installMsg = document.getElementById('mobile-install-msg');
        if (installMsg) installMsg.textContent = t.mobile_install_msg;
        const mobileInstallBtn = document.getElementById('mobile-install-btn');
        if (mobileInstallBtn) mobileInstallBtn.textContent = t.btn_install;
        const iosInstallTitle = document.getElementById('ios-install-title');
        if (iosInstallTitle) iosInstallTitle.textContent = t.ios_install_title;
        const iosInstallIntro = document.getElementById('ios-install-intro');
        if (iosInstallIntro) iosInstallIntro.textContent = t.ios_install_intro;
        const iosInstallStep1 = document.getElementById('ios-install-step1');
        if (iosInstallStep1) iosInstallStep1.textContent = t.ios_install_step1;
        const iosInstallStep2 = document.getElementById('ios-install-step2');
        if (iosInstallStep2) iosInstallStep2.textContent = t.ios_install_step2;
        const iosInstallStep3 = document.getElementById('ios-install-step3');
        if (iosInstallStep3) iosInstallStep3.textContent = t.ios_install_step3;
        const iosInstallClose = document.getElementById('ios-install-close');
        if (iosInstallClose) iosInstallClose.textContent = t.ios_install_close;
        const languageLabel = document.getElementById('lbl-language');
        if (languageLabel) languageLabel.textContent = t.lbl_language || 'Select Language';
        const infoBtn = document.querySelector('.info-btn');
        if (infoBtn) {
            const label = t.btn_info_panel || 'Info';
            infoBtn.title = label;
            infoBtn.setAttribute('aria-label', label);
        }
        const toggleBtn = document.querySelector('.toggle-btn');
        if (toggleBtn) {
            const toggleLabel = getControlsToggleLabel(isControlsMinimized);
            toggleBtn.title = toggleLabel;
            toggleBtn.setAttribute('aria-label', toggleLabel);
        }
        const editKeyBtn = document.getElementById('edit-key-btn');
        if (editKeyBtn) {
            const label = t.btn_api_key || 'API';
            editKeyBtn.title = label;
            editKeyBtn.setAttribute('aria-label', label);
        }
        const gpsLabel = t.btn_gps || 'GPS';
        document.querySelectorAll('.gps-toggle').forEach((gpsBtn) => {
            gpsBtn.title = gpsLabel;
            gpsBtn.setAttribute('aria-label', gpsLabel);
        });
        // Localize the built-in MapLibre compass tooltip (its native locale is set
        // at map construction and doesn't react to runtime language switches).
        const resetNorthLabel = t.btn_reset_north || 'Reset bearing to north';
        const compassBtn = document.querySelector('.maplibregl-ctrl-compass');
        if (compassBtn) {
            compassBtn.title = resetNorthLabel;
            compassBtn.setAttribute('aria-label', resetNorthLabel);
        }
        const searchBtn = document.querySelector('.search-group .icon-btn[onclick="searchLocation()"]');
        if (searchBtn) {
            const label = t.btn_search || 'Search';
            searchBtn.title = label;
            searchBtn.setAttribute('aria-label', label);
        }
        const lockRadiusLabel = document.getElementById('lbl-lock-circle');
        if (lockRadiusLabel) {
            lockRadiusLabel.title = t.lbl_lock_radius_title || 'Lock';
        }
        if (shareMapBtn) {
            shareMapBtn.title = t.btn_share_map_title || 'Share Map View';
            shareMapBtn.setAttribute('aria-label', t.btn_share_map_title || 'Share Map View');
        }
    }
}

function setLanguage(lang) {
    if (lang !== 'en' && lang !== 'sv') return;
    currentLang = lang;
    localStorage.setItem('topo_lang', currentLang);
    // Mark this as a deliberate user choice so auto-detection no longer overrides it.
    localStorage.setItem('topo_lang_chosen', '1');
    updateLanguage();
}

function handleLayerChange(layerKey) {
    localStorage.setItem('topo_layer', layerKey);

    if (lockedServices[layerKey]) {
        const service = lockedServices[layerKey];
        const savedKey = localStorage.getItem(service.storageKey);

        if (savedKey) {
            loadLockedLayer(layerKey, savedKey);
            switchLayerTo(layerKey);
            if (editKeyBtn) editKeyBtn.style.display = 'block';
        } else {
            showKeyModal(layerKey);
        }
    } else {
        if (editKeyBtn) editKeyBtn.style.display = 'none';
        switchLayerTo(layerKey);
    }
}

function getCurrentLayerBaseMaxZoom() {
    if (currentLayer && currentLayer.options) {
        return currentLayer.options.maxZoom || 19;
    }
    const activeLayerKey = layerSelect && layers[layerSelect.value]
        ? layerSelect.value
        : savedLayer;
    const activeLayer = layers[activeLayerKey] || layers.opentopo;
    return activeLayer && activeLayer.options ? (activeLayer.options.maxZoom || 19) : 19;
}

function applyCurrentLayerMaxZoom() {
    map.setMaxZoom(getCurrentLayerBaseMaxZoom());
}

function getTerrainExaggeration() {
    let val;
    try {
        val = parseFloat(localStorage.getItem(EXAGGERATION_VALUE_KEY));
    } catch (error) {
        val = NaN;
    }
    return Number.isFinite(val) ? val : DEFAULT_TERRAIN_EXAGGERATION;
}

// The tilt cap (degrees) chosen under Advanced settings. It bounds manual pitch
// gestures and is the angle the Tilt/3D buttons ease to. Clamped to MapLibre's range.
function getMaxPitch() {
    let val;
    try {
        val = parseFloat(localStorage.getItem(MAX_PITCH_KEY));
    } catch (error) {
        val = NaN;
    }
    if (!Number.isFinite(val)) val = DEFAULT_MAX_PITCH;
    return Math.min(MAPLIBRE_MAX_PITCH, Math.max(0, val));
}

function is3dEnabled() {
    return !!(enable3dBtn && enable3dBtn.classList.contains('active'));
}

function syncTerrainControls() {
    if (enable3dBtn) enable3dBtn.classList.toggle('active', is3dEnabled());
}

function setTerrainEnabled(enabled) {
    if (enable3dBtn) enable3dBtn.classList.toggle('active', enabled);
    syncExaggerationSlider();
    if (!map) return;
    if (enabled) {
        map.setTerrain({ exaggeration: getTerrainExaggeration() });
        map.easeTo({ pitch: getMaxPitch(), duration: 1000 });
        return;
    }
    map.setTerrain(null);
    map.easeTo({ pitch: 0, duration: 1000 });
}

function setTiltEnabled(enabled) {
    if (!map) return;
    map.setTiltEnabled(enabled);
    if (!enabled && !is3dEnabled() && map.getPitch() > 0) {
        map.easeTo({ pitch: 0, duration: 300 });
    }
}

window.toggle3dView = function () {
    setTerrainEnabled(!is3dEnabled());
};

function isHillshadeEnabled() {
    try {
        return localStorage.getItem(HILLSHADE_ENABLED_KEY) === 'true';
    } catch (error) {
        return false;
    }
}

function isContoursEnabled() {
    try {
        return localStorage.getItem(CONTOURS_ENABLED_KEY) === 'true';
    } catch (error) {
        return false;
    }
}

// Labels default on (only the absence of an explicit 'false' matters), so enabling
// contours shows labelled major lines out of the box.
function isContourLabelsEnabled() {
    try {
        return localStorage.getItem(CONTOUR_LABELS_KEY) !== 'false';
    } catch (error) {
        return true;
    }
}

function syncHillshadeControls() {
    if (hillshadeBtn) hillshadeBtn.classList.toggle('active', isHillshadeEnabled());
}

function setHillshadeEnabled(enabled) {
    try {
        localStorage.setItem(HILLSHADE_ENABLED_KEY, enabled);
    } catch (error) { /* storage unavailable */ }
    if (hillshadeBtn) hillshadeBtn.classList.toggle('active', !!enabled);
    if (map) map.setHillshade(!!enabled, getHillshadeExaggeration());
    syncHillshadeSlider();
}

window.toggleHillshade = function () {
    setHillshadeEnabled(!isHillshadeEnabled());
};

// Show/hide the on-map opacity slider based on the Advanced-settings preference.
function syncHillshadeSlider() {
    const control = document.getElementById('hillshade-slider-control');
    if (!control) return;
    let show = false;
    try {
        show = localStorage.getItem(HILLSHADE_SLIDER_KEY) === 'true';
    } catch (error) { /* storage unavailable */ }
    // Only show the opacity slider when its setting is on AND hillshade is enabled.
    show = show && isHillshadeEnabled();
    control.classList.toggle('visible', show);
    updateMapSliderChrome();
}

function syncExaggerationSlider() {
    const control = document.getElementById('exaggeration-slider-control');
    if (!control) return;
    let show = false;
    try {
        show = localStorage.getItem(EXAGGERATION_SLIDER_KEY) === 'true';
    } catch (error) { /* storage unavailable */ }
    // Only show the exaggeration slider when its setting is on AND 3D is enabled.
    show = show && is3dEnabled();
    control.classList.toggle('visible', show);
    updateMapSliderChrome();
}

// The on-map slider stack occupies the bottom-left corner, so temporarily hide the
// attribution control (and any slope legend) it replaces whenever a slider is
// visible. Done via a body class + CSS rather than hiding the whole corner: the
// GPS + nav groups moved into this corner while the route legend is shown on
// mobile must stay visible.
function updateMapSliderChrome() {
    const anyVisible = !!document.querySelector('#map-slider-stack .map-slider.visible');
    document.body.classList.toggle('map-sliders-on', anyVisible);
    adjustMapControlsForElevation();
}

function switchLayerTo(layerKey) {
    if (currentLayer) map.removeLayer(currentLayer);
    currentLayer = layers[layerKey];
    if (currentLayer) {
        map.addLayer(currentLayer);
        previousLayerValue = layerKey;
    }
}

function applyExtraOverlay(key) {
    removeExtraOverlay();
    const cfg = OVERLAY_SOURCES[key];
    if (!cfg) return;
    extraOverlayLayer = L.tileOverlay(cfg.url, { attribution: cfg.attribution, maxZoom: cfg.maxZoom, opacity: 1 }).addTo(map);
    refreshRouteLegend();
}

function removeExtraOverlay() {
    if (extraOverlayLayer) {
        map.removeLayer(extraOverlayLayer);
        extraOverlayLayer = null;
    }
}

function isOverlayOn() {
    return !!(extraLayerSelect && extraLayerSelect.value && extraLayerSelect.value !== 'none');
}

function handleExtraLayerChange(key) {
    const targetIsOverlay = !!(key && key !== 'none' && OVERLAY_SOURCES[key]);
    const targetIsWmt = targetIsOverlay && !!OVERLAY_WMT_ACTIVITY[key];
    // Keep a selected (isolated) route when moving to a non-Waymarked overlay such as the
    // Strava heatmap; any other change drops it (and its persistence).
    const keepIsolated = isolatedRouteId != null && targetIsOverlay && !targetIsWmt;
    if (!keepIsolated) {
        removeIsolatedTrailLayers();
        persistIsolatedSelection();
    }
    if (targetIsOverlay) {
        applyExtraOverlay(key);
        localStorage.setItem(EXTRA_OVERLAY_STORAGE_KEY, key);
        // The route-names legend applies only to the Waymarkedtrails overlays; other
        // overlays (e.g. the Strava heatmap) have no such legend.
        if (targetIsWmt) {
            routeNamesOn = true;
            refreshRouteLegend();
        } else {
            routeNamesOn = false;
            removeRouteLegend();
            // Trail kept: raise it above the just-added heatmap raster (which stays visible
            // beneath it).
            if (keepIsolated) liftIsolatedTrailToTop();
        }
    } else {
        removeExtraOverlay();
        removeRouteLegend();
        localStorage.setItem(EXTRA_OVERLAY_STORAGE_KEY, '');
        routeNamesOn = false;
    }
    updateZoomControlVisibility();
}

// --- Route-names legend (Waymarkedtrails by_area API) ----------------------
// Swatch color by network level (Waymarkedtrails "group": INT/NAT/REG/LOC).
const WMT_GROUP_COLORS = { INT: '#e6194B', NAT: '#f58231', REG: '#3cb44b', LOC: '#4363d8' };

function escapeHtmlText(value) {
    return String(value)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function wmtGroupColor(group) {
    return WMT_GROUP_COLORS[(group || '').toUpperCase()] || '#888888';
}

// WGS84 lon/lat -> EPSG:3857 (Web Mercator) metres; the by_area API takes a 3857 bbox.
function lonLatToMerc(lon, lat) {
    const R = 6378137;
    const clampedLat = Math.max(-85.05112878, Math.min(85.05112878, lat));
    const x = R * lon * Math.PI / 180;
    const y = R * Math.log(Math.tan(Math.PI / 4 + (clampedLat * Math.PI / 180) / 2));
    return [x, y];
}

// EPSG:3857 (Web Mercator) metres -> WGS84 lon/lat; the segments API returns 3857 coords.
function mercToLonLat(x, y) {
    const R = 6378137;
    const lon = (x / R) * 180 / Math.PI;
    const lat = (2 * Math.atan(Math.exp(y / R)) - Math.PI / 2) * 180 / Math.PI;
    return [lon, lat];
}

// The Waymarkedtrails activity subdomain for the overlay currently shown, or null
// when the legend should not query (legend off, overlay off, or unmapped overlay).
function activeWmtActivity() {
    if (!routeNamesOn || !extraOverlayLayer) return null;
    const key = extraLayerSelect ? extraLayerSelect.value : '';
    return OVERLAY_WMT_ACTIVITY[key] || null;
}

// Debounced entry point: call on overlay change, toggle, or map move.
function refreshRouteLegend() {
    if (routeRefreshTimer) clearTimeout(routeRefreshTimer);
    routeRefreshTimer = setTimeout(doRouteLegendFetch, 400);
}

async function doRouteLegendFetch() {
    const activity = activeWmtActivity();
    if (!activity) { removeRouteLegend(); return; }
    if (map.getZoom() < ROUTE_LEGEND_MIN_ZOOM) { renderRouteLegend({ status: 'zoom' }); return; }

    if (routeFetchAbort) routeFetchAbort.abort();
    routeFetchAbort = new AbortController();
    const signal = routeFetchAbort.signal;
    renderRouteLegend({ status: 'loading' });

    const b = map.getBounds();
    const sw = b.getSouthWest();
    const ne = b.getNorthEast();
    const [minx, miny] = lonLatToMerc(sw.lng, sw.lat);
    const [maxx, maxy] = lonLatToMerc(ne.lng, ne.lat);
    const bbox = `${minx.toFixed(1)},${miny.toFixed(1)},${maxx.toFixed(1)},${maxy.toFixed(1)}`;
    const url = `https://${activity}.waymarkedtrails.org/api/v1/list/by_area?bbox=${bbox}&limit=100`;

    try {
        const res = await fetch(url, { signal });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const data = await res.json();
        const byName = new Map();
        for (const r of (data.results || [])) {
            const name = r.name || r.ref || '(unnamed)';
            if (!byName.has(name)) {
                byName.set(name, {
                    id: r.id,
                    color: wmtGroupColor(r.group),
                    symbol: r.symbol_id
                        ? `https://${activity}.waymarkedtrails.org/api/v1/symbols/id/${encodeURIComponent(r.symbol_id)}.svg`
                        : null
                });
            }
        }
        const items = [...byName.entries()]
            .map(([name, v]) => ({ name, id: v.id, color: v.color, symbol: v.symbol }))
            .sort((a, b) => a.name.localeCompare(b.name));
        // Restore a persisted trail selection once the list (and the map/overlay) are ready.
        if (restoreIsolatedPending && isolatedRouteId == null) {
            isolatedRouteId = restoreIsolatedPending.id;
            isolatedColor = restoreIsolatedPending.color;
            restoreIsolatedPending = null;
            setExtraOverlayRasterOpacity(0);
            fetchAndDrawTrail(isolatedRouteId);
        }
        renderRouteLegend({ status: items.length ? 'list' : 'empty', items });
    } catch (err) {
        if (err && err.name === 'AbortError') return;
        renderRouteLegend({ status: 'error' });
    }
}

function renderRouteLegend(state) {
    removeLegendControl(routeLegend);
    routeLegend = null;
    routeLegendStatus = state.status;
    const t = translations[currentLang];
    routeLegend = L.control({ position: 'bottomright' });
    if (state.items) lastRouteItems = state.items;
    routeLegend.onAdd = function () {
        const div = L.DomUtil.create('div', 'route-legend' + (isolatedRouteId != null ? ' isolated' : '') + (routeLegendCollapsed ? ' collapsed' : ''));
        const showRefresh = state.status !== 'loading';
        const collapseLabel = routeLegendCollapsed ? (t.route_legend_expand || 'Expand') : (t.route_legend_collapse || 'Collapse');
        const count = (state.status === 'list' && state.items) ? state.items.length : 0;
        const countLabel = count > 0 ? ` <span class="route-legend-count">(${count})</span>` : '';
        const isolatedItem = isolatedRouteId != null ? lastRouteItems.find((it) => it.id === isolatedRouteId) : null;
        const swatchHtml = (item) => `<span class="route-legend-color" style="background:${item.color}"></span>`;
        const symbolHtml = (item) => item.symbol
            ? `<img class="route-legend-symbol" src="${item.symbol}" alt="" loading="lazy" onerror="this.style.display='none'">`
            : '';
        const badgeHtml = (item) => item.symbol ? symbolHtml(item) : swatchHtml(item);
        const defaultTitleHtml = `${t.route_legend_title}${countLabel}`;
        // When minimized with a single trail isolated, show that trail's color swatch, symbol and name in the header.
        const collapsedNameHtml = isolatedItem ? `${swatchHtml(isolatedItem)}${symbolHtml(isolatedItem)}${escapeHtmlText(isolatedItem.name)}` : '';
        const titleHtml = (routeLegendCollapsed && isolatedItem) ? collapsedNameHtml : defaultTitleHtml;
        const titleAttr = (routeLegendCollapsed && isolatedItem) ? ` title="${escapeHtmlText(isolatedItem.name)}"` : '';
        let html = `<div class="route-legend-header"><span class="route-legend-title"${titleAttr}>${titleHtml}</span><span class="route-legend-actions">`;
        if (showRefresh) {
            html += `<button class="route-legend-refresh" title="${t.route_legend_refresh}" aria-label="${t.route_legend_refresh}">`
                  + `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M17.65 6.35A7.95 7.95 0 0 0 12 4a8 8 0 1 0 7.74 10h-2.08A6 6 0 1 1 12 6c1.66 0 3.14.69 4.22 1.78L13 11h7V4z"/></svg>`
                  + `</button>`;
        }
        html += `<button class="route-legend-collapse" title="${collapseLabel}" aria-label="${collapseLabel}" aria-expanded="${routeLegendCollapsed ? 'false' : 'true'}">`
              + `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M7 10l5 5 5-5z"/></svg>`
              + `</button>`;
        html += `</span></div>`;
        html += `<div class="route-legend-body">`;
        const msg = {
            loading: t.route_legend_loading,
            zoom: t.route_legend_zoom,
            error: t.route_legend_error,
            empty: t.route_legend_empty
        }[state.status];
        if (msg) {
            html += `<div class="route-legend-msg">${msg}</div>`;
        } else {
            for (const item of state.items) {
                const badge = badgeHtml(item);
                const active = item.id === isolatedRouteId ? ' active' : '';
                html += `<div class="route-legend-item${active}" data-route-id="${item.id}" data-route-color="${item.color}">${badge}<span class="route-legend-name" title="${escapeHtmlText(item.name)}">${escapeHtmlText(item.name)}</span></div>`;
            }
            if (state.extra > 0) html += `<div class="route-legend-msg">+${state.extra}…</div>`;
        }
        html += `<div class="route-legend-footer">&copy; <a href="https://waymarkedtrails.org/" target="_blank" rel="noopener">Waymarked Trails</a> / OSM</div>`;
        html += `</div>`; // .route-legend-body
        div.innerHTML = html;
        const collapseBtn = div.querySelector('.route-legend-collapse');
        // Clicking anywhere on the header toggles collapse (the refresh button below
        // stops propagation so it never triggers a toggle).
        const header = div.querySelector('.route-legend-header');
        if (header) header.addEventListener('click', (e) => {
            e.stopPropagation();
            routeLegendCollapsed = !routeLegendCollapsed;
            localStorage.setItem(ROUTE_LEGEND_COLLAPSED_KEY, routeLegendCollapsed);
            div.classList.toggle('collapsed', routeLegendCollapsed);
            const titleSpan = div.querySelector('.route-legend-title');
            if (titleSpan) {
                if (routeLegendCollapsed && isolatedItem) {
                    titleSpan.innerHTML = collapsedNameHtml;
                    titleSpan.title = isolatedItem.name;
                } else {
                    titleSpan.innerHTML = defaultTitleHtml;
                    titleSpan.removeAttribute('title');
                }
            }
            if (collapseBtn) {
                collapseBtn.setAttribute('aria-expanded', routeLegendCollapsed ? 'false' : 'true');
                const label = routeLegendCollapsed ? (t.route_legend_expand || 'Expand') : (t.route_legend_collapse || 'Collapse');
                collapseBtn.title = label;
                collapseBtn.setAttribute('aria-label', label);
            }
        });
        const refreshBtn = div.querySelector('.route-legend-refresh');
        if (refreshBtn) refreshBtn.addEventListener('click', (e) => { e.stopPropagation(); doRouteLegendFetch(); });
        div.querySelectorAll('.route-legend-item').forEach((el) => {
            el.addEventListener('click', (e) => {
                e.stopPropagation();
                const rid = Number(el.dataset.routeId);
                if (Number.isFinite(rid)) toggleIsolateTrail(rid, el.dataset.routeColor);
            });
        });
        routeLegendEl = div;
        return div;
    };
    routeLegend.addTo(map);
}

function removeRouteLegend() {
    if (routeRefreshTimer) { clearTimeout(routeRefreshTimer); routeRefreshTimer = null; }
    if (routeFetchAbort) { routeFetchAbort.abort(); routeFetchAbort = null; }
    // UI-only teardown: the isolated trail is independent of the legend (it persists when
    // switching to a non-Waymarked overlay such as the Strava heatmap). Callers that should
    // also drop the trail call removeIsolatedTrailLayers() / clearIsolatedTrail() directly.
    removeLegendControl(routeLegend);
    routeLegend = null;
    routeLegendEl = null;
    routeLegendStatus = null;
}

// --- Trail isolation: show only one trail by drawing its geometry as a vector ---
// Set the raster overlay's opacity (0 to hide all trails while one is isolated).
function setExtraOverlayRasterOpacity(opacity) {
    if (!extraOverlayLayer || !extraOverlayLayer._ids) return;
    const nativeMap = map._map;
    const layerId = extraOverlayLayer._ids.layerId;
    if (nativeMap && nativeMap.getLayer && nativeMap.getLayer(layerId)) {
        nativeMap.setPaintProperty(layerId, 'raster-opacity', opacity);
    }
}

// Remove the drawn polylines and restore the raster (map cleanup only, no re-render).
function removeIsolatedTrailLayers() {
    if (isolatedFetchAbort) { isolatedFetchAbort.abort(); isolatedFetchAbort = null; }
    isolatedTrailLayers.forEach((l) => { try { map.removeLayer(l); } catch (e) { /* ignore */ } });
    isolatedTrailLayers = [];
    if (isolatedRouteId != null) setExtraOverlayRasterOpacity(1);
    isolatedRouteId = null;
}

// Lift the drawn trail above the current overlay. A newly applied overlay raster (e.g. the
// heatmap) is added on top of the stack, so re-raise the kept trail over it — casing first,
// colored line last, preserving their order. The GPX track stays above the trail: moving each
// layer to directly below it keeps both their relative order and the track on top.
function liftIsolatedTrailToTop() {
    const nativeMap = map && map._map;
    if (!nativeMap || !nativeMap.moveLayer) return;
    const gpxBeforeId = getGpxTopBeforeId(nativeMap);
    isolatedTrailLayers.forEach((l) => {
        if (l && l._ids && nativeMap.getLayer(l._ids.layerId)) {
            try { nativeMap.moveLayer(l._ids.layerId, gpxBeforeId); } catch (e) { /* ignore */ }
        }
    });
}

// Persist (or clear) the isolated-trail selection so it survives a reload.
function persistIsolatedSelection() {
    if (isolatedRouteId != null) {
        localStorage.setItem(ROUTE_ISOLATED_ID_KEY, String(isolatedRouteId));
        localStorage.setItem(ROUTE_ISOLATED_COLOR_KEY, isolatedColor);
    } else {
        localStorage.removeItem(ROUTE_ISOLATED_ID_KEY);
        localStorage.removeItem(ROUTE_ISOLATED_COLOR_KEY);
    }
}

function clearIsolatedTrail() {
    removeIsolatedTrailLayers();
    persistIsolatedSelection();
    if (routeLegendStatus === 'list') renderRouteLegend({ status: 'list', items: lastRouteItems });
}

function toggleIsolateTrail(id, color) {
    if (id == null) return;
    if (isolatedRouteId === id) { clearIsolatedTrail(); return; }
    // Isolate (or switch to) this trail: drop any existing line, keep the raster hidden.
    if (isolatedFetchAbort) { isolatedFetchAbort.abort(); isolatedFetchAbort = null; }
    isolatedTrailLayers.forEach((l) => { try { map.removeLayer(l); } catch (e) { /* ignore */ } });
    isolatedTrailLayers = [];
    isolatedRouteId = id;
    isolatedColor = color || '#1565C0';
    persistIsolatedSelection();
    setExtraOverlayRasterOpacity(0);
    renderRouteLegend({ status: 'list', items: lastRouteItems });
    fetchAndDrawTrail(id);
}

async function fetchAndDrawTrail(id) {
    const activity = activeWmtActivity();
    if (!activity) return;
    if (isolatedFetchAbort) isolatedFetchAbort.abort();
    isolatedFetchAbort = new AbortController();
    const signal = isolatedFetchAbort.signal;

    // Fetch the whole route once with a world-extent bbox so it never needs re-fetching
    // (and never flickers) as the map pans/zooms; the API still simplifies the geometry.
    const W = 20037508.34;
    const bbox = `${-W},${-W},${W},${W}`;
    const url = `https://${activity}.waymarkedtrails.org/api/v1/list/segments?bbox=${bbox}&relations=${id}`;

    try {
        const res = await fetch(url, { signal });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const data = await res.json();
        if (id !== isolatedRouteId) return; // cleared/switched while fetching
        isolatedTrailLayers.forEach((l) => { try { map.removeLayer(l); } catch (e) { /* ignore */ } });
        isolatedTrailLayers = [];
        // Collect every line part into one multi-line so the whole trail draws as
        // just two layers (white casing + colored line), regardless of how many
        // disconnected segments the relation has. Drawing one polyline per part
        // would create thousands of MapLibre layers for fragmented routes (e.g.
        // Kungsleden has ~1000 parts), locking the browser and rendering spotty.
        const allLines = [];
        for (const feature of (data.features || [])) {
            const geom = feature.geometry;
            if (!geom) continue;
            const lines = geom.type === 'MultiLineString' ? geom.coordinates : [geom.coordinates];
            for (const coords of lines) {
                if (!coords || coords.length < 2) continue;
                allLines.push(coords.map(([x, y]) => { const [lon, lat] = mercToLonLat(x, y); return [lat, lon]; }));
            }
        }
        if (allLines.length) {
            // Ensure the raster trails stay hidden once the overlay's native layer is
            // ready (the initial hide may have run before extraOverlayLayer._ids existed).
            setExtraOverlayRasterOpacity(0);
            isolatedTrailLayers.push(L.polyline(allLines, { color: '#ffffff', weight: 8, opacity: 0.9 }).addTo(map));
            isolatedTrailLayers.push(L.polyline(allLines, { color: isolatedColor, weight: 5, opacity: 0.95 }).addTo(map));
            // For a shared-link route, ignore the link's zoom and fit the whole trail.
            if (pendingRouteFit) {
                pendingRouteFit = false;
                const flat = [];
                for (const line of allLines) for (const pt of line) flat.push(pt);
                if (flat.length) map.fitBounds(L.latLngBounds(flat).pad(0.1));
            }
        }
    } catch (err) {
        if (err && err.name === 'AbortError') return;
        // leave the raster hidden; the user can click "Show all" to restore
    }
}

// On map movement the legend is not re-queried automatically; instead reveal the
// refresh icon so the user can pull an updated list for the new view on demand.
function markRouteLegendStale() {
    if (routeLegendEl && routeLegendEl.querySelector('.route-legend-refresh')) {
        routeLegendEl.classList.add('stale');
    }
}

// While the route-names legend is shown (overlay on + route names enabled) it gets
// the bottom-right corner to itself. Desktop: the GPS + navigation groups are hidden
// via CSS (body.route-legend-on). Mobile (<= 600px): the groups are moved to the
// bottom-left corner instead — GPS on top, nav below, 10px inset (MapLibre's corner
// CSS mirrors the right-side layout) — while CSS hides the attribution banner there.
function updateZoomControlVisibility() {
    const legendActive = routeNamesOn && isOverlayOn();
    document.body.classList.toggle('route-legend-on', legendActive);

    const right = document.querySelector('.maplibregl-ctrl-bottom-right');
    const left = document.querySelector('.maplibregl-ctrl-bottom-left');
    if (!right || !left) return;
    const gps = right.querySelector('.gps-control') || left.querySelector('.gps-control');
    const nav = right.querySelector('.maplibregl-ctrl-group:not(.gps-control)')
             || left.querySelector('.maplibregl-ctrl-group:not(.gps-control)');
    if (!gps || !nav) return;

    const moveLeft = legendActive && window.innerWidth <= 600;
    if (moveLeft && gps.parentElement !== left) {
        // Appended after the (CSS-hidden) attribution; GPS on top, nav below.
        left.appendChild(gps);
        left.appendChild(nav);
    } else if (!moveLeft && gps.parentElement !== right) {
        // Restore the placeGpsAboveNav order — GPS first, nav second — ahead of
        // the route legend if one is currently appended to this corner.
        right.insertBefore(nav, right.firstChild);
        right.insertBefore(gps, nav);
    }
    // Corner occupancy changed: re-offset the slider stack (and corners).
    adjustMapControlsForElevation();
}

function loadLockedLayer(layerKey, key) {
    const service = lockedServices[layerKey];
    if (service) {
        const url = service.urlTemplate.replace('{key}', key);
        layers[layerKey].setUrl(url);
    }
}

function showKeyModal(layerKey) {
    const service = lockedServices[layerKey];
    if (!service) return;
    pendingServiceKey = layerKey;

    const t = translations[currentLang];
    document.getElementById('modal-title').textContent = t.modal_api_title.replace('{service}', service.name);
    document.getElementById('modal-text').textContent = t.modal_api_text.replace('{service}', service.name);

    const linkEl = document.getElementById('modal-link');
    linkEl.href = service.link;
    linkEl.textContent = service.link;

    const existingKey = localStorage.getItem(service.storageKey) || '';
    document.getElementById('api-key-input').value = existingKey;
    document.getElementById('key-modal').style.display = 'flex';
}

function openCurrentKeyModal() {
    if (layerSelect) {
        const currentVal = layerSelect.value;
        if (lockedServices[currentVal]) showKeyModal(currentVal);
    }
}

function saveApiKey() {
    if (!pendingServiceKey || !lockedServices[pendingServiceKey]) return;
    const input = document.getElementById('api-key-input');
    const key = input.value.trim();
    const service = lockedServices[pendingServiceKey];
    const t = translations[currentLang];

    if (key) {
        localStorage.setItem(service.storageKey, key);
        loadLockedLayer(pendingServiceKey, key);
        switchLayerTo(pendingServiceKey);

        if (editKeyBtn) editKeyBtn.style.display = 'block';
        if (layerSelect) layerSelect.value = pendingServiceKey;
        document.getElementById('key-modal').style.display = 'none';
        pendingServiceKey = null;
    } else {
        alert(t.msg_api_alert);
    }
}

function cancelApiKey() {
    document.getElementById('key-modal').style.display = 'none';
    pendingServiceKey = null;

    if (currentLayer === null) {
        if (layerSelect) layerSelect.value = "opentopo";
        handleLayerChange("opentopo");
    } else {
        if (layerSelect) layerSelect.value = previousLayerValue;
    }
}

function showInfo() { document.getElementById('info-modal').style.display = 'flex'; }
function closeInfo() { document.getElementById('info-modal').style.display = 'none'; }

function toggleControls() {
    if (!controls) return;
    setControlsMinimized(!controls.classList.contains('minimized'));
}

function getControlsToggleLabel(minimized) {
    const t = translations[currentLang] || {};
    return minimized
        ? (t.btn_maximize_panel || 'Maximize')
        : (t.btn_minimize_panel || 'Minimize');
}

function setControlsMinimized(minimized) {
    const btn = document.querySelector('.toggle-btn');
    isControlsMinimized = minimized;
    if (controls) {
        controls.classList.toggle('minimized', minimized);
    }
    if (btn) {
        const label = getControlsToggleLabel(minimized);
        btn.title = label;
        btn.setAttribute('aria-label', label);
    }
}

const tutorialSectionIds = ['section-points', 'section-climbs', 'section-slope', 'section-routes'];

function setSectionExpanded(sectionId, expanded) {
    const content = document.getElementById(sectionId);
    if (!content) return;

    const header = content.previousElementSibling;
    const toggle = header ? header.querySelector('.section-toggle') : null;
    content.style.display = expanded ? 'block' : 'none';
    if (toggle) {
        toggle.classList.toggle('expanded', expanded);
    }
}

function collapseTutorialSections() {
    tutorialSectionIds.forEach((sectionId) => setSectionExpanded(sectionId, false));
    retractRadiusControls();
}

function moveRadiusControlsIntoSection(sectionContentId) {
    const controls = document.getElementById('radius-controls');
    const sectionContent = document.getElementById(sectionContentId);
    if (!controls || !sectionContent) return;
    sectionContent.insertBefore(controls, sectionContent.firstChild);
    controls.style.display = '';
}

function retractRadiusControls() {
    const controls = document.getElementById('radius-controls');
    const anchor = document.getElementById('radius-controls-anchor');
    if (!controls || !anchor || !anchor.parentNode) return;
    anchor.parentNode.insertBefore(controls, anchor.nextSibling);
    controls.style.display = 'none';
}

window.toggleSection = function (sectionId) {
    const content = document.getElementById(sectionId);
    if (!content) return;

    const isCurrentlyOpen = content.style.display === 'block';

    ALL_SECTION_IDS.forEach(function (id) {
        if (id !== sectionId) setSectionExpanded(id, false);
    });
    retractRadiusControls();

    if (isCurrentlyOpen) {
        setSectionExpanded(sectionId, false);
        // Collapsing an analysis section turns Show Radius back off, matching
        // the auto-enable that happens when the section is expanded.
        if (ANALYSIS_SECTION_IDS.includes(sectionId) && circleCheckbox && circleCheckbox.checked) {
            circleCheckbox.checked = false;
            updateUI();
        }
        return;
    }

    setSectionExpanded(sectionId, true);

    if (ANALYSIS_SECTION_IDS.includes(sectionId)) {
        moveRadiusControlsIntoSection(sectionId);
        if (circleCheckbox) {
            circleCheckbox.checked = true;
            updateUI();
        }
    } else if (sectionId === 'section-routes' && circleCheckbox) {
        circleCheckbox.checked = false;
        updateUI();
    }
};

// ==========================================
// SEARCH-BOX COORDINATE PARSING (DD / DDM / DMS / Plus Code)
// ==========================================
// Everything below serves searchLocation() only; the share-link parser
// (parseSharedMapHash) and the coordinate readout are deliberately untouched. Every parser
// returns null for anything it does not fully understand, so an unrecognised query falls
// through to the geocoder exactly as it did before these formats existed.

// Sexagesimal marks. The Unicode variants matter in practice: mobile keyboards and word
// processors autocorrect to curly quotes (’ ”), copy-paste from Wikipedia carries true
// primes (′ ″), and some handheld GPS units print the masculine ordinal º for degrees.
const GEO_DEG_MARKS = '°º˚';                  // ° º ˚
const GEO_MIN_MARKS = "'′’ʼ´‘";     // ' ′ ’ ʼ ´ ‘
const GEO_SEC_MARKS = '"″”“';                 // " ″ ” “
// N/S plus the east/west letters of every language this app ships or borders: E (english),
// O/Ö (svenska öst), Ø (norsk/dansk øst), W (west), V (väst/vest). O means *west* in
// Spanish/French/Portuguese, but this app ships only sv/en and English never uses O as a
// hemisphere, so O is read as East; the failure mode is a jump the user sees immediately.
const GEO_HEMI_LETTERS = 'NnSsEeWwOoVvÖöØø';

const GEO_DEG_CLASS = '[' + GEO_DEG_MARKS + ']';
const GEO_MIN_CLASS = '[' + GEO_MIN_MARKS + ']';
// Seconds end in a double-quote variant or in two minute marks ('' ’’ ′′), which is how
// plain-ASCII typists write them. Unambiguous: a number always separates the two marks.
const GEO_SEC_CLASS = '(?:[' + GEO_SEC_MARKS + ']|' + GEO_MIN_CLASS + '{2})';
// Degrees and minutes must be parted by a degree mark and/or whitespace. Without this the
// engine backtracks "57.8112660" into 5° 7.8112660' (a plausible-looking 5.13°) instead of
// falling through to the decimal-degrees alternative below.
const GEO_DM_SEP = '(?:\\s*' + GEO_DEG_CLASS + '\\s*|\\s+)';

const GEO_COMPONENT_SRC =
    '(?:([' + GEO_HEMI_LETTERS + '])\\s*)?' +                         // 1 leading hemisphere
    '(?:' +
        '([-+]?\\d{1,3})' + GEO_DM_SEP +                              // 2 integer degrees
        '(\\d{1,2}(?:[.,]\\d+)?)\\s*' + GEO_MIN_CLASS + '?' +         // 3 minutes
        '(?:\\s*(\\d{1,2}(?:[.,]\\d+)?)\\s*' + GEO_SEC_CLASS + ')?' + // 4 seconds
    '|' +
        '([-+]?\\d{1,3}(?:[.,]\\d+)?)\\s*' + GEO_DEG_CLASS + '?' +    // 5 decimal degrees
    ')' +
    // A trailing hemisphere letter must not be the *leading* letter of the next component:
    // in "N 57.81 E 12.09" the E belongs to the longitude, not to the latitude.
    '(?:\\s*([' + GEO_HEMI_LETTERS + '])(?!\\s*[-+]?\\d))?';

// Gate: the query may contain only coordinate characters, and must carry at least one
// sexagesimal mark or hemisphere letter. This is what keeps place names ("Malmö", "Oslo")
// and the plain-decimal forms out of this parser entirely.
const GEO_SEXAGESIMAL_CHARS_RE = new RegExp(
    '^[0-9+\\-.,;/\\s' + GEO_DEG_MARKS + GEO_MIN_MARKS + GEO_SEC_MARKS + GEO_HEMI_LETTERS + ']+$');
const GEO_HAS_MARK_RE = new RegExp(
    '[' + GEO_DEG_MARKS + GEO_MIN_MARKS + GEO_SEC_MARKS + GEO_HEMI_LETTERS + ']');
// What may sit between and around the two components once both have been matched.
const GEO_FILLER_RE = /^[\s,;/]*$/;

const PLUSCODE_ALPHABET = '23456789CFGHJMPQRVWX';
const PLUSCODE_PC = '[' + PLUSCODE_ALPHABET + ']';
// A full code is 8 digits + '+' + 2..7 more. A padded code pads the tail of the pair
// section with '0'. A short code drops 2, 4 or 6 leading digits, so its separator index is
// always even and below 8 — which (?:PC{2}){1,3} encodes directly.
const PLUSCODE_FULL_RE = new RegExp('^' + PLUSCODE_PC + '{8}\\+(?:' + PLUSCODE_PC + '{2,7})?$', 'i');
const PLUSCODE_PADDED_RE = new RegExp('^(?:' + PLUSCODE_PC + '{2}){1,3}0{2,6}\\+$', 'i');
const PLUSCODE_SHORT_RE = new RegExp('^(?:' + PLUSCODE_PC + '{2}){1,3}\\+' + PLUSCODE_PC + '{2,7}$', 'i');
// <code>[ , | whitespace ] <locality>. The separator before a locality is required, else
// "R36R+GP4Göteborg" would swallow the G into the code.
const PLUSCODE_QUERY_RE = new RegExp(
    '^([' + PLUSCODE_ALPHABET + '0]{2,8}\\+[' + PLUSCODE_ALPHABET + ']{0,7})' +
    '(?:(?:\\s*,\\s*|\\s+)(.+))?$', 'i');

// Zoom for a resolved coordinate. 15 equals ELEVATION_TILE_MAX_ZOOM and sits below every
// layer's maxZoom, so it is never clamped; at 12 (~38 m/px here) a 2.5 m Plus Code cell is
// invisible. Coarse input (integer degrees, a padded Plus Code) stays at the old 12, and
// so does every place-name search.
function zoomForCoordinate(precise) {
    return precise ? 15 : 12;
}

// Fold the hemisphere letters of every accepted language down to NSEW. See the note on O
// above. Returns null for absent or unknown letters.
function normalizeHemisphere(letter) {
    if (!letter) return null;
    const c = letter.toUpperCase();
    if (c === 'N' || c === 'S' || c === 'E' || c === 'W') return c;
    if (c === 'O' || c === 'Ö' || c === 'Ø') return 'E';   // öst / øst / ost
    if (c === 'V') return 'W';                                       // väst / vest
    return null;
}

// parseFloat that accepts a decimal comma. Returns null for absent groups so callers can
// tell "no seconds field" from "seconds were zero".
function parseGeoNumber(text) {
    if (text === undefined || text === null || text === '') return null;
    const value = parseFloat(String(text).replace(',', '.'));
    return Number.isFinite(value) ? value : null;
}

// One matched component -> { value, leading, trailing, precise } or null. `value` carries
// only an explicit leading sign; the caller applies the hemisphere.
function buildGeoComponent(match) {
    const degMinDeg = match[2];
    let value;
    let precise;

    if (degMinDeg !== undefined) {
        const degrees = parseGeoNumber(degMinDeg);
        const minutes = parseGeoNumber(match[3]);
        const seconds = parseGeoNumber(match[4]);
        if (degrees === null || minutes === null) return null;
        if (minutes < 0 || minutes >= 60) return null;
        if (seconds !== null && (seconds < 0 || seconds >= 60)) return null;
        // "57° 44.5' 30\"" is self-contradictory: fractional minutes already carry the
        // seconds, so a seconds field on top of them means the input was mistyped.
        if (seconds !== null && !Number.isInteger(minutes)) return null;
        const sign = degrees < 0 ? -1 : 1;
        value = sign * (Math.abs(degrees) + minutes / 60 + (seconds || 0) / 3600);
        precise = true;
    } else {
        const decimal = parseGeoNumber(match[5]);
        if (decimal === null) return null;
        value = decimal;
        // Four decimals is ~11 m at this latitude — precise enough to be worth zooming to.
        const fraction = /[.,](\d+)$/.exec(String(match[5]));
        precise = Boolean(fraction && fraction[1].length >= 4);
    }

    if (!Number.isFinite(value)) return null;
    return {
        value,
        leading: normalizeHemisphere(match[1]),
        trailing: normalizeHemisphere(match[6]),
        precise
    };
}

// DMS / DDM / decimal degrees carrying a sexagesimal mark or a hemisphere letter, in
// either axis order. Returns { lat, lng, precise } or null.
function parseSexagesimalPair(text) {
    const input = String(text || '').trim();
    if (!input) return null;
    if (!GEO_SEXAGESIMAL_CHARS_RE.test(input)) return null;
    if (!GEO_HAS_MARK_RE.test(input)) return null;

    const re = new RegExp(GEO_COMPONENT_SRC, 'g');
    const matches = [];
    let m;
    while ((m = re.exec(input)) !== null) {
        if (m[0] === '') { re.lastIndex++; continue; }     // never let a zero-width match spin
        matches.push(m);
        if (matches.length > 2) return null;
    }
    if (matches.length !== 2) return null;

    // Coverage check, in place of ^...$ anchoring: whatever the two components did not
    // consume may only be separator punctuation. This is what makes a partial match
    // ("E6", a lone "57°44'24\"N") fail instead of silently parsing.
    const first = matches[0];
    const second = matches[1];
    const leftover = input.slice(0, first.index) +
        input.slice(first.index + first[0].length, second.index) +
        input.slice(second.index + second[0].length);
    if (!GEO_FILLER_RE.test(leftover)) return null;

    const a = buildGeoComponent(first);
    const b = buildGeoComponent(second);
    if (!a || !b) return null;

    // "57.8112660N 12.0918247E" scans as [57.8112660] [N 12.0918247 E] because the N is
    // not followed by a digit but the E is. Move a stranded leading letter back one
    // component; sound because a component can hold at most one hemisphere.
    if (!a.leading && !a.trailing && b.leading && b.trailing) {
        a.trailing = b.leading;
        b.leading = null;
    }
    if (a.leading && a.trailing) return null;
    if (b.leading && b.trailing) return null;

    const h1 = a.leading || a.trailing;
    const h2 = b.leading || b.trailing;
    const axis = (h) => (h === 'N' || h === 'S' ? 'ns' : h ? 'ew' : null);

    let swap = false;
    if (h1 && h2) {
        if (axis(h1) === axis(h2)) return null;            // "…N, …N" is not a pair
        swap = axis(h1) === 'ew';
    } else if (h1) {
        swap = axis(h1) === 'ew';
    } else if (h2) {
        swap = axis(h2) === 'ns';
    }

    const latPart = swap ? b : a;
    const lngPart = swap ? a : b;
    const latHemi = latPart.leading || latPart.trailing;
    const lngHemi = lngPart.leading || lngPart.trailing;

    // A hemisphere letter wins over an explicit sign: "-57° S" is a typo, and a search box
    // should be forgiving rather than push it to a geocoder that cannot help.
    const lat = latHemi ? Math.abs(latPart.value) * (latHemi === 'S' ? -1 : 1) : latPart.value;
    const lng = lngHemi ? Math.abs(lngPart.value) * (lngHemi === 'W' ? -1 : 1) : lngPart.value;

    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
    return { lat, lng, precise: latPart.precise || lngPart.precise };
}

// Plain decimal degrees: the legacy "57.81, 12.09" / "57 81" forms plus the Swedish
// decimal comma ("57,8112660, 12,0918247"). Returns { lat, lng, precise } or null.
function parseDecimalPair(text) {
    const input = String(text || '').trim();
    if (!/^[-+0-9.,\s]+$/.test(input)) return null;

    let lat = null;
    let lng = null;

    if (input.indexOf('.') !== -1) {
        // A dot in the string settles it: dot is the decimal point, so every comma can
        // only be a pair separator. A mixed "57.81, 12,09" yields 3 tokens and fails.
        if ((input.match(/,/g) || []).length > 1) return null;
        const tokens = input.split(/[,\s]+/).filter(Boolean);
        if (tokens.length !== 2) return null;
        if (!tokens.every((tok) => /^[-+]?\d+(?:\.\d+)?$/.test(tok))) return null;
        lat = parseFloat(tokens[0]);
        lng = parseFloat(tokens[1]);
    } else {
        // No dot: a comma is either the decimal point or the pair separator. Split
        // capturing the separators so we know which of them contain whitespace.
        const parts = input.split(/([,\s]+)/);
        const groups = parts.filter((_, i) => i % 2 === 0);
        const seps = parts.filter((_, i) => i % 2 === 1);
        if (!groups.every((g) => /^[-+]?\d+$/.test(g))) return null;
        const spaced = seps.map((s, i) => (/\s/.test(s) ? i : -1)).filter((i) => i !== -1);
        const unsigned = (g) => /^\d+$/.test(g);

        if (groups.length === 2) {
            // Legacy, non-negotiable: two groups are ALWAYS the historical lat/lon pair.
            // "57,81" has meant lat 57 lon 81 since the first release and must keep to it;
            // nothing is lost, because a lone "57,8112660" is not a coordinate pair anyway.
            lat = parseFloat(groups[0]);
            lng = parseFloat(groups[1]);
        } else if (groups.length === 3) {
            // "57,8112660, 12" — whitespace is the only signal for which comma splits the
            // pair. Without exactly one whitespace separator the input is truly ambiguous.
            if (spaced.length !== 1) return null;
            if (spaced[0] === 0) {
                if (!unsigned(groups[2])) return null;
                lat = parseFloat(groups[0]);
                lng = parseFloat(groups[1] + '.' + groups[2]);
            } else {
                if (!unsigned(groups[1])) return null;
                lat = parseFloat(groups[0] + '.' + groups[1]);
                lng = parseFloat(groups[2]);
            }
        } else if (groups.length === 4) {
            // Four integer groups can only be a 2+2 decimal-comma pair, so the middle
            // separator splits it — which collapses "a,b, c,d", "a,b c,d" and "a,b,c,d"
            // to one rule. Whitespace anywhere else means the input was mistyped.
            if (spaced.some((i) => i !== 1)) return null;
            if (!unsigned(groups[1]) || !unsigned(groups[3])) return null;
            lat = parseFloat(groups[0] + '.' + groups[1]);
            lng = parseFloat(groups[2] + '.' + groups[3]);
        } else {
            return null;
        }
    }

    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
    const decimals = (v) => { const f = /\.(\d+)$/.exec(String(v)); return f ? f[1].length : 0; };
    return { lat, lng, precise: decimals(lat) >= 4 || decimals(lng) >= 4 };
}

// Entry point for the search box. Returns { lat, lng, zoom } or null; null means "not a
// coordinate", so the caller falls through to the geocoder exactly as it does today.
function parseCoordinateQuery(text) {
    const parsed = parseSexagesimalPair(text) || parseDecimalPair(text);
    if (!parsed) return null;
    return { lat: parsed.lat, lng: parsed.lng, zoom: zoomForCoordinate(parsed.precise) };
}

// Recognise a Plus Code query without touching the network. Returns
// { code, kind, locality } where kind is 'full' | 'padded' | 'short', or null.
function matchPlusCodeQuery(text) {
    const input = String(text || '').trim();
    const m = PLUSCODE_QUERY_RE.exec(input);
    if (!m) return null;
    const code = m[1].toUpperCase();
    const locality = (m[2] || '').trim();
    let kind = null;
    if (PLUSCODE_FULL_RE.test(code)) kind = 'full';
    else if (PLUSCODE_PADDED_RE.test(code)) kind = 'padded';
    else if (PLUSCODE_SHORT_RE.test(code)) kind = 'short';
    if (!kind) return null;
    return { code, kind, locality };
}

// Decode a full or padded code to the CENTRE of its cell, plus the cell size on each axis.
// Pair section: 5 pairs at 20°, 1°, 0.05°, 0.0025°, 0.000125°, even digits latitude and odd
// longitude, offset from the south-west corner (-90, -180). Grid section: each further
// digit splits the current cell into 4 columns x 5 rows.
function decodePlusCode(code) {
    const digits = String(code || '').toUpperCase().replace(/\+/g, '').replace(/0+$/, '');
    if (!digits) return null;
    if (Math.min(digits.length, 10) % 2 !== 0) return null;    // the pair section is even
    for (let i = 0; i < digits.length; i++) {
        if (PLUSCODE_ALPHABET.indexOf(digits[i]) === -1) return null;
    }

    let lat = -90;
    let lng = -180;
    let latRes = 20;
    let lngRes = 20;

    const pairEnd = Math.min(digits.length, 10);
    for (let i = 0; i + 1 < pairEnd; i += 2) {
        lat += PLUSCODE_ALPHABET.indexOf(digits[i]) * latRes;
        lng += PLUSCODE_ALPHABET.indexOf(digits[i + 1]) * lngRes;
        if (i + 2 < pairEnd) { latRes /= 20; lngRes /= 20; }
    }
    for (let i = 10; i < Math.min(digits.length, 15); i++) {
        const d = PLUSCODE_ALPHABET.indexOf(digits[i]);
        latRes /= 5;
        lngRes /= 4;
        lat += Math.floor(d / 4) * latRes;    // row 0 is the southernmost
        lng += (d % 4) * lngRes;              // col 0 is the westernmost
    }

    return { lat: lat + latRes / 2, lng: lng + lngRes / 2, latRes, lngRes };
}

// The first `len` (even, <= 10) digits of the full code covering a point — a partial
// encoder, which is all short-code recovery needs.
function plusCodePrefix(lat, lng, len) {
    let la = Math.min(Math.max(lat, -90), 90) + 90;
    let lo = ((lng % 360) + 540) % 360;                // -> [0, 360)
    if (la >= 180) la = 180 - 1e-10;                   // exactly +90 belongs to the last cell
    let out = '';
    let latRes = 20;
    let lngRes = 20;
    for (let i = 0; i < len; i += 2) {
        const a = Math.min(Math.floor(la / latRes), 19);
        const b = Math.min(Math.floor(lo / lngRes), 19);
        out += PLUSCODE_ALPHABET[a] + PLUSCODE_ALPHABET[b];
        la -= a * latRes;
        lo -= b * lngRes;
        latRes /= 20;
        lngRes /= 20;
    }
    return out;
}

// Expand a short code ("R36R+GP4") against a reference point: rebuild the missing leading
// digits from the reference, then step one cell if the naive result landed on the far side
// of the reference. Returns the same shape as decodePlusCode, or null.
function recoverNearestPlusCode(shortCode, refLat, refLng) {
    const code = String(shortCode || '').toUpperCase();
    const sep = code.indexOf('+');
    if (sep < 0 || sep >= 8 || sep % 2 !== 0) return null;
    if (!Number.isFinite(refLat) || !Number.isFinite(refLng)) return null;

    const paddingLength = 8 - sep;
    const resolution = Math.pow(20, 2 - paddingLength / 2);
    const half = resolution / 2;
    const lat = Math.min(Math.max(refLat, -90), 90);
    const lng = ((refLng % 360) + 540) % 360 - 180;

    const area = decodePlusCode(plusCodePrefix(lat, lng, paddingLength) + code);
    if (!area) return null;

    if (lat + half < area.lat && area.lat - resolution >= -90) area.lat -= resolution;
    else if (lat - half > area.lat && area.lat + resolution <= 90) area.lat += resolution;
    // No clamp on longitude: wrapping across +-180 is legitimate.
    if (lng + half < area.lng) area.lng -= resolution;
    else if (lng - half > area.lng) area.lng += resolution;

    return area;
}

// Turn a matched Plus Code into a map position. A short code only pins down a point within
// a cell of its own resolution (±0.5° for the common 4-padding form, ~55 km), so it needs
// a reference: the locality that follows it, geocoded, or the current view.
async function resolvePlusCode(match) {
    if (match.kind === 'full' || match.kind === 'padded') {
        const area = decodePlusCode(match.code);
        // A padded code covers a whole degree or more, so it is not a precise position.
        return area ? { lat: area.lat, lng: area.lng, zoom: zoomForCoordinate(match.kind === 'full') } : null;
    }

    let ref;
    if (match.locality) {
        const place = await geocodeNominatim(match.locality);
        // The user named a place. If it cannot be found, say so rather than silently
        // falling back to the map centre, which would drop them at a plausible-looking but
        // wrong location up to ~55 km away with no signal that anything went wrong.
        if (!place) return null;
        ref = place;
    } else {
        // map.getCenter(), not getSearchCenter(): the latter returns the locked analysis
        // centre, which can be far from what the user is actually looking at.
        ref = map.getCenter();
    }

    const area = recoverNearestPlusCode(match.code, ref.lat, ref.lng);
    return area ? { lat: area.lat, lng: area.lng, zoom: zoomForCoordinate(true) } : null;
}

// Forward-geocode a free-text place name. Returns { lat, lng, name } or null; throws only
// on a network/parse failure, which the callers surface in the status bar.
async function geocodeNominatim(query) {
    const response = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}`);
    const data = await response.json();
    if (!data || !data.length) return null;
    const lat = parseFloat(data[0].lat);
    const lng = parseFloat(data[0].lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return { lat, lng, name: String(data[0].display_name || '').split(',')[0] };
}

async function searchLocation() {
    const t = translations[currentLang];
    const query = searchInput.value.trim();
    if (!query) return;
    statusDiv.textContent = t.status_searching;

    // Plus Codes are tried first: they are the only format allowed to carry trailing free
    // text ("R36R+GP4 Göteborg") and the only one that may need a network round trip.
    const plusCode = matchPlusCodeQuery(query);
    if (plusCode) {
        try {
            const point = await resolvePlusCode(plusCode);
            if (point) {
                map.setView([point.lat, point.lng], point.zoom);
                statusDiv.textContent = t.status_done;
            } else {
                statusDiv.textContent = t.status_no_match;
            }
        } catch (error) {
            console.error(error);
            statusDiv.textContent = (t.status_error || 'Error: ') + error.message;
        }
        return;
    }

    // DMS / DDM / decimal degrees, including the Swedish decimal comma. Returns null on
    // anything it does not fully understand, so a near-miss still reaches the geocoder.
    const coords = parseCoordinateQuery(query);
    if (coords) {
        map.setView([coords.lat, coords.lng], coords.zoom);
        statusDiv.textContent = t.status_done;
        return;
    }

    try {
        const place = await geocodeNominatim(query);
        if (place) {
            map.setView([place.lat, place.lng], 12);
            statusDiv.textContent = place.name;
        } else { statusDiv.textContent = t.status_no_match; }
    } catch (error) {
        console.error(error);
        // Without this the status bar is stuck on "Searching..." forever whenever the
        // network fails — offline, Nominatim down, or rate-limited.
        statusDiv.textContent = (t.status_error || 'Error: ') + error.message;
    }
}

function stopGpsTracking() {
    if (gpsWatchId !== null) { navigator.geolocation.clearWatch(gpsWatchId); gpsWatchId = null; }
    if (gpsMarker) { gpsMarker.remove(); gpsMarker = null; }
    if (gpsAccuracyCircle) { gpsAccuracyCircle.remove(); gpsAccuracyCircle = null; }
    document.querySelectorAll('.gps-toggle').forEach((b) => b.classList.remove('active'));
    lastGpsPosition = null;
    gpsHasCentered = false;
    updateUI(); // hide the Center-to-GPS readout now that tracking is off
}

function locateUser() {
    const t = translations[currentLang];
    // Toggle off if live tracking is already running.
    if (gpsWatchId !== null) { stopGpsTracking(); statusDiv.textContent = t.status_ready; return; }
    if (!navigator.geolocation) { statusDiv.textContent = t.status_gps_missing; return; }
    statusDiv.textContent = t.status_gps_fetch;

    // Accuracy at or below this many metres is treated as "pinpoint": no ring is shown.
    const GPS_PINPOINT_M = 5;
    // Cap the rendered ring so a coarse "Approximate Location" fix (accuracy of many
    // kilometres) doesn't swamp the map; beyond this it just reads as "low accuracy".
    const GPS_MAX_RING_M = 1500;

    function updateGpsMarker(pos) {
        const lat = pos.coords.latitude, lng = pos.coords.longitude;
        lastGpsPosition = { lat, lng };
        updateUI(); // refresh the Center-to-GPS distance for the new fix
        // The very first fix of a tracking session recenters the map once, keeping the
        // user's current zoom. Every later fix only moves the marker and the ring, so the
        // map never jumps out from under a user who has panned away.
        if (!gpsHasCentered) {
            gpsHasCentered = true;
            map.setView([lat, lng], map.getZoom());
        }
        if (gpsMarker) {
            gpsMarker.setLngLat([lng, lat]);
        } else {
            const el = document.createElement('div');
            el.className = 'gps-marker';
            gpsMarker = new maplibregl.Marker({ element: el }).setLngLat([lng, lat]).addTo(map._map);
        }

        // Shade a ring sized to the reported margin of error (metres). A tighter fix
        // shrinks the ring; a pinpoint fix removes it so only the dot remains.
        const acc = pos.coords.accuracy;
        if (Number.isFinite(acc) && acc > GPS_PINPOINT_M) {
            const radius = Math.min(acc, GPS_MAX_RING_M);
            if (gpsAccuracyCircle) {
                gpsAccuracyCircle.setLatLng([lat, lng]).setRadius(radius);
            } else {
                gpsAccuracyCircle = L.circle([lat, lng], {
                    radius,
                    color: '#007bff',
                    fillColor: '#007bff',
                    fillOpacity: 0.15,
                    weight: 1,
                    opacity: 0.4
                }).addTo(map);
            }
        } else if (gpsAccuracyCircle) {
            gpsAccuracyCircle.remove();
            gpsAccuracyCircle = null;
        }
    }

    document.querySelectorAll('.gps-toggle').forEach((b) => b.classList.add('active'));

    // Both calls feed the same handler; whichever fix lands first does the single
    // recentering (guarded by gpsHasCentered), the rest just move the marker.
    gpsHasCentered = false;
    navigator.geolocation.getCurrentPosition(
        (pos) => { updateGpsMarker(pos); statusDiv.textContent = t.status_done; },
        () => { statusDiv.textContent = t.status_gps_error; stopGpsTracking(); },
        { enableHighAccuracy: true }
    );
    gpsWatchId = navigator.geolocation.watchPosition(
        updateGpsMarker,
        () => {},
        { enableHighAccuracy: true }
    );
}

function clearSlopeMapState(preserveStatus = false) {
    if (slopeOverlay) {
        map.removeLayer(slopeOverlay);
        slopeOverlay = null;
    }
    removeLegendControl(slopeLegend);
    slopeLegend = null;
    slopeMapCenter = null;
    slopeMapRadius = 0;
    slopeMapUsesRadius = false;
    updateUI();
    if (!preserveStatus) {
        statusDiv.textContent = translations[currentLang].status_cleared;
    }
}

window.clearResults = function () {
    if (manualClimbMode) cancelManualClimbMode();
    markers.forEach(m => map.removeLayer(m));
    polylines.forEach(p => map.removeLayer(p));
    markers = [];
    polylines = [];
    clearSlopeMapState(true);
    statusDiv.textContent = translations[currentLang].status_cleared;
};

function showGpxModal() {
    const modal = document.getElementById('gpx-modal');
    if (!modal) return;

    if (window.innerWidth <= 600 && !isControlsMinimized) {
        setControlsMinimized(true);
    }

    modal.style.display = 'flex';
    updateGpxModalAuthUI();
    if (isBackendEnabled()) {
        refreshUploadedFiles();
    } else {
        uploadedGpxFiles = [];
        uploadedGpxListState = 'disabled';
        renderUploadedFiles();
    }
}

function closeGpxModal() {
    const modal = document.getElementById('gpx-modal');
    if (modal) modal.style.display = 'none';
}

window.showGpxModal = showGpxModal;
window.closeGpxModal = closeGpxModal;

// Load GPX button: with a backend, show the upload/history modal; without one,
// open the OS file picker directly (no modal, no "disabled" messaging).
window.openGpxLoader = function () {
    if (isBackendEnabled()) { showGpxModal(); }
    else { document.getElementById('gpx-file-input').click(); }
};

// ==========================================
// Points of Interest (POI) — saved, account-scoped pins
// ==========================================
let poiMarkerById = {};

function poiEscape(value) {
    return String(value == null ? '' : value)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Escapes the description, then turns http(s) URLs into links. CSS wraps long URLs.
function linkifyDescription(text) {
    return poiEscape(text).replace(/(https?:\/\/[^\s<]+)/g,
        '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>');
}

// Entry point for the "Add POI" button. POIs need the backend; without one we
// just nudge the user instead of opening an empty modal.
window.openPoiLoader = function () {
    const t = translations[currentLang];
    if (!isBackendEnabled()) {
        if (statusDiv) statusDiv.textContent = t.status_poi_backend_needed || 'Points of interest require the online backend.';
        return;
    }
    showPoiModal();
};

function showPoiModal() {
    const modal = document.getElementById('poi-modal');
    if (!modal) return;
    if (window.innerWidth <= 600 && !isControlsMinimized) setControlsMinimized(true);
    modal.style.display = 'flex';
    updatePoiModalAuthUI();
    if (isGoogleSignedIn()) refreshPoiList();
}

function closePoiModal() {
    const modal = document.getElementById('poi-modal');
    if (modal) modal.style.display = 'none';
}
window.showPoiModal = showPoiModal;
window.closePoiModal = closePoiModal;

// Mirrors updateGpxModalAuthUI for the POI modal: show sign-in vs. the signed-in
// body (Place new POI + list) depending on the Google session.
function updatePoiModalAuthUI() {
    const signinEl = document.getElementById('poi-auth-signin');
    const userEl = document.getElementById('poi-auth-user');
    const bodyEl = document.getElementById('poi-signedin-body');
    if (!signinEl || !userEl || !bodyEl) return;

    if (isGoogleSignedIn()) {
        signinEl.style.display = 'none';
        userEl.style.display = '';
        bodyEl.style.display = '';
        const avatar = document.getElementById('poi-user-avatar');
        const emailEl = document.getElementById('poi-user-email');
        if (avatar) {
            if (googleAuth.picture) { avatar.src = googleAuth.picture; avatar.style.display = ''; }
            else { avatar.removeAttribute('src'); avatar.style.display = 'none'; }
        }
        if (emailEl) emailEl.textContent = googleAuth.email || googleAuth.name || '';
    } else {
        signinEl.style.display = '';
        userEl.style.display = 'none';
        bodyEl.style.display = 'none';
    }
}
window.updatePoiModalAuthUI = updatePoiModalAuthUI;

// ---- Backend calls (reuse the GPX auth helpers) ----
async function refreshPoiList() {
    if (!isBackendEnabled() || !isGoogleSignedIn()) {
        // Logged out / no backend: show the last-synced pins from the local cache.
        poiList = loadPoiCache();
        renderPoiList();
        renderPoiMarkers();
        return;
    }
    try {
        const resp = await fetchWithAuthRetry(() => fetch(API_BASE + '/pois', {
            credentials: 'same-origin',
            headers: authHeaders()
        }));
        if (!resp.ok) throw new Error('Failed to list POIs');
        const data = await resp.json();
        poiList = Array.isArray(data.pois) ? data.pois : [];
        savePoiCache();
    } catch (e) {
        // Keep showing the cached pins rather than blanking on a transient error.
        poiList = loadPoiCache();
    }
    renderPoiList();
    renderPoiMarkers();
}

window.deletePoiById = async function (poiId) {
    const t = translations[currentLang];
    if (!poiId) return;
    const poi = poiList.find(p => p.id === poiId);
    const name = poi && poi.name ? poi.name : 'POI';
    if (!window.confirm((t.confirm_delete_poi || 'Delete "{name}"?').replace('{name}', name))) return;

    statusDiv.textContent = t.status_poi_deleting || 'Deleting POI...';
    try {
        const resp = await fetchWithAuthRetry(() => fetch(API_BASE + '/pois/' + encodeURIComponent(poiId), {
            method: 'DELETE',
            credentials: 'same-origin',
            headers: authHeaders()
        }));
        if (!resp.ok) throw new Error('Failed to delete POI');
        await refreshPoiList();
        statusDiv.textContent = (t.status_poi_deleted || 'POI deleted.').replace('{name}', name);
    } catch (e) {
        statusDiv.textContent = t.status_poi_delete_error || 'Could not delete the POI.';
    }
};

// ---- Rendering ----
function renderPoiList() {
    const listEl = document.getElementById('poi-list');
    const emptyEl = document.getElementById('poi-list-empty');
    if (!listEl || !emptyEl) return;
    const t = translations[currentLang];

    listEl.innerHTML = '';
    if (!poiList.length) {
        emptyEl.style.display = '';
        emptyEl.textContent = t.poi_list_empty || 'No points of interest yet.';
        return;
    }
    emptyEl.style.display = 'none';

    poiList.forEach(poi => {
        const row = document.createElement('div');
        row.className = 'uploaded-gpx-item';

        const meta = document.createElement('div');
        meta.className = 'uploaded-gpx-meta';

        const name = document.createElement('span');
        name.className = 'uploaded-gpx-name';
        name.textContent = poi.name;
        meta.appendChild(name);

        const sub = document.createElement('span');
        sub.className = 'uploaded-gpx-date';
        const created = poi.created_at ? new Date(poi.created_at) : null;
        const dateStr = (created && !Number.isNaN(created.getTime())) ? created.toLocaleDateString() : '';
        const hasElev = (poi.elevation || poi.elevation === 0);
        sub.textContent = [dateStr, hasElev ? formatElevation(poi.elevation) : ''].filter(Boolean).join(' · ');
        meta.appendChild(sub);

        const actions = document.createElement('div');
        actions.className = 'uploaded-gpx-actions';

        const openBtn = document.createElement('button');
        openBtn.type = 'button';
        openBtn.className = 'secondary-btn';
        openBtn.textContent = t.btn_open_poi || 'Open';
        openBtn.addEventListener('click', () => window.openPoi(poi.id));
        actions.appendChild(openBtn);

        const editBtn = document.createElement('button');
        editBtn.type = 'button';
        editBtn.className = 'secondary-btn';
        editBtn.textContent = t.btn_edit_poi || 'Edit';
        editBtn.addEventListener('click', () => window.editPoi(poi.id));
        actions.appendChild(editBtn);

        const delBtn = document.createElement('button');
        delBtn.type = 'button';
        delBtn.className = 'danger-btn';
        delBtn.textContent = t.btn_delete_poi || 'Delete';
        delBtn.addEventListener('click', () => window.deletePoiById(poi.id));
        actions.appendChild(delBtn);

        row.appendChild(meta);
        row.appendChild(actions);
        listEl.appendChild(row);
    });
}

function poiPopupHtml(poi) {
    const t = translations[currentLang];
    const lat = Number(poi.lat);
    const lng = Number(poi.lng);
    const hasElev = (poi.elevation || poi.elevation === 0);
    const descLine = poi.description ? '<div class="poi-popup-desc">' + linkifyDescription(poi.description) + '</div>' : '';
    const elevLine = hasElev ? '<div class="poi-popup-elev">' + (t.status_elevation || 'Elevation') + ': ' + Math.round(poi.elevation) + ' m</div>' : '';
    return ''
        + '<span class="popup-header">' + poiEscape(poi.name) + '</span>'
        + descLine
        + elevLine
        + '<div class="coord-box"><span>' + lat.toFixed(5) + ', ' + lng.toFixed(5) + '</span>'
        + '<button class="copy-btn" title="' + (t.btn_copy_coords || 'Copy') + '" onclick="copyCoords(' + lat.toFixed(5) + ', ' + lng.toFixed(5) + ', this)">📋</button></div>'
        + '<div class="poi-popup-actions">'
        + '<button class="secondary-btn poi-popup-btn" onclick="editPoi(\'' + poi.id + '\')">' + (t.btn_edit_poi || 'Edit') + '</button>'
        + '<button class="secondary-btn poi-popup-btn" onclick="startPoiMove(\'' + poi.id + '\')">' + (t.btn_move_poi || 'Move') + '</button>'
        + '<button class="danger-btn poi-popup-btn" onclick="deletePoiById(\'' + poi.id + '\')">' + (t.btn_delete_poi || 'Delete') + '</button>'
        + '</div>';
}

function clearPoiMarkers() {
    poiMarkers.forEach(m => map.removeLayer(m));
    poiMarkers = [];
    poiMarkerById = {};
}

function renderPoiMarkers() {
    clearPoiMarkers();
    if (!poiLayerVisible) return; // POIs hidden via the "Show POIs" toggle
    poiList.forEach(poi => {
        const marker = L.marker([poi.lat, poi.lng], { icon: poiIconFor(poi.color) })
            .addTo(map)
            .bindPopup(poiPopupHtml(poi));
        poiMarkers.push(marker);
        poiMarkerById[poi.id] = marker;
    });
}

// "Show POIs" checkbox: toggle pin visibility on the map (the saved list is kept).
window.setPoiVisibility = function (visible) {
    poiLayerVisible = !!visible;
    try { localStorage.setItem('topo_show_poi', poiLayerVisible ? '1' : '0'); } catch (e) { /* storage unavailable */ }
    renderPoiMarkers();
};

// Clicking a POI in the list recenters the map on it and opens its popup.
window.openPoi = function (poiId) {
    const poi = poiList.find(p => p.id === poiId);
    if (!poi) return;
    closePoiModal();
    map.setView([poi.lat, poi.lng], map.getZoom());
    const marker = poiMarkerById[poiId];
    if (marker) marker.openPopup();
};

window.editPoi = function (poiId) {
    const poi = poiList.find(p => p.id === poiId);
    if (!poi) return;
    openPoiForm({
        id: poi.id, lat: Number(poi.lat), lng: Number(poi.lng), elevation: poi.elevation,
        name: poi.name, description: poi.description, color: poi.color
    });
};

// Called on sign-out so another user's pins never linger on the map.
function clearPoiState() {
    poiList = [];
    clearPoiMarkers();
    renderPoiList();
}
window.clearPoiState = clearPoiState;

// ---- Tap-to-place / move flow ----
function enterPoiPlacementMode(moveId, statusKey, fallbackStatus) {
    const t = translations[currentLang];
    // Refuse rather than exit track editing for them — the edits are unsaved.
    if (gpxEditMode) {
        if (statusDiv) {
            statusDiv.textContent = t.status_gpx_edit_busy ||
                'Finish or cancel track editing first.';
        }
        return;
    }
    // Nothing is committed while picking route points, so take the click over rather than
    // refusing — unlike track editing above, there is nothing to lose.
    if (routeCreateMode) cancelRouteCreation();
    closePoiModal();
    poiPlacementMode = true;
    poiPlacementMoveId = moveId || null;
    const mapEl = document.getElementById('map');
    if (mapEl) mapEl.classList.add('poi-placement-active');
    if (statusDiv) statusDiv.textContent = t[statusKey] || fallbackStatus;
}

window.startPoiPlacement = function () {
    enterPoiPlacementMode(null, 'status_poi_placement', 'Tap the map to place your POI.');
};

// Reposition an existing POI: triggered from its popup, then tap the new spot.
window.startPoiMove = function (poiId) {
    if (!poiId) return;
    enterPoiPlacementMode(poiId, 'status_poi_move', 'Tap the map to move your POI.');
};

function cancelPoiPlacement() {
    poiPlacementMode = false;
    poiPlacementMoveId = null;
    const mapEl = document.getElementById('map');
    if (mapEl) mapEl.classList.remove('poi-placement-active');
}

async function handlePoiPlacementClick(lat, lng) {
    const moveId = poiPlacementMoveId;
    cancelPoiPlacement();
    const t = translations[currentLang];
    if (statusDiv) statusDiv.textContent = t.status_poi_fetching_elev || 'Reading elevation...';
    const elevation = await getElevationAtLatLng(lat, lng);

    if (moveId) {
        statusDiv.textContent = t.status_poi_saving || 'Saving POI...';
        try {
            const resp = await fetchWithAuthRetry(() => fetch(API_BASE + '/pois/' + encodeURIComponent(moveId), {
                method: 'PATCH',
                credentials: 'same-origin',
                headers: Object.assign({ 'Content-Type': 'application/json' }, authHeaders()),
                body: JSON.stringify({ lat: lat, lng: lng, elevation: elevation })
            }));
            if (!resp.ok) throw new Error('Failed to move POI');
            await refreshPoiList();
            statusDiv.textContent = t.status_poi_moved || 'POI moved.';
        } catch (e) {
            statusDiv.textContent = t.status_poi_save_error || 'Could not save the POI.';
        }
        return;
    }

    if (statusDiv) statusDiv.textContent = t.status_ready || 'Ready.';
    openPoiForm({ lat: lat, lng: lng, elevation: elevation, color: POI_DEFAULT_COLOR, name: '', description: '' });
}

// ---- Create / edit form ----
function populatePoiColorSwatches(selectedColor) {
    const wrap = document.getElementById('poi-form-colors');
    if (!wrap) return;
    poiFormSelectedColor = (POI_COLORS.indexOf(selectedColor) >= 0) ? selectedColor : POI_DEFAULT_COLOR;
    wrap.innerHTML = '';
    POI_COLORS.forEach(color => {
        const sw = document.createElement('button');
        sw.type = 'button';
        sw.className = 'poi-color-swatch' + (color === poiFormSelectedColor ? ' selected' : '');
        sw.style.background = color;
        sw.setAttribute('aria-label', color);
        sw.addEventListener('click', () => {
            poiFormSelectedColor = color;
            wrap.querySelectorAll('.poi-color-swatch').forEach(el => el.classList.remove('selected'));
            sw.classList.add('selected');
        });
        wrap.appendChild(sw);
    });
}

function openPoiForm(state) {
    const t = translations[currentLang];
    poiFormState = state;
    closePoiModal();

    const titleEl = document.getElementById('poi-form-title');
    if (titleEl) titleEl.textContent = state.id ? (t.poi_form_edit_title || 'Edit POI') : (t.poi_form_new_title || 'New POI');
    const nameEl = document.getElementById('poi-form-name');
    if (nameEl) nameEl.value = state.name || '';
    const descEl = document.getElementById('poi-form-desc');
    if (descEl) descEl.value = state.description || '';
    populatePoiColorSwatches(state.color || POI_DEFAULT_COLOR);

    const coordsEl = document.getElementById('poi-form-coords');
    if (coordsEl) {
        const hasElev = (state.elevation || state.elevation === 0);
        coordsEl.textContent = Number(state.lat).toFixed(5) + ', ' + Number(state.lng).toFixed(5)
            + (hasElev ? '  ·  ' + formatElevation(state.elevation) : '');
    }

    const modal = document.getElementById('poi-form-modal');
    if (modal) modal.style.display = 'flex';
    if (nameEl) nameEl.focus();
}

window.closePoiForm = function () {
    const modal = document.getElementById('poi-form-modal');
    if (modal) modal.style.display = 'none';
    poiFormState = null;
};

window.savePoiForm = async function () {
    if (!poiFormState) return;
    const t = translations[currentLang];
    const nameEl = document.getElementById('poi-form-name');
    const name = nameEl ? nameEl.value.trim() : '';
    if (!name) { if (nameEl) nameEl.focus(); return; }
    const description = (document.getElementById('poi-form-desc') || {}).value || '';
    const color = poiFormSelectedColor;
    const editingId = poiFormState.id;
    const state = poiFormState;
    window.closePoiForm();

    statusDiv.textContent = t.status_poi_saving || 'Saving POI...';
    try {
        let resp;
        if (editingId) {
            resp = await fetchWithAuthRetry(() => fetch(API_BASE + '/pois/' + encodeURIComponent(editingId), {
                method: 'PATCH',
                credentials: 'same-origin',
                headers: Object.assign({ 'Content-Type': 'application/json' }, authHeaders()),
                body: JSON.stringify({ name: name, description: description.trim(), color: color })
            }));
        } else {
            resp = await fetchWithAuthRetry(() => fetch(API_BASE + '/pois', {
                method: 'POST',
                credentials: 'same-origin',
                headers: Object.assign({ 'Content-Type': 'application/json' }, authHeaders()),
                body: JSON.stringify({
                    name: name, description: description.trim(), color: color,
                    lat: state.lat, lng: state.lng, elevation: state.elevation
                })
            }));
        }
        if (!resp.ok) throw new Error('Failed to save POI');
        await refreshPoiList();
        statusDiv.textContent = editingId ? (t.status_poi_updated || 'POI updated.') : (t.status_poi_created || 'POI saved.');
    } catch (e) {
        statusDiv.textContent = t.status_poi_save_error || 'Could not save the POI.';
    }
};

window.clearGpxRoute = function () {
    // No prompt: the user is explicitly destroying the track the edits belong to.
    _gpxEditForceExit();
    // Likewise for a half-placed new route: there is no track left to build it against.
    _routeCreateForceExit();
    clearGpxTrackSourceAndLayers();
    clearMarkerCollection(currentMarkers);
    currentMarkers = [];
    clearMarkerCollection(currentKmMarkers);
    currentKmMarkers = [];
    removeLegendControl(gpxSlopeLegend);
    gpxSlopeLegend = null;    gpxTrackData = null;
    currentSharedGpxId = null;
    currentGpxFilename = null;
    currentGpxShareUrl = null;
    currentGpxRawText = null;
    currentGpxRawFilename = null;
    gpxTextIsGenerated = false;
    const params = new URLSearchParams(location.search);
    params.delete('gpx');
    const queryString = params.toString();
    history.replaceState(null, '', location.pathname + (queryString ? '?' + queryString : '') + location.hash);
    const actionRow = document.getElementById('gpx-action-row');
    if (actionRow) actionRow.style.display = 'none';
    // gpxTrackData is already null by here, so this hides the panel.
    _updateRouteInfoPanel();
    hideElevationProfile();
    statusDiv.textContent = translations[currentLang].status_gpx_cleared;
};

// ==========================================
// GPX DOWNLOAD + RENAME (client-side export of the loaded route)
// ==========================================
// Serializes the in-memory geometry back to GPX 1.1. Needed because the track editor
// changes `gpxTrackData.segments` while `currentGpxRawText` still holds the file the user
// loaded — after an edit those two disagree and the export has to come from the geometry.
//
// Lossy by construction: parseGpxText() keeps only lat/lon/ele per point and lat/lon/name
// per waypoint, so per-point <time>, sensor extensions, <desc>, waypoint <sym>/<type> and
// the <rte>-vs-<trk> distinction are gone before we get here. saveGpxEdits() warns first.
const GPX_XML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' };

function escapeXml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, c => GPX_XML_ESCAPES[c]);
}

// 7 decimals is ~1 cm of longitude at the equator — well past GPS precision, and it keeps
// the file compact next to JS's default 15-odd digits.
function formatGpxCoord(v) { return Number(v).toFixed(7); }
function formatGpxEle(v) { return Number(v).toFixed(1); }

function buildGpxXml(segments, waypoints, metadata = {}) {
    const name = escapeXml(metadata.name || 'route');
    const time = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
    // Array + join, not string +=: a 50k-point track is 50k lines.
    const out = [];
    out.push('<?xml version="1.0" encoding="UTF-8"?>');
    out.push('<gpx version="1.1" creator="TopoScout ' + escapeXml(APP_VERSION) + '"');
    out.push('     xmlns="http://www.topografix.com/GPX/1/1"');
    out.push('     xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"');
    out.push('     xsi:schemaLocation="http://www.topografix.com/GPX/1/1 ' +
        'http://www.topografix.com/GPX/1/1/gpx.xsd">');
    // GPX 1.1 fixes child order inside <metadata> (name before time) and at document
    // level (metadata, wpt*, rte*, trk*) — emit in exactly that order or validators fail.
    out.push('  <metadata>');
    out.push('    <name>' + name + '</name>');
    out.push('    <time>' + time + '</time>');
    out.push('  </metadata>');
    for (const wp of (waypoints || [])) {
        const open = '  <wpt lat="' + formatGpxCoord(wp.lat) + '" lon="' + formatGpxCoord(wp.lon) + '"';
        if (wp.name) {
            out.push(open + '>');
            out.push('    <name>' + escapeXml(wp.name) + '</name>');
            out.push('  </wpt>');
        } else {
            out.push(open + '/>');
        }
    }
    out.push('  <trk>');
    out.push('    <name>' + name + '</name>');
    for (const seg of (segments || [])) {
        if (!seg || seg.length === 0) continue;
        out.push('    <trkseg>');
        for (const p of seg) {
            const open = '      <trkpt lat="' + formatGpxCoord(p.lat) + '" lon="' + formatGpxCoord(p.lon) + '"';
            // <ele> is optional; omit it rather than inventing a 0 for unknown elevation.
            out.push(p.ele === null || p.ele === undefined
                ? open + '/>'
                : open + '><ele>' + formatGpxEle(p.ele) + '</ele></trkpt>');
        }
        out.push('    </trkseg>');
    }
    out.push('  </trk>');
    out.push('</gpx>');
    return out.join('\n') + '\n';
}
window.buildGpxXml = buildGpxXml;

// Re-points the download at the edited geometry. Called only from saveGpxEdits().
function regenerateCurrentGpxText() {
    if (!gpxTrackData) return;
    const baseName = sanitizeGpxFilename(currentGpxFilename || currentGpxRawFilename || 'route');
    currentGpxRawText = buildGpxXml(gpxTrackData.segments, gpxTrackData.waypoints, { name: baseName });
    gpxTextIsGenerated = true;
}

function sanitizeGpxFilename(name) {
    let base = String(name == null ? '' : name).trim();
    base = base.replace(/\.gpx$/i, '');        // drop an existing .gpx extension
    base = base.replace(/[\\/:*?"<>|]/g, '_'); // strip filesystem-invalid chars
    base = base.replace(/[.\s]+$/, '').trim(); // no trailing dots/spaces
    return base || 'route';
}

function triggerGpxDownload(text, filename) {
    const blob = new Blob([text], { type: 'application/gpx+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 0);
}

window.downloadCurrentGpx = function () {
    const t = translations[currentLang];
    if (!gpxTrackData || !currentGpxRawText) {
        statusDiv.textContent = t.status_gpx_download_none || t.status_gpx_error || 'No GPX route loaded.';
        return;
    }
    const filename = sanitizeGpxFilename(currentGpxFilename || currentGpxRawFilename || 'route') + '.gpx';
    triggerGpxDownload(currentGpxRawText, filename);
    const msg = t.status_gpx_downloaded || 'GPX downloaded as {name}.';
    statusDiv.textContent = msg.replace('{name}', filename);
};

function getGpxTrackColor() {
    const el = document.getElementById('gpxTrackColor');
    return el ? el.value : '#000000';
}

function getGpxTrackWidth() {
    const el = document.getElementById('gpxTrackWidth');
    return el ? parseInt(el.value) : 4;
}

function getGpxShowKmLabels() {
    const el = document.getElementById('gpxShowKmLabels');
    return el ? el.checked : false;
}

function haversineDistance(lat1, lon1, lat2, lon2) {
    const R = 6371000;
    const toRad = x => x * Math.PI / 180;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Current map scale denominator (the X in "1:X"). Measures the ground distance
// spanned by 100 CSS pixels at the map center, then divides by the OGC standard
// pixel size (0.28 mm) to get a real-world scale.
function computeScaleDenominator() {
    const nm = map._map;
    const cont = nm.getContainer();
    const cx = cont.clientWidth / 2, cy = cont.clientHeight / 2;
    const a = nm.unproject([cx, cy]), b = nm.unproject([cx + 100, cy]);
    const mPerPx = haversineDistance(a.lat, a.lng, b.lat, b.lng) / 100;
    return mPerPx / 0.00028;
}

// Snap a scale denominator to a readable round value (e.g. 1:50 000, 1:15 000).
function niceScaleDenominator(d) {
    const steps = [1, 1.5, 2, 2.5, 3, 4, 5, 7.5, 10];
    const mag = Math.pow(10, Math.floor(Math.log10(d)));
    const norm = d / mag;
    let best = steps[0];
    for (const s of steps) if (Math.abs(s - norm) < Math.abs(best - norm)) best = s;
    return Math.round(best * mag);
}

function formatScale(d) {
    return '1:' + Math.round(d).toLocaleString('en-US').replace(/,/g, ' ');
}

function computeTrackStats(allSegments) {
    let totalLength = 0, gain = 0, loss = 0;
    let minElev = Infinity, maxElev = -Infinity;
    let hasElevation = false;

    for (const seg of allSegments) {
        for (let i = 0; i < seg.length; i++) {
            const p = seg[i];
            if (p.ele !== null) {
                hasElevation = true;
                if (p.ele < minElev) minElev = p.ele;
                if (p.ele > maxElev) maxElev = p.ele;
            }
            if (i > 0) {
                totalLength += haversineDistance(seg[i - 1].lat, seg[i - 1].lon, p.lat, p.lon);
                if (seg[i - 1].ele !== null && p.ele !== null) {
                    const diff = p.ele - seg[i - 1].ele;
                    if (diff > 0) gain += diff;
                    else loss += Math.abs(diff);
                }
            }
        }
    }
    return {
        length: totalLength,
        gain, loss,
        minElev: hasElevation ? minElev : null,
        maxElev: hasElevation ? maxElev : null
    };
}

// Global unit system: 'metric' (km, m) or 'imperial' (mi, ft). Metric is the
// canonical internal unit everywhere; we only convert at the UI boundary.
let unitSystem = 'metric';
function getUnitSystem() { return unitSystem; }

// Short unit labels for input/axis suffixes.
function distUnitLabel() { return getUnitSystem() === 'imperial' ? 'mi' : 'km'; }
function elevUnitLabel() { return getUnitSystem() === 'imperial' ? 'ft' : 'm'; }

// Kept so existing distance code keeps working; now derived from the global system.
function getDistanceUnit() {
    return getUnitSystem() === 'imperial' ? 'mi' : 'km';
}

// Format a distance in meters for display, respecting the active unit system.
function formatDistance(meters) {
    if (getDistanceUnit() === 'mi') {
        const mi = meters / 1609.344;
        return mi >= 1 ? mi.toFixed(2) + ' mi' : (meters * 3.28084).toFixed(0) + ' ft';
    }
    return meters >= 1000 ? (meters / 1000).toFixed(2) + ' km' : Math.round(meters) + ' m';
}

// Format an elevation/height in meters for display (m or ft). Sign is preserved;
// callers that want a leading '+' add it themselves.
function formatElevation(meters) {
    if (getUnitSystem() === 'imperial') {
        return Math.round(meters * 3.28084) + ' ft';
    }
    return Math.round(meters) + ' m';
}

// Search radius from its input, in meters (input holds km in metric, mi in imperial).
function getRadiusMeters() {
    const v = parseFloat(radiusInput.value) || 5;
    return getUnitSystem() === 'imperial' ? v * 1609.344 : v * 1000;
}

// Climb "measure distance" from its input, in meters (m in metric, ft in imperial).
function getClimbDistMeters() {
    const v = parseFloat(climbDistInput.value) || 200;
    return getUnitSystem() === 'imperial' ? v * 0.3048 : v;
}

// Climb step resolution from its input, in meters (m in metric, ft in imperial).
function getClimbStepMeters() {
    const el = document.getElementById('stepSizeInput');
    const v = parseInt(el ? el.value : '', 10) || (getUnitSystem() === 'imperial' ? 33 : 10);
    return getUnitSystem() === 'imperial' ? v * 0.3048 : v;
}

// Value to display in the step-resolution input for the current unit system
// (canonical `climbStepRes` is always meters).
function climbStepDisplayValue() {
    return getUnitSystem() === 'imperial' ? Math.round(climbStepRes * 3.28084) : climbStepRes;
}

// Per-unit min/max/step for the numeric inputs. Imperial ranges roughly mirror the
// metric ones (e.g. 100 km ≈ 60 mi, 5000 m ≈ 16000 ft).
function setInputUnitAttrs(input, attrs) {
    if (!input) return;
    input.setAttribute('min', attrs.min);
    input.setAttribute('max', attrs.max);
    input.setAttribute('step', attrs.step);
}

// Convert one input's displayed value when the unit system changes, then clamp it
// to the (already updated) min/max. kind: 'distance' (km<->mi) or 'length' (m<->ft).
function convertInputValue(input, fromU, toU, kind) {
    if (!input || fromU === toU) return;
    let v = parseFloat(input.value);
    if (!isFinite(v)) return;
    if (kind === 'distance') {
        v = (fromU === 'metric') ? v / 1.609344 : v * 1.609344;
        v = Math.round(v * 10) / 10;
    } else {
        v = (fromU === 'metric') ? v * 3.28084 : v / 3.28084;
        v = Math.round(v);
    }
    const min = parseFloat(input.getAttribute('min'));
    const max = parseFloat(input.getAttribute('max'));
    if (isFinite(min)) v = Math.max(min, v);
    if (isFinite(max)) v = Math.min(max, v);
    input.value = v;
}

// Apply the current unitSystem to the numeric inputs: set unit-appropriate
// min/max/step, then convert their displayed values from prevUnit.
function applyUnitSystem(prevUnit) {
    const imperial = getUnitSystem() === 'imperial';
    const stepInput = document.getElementById('stepSizeInput');
    setInputUnitAttrs(radiusInput, imperial ? { min: 0.5, max: 60, step: 0.5 } : { min: 0.5, max: 100, step: 0.5 });
    setInputUnitAttrs(climbDistInput, imperial ? { min: 150, max: 16000, step: 50 } : { min: 50, max: 5000, step: 10 });
    setInputUnitAttrs(stepInput, imperial ? { min: 5, max: 160, step: 5 } : { min: 2, max: 50, step: 1 });
    convertInputValue(radiusInput, prevUnit, getUnitSystem(), 'distance');
    convertInputValue(climbDistInput, prevUnit, getUnitSystem(), 'length');
    // Step res mirrors the canonical `climbStepRes` (meters), so set its display directly.
    if (stepInput) stepInput.value = climbStepDisplayValue();
}

// Global units dropdown handler (About modal). Switches metric <-> imperial and
// re-renders every unit-bearing readout/input.
function setUnitSystem(value) {
    if (value !== 'imperial') value = 'metric';
    const prev = unitSystem;
    unitSystem = value;
    try { localStorage.setItem('topo_units', value); } catch (e) { /* storage unavailable */ }
    applyUnitSystem(prev);
    const sel = document.getElementById('units-select');
    if (sel) sel.value = value;
    updateLanguage();
    updateUI();
    rebuildGpxLayer();
    _updateRouteInfoPanel();
    updateCenterElevation();
    if (map) map.refreshContours();
    if (elevationProfileData && !elevationProfileMinimized) drawElevationProfile();
}

function computeVisibleTrackLength(allSegments) {
    const bounds = map.getBounds();
    let visible = 0;
    for (const seg of allSegments) {
        for (let i = 1; i < seg.length; i++) {
            const p1 = L.latLng(seg[i - 1].lat, seg[i - 1].lon);
            const p2 = L.latLng(seg[i].lat, seg[i].lon);
            if (bounds.contains(p1) || bounds.contains(p2)) {
                visible += haversineDistance(seg[i - 1].lat, seg[i - 1].lon, seg[i].lat, seg[i].lon);
            }
        }
    }
    return visible;
}

function computeDynamicStep(totalLengthMeters, visibleLengthMeters) {
    const unit = getDistanceUnit();
    const unitMeters = unit === 'mi' ? 1609.344 : 1000;
    const refLength = visibleLengthMeters > 0 ? visibleLengthMeters : totalLengthMeters;
    const refUnits = refLength / unitMeters;
    const vw = window.innerWidth || 1024;
    const TARGET_LABELS = vw < 600 ? 6 : vw < 900 ? 8 : 12;
    const niceSteps = [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500, 1000];
    let rawStep = refUnits / TARGET_LABELS;
    if (rawStep < 0.1) rawStep = 0.1;
    let step = niceSteps[niceSteps.length - 1];
    for (const s of niceSteps) {
        if (s >= rawStep) { step = s; break; }
    }
    // Ensure minimum step of 1 whole unit when total track is long
    if (totalLengthMeters / unitMeters > 20 && step < 1) step = 1;
    return { step, unitMeters, unitLabel: unit === 'mi' ? 'mi' : 'km' };
}

function buildKmLabels(allSegments) {
    const labels = [];
    let totalLength = 0;
    for (const seg of allSegments) {
        for (let i = 1; i < seg.length; i++) {
            totalLength += haversineDistance(seg[i - 1].lat, seg[i - 1].lon, seg[i].lat, seg[i].lon);
        }
    }
    const visibleLength = computeVisibleTrackLength(allSegments);
    const { step, unitMeters, unitLabel } = computeDynamicStep(totalLength, visibleLength);
    let cumDist = 0;
    let nextMark = step;
    for (const seg of allSegments) {
        for (let i = 1; i < seg.length; i++) {
            const d = haversineDistance(seg[i - 1].lat, seg[i - 1].lon, seg[i].lat, seg[i].lon);
            const prevCum = cumDist;
            cumDist += d;
            while (cumDist >= nextMark * unitMeters) {
                const frac = (nextMark * unitMeters - prevCum) / d;
                const lat = seg[i - 1].lat + frac * (seg[i].lat - seg[i - 1].lat);
                const lon = seg[i - 1].lon + frac * (seg[i].lon - seg[i - 1].lon);
                const displayVal = Number.isInteger(nextMark) ? nextMark : nextMark.toFixed(1);

                const el = document.createElement('div');
                el.className = 'gpx-km-label';
                el.innerHTML = `${displayVal} ${unitLabel}`;

                labels.push(new maplibregl.Marker({ element: el, anchor: 'center' })
                    .setLngLat([lon, lat])
                    .addTo(map._map));

                nextMark += step;
            }
        }
    }
    return labels;
}

function getGpxColorBySlope() {
    const el = document.getElementById('gpxColorBySlope');
    return el ? el.checked : false;
}

function slopeToColorHex(slopeDeg, baseColor) {
    const rgb = slopeToColor(slopeDeg, baseColor);
    const match = rgb.match(/rgb\((\d+),(\d+),(\d+)\)/);
    if (!match) return baseColor;
    const r = parseInt(match[1], 10);
    const g = parseInt(match[2], 10);
    const b = parseInt(match[3], 10);
    return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
}

function slopeToColor(slopeDeg, baseColor) {
    const s = Math.min(Math.abs(slopeDeg), 20);
    const t = s / 20; // 0 at flat, 1 at 20°+
    // Parse base color from hex
    const bc = parseInt(baseColor.replace('#', ''), 16);
    const br = (bc >> 16) & 255, bg = (bc >> 8) & 255, bb = bc & 255;
    let r, g, b;
    if (slopeDeg >= 0) {
        // Uphill: track color → yellow → red
        if (t <= 0.5) {
            const f = t / 0.5;
            r = br + f * (255 - br);
            g = bg + f * (200 - bg);
            b = bb + f * (0 - bb);
        } else {
            const f = (t - 0.5) / 0.5;
            r = 255 + f * (220 - 255);
            g = 200 + f * (30 - 200);
            b = 0 + f * (30 - 0);
        }
    } else {
        // Downhill: track color → green → blue
        if (t <= 0.5) {
            const f = t / 0.5;
            r = br + f * (0 - br);
            g = bg + f * (180 - bg);
            b = bb + f * (60 - bb);
        } else {
            const f = (t - 0.5) / 0.5;
            r = 0 + f * (30 - 0);
            g = 180 + f * (80 - 180);
            b = 60 + f * (220 - 60);
        }
    }
    return `rgb(${Math.round(r)},${Math.round(g)},${Math.round(b)})`;
}

function buildSlopeColoredGeoJSON(seg, baseColor) {
    const features = [];
    for (let i = 1; i < seg.length; i++) {
        const p0 = seg[i - 1], p1 = seg[i];
        const dist = haversineDistance(p0.lat, p0.lon, p1.lat, p1.lon);
        let slopeDeg = 0;
        if (dist > 0 && p0.ele !== null && p1.ele !== null) {
            slopeDeg = Math.atan2(p1.ele - p0.ele, dist) * (180 / Math.PI);
        }
        features.push({
            type: 'Feature',
            geometry: {
                type: 'LineString',
                coordinates: [[p0.lon, p0.lat], [p1.lon, p1.lat]]
            },
            properties: {
                color: slopeToColorHex(slopeDeg, baseColor)
            }
        });
    }
    return features;
}

function findMinMaxElevPoints(allSegments) {
    let minPt = null, maxPt = null;
    let minElev = Infinity, maxElev = -Infinity;
    for (const seg of allSegments) {
        for (const p of seg) {
            if (p.ele === null) continue;
            if (p.ele < minElev) { minElev = p.ele; minPt = p; }
            if (p.ele > maxElev) { maxElev = p.ele; maxPt = p; }
        }
    }
    return { minPt, maxPt };
}

function getTrackEndpoints(allSegments) {
    let startPt = null, endPt = null;
    for (const seg of allSegments) {
        if (seg.length > 0) {
            if (!startPt) startPt = seg[0];
            endPt = seg[seg.length - 1];
        }
    }
    return { startPt, endPt };
}

function getGpxShowWaypoints() {
    const el = document.getElementById('gpxShowWaypoints');
    return el ? el.checked : true;
}

function getGpxShowMinMax() {
    const el = document.getElementById('gpxShowMinMax');
    return el ? el.checked : true;
}

function getGpxShowElevProfile() {
    const el = document.getElementById('gpxShowElevProfile');
    return el ? el.checked : true;
}

function getElevMapSync() {
    const el = document.getElementById('gpxElevMapSync');
    return el ? el.checked : true;
}

function clearMarkerCollection(markers) {
    markers.forEach(marker => marker.remove());
}

function removeLegendControl(control) {
    if (!control) return;
    if (typeof control.remove === 'function') {
        control.remove();
    } else {
        map.removeControl(control);
    }
}

function getSlopeMapLegendItems() {
    return [
        { label: '0-9°', color: '#FFFFFF' },
        { label: '10-29°', color: '#247400' },
        { label: '30-34°', color: '#ffff00' },
        { label: '35-39°', color: '#ffa900' },
        { label: '40-44°', color: '#ff5500' },
        { label: '45-49°', color: '#e60000' },
        { label: '50°+', color: '#740000' }
    ];
}

function getGpxSlopeLegendItems(baseColor) {
    return [
        { label: '<= -20°', color: slopeToColorHex(-20, baseColor) },
        { label: '-20° to -10°', color: slopeToColorHex(-15, baseColor) },
        { label: '-10° to 0°', color: slopeToColorHex(-5, baseColor) },
        { label: '0°', color: slopeToColorHex(0, baseColor) },
        { label: '0° to 10°', color: slopeToColorHex(5, baseColor) },
        { label: '10° to 20°', color: slopeToColorHex(15, baseColor) },
        { label: '>= 20°', color: slopeToColorHex(20, baseColor) }
    ];
}

function createSlopeLegendControl(legendItems) {
    const t = translations[currentLang];
    const legend = L.control({ position: 'bottomleft' });
    legend.onAdd = function () {
        const div = L.DomUtil.create('div', 'slope-legend');
        let html = `<div class="slope-legend-title">${t.slope_legend_title}</div>`;
        for (const item of legendItems) {
            html += `<div class="slope-legend-item"><span class="slope-legend-color" style="background:${item.color}"></span>${item.label}</div>`;
        }
        div.innerHTML = html;
        return div;
    };
    return legend;
}

function clearGpxTrackSourceAndLayers() {
    const nativeMap = map._map;
    if (nativeMap.getLayer(GPX_LINE_LAYER_ID)) {
        nativeMap.removeLayer(GPX_LINE_LAYER_ID);
    }
    if (nativeMap.getSource('gpx-track')) {
        nativeMap.removeSource('gpx-track');
    }
}

function buildGpxTrackFeatures() {
    const color = getGpxTrackColor();
    const colorBySlope = getGpxColorBySlope();
    const gpxFeatures = [];

    for (const seg of gpxTrackData.segments) {
        if (seg.length < 2) continue;
        if (colorBySlope) {
            gpxFeatures.push(...buildSlopeColoredGeoJSON(seg, color));
        } else {
            gpxFeatures.push({
                type: 'Feature',
                geometry: {
                    type: 'LineString',
                    coordinates: seg.map(p => [p.lon, p.lat])
                },
                properties: { color: color }
            });
        }
    }

    return gpxFeatures;
}

function updateGpxTrackLine() {
    const nativeMap = map._map;
    const gpxFeatures = buildGpxTrackFeatures();
    const weight = getGpxTrackWidth();

    if (gpxFeatures.length === 0) {
        clearGpxTrackSourceAndLayers();
        return;
    }

    const sourceData = {
        type: 'FeatureCollection',
        features: gpxFeatures
    };

    const existingSource = nativeMap.getSource('gpx-track');
    if (existingSource) {
        existingSource.setData(sourceData);
    } else {
        nativeMap.addSource('gpx-track', {
            type: 'geojson',
            data: sourceData
        });
    }

    if (nativeMap.getLayer(GPX_LINE_LAYER_ID)) {
        nativeMap.setPaintProperty(GPX_LINE_LAYER_ID, 'line-color', ['get', 'color']);
        nativeMap.setPaintProperty(GPX_LINE_LAYER_ID, 'line-width', weight);
        nativeMap.setPaintProperty(GPX_LINE_LAYER_ID, 'line-opacity', 0.85);
        // Safety net: re-raise to the very top in case anything slipped above it.
        try { nativeMap.moveLayer(GPX_LINE_LAYER_ID); } catch (e) { /* ignore */ }
        return;
    }

    // No beforeId: a freshly added track belongs on top of whatever is already drawn.
    nativeMap.addLayer({
        id: GPX_LINE_LAYER_ID,
        type: 'line',
        source: 'gpx-track',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: {
            'line-color': ['get', 'color'],
            'line-width': weight,
            'line-opacity': 0.85
        }
    });
}

function rebuildGpxMarkers() {
    clearMarkerCollection(currentMarkers);
    currentMarkers = [];

    const showWaypoints = getGpxShowWaypoints();
    const showMinMax = getGpxShowMinMax();
    const t = translations[currentLang];

    if (showWaypoints) {
        for (const wp of gpxTrackData.waypoints) {
            const label = wp.name || '•';
            const el = document.createElement('div');
            el.className = 'gpx-waypoint-label';
            // textContent, not innerHTML: waypoint names come from user-supplied GPX
            // (including shared ?gpx= links) and must never be parsed as HTML.
            el.textContent = label;
            currentMarkers.push(new maplibregl.Marker({ element: el })
                .setLngLat([wp.lon, wp.lat])
                .addTo(map._map));
        }
    }

    const { startPt, endPt } = getTrackEndpoints(gpxTrackData.segments);
    const OVERLAP_THRESHOLD = 50;
    const startEndOverlap = startPt && endPt &&
        haversineDistance(startPt.lat, startPt.lon, endPt.lat, endPt.lon) < OVERLAP_THRESHOLD;

    if (startEndOverlap) {
        const label = `▶ ${t.gpx_start || 'Start'} / ${t.gpx_end || 'End'}`;
        const el = document.createElement('div');
        el.className = 'gpx-start-end-label';
        el.textContent = label;
        currentMarkers.push(new maplibregl.Marker({ element: el })
            .setLngLat([startPt.lon, startPt.lat])
            .addTo(map._map));
    } else {
        if (startPt) {
            const el = document.createElement('div');
            el.className = 'gpx-start-end-label';
            el.textContent = `▶ ${t.gpx_start || 'Start'}`;
            currentMarkers.push(new maplibregl.Marker({ element: el })
                .setLngLat([startPt.lon, startPt.lat])
                .addTo(map._map));
        }
        if (endPt) {
            const el = document.createElement('div');
            el.className = 'gpx-start-end-label';
            el.textContent = `⏹ ${t.gpx_end || 'End'}`;
            currentMarkers.push(new maplibregl.Marker({ element: el })
                .setLngLat([endPt.lon, endPt.lat])
                .addTo(map._map));
        }
    }

    if (showMinMax) {
        const { minPt, maxPt } = findMinMaxElevPoints(gpxTrackData.segments);
        if (maxPt) {
            const el = document.createElement('div');
            el.className = 'gpx-elev-label';
            el.textContent = `▲ ${formatElevation(maxPt.ele)}`;
            currentMarkers.push(new maplibregl.Marker({ element: el })
                .setLngLat([maxPt.lon, maxPt.lat])
                .addTo(map._map));
        }
        if (minPt) {
            const el = document.createElement('div');
            el.className = 'gpx-elev-label min-elev';
            el.textContent = `▼ ${formatElevation(minPt.ele)}`;
            currentMarkers.push(new maplibregl.Marker({ element: el })
                .setLngLat([minPt.lon, minPt.lat])
                .addTo(map._map));
        }
    }
}

function refreshGpxKmLabels() {
    clearMarkerCollection(currentKmMarkers);
    currentKmMarkers = [];

    if (!gpxTrackData || !getGpxShowKmLabels()) {
        return;
    }

    currentKmMarkers = buildKmLabels(gpxTrackData.segments);
}

function syncGpxSlopeLegend() {
    removeLegendControl(gpxSlopeLegend);
    gpxSlopeLegend = null;

    if (!gpxTrackData || !getGpxColorBySlope()) {
        return;
    }

    gpxSlopeLegend = createSlopeLegendControl(getGpxSlopeLegendItems(getGpxTrackColor()));
    gpxSlopeLegend.addTo(map);
}

function rebuildGpxLayer() {
    if (!gpxTrackData) return;

    updateGpxTrackLine();
    rebuildGpxMarkers();
    refreshGpxKmLabels();
    syncGpxSlopeLegend();
}

function parseGpxText(gpxText) {
    const t = translations[currentLang];
    const parser = new DOMParser();
    const doc = parser.parseFromString(gpxText, 'application/xml');
    if (doc.querySelector('parsererror')) {
        throw new Error(t.status_gpx_error || 'Failed to load GPX file.');
    }

    const allSegments = [];
    const waypoints = [];
    let totalPoints = 0;

    doc.querySelectorAll('trk').forEach(trk => {
        trk.querySelectorAll('trkseg').forEach(seg => {
            const pts = [];
            seg.querySelectorAll('trkpt').forEach(pt => {
                const lat = parseFloat(pt.getAttribute('lat'));
                const lon = parseFloat(pt.getAttribute('lon'));
                const eleEl = pt.querySelector('ele');
                const ele = eleEl ? parseFloat(eleEl.textContent) : null;
                if (!isNaN(lat) && !isNaN(lon)) pts.push({ lat, lon, ele: isNaN(ele) ? null : ele });
            });
            if (pts.length > 0) {
                allSegments.push(pts);
                totalPoints += pts.length;
            }
        });
    });

    doc.querySelectorAll('rte').forEach(rte => {
        const pts = [];
        rte.querySelectorAll('rtept').forEach(pt => {
            const lat = parseFloat(pt.getAttribute('lat'));
            const lon = parseFloat(pt.getAttribute('lon'));
            const eleEl = pt.querySelector('ele');
            const ele = eleEl ? parseFloat(eleEl.textContent) : null;
            if (!isNaN(lat) && !isNaN(lon)) pts.push({ lat, lon, ele: isNaN(ele) ? null : ele });
        });
        if (pts.length > 0) {
            allSegments.push(pts);
            totalPoints += pts.length;
        }
    });

    doc.querySelectorAll('wpt').forEach(pt => {
        const lat = parseFloat(pt.getAttribute('lat'));
        const lon = parseFloat(pt.getAttribute('lon'));
        if (!isNaN(lat) && !isNaN(lon)) {
            const nameEl = pt.querySelector('name');
            const name = nameEl ? nameEl.textContent : '';
            waypoints.push({ lat, lon, name });
            totalPoints++;
        }
    });

    if (allSegments.length === 0 && waypoints.length === 0) {
        throw new Error(t.status_gpx_empty || 'No track data found in GPX file.');
    }

    return {
        segments: allSegments,
        waypoints,
        totalPoints,
        stats: computeTrackStats(allSegments)
    };
}
window.parseGpxText = parseGpxText;

function fitGpxBounds(allSegments, waypoints) {
    const allCoords = [];
    allSegments.forEach(s => s.forEach(p => allCoords.push([p.lat, p.lon])));
    waypoints.forEach(w => allCoords.push([w.lat, w.lon]));
    if (allCoords.length > 0) {
        map.fitBounds(L.latLngBounds(allCoords).pad(0.1));
    }
}

function setActiveGpxSource(source) {
    currentSharedGpxId = isBackendEnabled() && source && source.id ? source.id : null;
    currentGpxFilename = source && source.filename ? source.filename : null;
    currentGpxShareUrl = isBackendEnabled() && source && source.shareUrl ? source.shareUrl : null;

    const params = new URLSearchParams(location.search);
    if (isBackendEnabled() && currentSharedGpxId) {
        params.set('gpx', currentSharedGpxId);
    } else {
        params.delete('gpx');
    }
    const queryString = params.toString();
    history.replaceState(null, '', location.pathname + (queryString ? '?' + queryString : '') + location.hash);
}

function applyParsedGpxData(parsedGpx, options = {}) {
    const t = translations[currentLang];
    // Leave edit mode before gpxTrackData is replaced: gpxEditState.segIndex would
    // otherwise dangle into a different track and corrupt the next splice.
    _gpxEditForceExit();
    // Same reason: a shared ?gpx= link resolving or a file opening mid-flow must not leave
    // a half-placed route waiting for its second click over a different track.
    _routeCreateForceExit();
    gpxTrackData = {
        segments: parsedGpx.segments,
        waypoints: parsedGpx.waypoints,
        ...parsedGpx.stats
    };
    setActiveGpxSource(options.source || null);
    currentGpxRawText = options.rawText || null;
    currentGpxRawFilename = options.rawFilename ||
        (options.source && options.source.filename) || null;
    gpxTextIsGenerated = false;

    rebuildGpxLayer();
    _updateRouteInfoPanel();
    showElevationProfile();

    if (!options.skipFitBounds) {
        fitGpxBounds(parsedGpx.segments, parsedGpx.waypoints);
    }

    const actionRow = document.getElementById('gpx-action-row');
    if (actionRow) actionRow.style.display = 'flex';

    const statusMessage = options.statusMessage || t.status_gpx_loaded || 'GPX route loaded ({n} points).';
    statusDiv.textContent = statusMessage.replace('{n}', parsedGpx.totalPoints);
}

function normalizeUploadedFileEntry(fileEntry) {
    if (typeof fileEntry === 'string') {
        return {
            id: fileEntry,
            filename: fileEntry,
            shareUrl: null,
            uploadedAt: null
        };
    }
    return {
        id: fileEntry.id || fileEntry.filename,
        filename: fileEntry.filename || fileEntry.name || fileEntry.id || 'GPX file',
        shareUrl: fileEntry.share_url || fileEntry.shareUrl || null,
        uploadedAt: fileEntry.uploaded_at || fileEntry.uploadedAt || null
    };
}

function renderUploadedFiles() {
    const listEl = document.getElementById('uploaded-gpx-list');
    const emptyEl = document.getElementById('uploaded-gpx-empty');
    if (!listEl || !emptyEl) return;

    const t = translations[currentLang];
    listEl.innerHTML = '';
    if (!isBackendEnabled() || uploadedGpxListState === 'disabled') {
        emptyEl.style.display = '';
        emptyEl.textContent = t.uploaded_gpx_unavailable || 'Backend upload and sharing are disabled in this build.';
        return;
    }

    if (uploadedGpxListState === 'loading') {
        emptyEl.style.display = '';
        emptyEl.textContent = t.uploaded_gpx_loading || 'Loading uploaded GPX files...';
        return;
    }

    if (uploadedGpxListState === 'error') {
        emptyEl.style.display = '';
        emptyEl.textContent = t.uploaded_gpx_error || 'Could not load uploaded GPX files.';
        return;
    }

    if (!uploadedGpxFiles.length) {
        emptyEl.style.display = '';
        emptyEl.textContent = t.uploaded_gpx_empty || 'No uploaded GPX files yet.';
        return;
    }

    emptyEl.style.display = 'none';
    uploadedGpxFiles.forEach(fileEntry => {
        const row = document.createElement('div');
        row.className = 'uploaded-gpx-item';

        const meta = document.createElement('div');
        meta.className = 'uploaded-gpx-meta';

        const name = document.createElement('span');
        name.className = 'uploaded-gpx-name';
        name.textContent = fileEntry.filename;
        meta.appendChild(name);

        if (fileEntry.uploadedAt) {
            const stamp = document.createElement('span');
            stamp.className = 'uploaded-gpx-date';
            const uploadedDate = new Date(fileEntry.uploadedAt);
            stamp.textContent = Number.isNaN(uploadedDate.getTime())
                ? fileEntry.uploadedAt
                : uploadedDate.toLocaleString();
            meta.appendChild(stamp);
        }

        const actions = document.createElement('div');
        actions.className = 'uploaded-gpx-actions';

        const openBtn = document.createElement('button');
        openBtn.type = 'button';
        openBtn.className = 'secondary-btn';
        openBtn.textContent = t.btn_open_uploaded_gpx || 'Open';
        openBtn.addEventListener('click', async () => {
            const didLoad = await loadSharedGpxById(fileEntry.id, { filename: fileEntry.filename });
            if (didLoad) {
                closeGpxModal();
            }
        });
        actions.appendChild(openBtn);

        const renameBtn = document.createElement('button');
        renameBtn.type = 'button';
        renameBtn.className = 'secondary-btn';
        renameBtn.textContent = t.btn_rename_uploaded_gpx || 'Rename';
        renameBtn.addEventListener('click', () => {
            window.renameUploadedGpx(fileEntry.id);
        });
        actions.appendChild(renameBtn);

        const deleteBtn = document.createElement('button');
        deleteBtn.type = 'button';
        deleteBtn.className = 'danger-btn';
        deleteBtn.textContent = t.btn_delete_uploaded_gpx || 'Delete';
        deleteBtn.addEventListener('click', () => {
            window.deleteUploadedGpx(fileEntry.id);
        });
        actions.appendChild(deleteBtn);

        row.appendChild(meta);
        row.appendChild(actions);
        listEl.appendChild(row);
    });
}

// ==========================================
// Google Sign-In (optional cross-device upload history)
// ==========================================
function decodeJwtPayload(token) {
    try {
        const part = token.split('.')[1];
        let base64 = part.replace(/-/g, '+').replace(/_/g, '/');
        while (base64.length % 4) base64 += '='; // restore base64url padding
        const json = decodeURIComponent(atob(base64).split('').map(c =>
            '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)).join(''));
        return JSON.parse(json);
    } catch (e) {
        return null;
    }
}

function isGoogleSignedIn() {
    if (!googleAuth || !googleAuth.exp || googleAuth.exp * 1000 <= Date.now()) return false;
    // Session-backed identities carry no token: the HttpOnly cookie is the credential.
    return googleAuth.source === 'session' || !!googleAuth.token;
}

// True while the identity rests on a short-lived Google ID token, which is the only case
// where a silent One Tap re-auth can rescue an expired credential.
function isTokenBackedAuth() {
    return !!(googleAuth && googleAuth.source !== 'session' && googleAuth.token);
}

// Resolve any in-flight silent refresh with the given result (idempotent).
function settlePendingAuthRefresh(success) {
    if (!pendingAuthRefresh) return;
    const pending = pendingAuthRefresh;
    pendingAuthRefresh = null;
    if (pending.timeout) clearTimeout(pending.timeout);
    pending.resolve(success);
}

function clearGoogleAuthRefreshTimer() {
    if (googleRefreshTimer) { clearTimeout(googleRefreshTimer); googleRefreshTimer = null; }
}

// Ask Google for a fresh ID token without user interaction (auto-select / One Tap).
// Resolves true once a new token arrives via handleGoogleCredential, false if a
// silent re-auth isn't possible (GIS unavailable, prompt suppressed, or timeout).
function refreshGoogleAuth() {
    if (!isBackendEnabled() || !GOOGLE_CLIENT_ID) return Promise.resolve(false);
    // Only meaningful without a server session; a live cookie needs no One Tap.
    if (googleAuth && googleAuth.source === 'session') return Promise.resolve(false);
    if (pendingAuthRefresh) return pendingAuthRefresh.promise;
    if (!(window.google && google.accounts && google.accounts.id)) return Promise.resolve(false);

    let resolveFn;
    const promise = new Promise(resolve => { resolveFn = resolve; });
    const timeout = setTimeout(() => settlePendingAuthRefresh(false), GOOGLE_AUTH_REFRESH_TIMEOUT_MS);
    pendingAuthRefresh = { promise, resolve: resolveFn, timeout };
    try {
        google.accounts.id.prompt(notification => {
            // Best-effort early failure signal. Under FedCM these introspection
            // methods are deprecated/may throw, so guard and otherwise let the
            // credential callback (success) or the timeout (failure) settle it.
            // A returned credential surfaces as a dismissed moment, so we never
            // treat dismissal as failure here.
            try {
                if (notification.isNotDisplayed && notification.isNotDisplayed()) {
                    settlePendingAuthRefresh(false);
                } else if (notification.isSkippedMoment && notification.isSkippedMoment()) {
                    settlePendingAuthRefresh(false);
                }
            } catch (e) { /* FedCM: moment introspection unsupported; rely on timeout */ }
        });
    } catch (e) {
        settlePendingAuthRefresh(false);
    }
    return promise;
}

// Re-auth silently a few minutes before the current token expires so a tab left
// open never quietly falls back to the anonymous session.
function scheduleGoogleAuthRefresh() {
    clearGoogleAuthRefreshTimer();
    if (!isGoogleSignedIn()) return;
    const msUntilRefresh = googleAuth.exp * 1000 - Date.now() - GOOGLE_AUTH_REFRESH_LEAD_MS;
    googleRefreshTimer = setTimeout(() => { refreshGoogleAuth(); }, Math.max(0, msUntilRefresh));
}

// Run an authenticated request; on a 401, try once to recover before falling back to the
// anonymous session. makeRequest must build a fresh fetch each call so it picks up any
// new credential. A session-backed 401 means the server session is gone (nothing to
// refresh), so we just drop to anonymous and retry once.
async function fetchWithAuthRetry(makeRequest) {
    let response = await makeRequest();
    if (response.status === 401 && isGoogleSignedIn()) {
        if (isTokenBackedAuth() && await refreshGoogleAuth()) {
            response = await makeRequest();
        }
        if (response.status === 401 && isGoogleSignedIn()) {
            clearGoogleAuthState();
            response = await makeRequest();
        }
    }
    return response;
}

// Bearer header sent with the file endpoints; empty object means the request is carried by
// the session cookie (signed in) or the anonymous owner cookie (signed out).
function authHeaders() {
    return (isGoogleSignedIn() && googleAuth.token) ? { Authorization: 'Bearer ' + googleAuth.token } : {};
}

// Auth is kept in memory only (never written to localStorage) so a DOM-XSS cannot read
// the Google ID token or a session credential. Persistence across reloads is the backend's
// HttpOnly session cookie instead (see restoreGoogleSession).
function persistGoogleAuth() {
    try { localStorage.removeItem(GOOGLE_AUTH_STORAGE_KEY); } catch (e) { /* storage unavailable */ }
}

// Drop the in-memory identity. By default this is a *soft* clear used by the 401 paths:
// it must not disable Google's auto-select or forget that this device has signed in
// before, or one transient backend hiccup would permanently kill silent re-auth here.
// Pass { forget: true } for an explicit sign-out, which also ends the server session.
function clearGoogleAuthState(options) {
    const forget = !!(options && options.forget);
    googleAuth = null;
    persistGoogleAuth();
    clearGoogleAuthRefreshTimer();
    settlePendingAuthRefresh(false);
    if (forget) {
        try { localStorage.removeItem(GOOGLE_SEEN_KEY); } catch (e) { /* storage unavailable */ }
        try {
            if (window.google && google.accounts && google.accounts.id) {
                google.accounts.id.disableAutoSelect();
            }
        } catch (e) { /* ignore */ }
        if (isBackendEnabled()) {
            fetch(API_BASE + '/auth/logout', {
                method: 'POST',
                credentials: 'same-origin',
                cache: 'no-store'
            }).catch(() => { /* best effort; the cookie also expires on its own */ });
        }
    }
    updateGpxModalAuthUI();
    updatePoiModalAuthUI();
    // Keep the user's pins visible after logout by falling back to the local cache.
    refreshPoiList();
}

// Tell the backend who we are so it can merge any anonymous uploads into the account and
// hand back a long-lived session cookie.
async function postAuthLogin() {
    if (!isGoogleSignedIn() || !googleAuth.token || !isBackendEnabled()) return null;
    try {
        const response = await fetch(API_BASE + '/auth/login', {
            method: 'POST',
            credentials: 'same-origin',
            headers: Object.assign({ 'Content-Type': 'application/json' }, authHeaders()),
            body: JSON.stringify({ credential: googleAuth.token })
        });
        if (response.status === 401) { clearGoogleAuthState(); return null; }
        if (!response.ok) return null;
        return await response.json();
    } catch (e) {
        return null;
    }
}

// Restore a previous sign-in from the backend's HttpOnly session cookie. This is what makes
// sign-in survive reloads, PWA relaunches and service-worker updates without depending on
// Google's One Tap (which is routinely suppressed under FedCM / third-party-cookie rules).
async function restoreGoogleSession() {
    if (!isBackendEnabled()) return false;
    try {
        const response = await fetch(API_BASE + '/auth/session', {
            cache: 'no-store',
            credentials: 'same-origin'
        });
        if (!response.ok) return false;
        const payload = await response.json();
        if (!payload || !payload.signed_in || !payload.sub) return false;
        adoptGoogleSession(payload);
        return true;
    } catch (e) {
        return false;   // offline or backend down: fall back to the anonymous flow
    }
}

// Switch the in-memory identity over to the server session described by `payload`
// ({ email, name, picture, sub, session_exp }); the ID token is no longer needed.
function adoptGoogleSession(payload) {
    googleAuth = {
        token: null,
        exp: payload.session_exp || 0,
        email: payload.email || '',
        name: payload.name || '',
        picture: payload.picture || '',
        sub: payload.sub,
        source: 'session'
    };
    clearGoogleAuthRefreshTimer();   // a 90-day cookie needs no pre-expiry One Tap
    try { localStorage.setItem(GOOGLE_SEEN_KEY, '1'); } catch (e) { /* storage unavailable */ }
    updateGpxModalAuthUI();
    updatePoiModalAuthUI();
}

// GIS callback: receives a signed ID token (JWT) on successful sign-in.
function handleGoogleCredential(response) {
    const t = translations[currentLang];
    const token = response && response.credential;
    const claims = token ? decodeJwtPayload(token) : null;
    if (!token || !claims || !claims.sub) {
        if (statusDiv) statusDiv.textContent = t.status_sign_in_error || 'Sign in failed.';
        return;
    }
    googleAuth = {
        token: token,
        exp: claims.exp || 0,
        email: claims.email || '',
        name: claims.name || '',
        picture: claims.picture || '',
        sub: claims.sub,
        source: 'token'
    };
    persistGoogleAuth();
    try { localStorage.setItem(GOOGLE_SEEN_KEY, '1'); } catch (e) { /* storage unavailable */ }
    settlePendingAuthRefresh(true);   // unblock any silent refresh waiting on this token
    scheduleGoogleAuthRefresh();      // fallback until the server session takes over below
    updateGpxModalAuthUI();
    updatePoiModalAuthUI();
    if (statusDiv) {
        statusDiv.textContent = (t.status_signed_in || 'Signed in as {email}.')
            .replace('{email}', googleAuth.email || googleAuth.name || '');
    }
    // Merge anonymous uploads into the account, then show the account's files + POIs. The
    // login response carries a session cookie, so hand the identity over to it and stop
    // caring about the ID token's ~1h life (an older backend omits session_exp: keep the
    // token and its pre-expiry One Tap refresh).
    postAuthLogin()
        .then(payload => {
            if (payload && payload.session_exp) adoptGoogleSession(payload);
        })
        .finally(() => { refreshUploadedFiles(); refreshPoiList(); });
}

window.signOutGoogle = function () {
    const t = translations[currentLang];
    clearGoogleAuthState({ forget: true });
    if (statusDiv) statusDiv.textContent = t.status_signed_out || 'Signed out.';
    refreshUploadedFiles();
};

function updateGpxModalAuthUI() {
    const authWrap = document.getElementById('gpx-auth');
    const signinEl = document.getElementById('gpx-auth-signin');
    const userEl = document.getElementById('gpx-auth-user');
    if (!authWrap || !signinEl || !userEl) return;

    // Sign-in only matters when the upload backend is present.
    if (!isBackendEnabled()) { authWrap.style.display = 'none'; return; }
    authWrap.style.display = '';

    if (isGoogleSignedIn()) {
        signinEl.style.display = 'none';
        userEl.style.display = '';
        const avatar = document.getElementById('gpx-user-avatar');
        const emailEl = document.getElementById('gpx-user-email');
        if (avatar) {
            if (googleAuth.picture) { avatar.src = googleAuth.picture; avatar.style.display = ''; }
            else { avatar.removeAttribute('src'); avatar.style.display = 'none'; }
        }
        if (emailEl) emailEl.textContent = googleAuth.email || googleAuth.name || '';
    } else {
        signinEl.style.display = '';
        userEl.style.display = 'none';
    }
}

// Poll briefly for the async GIS script; give up quietly so the app still works offline.
function whenGisReady(callback, attempts) {
    if (attempts === undefined) attempts = 40;
    if (window.google && google.accounts && google.accounts.id) { callback(); return; }
    if (attempts <= 0) return;
    window.setTimeout(() => whenGisReady(callback, attempts - 1), 100);
}

async function initGoogleAuth() {
    if (googleAuthInitialized) return;
    if (!isBackendEnabled() || !GOOGLE_CLIENT_ID) return;
    googleAuthInitialized = true;   // set before the awaits below so init can't re-enter

    // Auth lives in memory only (see persistGoogleAuth): purge any token an older build
    // left in localStorage. Persistence comes from the backend's HttpOnly session cookie.
    try { localStorage.removeItem(GOOGLE_AUTH_STORAGE_KEY); } catch (e) { /* ignore */ }
    let seenBefore = false;
    try { seenBefore = localStorage.getItem(GOOGLE_SEEN_KEY) === '1'; } catch (e) { /* ignore */ }
    updateGpxModalAuthUI();
    updatePoiModalAuthUI();

    // Restore the server session first: it does not depend on the Google script loading, so
    // a returning user is signed in immediately even if accounts.google.com is slow/blocked.
    const restored = await restoreGoogleSession();
    if (restored) {
        refreshUploadedFiles();
        // Pins need the map style; whenGpxMapReady mirrors initializeBackendFeatures.
        whenGpxMapReady(() => refreshPoiList());
    }

    whenGisReady(() => {
        try {
            google.accounts.id.initialize({
                client_id: GOOGLE_CLIENT_ID,
                callback: handleGoogleCredential,
                auto_select: true,
                use_fedcm_for_prompt: true
            });
            const signinButtonOptions = {
                theme: 'outline',
                size: 'large',
                type: 'standard',
                shape: 'pill',
                text: 'signin_with',
                logo_alignment: 'left',
                width: 240
            };
            const btnEl = document.getElementById('google-signin-btn');
            if (btnEl) google.accounts.id.renderButton(btnEl, signinButtonOptions);
            const poiBtnEl = document.getElementById('poi-google-signin-btn');
            if (poiBtnEl) google.accounts.id.renderButton(poiBtnEl, signinButtonOptions);
            // No server session but this device has signed in before: try a silent One Tap
            // re-auth so they're restored without a click. Brand-new visitors are not
            // nagged — they use the rendered Sign in button instead.
            if (!isGoogleSignedIn() && seenBefore) {
                google.accounts.id.prompt();
            }
        } catch (e) {
            // GIS init failed (blocked/offline): stay on the anonymous flow.
        }
        updateGpxModalAuthUI();
        updatePoiModalAuthUI();
    });
}

async function refreshUploadedFiles(authRetried) {
    if (!isBackendEnabled()) {
        uploadedGpxFiles = [];
        uploadedGpxListState = 'disabled';
        renderUploadedFiles();
        return;
    }

    uploadedGpxListState = 'loading';
    renderUploadedFiles();
    try {
        const response = await fetch(API_BASE + '/files', {
            cache: 'no-store',
            credentials: 'same-origin',
            headers: authHeaders()
        });
        if (response.status === 401 && isGoogleSignedIn()) {
            // Credential expired/rejected: for a token-backed identity try one silent
            // refresh and reload with the fresh token; otherwise drop the identity (soft:
            // silent re-auth stays available) and reload as the anonymous session.
            if (!authRetried && isTokenBackedAuth() && await refreshGoogleAuth()) {
                return refreshUploadedFiles(true);
            }
            clearGoogleAuthState();
            return refreshUploadedFiles();
        }
        if (!response.ok) {
            throw new Error('Failed to fetch uploaded GPX files');
        }
        const payload = await response.json();
        const files = Array.isArray(payload.files) ? payload.files : [];
        uploadedGpxFiles = files.map(normalizeUploadedFileEntry).filter(fileEntry => fileEntry.id);
        uploadedGpxListState = 'ready';
        renderUploadedFiles();
    } catch (err) {
        uploadedGpxFiles = [];
        uploadedGpxListState = 'error';
        renderUploadedFiles();
    }
}

async function loadSharedGpxById(gpxId, options = {}) {
    const t = translations[currentLang];
    if (!gpxId) return;
    if (!isBackendEnabled()) {
        statusDiv.textContent = t.status_shared_gpx_backend_disabled || t.status_backend_disabled || 'Backend sharing is disabled in this build.';
        return false;
    }
    statusDiv.textContent = t.status_loading_shared_gpx || t.status_loading || 'Loading data...';
    try {
        const response = await fetch(API_BASE + '/files/' + encodeURIComponent(gpxId) + '/raw', {
            cache: 'no-store',
            credentials: 'same-origin'
        });
        if (!response.ok) {
            throw new Error('Failed to load shared GPX');
        }
        const gpxText = await response.text();
        const parsedGpx = parseGpxText(gpxText);
        applyParsedGpxData(parsedGpx, {
            source: {
                id: gpxId,
                filename: options.filename || currentGpxFilename || gpxId,
                shareUrl: options.shareUrl || null
            },
            rawText: gpxText,
            rawFilename: options.filename || currentGpxFilename || gpxId,
            skipFitBounds: options.skipFitBounds,
            statusMessage: t.status_shared_gpx_loaded || t.status_gpx_loaded || 'GPX route loaded ({n} points).'
        });
        const params = new URLSearchParams(location.search);
        params.set('gpx', gpxId);
        history.replaceState(null, '', location.pathname + '?' + params.toString() + location.hash);
        return true;
    } catch (err) {
        statusDiv.textContent = t.status_shared_gpx_error || t.status_gpx_error || 'Failed to load GPX file.';
        return false;
    }
}

async function uploadGpxFile(file) {
    if (!isBackendEnabled()) {
        return null;
    }

    const t = translations[currentLang];
    const formData = new FormData();
    formData.append('file', file);
    statusDiv.textContent = t.status_uploading_gpx || t.status_loading || 'Loading data...';

    const response = await fetchWithAuthRetry(() => fetch(API_BASE + '/upload', {
        method: 'POST',
        credentials: 'same-origin',
        headers: authHeaders(),
        body: formData
    }));
    if (!response.ok) {
        throw new Error('Failed to upload GPX');
    }

    const payload = await response.json();
    return {
        id: payload.id || payload.filename,
        filename: payload.filename || file.name,
        shareUrl: payload.share_url || payload.shareUrl || null
    };
}

async function handleLocalFileSelection(file) {
    const t = translations[currentLang];
    if (!file) return;
    try {
        const gpxText = await file.text();
        const parsedGpx = parseGpxText(gpxText);
        let uploadResult = null;
        if (isBackendEnabled()) {
            try {
                uploadResult = await uploadGpxFile(file);
            } catch (uploadErr) {
                uploadResult = null;
            }
        }
        applyParsedGpxData(parsedGpx, {
            source: uploadResult,
            rawText: gpxText,
            rawFilename: file.name,
            statusMessage: uploadResult
                ? (t.status_gpx_uploaded || t.status_gpx_loaded || 'GPX route loaded ({n} points).')
                : (isBackendEnabled()
                    ? (t.status_gpx_loaded_local || t.status_gpx_loaded || 'GPX route loaded ({n} points).')
                    : (t.status_gpx_loaded_local_only || t.status_gpx_loaded || 'GPX route loaded ({n} points).'))
        });
        if (uploadResult) {
            await refreshUploadedFiles();
        }
    } catch (err) {
        statusDiv.textContent = t.status_gpx_error || 'Failed to load GPX file.';
    }
}

document.getElementById('gpx-file-input').addEventListener('change', async function (e) {
    const file = e.target.files[0];
    e.target.value = '';
    await handleLocalFileSelection(file);
});

// Live-update track when settings change
document.getElementById('gpxTrackColor').addEventListener('input', function () { rebuildGpxLayer(); });
document.getElementById('gpxTrackWidth').addEventListener('input', function () {
    document.getElementById('gpxTrackWidthVal').textContent = this.value;
    rebuildGpxLayer();
});
document.getElementById('gpxShowKmLabels').addEventListener('change', function () { rebuildGpxLayer(); });
document.getElementById('gpxColorBySlope').addEventListener('change', function () { rebuildGpxLayer(); });
document.getElementById('gpxShowWaypoints').addEventListener('change', function () { rebuildGpxLayer(); });
document.getElementById('gpxShowMinMax').addEventListener('change', function () { rebuildGpxLayer(); });
document.getElementById('gpxShowElevProfile').addEventListener('change', function () {
    if (this.checked) { showElevationProfile(); } else { hideElevationProfile(); }
});
// ==========================================
// ELEVATION PROFILE BAR
// ==========================================
let elevationProfileData = null; // [{dist, ele, lat, lon}, ...]
let elevationProfileMinimized = true;
let elevationProfileMarker = null;
let isElevationCursorActive = false; // true while scrubbing/hovering the elevation profile
let elevationProfileRedrawFrame = null;
let elevationViewStart = null;
let elevationViewEnd = null;

function scheduleElevationProfileRedraw() {
    if (elevationProfileRedrawFrame !== null) {
        cancelAnimationFrame(elevationProfileRedrawFrame);
        elevationProfileRedrawFrame = null;
    }

    elevationProfileRedrawFrame = requestAnimationFrame(() => {
        elevationProfileRedrawFrame = requestAnimationFrame(() => {
            elevationProfileRedrawFrame = null;
            if (elevationProfileData && !elevationProfileMinimized) {
                drawElevationProfile();
            }
        });
    });
}

function buildElevationProfileData(allSegments) {
    const points = [];
    let cumDist = 0;
    for (const seg of allSegments) {
        for (let i = 0; i < seg.length; i++) {
            if (i > 0) {
                cumDist += haversineDistance(seg[i - 1].lat, seg[i - 1].lon, seg[i].lat, seg[i].lon);
            }
            points.push({
                dist: cumDist,
                ele: seg[i].ele !== null ? seg[i].ele : 0,
                lat: seg[i].lat,
                lon: seg[i].lon
            });
        }
    }
    return points;
}

// How much of the viewport bottom is covered by docked chrome — the elevation profile plus,
// on mobile, the route info panel stacked above it.
//
// Measuring the dock rather than summing its children is what keeps this honest as panels
// come and go: a hidden panel, a collapsed one mid-transition, and (on desktop) the route
// panel lifted out of the flex flow by position:fixed all report correctly with no special
// case. The dock's own height is 0 when everything inside it is display:none.
function getBottomDockHeight() {
    const dock = document.getElementById('bottom-dock');
    if (!dock) return 0;
    return dock.getBoundingClientRect().height;
}

function adjustMapControlsForElevation() {
    const h = getBottomDockHeight();
    // #controls and #bottom-dock share z-index 2000 and the dock is later in the DOM, so a
    // long control panel would otherwise scroll under it and become unreachable. Its CSS
    // caps max-height against this.
    document.documentElement.style.setProperty('--bottom-dock-h', Math.ceil(h) + 'px');
    const maplibreBottomRight = document.querySelector('.maplibregl-ctrl-bottom-right');
    const maplibreBottomLeft = document.querySelector('.maplibregl-ctrl-bottom-left');

    if (maplibreBottomRight) {
        maplibreBottomRight.style.bottom = h > 0
            ? `calc(${Math.ceil(h)}px + env(safe-area-inset-bottom, 0px))`
            : '';
    }
    if (maplibreBottomLeft) {
        maplibreBottomLeft.style.bottom = h > 0
            ? `calc(${Math.ceil(h)}px + env(safe-area-inset-bottom, 0px))`
            : '';
    }
    // Keep the on-map slider stack (which replaces the bottom-left attribution)
    // above the elevation profile bar, and above the GPS + nav groups when those
    // are relocated into the bottom-left corner (mobile + route legend). The
    // corner is measured live so the offset tracks its real contents (e.g. the
    // compass hides while north-up); display:none children contribute nothing.
    const mapSliderStack = document.getElementById('map-slider-stack');
    if (mapSliderStack) {
        const relocated = maplibreBottomLeft && maplibreBottomLeft.querySelector('.gps-control');
        const controlsH = relocated ? Math.ceil(maplibreBottomLeft.getBoundingClientRect().height) : 0;
        mapSliderStack.style.bottom = (h > 0 || controlsH > 0)
            ? `calc(${(h > 0 ? Math.ceil(h) + 10 : 10) + controlsH}px + env(safe-area-inset-bottom, 0px))`
            : '';
    }
}

function showElevationProfile() {
    if (!getGpxShowElevProfile()) { hideElevationProfile(); return; }
    if (!gpxTrackData || !gpxTrackData.segments || gpxTrackData.segments.length === 0) return;
    elevationProfileData = buildElevationProfileData(gpxTrackData.segments);
    if (elevationProfileData.length < 2) return;

    elevationViewStart = 0;
    elevationViewEnd = elevationProfileData[elevationProfileData.length - 1].dist;

    const container = document.getElementById('elevation-profile');
    container.style.display = '';
    if (elevationProfileMinimized) {
        container.classList.add('minimized');
    } else {
        container.classList.remove('minimized');
    }
    drawElevationProfile();
    scheduleElevationProfileRedraw();
    updateElevationProfileInfo(null);
    adjustMapControlsForElevation();
}

function hideElevationProfile() {
    if (elevationProfileRedrawFrame !== null) {
        cancelAnimationFrame(elevationProfileRedrawFrame);
        elevationProfileRedrawFrame = null;
    }
    const container = document.getElementById('elevation-profile');
    if (container) container.style.display = 'none';
    elevationProfileData = null;
    elevationViewStart = null;
    elevationViewEnd = null;
    removeElevationMarker();
    adjustMapControlsForElevation();
}

function toggleElevationProfile() {
    const container = document.getElementById('elevation-profile');
    elevationProfileMinimized = !elevationProfileMinimized;
    if (elevationProfileMinimized) {
        container.classList.add('minimized');
    } else {
        container.classList.remove('minimized');
        drawElevationProfile();
        scheduleElevationProfileRedraw();
    }
    adjustMapControlsForElevation();
}

function drawElevationProfile() {
    const canvas = document.getElementById('elevation-canvas');
    if (!canvas || !elevationProfileData || elevationProfileData.length < 2) return;

    const body = document.getElementById('elevation-profile-body');
    if (!body) return;
    const rect = body.getBoundingClientRect();
    if (rect.width <= 80 || rect.height <= 40) {
        if (!elevationProfileMinimized) {
            scheduleElevationProfileRedraw();
        }
        return;
    }
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.round(rect.width * dpr));
    canvas.height = Math.max(1, Math.round(rect.height * dpr));
    const ctx = canvas.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const W = rect.width;
    const H = rect.height;
    const PAD_LEFT = 48;
    const PAD_RIGHT = 12;
    const PAD_TOP = 12;
    const PAD_BOTTOM = 24;
    const plotW = W - PAD_LEFT - PAD_RIGHT;
    const plotH = H - PAD_TOP - PAD_BOTTOM;

    const data = elevationProfileData;
    const totalDist = data[data.length - 1].dist;

    // Determine view bounds
    const vStart = elevationViewStart !== null ? elevationViewStart : 0;
    const vEnd = elevationViewEnd !== null ? elevationViewEnd : totalDist;
    const vRange = vEnd - vStart || 1;

    let minEle = Infinity, maxEle = -Infinity;
    for (const p of data) {
        if (p.dist >= vStart && p.dist <= vEnd) {
            if (p.ele < minEle) minEle = p.ele;
            if (p.ele > maxEle) maxEle = p.ele;
        }
    }
    // Fallback if no points inside range
    if (minEle === Infinity) { minEle = 0; maxEle = 100; }

    // Add some padding to elevation range
    const eleRange = maxEle - minEle || 1;
    const elePad = eleRange * 0.1;
    const eleMin = minEle - elePad;
    const eleMax = maxEle + elePad;

    const xScale = (d) => PAD_LEFT + ((d - vStart) / vRange) * plotW;
    const yScale = (e) => PAD_TOP + plotH - ((e - eleMin) / (eleMax - eleMin)) * plotH;

    // Grid lines - Y axis (elevation)
    ctx.strokeStyle = '#e0e0e0';
    ctx.lineWidth = 0.5;
    ctx.fillStyle = '#888';
    ctx.font = '10px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    const niceEleSteps = [5, 10, 20, 25, 50, 100, 200, 500, 1000, 2000];
    let eleStep = niceEleSteps[niceEleSteps.length - 1];
    const targetYLabels = Math.max(3, Math.floor(plotH / 35));
    for (const s of niceEleSteps) {
        if ((eleMax - eleMin) / s <= targetYLabels + 1) { eleStep = s; break; }
    }
    const eleStart = Math.ceil(eleMin / eleStep) * eleStep;
    for (let e = eleStart; e <= eleMax; e += eleStep) {
        const y = yScale(e);
        if (y < PAD_TOP || y > PAD_TOP + plotH) continue;
        ctx.beginPath();
        ctx.moveTo(PAD_LEFT, y);
        ctx.lineTo(W - PAD_RIGHT, y);
        ctx.stroke();
        ctx.fillText(formatElevation(e), PAD_LEFT - 4, y);
    }

    // Grid lines - X axis (distance)
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    const unit = getDistanceUnit();
    const unitMeters = unit === 'mi' ? 1609.344 : 1000;
    const unitLabel = unit === 'mi' ? 'mi' : 'km';
    const viewUnitsStart = vStart / unitMeters;
    const viewUnitsEnd = vEnd / unitMeters;
    const viewUnitsTotal = vRange / unitMeters;
    const niceDistSteps = [0.01, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500, 1000];
    const targetXLabels = Math.max(3, Math.floor(plotW / 70));
    let distStep = niceDistSteps[niceDistSteps.length - 1];
    for (const s of niceDistSteps) {
        if (viewUnitsTotal / s <= targetXLabels + 1) { distStep = s; break; }
    }
    const distStart = Math.ceil(viewUnitsStart / distStep) * distStep;
    for (let d = distStart; d <= viewUnitsEnd; d += distStep) {
        const x = xScale(d * unitMeters);
        if (x < PAD_LEFT || x > PAD_LEFT + plotW) continue;
        ctx.beginPath();
        ctx.moveTo(x, PAD_TOP);
        ctx.lineTo(x, PAD_TOP + plotH);
        ctx.stroke();

        let label;
        if (distStep >= 1) label = Math.round(d);
        else if (distStep >= 0.1) label = d.toFixed(1);
        else label = d.toFixed(2);

        ctx.fillText(label + ' ' + unitLabel, x, PAD_TOP + plotH + 4);
    }

    // Clip the plotting area
    ctx.save();
    ctx.beginPath();
    ctx.rect(PAD_LEFT, PAD_TOP, plotW, plotH);
    ctx.clip();

    // Filled area
    ctx.beginPath();
    ctx.moveTo(xScale(data[0].dist), yScale(data[0].ele));
    for (let i = 1; i < data.length; i++) {
        ctx.lineTo(xScale(data[i].dist), yScale(data[i].ele));
    }
    ctx.lineTo(xScale(data[data.length - 1].dist), yScale(eleMin));
    ctx.lineTo(xScale(data[0].dist), yScale(eleMin));
    ctx.closePath();

    const gradient = ctx.createLinearGradient(0, PAD_TOP, 0, PAD_TOP + plotH);
    gradient.addColorStop(0, 'rgba(100, 181, 246, 0.7)');
    gradient.addColorStop(1, 'rgba(100, 181, 246, 0.15)');
    ctx.fillStyle = gradient;
    ctx.fill();

    // Stroke line on top
    ctx.beginPath();
    ctx.moveTo(xScale(data[0].dist), yScale(data[0].ele));
    for (let i = 1; i < data.length; i++) {
        ctx.lineTo(xScale(data[i].dist), yScale(data[i].ele));
    }
    ctx.strokeStyle = '#42a5f5';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.restore(); // Remove clipping so border draws properly

    // Border around plot
    ctx.strokeStyle = '#ccc';
    ctx.lineWidth = 1;
    ctx.strokeRect(PAD_LEFT, PAD_TOP, plotW, plotH);

    // Store drawing params for hit-testing
    canvas._epParams = { PAD_LEFT, PAD_RIGHT, PAD_TOP, PAD_BOTTOM, plotW, plotH, totalDist, eleMin, eleMax, W, H, vStart, vEnd, vRange };
}

function getElevationPointAtX(canvasX) {
    const canvas = document.getElementById('elevation-canvas');
    if (!canvas || !canvas._epParams || !elevationProfileData) return null;
    const p = canvas._epParams;
    const frac = (canvasX - p.PAD_LEFT) / p.plotW;
    if (frac < 0 || frac > 1) return null;
    const targetDist = p.vStart + frac * p.vRange;

    // Binary search for closest point
    const data = elevationProfileData;
    let lo = 0, hi = data.length - 1;
    while (lo < hi - 1) {
        const mid = (lo + hi) >> 1;
        if (data[mid].dist <= targetDist) lo = mid;
        else hi = mid;
    }
    // Interpolate between lo and hi
    const dRange = data[hi].dist - data[lo].dist;
    if (dRange === 0) return data[lo];
    const t = (targetDist - data[lo].dist) / dRange;
    return {
        dist: targetDist,
        ele: data[lo].ele + t * (data[hi].ele - data[lo].ele),
        lat: data[lo].lat + t * (data[hi].lat - data[lo].lat),
        lon: data[lo].lon + t * (data[hi].lon - data[lo].lon)
    };
}

function updateElevationProfileInfo(point) {
    const infoEl = document.getElementById('elevation-profile-info');
    if (!infoEl) return;
    if (!point) {
        infoEl.textContent = '';
        return;
    }
    const unit = getDistanceUnit();
    const unitMeters = unit === 'mi' ? 1609.344 : 1000;
    const unitLabel = unit === 'mi' ? 'mi' : 'km';
    const distVal = point.dist / unitMeters;
    const distStr = distVal >= 1 ? distVal.toFixed(1) + ' ' + unitLabel : formatDistance(point.dist);
    infoEl.textContent = distStr + '  •  ' + formatElevation(point.ele);
}

function drawElevationCursor(canvasX, point) {
    const canvas = document.getElementById('elevation-canvas');
    if (!canvas || !canvas._epParams) return;

    // Redraw base profile then overlay cursor
    drawElevationProfile();
    if (!point) return;

    const p = canvas._epParams;
    const dpr = window.devicePixelRatio || 1;
    const ctx = canvas.getContext('2d');
    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const x = canvasX;
    const yScale = (e) => p.PAD_TOP + p.plotH - ((e - p.eleMin) / (p.eleMax - p.eleMin)) * p.plotH;
    const y = yScale(point.ele);

    // Vertical line
    ctx.beginPath();
    ctx.moveTo(x, p.PAD_TOP);
    ctx.lineTo(x, p.PAD_TOP + p.plotH);
    ctx.strokeStyle = 'rgba(0,0,0,0.4)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 3]);
    ctx.stroke();
    ctx.setLineDash([]);

    // Dot
    ctx.beginPath();
    ctx.arc(x, y, 4, 0, Math.PI * 2);
    ctx.fillStyle = '#1565C0';
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();
}

function showElevationMarker(lat, lon) {
    if (!elevationProfileMarker) {
        const el = document.createElement('div');
        el.className = 'elevation-marker';
        el.style.width = '14px';
        el.style.height = '14px';
        el.style.background = '#42a5f5';
        el.style.border = '2px solid #1565C0';
        el.style.borderRadius = '50%';
        elevationProfileMarker = new maplibregl.Marker({ element: el })
            .setLngLat([lon, lat])
            .addTo(map._map);
    } else {
        elevationProfileMarker.setLngLat([lon, lat]);
    }
    if (!isElevationCursorActive) {
        isElevationCursorActive = true;
        syncCrosshairVisibility();
    }
}

function removeElevationMarker() {
    if (elevationProfileMarker) {
        elevationProfileMarker.remove();
        elevationProfileMarker = null;
    }
    if (isElevationCursorActive) {
        isElevationCursorActive = false;
        syncCrosshairVisibility();
    }
}

// Elevation canvas interaction handlers
(function () {
    const canvas = document.getElementById('elevation-canvas');
    if (!canvas) return;
    let dragging = false;
    let cursorFrac = null; // 0..1 fraction along track for keyboard nav

    function distToCanvasX(frac) {
        const p = canvas._epParams;
        if (!p) return 0;
        return p.PAD_LEFT + frac * p.plotW;
    }

    function showAtFrac(frac, syncMap) {
        if (!elevationProfileData || !canvas._epParams) return;
        frac = Math.max(0, Math.min(1, frac));
        cursorFrac = frac;
        const canvasX = distToCanvasX(frac);
        const point = getElevationPointAtX(canvasX);
        if (point) {
            drawElevationCursor(canvasX, point);
            updateElevationProfileInfo(point);
            showElevationMarker(point.lat, point.lon);
            if (syncMap && getElevMapSync()) {
                map._map.panTo([point.lon, point.lat], { animate: false });
            }
        }
    }

    function handlePointer(e, syncMap) {
        const rect = canvas.getBoundingClientRect();
        let clientX;
        if (e.touches && e.touches.length > 0) {
            clientX = e.touches[0].clientX;
        } else {
            clientX = e.clientX;
        }
        const canvasX = clientX - rect.left;
        const p = canvas._epParams;
        if (p) cursorFrac = Math.max(0, Math.min(1, (canvasX - p.PAD_LEFT) / p.plotW));
        const point = getElevationPointAtX(canvasX);
        if (point) {
            drawElevationCursor(canvasX, point);
            updateElevationProfileInfo(point);
            showElevationMarker(point.lat, point.lon);
            if (syncMap && getElevMapSync()) {
                map._map.panTo([point.lon, point.lat], { animate: false });
            }
        }
    }

    canvas.addEventListener('mousedown', (e) => { dragging = true; handlePointer(e, true); });
    canvas.addEventListener('mousemove', (e) => { if (dragging) handlePointer(e, true); });
    window.addEventListener('mouseup', () => {
        if (dragging) {
            dragging = false;
            removeElevationMarker();
            drawElevationProfile();
            updateElevationProfileInfo(null);
        }
    });
    canvas.addEventListener('mouseleave', () => {
        if (!dragging) {
            removeElevationMarker();
            drawElevationProfile();
            updateElevationProfileInfo(null);
        }
    });

    // Touch support
    canvas.addEventListener('touchstart', (e) => { e.preventDefault(); dragging = true; handlePointer(e, true); }, { passive: false });
    canvas.addEventListener('touchmove', (e) => { e.preventDefault(); if (dragging) handlePointer(e, true); }, { passive: false });
    canvas.addEventListener('touchend', () => {
        dragging = false;
        removeElevationMarker();
        drawElevationProfile();
        updateElevationProfileInfo(null);
    });

    // Also support hover (no click required on desktop) for better UX
    canvas.addEventListener('mousemove', (e) => {
        if (!dragging) {
            const rect = canvas.getBoundingClientRect();
            const canvasX = e.clientX - rect.left;
            const point = getElevationPointAtX(canvasX);
            if (point) {
                drawElevationCursor(canvasX, point);
                updateElevationProfileInfo(point);
                showElevationMarker(point.lat, point.lon);
            }
        }
    });

    // Tap overlay header to toggle on mobile
    const overlay = document.querySelector('.elevation-profile-overlay');
    if (overlay) {
        overlay.addEventListener('click', (e) => {
            if (window.innerWidth <= 600 && e.target === overlay) {
                toggleElevationProfile();
            }
        });
    }

    // Keyboard arrow key navigation
    document.addEventListener('keydown', (e) => {
        if (!elevationProfileData || elevationProfileMinimized) return;
        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
        const container = document.getElementById('elevation-profile');
        if (!container || container.style.display === 'none') return;

        e.preventDefault();
        const step = e.shiftKey ? 0.01 : 0.002; // Shift for bigger steps
        if (cursorFrac === null) cursorFrac = 0;
        if (e.key === 'ArrowRight') cursorFrac = Math.min(1, cursorFrac + step);
        else cursorFrac = Math.max(0, cursorFrac - step);
        showAtFrac(cursorFrac, true);
    });

    document.addEventListener('keyup', (e) => {
        if (e.key === 'Escape' && cursorFrac !== null) {
            cursorFrac = null;
            removeElevationMarker();
            drawElevationProfile();
            updateElevationProfileInfo(null);
        }
    });

    // Redraw on resize
    window.addEventListener('resize', () => {
        if (elevationProfileData && !elevationProfileMinimized) {
            drawElevationProfile();
        }
        // Crossing the 600px breakpoint (or rotating the device) moves the
        // GPS/nav groups between corners while the route legend is on.
        updateZoomControlVisibility();
        // The header has less room to fit into, and crossing the breakpoint adds or removes
        // the length from it — either way the fitted size is stale.
        _fitRouteInfoHeadline();
        adjustMapControlsForElevation();
    });

    canvas.addEventListener('wheel', (e) => {
        if (!elevationProfileData || elevationProfileMinimized) return;
        const p = canvas._epParams;
        if (!p) return;

        e.preventDefault();

        // Canvas coordinates
        const rect = canvas.getBoundingClientRect();
        const canvasX = e.clientX - rect.left;

        // Find cursor fraction over the plot area
        let frac = (canvasX - p.PAD_LEFT) / p.plotW;
        frac = Math.max(0, Math.min(1, frac)); // Bound the pivot

        const zoomPivotDist = p.vStart + frac * p.vRange;

        const zoomFactor = e.deltaY < 0 ? 0.8 : 1.25;
        let newRange = p.vRange * zoomFactor;

        // Prevent zooming too far in/out
        const minDistanceSpan = p.totalDist * 0.01; // Max 100x zoom
        if (newRange < minDistanceSpan) newRange = minDistanceSpan;
        if (newRange > p.totalDist) newRange = p.totalDist;

        let newStart = zoomPivotDist - (frac * newRange);
        let newEnd = newStart + newRange;

        // Clamp to file bounds
        if (newStart < 0) {
            newStart = 0;
            newEnd = newRange;
        }
        if (newEnd > p.totalDist) {
            newEnd = p.totalDist;
            newStart = p.totalDist - newRange;
            if (newStart < 0) newStart = 0;
        }

        elevationViewStart = newStart;
        elevationViewEnd = newEnd;

        drawElevationProfile();

        // Re-trigger hover effect at current mouse position after redrawing
        const point = getElevationPointAtX(canvasX);
        if (point) {
            drawElevationCursor(canvasX, point);
            updateElevationProfileInfo(point);
            showElevationMarker(point.lat, point.lon);
        }
    }, { passive: false });

    // Expand on click if minimized
    const container = document.getElementById('elevation-profile');
    if (container) {
        container.addEventListener('click', (e) => {
            if (elevationProfileMinimized && !e.target.closest('.elevation-profile-toggle') && !e.target.closest('.elevation-profile-overlay')) {
                toggleElevationProfile();
            }
        });
    }

    // The whole route-panel header is a toggle target, not just its button — it is the only
    // affordance left once the panel is collapsed to a strip. The button is excluded because
    // its own onclick already fired and the click bubbles up through here.
    const routeInfoHeader = document.getElementById('route-info-header');
    if (routeInfoHeader) {
        routeInfoHeader.addEventListener('click', (e) => {
            if (e.target.closest('.route-info-toggle')) return;
            toggleRouteInfoPanel();
        });
    }

    // Observes the whole dock, not just the elevation body: both panels animate their
    // collapse over 0.3s, and the toggles call adjustMapControlsForElevation() synchronously
    // — before the transition has moved anything. Without this the map controls would settle
    // one animation behind whichever panel was last toggled.
    const bottomDock = document.getElementById('bottom-dock');
    if (bottomDock && 'ResizeObserver' in window) {
        let lastDockWidth = 0;
        let lastDockHeight = 0;
        const resizeObserver = new ResizeObserver((entries) => {
            const entry = entries[0];
            if (!entry) return;

            const width = entry.contentRect.width;
            const height = entry.contentRect.height;
            if (Math.abs(width - lastDockWidth) < 0.5 && Math.abs(height - lastDockHeight) < 0.5) {
                return;
            }

            lastDockWidth = width;
            lastDockHeight = height;
            adjustMapControlsForElevation();
            if (elevationProfileData && !elevationProfileMinimized) {
                scheduleElevationProfileRedraw();
            }
        });
        resizeObserver.observe(bottomDock);
    }
})();

window.copyCoords = function (lat, lng, btnElement) {
    navigator.clipboard.writeText(`${lat}, ${lng}`).then(() => {
        const originalText = btnElement.innerText;
        btnElement.innerText = "✅";
        setTimeout(() => btnElement.innerText = originalText, 1500);
    });
};

function getSearchCenter() { return isLocked && lockedCenterCoords ? lockedCenterCoords : map.getCenter(); }

function toRgba(hexColor, opacity) {
    const normalized = hexColor.replace('#', '');
    const value = normalized.length === 3
        ? normalized.split('').map((char) => char + char).join('')
        : normalized;
    const red = parseInt(value.slice(0, 2), 16);
    const green = parseInt(value.slice(2, 4), 16);
    const blue = parseInt(value.slice(4, 6), 16);
    return `rgba(${red}, ${green}, ${blue}, ${opacity})`;
}

function ensureSearchOverlay() {
    const mapContainer = map.getContainer();
    const canvasContainer = mapContainer.querySelector('.maplibregl-canvas-container');
    const canvas = canvasContainer ? canvasContainer.querySelector('.maplibregl-canvas, canvas') : null;
    const overlayParent = canvasContainer || mapContainer;
    let overlay = document.getElementById('search-overlay');
    const placeOverlayAboveMapBelowMarkers = () => {
        if (!canvasContainer || !canvas) {
            if (overlay.parentElement !== overlayParent) {
                overlayParent.appendChild(overlay);
            }
            return;
        }
        const nextSibling = canvas.nextSibling;
        if (nextSibling === overlay) return;
        overlayParent.insertBefore(overlay, nextSibling);
    };
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'search-overlay';
        overlay.style.position = 'absolute';
        overlay.style.inset = '0';
        overlay.style.pointerEvents = 'none';

        const circleEl = document.createElement('div');
        circleEl.style.position = 'absolute';
        circleEl.style.transform = 'translate(-50%, -50%)';
        circleEl.style.borderRadius = '50%';
        circleEl.style.boxSizing = 'border-box';
        circleEl.style.display = 'none';

        const markerEl = document.createElement('div');
        markerEl.style.position = 'absolute';
        markerEl.style.transform = 'translate(-50%, -50%)';
        markerEl.style.borderRadius = '50%';
        markerEl.style.boxSizing = 'border-box';
        markerEl.style.width = '8px';
        markerEl.style.height = '8px';
        markerEl.style.background = '#ffffff';
        markerEl.style.display = 'none';

        overlay.appendChild(circleEl);
        overlay.appendChild(markerEl);
        overlay._circle = circleEl;
        overlay._marker = markerEl;
        placeOverlayAboveMapBelowMarkers();
    } else {
        if (overlay.parentElement !== overlayParent) {
            overlayParent.appendChild(overlay);
        }
        placeOverlayAboveMapBelowMarkers();
    }
    return overlay;
}

function updateSearchOverlay(searchCenter, radiusM, markerColor, showCircle, fillOpacity) {
    const overlay = ensureSearchOverlay();
    const point = map._map.project([searchCenter.lng, searchCenter.lat]);
    const edgeLatLng = moveLatLng(searchCenter, radiusM, 0);
    const edgePoint = map._map.project([edgeLatLng.lng, edgeLatLng.lat]);
    const radiusPx = Math.hypot(edgePoint.x - point.x, edgePoint.y - point.y);

    const markerEl = overlay._marker;
    // The center crosshair already marks the (unlocked) map center, so only show
    // the center dot when locked — where it pins the locked point as the map pans.
    if (isLocked) {
        markerEl.style.display = 'block';
        markerEl.style.left = `${point.x}px`;
        markerEl.style.top = `${point.y}px`;
        markerEl.style.border = `2px solid ${markerColor}`;
    } else {
        markerEl.style.display = 'none';
    }

    const circleEl = overlay._circle;
    if (showCircle) {
        const sizePx = Math.max(radiusPx * 2, 2);
        circleEl.style.display = 'block';
        circleEl.style.left = `${point.x}px`;
        circleEl.style.top = `${point.y}px`;
        circleEl.style.width = `${sizePx}px`;
        circleEl.style.height = `${sizePx}px`;
        circleEl.style.border = '1px solid #007bff';
        circleEl.style.background = toRgba('#007bff', fillOpacity);
    } else {
        circleEl.style.display = 'none';
    }

    searchCircle = circleEl;
    centerMarker = markerEl;
}

window.adjustNumber = function (inputId, amount) {
    const input = document.getElementById(inputId);
    if (!input) return;
    let currentVal = parseFloat(input.value) || 0;
    let min = input.hasAttribute('min') ? parseFloat(input.getAttribute('min')) : -Infinity;
    let max = input.hasAttribute('max') ? parseFloat(input.getAttribute('max')) : Infinity;

    let newVal = currentVal + amount;
    // Fix floating point math issues
    newVal = Math.round(newVal * 10) / 10;

    if (newVal >= min && newVal <= max) {
        input.value = newVal;
        // Trigger event so the UI updates (especially for the search radius)
        input.dispatchEvent(new Event('input'));
    }
};

// Show or hide one readout wrapper and, when shown, write its value into the child span the
// markup provides. `value` may be a function so an expensive computation is skipped entirely
// while that readout is switched off — updateUI() runs on every frame of a pan.
function setReadout(wrapper, valueId, shown, value) {
    if (!wrapper) return;
    if (!shown) {
        wrapper.style.display = 'none';
        return;
    }
    const el = document.getElementById(valueId);
    if (el) el.textContent = typeof value === 'function' ? value() : value;
    wrapper.style.display = '';
}

function updateUI() {
    if (!zoomLabel) return;
    const t = translations[currentLang];
    const zoom = map.getZoom();
    // Each readout is a wrapper carrying the id and the show/hide, with its label written once
    // by the translation pass and only the value rewritten here — so a pan does not retranslate
    // the panel, and the zoom label is no longer the one hardcoded English string in the set.
    const displayZoom = Number.isInteger(zoom) ? zoom.toString() : zoom.toFixed(1);
    setReadout(zoomLabel, 'zoom-value', isZoomShown(), displayZoom);

    setReadout(
        document.getElementById('scale-level'), 'scale-value', isScaleShown(),
        () => formatScale(niceScaleDenominator(computeScaleDenominator())));

    setReadout(
        document.getElementById('center-gps-dist'), 'center-gps-value',
        !!lastGpsPosition && isCenterGpsShown(),
        () => {
            const c = map.getCenter();
            return formatDistance(haversineDistance(c.lat, c.lng, lastGpsPosition.lat, lastGpsPosition.lng));
        });

    const coordsLabel = document.getElementById('coords-level');
    if (coordsLabel) {
        if (isCoordsShown()) {
            const c = map.getCenter();
            // No "Coords:" prefix any more — the pair identifies itself, and the label the
            // footer used to carry survives only as the tooltip.
            coordsLabel.textContent = c.lat.toFixed(5) + ', ' + c.lng.toFixed(5);
            coordsLabel.title = t.coords_copy_hint || 'Tap to copy';
            coordsLabel.style.display = '';
        } else {
            coordsLabel.style.display = 'none';
        }
    }

    // A hidden readout is still a child, so :only-child cannot spot the lone-item cases in
    // CSS — count them here instead. The footer line goes when both its items are off, and
    // whatever is left alone centres rather than sitting against an edge as a fragment. The
    // tile row always has the elevation hero, so it never hides and the box never disappears.
    const shownCount = (el) => Array.from(el.children)
        .filter((child) => child.style.display !== 'none').length;

    const tiles = document.querySelector('.data-tiles');
    if (tiles) tiles.classList.toggle('solo', shownCount(tiles) === 1);

    const foot = document.getElementById('data-box-foot');
    if (foot) {
        const shown = shownCount(foot);
        foot.style.display = shown ? '' : 'none';
        foot.classList.toggle('solo', shown === 1);
    }

    const searchCenter = getSearchCenter();
    const markerColor = isLocked ? '#e67e22' : '#007bff';

    // Show circle when checkbox is checked OR when a slope map is active
    const radiusM = getRadiusMeters();
    const slopeMapHasRadiusArea = slopeMapCenter !== null && slopeMapUsesRadius;
    // Circle is completely outside the generated slope area when there is no overlap at all
    const completelyOutsideSlopeArea = slopeMapHasRadiusArea &&
        searchCenter.distanceTo(slopeMapCenter) > slopeMapRadius + radiusM;
    const showCircle = circleCheckbox.checked || slopeMapHasRadiusArea;
    let fillOpacity = 0;
    if (showCircle) {
        // No fill when slope map is active and circle overlaps generated area; fill 0.1 when fully outside
    }
    fillOpacity = isLocked ? 0 : (slopeMapHasRadiusArea ? (completelyOutsideSlopeArea ? 0.1 : 0) : 0.1);
    updateSearchOverlay(searchCenter, radiusM, markerColor, showCircle, fillOpacity);
}

// LRU cache of loaded elevation tiles (HTMLImageElement) keyed by "z/x/y". Panning
// around within one tile would otherwise refetch it on every move/zoom event.
const ELEVATION_TILE_CACHE_MAX = 64;
const elevationTileCache = new Map(); // key -> Promise<HTMLImageElement>

function loadElevationTile(z, x, y) {
    const key = z + '/' + x + '/' + y;
    const cached = elevationTileCache.get(key);
    if (cached) {
        // Refresh recency so this tile is evicted last.
        elevationTileCache.delete(key);
        elevationTileCache.set(key, cached);
        return cached;
    }
    const url = DATA_TILE_URL.replace('{z}', z).replace('{x}', x).replace('{y}', y);
    const promise = new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = "Anonymous";
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('elevation tile load failed'));
        img.src = url;
    });
    // Don't keep a failed load cached, so a transient error can be retried later.
    promise.catch(() => { elevationTileCache.delete(key); });
    elevationTileCache.set(key, promise);
    while (elevationTileCache.size > ELEVATION_TILE_CACHE_MAX) {
        elevationTileCache.delete(elevationTileCache.keys().next().value);
    }
    return promise;
}

// Decode a Terrarium-encoded RGB triplet to elevation in meters.
function terrariumToMeters(r, g, b) {
    return (r * 256 + g + b / 256) - 32768;
}

// Decode the elevation (meters) of a single pixel within a loaded Terrarium tile.
// Returns null for no-data (transparent) pixels.
function decodeElevationPixel(img, pixelX, pixelY) {
    spCtx.imageSmoothingEnabled = false;
    spCtx.clearRect(0, 0, 1, 1);
    spCtx.drawImage(img, pixelX, pixelY, 1, 1, 0, 0, 1, 1);
    const pData = spCtx.getImageData(0, 0, 1, 1).data;
    if (pData[3] === 0) return null;
    return terrariumToMeters(pData[0], pData[1], pData[2]);
}

// Sample the terrain elevation (meters) at an arbitrary coordinate from a single
// Terrarium tile pixel. Resolves null when there is no data / the tile fails to
// load. Used when saving a POI.
function getElevationAtLatLng(lat, lng) {
    let zoom, tileX, tileY, pixelX, pixelY;
    try {
        zoom = Math.min(Math.floor(map.getZoom()), ELEVATION_TILE_MAX_ZOOM);
        const point = map.project(L.latLng(lat, lng), zoom);
        tileX = Math.floor(point.x / 256);
        tileY = Math.floor(point.y / 256);
        pixelX = Math.floor((point.x - tileX * 256) * 2);
        pixelY = Math.floor((point.y - tileY * 256) * 2);
    } catch (e) { return Promise.resolve(null); }
    return loadElevationTile(zoom, tileX, tileY).then((img) => {
        try {
            const h = decodeElevationPixel(img, pixelX, pixelY);
            return h === null ? null : Math.round(h);
        } catch (e) { return null; }
    }).catch(() => null);
}

// Shared enable/disable for the three analysis buttons (Scan / Climbs / Slope map).
function setAnalysisButtonsDisabled(disabled) {
    if (scanBtn) scanBtn.disabled = disabled;
    if (climbBtn) climbBtn.disabled = disabled;
    if (slopeBtn) slopeBtn.disabled = disabled;
}

// True while a scan/climb/slope analysis owns the shared analysis canvas. Blocks a
// second analysis from starting mid-run and stops updateCenterElevation() from
// re-enabling the buttons while one is still working.
let analysisInProgress = false;

// Monotonic id so only the newest in-flight center-elevation lookup writes the UI;
// a slow tile load from an older map position must not clobber a newer result.
let centerElevationRunId = 0;

async function updateCenterElevation() {
    if (!centerHeightDisplay) return;
    const runId = ++centerElevationRunId;
    const center = map.getCenter();
    setAnalysisButtonsDisabled(true);
    centerHeightDisplay.textContent = "...";

    const zoom = Math.min(Math.floor(map.getZoom()), ELEVATION_TILE_MAX_ZOOM);
    const point = map.project(center, zoom);
    const tileX = Math.floor(point.x / 256);
    const tileY = Math.floor(point.y / 256);

    // offset within the 256-unit tile grid, scaled to the 512px tile
    const pixelX = Math.floor((point.x - tileX * 256) * 2);
    const pixelY = Math.floor((point.y - tileY * 256) * 2);

    const showNoData = () => {
        centerHeightDisplay.textContent = "N/A";
    };

    try {
        const img = await loadElevationTile(zoom, tileX, tileY);
        if (runId !== centerElevationRunId) return; // superseded by a newer lookup
        const h = decodeElevationPixel(img, pixelX, pixelY);
        if (h === null) {
            showNoData();
        } else {
            centerHeightDisplay.textContent = formatElevation(h);
        }
    } catch (err) {
        if (runId !== centerElevationRunId) return;
        showNoData();
    } finally {
        // A failed tile load must not leave the buttons stuck disabled. Only the
        // newest run may re-enable, and never while an analysis holds the canvas.
        if (runId === centerElevationRunId && !analysisInProgress) {
            setAnalysisButtonsDisabled(false);
        }
    }
}

// Updated function that fetches both elevation and water tiles
async function fetchAnalysisData() {
    const bounds = map.getBounds();
    const zoom = Math.min(Math.floor(map.getZoom()), ELEVATION_TILE_MAX_ZOOM);
    analysisZoom = zoom;
    analysisBounds = bounds;
    const nw = map.project(bounds.getNorthWest(), zoom);
    const se = map.project(bounds.getSouthEast(), zoom);
    const analysisSize = se.subtract(nw);

    canvas.width = Math.max(1, Math.ceil(analysisSize.x));
    canvas.height = Math.max(1, Math.ceil(analysisSize.y));
    waterCanvas.width = canvas.width;
    waterCanvas.height = canvas.height;

    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    waterCtx.imageSmoothingEnabled = false;
    waterCtx.clearRect(0, 0, waterCanvas.width, waterCanvas.height);

    analysisNwOrigin = nw;
    const tileMin = nw.divideBy(256).floor();
    const tileMax = se.divideBy(256).floor();

    const tilesToLoad = [];
    for (let x = tileMin.x; x <= tileMax.x; x++) {
        for (let y = tileMin.y; y <= tileMax.y; y++) {
            tilesToLoad.push({ x, y, z: zoom });
        }
    }

    // Load elevation tiles (and water tiles if enabled)
    const tilePromises = [loadAndDrawTiles(DATA_TILE_URL, ctx, tilesToLoad, nw)];
    if (waterAnalysisEnabled) {
        tilePromises.push(loadAndDrawTiles(WATER_CHECK_URL, waterCtx, tilesToLoad, nw));
    }
    await Promise.all(tilePromises);
}

// Tilted/3D views make map.getBounds() and map.project() return a skewed,
// trapezoidal area, so the analysis scan rectangle would be wrong. Flatten to a
// pitch-0 view (and turn off the Tilt/3D toggles) before any terrain scan, then
// resolve once the camera has settled.
function flattenViewForAnalysis() {
    if (!map) return Promise.resolve();
    const wasTilted = map.getPitch() > 0;
    if (is3dEnabled()) {
        setTerrainEnabled(false); // eases pitch back to 0
    } else if (wasTilted) {
        map.easeTo({ pitch: 0, duration: 300 });
    }
    if (!wasTilted) return Promise.resolve();
    return new Promise((resolve) => {
        const done = () => { map.off('moveend', done); resolve(); };
        map.on('moveend', done);
    });
}

// End-of-analysis cleanup shared by the three analysis entry points: release the
// canvas lock, re-enable the buttons and (on desktop) refresh the center readout.
// Mobile keeps the result/status text, so no updateCenterElevation() there.
function finishAnalysisRun() {
    analysisInProgress = false;
    setAnalysisButtonsDisabled(false);
    if (window.innerWidth > 600) updateCenterElevation();
}

async function analyzeTerrain() {
    const t = translations[currentLang];
    if (analysisInProgress) return;
    analysisInProgress = true;
    clearResults();
    setAnalysisButtonsDisabled(true);
    statusDiv.textContent = t.status_loading;
    try {
        await flattenViewForAnalysis();
        await fetchAnalysisData();
        statusDiv.textContent = t.status_calc;
        requestAnimationFrame(() => {
            try {
                findPeaks();
            } catch (err) {
                console.error(err);
                statusDiv.textContent = t.status_error + err.message;
            } finally {
                finishAnalysisRun();
            }
        });
    } catch (err) {
        console.error(err);
        statusDiv.textContent = t.status_error + err.message;
        finishAnalysisRun();
    }
}

async function findSteepestClimb() {
    const t = translations[currentLang];
    if (analysisInProgress) return;
    analysisInProgress = true;
    clearResults();
    setAnalysisButtonsDisabled(true);
    statusDiv.textContent = t.status_loading;
    try {
        await flattenViewForAnalysis();
        await fetchAnalysisData();
        statusDiv.textContent = t.status_calc;
        requestAnimationFrame(() => {
            try {
                calculateMaxClimb();
            } catch (err) {
                console.error(err);
                statusDiv.textContent = t.status_error + err.message;
            } finally {
                finishAnalysisRun();
            }
        });
    } catch (err) {
        statusDiv.textContent = t.status_error + err.message;
        finishAnalysisRun();
    }
}

window.generateSlopeMap = async function () {
    const t = translations[currentLang];
    if (analysisInProgress) return;
    analysisInProgress = true;
    clearResults();
    setAnalysisButtonsDisabled(true);
    statusDiv.textContent = t.status_loading;
    try {
        await fetchAnalysisData();
        statusDiv.textContent = t.status_calc;
        requestAnimationFrame(() => {
            try {
                _renderSlopeMap();
            } catch (err) {
                console.error(err);
                statusDiv.textContent = t.status_error + err.message;
            } finally {
                finishAnalysisRun();
            }
        });
    } catch (err) {
        statusDiv.textContent = t.status_error + err.message;
        finishAnalysisRun();
    }
};

function _renderSlopeMap() {
    const t = translations[currentLang];
    const w = canvas.width;
    const h = canvas.height;
    const imgData = ctx.getImageData(0, 0, w, h).data;

    const searchCenterLatLng = getSearchCenter();
    const searchRadiusMeters = getRadiusMeters();
    const useRadius = circleCheckbox && circleCheckbox.checked;
    const radiusLookup = useRadius ? buildRadiusLookup(w, h, searchCenterLatLng, searchRadiusMeters) : null;

    // Calculate cellSize (metres per pixel) using Web Mercator resolution formula
    const lat = searchCenterLatLng.lat;
    const metersPerPixelAtZoom = (156543.03392 * Math.cos(lat * Math.PI / 180)) / Math.pow(2, analysisZoom);
    // The 512px Mapterhorn tiles are downsampled onto the analysis canvas at 256px per
    // tile (see loadAndDrawTiles), so one canvas pixel spans one full 256-unit tile pixel.
    const cellSize = metersPerPixelAtZoom;

    // Slope classes
    const slopeClasses = [
        { min: 0,  max: 10,       color: [0xFF, 0xFF, 0xFF] },
        { min: 10, max: 30,       color: [0x24, 0x74, 0x00] },
        { min: 30, max: 35,       color: [0xFF, 0xFF, 0x00] },
        { min: 35, max: 40,       color: [0xFF, 0xA9, 0x00] },
        { min: 40, max: 45,       color: [0xFF, 0x55, 0x00] },
        { min: 45, max: 50,       color: [0xE6, 0x00, 0x00] },
        { min: 50, max: Infinity, color: [0x74, 0x00, 0x00] }
    ];

    const filterToggle = document.getElementById('slope-filter-toggle');
    const useFilter = filterToggle && filterToggle.checked;
    let filterMin = useFilter ? (parseFloat(document.getElementById('slopeFilterMin').value) || 0) : 10;
    let filterMax = useFilter ? (parseFloat(document.getElementById('slopeFilterMax').value) || 100) : 100;
    if (filterMin > filterMax) { const tmp = filterMin; filterMin = filterMax; filterMax = tmp; }

    // Read opacity from slider (10-100 → 0.1-1.0)
    const opacitySlider = document.getElementById('slopeOpacity');
    const overlayOpacity = opacitySlider ? (parseInt(opacitySlider.value) || 60) / 100 : 0.6;

    // Create output canvas
    const outCanvas = document.createElement('canvas');
    outCanvas.width = w;
    outCanvas.height = h;
    const outCtx = outCanvas.getContext('2d');
    const outImgData = outCtx.createImageData(w, h);
    const outData = outImgData.data;

    function getElevation(x, y) {
        const i = (y * w + x) * 4;
        if (imgData[i + 3] < 255) return null;
        return terrariumToMeters(imgData[i], imgData[i + 1], imgData[i + 2]);
    }

    for (let y = 1; y < h - 1; y++) {
        for (let x = 1; x < w - 1; x++) {
            if (radiusLookup && !radiusLookup.contains(x, y)) continue;

            const eLeft = getElevation(x - 1, y);
            const eRight = getElevation(x + 1, y);
            const eUp = getElevation(x, y - 1);
            const eDown = getElevation(x, y + 1);
            if (eLeft === null || eRight === null || eUp === null || eDown === null) continue;

            const dzDx = (eRight - eLeft) / (2 * cellSize);
            const dzDy = (eDown - eUp) / (2 * cellSize);
            const slopeRad = Math.atan(Math.sqrt(dzDx * dzDx + dzDy * dzDy));
            const slopeDeg = slopeRad * (180 / Math.PI);

            // Apply filter: skip pixel if outside filter range
            if (slopeDeg < filterMin || slopeDeg >= filterMax) continue;

            let color = null;
            for (const cls of slopeClasses) {
                if (slopeDeg >= cls.min && slopeDeg < cls.max) {
                    color = cls.color;
                    break;
                }
            }

            if (color) {
                const oi = (y * w + x) * 4;
                outData[oi] = color[0];
                outData[oi + 1] = color[1];
                outData[oi + 2] = color[2];
                outData[oi + 3] = 255;
            }
        }
    }

    outCtx.putImageData(outImgData, 0, 0);
    const dataUrl = outCanvas.toDataURL();

    const bounds = analysisBounds || L.latLngBounds(canvasPointToLatLng(0, 0), canvasPointToLatLng(w, h));

    slopeOverlay = L.imageOverlay(dataUrl, bounds, { opacity: overlayOpacity }).addTo(map);

    slopeLegend = createSlopeLegendControl(getSlopeMapLegendItems());
    slopeLegend.addTo(map);

    // Store generated area so the radius circle can be shown as overlay
    slopeMapCenter = searchCenterLatLng;
    slopeMapRadius = searchRadiusMeters;
    slopeMapUsesRadius = useRadius;
    updateUI();

    statusDiv.textContent = t.status_slope_done;
}

// Generalized tile compositor for the analysis canvases. Elevation (DEM) tiles go
// through the shared loadElevationTile LRU cache, so re-scanning the same area skips
// the refetch/decode; other tiles (the water basemap) load uncached because the cache
// is keyed z/x/y for the DEM URL only. A failed tile stays undrawn: that area keeps
// alpha 0 on the canvas and the analyses already treat it as no-data.
function loadAndDrawTiles(urlTemplate, targetCtx, tiles, nwPixelOrigin) {
    const loadTile = (t) => {
        if (urlTemplate === DATA_TILE_URL) {
            return loadElevationTile(t.z, t.x, t.y);
        }
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.crossOrigin = "Anonymous";
            img.onload = () => resolve(img);
            img.onerror = () => reject(new Error('tile load failed'));
            img.src = urlTemplate.replace('{z}', t.z).replace('{x}', t.x).replace('{y}', t.y);
        });
    };
    const promises = tiles.map((t) => loadTile(t).then((img) => {
        const offset = createPoint(t.x * 256, t.y * 256).subtract(nwPixelOrigin);
        targetCtx.drawImage(img, offset.x, offset.y, 256, 256);
    }).catch(() => { /* missing tile = transparent no-data area */ }));
    return Promise.all(promises);
}

// Convert canvas pixel position to lat/lng using the analysis zoom
function canvasPointToLatLng(x, y) {
    const pixelPoint = analysisNwOrigin.add(L.point(x, y));
    return map.unproject(pixelPoint, analysisZoom);
}

// Precomputed "is canvas pixel (x,y) within the search radius of center?" tests.
// The haversine term a = sin²(Δφ/2) + cosφ₁·cosφ₂·sin²(Δλ/2) splits into a per-row
// part (latitude depends only on y) and a per-column part (longitude depends only
// on x), and d ≤ radius ⇔ a ≤ sin²(radius/2R). So the hot loops in findPeaks,
// calculateMaxClimb and _renderSlopeMap do one multiply-add and a compare per pixel
// instead of a Mercator unproject plus a full haversine — same result, same math.
function buildRadiusLookup(w, h, centerLatLng, radiusMeters) {
    const lat1 = centerLatLng.lat * Math.PI / 180;
    const cosLat1 = Math.cos(lat1);
    const rowA = new Float64Array(h); // sin²(Δφ/2) per row
    const rowF = new Float64Array(h); // cosφ₁·cosφ₂ per row
    for (let y = 0; y < h; y++) {
        const lat2 = canvasPointToLatLng(0, y).lat * Math.PI / 180;
        const sinDLat = Math.sin((lat2 - lat1) / 2);
        rowA[y] = sinDLat * sinDLat;
        rowF[y] = cosLat1 * Math.cos(lat2);
    }
    const colB = new Float64Array(w); // sin²(Δλ/2) per column
    for (let x = 0; x < w; x++) {
        const dLng = (canvasPointToLatLng(x, 0).lng - centerLatLng.lng) * Math.PI / 180;
        const sinDLng = Math.sin(dLng / 2);
        colB[x] = sinDLng * sinDLng;
    }
    const sinHalf = Math.sin(Math.min(radiusMeters / (2 * EARTH_RADIUS_M), Math.PI / 2));
    const aMax = sinHalf * sinHalf;
    return {
        contains(x, y) {
            return rowA[y] + rowF[y] * colB[x] <= aMax;
        },
        // Same value latLng.distanceTo(center) returns (identical haversine); used
        // for the distances shown in result popups.
        distance(x, y) {
            const a = Math.min(1, rowA[y] + rowF[y] * colB[x]);
            return 2 * EARTH_RADIUS_M * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        }
    };
}

function findPeaks() {
    const t = translations[currentLang];
    const w = canvas.width;
    const h = canvas.height;
    const imgData = ctx.getImageData(0, 0, w, h).data;
    // Get data from the water canvas (if enabled)
    const waterData = waterAnalysisEnabled ? waterCtx.getImageData(0, 0, w, h).data : null;

    const searchCenterLatLng = getSearchCenter();
    const maxRadiusMeters = getRadiusMeters();
    const radiusLookup = buildRadiusLookup(w, h, searchCenterLatLng, maxRadiusMeters);
    const validPeaks = [];
    for (let y = 0; y < h; y += 2) {
        for (let x = 0; x < w; x += 2) {
            const i = (y * w + x) * 4;
            if (imgData[i + 3] < 255) continue;

            // CHECK WATER (if enabled)
            if (waterData && isWaterPixel(waterData[i], waterData[i + 1], waterData[i + 2])) {
                continue; // Skip if it is water
            }

            if (!radiusLookup.contains(x, y)) continue;

            const height = terrariumToMeters(imgData[i], imgData[i + 1], imgData[i + 2]);
            if (height > -50) validPeaks.push({ x, y, h: height });
        }
    }
    validPeaks.sort((a, b) => b.h - a.h);
    const finalPoints = [];
    const limit = parseInt(document.getElementById('numPoints').value) || 5;
    const minPixelDist = peakMinPixelDistance;
    for (let p of validPeaks) {
        if (finalPoints.length >= limit) break;
        let tooClose = false;
        for (let existing of finalPoints) {
            const dx = p.x - existing.x;
            const dy = p.y - existing.y;
            if ((dx * dx + dy * dy) < (minPixelDist * minPixelDist)) { tooClose = true; break; }
        }
        if (!tooClose) finalPoints.push(p);
    }
    if (finalPoints.length === 0) { statusDiv.textContent = t.status_no_data; return; }
    finalPoints.forEach((p, idx) => {
        const isHighest = (idx === 0);
        const markerOptions = (idx < 3) ? { icon: rankIcons[idx], zIndexOffset: 1000 - idx } : {};
        // Coordinates and center distance only matter for the handful of winners.
        const latlng = canvasPointToLatLng(p.x, p.y);
        const dist = radiusLookup.distance(p.x, p.y);

        const popupContent = `
            <span class="popup-header" style="${isHighest ? 'color:#b8860b' : ''}">${t.res_rank} #${idx + 1}</span>
            <span class="popup-height">${formatElevation(p.h)}</span>
            <span class="popup-meta">${t.res_dist}: ${formatDistance(dist)}</span>
            <div class="coord-box">
                <span>${latlng.lat.toFixed(5)}, ${latlng.lng.toFixed(5)}</span>
                <button class="copy-btn" title="${t.btn_copy_coords}" onclick="copyCoords(${latlng.lat.toFixed(5)}, ${latlng.lng.toFixed(5)}, this)">📋</button>
            </div>`;
        const marker = L.marker([latlng.lat, latlng.lng], markerOptions).addTo(map).bindPopup(popupContent);
        if (isHighest) marker.openPopup();
        markers.push(marker);
    });
    statusDiv.textContent = t.status_found_points.replace('{n}', finalPoints.length);
}

function calculateMaxClimb() {
    const t = translations[currentLang];
    const w = canvas.width;
    const h = canvas.height;
    const imgData = ctx.getImageData(0, 0, w, h).data;

    // Get data from the water canvas (if enabled)
    const waterData = waterAnalysisEnabled ? waterCtx.getImageData(0, 0, w, h).data : null;

    const searchCenterLatLng = getSearchCenter();
    const searchRadiusMeters = getRadiusMeters();
    const climbDistMeters = getClimbDistMeters();
    const maxResults = parseInt(numClimbsInput.value) || 1;

    const p1 = map.project(searchCenterLatLng, analysisZoom);
    const p2 = map.project(moveLatLng(searchCenterLatLng, climbDistMeters, 0), analysisZoom);
    const climbDistPx = Math.round(p1.distanceTo(p2));

    if (climbDistPx < 2) {
        statusDiv.textContent = t.status_zoom_in;
        return;
    }

    let candidates = [];

    // Optimize: Pre-calculate angle offsets so we aren't running Math.sin/cos millions of times
    const angles = parseInt(document.getElementById('scanAnglesInput').value) || 32;
    const angleOffsets = [];
    for (let a = 0; a < angles; a++) {
        const theta = (a / angles) * 2 * Math.PI;
        angleOffsets.push({
            dx: climbDistPx * Math.cos(theta),
            dy: climbDistPx * Math.sin(theta)
        });
    }

    // Path sampling resolution (user setting, default 10 m). Loop-invariant, so read
    // it once here — getClimbStepMeters() hits the DOM, far too slow per pixel/angle.
    const res = getClimbStepMeters();
    const numSteps = Math.max(1, Math.floor(climbDistMeters / res));

    const radiusLookup = buildRadiusLookup(w, h, searchCenterLatLng, searchRadiusMeters);

    const step = 4;
    for (let y = step; y < h - step; y += step) {
        for (let x = step; x < w - step; x += step) {

            // CHECK WATER AT START POINT (if enabled)
            const i1 = (y * w + x) * 4;
            if (waterData && isWaterPixel(waterData[i1], waterData[i1 + 1], waterData[i1 + 2])) continue;

            if (!radiusLookup.contains(x, y)) continue;

            if (imgData[i1 + 3] < 255) continue;
            const h1 = terrariumToMeters(imgData[i1], imgData[i1 + 1], imgData[i1 + 2]);

            for (let a = 0; a < angles; a++) {
                const x2 = Math.round(x + angleOffsets[a].dx);
                const y2 = Math.round(y + angleOffsets[a].dy);

                if (x2 >= 0 && x2 < w && y2 >= 0 && y2 < h) {

                    // CHECK WATER AT END POINT (if enabled)
                    const i2 = (y2 * w + x2) * 4;
                    if (waterData && isWaterPixel(waterData[i2], waterData[i2 + 1], waterData[i2 + 2])) continue;

                    if (imgData[i2 + 3] < 255) continue;
                    const h2 = terrariumToMeters(imgData[i2], imgData[i2 + 1], imgData[i2 + 2]);

                    // Calculate cumulative ascent along the path
                    let cumulativeAscent = 0;

                    let validPath = true;

                    // Sample all elevations along the path first
                    const elevations = [h1];
                    for (let s = 1; s <= numSteps; s++) {
                        const fraction = s / numSteps;
                        const sx = Math.round(x + (x2 - x) * fraction);
                        const sy = Math.round(y + (y2 - y) * fraction);

                        const si = (sy * w + sx) * 4;
                        if (imgData[si + 3] < 255) {
                            validPath = false;
                            break;
                        }

                        const sh = terrariumToMeters(imgData[si], imgData[si + 1], imgData[si + 2]);
                        elevations.push(sh);
                    }

                    if (!validPath) continue;

                    // Apply 3-sample moving average to filter noise
                    const smoothed = [];
                    for (let i = 0; i < elevations.length; i++) {
                        if (i === 0) {
                            smoothed.push((elevations[0] + elevations[1]) / 2);
                        } else if (i === elevations.length - 1) {
                            smoothed.push((elevations[i - 1] + elevations[i]) / 2);
                        } else {
                            smoothed.push((elevations[i - 1] + elevations[i] + elevations[i + 1]) / 3);
                        }
                    }

                    // Sum only positive elevation changes
                    for (let i = 1; i < smoothed.length; i++) {
                        if (smoothed[i] > smoothed[i - 1]) {
                            cumulativeAscent += (smoothed[i] - smoothed[i - 1]);
                        }
                    }

                    if (cumulativeAscent > 1) {
                        if (!radiusLookup.contains(x2, y2)) continue;

                        candidates.push({
                            diff: cumulativeAscent,
                            start: { x: x, y: y, h: h1 },
                            end: { x: x2, y: y2, h: h2 }
                        });
                    }
                }
            }
        }
    }

    candidates.sort((a, b) => b.diff - a.diff);

    const finalResults = [];
    const minPixelSeparation = 40;

    for (let cand of candidates) {
        if (finalResults.length >= maxResults) break;

        let tooClose = false;
        for (let existing of finalResults) {
            const dx = cand.start.x - existing.start.x;
            const dy = cand.start.y - existing.start.y;
            if ((dx * dx + dy * dy) < (minPixelSeparation * minPixelSeparation)) {
                tooClose = true;
                break;
            }
        }

        if (!tooClose) {
            finalResults.push(cand);
        }
    }

    if (finalResults.length > 0) {
        finalResults.forEach((res, index) => {
            const rank = index + 1;
            const isWinner = (rank === 1);
            // Coordinates only matter for the few ranked winners, so compute them here
            // instead of for every scanned candidate.
            const startLatLng = canvasPointToLatLng(res.start.x, res.start.y);
            const endLatLng = canvasPointToLatLng(res.end.x, res.end.y);

            const polyline = L.polyline([startLatLng, endLatLng], {
                color: isWinner ? 'red' : '#ff7f50',
                weight: isWinner ? 5 : 3,
                opacity: 0.8
            }).addTo(map);
            polylines.push(polyline);

            // Compute shared climb stats
            const distStartEnd = startLatLng.distanceTo(endLatLng);
            const distStartEndStr = formatDistance(distStartEnd);
            const verticalDrop = Math.round(res.end.h - res.start.h);
            const slopePercent = distStartEnd > 0 ? ((verticalDrop / distStartEnd) * 100).toFixed(1) : 0;

            // START POPUP
            const distStart = radiusLookup.distance(res.start.x, res.start.y);
            const startPopup = `
                <span class="popup-header">${t.res_rank} #${rank} (${t.res_start})</span>
                <span class="popup-height">${t.res_elev}: ${formatElevation(res.start.h)}</span>
                <span class="popup-meta">${t.res_dist_center}: ${formatDistance(distStart)}</span>
                <div class="coord-box">
                    <span>${startLatLng.lat.toFixed(5)}, ${startLatLng.lng.toFixed(5)}</span>
                    <button class="copy-btn" title="${t.btn_copy_coords}" onclick="copyCoords(${startLatLng.lat.toFixed(5)}, ${startLatLng.lng.toFixed(5)}, this)">📋</button>
                </div>`;

            const startMarker = L.marker(startLatLng, { icon: greenIcon }).addTo(map)
                .bindPopup(startPopup);
            markers.push(startMarker);

            // PEAK POPUP
            const distEnd = radiusLookup.distance(res.end.x, res.end.y);
            const endPopup = `
                <span class="popup-header" style="${isWinner ? 'color:#b8860b' : ''}">${t.res_rank} #${rank} (${t.res_peak})</span>
                <span class="popup-height">${t.res_climb}: +${formatElevation(res.diff)}</span>
                <span class="popup-meta">${t.res_elev}: ${formatElevation(res.end.h)}</span>
                <span class="popup-meta">${t.res_vertical_drop}: ${verticalDrop >= 0 ? '+' : ''}${formatElevation(verticalDrop)}</span>
                <span class="popup-meta">${t.res_dist_start_end}: ${distStartEndStr}</span>
                <span class="popup-meta">${t.res_slope}: ${slopePercent}%</span>
                <span class="popup-meta">${t.res_dist_center}: ${formatDistance(distEnd)}</span>
                <div class="coord-box">
                    <span>${endLatLng.lat.toFixed(5)}, ${endLatLng.lng.toFixed(5)}</span>
                    <button class="copy-btn" title="${t.btn_copy_coords}" onclick="copyCoords(${endLatLng.lat.toFixed(5)}, ${endLatLng.lng.toFixed(5)}, this)">📋</button>
                </div>`;

            const endMarker = L.marker(endLatLng, { icon: redIcon }).addTo(map)
                .bindPopup(endPopup);
            markers.push(endMarker);

            if (isWinner) endMarker.openPopup();
        });

        statusDiv.textContent = t.status_found_climbs.replace('{n}', finalResults.length);
    } else {
        statusDiv.textContent = t.status_no_data;
    }
}

function moveLatLng(latlng, distMeters, angleDeg) {
    const R = 6378137;
    const dn = distMeters * Math.cos(angleDeg * Math.PI / 180);
    const de = distMeters * Math.sin(angleDeg * Math.PI / 180);
    const dLat = dn / R;
    const dLon = de / (R * Math.cos(Math.PI * latlng.lat / 180));
    return L.latLng(latlng.lat + dLat * 180 / Math.PI, latlng.lng + dLon * 180 / Math.PI);
}

// ==========================================
// 5.1 SERVICE WORKER & UPDATES
// ==========================================
let isAppRefreshInProgress = false;
let swRegistration = null;
let lastUpdateCheck = 0;
const SW_UPDATE_THROTTLE_MS = 60 * 1000;        // don't re-check more than once a minute
const SW_UPDATE_INTERVAL_MS = 30 * 60 * 1000;   // periodic check for long-running sessions
const BUILD_SEEN_KEY = 'topo_last_build';       // localStorage: BUILD_NUMBER this device last ran (update-toast trigger)

function clearRefreshUrlFlag() {
    const url = new URL(window.location.href);
    if (!url.searchParams.has(APP_REFRESH_PARAM)) {
        return;
    }
    url.searchParams.delete(APP_REFRESH_PARAM);
    const cleanUrl = url.pathname + (url.search ? url.search : '') + url.hash;
    window.history.replaceState({}, '', cleanUrl);
}

function buildRefreshUrl() {
    const url = new URL(window.location.href);
    url.searchParams.set(APP_REFRESH_PARAM, Date.now().toString());
    return url.toString();
}

async function refreshApp(button) {
    if (isAppRefreshInProgress) {
        return;
    }

    isAppRefreshInProgress = true;
    closeInfo();

    const refreshButton = button || document.getElementById('info-refresh');
    if (refreshButton) {
        refreshButton.disabled = true;
        refreshButton.textContent = translations[currentLang].btn_refreshing_app;
    }

    try {
        if ('serviceWorker' in navigator) {
            const registrations = navigator.serviceWorker.getRegistrations
                ? await navigator.serviceWorker.getRegistrations()
                : [];
            await Promise.all(registrations.map(registration => registration.unregister()));
        }

        if ('caches' in window) {
            const cacheNames = await caches.keys();
            await Promise.all(cacheNames.map(cacheName => caches.delete(cacheName)));
        }
    } catch (error) {
        console.warn('App refresh reset failed:', error);
    } finally {
        window.location.replace(buildRefreshUrl());
    }
}

// Ask the browser to re-fetch the service worker and look for a new version.
// Throttled so frequent foreground/visibility toggles don't hammer the network.
function checkForSwUpdate(force) {
    if (!swRegistration) return;
    const now = Date.now();
    if (!force && now - lastUpdateCheck < SW_UPDATE_THROTTLE_MS) return;
    lastUpdateCheck = now;
    swRegistration.update().catch(() => { /* offline / transient; ignore */ });
}

function initServiceWorker() {
    if (!('serviceWorker' in navigator)) return;

    // If the running build differs from the one this device last loaded, the app was
    // updated since the user last saw it — confirm it to them (no action needed).
    maybeShowUpdatedConfirmation();

    // Whether a SW already controls this page at load time. Used to suppress the
    // one-off reload that clients.claim() triggers on the very first install.
    const hadControllerAtStartup = !!navigator.serviceWorker.controller;

    // updateViaCache: 'none' forces the SW script itself to be fetched from the
    // network (not the HTTP cache) on every update check, so new releases aren't missed.
    navigator.serviceWorker.register('./service-worker.js', { updateViaCache: 'none' }).then(reg => {
        swRegistration = reg;

        // The new SW auto-activates (skipWaiting on install), so there's no prompt to
        // show. Defensive only: a worker left waiting from before auto-activation shipped
        // won't skip on its own — nudge it so it activates and controllerchange fires.
        if (reg.waiting && navigator.serviceWorker.controller) {
            reg.waiting.postMessage({ action: 'skipWaiting' });
        }

        // Check immediately, then again whenever the app is brought back to the
        // foreground (key for iOS standalone PWAs) and periodically while it stays open.
        checkForSwUpdate(true);
    }).catch(() => { /* registration failed; app still works without offline cache */ });

    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
            checkForSwUpdate(false);
        }
    });
    setInterval(() => checkForSwUpdate(false), SW_UPDATE_INTERVAL_MS);

    // A new SW now takes control on its own (no "Update" tap). Reload onto it only when it
    // won't interrupt: right away if the app is backgrounded, otherwise the next time the
    // user leaves it. The fresh page detects the build change on its own and shows the
    // "updated" snackbar (see maybeShowUpdatedConfirmation).
    let refreshing = false;
    const reloadForUpdate = () => {
        if (refreshing) return;
        refreshing = true;
        window.location.reload();
    };
    navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (isAppRefreshInProgress) return;      // the manual "Refresh app" path reloads itself
        if (!hadControllerAtStartup) return;     // skip the first-ever install (clients.claim)
        if (document.visibilityState === 'hidden') {
            reloadForUpdate();
        } else {
            document.addEventListener('visibilitychange', function onHide() {
                if (document.visibilityState === 'hidden') {
                    document.removeEventListener('visibilitychange', onHide);
                    reloadForUpdate();
                }
            });
        }
    });
}

// Show a brief, dismissable "app updated" confirmation (no action button) the first time
// the app runs on a new build. We compare the running BUILD_NUMBER against the build this
// device last recorded (localStorage): if it changed, the app updated since the user last
// loaded it — however the update arrived (a background auto-reload OR a manual refresh onto
// fresh assets). The auto-dismiss timer only starts once the page is visible, so an update
// that landed while the app was backgrounded is still seen on return.
function maybeShowUpdatedConfirmation() {
    let lastBuild = null;
    try {
        lastBuild = localStorage.getItem(BUILD_SEEN_KEY);
        localStorage.setItem(BUILD_SEEN_KEY, BUILD_NUMBER);   // record the build we're running now
    } catch (e) { /* private mode / storage disabled */ }

    // First run on this device (nothing recorded), or same build as last time: nothing to announce.
    if (!lastBuild || lastBuild === BUILD_NUMBER) return;

    const t = translations[currentLang] || translations.en || {};
    const snackbar = document.getElementById('update-notification');
    const msg = document.getElementById('update-msg');
    if (!snackbar || !msg) return;

    msg.textContent = (t.update_applied || 'Updated to v{version} (Build {build}).')
        .replace('{version}', APP_VERSION).replace('{build}', BUILD_NUMBER);
    snackbar.classList.add('show');

    const dismiss = () => snackbar.classList.remove('show');
    const startTimer = () => setTimeout(dismiss, 6000);
    if (document.visibilityState === 'visible') {
        startTimer();
    } else {
        document.addEventListener('visibilitychange', function onShow() {
            if (document.visibilityState === 'visible') {
                document.removeEventListener('visibilitychange', onShow);
                startTimer();
            }
        });
    }
}

function isMobileDevice() {
    return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) ||
        (window.innerWidth <= 600 && 'ontouchstart' in window);
}

// iPhone/iPad Safari never fires `beforeinstallprompt`, so PWA install is manual
// (Share -> Add to Home Screen). True when we should offer that manual path: an
// iOS/iPadOS device that is not already running as an installed standalone app.
function isIOSInstallEligible() {
    const ua = navigator.userAgent || '';
    // iPadOS 13+ defaults to "desktop" mode: the UA reports "Macintosh" with no
    // iPad token, so a real iPad is detected by touch capability on a Mac UA /
    // platform (navigator.platform is deprecated, so the UA check is the fallback).
    const isIpadOS = (navigator.maxTouchPoints || 0) > 1 &&
        (navigator.platform === 'MacIntel' || /Mac/.test(ua));
    const isIOS = /iPhone|iPad|iPod/i.test(ua) || isIpadOS;
    if (!isIOS) return false;
    const standalone = navigator.standalone === true ||
        window.matchMedia('(display-mode: standalone)').matches;
    return !standalone; // already installed -> don't offer install
}

function shouldDelayInstallUiUntilTutorialCompletes() {
    return !localStorage.getItem('topo_tutorial_done') && !hasSharedMapView && !hasSharedGpxLink;
}

function showDeferredInstallUi(mobileDelayMs = 0) {
    if (!deferredInstallPrompt && !isIOSInstallEligible()) return;
    if (shouldDelayInstallUiUntilTutorialCompletes() || isTutorialVisible()) return;

    const installBtn = document.getElementById('install-app-btn');
    if (installBtn) installBtn.style.display = 'block';

    // iPad in desktop mode fails isMobileDevice() (no iPad token, wide viewport),
    // so allow the bar for any install-eligible iOS device too.
    if ((!isMobileDevice() && !isIOSInstallEligible()) || localStorage.getItem('topo_install_dismissed')) return;

    const showMobileBar = () => {
        if ((!deferredInstallPrompt && !isIOSInstallEligible()) || shouldDelayInstallUiUntilTutorialCompletes() || isTutorialVisible()) return;
        const mobileBar = document.getElementById('mobile-install-bar');
        if (mobileBar) mobileBar.classList.add('show');
    };

    if (mobileDelayMs > 0) {
        window.setTimeout(showMobileBar, mobileDelayMs);
        return;
    }

    showMobileBar();
}

function triggerInstallPrompt() {
    if (!deferredInstallPrompt) {
        // No native prompt on iPhone/iPad: show manual Add to Home Screen steps.
        if (isIOSInstallEligible()) showIOSInstallInstructions();
        return;
    }
    deferredInstallPrompt.prompt();
    deferredInstallPrompt.userChoice.then(() => {
        deferredInstallPrompt = null;
        const installBtn = document.getElementById('install-app-btn');
        if (installBtn) installBtn.style.display = 'none';
        const mobileBar = document.getElementById('mobile-install-bar');
        if (mobileBar) mobileBar.classList.remove('show');
    });
}

function showIOSInstallInstructions() {
    const modal = document.getElementById('ios-install-modal');
    if (modal) modal.style.display = 'flex';
}

function closeIOSInstallInstructions() {
    const modal = document.getElementById('ios-install-modal');
    if (modal) modal.style.display = 'none';
}

function dismissInstallBar() {
    localStorage.setItem('topo_install_dismissed', '1');
    const mobileBar = document.getElementById('mobile-install-bar');
    if (mobileBar) mobileBar.classList.remove('show');
}

window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredInstallPrompt = e;
    showDeferredInstallUi(1500);
});

window.addEventListener('appinstalled', () => {
    deferredInstallPrompt = null;
    const installBtn = document.getElementById('install-app-btn');
    if (installBtn) installBtn.style.display = 'none';
    const mobileBar = document.getElementById('mobile-install-bar');
    if (mobileBar) mobileBar.classList.remove('show');
});

// ==========================================
// 5b. TUTORIAL ENGINE
// ==========================================

let tutorialStep = 0;
let _tutorialOverlayClickHandler = null;
let _tutorialKeydownHandler = null;
let _routeOverlayBeforeTutorial = 'none'; // Route Overlay dropdown value to restore when the tutorial ends

const tutorialSteps = [
    { targetSelector: null, titleKey: 'tutorial_welcome_title', textKey: 'tutorial_welcome_text' },
    { targetSelector: '#share-map-btn', titleKey: 'tutorial_share_title', textKey: 'tutorial_share_text' },
    { targetSelector: '.info-btn', titleKey: 'tutorial_info_title', textKey: 'tutorial_info_text' },
    { targetSelector: '.toggle-btn', titleKey: 'tutorial_minimize_title', textKey: 'tutorial_minimize_text' },
    { targetSelector: '.search-group', titleKey: 'tutorial_tools_title', textKey: 'tutorial_tools_text', expandControls: true },
    { targetSelector: '.layer-row', targetSelectorEnd: '#extra-layer-row', titleKey: 'tutorial_layers_title', textKey: 'tutorial_layers_tools_text', expandControls: true, enableRouteOverlay: true },
    { targetSelector: '#radius-controls', targetSelectorEnd: '#group-points', titleKey: 'tutorial_points_title', textKey: 'tutorial_points_text', expandControls: true, expandSection: 'section-points' },
    { targetSelector: '#group-climbs', titleKey: 'tutorial_climb_title', textKey: 'tutorial_climb_text', expandControls: true, expandSection: 'section-climbs' },
    { targetSelector: '#group-slope', titleKey: 'tutorial_slope_title', textKey: 'tutorial_slope_text', expandControls: true, expandSection: 'section-slope' },
    { targetSelector: '#group-routes', titleKey: 'tutorial_routes_title', textKey: 'tutorial_routes_text', expandControls: true, expandSection: 'section-routes' },
    { targetSelector: '.app-logo', titleKey: 'tutorial_print_title', textKey: 'tutorial_print_text', desktopOnly: true },
    { targetSelector: null, titleKey: 'tutorial_tips_title', textKey: 'tutorial_tips_text' }
// Print map is launched from the app logo and only available on desktop, so drop that step on touch devices.
].filter((step) => !step.desktopOnly || !isMobileDevice());

function isTutorialVisible() {
    const overlay = document.getElementById('tutorial-overlay');
    return Boolean(overlay) && overlay.style.display === 'block';
}

function syncTutorialUiState(step) {
    setControlsMinimized(!step.expandControls);
    collapseTutorialSections();
    // Turn the route overlay on for the step that explains it, so the Route Overlay
    // dropdown and "Show route names" toggle are visible under the spotlight.
    if (step.enableRouteOverlay && extraLayerSelect && extraLayerSelect.value === 'none') {
        extraLayerSelect.value = 'waymarked_hiking';
        handleExtraLayerChange('waymarked_hiking');
    }
    if (step.expandSection) {
        setSectionExpanded(step.expandSection, true);
        if (ANALYSIS_SECTION_IDS.includes(step.expandSection)) {
            moveRadiusControlsIntoSection(step.expandSection);
        } else if (step.expandSection === 'section-routes' && circleCheckbox) {
            circleCheckbox.checked = false;
            updateUI();
        }
    }
}

function getTutorialTargetRect(step) {
    if (!step.targetSelector) return null;

    const startEl = document.querySelector(step.targetSelector);
    if (!startEl) return null;

    let rect = startEl.getBoundingClientRect();
    if (!step.targetSelectorEnd) {
        return rect;
    }

    const endEl = document.querySelector(step.targetSelectorEnd);
    if (!endEl) {
        return rect;
    }

    const endRect = endEl.getBoundingClientRect();
    const left = Math.min(rect.left, endRect.left);
    const top = Math.min(rect.top, endRect.top);
    const right = Math.max(rect.right, endRect.right);
    const bottom = Math.max(rect.bottom, endRect.bottom);
    rect = {
        left,
        top,
        right,
        bottom,
        width: right - left,
        height: bottom - top
    };

    return rect;
}

function getTutorialTargetRects(step) {
    if (Array.isArray(step.targetSelectors) && step.targetSelectors.length > 0) {
        return step.targetSelectors
            .map((selector) => {
                const target = document.querySelector(selector);
                return target ? target.getBoundingClientRect() : null;
            })
            .filter(Boolean);
    }

    const rect = getTutorialTargetRect(step);
    return rect ? [rect] : [];
}

function getTutorialSpotlightBounds(rects) {
    if (!rects.length) return null;

    const left = Math.min(...rects.map((rect) => rect.left));
    const top = Math.min(...rects.map((rect) => rect.top));
    const right = Math.max(...rects.map((rect) => rect.right));
    const bottom = Math.max(...rects.map((rect) => rect.bottom));

    return {
        left,
        top,
        right,
        bottom,
        width: right - left,
        height: bottom - top
    };
}

function positionTutorialSpotlight(spotlight, rect, pad) {
    if (!spotlight || !rect) return;

    spotlight.style.display = 'block';
    spotlight.style.left = (rect.left - pad) + 'px';
    spotlight.style.top = (rect.top - pad) + 'px';
    spotlight.style.width = (rect.width + pad * 2) + 'px';
    spotlight.style.height = (rect.height + pad * 2) + 'px';
}

function hideTutorialSpotlight(spotlight) {
    if (!spotlight) return;

    spotlight.style.display = 'none';
    spotlight.style.width = '0';
    spotlight.style.height = '0';
}

function attachTutorialKeyboardNavigation() {
    if (_tutorialKeydownHandler) {
        document.removeEventListener('keydown', _tutorialKeydownHandler, true);
    }

    _tutorialKeydownHandler = function (e) {
        if (!isTutorialVisible() || e.repeat) return;

        if (e.key === 'ArrowRight') {
            e.preventDefault();
            e.stopPropagation();
            tutorialNext();
        } else if (e.key === 'ArrowLeft') {
            e.preventDefault();
            e.stopPropagation();
            tutorialPrev();
        }
    };

    document.addEventListener('keydown', _tutorialKeydownHandler, true);
}

function detachTutorialKeyboardNavigation() {
    if (_tutorialKeydownHandler) {
        document.removeEventListener('keydown', _tutorialKeydownHandler, true);
        _tutorialKeydownHandler = null;
    }
}

function startTutorial() {
    setControlsMinimized(true);
    collapseTutorialSections();
    _routeOverlayBeforeTutorial = extraLayerSelect ? extraLayerSelect.value : 'none';
    tutorialStep = 0;
    const overlay = document.getElementById('tutorial-overlay');
    overlay.style.display = 'block';
    overlay.style.pointerEvents = 'auto';
    renderTutorialStep();

    // Dismiss on backdrop click (outside tooltip)
    if (_tutorialOverlayClickHandler) {
        overlay.removeEventListener('click', _tutorialOverlayClickHandler);
    }
    _tutorialOverlayClickHandler = function(e) {
        if (e.target === overlay) finishTutorial();
    };
    overlay.addEventListener('click', _tutorialOverlayClickHandler);
    attachTutorialKeyboardNavigation();
}

function renderTutorialStep() {
    const t = translations[currentLang];
    const step = tutorialSteps[tutorialStep];
    const spotlight = document.getElementById('tutorial-spotlight');
    const secondarySpotlight = document.getElementById('tutorial-spotlight-secondary');
    const tooltip = document.getElementById('tutorial-tooltip');
    const titleEl = document.getElementById('tutorial-title');
    const textEl = document.getElementById('tutorial-text');
    const prevBtn = document.getElementById('tutorial-prev');
    const nextBtn = document.getElementById('tutorial-next');
    const progressEl = document.getElementById('tutorial-progress');

    syncTutorialUiState(step);
    tooltip.style.transform = '';

    titleEl.textContent = t[step.titleKey] || '';
    textEl.textContent = t[step.textKey] || '';
    progressEl.textContent = (tutorialStep + 1) + ' / ' + tutorialSteps.length;

    prevBtn.textContent = t.tutorial_btn_prev || 'Back';
    nextBtn.textContent = tutorialStep === tutorialSteps.length - 1 ? (t.tutorial_btn_finish || 'Finish') : (t.tutorial_btn_next || 'Next');
    prevBtn.style.visibility = tutorialStep === 0 ? 'hidden' : 'visible';

    const PAD = 8;
    const rects = getTutorialTargetRects(step);
    if (rects.length > 0) {
        const visibleRects = rects.slice(0, 2);
        const bounds = getTutorialSpotlightBounds(rects);
        if (bounds) {
            positionTutorialSpotlight(spotlight, visibleRects[0], PAD);
            if (visibleRects[1]) {
                positionTutorialSpotlight(secondarySpotlight, visibleRects[1], PAD);
            } else {
                hideTutorialSpotlight(secondarySpotlight);
            }

            // Position tooltip below or above the element
            const margin = 10;
            const tooltipW = tooltip.offsetWidth || 320;
            const tooltipH = tooltip.offsetHeight || 200;
            const spaceBelow = window.innerHeight - bounds.bottom;
            let leftPos = Math.max(margin, Math.min(bounds.left, window.innerWidth - tooltipW - margin));
            let topPos;
            if (spaceBelow >= tooltipH + 20) {
                topPos = bounds.bottom + 14;
            } else {
                topPos = bounds.top - tooltipH - 14;
            }
            topPos = Math.max(margin, Math.min(topPos, window.innerHeight - tooltipH - margin));
            tooltip.style.left = leftPos + 'px';
            tooltip.style.top = topPos + 'px';
        } else {
            // Fallback to centered if element not found
            centerTutorialTooltip([spotlight, secondarySpotlight], tooltip);
        }
    } else {
        // No target - center the tooltip, hide spotlight
        centerTutorialTooltip([spotlight, secondarySpotlight], tooltip);
    }
}

function centerTutorialTooltip(spotlights, tooltip) {
    spotlights.forEach(hideTutorialSpotlight);
    tooltip.style.left = '50%';
    tooltip.style.top = '50%';
    tooltip.style.transform = 'translate(-50%, -50%)';
}

function tutorialNext() {
    if (tutorialStep < tutorialSteps.length - 1) {
        // Reset transform before repositioning
        document.getElementById('tutorial-tooltip').style.transform = '';
        tutorialStep++;
        renderTutorialStep();
    } else {
        finishTutorial();
    }
}

function tutorialPrev() {
    if (tutorialStep > 0) {
        document.getElementById('tutorial-tooltip').style.transform = '';
        tutorialStep--;
        renderTutorialStep();
    }
}

function finishTutorial() {
    localStorage.setItem('topo_tutorial_done', '1');
    const overlay = document.getElementById('tutorial-overlay');
    if (_tutorialOverlayClickHandler) {
        overlay.removeEventListener('click', _tutorialOverlayClickHandler);
        _tutorialOverlayClickHandler = null;
    }
    detachTutorialKeyboardNavigation();
    overlay.style.display = 'none';
    overlay.style.pointerEvents = 'none';
    collapseTutorialSections();
    setControlsMinimized(true);
    // Restore the Route Overlay dropdown to its pre-tutorial selection.
    if (extraLayerSelect && extraLayerSelect.value !== _routeOverlayBeforeTutorial) {
        extraLayerSelect.value = _routeOverlayBeforeTutorial;
        handleExtraLayerChange(_routeOverlayBeforeTutorial);
    }
    showDeferredInstallUi(1500);
}

// ==========================================
// 5c. MANUAL CLIMB
// ==========================================

window.toggleManualClimbMode = function () {
    manualClimbMode ? cancelManualClimbMode() : enterManualClimbMode();
};

function enterManualClimbMode() {
    // Refuse rather than exit track editing for it — the edits are unsaved.
    if (gpxEditMode) {
        statusDiv.textContent = translations[currentLang].status_gpx_edit_busy ||
            'Finish or cancel track editing first.';
        return;
    }
    // Nothing is committed while picking route points, so take the click over.
    if (routeCreateMode) cancelRouteCreation();
    manualClimbMode = true;
    manualClimbPoints = [];
    manualClimbMarkers = [];
    manualClimbPolyline = null;

    document.getElementById('manual-climb-toggle-btn').classList.add('active');
    document.getElementById('manual-climb-ui').style.display = 'block';
    document.getElementById('map').classList.add('manual-climb-active');
    if (circleCheckbox && circleCheckbox.checked) {
        circleCheckbox.checked = false;
        updateUI();
    }
    _updateManualClimbUI();
    statusDiv.textContent = translations[currentLang].status_manual_climb_active;
}

window.cancelManualClimbMode = function () {
    manualClimbMode = false;

    manualClimbMarkers.forEach(m => m.remove());
    manualClimbMarkers = [];
    manualClimbPoints = [];

    if (manualClimbPolyline) {
        map.removeLayer(manualClimbPolyline);
        manualClimbPolyline = null;
    }

    const tb = document.getElementById('manual-climb-toggle-btn');
    if (tb) tb.classList.remove('active');
    const ui = document.getElementById('manual-climb-ui');
    if (ui) ui.style.display = 'none';
    document.getElementById('map').classList.remove('manual-climb-active');

    statusDiv.textContent = translations[currentLang].status_ready;
};

function addManualClimbPoint(lat, lng) {
    manualClimbPoints.push(L.latLng(lat, lng));

    const el = document.createElement('div');
    el.className = 'manual-climb-dot' + (manualClimbPoints.length === 1 ? ' first' : '');

    manualClimbMarkers.push(
        new maplibregl.Marker({ element: el, anchor: 'center' })
            .setLngLat([lng, lat])
            .addTo(map._map)
    );

    _refreshManualClimbPolyline();
    _updateManualClimbUI();
}

window.undoManualClimbPoint = function () {
    if (!manualClimbPoints.length) return;
    manualClimbPoints.pop();
    manualClimbMarkers.pop().remove();
    _refreshManualClimbPolyline();
    _updateManualClimbUI();
};

function _refreshManualClimbPolyline() {
    if (manualClimbPolyline) {
        map.removeLayer(manualClimbPolyline);
        manualClimbPolyline = null;
    }
    if (manualClimbPoints.length >= 2) {
        manualClimbPolyline = L.polyline(manualClimbPoints,
            { color: '#1565C0', weight: 3, opacity: 0.7 }).addTo(map);
    }
}

function _updateManualClimbUI() {
    const t = translations[currentLang];
    const n = manualClimbPoints.length;
    const hint = document.getElementById('manual-climb-hint');
    const count = document.getElementById('manual-climb-count');
    const calc = document.getElementById('manual-climb-calc-btn');
    const undo = document.getElementById('manual-climb-undo-btn');

    if (hint) hint.textContent = t.lbl_manual_climb_hint;
    if (count) {
        count.textContent =
            n === 0 ? t.lbl_manual_climb_none
                : n === 1 ? t.lbl_manual_climb_one
                    : (t.lbl_manual_climb_many || '{n} points placed').replace('{n}', n);
    }
    if (calc) calc.disabled = n < 2;
    if (undo) undo.disabled = n === 0;
}

window.runManualClimbCalculation = async function () {
    if (manualClimbPoints.length < 2) return;
    const t = translations[currentLang];

    const calcBtn = document.getElementById('manual-climb-calc-btn');
    if (calcBtn) calcBtn.disabled = true;
    statusDiv.textContent = t.status_loading;

    try {
        // Keep the full route in view before building DEM analysis canvas.
        const routeBounds = L.latLngBounds(manualClimbPoints);
        map.fitBounds(routeBounds.pad(0.15));
        await new Promise((resolve) => setTimeout(resolve, 150));

        await fetchAnalysisData();
        statusDiv.textContent = t.status_calc;

        const ptElevs = manualClimbPoints.map(_elevationAtLatLng);
        if (ptElevs.some((elev) => elev === null)) {
            statusDiv.textContent = t.status_no_data;
            if (calcBtn) calcBtn.disabled = false;
            return;
        }

        let totalAscent = 0;
        let totalDist = 0;

        for (let i = 0; i < manualClimbPoints.length - 1; i++) {
            const segA = manualClimbPoints[i];
            const segB = manualClimbPoints[i + 1];
            totalDist += segA.distanceTo(segB);

            const elevs = _sampleSegmentElevations(segA, segB);
            if (!elevs || elevs.length < 2) continue;

            const smoothed = _smoothElevations(elevs);
            for (let j = 1; j < smoothed.length; j++) {
                if (smoothed[j] > smoothed[j - 1]) totalAscent += smoothed[j] - smoothed[j - 1];
            }
        }

        const startElev = ptElevs[0];
        const endElev = ptElevs[ptElevs.length - 1];
        const vertDrop = Math.round(endElev - startElev);
        const slopePct = totalDist > 0 ? ((vertDrop / totalDist) * 100).toFixed(1) : 0;
        const distStr = formatDistance(totalDist);

        _renderManualClimbResult(totalAscent, startElev, endElev, vertDrop, slopePct, distStr, t);
        cancelManualClimbMode();
        statusDiv.textContent = t.status_done;

    } catch (err) {
        console.error(err);
        statusDiv.textContent = (t.status_error || 'Error: ') + err.message;
        if (calcBtn) calcBtn.disabled = false;
    }
};

function _elevationAtLatLng(latlng) {
    const p = map.project(latlng, analysisZoom).subtract(analysisNwOrigin);
    const px = Math.round(p.x);
    const py = Math.round(p.y);
    if (px < 0 || px >= canvas.width || py < 0 || py >= canvas.height) return null;
    const d = ctx.getImageData(px, py, 1, 1).data;
    if (d[3] < 255) return null;
    return terrariumToMeters(d[0], d[1], d[2]);
}

function _sampleSegmentElevations(a, b) {
    const p1 = map.project(a, analysisZoom).subtract(analysisNwOrigin);
    const p2 = map.project(b, analysisZoom).subtract(analysisNwOrigin);
    const w = canvas.width;
    const h = canvas.height;
    const res = getClimbStepMeters();
    const numSteps = Math.max(1, Math.floor(a.distanceTo(b) / res));
    const all = ctx.getImageData(0, 0, w, h).data;
    const elevs = [];

    for (let s = 0; s <= numSteps; s++) {
        const f = s / numSteps;
        const px = Math.round(p1.x + (p2.x - p1.x) * f);
        const py = Math.round(p1.y + (p2.y - p1.y) * f);
        if (px < 0 || px >= w || py < 0 || py >= h) return null;
        const i = (py * w + px) * 4;
        if (all[i + 3] < 255) return null;
        elevs.push(terrariumToMeters(all[i], all[i + 1], all[i + 2]));
    }
    return elevs;
}

function _smoothElevations(arr) {
    if (arr.length <= 2) return arr;
    return arr.map((v, i, a) => {
        if (i === 0 || i === a.length - 1) return v;
        return (a[i - 1] + a[i] + a[i + 1]) / 3;
    });
}

function _renderManualClimbResult(totalAscent, startElev, endElev, vertDrop, slopePct, distStr, t) {
    const line = L.polyline(manualClimbPoints, { color: 'red', weight: 5, opacity: 0.8 }).addTo(map);
    polylines.push(line);

    const s = manualClimbPoints[0];
    const e = manualClimbPoints[manualClimbPoints.length - 1];

    const startM = L.marker(s, { icon: greenIcon }).addTo(map).bindPopup(`
        <span class="popup-header">${t.res_start}</span>
        <span class="popup-height">${t.res_elev}: ${formatElevation(startElev)}</span>
        <div class="coord-box">
            <span>${s.lat.toFixed(5)}, ${s.lng.toFixed(5)}</span>
            <button class="copy-btn"
                    onclick="copyCoords(${s.lat.toFixed(5)},${s.lng.toFixed(5)},this)">📋</button>
        </div>`);
    markers.push(startM);

    const endM = L.marker(e, { icon: redIcon }).addTo(map).bindPopup(`
        <span class="popup-header">ߓanual Climb</span>
        <span class="popup-height">${t.res_climb}: +${formatElevation(totalAscent)}</span>
        <span class="popup-meta">${t.res_elev}: ${formatElevation(endElev)}</span>
        <span class="popup-meta">${t.res_vertical_drop}: ${vertDrop >= 0 ? '+' : ''}${formatElevation(vertDrop)}</span>
        <span class="popup-meta">${t.res_dist_start_end}: ${distStr}</span>
        <span class="popup-meta">${t.res_slope}: ${slopePct}%</span>
        <div class="coord-box">
            <span>${e.lat.toFixed(5)}, ${e.lng.toFixed(5)}</span>
            <button class="copy-btn"
                    onclick="copyCoords(${e.lat.toFixed(5)},${e.lng.toFixed(5)},this)">📋</button>
        </div>`);
    markers.push(endM);
    endM.openPopup();
}

// ==========================================
// 5d. GPX TRACK EDITING
// ==========================================
//
// Reshapes an already-loaded track by dragging handles along it. Each drag re-routes the
// two sub-segments either side of the moved handle, via openrouteservice when snapping is
// on (and reachable) or as a densified straight line otherwise.
//
// The design rests on two ideas:
//   1. `st.points` IS `gpxTrackData.segments[segIndex]` — the working copy is installed
//      into the render pipeline, so edits show up through the existing draw path with no
//      new render code. Cancel swaps `st.original` back in.
//   2. Every handle's `idx` addresses a REAL element of `st.points`; no virtual or
//      fractional indices exist. _gpxEditSpliceBetween() is the only function that
//      changes point counts, and it is also the only one that shifts handle indices.
//
// Handle invariants, checked by _gpxEditAssertInvariants() after every mutation:
//   handles ascending by idx · handles[0].idx === 0 · last idx === points.length - 1 ·
//   at least GPX_EDIT_MIN_HANDLES handles · every idx addressable.

window.toggleGpxEditMode = function () {
    gpxEditMode ? cancelGpxEditMode() : enterGpxEditMode();
};

// Most GPX files hold one segment. With several, edit the longest and leave the rest
// untouched — they still render and still export verbatim.
function _gpxEditPickSegment() {
    const segments = (gpxTrackData && gpxTrackData.segments) || [];
    let best = -1;
    for (let i = 0; i < segments.length; i++) {
        if (segments[i].length < 2) continue;
        if (best === -1 || segments[i].length > segments[best].length) best = i;
    }
    return best;
}

function enterGpxEditMode(options = {}) {
    const t = translations[currentLang];
    if (!gpxTrackData) {
        statusDiv.textContent = t.status_gpx_edit_no_track || 'Load a GPX track before editing.';
        return;
    }
    const segIndex = _gpxEditPickSegment();
    if (segIndex === -1) {
        statusDiv.textContent = t.status_gpx_edit_no_track || 'Load a GPX track before editing.';
        return;
    }

    // Editing owns the map click and the track geometry; the other placement modes cannot
    // run alongside it.
    if (poiPlacementMode) cancelPoiPlacement();
    if (manualClimbMode) cancelManualClimbMode();
    // A no-op when the editor is entered from the create flow (which tears down first);
    // it matters when the user presses Edit track while still picking points.
    if (routeCreateMode) _routeCreateForceExit();

    const seg = gpxTrackData.segments[segIndex];
    gpxEditMode = true;
    gpxEditState = {
        segIndex,
        original: seg.map(p => ({ lat: p.lat, lon: p.lon, ele: p.ele })),
        points: seg.map(p => ({ lat: p.lat, lon: p.lon, ele: p.ele })),
        handles: [],
        nextHandleId: 1,
        snap: routingPrefs.snap && routingAvailable,
        profile: routingPrefs.profile,
        undo: [],
        redo: [],
        undoPointCount: 0,
        dragging: null,
        busy: false,
        prevColorBySlope: getGpxColorBySlope()
    };
    // The working copy becomes the rendered geometry.
    gpxTrackData.segments[segIndex] = gpxEditState.points;

    // Slope colouring emits one GeoJSON feature per vertex pair; regenerating that on
    // every drag stalls visibly on a large track. Pause it and restore on exit.
    if (gpxEditState.prevColorBySlope) {
        const slopeBox = document.getElementById('gpxColorBySlope');
        if (slopeBox) slopeBox.checked = false;
        rebuildGpxLayer();
    }

    _gpxEditSeedHandles();

    const btn = document.getElementById('gpx-edit-btn');
    if (btn) btn.classList.add('active');
    const panel = document.getElementById('gpx-edit-panel');
    if (panel) panel.style.display = 'block';
    const snapBox = document.getElementById('gpxEditSnap');
    if (snapBox) snapBox.checked = gpxEditState.snap;
    const profileSel = document.getElementById('gpxEditProfile');
    if (profileSel) profileSel.value = gpxEditState.profile;
    const mapEl = document.getElementById('map');
    if (mapEl) mapEl.classList.add('gpx-edit-active');

    _updateGpxEditUI();
    // Reveals the Undo/Redo/Save/Cancel row in the floating panel.
    _updateRouteInfoPanel();

    if (options.statusMessage) {
        // Create Route already explained the situation, including a missing backend, and
        // its message names the next action. Do not bury it under the generic prompt.
        statusDiv.textContent = options.statusMessage;
    } else if (!routingAvailable) {
        statusDiv.textContent = t.status_gpx_edit_route_unavailable ||
            'Snap to route needs the online backend; freehand editing is used.';
    } else if (gpxTrackData.segments.length > 1) {
        statusDiv.textContent = (t.status_gpx_edit_multi_segment ||
            'Track has {n} segments — editing the longest one.')
            .replace('{n}', gpxTrackData.segments.length);
    } else if (gpxEditState.prevColorBySlope) {
        statusDiv.textContent = t.status_gpx_edit_slope_off ||
            'Slope colouring is paused while editing.';
    } else {
        statusDiv.textContent = t.status_gpx_edit_active ||
            'Edit mode — drag handles, click the track to add one.';
    }
}

// Start / midpoint / end, so the user can drag immediately.
function _gpxEditSeedHandles() {
    const st = gpxEditState;
    // A 2-point track is legal GPX; densify so three distinct indices exist.
    if (st.points.length < 3) {
        const a = st.points[0], b = st.points[st.points.length - 1];
        st.points.splice(1, 0, {
            lat: (a.lat + b.lat) / 2,
            lon: (a.lon + b.lon) / 2,
            ele: (a.ele === null || b.ele === null) ? null : Math.round((a.ele + b.ele) / 2)
        });
    }
    const n = st.points.length;
    _gpxEditAddHandleAtIndex(0);
    _gpxEditAddHandleAtIndex(Math.floor((n - 1) / 2));
    _gpxEditAddHandleAtIndex(n - 1);
    _gpxEditAssertInvariants();
}

function _gpxEditAddHandleAtIndex(idx) {
    const st = gpxEditState;
    if (idx < 0 || idx >= st.points.length) return null;
    if (st.handles.some(h => h.idx === idx)) return null;

    const handle = { id: st.nextHandleId++, idx, marker: null, el: null };
    let insertAt = st.handles.length;
    for (let i = 0; i < st.handles.length; i++) {
        if (st.handles[i].idx > idx) { insertAt = i; break; }
    }
    st.handles.splice(insertAt, 0, handle);
    _gpxEditCreateHandleMarker(handle);
    return handle;
}

function _gpxEditIsEndpointHandle(k) {
    return k === 0 || k === gpxEditState.handles.length - 1;
}

function _gpxEditCreateHandleMarker(handle) {
    const st = gpxEditState;
    const t = translations[currentLang];
    const el = document.createElement('div');
    el.className = 'gpx-edit-handle';
    el.title = t.gpx_edit_handle_title || 'Drag to move · right-click to remove';

    const pt = st.points[handle.idx];
    const marker = new maplibregl.Marker({ element: el, anchor: 'center', draggable: true })
        .setLngLat([pt.lon, pt.lat])
        .addTo(map._map);

    marker.on('dragstart', () => _gpxEditOnDragStart(handle.id));
    marker.on('drag', () => _gpxEditOnDrag(handle.id));
    marker.on('dragend', () => _gpxEditOnDragEnd(handle.id));
    el.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        _gpxEditDeleteHandle(_gpxEditIndexOfId(handle.id));
    });
    // Touch equivalent of right-click. Cancelled by any move so it can't fire mid-drag.
    let pressTimer = null;
    const clearPress = () => { if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; } };
    el.addEventListener('touchstart', () => {
        clearPress();
        pressTimer = setTimeout(() => {
            pressTimer = null;
            _gpxEditDeleteHandle(_gpxEditIndexOfId(handle.id));
        }, 600);
    }, { passive: true });
    el.addEventListener('touchmove', clearPress, { passive: true });
    el.addEventListener('touchend', clearPress);
    el.addEventListener('touchcancel', clearPress);

    handle.marker = marker;
    handle.el = el;
    _gpxEditRestyleHandles();
    return marker;
}

function _gpxEditRestyleHandles() {
    const handles = gpxEditState.handles;
    const last = handles.length - 1;
    handles.forEach((h, k) => {
        if (!h.el) return;
        h.el.classList.toggle('endpoint', _gpxEditIsEndpointHandle(k));
        // Start and end were the same green, so the two ends of the track looked identical
        // and you could not tell which one you were about to drag. The k !== 0 guard keeps a
        // degenerate single-handle state from being start and end at once.
        h.el.classList.toggle('endpoint-end', k === last && k !== 0);
    });
}

function _gpxEditIndexOfId(id) {
    return gpxEditState.handles.findIndex(h => h.id === id);
}

// --- Geometry helpers ---------------------------------------------------------------

// Ground distance spanned by one CSS pixel at the map center. Same unproject trick as
// computeScaleDenominator(), used here to turn a pixel tolerance into meters.
function metersPerPixel() {
    const nm = map._map;
    const cont = nm.getContainer();
    const cx = cont.clientWidth / 2, cy = cont.clientHeight / 2;
    const a = nm.unproject([cx, cy]), b = nm.unproject([cx + 100, cy]);
    return haversineDistance(a.lat, a.lng, b.lat, b.lng) / 100;
}

// Nearest point on the edited polyline to (lat, lon) -> { i, t, distM }, where the hit
// lies at fraction t along the segment from points[i] to points[i+1].
//
// Local equirectangular projection at the click latitude: accurate well past the ~18 px
// tolerance this feeds, and much cheaper than a haversine per candidate segment.
function _gpxEditNearestOnTrack(lat, lon) {
    const pts = gpxEditState ? gpxEditState.points : null;
    if (!pts || pts.length < 2) return null;

    const kLat = 111320;
    const kLon = 111320 * Math.cos(lat * Math.PI / 180);
    let best = null;

    for (let i = 0; i < pts.length - 1; i++) {
        const ax = (pts[i].lon - lon) * kLon, ay = (pts[i].lat - lat) * kLat;
        const bx = (pts[i + 1].lon - lon) * kLon, by = (pts[i + 1].lat - lat) * kLat;
        const dx = bx - ax, dy = by - ay;
        const l2 = dx * dx + dy * dy;
        let tt = l2 === 0 ? 0 : -(ax * dx + ay * dy) / l2;
        tt = tt < 0 ? 0 : (tt > 1 ? 1 : tt);
        const px = ax + tt * dx, py = ay + tt * dy;
        const d2 = px * px + py * py;
        if (best === null || d2 < best.d2) best = { i, t: tt, d2 };
    }
    if (!best) return null;
    return { i: best.i, t: best.t, distM: Math.sqrt(best.d2) };
}
window._gpxEditNearestOnTrack = _gpxEditNearestOnTrack;

// Turns a hit into a real handle. When the hit falls between two vertices a new vertex is
// inserted so the handle addresses an actual array element (invariant 5), and every handle
// at or above the insertion point shifts by one.
function _gpxEditAddHandleAtHit(hit) {
    const st = gpxEditState;
    const pts = st.points;
    const a = pts[hit.i], b = pts[hit.i + 1];
    const segLenM = haversineDistance(a.lat, a.lon, b.lat, b.lon);
    let idx;

    if (hit.t * segLenM < 1) {
        idx = hit.i;                       // within a meter of the start vertex
    } else if ((1 - hit.t) * segLenM < 1) {
        idx = hit.i + 1;                   // within a meter of the end vertex
    } else {
        idx = hit.i + 1;
        pts.splice(idx, 0, {
            lat: a.lat + hit.t * (b.lat - a.lat),
            lon: a.lon + hit.t * (b.lon - a.lon),
            ele: (a.ele === null || b.ele === null) ? null
                : Math.round(a.ele + hit.t * (b.ele - a.ele))
        });
        for (const h of st.handles) if (h.idx >= idx) h.idx += 1;
    }
    return _gpxEditAddHandleAtIndex(idx);
}

function handleGpxEditMapClick(lat, lon) {
    const st = gpxEditState;
    const t = translations[currentLang];
    if (!st || st.busy) return;

    const hit = _gpxEditNearestOnTrack(lat, lon);
    if (!hit || hit.distM > GPX_EDIT_CLICK_TOLERANCE_PX * metersPerPixel()) {
        statusDiv.textContent = t.status_gpx_edit_handle_too_far ||
            'Click closer to the track to add a handle.';
        return;
    }

    _gpxEditPushUndo();
    const handle = _gpxEditAddHandleAtHit(hit);
    if (!handle) {
        // A handle already sits here; drop the snapshot we just took.
        _gpxEditPopUndoNoop();
        return;
    }
    _gpxEditAssertInvariants();
    _gpxEditRefreshRender();
    _updateGpxEditUI();
    statusDiv.textContent = (t.status_gpx_edit_handle_added || 'Handle added ({n} total).')
        .replace('{n}', st.handles.length);
}

async function _gpxEditDeleteHandle(k) {
    const st = gpxEditState;
    const t = translations[currentLang];
    if (!st || st.busy || k < 0) return;
    if (st.handles.length <= GPX_EDIT_MIN_HANDLES || _gpxEditIsEndpointHandle(k)) {
        statusDiv.textContent = t.status_gpx_edit_min_handles || 'At least 3 handles are required.';
        return;
    }

    _gpxEditPushUndo();
    st.handles[k].marker.remove();
    st.handles.splice(k, 1);
    _gpxEditRestyleHandles();

    st.busy = true;
    _updateGpxEditUI();
    try {
        // Merge the two sub-segments the deleted handle used to divide.
        await _gpxEditSpliceBetween(k - 1);
    } finally {
        st.busy = false;
    }
    _gpxEditAssertInvariants();
    _gpxEditRefreshRender();
    _updateGpxEditUI();
    statusDiv.textContent = (t.status_gpx_edit_handle_removed || 'Handle removed ({n} left).')
        .replace('{n}', st.handles.length);
}

// --- Routing ------------------------------------------------------------------------

async function requestOrsRoute(a, b, profile) {
    const t = translations[currentLang];
    try {
        const resp = await fetch(API_BASE + '/route/' + encodeURIComponent(profile), {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                coordinates: [[a.lon, a.lat], [b.lon, b.lat]],
                radius: GPX_EDIT_ORS_RADIUS_M
            })
        });
        if (!resp.ok) throw new Error('route ' + resp.status);
        const gj = await resp.json();
        const coords = gj && gj.features && gj.features[0] &&
            gj.features[0].geometry && gj.features[0].geometry.coordinates;
        if (!Array.isArray(coords) || coords.length < 2) throw new Error('empty route');
        return coords.map(c => ({
            lat: c[1],
            lon: c[0],
            ele: c.length > 2 && isFinite(c[2]) ? Math.round(c[2]) : null
        }));
    } catch (e) {
        statusDiv.textContent = t.status_gpx_edit_route_failed ||
            'Routing failed — a straight line was used.';
        return null;   // caller falls back to freehand
    }
}

// Straight line between two handles, densified so the elevation profile, gain/loss and
// slope colouring keep working across hand-drawn stretches instead of flatlining.
async function _gpxEditFreehandInterior(a, b) {
    const distM = haversineDistance(a.lat, a.lon, b.lat, b.lon);
    const n = Math.min(GPX_EDIT_FREEHAND_MAX_POINTS,
        Math.max(0, Math.floor(distM / GPX_EDIT_FREEHAND_SPACING_M) - 1));
    if (n <= 0) return [];

    const mid = [];
    for (let i = 1; i <= n; i++) {
        const f = i / (n + 1);
        mid.push({
            lat: a.lat + f * (b.lat - a.lat),
            lon: a.lon + f * (b.lon - a.lon),
            ele: null
        });
    }
    // The samples cluster in a handful of DEM tiles, which the existing LRU caches.
    const eles = await Promise.all(mid.map(p => _gpxEditElevationAt(p.lat, p.lon)));
    mid.forEach((p, i) => { p.ele = eles[i]; });
    return mid;
}

async function _gpxEditElevationAt(lat, lon) {
    try {
        const ele = await getElevationAtLatLng(lat, lon);
        return (ele === null || ele === undefined || !isFinite(ele)) ? null : Math.round(ele);
    } catch (e) {
        return null;
    }
}

// --- The splice primitive -----------------------------------------------------------

// Replaces the interior of the sub-segment between handles ai and ai+1, then shifts every
// later handle by the change in interior length. This is the only place point counts and
// handle indices change, which is what keeps the two in step everywhere else.
async function _gpxEditSpliceBetween(ai) {
    const st = gpxEditState;
    const A = st.handles[ai], B = st.handles[ai + 1];
    if (!A || !B) return { snappedA: null, snappedB: null };

    const startPt = st.points[A.idx], endPt = st.points[B.idx];
    let mid = null, snappedA = null, snappedB = null;

    if (st.snap && routingAvailable) {
        const routed = await requestOrsRoute(startPt, endPt, st.profile);
        if (routed && routed.length >= 2) {
            // The backend widens the snap radius when nothing routable is nearby, so a
            // "successful" route can be matched to ways hundreds of metres away — in
            // sparse mountain terrain, typically a road down in the valley. Splicing that
            // in replaces the segment with a detour to somewhere the user never went,
            // which is strictly worse than the straight line. Check both echoed endpoints
            // and reject the whole route if either drifted too far.
            const driftA = haversineDistance(startPt.lat, startPt.lon, routed[0].lat, routed[0].lon);
            const last = routed[routed.length - 1];
            const driftB = haversineDistance(endPt.lat, endPt.lon, last.lat, last.lon);
            if (driftA <= GPX_EDIT_SNAP_MAX_DRIFT_M && driftB <= GPX_EDIT_SNAP_MAX_DRIFT_M) {
                mid = routed.slice(1, -1);   // ORS echoes both endpoints; keep the interior
                snappedA = routed[0];
                snappedB = last;
            } else {
                const t = translations[currentLang];
                statusDiv.textContent = t.status_gpx_edit_route_failed ||
                    'Routing failed — a straight line was used.';
            }
        }
    }
    if (mid === null) mid = await _gpxEditFreehandInterior(startPt, endPt);

    const removed = B.idx - A.idx - 1;
    st.points.splice(A.idx + 1, removed, ...mid);

    // A sits at or below the splice start and is unaffected; B and everything after it
    // move by exactly the change in interior length.
    const delta = mid.length - removed;
    for (let j = ai + 1; j < st.handles.length; j++) st.handles[j].idx += delta;

    return { snappedA, snappedB };
}

// Re-routes both sides of handle k. Right side first: it only touches indices above the
// handle, leaving the left range valid until its own splice accounts for the shift.
//
// Only the dragged handle adopts the routed endpoint — moving a handle the user did not
// touch is far more surprising than the <= 50 m connector this can leave at a neighbour
// that is itself off-network.
async function _gpxEditRebuildAround(k) {
    const st = gpxEditState;
    const h = st.handles[k];
    let snapped = null;

    if (k < st.handles.length - 1) {
        const r = await _gpxEditSpliceBetween(k);
        if (r.snappedA) snapped = r.snappedA;
    }
    if (k > 0) {
        const r = await _gpxEditSpliceBetween(k - 1);
        if (r.snappedB && !snapped) snapped = r.snappedB;
    }
    // Adopt the routed endpoint only when it is close. The backend widens the snap radius
    // when nothing routable is nearby, so in sparse terrain `snapped` can be hundreds of
    // metres away — moving the handle there would yank it out from under the cursor and
    // silently relocate a point the user placed deliberately. Beyond the threshold the
    // routed geometry is still used; the handle keeps its position and the straight
    // connector to the route remains, exactly as it already does for neighbour handles.
    if (snapped) {
        const here = st.points[h.idx];
        const drift = haversineDistance(here.lat, here.lon, snapped.lat, snapped.lon);
        if (drift <= GPX_EDIT_SNAP_ADOPT_MAX_M) {
            here.lat = snapped.lat;
            here.lon = snapped.lon;
            here.ele = snapped.ele;
            if (h.marker) h.marker.setLngLat([snapped.lon, snapped.lat]);
        }
    }
}

// --- Dragging -----------------------------------------------------------------------

function _gpxEditSetHandlesDraggable(draggable) {
    for (const h of gpxEditState.handles) {
        if (h.marker) h.marker.setDraggable(draggable);
    }
}

function _gpxEditShowPreview() {
    const nativeMap = map._map;
    _gpxEditHidePreview();
    nativeMap.addSource(GPX_EDIT_PREVIEW_SOURCE_ID, {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] }
    });
    // No beforeId: appended on top, above the track that updateGpxTrackLine() re-raises.
    nativeMap.addLayer({
        id: GPX_EDIT_PREVIEW_LAYER_ID,
        type: 'line',
        source: GPX_EDIT_PREVIEW_SOURCE_ID,
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: {
            'line-color': '#7e57c2',
            'line-width': 3,
            'line-dasharray': [2, 2],
            'line-opacity': 0.9
        }
    });
}

function _gpxEditHidePreview() {
    const nativeMap = map._map;
    if (nativeMap.getLayer(GPX_EDIT_PREVIEW_LAYER_ID)) {
        nativeMap.removeLayer(GPX_EDIT_PREVIEW_LAYER_ID);
    }
    if (nativeMap.getSource(GPX_EDIT_PREVIEW_SOURCE_ID)) {
        nativeMap.removeSource(GPX_EDIT_PREVIEW_SOURCE_ID);
    }
}

function _gpxEditUpdatePreview(k) {
    const st = gpxEditState;
    const nativeMap = map._map;
    const source = nativeMap.getSource(GPX_EDIT_PREVIEW_SOURCE_ID);
    if (!source) return;

    const h = st.handles[k];
    const at = h.marker.getLngLat();
    const features = [];
    const line = (a, b) => ({
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: [a, b] },
        properties: {}
    });
    if (k > 0) {
        const prev = st.points[st.handles[k - 1].idx];
        features.push(line([prev.lon, prev.lat], [at.lng, at.lat]));
    }
    if (k < st.handles.length - 1) {
        const next = st.points[st.handles[k + 1].idx];
        features.push(line([at.lng, at.lat], [next.lon, next.lat]));
    }
    source.setData({ type: 'FeatureCollection', features });
}

function _gpxEditOnDragStart(id) {
    const st = gpxEditState;
    if (!st) return;
    const k = _gpxEditIndexOfId(id);
    if (k < 0) return;

    st.dragging = { handleId: id, rafId: null };
    if (st.handles[k].el) st.handles[k].el.classList.add('dragging');
    _gpxEditShowPreview();
    _gpxEditUpdatePreview(k);
}

function _gpxEditOnDrag(id) {
    const st = gpxEditState;
    if (!st || !st.dragging || st.dragging.handleId !== id) return;
    // Coalesce to one preview update per frame; MapLibre fires drag far more often.
    if (st.dragging.rafId !== null) return;
    st.dragging.rafId = requestAnimationFrame(() => {
        if (!st.dragging) return;
        st.dragging.rafId = null;
        const k = _gpxEditIndexOfId(id);
        if (k >= 0) _gpxEditUpdatePreview(k);
    });
}

async function _gpxEditOnDragEnd(id) {
    const st = gpxEditState;
    const t = translations[currentLang];
    if (!st) return;
    const k = _gpxEditIndexOfId(id);
    if (k < 0) return;

    if (st.dragging && st.dragging.rafId !== null) cancelAnimationFrame(st.dragging.rafId);
    st.dragging = null;
    if (st.handles[k].el) st.handles[k].el.classList.remove('dragging');
    _gpxEditHidePreview();

    _gpxEditPushUndo();

    const h = st.handles[k];
    const at = h.marker.getLngLat();
    st.points[h.idx].lat = at.lat;
    st.points[h.idx].lon = at.lng;
    st.points[h.idx].ele = null;

    st.busy = true;
    _gpxEditSetHandlesDraggable(false);
    _updateGpxEditUI();
    statusDiv.textContent = t.status_gpx_edit_routing || 'Calculating route…';

    try {
        await _gpxEditRebuildAround(k);
        if (st.points[h.idx].ele === null) {
            st.points[h.idx].ele = await _gpxEditElevationAt(st.points[h.idx].lat, st.points[h.idx].lon);
        }
    } finally {
        // Without the finally an error here would leave every handle frozen and Save
        // permanently disabled.
        st.busy = false;
        _gpxEditSetHandlesDraggable(true);
    }

    _gpxEditAssertInvariants();
    _gpxEditRefreshRender();
    _updateGpxEditUI();
    if (statusDiv.textContent === (t.status_gpx_edit_routing || 'Calculating route…')) {
        statusDiv.textContent = t.status_gpx_edit_active ||
            'Edit mode — drag handles, click the track to add one.';
    }
}

// --- Undo / redo --------------------------------------------------------------------

// Full snapshots rather than inverse commands: a re-route swaps one variable-length slice
// for another, so an inverse would have to store the removed slice verbatim anyway — the
// same bytes with far more invariant surface to get wrong. Markers are never snapshotted;
// they are rebuilt from the indices, which rules out stale-marker bugs entirely.
function _gpxEditSnapshot() {
    const st = gpxEditState;
    return {
        points: st.points.map(p => ({ lat: p.lat, lon: p.lon, ele: p.ele })),
        handleIdx: st.handles.map(h => h.idx)
    };
}

function _gpxEditPushUndo() {
    const st = gpxEditState;
    const snap = _gpxEditSnapshot();
    st.undo.push(snap);
    st.undoPointCount += snap.points.length;
    st.redo = [];
    while (st.undo.length > GPX_EDIT_UNDO_MAX ||
        (st.undo.length > 1 && st.undoPointCount > GPX_EDIT_UNDO_MAX_POINTS)) {
        st.undoPointCount -= st.undo.shift().points.length;
    }
}

// Drops the snapshot taken for a mutation that turned out to be a no-op.
function _gpxEditPopUndoNoop() {
    const st = gpxEditState;
    const snap = st.undo.pop();
    if (snap) st.undoPointCount -= snap.points.length;
}

function _gpxEditApplySnapshot(snap) {
    const st = gpxEditState;
    st.points = snap.points.map(p => ({ lat: p.lat, lon: p.lon, ele: p.ele }));
    gpxTrackData.segments[st.segIndex] = st.points;

    for (const h of st.handles) if (h.marker) h.marker.remove();
    st.handles = [];
    for (const idx of snap.handleIdx) _gpxEditAddHandleAtIndex(idx);

    _gpxEditAssertInvariants();
    _gpxEditRefreshRender();
    _updateGpxEditUI();
}

window.gpxEditUndo = function () {
    const st = gpxEditState;
    if (!st || st.busy || !st.undo.length) return;
    const current = _gpxEditSnapshot();
    st.redo.push(current);
    const snap = st.undo.pop();
    st.undoPointCount -= snap.points.length;
    _gpxEditApplySnapshot(snap);
};

window.gpxEditRedo = function () {
    const st = gpxEditState;
    if (!st || st.busy || !st.redo.length) return;
    const current = _gpxEditSnapshot();
    st.undo.push(current);
    st.undoPointCount += current.points.length;
    _gpxEditApplySnapshot(st.redo.pop());
};

// --- Panel controls -----------------------------------------------------------------

window.setGpxEditSnap = function (enabled) {
    if (!gpxEditState) return;
    // Affects the next drag only; existing geometry is left as the user shaped it.
    gpxEditState.snap = !!enabled && routingAvailable;
    routingPrefs.snap = gpxEditState.snap;
    const box = document.getElementById('gpxEditSnap');
    if (box) box.checked = gpxEditState.snap;
};

window.setGpxEditProfile = function (profile) {
    if (!gpxEditState) return;
    if (GPX_EDIT_PROFILES.indexOf(profile) === -1) return;
    gpxEditState.profile = profile;
    routingPrefs.profile = profile;
};

// --- Save / cancel ------------------------------------------------------------------

window.saveGpxEdits = function () {
    const st = gpxEditState;
    const t = translations[currentLang];
    if (!st || st.busy) return;

    // The export stops being the user's original bytes from here on.
    if (!gpxTextIsGenerated) {
        const warning = t.gpx_edit_confirm_lossy ||
            'Saving rewrites the GPX from the edited geometry. Timestamps, sensor data and ' +
            'other extras from the original file will not be kept. Continue?';
        if (!window.confirm(warning)) return;
    }

    gpxTrackData.segments[st.segIndex] = st.points;
    Object.assign(gpxTrackData, computeTrackStats(gpxTrackData.segments));
    regenerateCurrentGpxText();
    // The stored copy behind ?gpx= is still the unedited original, so drop the share link
    // rather than handing out one that no longer matches what is on screen.
    setActiveGpxSource({ filename: currentGpxFilename || currentGpxRawFilename });

    _gpxEditTeardown();
    rebuildGpxLayer();
    _updateRouteInfoPanel();
    showElevationProfile();
    statusDiv.textContent = t.status_gpx_edit_saved ||
        'Track edits saved. Download GPX now exports the edited track.';
};

window.cancelGpxEditMode = function () {
    const st = gpxEditState;
    const t = translations[currentLang];
    if (!st || st.busy) return;
    if (st.undo.length > 0) {
        const msg = t.gpx_edit_confirm_discard || 'Discard unsaved track edits?';
        if (!window.confirm(msg)) return;
    }

    gpxTrackData.segments[st.segIndex] = st.original;
    Object.assign(gpxTrackData, computeTrackStats(gpxTrackData.segments));

    _gpxEditTeardown();
    rebuildGpxLayer();
    _updateRouteInfoPanel();
    showElevationProfile();
    statusDiv.textContent = t.status_gpx_edit_cancelled ||
        'Editing cancelled — the track was restored.';
};

// Leaves edit mode without prompting or restoring — for paths that are about to replace
// or destroy gpxTrackData anyway (clear, load another track).
function _gpxEditForceExit() {
    if (!gpxEditMode) return;
    _gpxEditTeardown();
}

function _gpxEditTeardown() {
    const st = gpxEditState;
    if (st) {
        if (st.dragging && st.dragging.rafId !== null) cancelAnimationFrame(st.dragging.rafId);
        for (const h of st.handles) if (h.marker) h.marker.remove();
        if (st.prevColorBySlope) {
            const slopeBox = document.getElementById('gpxColorBySlope');
            if (slopeBox) slopeBox.checked = true;
        }
    }
    _gpxEditHidePreview();
    if (_gpxEditRenderDebounce) {
        clearTimeout(_gpxEditRenderDebounce);
        _gpxEditRenderDebounce = null;
    }

    gpxEditMode = false;
    gpxEditState = null;

    const btn = document.getElementById('gpx-edit-btn');
    if (btn) btn.classList.remove('active');
    const panel = document.getElementById('gpx-edit-panel');
    if (panel) panel.style.display = 'none';
    const mapEl = document.getElementById('map');
    if (mapEl) mapEl.classList.remove('gpx-edit-active');
    _updateGpxEditUI();
    // gpxEditMode is false by now, so this drops the panel back to read-only.
    _updateRouteInfoPanel();
}

// --- Rendering & UI -----------------------------------------------------------------

// Redraws the line immediately (one cheap setData) and debounces the expensive stats,
// info panel and elevation profile. Deliberately not rebuildGpxLayer(), which would tear
// down and recreate every waypoint/km/min-max marker on each drag; that runs only on
// save/cancel. Km labels are therefore stale until then.
function _gpxEditRefreshRender() {
    updateGpxTrackLine();
    if (_gpxEditRenderDebounce) clearTimeout(_gpxEditRenderDebounce);
    _gpxEditRenderDebounce = setTimeout(() => {
        _gpxEditRenderDebounce = null;
        if (!gpxTrackData) return;
        Object.assign(gpxTrackData, computeTrackStats(gpxTrackData.segments));
        _updateRouteInfoPanel();
        if (getGpxShowElevProfile()) showElevationProfile();
    }, 300);
}

// Runs on every language switch too, long before any track exists — every lookup is
// defensive and a null gpxEditState is a normal state, not an error.
function _updateGpxEditUI() {
    const t = translations[currentLang];
    const st = gpxEditState;

    const editLabel = document.querySelector('#gpx-edit-btn .btn-label');
    if (editLabel) editLabel.textContent = t.btn_gpx_edit || 'Edit track';
    const hint = document.getElementById('gpx-edit-hint');
    if (hint) hint.textContent = t.gpx_edit_hint || '';
    const profileLabel = document.getElementById('lbl-gpx-edit-profile');
    if (profileLabel) profileLabel.textContent = t.lbl_gpx_edit_profile || 'Routing profile:';
    const snapLabel = document.getElementById('lbl-gpx-edit-snap');
    if (snapLabel) snapLabel.textContent = t.lbl_gpx_edit_snap || 'Snap to route';

    const profileSel = document.getElementById('gpxEditProfile');
    if (profileSel) {
        const optionKeys = {
            'foot-hiking': 'gpx_edit_profile_run',
            'cycling-mountain': 'gpx_edit_profile_mtb'
        };
        for (const value of GPX_EDIT_PROFILES) {
            const opt = profileSel.querySelector('option[value="' + value + '"]');
            if (opt && t[optionKeys[value]]) opt.textContent = t[optionKeys[value]];
        }
    }

    const save = document.getElementById('gpx-edit-save-btn');
    if (save) {
        save.textContent = t.btn_gpx_edit_save || 'Save';
        save.disabled = !st || st.busy;
    }
    [['gpx-edit-undo-btn', 'btn_gpx_edit_undo'],
    ['gpx-edit-redo-btn', 'btn_gpx_edit_redo'],
    ['gpx-edit-cancel-btn', 'btn_gpx_edit_cancel']].forEach(([id, key]) => {
        const el = document.getElementById(id);
        if (el && t[key]) { el.title = t[key]; el.setAttribute('aria-label', t[key]); }
    });

    const undoBtn = document.getElementById('gpx-edit-undo-btn');
    if (undoBtn) undoBtn.disabled = !st || st.busy || !st.undo.length;
    const redoBtn = document.getElementById('gpx-edit-redo-btn');
    if (redoBtn) redoBtn.disabled = !st || st.busy || !st.redo.length;

    // Snapping needs the backend proxy; without it the checkbox is off and locked, and
    // editing silently becomes freehand.
    const snapBox = document.getElementById('gpxEditSnap');
    if (snapBox) {
        snapBox.disabled = !routingAvailable;
        if (!routingAvailable) snapBox.checked = false;
    }

    const count = document.getElementById('gpx-edit-count');
    if (count) {
        count.textContent = st
            ? (t.gpx_edit_count || '{n} handles').replace('{n}', st.handles.length)
            : '';
    }
}

// Logs rather than throws: a broken invariant should surface in the console during
// development without taking the app down for a user mid-edit.
function _gpxEditAssertInvariants() {
    try {
        const st = gpxEditState;
        if (!st) return;
        const n = st.points.length;
        const problems = [];
        if (st.handles.length < GPX_EDIT_MIN_HANDLES) problems.push('too few handles');
        if (st.handles[0] && st.handles[0].idx !== 0) problems.push('first handle not at 0');
        if (st.handles.length && st.handles[st.handles.length - 1].idx !== n - 1) {
            problems.push('last handle not at end');
        }
        for (let i = 0; i < st.handles.length; i++) {
            const idx = st.handles[i].idx;
            if (idx < 0 || idx >= n) problems.push('handle ' + i + ' index out of range');
            if (i > 0 && idx <= st.handles[i - 1].idx) problems.push('handles not ascending at ' + i);
        }
        if (problems.length) console.warn('[gpx-edit] invariant broken:', problems.join(', '));
    } catch (e) {
        /* never let a diagnostic break editing */
    }
}

// ==========================================
// 5e. CREATE ROUTE
// ==========================================
//
// Two map clicks — a start and an end — become a routed track that is handed straight to
// the track editor. Everything about the geometry is borrowed from section 5d: the same ORS
// request, the same drift/adopt thresholds, the same freehand fallback. That is the point —
// a created route and an edited one must be made of the same stuff, or the first drag after
// creation would behave differently from every drag after it.
//
// Nothing is committed until the second click resolves: cancelling at any moment, even
// mid-request, leaves the map exactly as it was.

window.toggleRouteCreateMode = function () {
    routeCreateMode ? cancelRouteCreation() : enterRouteCreateMode();
};

function enterRouteCreateMode() {
    const t = translations[currentLang];
    // Refuse rather than exit track editing for it — those edits are unsaved. Same stance
    // as POI placement and Manual mode.
    if (gpxEditMode) {
        statusDiv.textContent = t.status_gpx_edit_busy ||
            'Finish or cancel track editing first.';
        return;
    }
    // A created route replaces the loaded one outright (applyParsedGpxData installs a single
    // segment, and the fresh editor session starts with an empty undo stack). Ask before the
    // user starts clicking rather than after, so the answer costs nothing to give.
    if (gpxTrackData) {
        const warning = t.route_create_confirm_replace ||
            'Creating a route replaces the track currently on the map. Continue?';
        if (!window.confirm(warning)) return;
    }
    // Nothing is lost by dropping these — neither has committed anything yet.
    if (poiPlacementMode) cancelPoiPlacement();
    if (manualClimbMode) cancelManualClimbMode();

    routeCreateMode = true;
    routeCreateState = { start: null, marker: null, busy: false };

    // On a phone the expanded panel covers most of the map, so both clicks would have to
    // land in the strip below it. Fold it away like the POI modal does; the step prompt
    // lives in the status line, which sits outside #controls-content and stays visible.
    //
    // Deliberately never unfolded again: the route's metrics and its Save/Cancel now live in
    // the floating route panel, so there is nothing left in the control panel that finishing
    // a route requires. Springing it back open would only bury the route just drawn.
    if (window.innerWidth <= 600 && !isControlsMinimized) {
        setControlsMinimized(true);
    }

    const btn = document.getElementById('route-create-btn');
    if (btn) btn.classList.add('active');
    const panel = document.getElementById('route-create-panel');
    if (panel) panel.style.display = 'block';
    const mapEl = document.getElementById('map');
    if (mapEl) mapEl.classList.add('route-create-active');

    _updateRouteCreateUI();
    statusDiv.textContent = routingAvailable
        ? (t.status_route_create_start || 'Click the start point of your new route.')
        : (t.status_gpx_edit_route_unavailable ||
            'Snap to route needs the online backend; freehand editing is used.');
}

// Both clicks land here. The first records the start, the second routes to it.
async function handleRouteCreateMapClick(lat, lon) {
    const st = routeCreateState;
    const t = translations[currentLang];
    if (!st || st.busy) return;

    if (!st.start) {
        st.start = { lat, lon, ele: null };
        st.marker = _routeCreateStartMarker(lat, lon);
        _updateRouteCreateUI();
        statusDiv.textContent = t.status_route_create_end || 'Now click the end point.';
        return;
    }

    // Both guards run before any network call. The lower one uses the editor's click
    // tolerance converted to meters, so it scales with zoom and catches a second click that
    // landed on the start marker; the upper one is where a mis-click on a zoomed-out map
    // stops being a route request.
    const spanM = haversineDistance(st.start.lat, st.start.lon, lat, lon);
    const minSpanM = Math.max(ROUTE_CREATE_MIN_SPAN_M,
        GPX_EDIT_CLICK_TOLERANCE_PX * metersPerPixel());
    if (spanM < minSpanM) {
        statusDiv.textContent = t.status_route_create_too_close ||
            'That is the start point — click somewhere further away.';
        return;
    }
    if (spanM > ROUTE_CREATE_MAX_SPAN_M) {
        statusDiv.textContent = (t.status_route_create_too_far ||
            'Those points are {n} km apart — pick two that are closer together.')
            .replace('{n}', Math.round(spanM / 1000));
        return;
    }

    st.busy = true;
    _updateRouteCreateUI();
    statusDiv.textContent = t.status_gpx_edit_routing || 'Calculating route…';

    let points = null;
    try {
        points = await _routeCreateBuildPoints(st.start, { lat, lon, ele: null });
    } catch (e) {
        points = null;   // treated as a routing failure below
    }

    // The request can take a minute in the worst case (the backend retries two upstreams at
    // two radii, 20 s each), and Cancel deliberately works throughout. If the user used it —
    // or a ?gpx= link resolved and installed a track meanwhile — drop the result on the
    // floor rather than overwriting whatever they did instead.
    if (!routeCreateMode || routeCreateState !== st) return;
    st.busy = false;

    if (!points || points.length < 2) {
        _updateRouteCreateUI();
        statusDiv.textContent = t.status_route_create_failed ||
            'Could not build a route between those two points.';
        return;
    }

    _routeCreateTeardown();
    _routeCreateInstall(points);
}

// The geometry between the two clicked points. A deliberate mirror of
// _gpxEditSpliceBetween(): same request, same drift rejection, same adopt threshold, same
// freehand fallback — see the comments there for why each threshold exists.
async function _routeCreateBuildPoints(startPt, endPt) {
    let mid = null, a = startPt, b = endPt;

    if (routingPrefs.snap && routingAvailable) {
        const routed = await requestOrsRoute(startPt, endPt, routingPrefs.profile);
        if (routed && routed.length >= 2) {
            const last = routed[routed.length - 1];
            const driftA = haversineDistance(startPt.lat, startPt.lon, routed[0].lat, routed[0].lon);
            const driftB = haversineDistance(endPt.lat, endPt.lon, last.lat, last.lon);
            if (driftA <= GPX_EDIT_SNAP_MAX_DRIFT_M && driftB <= GPX_EDIT_SNAP_MAX_DRIFT_M) {
                mid = routed.slice(1, -1);   // ORS echoes both endpoints; keep the interior
                // Adopt a snapped endpoint only when it is close. There is no cursor to yank
                // away from here, but a start point a few hundred metres from where the user
                // pointed is still somewhere they did not choose; past the threshold the
                // routed middle is kept and a straight connector bridges the gap, exactly as
                // a drag leaves it.
                if (driftA <= GPX_EDIT_SNAP_ADOPT_MAX_M) a = routed[0];
                if (driftB <= GPX_EDIT_SNAP_ADOPT_MAX_M) b = last;
            } else {
                const t = translations[currentLang];
                statusDiv.textContent = t.status_gpx_edit_route_failed ||
                    'Routing failed — a straight line was used.';
            }
        }
    }
    if (mid === null) mid = await _gpxEditFreehandInterior(a, b);

    // ORS returns elevations, so an adopted endpoint already has one. A clicked endpoint
    // does not; sample it from the DEM tiles the app already caches, so gain/loss and the
    // elevation profile are not broken by two null-elevation ends.
    if (a.ele === null || a.ele === undefined) {
        a = { lat: a.lat, lon: a.lon, ele: await _gpxEditElevationAt(a.lat, a.lon) };
    }
    if (b.ele === null || b.ele === undefined) {
        b = { lat: b.lat, lon: b.lon, ele: await _gpxEditElevationAt(b.lat, b.lon) };
    }

    return [a, ...mid, b];
}

// Hands the finished geometry to the normal "a route was loaded" path, then straight into
// the editor. Going through applyParsedGpxData() rather than assembling gpxTrackData here is
// deliberate: it is the one place that drops a stale ?gpx= share link, resets the download
// text, reveals the Clear/Edit/Download row and redraws the info panel and the elevation
// profile. A second copy of that would drift.
function _routeCreateInstall(points) {
    const t = translations[currentLang];
    applyParsedGpxData({
        segments: [points],
        waypoints: [],
        totalPoints: points.length,
        stats: computeTrackStats([points])
    }, {
        // The user is looking at the two points they just clicked; refitting would move the
        // map out from under them.
        skipFitBounds: true
    });
    // applyParsedGpxData leaves currentGpxRawText null (there was no file) and marks the text
    // as the user's own bytes. Serializing now makes Download GPX work immediately and keeps
    // saveGpxEdits() from warning about losing extras of a file that never existed.
    regenerateCurrentGpxText();

    // Straight into the editor: the whole point of the two clicks is to get something worth
    // shaping, and the seeded start/middle/end handles are where the user reaches next.
    enterGpxEditMode({
        statusMessage: (t.status_route_create_done ||
            'Route created ({n} points) — drag the handles to reshape it, then Save.')
            .replace('{n}', points.length)
    });
}

// The placed start point, drawn as the editor's endpoint handle so it already looks like the
// handle it is about to become. Not draggable, and pointer-events:none in the CSS so it
// cannot swallow a second click that lands on top of it.
function _routeCreateStartMarker(lat, lon) {
    const el = document.createElement('div');
    el.className = 'gpx-edit-handle endpoint route-create-start';
    return new maplibregl.Marker({ element: el, anchor: 'center' })
        .setLngLat([lon, lat])
        .addTo(map._map);
}

window.setRouteCreateProfile = function (profile) {
    if (GPX_EDIT_PROFILES.indexOf(profile) === -1) return;
    routingPrefs.profile = profile;
};

window.setRouteCreateSnap = function (enabled) {
    routingPrefs.snap = !!enabled && routingAvailable;
    const box = document.getElementById('routeCreateSnap');
    if (box) box.checked = routingPrefs.snap;
};

window.cancelRouteCreation = function () {
    const t = translations[currentLang];
    if (!routeCreateMode) return;
    // No confirm, unlike cancelGpxEditMode: nothing has been committed, so there is no
    // geometry to restore and nothing to lose. Allowed while busy on purpose — the routing
    // request has no client-side timeout and the backend can spend the better part of a
    // minute on it; refusing here would lock the user in.
    _routeCreateTeardown();
    statusDiv.textContent = t.status_ready || 'Ready.';
};

// Leaves create mode without a status message — for the paths that are about to install or
// destroy a track anyway (Clear Route, another GPX loading, entering the editor).
function _routeCreateForceExit() {
    if (!routeCreateMode) return;
    _routeCreateTeardown();
}

function _routeCreateTeardown() {
    const st = routeCreateState;
    if (st && st.marker) st.marker.remove();
    routeCreateMode = false;
    routeCreateState = null;

    const btn = document.getElementById('route-create-btn');
    if (btn) btn.classList.remove('active');
    const panel = document.getElementById('route-create-panel');
    if (panel) panel.style.display = 'none';
    const mapEl = document.getElementById('map');
    if (mapEl) mapEl.classList.remove('route-create-active');
    _updateRouteCreateUI();
}

// Runs on every language switch too, long before the button is ever pressed — every lookup
// is defensive and a null routeCreateState is a normal state, not an error.
function _updateRouteCreateUI() {
    const t = translations[currentLang];
    const st = routeCreateState;

    const btnLabel = document.querySelector('#route-create-btn .btn-label');
    if (btnLabel) btnLabel.textContent = t.btn_route_create || 'Create Route';
    const hint = document.getElementById('route-create-hint');
    if (hint) hint.textContent = t.route_create_hint || '';
    const profileLabel = document.getElementById('lbl-route-create-profile');
    if (profileLabel) profileLabel.textContent = t.lbl_gpx_edit_profile || 'Routing profile:';
    const snapLabel = document.getElementById('lbl-route-create-snap');
    if (snapLabel) snapLabel.textContent = t.lbl_gpx_edit_snap || 'Snap to roads/paths';
    const cancelLabel = document.querySelector('#route-create-cancel-btn .btn-label');
    if (cancelLabel) cancelLabel.textContent = t.btn_cancel || 'Cancel';

    const profileSel = document.getElementById('routeCreateProfile');
    if (profileSel) {
        const optionKeys = {
            'foot-hiking': 'gpx_edit_profile_run',
            'cycling-mountain': 'gpx_edit_profile_mtb'
        };
        for (const value of GPX_EDIT_PROFILES) {
            const opt = profileSel.querySelector('option[value="' + value + '"]');
            if (opt && t[optionKeys[value]]) opt.textContent = t[optionKeys[value]];
        }
        // Re-read the shared prefs rather than trusting the DOM: the editor's own picker
        // writes the same setting, and either panel may have been the last to change it.
        profileSel.value = routingPrefs.profile;
        profileSel.disabled = !!(st && st.busy);
    }

    // Snapping needs the backend proxy; without it the box is off and locked and the route
    // becomes a straight line, exactly as in the editor.
    const snapBox = document.getElementById('routeCreateSnap');
    if (snapBox) {
        snapBox.disabled = !routingAvailable || !!(st && st.busy);
        snapBox.checked = routingAvailable && routingPrefs.snap;
    }

    // The step prompt is duplicated here because the status line is the only copy visible
    // while the panel is folded away on mobile, and the panel is the only copy visible once
    // some other action has overwritten the status line.
    const step = document.getElementById('route-create-step');
    if (step) {
        step.textContent = !st ? ''
            : st.busy ? (t.status_gpx_edit_routing || 'Calculating route…')
                : !st.start ? (t.step_route_create_start || 'Click the start point.')
                    : (t.step_route_create_end || 'Click the end point.');
    }
}

// ==========================================
// 5f. ROUTE INFO PANEL
// ==========================================
//
// The route's metrics and its edit actions, floating over the map rather than living in the
// control panel. Editing needs both the actions and the map at once, which the control panel
// cannot give you on a phone — it is a full-width sheet, so reaching Save meant covering the
// track you were shaping.
//
// Two things make this simpler than it looks:
//   1. Every state is derivable from `gpxTrackData` and `gpxEditMode`, so one function reads
//      those and sets the whole panel. There is no third piece of state to keep in sync, and
//      no per-caller display juggling like the old #gpx-track-info had.
//   2. The layout switch (bottom sheet under 600px, top-left card above) is pure CSS. On
//      desktop the panel is position:fixed, which also lifts it out of #bottom-dock's flex
//      flow — so getBottomDockHeight() excludes it without being told to.
//
// Button labels and disabled states still come from _updateGpxEditUI(); it addresses them by
// id and the ids did not change when the markup moved. Only visibility is decided here.

let routeInfoMinimized = false;

const ROUTE_INFO_HEADLINE_PX = 11;      // matches .elevation-profile-label
const ROUTE_INFO_HEADLINE_MIN_PX = 9;   // below this the name ellipsizes instead

// The loaded track's name for display, or null when there isn't one.
//
// Strips only the .gpx extension — deliberately not sanitizeGpxFilename(), which also
// rewrites filesystem-invalid characters to underscores. That is correct for a download
// filename and wrong for a label: it would render "Trail: North" as "Trail_ North".
//
// Two cases legitimately have no name. A route built by Create Route never had a file, and a
// cold ?gpx= share link sets both name globals to the opaque backend id — printing that would
// be worse than printing nothing.
function currentGpxDisplayName() {
    const name = currentGpxFilename || currentGpxRawFilename;
    if (!name || name === currentSharedGpxId) return null;
    return String(name).replace(/\.gpx$/i, '').trim() || null;
}

// Shrink the header text just enough to fit one line. A long track name plus the length can
// overrun the strip on a phone, and the sheet's height is fixed by design — so width is the
// only axis left to give.
//
// One proportional step rather than a stepping loop: the text is a single unwrapped line, so
// its width scales very nearly linearly with font size, and every attempt costs a forced
// layout. Past the floor the CSS ellipsis on #route-info-name takes over, which truncates the
// label and leaves "Route info" and the distance whole.
function _fitRouteInfoHeadline() {
    const el = document.getElementById('route-info-headline');
    const nameEl = document.getElementById('route-info-name');
    if (!el) return;
    el.style.fontSize = '';
    // A hidden panel measures 0 wide; scaling against that would floor the size for the next
    // time it is shown.
    if (!el.clientWidth) return;

    // The headline's own scrollWidth cannot be trusted to report the overflow: the name
    // ellipsizes itself first, so the row always "fits" and the shortfall hides inside the
    // truncated child. What the name had to give up is therefore part of the measurement.
    const clipped = nameEl ? nameEl.scrollWidth - nameEl.clientWidth : 0;
    const overflow = Math.max(el.scrollWidth - el.clientWidth, clipped);
    // 1px of slack: scrollWidth rounds up, and a sub-pixel difference is not real overflow.
    if (overflow <= 1) return;

    const natural = el.clientWidth + overflow;
    const scaled = Math.floor(ROUTE_INFO_HEADLINE_PX * el.clientWidth / natural);
    el.style.fontSize = Math.max(ROUTE_INFO_HEADLINE_MIN_PX, scaled) + 'px';
}

window.toggleRouteInfoPanel = function () {
    const panel = document.getElementById('route-info-panel');
    if (!panel) return;
    routeInfoMinimized = !routeInfoMinimized;
    panel.classList.toggle('minimized', routeInfoMinimized);
    _updateRouteInfoUI();
    // Fires before the 0.3s transition has moved anything; the ResizeObserver on #bottom-dock
    // corrects the offsets as it animates. Same arrangement as toggleElevationProfile().
    adjustMapControlsForElevation();
};

// The single source of truth for the panel: what exists, and which of it is actionable.
function _updateRouteInfoPanel() {
    const panel = document.getElementById('route-info-panel');
    if (!panel) return;

    // No track, nothing to report. Hiding rather than emptying keeps the dock's measured
    // height at zero, which is what drops the map controls back to their CSS defaults.
    if (!gpxTrackData) {
        panel.style.display = 'none';
        adjustMapControlsForElevation();
        return;
    }

    panel.style.display = '';
    _renderRouteStats();

    // Which route this is. Both slots are always written; CSS decides whether the length is
    // shown here (mobile) or as the first stat row (desktop).
    const nameEl = document.getElementById('route-info-name');
    if (nameEl) {
        const name = currentGpxDisplayName();
        nameEl.textContent = name ? '(' + name + ')' : '';
    }
    const headlineLength = document.getElementById('route-info-headline-length');
    if (headlineLength) headlineLength.textContent = formatDistance(gpxTrackData.length);

    // Read-only unless editing: a loaded track has nothing to undo, save or cancel, and
    // showing four dead buttons reads as broken rather than as "not applicable".
    const actions = document.getElementById('route-info-actions');
    if (actions) actions.style.display = gpxEditMode ? 'flex' : 'none';

    _updateRouteInfoUI();
    _fitRouteInfoHeadline();
    adjustMapControlsForElevation();
}

// One row per stat on desktop, a single scrolling line of abbreviations on a phone.
//
// Both label forms are emitted for every stat and the media query picks one, rather than
// re-rendering on resize: "Elevation Gain: +10510 m" is three times the width of
// "Gain: +10510 m" and will not fit a phone, while the abbreviations are needlessly terse on
// a 300px card that has the room. Length is emitted too but hidden on mobile, where it is
// promoted into the header instead.
//
// The conditionals match what the metrics block always did — a GPX with no elevation data
// gets a Length row and nothing else, rather than a column of nulls.
function _renderRouteStats() {
    const statsEl = document.getElementById('route-info-stats');
    if (!statsEl || !gpxTrackData) return;
    const t = translations[currentLang];
    const d = gpxTrackData;

    const rows = [['length', t.route_info_length || 'Length', t.gpx_info_length, formatDistance(d.length)]];
    if (d.gain > 0 || d.loss > 0) {
        rows.push(['gain', t.route_info_gain || 'Gain', t.gpx_info_gain, '+' + formatElevation(d.gain)]);
        rows.push(['loss', t.route_info_loss || 'Loss', t.gpx_info_loss, '-' + formatElevation(d.loss)]);
    }
    if (d.minElev !== null) {
        rows.push(['min', t.route_info_min || 'Min', t.gpx_info_min_elev, formatElevation(d.minElev)]);
        rows.push(['max', t.route_info_max || 'Max', t.gpx_info_max_elev, formatElevation(d.maxElev)]);
    }

    // textContent per cell rather than one innerHTML string: the values are formatted
    // numbers, but the labels come from the translation files and should never be parsed
    // as markup.
    statsEl.textContent = '';
    for (const [key, short, full, value] of rows) {
        const stat = document.createElement('div');
        // is-length is what lets the mobile rule hide this row once the header carries it.
        stat.className = 'route-stat' + (key === 'length' ? ' is-length' : '');
        // Redundant on desktop, where the full label is on screen — but on mobile the
        // abbreviation is all that shows, and this is what spells it out.
        if (full) stat.title = full;
        const labelEl = document.createElement('span');
        labelEl.className = 'route-stat-label';
        const fullEl = document.createElement('span');
        fullEl.className = 'lbl-full';
        fullEl.textContent = (full || short) + ':';
        const shortEl = document.createElement('span');
        shortEl.className = 'lbl-short';
        shortEl.textContent = short + ':';
        labelEl.appendChild(fullEl);
        labelEl.appendChild(shortEl);
        const valueEl = document.createElement('span');
        valueEl.className = 'route-stat-value';
        valueEl.textContent = value;
        stat.appendChild(labelEl);
        stat.appendChild(valueEl);
        statsEl.appendChild(stat);
    }
}

// Runs on every language switch too, long before any track exists — every lookup is
// defensive and a hidden panel is a normal state, not an error.
function _updateRouteInfoUI() {
    const t = translations[currentLang];

    const title = document.getElementById('route-info-title');
    if (title) title.textContent = t.route_info_title || 'Route info';

    const toggle = document.getElementById('route-info-toggle');
    if (toggle) {
        const label = routeInfoMinimized
            ? (t.route_info_expand || 'Expand route info')
            : (t.route_info_minimize || 'Minimize route info');
        toggle.title = label;
        toggle.setAttribute('aria-label', label);
        toggle.setAttribute('aria-expanded', String(!routeInfoMinimized));
    }
}

// ==========================================
// 6. START LOGIC (Event Listeners & Init)
// ==========================================

// Event Listeners
if (searchInput) searchInput.addEventListener("keypress", (e) => { if (e.key === "Enter") searchLocation(); });
if (radiusInput) radiusInput.addEventListener('input', () => { updateUI(); });
if (circleCheckbox) circleCheckbox.addEventListener('change', updateUI);
if (lockCheckbox) lockCheckbox.addEventListener('change', (e) => {
    isLocked = e.target.checked;
    if (isLocked) {
        lockedCenterCoords = map.getCenter();
    } else {
        lockedCenterCoords = null;
    }
    syncCrosshairVisibility();
    updateUI();
});
if (overzoomCheckbox) {
    overzoomCheckbox.checked = isOverzoomEnabled();
    overzoomCheckbox.addEventListener('change', (e) => {
        localStorage.setItem(OVERZOOM_STORAGE_KEY, e.target.checked);
        applyCurrentLayerMaxZoom();
    });
}
const showCrosshairCheckbox = document.getElementById('showCrosshair');
if (showCrosshairCheckbox) {
    showCrosshairCheckbox.checked = localStorage.getItem('topo_show_crosshair') !== 'false';
    showCrosshairCheckbox.addEventListener('change', (e) => {
        localStorage.setItem('topo_show_crosshair', e.target.checked);
        syncCrosshairVisibility();
    });
}
const crosshairColorSelect = document.getElementById('crosshairColor');
if (crosshairColorSelect) {
    const savedCrosshairColor = localStorage.getItem('topo_crosshair_color') || '#333333';
    crosshairColorSelect.value = savedCrosshairColor;
    applyCrosshairColor(savedCrosshairColor);
    crosshairColorSelect.addEventListener('change', (e) => {
        localStorage.setItem('topo_crosshair_color', e.target.value);
        applyCrosshairColor(e.target.value);
    });
}
syncCrosshairVisibility();

// Hillshade: the search-bar button toggles the layer; an optional on-map slider
// (enabled under Advanced settings) adjusts its opacity. All persist in localStorage.
syncHillshadeControls();
if (map) map.setHillshade(isHillshadeEnabled(), getHillshadeExaggeration());

const hillshadeSliderToggle = document.getElementById('enableHillshadeSlider');
if (hillshadeSliderToggle) {
    let sliderOn = false;
    try { sliderOn = localStorage.getItem(HILLSHADE_SLIDER_KEY) === 'true'; } catch (error) { /* storage unavailable */ }
    hillshadeSliderToggle.checked = sliderOn;
    hillshadeSliderToggle.addEventListener('change', (e) => {
        try { localStorage.setItem(HILLSHADE_SLIDER_KEY, e.target.checked); } catch (error) { /* storage unavailable */ }
        syncHillshadeSlider();
    });
}

const mapHillshadeOpacity = document.getElementById('mapHillshadeOpacity');
const mapHillshadeOpacityVal = document.getElementById('mapHillshadeOpacityVal');
if (mapHillshadeOpacity) {
    const hillshadePct = Math.round(getHillshadeExaggeration() * 100);
    mapHillshadeOpacity.value = hillshadePct;
    if (mapHillshadeOpacityVal) mapHillshadeOpacityVal.textContent = hillshadePct + '%';
    mapHillshadeOpacity.addEventListener('input', (e) => {
        const val = parseInt(e.target.value, 10);
        if (mapHillshadeOpacityVal) mapHillshadeOpacityVal.textContent = val + '%';
        try { localStorage.setItem(HILLSHADE_OPACITY_KEY, val); } catch (error) { /* storage unavailable */ }
        if (map) map.setHillshadeExaggeration(val / 100);
    });
}
syncHillshadeSlider();

// Contour overlay: one Advanced-settings checkbox toggles the client-side contour
// lines, a second toggles the elevation labels along the major contours. Both persist.
if (map) {
    map.setContourLabels(isContourLabelsEnabled());
    map.setContours(isContoursEnabled());
}

const contoursToggle = document.getElementById('enableContours');
if (contoursToggle) {
    contoursToggle.checked = isContoursEnabled();
    contoursToggle.addEventListener('change', (e) => {
        try { localStorage.setItem(CONTOURS_ENABLED_KEY, e.target.checked); } catch (error) { /* storage unavailable */ }
        if (map) map.setContours(e.target.checked);
    });
}

const contourLabelsToggle = document.getElementById('enableContourLabels');
if (contourLabelsToggle) {
    contourLabelsToggle.checked = isContourLabelsEnabled();
    contourLabelsToggle.addEventListener('change', (e) => {
        try { localStorage.setItem(CONTOUR_LABELS_KEY, e.target.checked); } catch (error) { /* storage unavailable */ }
        if (map) map.setContourLabels(e.target.checked);
    });
}

// Footer readout visibility toggles. Each persists a 'false' when unchecked and
// re-runs updateUI() so the badge shows/hides immediately.
[
    ['showZoom', SHOW_ZOOM_KEY, isZoomShown],
    ['showScale', SHOW_SCALE_KEY, isScaleShown],
    ['showCenterGps', SHOW_CENTER_GPS_KEY, isCenterGpsShown],
    ['showCoords', SHOW_COORDS_KEY, isCoordsShown],
].forEach(([id, key, isShown]) => {
    const cb = document.getElementById(id);
    if (!cb) return;
    cb.checked = isShown();
    cb.addEventListener('change', (e) => {
        try { localStorage.setItem(key, e.target.checked); } catch (error) { /* storage unavailable */ }
        updateUI();
    });
});

// Tapping the coordinate readout copies the current map-center coordinates.
const coordsBadge = document.getElementById('coords-level');
if (coordsBadge) {
    coordsBadge.addEventListener('click', () => {
        const t = translations[currentLang];
        const c = map.getCenter();
        copyTextToClipboard(
            c.lat.toFixed(5) + ', ' + c.lng.toFixed(5),
            t.status_coords_copied || 'Coordinates copied.',
            t.status_clipboard_error || 'Could not copy coordinates.'
        );
    });
}

const exaggerationSliderToggle = document.getElementById('enableExaggerationSlider');
if (exaggerationSliderToggle) {
    let exagSliderOn = false;
    try { exagSliderOn = localStorage.getItem(EXAGGERATION_SLIDER_KEY) === 'true'; } catch (error) { /* storage unavailable */ }
    exaggerationSliderToggle.checked = exagSliderOn;
    exaggerationSliderToggle.addEventListener('change', (e) => {
        try { localStorage.setItem(EXAGGERATION_SLIDER_KEY, e.target.checked); } catch (error) { /* storage unavailable */ }
        syncExaggerationSlider();
    });
}

const mapExaggeration = document.getElementById('mapExaggeration');
const mapExaggerationVal = document.getElementById('mapExaggerationVal');
if (mapExaggeration) {
    const exag = getTerrainExaggeration();
    mapExaggeration.value = exag;
    if (mapExaggerationVal) mapExaggerationVal.textContent = exag.toFixed(1) + '×';
    mapExaggeration.addEventListener('input', (e) => {
        const val = parseFloat(e.target.value);
        if (mapExaggerationVal) mapExaggerationVal.textContent = val.toFixed(1) + '×';
        try { localStorage.setItem(EXAGGERATION_VALUE_KEY, val); } catch (error) { /* storage unavailable */ }
        if (is3dEnabled() && map) map.setTerrain({ exaggeration: val });
    });
}
syncExaggerationSlider();

// Max tilt angle: bounds manual pitch gestures (map.maxPitch) and is the angle the
// Tilt/3D buttons ease to. While 3D is on, dragging it re-tilts the view live.
const maxPitchInput = document.getElementById('maxPitchInput');
const maxPitchVal = document.getElementById('maxPitchVal');
if (maxPitchInput) {
    const pitchCap = getMaxPitch();
    maxPitchInput.value = pitchCap;
    if (maxPitchVal) maxPitchVal.textContent = pitchCap + '°';
    maxPitchInput.addEventListener('input', (e) => {
        const val = Math.min(MAPLIBRE_MAX_PITCH, Math.max(0, parseInt(e.target.value, 10) || 0));
        if (maxPitchVal) maxPitchVal.textContent = val + '°';
        try { localStorage.setItem(MAX_PITCH_KEY, val); } catch (error) { /* storage unavailable */ }
        if (map) {
            map.setMaxPitch(val);
            if (is3dEnabled()) map.easeTo({ pitch: val, duration: 200 });
        }
    });
}

if (extraLayerSelect) {
    // Route names are always shown whenever an overlay is selected; the dropdown's
    // inline onchange (handleExtraLayerChange) drives all user-initiated changes.
    const savedExtra = localStorage.getItem(EXTRA_OVERLAY_STORAGE_KEY) || '';
    if (OVERLAY_SOURCES[savedExtra]) {
        extraLayerSelect.value = savedExtra;
        // The route-names legend applies only to the Waymarkedtrails overlays. (A saved
        // backend-only overlay like the Strava heatmap is reverted later in
        // initializeBackendFeatures() if no backend turns out to be present.)
        routeNamesOn = !!OVERLAY_WMT_ACTIVITY[savedExtra];
    } else {
        extraLayerSelect.value = 'none';
        routeNamesOn = false;
    }
    updateZoomControlVisibility();
}
if (tiltCheckbox) {
    tiltCheckbox.checked = true;
    tiltCheckbox.addEventListener('change', (e) => {
        setTiltEnabled(e.target.checked);
    });
}
if (enable3dBtn) {
    enable3dBtn.classList.remove('active');
}
setTiltEnabled(!(tiltCheckbox && tiltCheckbox.checked === false));
syncTerrainControls();

const waterToggle = document.getElementById('water-analysis-toggle');
if (waterToggle) {
    waterToggle.checked = waterAnalysisEnabled;
    waterToggle.addEventListener('change', (e) => {
        waterAnalysisEnabled = e.target.checked;
    });
}

const slopeFilterToggle = document.getElementById('slope-filter-toggle');
if (slopeFilterToggle) {
    slopeFilterToggle.addEventListener('change', (e) => {
        const minRow = document.getElementById('slope-filter-min-row');
        const maxRow = document.getElementById('slope-filter-max-row');
        if (minRow) minRow.style.display = e.target.checked ? '' : 'none';
        if (maxRow) maxRow.style.display = e.target.checked ? '' : 'none';
    });
}

const slopeOpacitySlider = document.getElementById('slopeOpacity');
const slopeOpacityVal = document.getElementById('slopeOpacityVal');
if (slopeOpacitySlider) {
    slopeOpacitySlider.addEventListener('input', (e) => {
        const val = parseInt(e.target.value);
        if (slopeOpacityVal) slopeOpacityVal.textContent = val + '%';
        if (slopeOverlay) slopeOverlay.setOpacity(val / 100);
    });
}

const stepInput = document.getElementById('stepSizeInput');
if (stepInput) {
    stepInput.value = climbStepDisplayValue();
    stepInput.addEventListener('change', () => {
        // Store the canonical meters value regardless of the displayed unit.
        climbStepRes = Math.round(getClimbStepMeters());
    });
}

const peakMinPixelInput = document.getElementById('peakMinPixelDistInput');
if (peakMinPixelInput) {
    peakMinPixelInput.value = peakMinPixelDistance;
    peakMinPixelInput.addEventListener('change', (e) => {
        peakMinPixelDistance = normalizePeakMinPixelDistance(e.target.value);
        e.target.value = peakMinPixelDistance;
        localStorage.setItem('topo_peak_min_pixel_dist', peakMinPixelDistance);
    });
}

const anglesInput = document.getElementById('scanAnglesInput');
if (anglesInput) {
    anglesInput.value = climbScanAngles;
    anglesInput.addEventListener('change', (e) => {
        climbScanAngles = parseInt(e.target.value) || 32;
    });
}

// Map Events
map.on('zoomend', () => { updateUI(); updateCenterElevation(); refreshGpxKmLabels(); });
// 'move' fires many times per frame during a pan; coalesce updateUI() to at most
// once per animation frame so panning stays smooth.
let _moveUiRafPending = false;
map.on('move', () => {
    if (_moveUiRafPending) return;
    _moveUiRafPending = true;
    requestAnimationFrame(() => {
        _moveUiRafPending = false;
        updateUI();
    });
});
map.on('moveend', () => { // Data saved/fetched at end of movement
    const center = map.getCenter();
    localStorage.setItem('topo_lat', center.lat);
    localStorage.setItem('topo_lng', center.lng);
    localStorage.setItem('topo_zoom', map.getZoom());
    updateCenterElevation();
    if (routeNamesOn) {
        // While the list is gated behind the min-zoom message, keep auto-updating so
        // zooming in loads the list without a manual refresh; once a list is shown,
        // movement only flags it stale (the green refresh button drives the update).
        if (routeLegendStatus === 'list') markRouteLegendStale();
        else refreshRouteLegend();
    }
    // The isolated trail is drawn once in full, so map movement needs no re-fetch.
});

// Minimize controls on mobile when clicking the map
map.on('click', (e) => {
    if (gpxEditMode) {
        // Skip clicks on a handle — both the real ones and the synthetic click MapLibre
        // fires at the end of a drag, which would otherwise drop a spurious handle.
        if (e.originalEvent && e.originalEvent.target && e.originalEvent.target.closest && e.originalEvent.target.closest('.maplibregl-marker')) {
            return;
        }
        if (e.lngLat) handleGpxEditMapClick(e.lngLat.lat, e.lngLat.lng);
        return;
    }
    if (routeCreateMode) {
        // A browser reports a double-click as two clicks, so double-click-to-zoom would
        // otherwise place the start and the end on the same pixel. `detail` is the click
        // count on a real mouse and 0/1 for a synthesized tap, so touch pays nothing.
        if (e.originalEvent && e.originalEvent.detail > 1) return;
        if (e.lngLat) handleRouteCreateMapClick(e.lngLat.lat, e.lngLat.lng);
        return;
    }
    if (poiPlacementMode) {
        if (e.lngLat) handlePoiPlacementClick(e.lngLat.lat, e.lngLat.lng);
        return;
    }
    if (manualClimbMode) {
        if (e.originalEvent && e.originalEvent.target && e.originalEvent.target.closest && e.originalEvent.target.closest('.maplibregl-marker')) {
            return;
        }
        if (e.lngLat) addManualClimbPoint(e.lngLat.lat, e.lngLat.lng);
        return;
    }
    if (window.innerWidth <= 600 && !isControlsMinimized) {
        toggleControls();
    }
});

// Rotating toggles the auto-hidden compass (body.north-up), which changes the nav
// group's height; while the controls sit in the bottom-left corner (mobile + route
// legend) the slider-stack offset depends on that height, so re-measure.
map.on('rotateend', adjustMapControlsForElevation);

// Mobile: tapping the minimized panel re-expands it (the inverse of the map-click
// minimize above). Its own controls keep their function — buttons (Share / About /
// minimize toggle) and the tap-to-copy coordinates badge are excluded.
if (controls) {
    controls.addEventListener('click', (e) => {
        if (window.innerWidth > 600 || !isControlsMinimized) return;
        if (e.target.closest('button, #coords-level')) return;
        toggleControls();
    });
}

// Esc cancels an in-progress POI placement or track edit.
document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (gpxEditMode) {
        cancelGpxEditMode();   // prompts when there are unsaved edits
        return;
    }
    if (routeCreateMode) {
        cancelRouteCreation();
        return;
    }
    if (poiPlacementMode) {
        cancelPoiPlacement();
        if (statusDiv) statusDiv.textContent = translations[currentLang].status_ready || 'Ready.';
    }
});

// Initialize
updateLanguage();
initServiceWorker();
if (layerSelect) {
    layerSelect.value = savedLayer;
}
// Global unit system. Migrate legacy per-route choice (topo_distance_unit) the first
// time, then drive everything from topo_units.
let savedUnits = localStorage.getItem('topo_units');
if (!savedUnits) {
    savedUnits = (localStorage.getItem('topo_distance_unit') === 'mi') ? 'imperial' : 'metric';
}
unitSystem = (savedUnits === 'imperial') ? 'imperial' : 'metric';
const unitsSelect = document.getElementById('units-select');
if (unitsSelect) unitsSelect.value = unitSystem;
// Convert the metric HTML-default inputs into the active unit system (no-op for metric).
applyUnitSystem('metric');
// Re-apply labels so the unit suffixes (km/mi, m/ft) reflect the restored system.
updateLanguage();

const showPoiCheckbox = document.getElementById('showPoi');
if (showPoiCheckbox) showPoiCheckbox.checked = poiLayerVisible;

let initialMapStateApplied = false;
function applyInitialMapState() {
    if (initialMapStateApplied) return;
    initialMapStateApplied = true;
    handleLayerChange(savedLayer);
    if (sharedRoute) {
        // A shared link selected a specific trail: turn on its overlay, keep the
        // legend minimized for the recipient, isolate the trail and fit the whole
        // route in view (ignoring the link's zoom level).
        if (extraLayerSelect) extraLayerSelect.value = sharedRoute.overlay;
        routeNamesOn = true;
        routeLegendCollapsed = true; // in-memory only; don't overwrite the viewer's preference
        applyExtraOverlay(sharedRoute.overlay); // also kicks off the legend list fetch
        updateZoomControlVisibility();
        isolatedRouteId = sharedRoute.id;
        isolatedColor = sharedRoute.color;
        // Seed the legend list with this route so its name shows in the minimized
        // header even when zoomed out (before/without the by_area list loading).
        if (sharedRoute.name) {
            lastRouteItems = [{ id: sharedRoute.id, name: sharedRoute.name, color: sharedRoute.color, symbol: null }];
        }
        setExtraOverlayRasterOpacity(0);
        pendingRouteFit = true;
        fetchAndDrawTrail(sharedRoute.id);
    } else {
        const savedExtra = localStorage.getItem(EXTRA_OVERLAY_STORAGE_KEY) || '';
        if (OVERLAY_SOURCES[savedExtra]) applyExtraOverlay(savedExtra);
        // Queue restoring a persisted isolated trail; it's applied once the legend list loads.
        const savedIsoId = Number(localStorage.getItem(ROUTE_ISOLATED_ID_KEY));
        // Only the Waymarked overlays restore an isolated trail on load (via the legend list);
        // a non-Waymarked overlay like the heatmap has no legend, so skip it rather than leave
        // a dormant selection that would pop back on a later switch to a Waymarked overlay.
        if (isOverlayOn() && OVERLAY_WMT_ACTIVITY[savedExtra] && Number.isFinite(savedIsoId) && savedIsoId) {
            restoreIsolatedPending = { id: savedIsoId, color: localStorage.getItem(ROUTE_ISOLATED_COLOR_KEY) || '#1565C0' };
        }
        if (routeNamesOn) refreshRouteLegend();
    }
    updateUI();
    updateCenterElevation();
}

applyInitialMapState();
if (isMobileDevice()) {
    setControlsMinimized(true);
}

// Run the GPX layer op only once the MapLibre style is ready (the adapter's own
// readiness flag; do not use map.once('load') — backend detection can resolve after
// 'load' already fired, which would drop the callback).
function whenGpxMapReady(callback) {
    if (map && map._styleReady) { callback(); return; }
    window.setTimeout(() => whenGpxMapReady(callback), 50);
}

// Detect the optional backend, then refresh backend-conditional UI text and, if a
// ?gpx= share link was opened, load it (or strip the param silently when there is
// no backend — no error, no message).
(async function initializeBackendFeatures() {
    await detectBackendAvailability();
    // Awaited so the POI fallback below sees a restored session and doesn't double-fetch.
    if (isBackendEnabled()) await initGoogleAuth();
    // Render cached POIs on a logged-out / backend-less load too (when signed in,
    // initGoogleAuth already fetches the fresh list).
    whenGpxMapReady(() => { if (!isGoogleSignedIn()) refreshPoiList(); });
    // The Strava heatmap overlay is served by the backend, so only offer it when one is
    // present. If a stale selection restored it on a backend-less load, revert to none.
    const stravaOpt = extraLayerSelect && extraLayerSelect.querySelector('option[value="strava_heatmap"]');
    if (stravaOpt) stravaOpt.hidden = !isBackendEnabled();
    if (!isBackendEnabled() && extraLayerSelect && extraLayerSelect.value === 'strava_heatmap') {
        extraLayerSelect.value = 'none';
        removeExtraOverlay();
        localStorage.setItem(EXTRA_OVERLAY_STORAGE_KEY, '');
    }
    updateLanguage();
    const params = new URLSearchParams(location.search);
    const sharedGpxId = params.get('gpx');
    if (!sharedGpxId) return;
    if (isBackendEnabled()) {
        whenGpxMapReady(() => { loadSharedGpxById(sharedGpxId, { skipFitBounds: hasSharedMapView }); });
    } else {
        params.delete('gpx');
        const queryString = params.toString();
        history.replaceState(null, '', location.pathname + (queryString ? '?' + queryString : '') + location.hash);
    }
})();

// Auto-start tutorial for new visitors
if (!localStorage.getItem('topo_tutorial_done') && !hasSharedMapView && !hasSharedGpxLink) {
    setTimeout(() => startTutorial(), 1000);
}

// Surface the install UI on load for cases where no `beforeinstallprompt` fires
// (notably iPhone/iPad). Safe no-op otherwise; returns early until the tutorial is
// done, after which hideTutorial() re-invokes it.
showDeferredInstallUi(1500);

// ==========================================
// PRINT MAP — export the framed area to a print-ready PDF
// ==========================================
// Launched (desktop only) by clicking the app logo in the Control Panel.
// A framing "window" is drawn over the live map (the area outside is shadowed out);
// the user pans/zooms to frame the area, picks A4/A3 + portrait/landscape, then
// "Generate PDF". Rendering uses a dedicated off-screen MapLibre map created with
// preserveDrawingBuffer:true (the main map is not), so its WebGL canvas can be read.
// Cloning the live style captures the base layer, hillshade, contours, overlays and the
// GPX track line for free; DOM markers (POIs, analysis pins, GPX labels) are composited
// on top by projecting their coordinates onto the print canvas.

const PRINT_DPI = 200;
const PRINT_PAPER_MM = { a4: [210, 297], a3: [297, 420], a2: [420, 594] };
const PRINT_BASE_MARGIN_MM = 5;  // minimal outer margin, always present
const PRINT_NBAND_MM = 3.5;      // horizontal N-coordinate label band (top & bottom)
const PRINT_EBAND_MM = 3.5;      // vertical E-coordinate label band (left & right)
const PRINT_FOOTER_MM = 6.5;     // bottom band height for the scale ruler + source
const PRINT_PIN_TARGET_MM = 6.5; // on-paper height of composited marker pins

let printModeState = null; // { overlay, panel, rect, paper, orientation, coordSystem, showScaleBar, showSource, showCoords, onResize }

// Compute per-side margins from the enabled print options; any disabled annotation
// frees its margin band back to the map, so the map grows to fill the freed space.
function getPrintLayout(paper, orientation, opts) {
    opts = opts || { coordinates: true, scaleRuler: true, mapSource: true };
    const dims = PRINT_PAPER_MM[paper] || PRINT_PAPER_MM.a4;
    const short = Math.min(dims[0], dims[1]);
    const long = Math.max(dims[0], dims[1]);
    const pageW = orientation === 'landscape' ? long : short;
    const pageH = orientation === 'landscape' ? short : long;
    const base = PRINT_BASE_MARGIN_MM;
    // The scale ruler / source sit just below the map (same tight gap as the coordinates),
    // sharing the bottom band with the lower-right coordinate rather than stacking below it.
    const footerH = opts.scaleRuler ? PRINT_FOOTER_MM : (opts.mapSource ? 3.5 : 0);
    const nBand = opts.coordinates ? PRINT_NBAND_MM : 0;
    const eBand = opts.coordinates ? PRINT_EBAND_MM : 0;
    const leftM = base + eBand;
    const rightM = base + eBand;
    const topM = base + nBand;
    const bottomM = base + Math.max(nBand, footerH);
    const mapX = leftM;
    const mapY = topM;
    const mapW = pageW - leftM - rightM;
    const mapH = pageH - topM - bottomM;
    return { pageW, pageH, mapX, mapY, mapW, mapH, aspect: mapW / mapH, leftM, rightM, topM, bottomM, base, footerH, nBand, eBand };
}

// The print options that affect layout margins (read from state, defaults for first paint).
function currentPrintOpts() {
    return {
        coordinates: printModeState ? printModeState.showCoords : true,
        scaleRuler: printModeState ? printModeState.showScaleBar : true,
        mapSource: printModeState ? printModeState.showSource : true
    };
}

// Rectangle (in map-container CSS px) of the print window for the current paper/orientation.
function computePrintWindowRect() {
    const cont = map._map.getContainer();
    const CW = cont.clientWidth, CH = cont.clientHeight;
    const layout = getPrintLayout(printModeState.paper, printModeState.orientation, currentPrintOpts());
    const availW = CW * 0.86;
    const availH = CH * 0.80; // leave headroom for the settings panel
    let w = availW, h = w / layout.aspect;
    if (h > availH) { h = availH; w = h * layout.aspect; }
    return { x: (CW - w) / 2, y: (CH - h) / 2, w, h };
}

function redrawPrintWindow() {
    if (!printModeState) return;
    const cont = map._map.getContainer();
    const CW = cont.clientWidth, CH = cont.clientHeight;
    const rect = computePrintWindowRect();
    printModeState.rect = rect;
    const { x, y, w, h } = rect;
    // A full-container path with a rectangular hole (evenodd) shades everything outside.
    const shade = `M0 0 H${CW} V${CH} H0 Z M${x} ${y} H${x + w} V${y + h} H${x} Z`;
    printModeState.svg.setAttribute('viewBox', `0 0 ${CW} ${CH}`);
    printModeState.shadePath.setAttribute('d', shade);
    printModeState.border.setAttribute('x', x);
    printModeState.border.setAttribute('y', y);
    printModeState.border.setAttribute('width', w);
    printModeState.border.setAttribute('height', h);
}

function enterPrintMode() {
    if (printModeState) return;
    // #printmap-panel anchors to the map's top-left, which on desktop is exactly where the
    // route info panel floats. Print mode is desktop-only (isMobileDevice() gates the
    // launcher), so the two always collide; yield the corner for the duration.
    document.body.classList.add('print-mode');
    const t = translations[currentLang] || {};
    const cont = map._map.getContainer();

    // --- Framing overlay (inside the map container so coords line up with unproject) ---
    const overlay = document.createElement('div');
    overlay.id = 'printmap-overlay';
    const svgNS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('preserveAspectRatio', 'none');
    const shadePath = document.createElementNS(svgNS, 'path');
    shadePath.setAttribute('class', 'printmap-shade');
    shadePath.setAttribute('fill-rule', 'evenodd');
    const border = document.createElementNS(svgNS, 'rect');
    border.setAttribute('class', 'printmap-window-border');
    svg.appendChild(shadePath);
    svg.appendChild(border);
    overlay.appendChild(svg);
    cont.appendChild(overlay);

    // --- Settings panel ---
    const panel = document.createElement('div');
    panel.id = 'printmap-panel';
    panel.innerHTML =
        `<div class="printmap-panel-title">${t.print_title || 'Print map'}</div>` +
        `<div class="printmap-row"><label>${t.print_paper_size || 'Paper size'}</label>` +
        `<select id="printmap-paper"><option value="a4">A4</option><option value="a3">A3</option><option value="a2">A2</option></select></div>` +
        `<div class="printmap-row"><label>${t.print_orientation || 'Orientation'}</label>` +
        `<select id="printmap-orient"><option value="portrait">${t.print_portrait || 'Portrait'}</option>` +
        `<option value="landscape">${t.print_landscape || 'Landscape'}</option></select></div>` +
        `<div class="printmap-row"><label>${t.print_coord_system || 'Coordinate system'}</label>` +
        `<select id="printmap-crs"><option value="wgs84">${t.print_wgs84 || 'WGS 84'}</option>` +
        `<option value="sweref99">${t.print_sweref99 || 'SWEREF 99'}</option></select></div>` +
        `<label class="printmap-check"><input type="checkbox" id="printmap-scalebar" checked> ${t.print_scale_ruler || 'Scale ruler'}</label>` +
        `<label class="printmap-check"><input type="checkbox" id="printmap-source" checked> ${t.print_map_source || 'Map source'}</label>` +
        `<label class="printmap-check"><input type="checkbox" id="printmap-coords" checked> ${t.print_coordinates || 'Coordinates'}</label>` +
        `<label class="printmap-check"><input type="checkbox" id="printmap-northarrow" checked> ${t.print_north_arrow || 'North arrow'}</label>` +
        `<label class="printmap-check"><input type="checkbox" id="printmap-border"> ${t.print_map_border || 'Map border'}</label>` +
        `<div class="printmap-hint">${t.print_hint || ''}</div>` +
        `<div class="printmap-btns">` +
        `<button id="printmap-generate" class="action-btn">${t.print_generate || 'Generate PDF'}</button>` +
        `<button id="printmap-exit" class="action-btn secondary">${t.print_exit || 'Exit'}</button>` +
        `</div>`;
    document.body.appendChild(panel);

    printModeState = {
        overlay, panel, svg, shadePath, border,
        paper: 'a4', orientation: 'landscape', coordSystem: 'wgs84',
        showScaleBar: true, showSource: true, showCoords: true, showNorthArrow: true, showBorder: false, rect: null, onResize: null
    };

    const paperSel = panel.querySelector('#printmap-paper');
    const orientSel = panel.querySelector('#printmap-orient');
    const crsSel = panel.querySelector('#printmap-crs');
    const scaleChk = panel.querySelector('#printmap-scalebar');
    const sourceChk = panel.querySelector('#printmap-source');
    const coordsChk = panel.querySelector('#printmap-coords');
    const northChk = panel.querySelector('#printmap-northarrow');
    const borderChk = panel.querySelector('#printmap-border');
    paperSel.value = printModeState.paper;
    orientSel.value = printModeState.orientation;
    crsSel.value = printModeState.coordSystem;
    paperSel.addEventListener('change', () => { printModeState.paper = paperSel.value; redrawPrintWindow(); });
    orientSel.addEventListener('change', () => { printModeState.orientation = orientSel.value; redrawPrintWindow(); });
    crsSel.addEventListener('change', () => { printModeState.coordSystem = crsSel.value; });
    scaleChk.addEventListener('change', () => { printModeState.showScaleBar = scaleChk.checked; redrawPrintWindow(); });
    sourceChk.addEventListener('change', () => { printModeState.showSource = sourceChk.checked; redrawPrintWindow(); });
    coordsChk.addEventListener('change', () => { printModeState.showCoords = coordsChk.checked; redrawPrintWindow(); });
    northChk.addEventListener('change', () => { printModeState.showNorthArrow = northChk.checked; });
    borderChk.addEventListener('change', () => { printModeState.showBorder = borderChk.checked; });
    panel.querySelector('#printmap-exit').addEventListener('click', exitPrintMode);
    panel.querySelector('#printmap-generate').addEventListener('click', () => { generatePrintPdf(); });

    printModeState.onResize = () => redrawPrintWindow();
    window.addEventListener('resize', printModeState.onResize);
    // The container size is fixed, so only paper/orientation/resize change the window
    // rect — the frame stays steady while the map pans/zooms underneath it.
    redrawPrintWindow();
}

function exitPrintMode() {
    if (!printModeState) return;
    document.body.classList.remove('print-mode');
    window.removeEventListener('resize', printModeState.onResize);
    if (printModeState.overlay && printModeState.overlay.parentNode) printModeState.overlay.parentNode.removeChild(printModeState.overlay);
    if (printModeState.panel && printModeState.panel.parentNode) printModeState.panel.parentNode.removeChild(printModeState.panel);
    printModeState = null;
}

function setPrintStatus(msg) {
    if (statusDiv) statusDiv.textContent = msg;
}

// WGS84 (lat/lon degrees) -> SWEREF 99 TM (EPSG:3006). Returns { n: northing, e: easting }.
// Gauss conformal (Krüger n-series) on GRS80, per Lantmäteriet's published formulas.
function wgs84ToSweref99tm(lat, lon) {
    const a = 6378137.0, f = 1 / 298.257222101;
    const k0 = 0.9996, FN = 0, FE = 500000.0, lon0 = 15 * Math.PI / 180;
    const e2 = f * (2 - f);
    const n = f / (2 - f);
    const aRoof = a / (1 + n) * (1 + n ** 2 / 4 + n ** 4 / 64);
    const A = e2;
    const B = (5 * e2 ** 2 - e2 ** 3) / 6;
    const C = (104 * e2 ** 3 - 45 * e2 ** 4) / 120;
    const D = (1237 * e2 ** 4) / 1260;
    const phi = lat * Math.PI / 180, lambda = lon * Math.PI / 180;
    const phiStar = phi - Math.sin(phi) * Math.cos(phi) *
        (A + B * Math.sin(phi) ** 2 + C * Math.sin(phi) ** 4 + D * Math.sin(phi) ** 6);
    const dLambda = lambda - lon0;
    const xiPrim = Math.atan(Math.tan(phiStar) / Math.cos(dLambda));
    const etaPrim = Math.atanh(Math.cos(phiStar) * Math.sin(dLambda));
    const b1 = n / 2 - 2 * n ** 2 / 3 + 5 * n ** 3 / 16 + 41 * n ** 4 / 180;
    const b2 = 13 * n ** 2 / 48 - 3 * n ** 3 / 5 + 557 * n ** 4 / 1440;
    const b3 = 61 * n ** 3 / 240 - 103 * n ** 4 / 140;
    const b4 = 49561 * n ** 4 / 161280;
    const north = k0 * aRoof * (xiPrim
        + b1 * Math.sin(2 * xiPrim) * Math.cosh(2 * etaPrim)
        + b2 * Math.sin(4 * xiPrim) * Math.cosh(4 * etaPrim)
        + b3 * Math.sin(6 * xiPrim) * Math.cosh(6 * etaPrim)
        + b4 * Math.sin(8 * xiPrim) * Math.cosh(8 * etaPrim)) + FN;
    const east = k0 * aRoof * (etaPrim
        + b1 * Math.cos(2 * xiPrim) * Math.sinh(2 * etaPrim)
        + b2 * Math.cos(4 * xiPrim) * Math.sinh(4 * etaPrim)
        + b3 * Math.cos(6 * xiPrim) * Math.sinh(6 * etaPrim)
        + b4 * Math.cos(8 * xiPrim) * Math.sinh(8 * etaPrim)) + FE;
    return { n: north, e: east };
}

function stripHtml(html) {
    const d = document.createElement('div');
    d.innerHTML = html || '';
    return (d.textContent || '').trim();
}

const _printImgCache = {};
function loadImageCached(src) {
    if (_printImgCache[src]) return _printImgCache[src];
    const p = new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = src;
    });
    _printImgCache[src] = p;
    return p;
}

// Normalize the app's various marker objects to { lat, lng, el, iconOptions }.
function collectPrintOverlayItems() {
    const items = [];
    const add = (collection) => {
        if (!collection) return;
        for (const m of collection) {
            if (!m) continue;
            if (m._latlng && m._options) {           // adapter marker (POI / analysis pins)
                const el = m._marker && m._marker.getElement ? m._marker.getElement() : null;
                items.push({ lat: m._latlng.lat, lng: m._latlng.lng, el, iconOptions: m._options.icon && m._options.icon.options });
            } else if (typeof m.getLngLat === 'function') { // native maplibregl.Marker (GPX labels)
                const ll = m.getLngLat();
                items.push({ lat: ll.lat, lng: ll.lng, el: (m.getElement ? m.getElement() : null), iconOptions: null });
            }
        }
    };
    if (poiLayerVisible) add(poiMarkers);
    add(markers);
    add(currentMarkers);
    add(currentKmMarkers);
    return items;
}

// Draw a small rounded text badge (used for GPX labels which are styled DOM, not images).
function drawPrintTextBadge(ctx, text, x, y, scale, className) {
    if (!text) return;
    const fontPx = Math.round(11 * scale);
    ctx.font = `600 ${fontPx}px sans-serif`;
    const padX = 5 * scale, padY = 3 * scale;
    const tw = ctx.measureText(text).width;
    const bw = tw + padX * 2, bh = fontPx + padY * 2;
    let fg = '#333';
    if (className && className.indexOf('min-elev') !== -1) fg = '#1565C0';
    else if (className && className.indexOf('gpx-elev-label') !== -1) fg = '#C62828';
    const bx = x - bw / 2, by = y - bh / 2;
    const r = 4 * scale;
    ctx.beginPath();
    ctx.moveTo(bx + r, by);
    ctx.arcTo(bx + bw, by, bx + bw, by + bh, r);
    ctx.arcTo(bx + bw, by + bh, bx, by + bh, r);
    ctx.arcTo(bx, by + bh, bx, by, r);
    ctx.arcTo(bx, by, bx + bw, by, r);
    ctx.closePath();
    ctx.fillStyle = 'rgba(255,255,255,0.92)';
    ctx.fill();
    ctx.lineWidth = Math.max(1, scale);
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.stroke();
    ctx.fillStyle = fg;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x, y + 0.5 * scale);
}

async function compositePrintDecorations(ctx, pmap, ratio, pxPerMm) {
    const items = collectPrintOverlayItems();
    const W = ctx.canvas.width, H = ctx.canvas.height;
    for (const it of items) {
        const p = pmap.project([it.lng, it.lat]);
        const x = p.x * ratio, y = p.y * ratio;
        if (x < -100 || y < -100 || x > W + 100 || y > H + 100) continue; // off-page
        const el = it.el;
        const img = el && el.tagName === 'IMG' ? el : (el && el.querySelector ? el.querySelector('img') : null);
        const iconUrl = (it.iconOptions && it.iconOptions.iconUrl) || (img && img.getAttribute('src'));
        if (iconUrl) {
            const iconSize = (it.iconOptions && it.iconOptions.iconSize) || [25, 41];
            const iconAnchor = (it.iconOptions && it.iconOptions.iconAnchor) || [iconSize[0] / 2, iconSize[1]];
            const f = (PRINT_PIN_TARGET_MM * pxPerMm / iconSize[1]) * ratio;
            try {
                const loaded = await loadImageCached(iconUrl);
                ctx.drawImage(loaded, x - iconAnchor[0] * f, y - iconAnchor[1] * f, iconSize[0] * f, iconSize[1] * f);
            } catch (e) { /* skip a marker that fails to load */ }
        } else if (el) {
            drawPrintTextBadge(ctx, (el.textContent || '').trim(), x, y, ratio * (pxPerMm / 7.874), el.className);
        }
    }
}

// Build the off-screen print map, wait for it to settle, composite decorations, and
// return the map image plus the geo/scale metadata the PDF needs.
async function capturePrintComposite(rect, layout) {
    const nm = map._map;
    const pxPerMm = PRINT_DPI / 25.4;
    const printW = Math.max(1, Math.round(layout.mapW * pxPerMm));
    const printH = Math.max(1, Math.round(layout.mapH * pxPerMm));
    const center = nm.unproject([rect.x + rect.w / 2, rect.y + rect.h / 2]);
    const bearing = nm.getBearing();
    // Same ground area as the framing window, rendered into printW px (independent of DPI).
    const zoom = nm.getZoom() + Math.log2(printW / rect.w);

    const style = nm.getStyle();
    delete style.terrain; // flatten: a print is 2D (hillshade layer, which is separate, stays)

    const holder = document.createElement('div');
    holder.style.cssText = `position:fixed;left:-100000px;top:0;width:${printW}px;height:${printH}px;pointer-events:none;`;
    document.body.appendChild(holder);

    const pmap = new maplibregl.Map({
        container: holder,
        style,
        center: [center.lng, center.lat],
        zoom,
        bearing,
        pitch: 0,
        interactive: false,
        attributionControl: false,
        fadeDuration: 0,
        // Must be nested: MapLibre groups the WebGL context attributes here, so a top-level
        // preserveDrawingBuffer is silently ignored and getCanvas() below reads an empty buffer.
        canvasContextAttributes: { preserveDrawingBuffer: true }
    });
    if (typeof pmap.setPixelRatio === 'function') { try { pmap.setPixelRatio(1); } catch (e) { /* older build */ } }

    try {
        await new Promise((resolve) => {
            let done = false;
            const finish = () => { if (done) return; done = true; resolve(); };
            pmap.once('idle', finish);
            setTimeout(finish, 9000); // safety net if tiles never fully settle
        });

        const glCanvas = pmap.getCanvas();
        const ratio = glCanvas.width / printW;
        const canvas = document.createElement('canvas');
        canvas.width = glCanvas.width;
        canvas.height = glCanvas.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(glCanvas, 0, 0);
        await compositePrintDecorations(ctx, pmap, ratio, pxPerMm);

        // Scale + corner metadata (computed while the print map is alive).
        const c1 = pmap.unproject([printW / 2, printH / 2]);
        const c2 = pmap.unproject([printW / 2 + 100, printH / 2]);
        const mPerPx = haversineDistance(c1.lat, c1.lng, c2.lat, c2.lng) / 100;
        const corners = {
            nw: pmap.unproject([0, 0]),
            ne: pmap.unproject([printW, 0]),
            se: pmap.unproject([printW, printH]),
            sw: pmap.unproject([0, printH])
        };
        const dataUrl = canvas.toDataURL('image/png');
        return { dataUrl, printW, printH, mPerPx, corners, bearing };
    } finally {
        pmap.remove();
        if (holder.parentNode) holder.parentNode.removeChild(holder);
    }
}

// North-arrow symbol (an upward pointer with an "N"). Rendered from SVG so it can be
// rasterised to a PNG and dropped into the PDF via addImage.
const NORTH_ARROW_SVG =
    '<svg xmlns="http://www.w3.org/2000/svg" width="90.99" height="122.88" viewBox="0 0 90.99 122.88">' +
    '<path d="M43.96,7.65L4.59,87.23l39.37-20.97V7.65L43.96,7.65L43.96,7.65z M40.9,93.74l14.03,17.65V99.16' +
    'c0-1.73-0.24-2.89-0.74-3.49c-0.67-0.82-1.81-1.22-3.39-1.19v-0.73h9.41v0.73c-1.2,0.16-2.01,0.36-2.43,0.6' +
    'c-0.41,0.25-0.73,0.65-0.97,1.21c-0.23,0.56-0.34,1.53-0.34,2.87v23.72h-0.71L36.53,99.13v18.17c0,1.64,0.37,2.77,1.12,3.35' +
    'c0.75,0.58,1.62,0.87,2.59,0.87h0.67v0.73H30.77v-0.73c1.58-0.01,2.66-0.34,3.29-0.97c0.62-0.64,0.92-1.71,0.92-3.24V97.14' +
    'l-0.59-0.74c-0.6-0.77-1.13-1.28-1.6-1.53c-0.46-0.24-1.12-0.38-1.99-0.41v-0.73H40.9L40.9,93.74z M46.78,0.94l44.05,89.04' +
    'c0.35,0.71,0.06,1.58-0.66,1.93c-0.43,0.22-0.92,0.19-1.32-0.03v0.01L45.42,68.76L1.98,91.9L0,89.98L44.12,0.81h0.01' +
    'C44.36,0.33,44.85,0,45.42,0l0,0C46.03,0,46.56,0.37,46.78,0.94L46.78,0.94L46.78,0.94L46.78,0.94z"/></svg>';
const NORTH_ARROW_ASPECT = 90.99 / 122.88; // width / height

// Rasterise the north-arrow SVG to a PNG data URL, rotated to point at true north
// (on a map rotated by `bearingDeg`, north sits at screen angle -bearing). The arrow is
// centred in a square canvas sized so it never clips at any rotation.
async function rasterizeNorthArrow(bearingDeg) {
    const SIZE = 256;
    const canvas = document.createElement('canvas');
    canvas.width = SIZE;
    canvas.height = SIZE;
    const ctx = canvas.getContext('2d');
    const uri = 'data:image/svg+xml,' + encodeURIComponent(NORTH_ARROW_SVG);
    const img = await loadImageCached(uri);
    ctx.translate(SIZE / 2, SIZE / 2);
    ctx.rotate(-(bearingDeg || 0) * Math.PI / 180);
    const h = SIZE * 0.78, w = h * NORTH_ARROW_ASPECT;
    ctx.drawImage(img, -w / 2, -h / 2, w, h);
    return canvas.toDataURL('image/png');
}

// Draws the segmented scale ruler with its 0/​d/​2d/​3d tick labels and unit.
// Returns the total width in mm (bar + trailing unit) so the caller can place the
// scale number + coordinate-system label immediately to its right.
function drawPrintScaleBar(doc, x, yBottom, cap) {
    // cap: { mmPerM } -> mm on paper per ground metre
    const mmPerM = cap.mmPerM;
    const targetMm = 40;
    const targetM = targetMm / mmPerM;
    const seg = niceScaleDenominator(targetM / 4); // nice per-segment ground distance
    if (seg <= 0) return 0;
    const segMm = seg * mmPerM;
    const segs = 4;
    const barH = 1.6;
    const y = yBottom - barH;
    doc.setLineWidth(0.2);
    doc.setDrawColor(0, 0, 0);
    for (let i = 0; i < segs; i++) {
        const shade = i % 2 === 0 ? 0 : 255;
        doc.setFillColor(shade, shade, shade);
        doc.rect(x + i * segMm, y, segMm, barH, 'FD');
    }
    doc.setFontSize(6.5);
    doc.setTextColor(30, 30, 30);
    const unitKm = seg >= 1000;
    for (let i = 0; i <= segs; i++) {
        const val = unitKm ? (seg * i / 1000) : (seg * i);
        const label = String(Math.round(val * 100) / 100);
        doc.text(label, x + i * segMm, y - 1, { align: 'center' });
    }
    doc.text(unitKm ? 'km' : 'm', x + segs * segMm + 2, y + barH);
    return segs * segMm + 7; // bar width + room for the unit label
}

function buildPrintPdf(cap, layout, meta) {
    const jsPDFCtor = window.jspdf && window.jspdf.jsPDF;
    if (!jsPDFCtor) throw new Error('jsPDF not loaded');
    const orientation = layout.pageW >= layout.pageH ? 'landscape' : 'portrait';
    const doc = new jsPDFCtor({ orientation, unit: 'mm', format: meta.paper });
    const { mapX, mapY, mapW, mapH, pageW, pageH } = layout;

    // Map image
    doc.addImage(cap.dataUrl, 'PNG', mapX, mapY, mapW, mapH);
    if (meta.showBorder) {
        doc.setDrawColor(60, 60, 60);
        doc.setLineWidth(0.3);
        doc.rect(mapX, mapY, mapW, mapH, 'S');
    }

    const crsLabel = meta.coordSystem === 'sweref99' ? 'SWEREF 99 TM' : 'WGS 84';
    const scaleDenom = niceScaleDenominator(cap.mPerPx / ((mapW / 1000) / cap.printW));

    // Document properties (metadata) shown in a PDF reader's file/info panel.
    doc.setProperties({
        title: 'Generated map from TopoScout.org',
        author: 'TopoScout.org',
        subject: `${meta.sourceName || 'Map'} · Scale ${formatScale(scaleDenom)}`,
        creator: 'TopoScout.org'
    });

    // North arrow (top-left inside the map), optional. The SVG is pre-rasterised (rotated
    // to true north) in generatePrintPdf and passed in as a PNG data URL.
    if (meta.showNorthArrow && meta.northArrowDataUrl) {
        const nSize = 11; // square image box (mm); the arrow sits centred within it
        doc.addImage(meta.northArrowDataUrl, 'PNG', mapX + 1.5, mapY + 1.5, nSize, nSize);
    }

    // Corner coordinates: shown at the upper-left and lower-right corners only, just
    // outside the map with a tight gap and a compact font. At each corner the N
    // (northing/latitude) is horizontal and the E (easting/longitude) is vertical.
    if (meta.showCoords) {
        const fmt = (c) => {
            if (meta.coordSystem === 'sweref99') {
                const s = wgs84ToSweref99tm(c.lat, c.lng);
                return { n: 'N ' + Math.round(s.n), e: 'E ' + Math.round(s.e) };
            }
            return { n: 'N ' + c.lat.toFixed(5) + '°', e: 'E ' + c.lng.toFixed(5) + '°' };
        };
        const nw = fmt(cap.corners.nw), se = fmt(cap.corners.se);
        const gap = 0.8, capH = 2; // tiny map-to-label gap; approx glyph height (mm) at this size
        doc.setFontSize(5.8);
        doc.setTextColor(30, 30, 30);
        // Upper-left corner: N horizontal above the top edge, E vertical left of the left edge
        // (angle 90 reads bottom-to-top; glyphs extend left of the baseline).
        doc.text(nw.n, mapX, mapY - gap);
        doc.text(nw.e, mapX - gap, mapY + doc.getTextWidth(nw.e), { angle: 90 });
        // Lower-right corner: N horizontal below the bottom edge (right-aligned to the edge),
        // E vertical right of the right edge.
        doc.text(se.n, mapX + mapW, mapY + mapH + gap + capH, { align: 'right' });
        doc.text(se.e, mapX + mapW + gap + capH, mapY + mapH, { angle: 90 });
    }

    // Footer strip, all bottom-left: scale ruler + scale number + CRS, then the map source
    // (to the right of the scale text when the ruler is shown). Positioned just below the
    // map with the same tight gap as the coordinates.
    const footerBaseline = mapY + mapH + (meta.showScaleBar ? 5.2 : 2.8);
    let footerCursorX = mapX;
    if (meta.showScaleBar) {
        const mmPerM = mapW / (cap.printW * cap.mPerPx); // paper mm per ground metre
        const barW = drawPrintScaleBar(doc, footerCursorX, footerBaseline, { mmPerM });
        // Scale number + coordinate system, immediately to the right of the ruler
        // (scaleDenom is computed once near the top and reused for the metadata subject).
        doc.setFontSize(8);
        doc.setTextColor(20, 20, 20);
        const scaleTxt = `${formatScale(scaleDenom)}  ·  ${crsLabel}`;
        doc.text(scaleTxt, footerCursorX + barW + 3, footerBaseline - 0.5);
        footerCursorX += barW + 3 + doc.getTextWidth(scaleTxt) + 6;
    }
    if (meta.showSource) {
        doc.setFontSize(7.5);
        doc.setTextColor(20, 20, 20);
        const srcTxt = `${meta.sourceLabel}: ${meta.sourceName}${meta.attribution ? '  —  ' + meta.attribution : ''}`;
        doc.text(srcTxt, footerCursorX, footerBaseline - 0.5);
    }

    // Brand stamp flush in the map's upper-right corner (over a faint white plate).
    if (meta.stamp) {
        doc.setFontSize(6.5);
        const sTxt = meta.stamp;
        const sW = doc.getTextWidth(sTxt);
        const plateH = 3.4, plateW = sW + 1.2;
        try { doc.setGState(new doc.GState({ opacity: 0.7 })); } catch (e) { /* older jsPDF */ }
        doc.setFillColor(255, 255, 255);
        doc.rect(mapX + mapW - plateW, mapY, plateW, plateH, 'F');
        try { doc.setGState(new doc.GState({ opacity: 1 })); } catch (e) { /* older jsPDF */ }
        doc.setTextColor(70, 70, 70);
        doc.text(sTxt, mapX + mapW - 0.6, mapY + 2.4, { align: 'right' });
    }

    const name = (meta.sourceName || 'map').replace(/[^a-z0-9\-_]+/gi, '_').slice(0, 40);
    doc.save(`toposcout_${name}_${meta.paper}.pdf`);
}

let _printBusy = false;
async function generatePrintPdf() {
    if (_printBusy || !printModeState) return;
    _printBusy = true;
    const t = translations[currentLang] || {};
    const genBtn = printModeState.panel.querySelector('#printmap-generate');
    if (genBtn) genBtn.disabled = true;
    setPrintStatus(t.print_generating || 'Generating PDF…');
    try {
        const layout = getPrintLayout(printModeState.paper, printModeState.orientation, currentPrintOpts());
        const rect = printModeState.rect || computePrintWindowRect();
        const cap = await capturePrintComposite(rect, layout);
        const layerKey = (layerSelect && layerSelect.value) || 'opentopo';
        const sourceName = (layerSelect && layerSelect.options[layerSelect.selectedIndex])
            ? layerSelect.options[layerSelect.selectedIndex].text : layerKey;
        let northArrowDataUrl = null;
        if (printModeState.showNorthArrow) {
            try { northArrowDataUrl = await rasterizeNorthArrow(cap.bearing || 0); } catch (e) { /* skip arrow */ }
        }
        const meta = {
            paper: printModeState.paper,
            coordSystem: printModeState.coordSystem,
            showScaleBar: printModeState.showScaleBar,
            showSource: printModeState.showSource,
            showCoords: printModeState.showCoords,
            showNorthArrow: printModeState.showNorthArrow,
            showBorder: printModeState.showBorder,
            northArrowDataUrl,
            scaleWord: t.print_scale_word || 'Scale',
            sourceName,
            sourceLabel: t.print_source_label || 'Map source',
            attribution: stripHtml(MAP_SOURCES[layerKey] && MAP_SOURCES[layerKey].attribution),
            stamp: t.print_stamp || 'TopoScout.org'
        };
        buildPrintPdf(cap, layout, meta);
        setPrintStatus(t.print_done || 'PDF ready.');
    } catch (err) {
        console.error('Print map failed:', err);
        setPrintStatus(t.print_error || 'Could not generate the PDF. Please try again.');
    } finally {
        if (genBtn) genBtn.disabled = false;
        _printBusy = false;
    }
}

// Launch Print map by clicking the app logo (not the title) in the Control Panel.
// Desktop only — the modal needs room to be visible, so it is not offered on mobile.
// CSS gives the logo `pointer-events: bounding-box` so its whole area is clickable, not
// just the thin, unfilled SVG strokes.
(function wirePrintMapLauncher() {
    const logo = document.querySelector('#controls .app-logo');
    if (!logo || isMobileDevice()) return;
    logo.classList.add('printmap-launch');
    const tip = (translations[currentLang] && translations[currentLang].print_title) || 'Print map';
    const titleEl = document.createElementNS('http://www.w3.org/2000/svg', 'title');
    titleEl.textContent = tip;
    logo.insertBefore(titleEl, logo.firstChild);
    logo.addEventListener('click', () => {
        if (isMobileDevice() || printModeState) return;
        whenGpxMapReady(() => enterPrintMode());
    });
})();