// ==========================================
// 1. CONFIGURATION & CONSTANTS
// ==========================================
const APP_VERSION = "2.3.0";
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

// Base64 flags
const FLAG_SE = "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCI+PHJlY3Qgd2lkdGg9IjI0IiBoZWlnaHQ9IjI0IiBmaWxsPSIjMDA2QUE3Ii8+PHBhdGggZD0iTTAgMTJIMjRNOCAwVjI0IiBzdHJva2U9IiNGRUNDMDAiIHN0cm9rZS13aWR0aD0iNCIvPjwvc3ZnPg==";
const FLAG_GB = "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCI+PHJlY3Qgd2lkdGg9IjI0IiBoZWlnaHQ9IjI0IiBmaWxsPSIjMDAyNDdEIi8+PHBhdGggZD0iTTAgMEwyNCAyNE0yNCAwTDAgMjQiIHN0cm9rZT0iI0ZGRkZGRiIgc3Ryb2tlLXdpZHRoPSIyLjUiLz48cGF0aCBkPSJNMCAwTDI0IDI0TTI0IDBMMCAyNCIgc3Ryb2tlPSIjQ0YxNDJCIiBzdHJva2Utd2lkdGg9IjEuMiIvPjxwYXRoIGQ9Ik0xMiAwVjI0TTAgMTJIMjQiIHN0cm9rZT0iI0ZGRkZGRiIgc3Ryb2tlLXdpZHRoPSI0LjUiLz48cGF0aCBkPSJNMTIgMFYyNE0wIDEySDI0IiBzdHJva2U9IiNDRjE0MkIiIHN0cm9rZS13aWR0aD0iMi41Ii8+PC9zdmc+";

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
const DEFAULT_TERRAIN_EXAGGERATION = 1.5;

const MAP_SOURCES = {
    "opentopo": { url: OPENTOPO_URL, attribution: 'OpenTopoMap', maxZoom: 17 },
    "tracetrack": { url: '', attribution: 'Tracetrack', maxZoom: 19 },
    "thunderforest": { url: '', attribution: 'ThunderForest', maxZoom: 22 },
    "jawg_terrain": { url: '', attribution: '&copy; <a href="https://www.jawg.io/">Jawg</a> &copy; OpenStreetMap contributors', maxZoom: 22 },
    "carto_voyager": { url: "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png", attribution: '&copy; <a href="https://carto.com/attributions">CARTO</a>, &copy; OpenStreetMap contributors', maxZoom: 20 },
    "carto_positron": { url: "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png", attribution: '&copy; <a href="https://carto.com/attributions">CARTO</a>, &copy; OpenStreetMap contributors', maxZoom: 20 },
    "lm_map": { url: `${WORKER_URL}/{z}/{x}/{y}`, attribution: '&copy; <a href="https://www.lantmateriet.se/">Lantm\u00e4teriet</a> - CC BY 4.0', maxZoom: 17 },
    "norges_map": { url: NORGES_MAP_URL, attribution: '&copy; <a href="http://www.kartverket.no/">Kartverket</a>', maxZoom: 18 },
    "osm": { url: OSM_URL, attribution: 'OpenStreetMap', maxZoom: 19 },
    "satellite": { url: SATELLITE_URL, attribution: 'Esri', maxZoom: 19 },
    "debug": { url: DATA_TILE_URL, attribution: '<a href="https://github.com/mapterhorn/mapterhorn">Mapterhorn</a> ', maxZoom: ELEVATION_TILE_MAX_ZOOM, opacity: 1 }
};

const WAYMARKED_ATTRIBUTION = '&copy; <a href="https://waymarkedtrails.org/">Waymarked Trails</a> (CC-BY-SA)';
const OVERLAY_SOURCES = {
    "waymarked_hiking": { url: 'https://tile.waymarkedtrails.org/hiking/{z}/{x}/{y}.png', attribution: WAYMARKED_ATTRIBUTION, maxZoom: 18 },
    "waymarked_cycling": { url: 'https://tile.waymarkedtrails.org/cycling/{z}/{x}/{y}.png', attribution: WAYMARKED_ATTRIBUTION, maxZoom: 18 },
    "waymarked_mtb": { url: 'https://tile.waymarkedtrails.org/mtb/{z}/{x}/{y}.png', attribution: WAYMARKED_ATTRIBUTION, maxZoom: 18 },
    "waymarked_skating": { url: 'https://tile.waymarkedtrails.org/skating/{z}/{x}/{y}.png', attribution: WAYMARKED_ATTRIBUTION, maxZoom: 18 }
};
const EXTRA_OVERLAY_STORAGE_KEY = 'topo_extra_overlay'; // selected overlay key, or '' when off
const ROUTE_LEGEND_COLLAPSED_KEY = 'topo_route_legend_collapsed'; // 'true' when the route-names legend is collapsed
const ROUTE_ISOLATED_ID_KEY = 'topo_route_isolated_id';       // relation id of the persisted isolated trail
const ROUTE_ISOLATED_COLOR_KEY = 'topo_route_isolated_color'; // its draw color

// Map each Waymarkedtrails overlay to its API activity subdomain. The route-names
// legend lists the routes in the current viewport via that activity's by_area API
// (https://<activity>.waymarkedtrails.org/api/v1/list/by_area) — the same data the
// overlay tiles are rendered from, and far faster than a generic Overpass query.
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
        className: 'result-popup'
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
        getPitch() {
            return nativeMap.getPitch();
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
const exaggerationInput = document.getElementById('exaggerationInput');

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

let markers = [];
let polylines = [];
let manualClimbMode = false;
let manualClimbPoints = [];    // L.latLng objects
let manualClimbMarkers = [];   // native maplibregl.Marker objects (preview dots)
let manualClimbPolyline = null; // L.polyline (blue preview line)
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

function resolveInitialAppState() {
    const params = new URLSearchParams(location.search);
    const requestedLang = params.get('lang');
    const storedLang = localStorage.getItem('topo_lang') || 'en';
    const sharedMapState = parseSharedMapHash(location.hash);
    const initialLang = translations[requestedLang] ? requestedLang : (translations[storedLang] ? storedLang : 'en');

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
map.addControl(new maplibregl.NavigationControl({ showCompass: false, visualizePitch: false }), 'bottom-right');

// Reset-north compass control
const ResetNorthControl = L.Control.extend({
    options: { position: 'bottomright' },
    onAdd: function (map) {
        const container = L.DomUtil.create('div', 'maplibregl-ctrl maplibregl-ctrl-group reset-north-control');
        const btn = L.DomUtil.create('a', 'reset-north-btn', container);
        const t = translations[currentLang] || {};
        const resetNorthLabel = t.btn_reset_north || 'Reset North';
        btn.href = '#';
        btn.title = resetNorthLabel;
        btn.setAttribute('role', 'button');
        btn.setAttribute('aria-label', resetNorthLabel);
        btn.innerHTML = '<svg class="compass-icon" viewBox="0 0 24 24" width="18" height="18"><polygon points="12,2 15,14 12,12 9,14" fill="#e53935"/><polygon points="12,22 9,14 12,12 15,14" fill="#999"/></svg>';
        L.DomEvent.disableClickPropagation(container);
        L.DomEvent.on(btn, 'click', function (e) {
            L.DomEvent.preventDefault(e);
            map.setBearing(0);
        });
        this._btn = btn;
        map.on('rotate', this._onRotate, this);
        return container;
    },
    onRemove: function (map) {
        map.off('rotate', this._onRotate, this);
    },
    _onRotate: function (e) {
        const bearing = e.target.getBearing();
        this._btn.querySelector('.compass-icon').style.transform = 'rotate(' + (-bearing) + 'deg)';
        this._btn.closest('.reset-north-control').style.display = bearing === 0 ? 'none' : 'block';
    }
});
new ResetNorthControl().addTo(map);

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
        const response = await fetch(API_BASE + '/files/' + encodeURIComponent(gpxId), {
            method: 'DELETE',
            credentials: 'same-origin',
            headers: authHeaders()
        });
        if (response.status === 401 && isGoogleSignedIn()) {
            clearGoogleAuthState();
        }
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

function updateLanguage() {
    const t = translations[currentLang];
    const isEn = currentLang === 'en';

    const flagImg = document.getElementById('flag-icon');
    if (flagImg) flagImg.src = isEn ? FLAG_GB : FLAG_SE;

    if (document.getElementById('app-title')) {
        document.getElementById('app-title').textContent = t.title;
        document.title = t.title;
        document.getElementById('liveLabel').textContent = t.live_label;
        document.getElementById('lbl-layers').textContent = t.lbl_layers;
        document.getElementById('lbl-radius').textContent = t.lbl_radius;
        document.getElementById('lbl-points').textContent = t.lbl_points;
        document.getElementById('lbl-show-circle').textContent = t.lbl_show_circle;
        document.querySelector('#lbl-lock-circle .btn-label').textContent = t.lbl_lock_circle;
        if (document.getElementById('lbl-enable-overzoom')) document.getElementById('lbl-enable-overzoom').textContent = t.lbl_enable_overzoom;
        if (document.getElementById('lbl-extra-layer-select')) document.getElementById('lbl-extra-layer-select').textContent = t.lbl_extra_layer_select;
        if (extraLayerSelect) {
            const noneOpt = extraLayerSelect.querySelector('option[value="none"]');
            if (noneOpt) noneOpt.textContent = t.overlay_none;
        }
        if (routeLegend) refreshRouteLegend();
        if (document.getElementById('lbl-enable-tilt')) document.getElementById('lbl-enable-tilt').textContent = t.lbl_enable_tilt;
        if (enable3dBtn) enable3dBtn.title = t.lbl_enable_3d;
        if (document.getElementById('lbl-3d-exaggeration')) document.getElementById('lbl-3d-exaggeration').textContent = t.lbl_3d_exaggeration;
        document.querySelector('#scan-btn .btn-label').textContent = t.btn_scan;
        document.getElementById('lbl-climb-dist').textContent = t.lbl_climb_dist;
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
        if (document.getElementById('info-changelog-title')) document.getElementById('info-changelog-title').textContent = t.info_changelog_title;
        document.getElementById('info-privacy').textContent = t.info_privacy;
        if (document.getElementById('info-advanced-title')) document.getElementById('info-advanced-title').textContent = t.advanced_settings;
        if (document.getElementById('info-debug-title')) document.getElementById('info-debug-title').textContent = t.debug_settings;
        if (document.getElementById('lbl-water-analysis')) document.getElementById('lbl-water-analysis').textContent = t.lbl_water_analysis;
        if (document.getElementById('lbl-step-size')) document.getElementById('lbl-step-size').textContent = t.lbl_step_size;
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
        if (document.getElementById('opt-unit-km')) document.getElementById('opt-unit-km').textContent = t.unit_km;
        if (document.getElementById('opt-unit-mi')) document.getElementById('opt-unit-mi').textContent = t.unit_mi;
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
        const waterToggle = document.getElementById('water-analysis-toggle');
        if (waterToggle) waterToggle.checked = waterAnalysisEnabled;
        const stepInput = document.getElementById('stepSizeInput');
        if (stepInput) stepInput.value = climbStepRes;
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

        // Update notification text if visible
        const updateSnackbar = document.getElementById('update-notification');
        if (updateSnackbar) {
            document.getElementById('update-msg').textContent = t.update_available;
            document.getElementById('update-btn').textContent = t.update_btn;
        }

        // Install button and mobile install bar
        const installBtn = document.getElementById('install-app-btn');
        if (installBtn) installBtn.querySelector('.btn-label').textContent = t.btn_install_app;
        const installMsg = document.getElementById('mobile-install-msg');
        if (installMsg) installMsg.textContent = t.mobile_install_msg;
        const mobileInstallBtn = document.getElementById('mobile-install-btn');
        if (mobileInstallBtn) mobileInstallBtn.textContent = t.btn_install;
        const languageBtn = document.querySelector('.header-buttons .circle-btn:not(#share-map-btn):not(.info-btn)');
        if (languageBtn) {
            const label = t.btn_switch_language || 'Switch Language';
            languageBtn.title = label;
            languageBtn.setAttribute('aria-label', label);
        }
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
        const gpsBtn = document.querySelector('.search-group .icon-btn[onclick="locateUser()"]');
        if (gpsBtn) {
            const label = t.btn_gps || 'GPS';
            gpsBtn.title = label;
            gpsBtn.setAttribute('aria-label', label);
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
        const resetNorthBtn = document.querySelector('.reset-north-btn');
        if (resetNorthBtn) {
            const label = t.btn_reset_north || 'Reset North';
            resetNorthBtn.title = label;
            resetNorthBtn.setAttribute('aria-label', label);
        }
        if (shareMapBtn) {
            shareMapBtn.title = t.btn_share_map_title || 'Share Map View';
            shareMapBtn.setAttribute('aria-label', t.btn_share_map_title || 'Share Map View');
        }
    }
}

function toggleLanguage() {
    currentLang = currentLang === 'sv' ? 'en' : 'sv';
    localStorage.setItem('topo_lang', currentLang);
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
    return exaggerationInput ? (parseFloat(exaggerationInput.value) || DEFAULT_TERRAIN_EXAGGERATION) : DEFAULT_TERRAIN_EXAGGERATION;
}

function is3dEnabled() {
    return !!(enable3dBtn && enable3dBtn.classList.contains('active'));
}

function syncTerrainControls() {
    if (enable3dBtn) enable3dBtn.classList.toggle('active', is3dEnabled());
}

function setTerrainEnabled(enabled) {
    if (enable3dBtn) enable3dBtn.classList.toggle('active', enabled);
    if (!map) return;
    if (enabled) {
        map.setTerrain({ exaggeration: getTerrainExaggeration() });
        map.easeTo({ pitch: 60, duration: 1000 });
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
    // Changing the overlay selection drops any isolated trail (and its persistence).
    removeIsolatedTrailLayers();
    persistIsolatedSelection();
    if (key && key !== 'none' && OVERLAY_SOURCES[key]) {
        applyExtraOverlay(key);
        localStorage.setItem(EXTRA_OVERLAY_STORAGE_KEY, key);
        routeNamesOn = true;
        refreshRouteLegend();
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
    removeIsolatedTrailLayers();
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

// Hide the zoom controls while the route-names legend is shown (overlay on +
// route names enabled), so the legend has the bottom-right corner to itself.
// While shown, the compass also moves to the bottom-left (above the attribution)
// so it doesn't collide with the legend; otherwise it stays bottom-right.
function updateZoomControlVisibility() {
    const legendActive = routeNamesOn && isOverlayOn();
    document.body.classList.toggle('route-legend-on', legendActive);
    moveCompassControl(legendActive);
}

function moveCompassControl(toLeft) {
    const compass = document.querySelector('.reset-north-control');
    if (!compass) return;
    const target = document.querySelector(toLeft ? '.maplibregl-ctrl-bottom-left' : '.maplibregl-ctrl-bottom-right');
    if (!target) return;
    // Keep the compass at the top of the corner: above the zoom controls on the
    // right, above the attribution on the left.
    if (compass.parentElement !== target || target.firstChild !== compass) {
        target.insertBefore(compass, target.firstChild);
    }
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

function locateUser() {
    const t = translations[currentLang];
    if (!navigator.geolocation) { statusDiv.textContent = t.status_gps_missing; return; }
    statusDiv.textContent = t.status_gps_fetch;
    navigator.geolocation.getCurrentPosition(
        (pos) => { map.setView([pos.coords.latitude, pos.coords.longitude], 13); statusDiv.textContent = t.status_done; },
        () => statusDiv.textContent = t.status_gps_error
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
    const params = new URLSearchParams(location.search);
    params.delete('gpx');
    const queryString = params.toString();
    history.replaceState(null, '', location.pathname + (queryString ? '?' + queryString : '') + location.hash);
    const clearBtn = document.getElementById('gpx-clear-btn');
    if (clearBtn) clearBtn.style.display = 'none';
    const infoDiv = document.getElementById('gpx-track-info');
    if (infoDiv) { infoDiv.style.display = 'none'; infoDiv.innerHTML = ''; }
    hideElevationProfile();
    statusDiv.textContent = translations[currentLang].status_gpx_cleared;
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
        html += `<br><span>${t.gpx_info_gain}:</span> +${Math.round(d.gain)} m`;
        html += `<br><span>${t.gpx_info_loss}:</span> -${Math.round(d.loss)} m`;
    }
    if (d.minElev !== null) {
        html += `<br><span>${t.gpx_info_min_elev}:</span> ${Math.round(d.minElev)} m`;
        html += `<br><span>${t.gpx_info_max_elev}:</span> ${Math.round(d.maxElev)} m`;
    }
    infoDiv.innerHTML = html;
    infoDiv.style.display = 'block';
}

function getDistanceUnit() {
    const el = document.getElementById('distanceUnit');
    return el ? el.value : 'km';
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
            el.innerHTML = `▲ ${Math.round(maxPt.ele)} m`;
            currentMarkers.push(new maplibregl.Marker({ element: el })
                .setLngLat([maxPt.lon, maxPt.lat])
                .addTo(map._map));
        }
        if (minPt) {
            const el = document.createElement('div');
            el.className = 'gpx-elev-label min-elev';
            el.innerHTML = `▼ ${Math.round(minPt.ele)} m`;
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

    rebuildGpxLayer();
    updateGpxTrackInfo();
    showElevationProfile();

    if (!options.skipFitBounds) {
        fitGpxBounds(parsedGpx.segments, parsedGpx.waypoints);
    }

    const clearBtn = document.getElementById('gpx-clear-btn');
    if (clearBtn) clearBtn.style.display = 'block';

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
    try {
        if (window.google && google.accounts && google.accounts.id) {
            google.accounts.id.disableAutoSelect();
        }
    } catch (e) { /* ignore */ }
    updateGpxModalAuthUI();
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
        console.log('[GPX auth] POST /api/auth/login ->', response.status,
            response.status === 404 ? '(old backend? route missing)' : '');
        if (response.status === 401) { clearGoogleAuthState(); return null; }
        if (!response.ok) return null;
        return await response.json();
    } catch (e) {
        console.log('[GPX auth] /api/auth/login request failed', e);
        return null;
    }
}

// Logs exactly what reaches the backend so deployment issues (old build, proxy
// stripping Authorization, clock skew, wrong client id) are visible in the console.
async function runGoogleAuthDiagnostics() {
    if (!isBackendEnabled() || !googleAuth || !googleAuth.token) return;
    try {
        const r = await fetch(API_BASE + '/auth/debug', {
            method: 'POST',
            credentials: 'same-origin',
            headers: Object.assign({ 'Content-Type': 'application/json' }, authHeaders()),
            body: JSON.stringify({ credential: googleAuth.token })
        });
        const data = await r.json().catch(() => null);
        console.log('[GPX auth] /api/auth/debug ->', r.status, data);
    } catch (e) {
        console.log('[GPX auth] /api/auth/debug request failed', e);
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
    updateGpxModalAuthUI();
    if (statusDiv) {
        statusDiv.textContent = (t.status_signed_in || 'Signed in as {email}.')
            .replace('{email}', googleAuth.email || googleAuth.name || '');
    }
    // Merge anonymous uploads into the account, then show the account's files.
    runGoogleAuthDiagnostics();
    postAuthLogin().finally(() => { refreshUploadedFiles(); });
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
    }
    updateGpxModalAuthUI();

    whenGisReady(() => {
        googleAuthInitialized = true;
        try {
            google.accounts.id.initialize({
                client_id: GOOGLE_CLIENT_ID,
                callback: handleGoogleCredential,
                auto_select: true,
                use_fedcm_for_prompt: true
            });
            const btnEl = document.getElementById('google-signin-btn');
            if (btnEl) {
                google.accounts.id.renderButton(btnEl, {
                    theme: 'outline',
                    size: 'large',
                    type: 'standard',
                    shape: 'pill',
                    text: 'signin_with',
                    logo_alignment: 'left',
                    width: 240
                });
            }
            // Returning user without a valid stored token: try a silent One Tap re-auth.
            if (!isGoogleSignedIn() && stored) {
                google.accounts.id.prompt();
            }
        } catch (e) {
            // GIS init failed (blocked/offline): stay on the anonymous flow.
        }
        updateGpxModalAuthUI();
    });
}

async function refreshUploadedFiles() {
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
            // Token expired/rejected: drop it and reload as the anonymous session.
            clearGoogleAuthState();
            return refreshUploadedFiles();
        }
        if (!response.ok) {
            throw new Error('Failed to fetch uploaded GPX files');
        }
        const payload = await response.json();
        const files = Array.isArray(payload.files) ? payload.files : [];
        console.log('[GPX auth] GET /api/files ->', response.status, 'count:', files.length, 'signedIn:', isGoogleSignedIn());
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

    const response = await fetch(API_BASE + '/upload', {
        method: 'POST',
        credentials: 'same-origin',
        headers: authHeaders(),
        body: formData
    });
    if (response.status === 401 && isGoogleSignedIn()) {
        clearGoogleAuthState();
    }
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
document.getElementById('distanceUnit').addEventListener('change', function () {
    localStorage.setItem('topo_distance_unit', this.value);
    rebuildGpxLayer();
    updateGpxTrackInfo();
    if (elevationProfileData && !elevationProfileMinimized) drawElevationProfile();
});

// ==========================================
// ELEVATION PROFILE BAR
// ==========================================
let elevationProfileData = null; // [{dist, ele, lat, lon}, ...]
let elevationProfileMinimized = true;
let elevationProfileMarker = null;
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
        ctx.fillText(Math.round(e) + ' m', PAD_LEFT - 4, y);
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
    const distStr = distVal >= 1 ? distVal.toFixed(1) + ' ' + unitLabel : Math.round(point.dist) + ' m';
    infoEl.textContent = distStr + '  •  ' + Math.round(point.ele) + ' m';
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
}

function removeElevationMarker() {
    if (elevationProfileMarker) {
        elevationProfileMarker.remove();
        elevationProfileMarker = null;
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
    markerEl.style.display = 'block';
    markerEl.style.left = `${point.x}px`;
    markerEl.style.top = `${point.y}px`;
    markerEl.style.border = `2px solid ${markerColor}`;

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
    const zoom = map.getZoom();
    const displayZoom = Number.isInteger(zoom) ? zoom.toString() : zoom.toFixed(1);
    zoomLabel.innerText = 'Zoom: ' + displayZoom;
    const searchCenter = getSearchCenter();
    const radiusKm = parseFloat(radiusInput.value) || 5;
    const markerColor = isLocked ? '#e67e22' : '#007bff';

    // Show circle when checkbox is checked OR when a slope map is active
    const radiusM = radiusKm * 1000;
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



    // Correct Update: offset within the 256-unit tile grid, scaled to 512px tile
    const pixelX = Math.floor((point.x - tileX * 256) * 2);
    const pixelY = Math.floor((point.y - tileY * 256) * 2);

    const url = DATA_TILE_URL.replace('{z}', zoom).replace('{x}', tileX).replace('{y}', tileY);

    try {
        const img = new Image();
        img.crossOrigin = "Anonymous";
        img.src = url;
        img.onload = () => {
            spCtx.imageSmoothingEnabled = false; // UPDATED: Disable smoothing
            spCtx.clearRect(0, 0, 1, 1);
            spCtx.drawImage(img, pixelX, pixelY, 1, 1, 0, 0, 1, 1);
            const pData = spCtx.getImageData(0, 0, 1, 1).data;

            if (pData[3] === 0) { // UPDATED: Handle transparent pixels (no data)
                centerHeightDisplay.textContent = "N/A";
                if (useCompactElevationStatus) {
                    mobileElevationText = "N/A";
                    const t = translations[currentLang];
                    statusDiv.textContent = (t.status_elevation || "Elevation") + ": N/A";
                }
            } else {
                const h = (pData[0] * 256 + pData[1] + pData[2] / 256) - 32768;
                centerHeightDisplay.textContent = Math.round(h) + " m";
                if (useCompactElevationStatus) {
                    const t = translations[currentLang];
                    mobileElevationText = Math.round(h) + " m";
                    statusDiv.textContent = (t.status_elevation || "Elevation") + ": " + mobileElevationText;
                }
            }

            if (scanBtn) scanBtn.disabled = false;
            if (climbBtn) climbBtn.disabled = false;
            if (slopeBtn) slopeBtn.disabled = false;
        };
        img.onerror = () => {
            centerHeightDisplay.textContent = "N/A";
            if (useCompactElevationStatus) {
                mobileElevationText = "N/A";
                const t = translations[currentLang];
                statusDiv.textContent = (t.status_elevation || "Elevation") + ": N/A";
            }
        };
    } catch (err) {
        centerHeightDisplay.textContent = "N/A";
        if (useCompactElevationStatus) {
            mobileElevationText = "N/A";
            const t = translations[currentLang];
            statusDiv.textContent = (t.status_elevation || "Elevation") + ": N/A";
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

async function analyzeTerrain() {
    const t = translations[currentLang];
    clearResults();
    if (scanBtn) scanBtn.disabled = true;
    statusDiv.textContent = t.status_loading;
    try {
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
    const searchRadiusMeters = (parseFloat(radiusInput.value) || 5) * 1000;
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
    const maxRadiusMeters = (parseFloat(radiusInput.value) || 5) * 1000;
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
        const distKm = (p.dist / 1000).toFixed(2);
        const isHighest = (idx === 0);
        const markerOptions = (idx < 3) ? { icon: rankIcons[idx], zIndexOffset: 1000 - idx } : {};

        const popupContent = `
            <span class="popup-header" style="${isHighest ? 'color:#b8860b' : ''}">${t.res_rank} #${idx + 1}</span>
            <span class="popup-height">${Math.round(p.h)} m</span>
            <span class="popup-meta">${t.res_dist}: ${distKm} km</span>
            <div class="coord-box">
                <span>${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}</span>
                <button class="copy-btn" title="Kopiera" onclick="copyCoords(${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}, this)">📋</button>
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
    const searchRadiusMeters = (parseFloat(radiusInput.value) || 5) * 1000;
    const climbDistMeters = parseFloat(climbDistInput.value) || 200;
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
                    // We take steps based on user defined resolution (default 10m)
                    const res = parseInt(document.getElementById('stepSizeInput').value) || 10;
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
            const distStartEndStr = distStartEnd >= 1000 ? (distStartEnd / 1000).toFixed(2) + ' km' : Math.round(distStartEnd) + ' m';
            const verticalDrop = Math.round(res.end.h - res.start.h);
            const slopePercent = distStartEnd > 0 ? ((verticalDrop / distStartEnd) * 100).toFixed(1) : 0;

            // START POPUP
            const distStart = searchCenter.distanceTo(res.start.latlng);
            const distKmStart = (distStart / 1000).toFixed(2);
            const startPopup = `
                <span class="popup-header">${t.res_rank} #${rank} (${t.res_start})</span>
                <span class="popup-height">${t.res_elev}: ${Math.round(res.start.h)} m</span>
                <span class="popup-meta">${t.res_dist_center}: ${distKmStart} km</span>
                <div class="coord-box">
                    <span>${res.start.latlng.lat.toFixed(5)}, ${res.start.latlng.lng.toFixed(5)}</span>
                    <button class="copy-btn" title="Kopiera" onclick="copyCoords(${res.start.latlng.lat.toFixed(5)}, ${res.start.latlng.lng.toFixed(5)}, this)">📋</button>
                </div>`;

            const startMarker = L.marker(res.start.latlng, { icon: greenIcon }).addTo(map)
                .bindPopup(startPopup);
            markers.push(startMarker);

            // PEAK POPUP
            const distEnd = searchCenter.distanceTo(res.end.latlng);
            const distKmEnd = (distEnd / 1000).toFixed(2);
            const endPopup = `
                <span class="popup-header" style="${isWinner ? 'color:#b8860b' : ''}">${t.res_rank} #${rank} (${t.res_peak})</span>
                <span class="popup-height">${t.res_climb}: +${Math.round(res.diff)} m</span>
                <span class="popup-meta">${t.res_elev}: ${Math.round(res.end.h)} m</span>
                <span class="popup-meta">${t.res_vertical_drop}: ${verticalDrop >= 0 ? '+' : ''}${verticalDrop} m</span>
                <span class="popup-meta">${t.res_dist_start_end}: ${distStartEndStr}</span>
                <span class="popup-meta">${t.res_slope}: ${slopePercent}%</span>
                <span class="popup-meta">${t.res_dist_center}: ${distKmEnd} km</span>
                <div class="coord-box">
                    <span>${res.end.latlng.lat.toFixed(5)}, ${res.end.latlng.lng.toFixed(5)}</span>
                    <button class="copy-btn" title="Kopiera" onclick="copyCoords(${res.end.latlng.lat.toFixed(5)}, ${res.end.latlng.lng.toFixed(5)}, this)">📋</button>
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
let newWorker;
let isAppRefreshInProgress = false;

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

function initServiceWorker() {
    if (!('serviceWorker' in navigator)) return;

    navigator.serviceWorker.register('./service-worker.js').then(reg => {
        reg.addEventListener('updatefound', () => {
            newWorker = reg.installing;
            newWorker.addEventListener('statechange', () => {
                if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                    showUpdateNotification();
                }
            });
        });
    });

    let refreshing = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (refreshing) return;
        if (isAppRefreshInProgress) return;
        window.location.reload();
        refreshing = true;
    });
}

function showUpdateNotification() {
    const t = translations[currentLang];
    const snackbar = document.getElementById('update-notification');
    const msg = document.getElementById('update-msg');
    const btn = document.getElementById('update-btn');

    if (snackbar && msg && btn) {
        msg.textContent = t.update_available;
        btn.textContent = t.update_btn;
        snackbar.classList.add('show');

        btn.onclick = () => {
            if (newWorker) {
                newWorker.postMessage({ action: 'skipWaiting' });
            }
        };
    }
}

function isMobileDevice() {
    return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) ||
        (window.innerWidth <= 600 && 'ontouchstart' in window);
}

function shouldDelayInstallUiUntilTutorialCompletes() {
    return !localStorage.getItem('topo_tutorial_done') && !hasSharedMapView && !hasSharedGpxLink;
}

function showDeferredInstallUi(mobileDelayMs = 0) {
    if (!deferredInstallPrompt) return;
    if (shouldDelayInstallUiUntilTutorialCompletes() || isTutorialVisible()) return;

    const installBtn = document.getElementById('install-app-btn');
    if (installBtn) installBtn.style.display = 'block';

    if (!isMobileDevice() || localStorage.getItem('topo_install_dismissed')) return;

    const showMobileBar = () => {
        if (!deferredInstallPrompt || shouldDelayInstallUiUntilTutorialCompletes() || isTutorialVisible()) return;
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
    if (!deferredInstallPrompt) return;
    deferredInstallPrompt.prompt();
    deferredInstallPrompt.userChoice.then(() => {
        deferredInstallPrompt = null;
        const installBtn = document.getElementById('install-app-btn');
        if (installBtn) installBtn.style.display = 'none';
        const mobileBar = document.getElementById('mobile-install-bar');
        if (mobileBar) mobileBar.classList.remove('show');
    });
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
    { targetSelector: '.circle-btn:not(.info-btn)', titleKey: 'tutorial_language_title', textKey: 'tutorial_language_text' },
    { targetSelector: '#share-map-btn', titleKey: 'tutorial_share_title', textKey: 'tutorial_share_text' },
    { targetSelector: '.info-btn', titleKey: 'tutorial_info_title', textKey: 'tutorial_info_text' },
    { targetSelector: '.toggle-btn', titleKey: 'tutorial_minimize_title', textKey: 'tutorial_minimize_text' },
    { targetSelector: '.search-group', titleKey: 'tutorial_tools_title', textKey: 'tutorial_tools_text', expandControls: true },
    { targetSelector: '.layer-row', targetSelectorEnd: '#extra-layer-row', titleKey: 'tutorial_layers_title', textKey: 'tutorial_layers_tools_text', expandControls: true, enableRouteOverlay: true },
    { targetSelector: '#radius-controls', targetSelectorEnd: '#group-points', titleKey: 'tutorial_points_title', textKey: 'tutorial_points_text', expandControls: true, expandSection: 'section-points' },
    { targetSelector: '#group-climbs', titleKey: 'tutorial_climb_title', textKey: 'tutorial_climb_text', expandControls: true, expandSection: 'section-climbs' },
    { targetSelector: '#group-slope', titleKey: 'tutorial_slope_title', textKey: 'tutorial_slope_text', expandControls: true, expandSection: 'section-slope' },
    { targetSelector: '#group-routes', titleKey: 'tutorial_routes_title', textKey: 'tutorial_routes_text', expandControls: true, expandSection: 'section-routes' },
    { targetSelector: null, titleKey: 'tutorial_tips_title', textKey: 'tutorial_tips_text' }
];

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
        const distStr = totalDist >= 1000
            ? (totalDist / 1000).toFixed(2) + ' km'
            : Math.round(totalDist) + ' m';

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
    const res = parseInt(document.getElementById('stepSizeInput').value, 10) || 10;
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
        <span class="popup-height">${t.res_elev}: ${Math.round(startElev)} m</span>
        <div class="coord-box">
            <span>${s.lat.toFixed(5)}, ${s.lng.toFixed(5)}</span>
            <button class="copy-btn"
                    onclick="copyCoords(${s.lat.toFixed(5)},${s.lng.toFixed(5)},this)">📋</button>
        </div>`);
    markers.push(startM);

    const endM = L.marker(e, { icon: redIcon }).addTo(map).bindPopup(`
        <span class="popup-header">📏 Manual Climb</span>
        <span class="popup-height">${t.res_climb}: +${Math.round(totalAscent)} m</span>
        <span class="popup-meta">${t.res_elev}: ${Math.round(endElev)} m</span>
        <span class="popup-meta">${t.res_vertical_drop}: ${vertDrop >= 0 ? '+' : ''}${vertDrop} m</span>
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
        crosshair.style.display = 'block';
    } else {
        lockedCenterCoords = null;
        crosshair.style.display = 'none';
    }
    updateUI();
});
if (overzoomCheckbox) {
    overzoomCheckbox.checked = isOverzoomEnabled();
    overzoomCheckbox.addEventListener('change', (e) => {
        localStorage.setItem(OVERZOOM_STORAGE_KEY, e.target.checked);
        applyCurrentLayerMaxZoom();
    });
}
if (extraLayerSelect) {
    // Route names are always shown whenever an overlay is selected; the dropdown's
    // inline onchange (handleExtraLayerChange) drives all user-initiated changes.
    const savedExtra = localStorage.getItem(EXTRA_OVERLAY_STORAGE_KEY) || '';
    if (OVERLAY_SOURCES[savedExtra]) {
        extraLayerSelect.value = savedExtra;
        routeNamesOn = true;
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
if (exaggerationInput) {
    exaggerationInput.value = DEFAULT_TERRAIN_EXAGGERATION.toFixed(1);
    exaggerationInput.addEventListener('input', () => {
        if (is3dEnabled() && map) {
            map.setTerrain({ exaggeration: getTerrainExaggeration() });
        }
    });
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
    stepInput.value = climbStepRes;
    stepInput.addEventListener('change', (e) => {
        climbStepRes = parseInt(e.target.value) || 10;
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
map.on('move', () => {
    updateUI();
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

// Initialize
updateLanguage();
initServiceWorker();
if (layerSelect) {
    layerSelect.value = savedLayer;
}
const savedUnit = localStorage.getItem('topo_distance_unit');
if (savedUnit) {
    const unitSel = document.getElementById('distanceUnit');
    if (unitSel) unitSel.value = savedUnit;
}

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
        if (isOverlayOn() && Number.isFinite(savedIsoId) && savedIsoId) {
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