// ==========================================
// 1. CONFIGURATION & CONSTANTS
// ==========================================
const APP_VERSION = "2.15.0";
const BUILD_NUMBER = "3001";
const ANALYSIS_SECTION_IDS = ['section-points', 'section-climbs', 'section-slope'];
const ALL_SECTION_IDS = ['section-points', 'section-climbs', 'section-slope', 'section-routes'];
const APP_REFRESH_PARAM = 'app-refresh';

// --- Optional GPX upload/sharing backend (auto-detected; absent on static hosting) ---
const API_BASE = '/api';
const BACKEND_DETECTION_TIMEOUT_MS = 1500;

let backendAvailable = false;
let backendDetectionPromise = null;

function isBackendEnabled() {
    return backendAvailable;
}

// --- Google Sign-In (optional; ties uploads to a Google account so previous
// uploads appear on any device/session, independent of the anonymous cookie) ---
const GOOGLE_CLIENT_ID = '79515767501-5p4cbnfq111dqnuv8h6fp91t33k6gcbt.apps.googleusercontent.com';
const GOOGLE_AUTH_STORAGE_KEY = 'topo_google_auth';
let googleAuth = null; // { token, exp, email, name, picture, sub }
let googleAuthInitialized = false;
let googleRefreshTimer = null;   // proactive pre-expiry silent re-auth timer
let pendingAuthRefresh = null;   // { promise, resolve, timeout } while a silent refresh is in flight
// Google ID tokens live ~1h. Re-auth silently this long before they expire.
const GOOGLE_AUTH_REFRESH_LEAD_MS = 5 * 60 * 1000;
// Cap on how long we wait for a silent One Tap re-auth before treating it as failed.
const GOOGLE_AUTH_REFRESH_TIMEOUT_MS = 8 * 1000;

async function detectBackendAvailability() {
    if (backendDetectionPromise) {
        return backendDetectionPromise;
    }

    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timeoutId = controller
        ? window.setTimeout(() => controller.abort(), BACKEND_DETECTION_TIMEOUT_MS)
        : null;

    backendDetectionPromise = fetch(API_BASE + '/health', {
        cache: 'no-store',
        credentials: 'same-origin',
        signal: controller ? controller.signal : undefined
    })
        .then(async response => {
            if (!response.ok) {
                return false;
            }
            const payload = await response.json().catch(() => null);
            return !!(payload && payload.status === 'ok');
        })
        .catch(() => false)
        .finally(() => {
            if (timeoutId !== null) {
                window.clearTimeout(timeoutId);
            }
        });

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

// Footer readout visibility. Zoom defaults to shown (only an explicit 'false' hides it);
// scale and center GPS default to hidden (only an explicit 'true' shows them).
const SHOW_ZOOM_KEY = 'topo_show_zoom';
const SHOW_SCALE_KEY = 'topo_show_scale';
const SHOW_CENTER_GPS_KEY = 'topo_show_center_gps';
const SHOW_COORDS_KEY = 'topo_show_coords';
function isZoomShown() { try { return localStorage.getItem(SHOW_ZOOM_KEY) !== 'false'; } catch (e) { return true; } }
function isScaleShown() { try { return localStorage.getItem(SHOW_SCALE_KEY) === 'true'; } catch (e) { return false; } }
function isCenterGpsShown() { try { return localStorage.getItem(SHOW_CENTER_GPS_KEY) === 'true'; } catch (e) { return false; } }
function isCoordsShown() { try { return localStorage.getItem(SHOW_COORDS_KEY) === 'true'; } catch (e) { return false; } }

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
                    });
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
                    });
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
                    });
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
                });
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
                });
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
                });
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
                filter: ['==', ['get', 'level'], 1],
                layout: {
                    'symbol-placement': 'line',
                    'text-size': 10,
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
let mobileElevationText = null;
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
const _shadowUrl = 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png';
const rankIcons = [
    new L.Icon({
        iconUrl: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNSA0MSIgc2hhcGUtcmVuZGVyaW5nPSJnZW9tZXRyaWNQcmVjaXNpb24iPjxwYXRoIGQ9Ik0gMTIuNSAxIEMgNi4xIDEgMSA2LjEgMSAxMi41IEMgMSAyMiAxMi41IDM5LjUgMTIuNSAzOS41IEMgMTIuNSAzOS41IDI0IDIyIDI0IDEyLjUgQyAyNCA2LjEgMTguOSAxIDEyLjUgMSBaIiBmaWxsPSIjRkZCMzAwIiBzdHJva2U9IiNmZmZmZmYiIHN0cm9rZS13aWR0aD0iMS41IiBzdHJva2UtbGluZWpvaW49InJvdW5kIiBzdHJva2UtbGluZWNhcD0icm91bmQiLz48Y2lyY2xlIGN4PSIxMi41IiBjeT0iMTIuNSIgcj0iNy44IiBmaWxsPSIjZmZmZmZmIi8+PHRleHQgeD0iMTIuNSIgeT0iMTYuNSIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iMTEiIGZvbnQtd2VpZ2h0PSI5MDAiIHRleHQtYW5jaG9yPSJtaWRkbGUiIGZpbGw9IiNGRkIzMDAiPjE8L3RleHQ+PC9zdmc+',
        shadowUrl: _shadowUrl,
        iconSize: [28, 45], iconAnchor: [14, 45], popupAnchor: [1, -38], shadowSize: [45, 45]
    }),
    new L.Icon({
        iconUrl: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNSA0MSIgc2hhcGUtcmVuZGVyaW5nPSJnZW9tZXRyaWNQcmVjaXNpb24iPjxwYXRoIGQ9Ik0gMTIuNSAxIEMgNi4xIDEgMSA2LjEgMSAxMi41IEMgMSAyMiAxMi41IDM5LjUgMTIuNSAzOS41IEMgMTIuNSAzOS41IDI0IDIyIDI0IDEyLjUgQyAyNCA2LjEgMTguOSAxIDEyLjUgMSBaIiBmaWxsPSIjMkE4MUNCIiBzdHJva2U9IiNmZmZmZmYiIHN0cm9rZS13aWR0aD0iMS41IiBzdHJva2UtbGluZWpvaW49InJvdW5kIiBzdHJva2UtbGluZWNhcD0icm91bmQiLz48Y2lyY2xlIGN4PSIxMi41IiBjeT0iMTIuNSIgcj0iNy44IiBmaWxsPSIjZmZmZmZmIi8+PHRleHQgeD0iMTIuNSIgeT0iMTYuNSIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iMTEiIGZvbnQtd2VpZ2h0PSI5MDAiIHRleHQtYW5jaG9yPSJtaWRkbGUiIGZpbGw9IiMyQTgxQ0IiPjI8L3RleHQ+PC9zdmc+',
        shadowUrl: _shadowUrl,
        iconSize: [25, 41], iconAnchor: [12, 41], popupAnchor: [1, -34], shadowSize: [41, 41]
    }),
    new L.Icon({
        iconUrl: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNSA0MSIgc2hhcGUtcmVuZGVyaW5nPSJnZW9tZXRyaWNQcmVjaXNpb24iPjxwYXRoIGQ9Ik0gMTIuNSAxIEMgNi4xIDEgMSA2LjEgMSAxMi41IEMgMSAyMiAxMi41IDM5LjUgMTIuNSAzOS41IEMgMTIuNSAzOS41IDI0IDIyIDI0IDEyLjUgQyAyNCA2LjEgMTguOSAxIDEyLjUgMSBaIiBmaWxsPSIjMkE4MUNCIiBzdHJva2U9IiNmZmZmZmYiIHN0cm9rZS13aWR0aD0iMS41IiBzdHJva2UtbGluZWpvaW49InJvdW5kIiBzdHJva2UtbGluZWNhcD0icm91bmQiLz48Y2lyY2xlIGN4PSIxMi41IiBjeT0iMTIuNSIgcj0iNy44IiBmaWxsPSIjZmZmZmZmIi8+PHRleHQgeD0iMTIuNSIgeT0iMTYuNSIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iMTEiIGZvbnQtd2VpZ2h0PSI5MDAiIHRleHQtYW5jaG9yPSJtaWRkbGUiIGZpbGw9IiMyQTgxQ0IiPjM8L3RleHQ+PC9zdmc+',
        shadowUrl: _shadowUrl,
        iconSize: [25, 41], iconAnchor: [12, 41], popupAnchor: [1, -34], shadowSize: [41, 41]
    })
];
const greenIcon = new L.Icon({
    iconUrl: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNSA0MSIgc2hhcGUtcmVuZGVyaW5nPSJnZW9tZXRyaWNQcmVjaXNpb24iPjxwYXRoIGQ9Ik0gMTIuNSAxIEMgNi4xIDEgMSA2LjEgMSAxMi41IEMgMSAyMiAxMi41IDM5LjUgMTIuNSAzOS41IEMgMTIuNSAzOS41IDI0IDIyIDI0IDEyLjUgQyAyNCA2LjEgMTguOSAxIDEyLjUgMSBaIiBmaWxsPSIjMkFBRDI3IiBzdHJva2U9IiNmZmZmZmYiIHN0cm9rZS13aWR0aD0iMS41IiBzdHJva2UtbGluZWpvaW49InJvdW5kIiBzdHJva2UtbGluZWNhcD0icm91bmQiLz48Y2lyY2xlIGN4PSIxMi41IiBjeT0iMTIuNSIgcj0iNCIgZmlsbD0iI2ZmZmZmZiIvPjwvc3ZnPg==',
    shadowUrl: _shadowUrl,
    iconSize: [25, 41], iconAnchor: [12, 41], popupAnchor: [1, -34], shadowSize: [41, 41]
});
const redIcon = new L.Icon({
    iconUrl: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNSA0MSIgc2hhcGUtcmVuZGVyaW5nPSJnZW9tZXRyaWNQcmVjaXNpb24iPjxwYXRoIGQ9Ik0gMTIuNSAxIEMgNi4xIDEgMSA2LjEgMSAxMi41IEMgMSAyMiAxMi41IDM5LjUgMTIuNSAzOS41IEMgMTIuNSAzOS41IDI0IDIyIDI0IDEyLjUgQyAyNCA2LjEgMTguOSAxIDEyLjUgMSBaIiBmaWxsPSIjQ0IyQjNFIiBzdHJva2U9IiNmZmZmZmYiIHN0cm9rZS13aWR0aD0iMS41IiBzdHJva2UtbGluZWpvaW49InJvdW5kIiBzdHJva2UtbGluZWNhcD0icm91bmQiLz48Y2lyY2xlIGN4PSIxMi41IiBjeT0iMTIuNSIgcj0iNCIgZmlsbD0iI2ZmZmZmZiIvPjwvc3ZnPg==',
    shadowUrl: _shadowUrl,
    iconSize: [25, 41], iconAnchor: [12, 41], popupAnchor: [1, -34], shadowSize: [41, 41]
});

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
        iconUrl: 'data:image/svg+xml,' + encodeURIComponent(svg),
        shadowUrl: _shadowUrl,
        iconSize: [28, 45], iconAnchor: [14, 45], popupAnchor: [1, -38], shadowSize: [45, 45]
    });
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
let gpxLayer = null;
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
        updateGpxTrackInfo();

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
// attribution control it replaces whenever any slider is visible.
function updateMapSliderChrome() {
    const anyVisible = !!document.querySelector('#map-slider-stack .map-slider.visible');
    const attribCorner = document.querySelector('.maplibregl-ctrl-bottom-left');
    if (attribCorner) attribCorner.style.display = anyVisible ? 'none' : '';
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
// colored line last, preserving their order.
function liftIsolatedTrailToTop() {
    const nativeMap = map && map._map;
    if (!nativeMap || !nativeMap.moveLayer) return;
    isolatedTrailLayers.forEach((l) => {
        if (l && l._ids && nativeMap.getLayer(l._ids.layerId)) {
            try { nativeMap.moveLayer(l._ids.layerId); } catch (e) { /* ignore */ }
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

// Hide the GPS + navigation controls while the route-names legend is shown
// (overlay on + route names enabled) so the legend has the bottom-right corner
// to itself. The hiding itself is done in CSS via the body.route-legend-on class.
function updateZoomControlVisibility() {
    const legendActive = routeNamesOn && isOverlayOn();
    document.body.classList.toggle('route-legend-on', legendActive);
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

async function searchLocation() {
    const t = translations[currentLang];
    const query = searchInput.value.trim();
    if (!query) return;
    statusDiv.textContent = t.status_searching;
    const coordMatch = query.match(/^([-+]?\d{1,2}[.]?\d*)[,\s]+([-+]?\d{1,3}[.]?\d*)$/);
    if (coordMatch) {
        map.setView([parseFloat(coordMatch[1]), parseFloat(coordMatch[2])], 12);
        statusDiv.textContent = t.status_done; return;
    }
    try {
        const response = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}`);
        const data = await response.json();
        if (data && data.length > 0) {
            map.setView([parseFloat(data[0].lat), parseFloat(data[0].lon)], 12);
            statusDiv.textContent = `${data[0].display_name.split(',')[0]}`;
        } else { statusDiv.textContent = t.status_no_match; }
    } catch (error) { console.error(error); }
}

function stopGpsTracking() {
    if (gpsWatchId !== null) { navigator.geolocation.clearWatch(gpsWatchId); gpsWatchId = null; }
    if (gpsMarker) { gpsMarker.remove(); gpsMarker = null; }
    if (gpsAccuracyCircle) { gpsAccuracyCircle.remove(); gpsAccuracyCircle = null; }
    document.querySelectorAll('.gps-toggle').forEach((b) => b.classList.remove('active'));
    lastGpsPosition = null;
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
            // Signal just tightened to pinpoint — snap to the now-precise position,
            // keeping the user's current zoom.
            if (Number.isFinite(acc)) {
                map.setView([lat, lng], map.getZoom());
            }
        }
    }

    document.querySelectorAll('.gps-toggle').forEach((b) => b.classList.add('active'));

    // Initial fix recenters the map once; continuous updates only move the marker.
    navigator.geolocation.getCurrentPosition(
        (pos) => { map.setView([pos.coords.latitude, pos.coords.longitude], 13); updateGpsMarker(pos); statusDiv.textContent = t.status_done; },
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
    clearGpxTrackSourceAndLayers();
    clearMarkerCollection(currentMarkers);
    currentMarkers = [];
    clearMarkerCollection(currentKmMarkers);
    currentKmMarkers = [];
    removeLegendControl(gpxSlopeLegend);
    gpxSlopeLegend = null;
    gpxLayer = null;
    gpxTrackData = null;
    currentSharedGpxId = null;
    currentGpxFilename = null;
    currentGpxShareUrl = null;
    currentGpxRawText = null;
    currentGpxRawFilename = null;
    const params = new URLSearchParams(location.search);
    params.delete('gpx');
    const queryString = params.toString();
    history.replaceState(null, '', location.pathname + (queryString ? '?' + queryString : '') + location.hash);
    const actionRow = document.getElementById('gpx-action-row');
    if (actionRow) actionRow.style.display = 'none';
    const infoDiv = document.getElementById('gpx-track-info');
    if (infoDiv) { infoDiv.style.display = 'none'; infoDiv.innerHTML = ''; }
    hideElevationProfile();
    statusDiv.textContent = translations[currentLang].status_gpx_cleared;
};

// ==========================================
// GPX DOWNLOAD + RENAME (client-side export of the loaded route)
// ==========================================
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

function updateGpxTrackInfo() {
    const infoDiv = document.getElementById('gpx-track-info');
    if (!infoDiv || !gpxTrackData) return;
    const t = translations[currentLang];
    const d = gpxTrackData;
    const unit = getDistanceUnit();
    let lengthStr;
    if (unit === 'mi') {
        const miles = d.length / 1609.344;
        lengthStr = miles >= 1 ? miles.toFixed(2) + ' mi' : (d.length * 3.28084).toFixed(0) + ' ft';
    } else {
        lengthStr = d.length >= 1000 ? (d.length / 1000).toFixed(2) + ' km' : Math.round(d.length) + ' m';
    }
    let html = `<span>${t.gpx_info_length}:</span> ${lengthStr}`;
    if (d.gain > 0 || d.loss > 0) {
        html += `<br><span>${t.gpx_info_gain}:</span> +${formatElevation(d.gain)}`;
        html += `<br><span>${t.gpx_info_loss}:</span> -${formatElevation(d.loss)}`;
    }
    if (d.minElev !== null) {
        html += `<br><span>${t.gpx_info_min_elev}:</span> ${formatElevation(d.minElev)}`;
        html += `<br><span>${t.gpx_info_max_elev}:</span> ${formatElevation(d.maxElev)}`;
    }
    infoDiv.innerHTML = html;
    infoDiv.style.display = 'block';
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
    updateGpxTrackInfo();
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
    if (nativeMap.getLayer('gpx-line-0')) {
        let i = 0;
        while (nativeMap.getLayer(`gpx-line-${i}`)) {
            nativeMap.removeLayer(`gpx-line-${i}`);
            i++;
        }
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

    if (nativeMap.getLayer('gpx-line-0')) {
        nativeMap.setPaintProperty('gpx-line-0', 'line-color', ['get', 'color']);
        nativeMap.setPaintProperty('gpx-line-0', 'line-width', weight);
        nativeMap.setPaintProperty('gpx-line-0', 'line-opacity', 0.85);
        return;
    }

    nativeMap.addLayer({
        id: 'gpx-line-0',
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
            el.innerHTML = label;
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
        el.innerHTML = label;
        currentMarkers.push(new maplibregl.Marker({ element: el })
            .setLngLat([startPt.lon, startPt.lat])
            .addTo(map._map));
    } else {
        if (startPt) {
            const el = document.createElement('div');
            el.className = 'gpx-start-end-label';
            el.innerHTML = `▶ ${t.gpx_start || 'Start'}`;
            currentMarkers.push(new maplibregl.Marker({ element: el })
                .setLngLat([startPt.lon, startPt.lat])
                .addTo(map._map));
        }
        if (endPt) {
            const el = document.createElement('div');
            el.className = 'gpx-start-end-label';
            el.innerHTML = `⏹ ${t.gpx_end || 'End'}`;
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
            el.innerHTML = `▲ ${formatElevation(maxPt.ele)}`;
            currentMarkers.push(new maplibregl.Marker({ element: el })
                .setLngLat([maxPt.lon, maxPt.lat])
                .addTo(map._map));
        }
        if (minPt) {
            const el = document.createElement('div');
            el.className = 'gpx-elev-label min-elev';
            el.innerHTML = `▼ ${formatElevation(minPt.ele)}`;
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
    gpxLayer = null;
    gpxTrackData = {
        segments: parsedGpx.segments,
        waypoints: parsedGpx.waypoints,
        ...parsedGpx.stats
    };
    setActiveGpxSource(options.source || null);
    currentGpxRawText = options.rawText || null;
    currentGpxRawFilename = options.rawFilename ||
        (options.source && options.source.filename) || null;

    rebuildGpxLayer();
    updateGpxTrackInfo();
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
    return !!(googleAuth && googleAuth.token && googleAuth.exp && googleAuth.exp * 1000 > Date.now());
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

// Run an authenticated request; if the Google token just expired (401), refresh
// it silently and retry once before falling back to the anonymous session.
// makeRequest must build a fresh fetch each call so it picks up the new token.
async function fetchWithAuthRetry(makeRequest) {
    let response = await makeRequest();
    if (response.status === 401 && isGoogleSignedIn()) {
        if (await refreshGoogleAuth()) {
            response = await makeRequest();
        }
        if (response.status === 401 && isGoogleSignedIn()) {
            clearGoogleAuthState();
        }
    }
    return response;
}

// Bearer header sent with the file endpoints; empty object falls back to the anon cookie.
function authHeaders() {
    return isGoogleSignedIn() ? { Authorization: 'Bearer ' + googleAuth.token } : {};
}

function persistGoogleAuth() {
    try {
        if (googleAuth) localStorage.setItem(GOOGLE_AUTH_STORAGE_KEY, JSON.stringify(googleAuth));
        else localStorage.removeItem(GOOGLE_AUTH_STORAGE_KEY);
    } catch (e) { /* storage unavailable; in-memory auth still works for this session */ }
}

function loadStoredGoogleAuth() {
    try {
        const raw = localStorage.getItem(GOOGLE_AUTH_STORAGE_KEY);
        return raw ? JSON.parse(raw) : null;
    } catch (e) {
        return null;
    }
}

function clearGoogleAuthState() {
    googleAuth = null;
    persistGoogleAuth();
    clearGoogleAuthRefreshTimer();
    settlePendingAuthRefresh(false);
    try {
        if (window.google && google.accounts && google.accounts.id) {
            google.accounts.id.disableAutoSelect();
        }
    } catch (e) { /* ignore */ }
    updateGpxModalAuthUI();
    updatePoiModalAuthUI();
    // Keep the user's pins visible after logout by falling back to the local cache.
    refreshPoiList();
}

// Tell the backend who we are so it can merge any anonymous uploads into the account.
async function postAuthLogin() {
    if (!isGoogleSignedIn() || !isBackendEnabled()) return null;
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
        sub: claims.sub
    };
    persistGoogleAuth();
    settlePendingAuthRefresh(true);   // unblock any silent refresh waiting on this token
    scheduleGoogleAuthRefresh();      // line up the next pre-expiry refresh
    updateGpxModalAuthUI();
    updatePoiModalAuthUI();
    if (statusDiv) {
        statusDiv.textContent = (t.status_signed_in || 'Signed in as {email}.')
            .replace('{email}', googleAuth.email || googleAuth.name || '');
    }
    // Merge anonymous uploads into the account, then show the account's files + POIs.
    postAuthLogin().finally(() => { refreshUploadedFiles(); refreshPoiList(); });
}

window.signOutGoogle = function () {
    const t = translations[currentLang];
    clearGoogleAuthState();
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

function initGoogleAuth() {
    if (googleAuthInitialized) return;
    if (!isBackendEnabled() || !GOOGLE_CLIENT_ID) return;

    // Restore a stored, still-valid session right away (independent of GIS loading).
    const stored = loadStoredGoogleAuth();
    if (stored && stored.token && stored.exp && stored.exp * 1000 > Date.now()) {
        googleAuth = stored;
        scheduleGoogleAuthRefresh();
    }
    updateGpxModalAuthUI();
    updatePoiModalAuthUI();
    if (isGoogleSignedIn()) refreshPoiList();

    whenGisReady(() => {
        googleAuthInitialized = true;
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
            // Returning user without a valid stored token: try a silent One Tap re-auth.
            if (!isGoogleSignedIn() && stored) {
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
            // Token expired/rejected: try one silent refresh, then reload with the
            // fresh token; otherwise drop it and reload as the anonymous session.
            if (!authRetried && await refreshGoogleAuth()) {
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

function getElevationBarHeight() {
    if (!elevationProfileData) return 0;
    const container = document.getElementById('elevation-profile');
    if (!container || container.style.display === 'none') return 0;

    const body = document.getElementById('elevation-profile-body');
    const rect = body ? body.getBoundingClientRect() : container.getBoundingClientRect();
    if (rect.height > 0) {
        return rect.height;
    }

    if (elevationProfileMinimized) return 26;
    return window.innerWidth >= 600 ? 150 : 130;
}

function adjustMapControlsForElevation() {
    const h = getElevationBarHeight();
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
    // above the elevation profile bar as well.
    const mapSliderStack = document.getElementById('map-slider-stack');
    if (mapSliderStack) {
        mapSliderStack.style.bottom = h > 0
            ? `calc(${Math.ceil(h)}px + 10px + env(safe-area-inset-bottom, 0px))`
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

    const elevationProfileBody = document.getElementById('elevation-profile-body');
    if (elevationProfileBody && 'ResizeObserver' in window) {
        let lastBodyWidth = 0;
        let lastBodyHeight = 0;
        const resizeObserver = new ResizeObserver((entries) => {
            const entry = entries[0];
            if (!entry || !elevationProfileData) return;

            const width = entry.contentRect.width;
            const height = entry.contentRect.height;
            if (Math.abs(width - lastBodyWidth) < 0.5 && Math.abs(height - lastBodyHeight) < 0.5) {
                return;
            }

            lastBodyWidth = width;
            lastBodyHeight = height;
            adjustMapControlsForElevation();
            if (!elevationProfileMinimized) {
                scheduleElevationProfileRedraw();
            }
        });
        resizeObserver.observe(elevationProfileBody);
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

function updateUI() {
    if (!zoomLabel) return;
    const t = translations[currentLang];
    const zoom = map.getZoom();
    const displayZoom = Number.isInteger(zoom) ? zoom.toString() : zoom.toFixed(1);
    zoomLabel.innerText = 'Zoom: ' + displayZoom;
    zoomLabel.style.display = isZoomShown() ? '' : 'none';

    const scaleLabel = document.getElementById('scale-level');
    if (scaleLabel) {
        if (isScaleShown()) {
            scaleLabel.innerText = (t.scale_label || 'Scale') + ': ' + formatScale(niceScaleDenominator(computeScaleDenominator()));
            scaleLabel.style.display = '';
        } else {
            scaleLabel.style.display = 'none';
        }
    }

    const gpsDist = document.getElementById('center-gps-dist');
    if (gpsDist) {
        if (lastGpsPosition && isCenterGpsShown()) {
            const c = map.getCenter();
            const m = haversineDistance(c.lat, c.lng, lastGpsPosition.lat, lastGpsPosition.lng);
            gpsDist.innerText = (t.center_to_gps_label || 'Center to GPS') + ': ' + formatDistance(m);
            gpsDist.style.display = '';
        } else {
            gpsDist.style.display = 'none';
        }
    }

    const coordsLabel = document.getElementById('coords-level');
    if (coordsLabel) {
        if (isCoordsShown()) {
            const c = map.getCenter();
            coordsLabel.innerText = (t.coords_label || 'Coords') + ': ' + c.lat.toFixed(5) + ', ' + c.lng.toFixed(5);
            coordsLabel.title = t.coords_copy_hint || 'Tap to copy';
            coordsLabel.style.display = '';
        } else {
            coordsLabel.style.display = 'none';
        }
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

// Decode the elevation (meters) of a single pixel within a loaded Terrarium tile.
// Returns null for no-data (transparent) pixels.
function decodeElevationPixel(img, pixelX, pixelY) {
    spCtx.imageSmoothingEnabled = false;
    spCtx.clearRect(0, 0, 1, 1);
    spCtx.drawImage(img, pixelX, pixelY, 1, 1, 0, 0, 1, 1);
    const pData = spCtx.getImageData(0, 0, 1, 1).data;
    if (pData[3] === 0) return null;
    return (pData[0] * 256 + pData[1] + pData[2] / 256) - 32768;
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

async function updateCenterElevation() {
    if (!centerHeightDisplay) return;
    const useCompactElevationStatus = window.innerWidth <= 600;
    const center = map.getCenter();
    if (scanBtn) scanBtn.disabled = true;
    if (climbBtn) climbBtn.disabled = true;
    if (slopeBtn) slopeBtn.disabled = true;
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
        if (useCompactElevationStatus) {
            mobileElevationText = "N/A";
            const t = translations[currentLang];
            statusDiv.textContent = (t.status_elevation || "Elevation") + ": N/A";
        }
    };

    try {
        const img = await loadElevationTile(zoom, tileX, tileY);
        const h = decodeElevationPixel(img, pixelX, pixelY);
        if (h === null) {
            showNoData();
        } else {
            centerHeightDisplay.textContent = formatElevation(h);
            if (useCompactElevationStatus) {
                const t = translations[currentLang];
                mobileElevationText = formatElevation(h);
                statusDiv.textContent = (t.status_elevation || "Elevation") + ": " + mobileElevationText;
            }
        }
        if (scanBtn) scanBtn.disabled = false;
        if (climbBtn) climbBtn.disabled = false;
        if (slopeBtn) slopeBtn.disabled = false;
    } catch (err) {
        showNoData();
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

async function analyzeTerrain() {
    const t = translations[currentLang];
    clearResults();
    if (scanBtn) scanBtn.disabled = true;
    statusDiv.textContent = t.status_loading;
    try {
        await flattenViewForAnalysis();
        await fetchAnalysisData();
        statusDiv.textContent = t.status_calc;
        requestAnimationFrame(() => {
            findPeaks();
            if (window.innerWidth > 600) updateCenterElevation();
        });
    } catch (err) {
        console.error(err);
        statusDiv.textContent = t.status_error + err.message;
        if (window.innerWidth > 600) updateCenterElevation();
    }
}

async function findSteepestClimb() {
    const t = translations[currentLang];
    clearResults();
    if (climbBtn) climbBtn.disabled = true;
    statusDiv.textContent = t.status_loading;
    try {
        await flattenViewForAnalysis();
        await fetchAnalysisData();
        statusDiv.textContent = t.status_calc;
        requestAnimationFrame(() => {
            calculateMaxClimb();
            if (window.innerWidth > 600) updateCenterElevation();
        });
    } catch (err) {
        statusDiv.textContent = t.status_error + err.message;
        if (window.innerWidth > 600) updateCenterElevation();
    }
}

window.generateSlopeMap = async function () {
    const t = translations[currentLang];
    clearResults();
    if (slopeBtn) slopeBtn.disabled = true;
    statusDiv.textContent = t.status_loading;
    try {
        await fetchAnalysisData();
        statusDiv.textContent = t.status_calc;
        requestAnimationFrame(() => {
            _renderSlopeMap();
            if (window.innerWidth > 600) updateCenterElevation();
        });
    } catch (err) {
        statusDiv.textContent = t.status_error + err.message;
        if (window.innerWidth > 600) updateCenterElevation();
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

    // Calculate cellSize (metres per pixel) using Web Mercator resolution formula
    const lat = searchCenterLatLng.lat;
    const metersPerPixelAtZoom = (156543.03392 * Math.cos(lat * Math.PI / 180)) / Math.pow(2, analysisZoom);
    // Mapterhorn tiles are 512px but represent 256 tile units, so pixel size is halved
    const cellSize = metersPerPixelAtZoom / 2;

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
        return (imgData[i] * 256 + imgData[i + 1] + imgData[i + 2] / 256) - 32768;
    }

    for (let y = 1; y < h - 1; y++) {
        for (let x = 1; x < w - 1; x++) {
            if (useRadius) {
                const latlng = canvasPointToLatLng(x, y);
                if (searchCenterLatLng.distanceTo(latlng) > searchRadiusMeters) continue;
            }

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

// Generalized function
function loadAndDrawTiles(urlTemplate, targetCtx, tiles, nwPixelOrigin) {
    const promises = tiles.map(t => {
        return new Promise((resolve) => {
            const img = new Image();
            img.crossOrigin = "Anonymous";
            img.src = urlTemplate.replace('{z}', t.z).replace('{x}', t.x).replace('{y}', t.y);
            img.onload = () => {
                const tilePos = new L.Point(t.x * 256, t.y * 256);
                const offset = tilePos.subtract(nwPixelOrigin);
                targetCtx.drawImage(img, offset.x, offset.y, 256, 256);
                resolve();
            };
            img.onerror = () => resolve();
        });
    });
    return Promise.all(promises);
}

// Convert canvas pixel position to lat/lng using the analysis zoom
function canvasPointToLatLng(x, y) {
    const pixelPoint = analysisNwOrigin.add(L.point(x, y));
    return map.unproject(pixelPoint, analysisZoom);
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
    let candidates = [];
    for (let y = 0; y < h; y += 2) {
        for (let x = 0; x < w; x += 2) {
            const i = (y * w + x) * 4;
            if (imgData[i + 3] < 255) continue;

            // CHECK WATER (if enabled)
            if (waterData && isWaterPixel(waterData[i], waterData[i + 1], waterData[i + 2])) {
                continue; // Skip if it is water
            }

            const height = (imgData[i] * 256 + imgData[i + 1] + imgData[i + 2] / 256) - 32768;
            if (height > -50) candidates.push({ x, y, h: height });
        }
    }
    const validPeaks = [];
    for (let p of candidates) {
        const latlng = canvasPointToLatLng(p.x, p.y);
        const dist = searchCenterLatLng.distanceTo(latlng);
        if (dist <= maxRadiusMeters) {
            p.dist = dist; p.lat = latlng.lat; p.lng = latlng.lng;
            validPeaks.push(p);
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

        const popupContent = `
            <span class="popup-header" style="${isHighest ? 'color:#b8860b' : ''}">${t.res_rank} #${idx + 1}</span>
            <span class="popup-height">${formatElevation(p.h)}</span>
            <span class="popup-meta">${t.res_dist}: ${formatDistance(p.dist)}</span>
            <div class="coord-box">
                <span>${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}</span>
                <button class="copy-btn" title="${t.btn_copy_coords}" onclick="copyCoords(${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}, this)">📋</button>
            </div>`;
        const marker = L.marker([p.lat, p.lng], markerOptions).addTo(map).bindPopup(popupContent);
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

    const step = 4;
    for (let y = step; y < h - step; y += step) {
        for (let x = step; x < w - step; x += step) {

            // CHECK WATER AT START POINT (if enabled)
            const i1 = (y * w + x) * 4;
            if (waterData && isWaterPixel(waterData[i1], waterData[i1 + 1], waterData[i1 + 2])) continue;

            const startLatLng = canvasPointToLatLng(x, y);
            if (searchCenterLatLng.distanceTo(startLatLng) > searchRadiusMeters) continue;

            if (imgData[i1 + 3] < 255) continue;
            const h1 = (imgData[i1] * 256 + imgData[i1 + 1] + imgData[i1 + 2] / 256) - 32768;

            for (let a = 0; a < angles; a++) {
                const x2 = Math.round(x + angleOffsets[a].dx);
                const y2 = Math.round(y + angleOffsets[a].dy);

                if (x2 >= 0 && x2 < w && y2 >= 0 && y2 < h) {

                    // CHECK WATER AT END POINT (if enabled)
                    const i2 = (y2 * w + x2) * 4;
                    if (waterData && isWaterPixel(waterData[i2], waterData[i2 + 1], waterData[i2 + 2])) continue;

                    if (imgData[i2 + 3] < 255) continue;
                    const h2 = (imgData[i2] * 256 + imgData[i2 + 1] + imgData[i2 + 2] / 256) - 32768;

                    // Calculate cumulative ascent along the path
                    // We take steps based on user defined resolution (default 10m), in meters
                    const res = getClimbStepMeters();
                    const numSteps = Math.max(1, Math.floor(climbDistMeters / res));
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

                        const sh = (imgData[si] * 256 + imgData[si + 1] + imgData[si + 2] / 256) - 32768;
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
                        const endLatLng = canvasPointToLatLng(x2, y2);
                        if (searchCenterLatLng.distanceTo(endLatLng) > searchRadiusMeters) continue;

                        candidates.push({
                            diff: cumulativeAscent,
                            start: { x: x, y: y, h: h1, latlng: startLatLng },
                            end: { x: x2, y: y2, h: h2, latlng: endLatLng }
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

            const polyline = L.polyline([res.start.latlng, res.end.latlng], {
                color: isWinner ? 'red' : '#ff7f50',
                weight: isWinner ? 5 : 3,
                opacity: 0.8
            }).addTo(map);
            polylines.push(polyline);

            // Compute shared climb stats
            const searchCenter = getSearchCenter();
            const distStartEnd = res.start.latlng.distanceTo(res.end.latlng);
            const distStartEndStr = formatDistance(distStartEnd);
            const verticalDrop = Math.round(res.end.h - res.start.h);
            const slopePercent = distStartEnd > 0 ? ((verticalDrop / distStartEnd) * 100).toFixed(1) : 0;

            // START POPUP
            const distStart = searchCenter.distanceTo(res.start.latlng);
            const startPopup = `
                <span class="popup-header">${t.res_rank} #${rank} (${t.res_start})</span>
                <span class="popup-height">${t.res_elev}: ${formatElevation(res.start.h)}</span>
                <span class="popup-meta">${t.res_dist_center}: ${formatDistance(distStart)}</span>
                <div class="coord-box">
                    <span>${res.start.latlng.lat.toFixed(5)}, ${res.start.latlng.lng.toFixed(5)}</span>
                    <button class="copy-btn" title="${t.btn_copy_coords}" onclick="copyCoords(${res.start.latlng.lat.toFixed(5)}, ${res.start.latlng.lng.toFixed(5)}, this)">📋</button>
                </div>`;

            const startMarker = L.marker(res.start.latlng, { icon: greenIcon }).addTo(map)
                .bindPopup(startPopup);
            markers.push(startMarker);

            // PEAK POPUP
            const distEnd = searchCenter.distanceTo(res.end.latlng);
            const endPopup = `
                <span class="popup-header" style="${isWinner ? 'color:#b8860b' : ''}">${t.res_rank} #${rank} (${t.res_peak})</span>
                <span class="popup-height">${t.res_climb}: +${formatElevation(res.diff)}</span>
                <span class="popup-meta">${t.res_elev}: ${formatElevation(res.end.h)}</span>
                <span class="popup-meta">${t.res_vertical_drop}: ${verticalDrop >= 0 ? '+' : ''}${formatElevation(verticalDrop)}</span>
                <span class="popup-meta">${t.res_dist_start_end}: ${distStartEndStr}</span>
                <span class="popup-meta">${t.res_slope}: ${slopePercent}%</span>
                <span class="popup-meta">${t.res_dist_center}: ${formatDistance(distEnd)}</span>
                <div class="coord-box">
                    <span>${res.end.latlng.lat.toFixed(5)}, ${res.end.latlng.lng.toFixed(5)}</span>
                    <button class="copy-btn" title="${t.btn_copy_coords}" onclick="copyCoords(${res.end.latlng.lat.toFixed(5)}, ${res.end.latlng.lng.toFixed(5)}, this)">📋</button>
                </div>`;

            const endMarker = L.marker(res.end.latlng, { icon: redIcon }).addTo(map)
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
    return (d[0] * 256 + d[1] + d[2] / 256) - 32768;
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
        elevs.push((all[i] * 256 + all[i + 1] + all[i + 2] / 256) - 32768);
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

// Esc cancels an in-progress POI placement.
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && poiPlacementMode) {
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
    if (isBackendEnabled()) initGoogleAuth();
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
        preserveDrawingBuffer: true
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