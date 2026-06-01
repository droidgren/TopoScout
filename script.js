// ==========================================
// 1. CONFIGURATION & CONSTANTS
// ==========================================
const APP_VERSION = "2.0";
const APP_REFRESH_PARAM = 'app-refresh';

// Water analysis (CartoDB Light No Labels)
const WATER_COLOR = { r: 203, g: 210, b: 211 }; // #cbd2d3
const WATER_TOLERANCE = 25;
const WATER_CHECK_URL = "https://basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}.png";

// Base64 flags
const FLAG_SE = "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxNiAxMCI+PHJlY3Qgd2lkdGg9IjE2IiBoZWlnaHQ9IjEwIiBmaWxsPSIjMDA2YWE3Ii8+PHJlY3QgeD0iNSIgd2lkdGg9IjIiIGhlaWdodD0iMTAiIGZpbGw9IiNmZWNjMDAiLz48cmVjdCB5PSI0IiB3aWR0aD0iMTYiIGhlaWdodD0iMiIgZmlsbD0iI2ZlY2MwMCIvPjwvc3ZnPg==";
const FLAG_GB = "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA2MCAzMCI+PHBhdGggZmlsbD0iIzAxMjE2OSIgZD0iTTAgMGg2MHYzMEgwVjB6Ii8+PHBhdGggc3Ryb2tlPSIjZmZmIiBzdHJva2Utd2lkdGg9IjYiIGQ9Ik0wIDAgNjAgMzBNNjAgMCAwIDMwIi8+PHBhdGggc3Ryb2tlPSIjQzgxMDJFIiBzdHJva2Utd2lkdGg9IjQiIGQ9Ik0wIDAgNjAgMzBNNjAgMCAwIDMwIi8+PHBhdGggc3Ryb2tlPSIjZmZmIiBzdHJva2Utd2lkdGg9IjEwIiBkPSJNMzAgMHYzME0wIDE1aDYwIi8+PHBhdGggc3Ryb2tlPSIjQzgxMDJFIiBzdHJva2Utd2lkdGg9IjYiIGQ9Ik0zMCAwdjMwTTAgMTVoNjAiLz48L3N2Zz4=";

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
    "lm_map": { url: `${WORKER_URL}/{z}/{x}/{y}`, attribution: '&copy; <a href="https://www.lantmateriet.se/">Lantm\u00e4teriet</a> - CC BY 4.0', maxZoom: 17 },
    "norges_map": { url: NORGES_MAP_URL, attribution: '&copy; <a href="http://www.kartverket.no/">Kartverket</a>', maxZoom: 18 },
    "osm": { url: OSM_URL, attribution: 'OpenStreetMap', maxZoom: 19 },
    "satellite": { url: SATELLITE_URL, attribution: 'Esri', maxZoom: 19 },
    "debug": { url: DATA_TILE_URL, attribution: '<a href="https://github.com/mapterhorn/mapterhorn">Mapterhorn</a> ', maxZoom: ELEVATION_TILE_MAX_ZOOM, opacity: 1 }
};

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
    return {
        type: 'polyline',
        _latlngs: latlngs.map(toLngLat),
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
                nativeMap.addSource(layer._ids.sourceId, {
                    type: 'geojson',
                    data: {
                        type: 'Feature',
                        geometry: {
                            type: 'LineString',
                            coordinates: layer._latlngs.map((point) => [point.lng, point.lat])
                        }
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
const overzoomCheckbox = document.getElementById('enableOverzoom');
const tiltCheckbox = document.getElementById('enableTilt');
const enable3dCheckbox = document.getElementById('enable3dView');
const exaggerationRow = document.getElementById('exaggeration-row');
const exaggerationSlider = document.getElementById('exaggerationSlider');
const exaggerationValue = document.getElementById('exaggerationVal');

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
let slopeOverlay = null;
let slopeLegend = null;
let gpxSlopeLegend = null;
let slopeMapCenter = null;
let slopeMapRadius = 0;
let slopeMapUsesRadius = false;
let gpxLayer = null;
let gpxTrackData = null; // stores parsed GPX stats for info panel
let currentMarkers = [];
let currentKmMarkers = [];
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
    const match = hash.match(/^map=(.+)$/);
    if (!match) return null;

    const parts = match[1].split('/');
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

    return {
        zoom,
        lat,
        lng,
        layer: isSupportedLayer(layer) ? layer : null
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
    return '#map=' + zoom + '/' + lat + '/' + lng + '/' + activeLayer;
}

function getCurrentShareLink() {
    const params = new URLSearchParams();
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
    copyTextToClipboard(
        getCurrentShareLink(),
        t.status_link_copied || 'Link copied to clipboard.',
        t.status_clipboard_error || 'Could not copy link.'
    );
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
        document.getElementById('lbl-lock-circle').textContent = t.lbl_lock_circle;
        if (document.getElementById('lbl-enable-overzoom')) document.getElementById('lbl-enable-overzoom').textContent = t.lbl_enable_overzoom;
        if (document.getElementById('lbl-enable-tilt')) document.getElementById('lbl-enable-tilt').textContent = t.lbl_enable_tilt;
        if (document.getElementById('lbl-enable-3d')) document.getElementById('lbl-enable-3d').textContent = t.lbl_enable_3d;
        if (document.getElementById('lbl-3d-exaggeration')) document.getElementById('lbl-3d-exaggeration').textContent = t.lbl_3d_exaggeration;
        document.getElementById('scan-btn').textContent = t.btn_scan;
        document.getElementById('lbl-climb-dist').textContent = t.lbl_climb_dist;
        document.getElementById('lbl-num-climbs').textContent = t.lbl_num_climbs;
        document.getElementById('climb-btn').textContent = t.btn_climb;
        document.getElementById('clear-btn').textContent = t.btn_clear;

        document.getElementById('searchInput').placeholder = t.input_search_ph;
        document.getElementById('status').textContent = t.status_ready;

        document.getElementById('info-title').textContent = t.info_title;
        document.getElementById('info-desc').innerHTML = t.info_desc;

        const tutBtn = document.getElementById('start-tutorial-btn');
        if (tutBtn) tutBtn.textContent = t.btn_tutorial;

        document.getElementById('info-creator').textContent = t.info_creator;
        document.getElementById('lbl-version').textContent = t.lbl_version;
        document.getElementById('app-version').textContent = APP_VERSION;
        if (document.getElementById('info-changelog-title')) document.getElementById('info-changelog-title').textContent = t.info_changelog_title;
        document.getElementById('info-privacy').textContent = t.info_privacy;
        if (document.getElementById('info-debug-title')) document.getElementById('info-debug-title').textContent = t.debug_settings;
        if (document.getElementById('lbl-water-analysis')) document.getElementById('lbl-water-analysis').textContent = t.lbl_water_analysis;
        if (document.getElementById('lbl-step-size')) document.getElementById('lbl-step-size').textContent = t.lbl_step_size;
        if (document.getElementById('lbl-peak-min-pixels')) document.getElementById('lbl-peak-min-pixels').textContent = t.lbl_peak_min_pixels;
        if (document.getElementById('lbl-scan-angles')) document.getElementById('lbl-scan-angles').textContent = t.lbl_scan_angles;
        if (document.getElementById('slope-btn')) document.getElementById('slope-btn').textContent = t.btn_slope;
        if (document.getElementById('lbl-slope-filter')) document.getElementById('lbl-slope-filter').textContent = t.lbl_slope_filter;
        if (document.getElementById('lbl-slope-min')) document.getElementById('lbl-slope-min').textContent = t.lbl_slope_min;
        if (document.getElementById('lbl-slope-max')) document.getElementById('lbl-slope-max').textContent = t.lbl_slope_max;
        if (document.getElementById('lbl-slope-opacity')) document.getElementById('lbl-slope-opacity').textContent = t.lbl_slope_opacity;
        if (document.getElementById('section-points-title')) document.getElementById('section-points-title').textContent = t.section_points_title;
        if (document.getElementById('section-climbs-title')) document.getElementById('section-climbs-title').textContent = t.section_climbs_title;
        if (document.getElementById('section-slope-title')) document.getElementById('section-slope-title').textContent = t.section_slope_title;
        if (document.getElementById('section-routes-title')) document.getElementById('section-routes-title').textContent = t.section_routes_title;
        if (document.getElementById('gpx-btn')) document.getElementById('gpx-btn').textContent = t.btn_gpx;
        if (document.getElementById('gpx-clear-btn')) document.getElementById('gpx-clear-btn').textContent = t.btn_gpx_clear;
        if (document.getElementById('lbl-track-color')) document.getElementById('lbl-track-color').textContent = t.lbl_track_color;
        if (document.getElementById('lbl-track-width')) document.getElementById('lbl-track-width').textContent = t.lbl_track_width;
        if (document.getElementById('lbl-km-labels')) document.getElementById('lbl-km-labels').textContent = t.lbl_km_labels;
        if (document.getElementById('lbl-color-slope')) document.getElementById('lbl-color-slope').textContent = t.lbl_color_slope;
        if (document.getElementById('lbl-show-waypoints')) document.getElementById('lbl-show-waypoints').textContent = t.lbl_show_waypoints;
        if (document.getElementById('lbl-show-minmax')) document.getElementById('lbl-show-minmax').textContent = t.lbl_show_minmax;
        if (document.getElementById('opt-unit-km')) document.getElementById('opt-unit-km').textContent = t.unit_km;
        if (document.getElementById('opt-unit-mi')) document.getElementById('opt-unit-mi').textContent = t.unit_mi;
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
        if (installBtn) installBtn.textContent = t.btn_install_app;
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
    return exaggerationSlider ? (parseFloat(exaggerationSlider.value) || DEFAULT_TERRAIN_EXAGGERATION) : DEFAULT_TERRAIN_EXAGGERATION;
}

function syncTerrainControls() {
    if (exaggerationValue && exaggerationSlider) {
        exaggerationValue.textContent = exaggerationSlider.value;
    }
    if (exaggerationRow && enable3dCheckbox) {
        exaggerationRow.style.display = enable3dCheckbox.checked ? 'flex' : 'none';
    }
}

function setTerrainEnabled(enabled) {
    syncTerrainControls();
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
    if (!enabled && enable3dCheckbox && !enable3dCheckbox.checked && map.getPitch() > 0) {
        map.easeTo({ pitch: 0, duration: 300 });
    }
}

function switchLayerTo(layerKey) {
    if (currentLayer) map.removeLayer(currentLayer);
    currentLayer = layers[layerKey];
    if (currentLayer) {
        map.addLayer(currentLayer);
        previousLayerValue = layerKey;
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
        btn.textContent = minimized ? '➕' : '➖';
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
        toggle.textContent = expanded ? '➖' : '➕';
    }
}

function collapseTutorialSections() {
    tutorialSectionIds.forEach((sectionId) => setSectionExpanded(sectionId, false));
}

window.toggleSection = function (sectionId) {
    const content = document.getElementById(sectionId);
    if (!content) return;
    setSectionExpanded(sectionId, content.style.display !== 'block');
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

function invalidateSlopeMapIfSearchAreaChanged() {
    if (!slopeOverlay || !slopeMapCenter) return;

    const searchCenter = getSearchCenter();
    const radiusMeters = (parseFloat(radiusInput.value) || 5) * 1000;
    const centerShiftMeters = searchCenter.distanceTo(slopeMapCenter);

    if (centerShiftMeters <= 1 && Math.abs(radiusMeters - slopeMapRadius) <= 0.5) {
        return;
    }

    clearSlopeMapState(true);
}

window.clearResults = function () {
    markers.forEach(m => map.removeLayer(m));
    polylines.forEach(p => map.removeLayer(p));
    markers = [];
    polylines = [];
    clearSlopeMapState(true);
    statusDiv.textContent = translations[currentLang].status_cleared;
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
    const clearBtn = document.getElementById('gpx-clear-btn');
    if (clearBtn) clearBtn.style.display = 'none';
    const infoDiv = document.getElementById('gpx-track-info');
    if (infoDiv) { infoDiv.style.display = 'none'; infoDiv.innerHTML = ''; }
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

document.getElementById('gpx-file-input').addEventListener('change', function (e) {
    const file = e.target.files[0];
    if (!file) return;
    const t = translations[currentLang];
    const reader = new FileReader();
    reader.onload = function (evt) {
        try {
            const parser = new DOMParser();
            const doc = parser.parseFromString(evt.target.result, 'application/xml');
            if (doc.querySelector('parsererror')) {
                statusDiv.textContent = t.status_gpx_error;
                return;
            }

            clearGpxTrackSourceAndLayers();
            clearMarkerCollection(currentMarkers);
            currentMarkers = [];
            clearMarkerCollection(currentKmMarkers);
            currentKmMarkers = [];
            removeLegendControl(gpxSlopeLegend);
            gpxSlopeLegend = null;
            gpxLayer = null;

            const allSegments = [];
            const waypoints = [];
            let totalPoints = 0;

            // Parse tracks
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

            // Parse routes
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

            // Parse waypoints
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
                statusDiv.textContent = t.status_gpx_empty;
                return;
            }

            // Compute statistics
            const stats = computeTrackStats(allSegments);
            gpxTrackData = { segments: allSegments, waypoints, ...stats };

            // Build and display layers
            rebuildGpxLayer();
            updateGpxTrackInfo();

            // Fit map
            const allCoords = [];
            allSegments.forEach(s => s.forEach(p => allCoords.push([p.lat, p.lon])));
            waypoints.forEach(w => allCoords.push([w.lat, w.lon]));
            if (allCoords.length > 0) {
                map.fitBounds(L.latLngBounds(allCoords).pad(0.1));
            }

            const clearBtn = document.getElementById('gpx-clear-btn');
            if (clearBtn) clearBtn.style.display = 'block';

            statusDiv.textContent = t.status_gpx_loaded.replace('{n}', totalPoints);
        } catch (err) {
            statusDiv.textContent = t.status_gpx_error;
        }
    };
    reader.onerror = function () {
        statusDiv.textContent = translations[currentLang].status_gpx_error;
    };
    reader.readAsText(file);
    e.target.value = '';
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
document.getElementById('distanceUnit').addEventListener('change', function () {
    localStorage.setItem('topo_distance_unit', this.value);
    rebuildGpxLayer();
    updateGpxTrackInfo();
});

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
            } else {
                const h = (pData[0] * 256 + pData[1] + pData[2] / 256) - 32768;
                centerHeightDisplay.textContent = Math.round(h) + " m";
            }

            if (scanBtn) scanBtn.disabled = false;
            if (climbBtn) climbBtn.disabled = false;
            if (slopeBtn) slopeBtn.disabled = false;
        };
        img.onerror = () => { centerHeightDisplay.textContent = "N/A"; };
    } catch (err) { centerHeightDisplay.textContent = "N/A"; }
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
            updateCenterElevation();
        });
    } catch (err) {
        console.error(err);
        statusDiv.textContent = t.status_error + err.message;
        updateCenterElevation();
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
            updateCenterElevation();
        });
    } catch (err) {
        statusDiv.textContent = t.status_error + err.message;
        updateCenterElevation();
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
            updateCenterElevation();
        });
    } catch (err) {
        statusDiv.textContent = t.status_error + err.message;
        updateCenterElevation();
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
                        candidates.push({
                            diff: cumulativeAscent,
                            start: { x: x, y: y, h: h1, latlng: startLatLng },
                            end: { x: x2, y: y2, h: h2, latlng: canvasPointToLatLng(x2, y2) }
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
    const installBtn = document.getElementById('install-app-btn');
    if (installBtn) installBtn.style.display = 'block';
    if (isMobileDevice() && !localStorage.getItem('topo_install_dismissed')) {
        setTimeout(() => {
            const mobileBar = document.getElementById('mobile-install-bar');
            if (mobileBar) mobileBar.classList.add('show');
        }, 1500);
    }
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

const tutorialSteps = [
    { targetSelector: null, titleKey: 'tutorial_welcome_title', textKey: 'tutorial_welcome_text' },
    { targetSelector: '.circle-btn:not(.info-btn)', titleKey: 'tutorial_language_title', textKey: 'tutorial_language_text' },
    { targetSelector: '#share-map-btn', titleKey: 'tutorial_share_title', textKey: 'tutorial_share_text' },
    { targetSelector: '.info-btn', titleKey: 'tutorial_info_title', textKey: 'tutorial_info_text' },
    { targetSelector: '.toggle-btn', titleKey: 'tutorial_minimize_title', textKey: 'tutorial_minimize_text' },
    { targetSelector: '.layer-row', targetSelectorEnd: '.search-group', titleKey: 'tutorial_layers_title', textKey: 'tutorial_layers_text', expandControls: true },
    { targetSelector: '#radius-controls', titleKey: 'tutorial_scan_title', textKey: 'tutorial_scan_text', expandControls: true },
    { targetSelector: '.map-tools-group', titleKey: 'tutorial_map_tools_title', textKey: 'tutorial_map_tools_text', expandControls: true },
    { targetSelector: '#group-points', titleKey: 'tutorial_points_title', textKey: 'tutorial_points_text', expandControls: true, expandSection: 'section-points' },
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
    if (step.expandSection) {
        setSectionExpanded(step.expandSection, true);
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
    if (step.targetSelector) {
        const rect = getTutorialTargetRect(step);
        if (rect) {
            spotlight.style.display = 'block';
            spotlight.style.left = (rect.left - PAD) + 'px';
            spotlight.style.top = (rect.top - PAD) + 'px';
            spotlight.style.width = (rect.width + PAD * 2) + 'px';
            spotlight.style.height = (rect.height + PAD * 2) + 'px';

            // Position tooltip below or above the element
            const margin = 10;
            const tooltipW = tooltip.offsetWidth || 320;
            const tooltipH = tooltip.offsetHeight || 200;
            const spaceBelow = window.innerHeight - rect.bottom;
            let leftPos = Math.max(margin, Math.min(rect.left, window.innerWidth - tooltipW - margin));
            let topPos;
            if (spaceBelow >= tooltipH + 20) {
                topPos = rect.bottom + 14;
            } else {
                topPos = rect.top - tooltipH - 14;
            }
            topPos = Math.max(margin, Math.min(topPos, window.innerHeight - tooltipH - margin));
            tooltip.style.left = leftPos + 'px';
            tooltip.style.top = topPos + 'px';
        } else {
            // Fallback to centered if element not found
            centerTutorialTooltip(spotlight, tooltip);
        }
    } else {
        // No target - center the tooltip, hide spotlight
        centerTutorialTooltip(spotlight, tooltip);
    }
}

function centerTutorialTooltip(spotlight, tooltip) {
    spotlight.style.display = 'block';
    spotlight.style.width = '0';
    spotlight.style.height = '0';
    spotlight.style.left = (window.innerWidth / 2) + 'px';
    spotlight.style.top = (window.innerHeight / 2) + 'px';
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
}

// ==========================================
// 6. START LOGIC (Event Listeners & Init)
// ==========================================

// Event Listeners
if (searchInput) searchInput.addEventListener("keypress", (e) => { if (e.key === "Enter") searchLocation(); });
if (radiusInput) radiusInput.addEventListener('input', () => { invalidateSlopeMapIfSearchAreaChanged(); updateUI(); });
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
    invalidateSlopeMapIfSearchAreaChanged();
    updateUI();
});
if (overzoomCheckbox) {
    overzoomCheckbox.checked = isOverzoomEnabled();
    overzoomCheckbox.addEventListener('change', (e) => {
        localStorage.setItem(OVERZOOM_STORAGE_KEY, e.target.checked);
        applyCurrentLayerMaxZoom();
    });
}
if (tiltCheckbox) {
    tiltCheckbox.checked = true;
    tiltCheckbox.addEventListener('change', (e) => {
        setTiltEnabled(e.target.checked);
    });
}
if (enable3dCheckbox) {
    enable3dCheckbox.checked = false;
    enable3dCheckbox.addEventListener('change', (e) => {
        setTerrainEnabled(e.target.checked);
    });
}
if (exaggerationSlider) {
    exaggerationSlider.value = DEFAULT_TERRAIN_EXAGGERATION.toFixed(1);
    exaggerationSlider.addEventListener('input', () => {
        syncTerrainControls();
        if (enable3dCheckbox && enable3dCheckbox.checked) {
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
    invalidateSlopeMapIfSearchAreaChanged();
    updateUI();
});
map.on('moveend', () => { // Data saved/fetched at end of movement
    const center = map.getCenter();
    localStorage.setItem('topo_lat', center.lat);
    localStorage.setItem('topo_lng', center.lng);
    localStorage.setItem('topo_zoom', map.getZoom());
    updateCenterElevation();
});

// Minimize controls on mobile when clicking the map
map.on('click', () => {
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
    updateUI();
    updateCenterElevation();
}

applyInitialMapState();

// Auto-start tutorial for new visitors
if (!localStorage.getItem('topo_tutorial_done') && !hasSharedMapView) {
    setTimeout(() => startTutorial(), 1000);
}