// ==========================================
// 1. CONFIGURATION & CONSTANTS
// ==========================================
const APP_VERSION = "1.3";

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
const DATA_TILE_URL = "https://tiles.mapterhorn.com/{z}/{x}/{y}.webp"; // UPDATED TO MAPTERHORN
const WORKER_URL = "https://lm.clackspark.workers.dev";

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

// ==========================================
// 3. LANGUAGE & TRANSLATIONS
// ==========================================
const translations = {
    sv: {
        title: "Höjdsökaren",
        live_label: "HÖJD ÖVER HAVET",
        lbl_layers: "Kartlager:",
        lbl_radius: "Sökradie (km):",
        lbl_points: "Antal punkter:",
        lbl_show_circle: "Visa radie",
        lbl_lock_circle: "🔒 Lås radie",
        btn_scan: "📍 Hitta högsta punkter",
        lbl_climb_dist: "Mätsträcka (m):",
        lbl_num_climbs: "Antal stigningar:",
        btn_climb: "📈 Hitta stigningar",
        btn_clear: "🗑️ Rensa resultat",
        status_ready: "Redo.",
        status_searching: "Söker...",
        status_done: "Klar.",
        status_no_match: "Ingen träff.",
        status_gps_missing: "GPS saknas.",
        status_gps_fetch: "Hämtar position...",
        status_gps_error: "GPS fel.",
        status_cleared: "Rensat.",
        status_loading: "Laddar data...",
        status_calc: "Beräknar...",
        status_error: "Fel: ",
        status_found_points: "Hittade {n} punkter.",
        status_zoom_in: "Zooma in för bättre precision!",
        status_found_climbs: "Hittade {n} stigningar.",
        status_no_data: "Ingen data hittades.",
        input_search_ph: "Sök plats",
        info_title: "Om Höjdsökaren",
        info_desc: "Detta verktyg hjälper dig att analysera terräng för att hitta de högsta punkterna samt beräkna maximal stigning inom ett givet område. Appen fungerar på mobila enheter, men gör sig bäst på större skärmar.",
        info_section_peaks: "Hitta högsta punkter",
        info_help_radius: "Sökradie: Ange sökområdets storlek.",
        info_help_points: "Antal punkter: Hur många toppar som ska hittas inom sökområdet.",
        info_help_show_radius: "Visa radie: Dölja eller visa den blå cirkeln",
        info_help_lock_radius: "Lås radie: Fäst sökradien på nuvarande position",
        info_section_climbs: "Hitta stigningar",
        info_help_dist: "Mätsträcka: Längsta sträcka som stigningen får vara",
        info_help_climbs: "Antal stigningar: Hur många stigningar som ska hittas.",
        info_results_desc: "Resultaten visar ranking (Högst först), Höjd, Avstånd från centrum samt koordinater.",
        info_creator: "Skapare",
        lbl_version: "Version",
        info_changelog_title: "Ändringslogg",
        info_privacy: "Denna applikation är helt klientbaserad. Det innebär att den körs direkt i din webbläsare och ingen data eller sökningar sparas på någon server.",
        btn_close: "Stäng",
        modal_api_title: "Ange API-nyckel för {service}",
        modal_api_text: "För att använda {service} behöver du en API-nyckel. Detta kan du skaffa kostnadsfritt genom att registrera dig på länken nedan.",
        input_api_ph: "Klistra in din nyckel här...",
        btn_save: "Spara",
        btn_cancel: "Avbryt",
        msg_api_alert: "Du måste ange en nyckel.",
        res_rank: "Plats",
        res_start: "Start",
        res_peak: "Topp",
        res_dist: "Avstånd",
        res_elev: "Höjd",
        res_climb: "Stigning",
        layer_lm_map: "Lantmäteriet",
        layer_satellite: "Satellit",
        layer_debug: "Höjddata (Mapterhorn)",
        debug_settings: "Felsökningsinställningar",
        lbl_water_analysis: "Vattenanalys (filtrera vatten från resultat)"
    },
    en: {
        title: "Elevation Finder",
        live_label: "ELEVATION",
        lbl_layers: "Map Layer:",
        lbl_radius: "Search Radius (km):",
        lbl_points: "Num Points:",
        lbl_show_circle: "Show Radius",
        lbl_lock_circle: "🔒 Lock Radius",
        btn_scan: "📍 Find Highest Points",
        lbl_climb_dist: "Measure Dist. (m):",
        lbl_num_climbs: "Num Climbs:",
        btn_climb: "📈 Find Climbs",
        btn_clear: "🗑️ Clear Results",
        status_ready: "Ready.",
        status_searching: "Searching...",
        status_done: "Done.",
        status_no_match: "No match.",
        status_gps_missing: "No GPS.",
        status_gps_fetch: "Locating...",
        status_gps_error: "GPS Error.",
        status_cleared: "Cleared.",
        status_loading: "Loading data...",
        status_calc: "Calculating...",
        status_error: "Error: ",
        status_found_points: "Found {n} points.",
        status_zoom_in: "Zoom in for better precision!",
        status_found_climbs: "Found {n} climbs.",
        status_no_data: "No data found.",
        input_search_ph: "Search location",
        info_title: "About Elevation Finder",
        info_desc: "This tool helps you analyze terrain to find highest points and calculate maximum ascent within a given area. The app works on mobile devices, but is best experienced on larger screens",
        info_section_peaks: "Find Highest Points",
        info_help_radius: "Radius: Set the size of the search area.",
        info_help_points: "Points: How many peaks to find within the area.",
        info_help_show_radius: "Show Radius: Hide or show the blue circle.",
        info_help_lock_radius: "Lock Radius: Pin the search radius to current position.",
        info_section_climbs: "Find Climbs",
        info_help_dist: "Measure Dist: Max distance for the ascent.",
        info_help_climbs: "Num Climbs: How many climbs to find.",
        info_results_desc: "Results show rank (Highest first), Elevation, Distance from center, and coordinates.",
        info_creator: "Creator",
        lbl_version: "Version",
        info_changelog_title: "Changelog",
        info_privacy: "This application is fully client-side. It runs directly in your browser and no data or searches are saved on any server.",
        btn_close: "Close",
        modal_api_title: "Enter API Key for {service}",
        modal_api_text: "To use {service}, you need an API key. You can get one for free by registering at the link below.",
        input_api_ph: "Paste your key here...",
        btn_save: "Save",
        btn_cancel: "Cancel",
        msg_api_alert: "You must enter a key.",
        res_rank: "Rank",
        res_start: "Start",
        res_peak: "Peak",
        res_dist: "Distance",
        res_elev: "Elevation",
        res_climb: "Ascent",
        layer_lm_map: "Lantmäteriet (Sweden)",
        layer_satellite: "Satellite",
        layer_debug: "Elevation Data (Mapterhorn)",
        debug_settings: "Debug settings",
        lbl_water_analysis: "Water analysis (filter water from results)"
    }
};

let currentLang = localStorage.getItem('topo_lang') || 'en';
let waterAnalysisEnabled = localStorage.getItem('topo_water_analysis') === 'true';

// ==========================================
// 4. MAP & VARIABLE INITIALIZATION
// ==========================================

const layers = {
    "opentopo": L.tileLayer(OPENTOPO_URL, { attribution: 'OpenTopoMap', maxZoom: 17 }),
    "tracetrack": L.tileLayer('', { attribution: 'Tracetrack', maxZoom: 19 }),
    "thunderforest": L.tileLayer('', { attribution: 'ThunderForest', maxZoom: 22 }),
    "lm_map": L.tileLayer(`${WORKER_URL}/{z}/{x}/{y}`, {
        attribution: '&copy; <a href="https://www.lantmateriet.se/">Lantmäteriet</a> - CC BY 4.0',
        maxZoom: 17
    }),
    "osm": L.tileLayer(OSM_URL, { attribution: 'OpenStreetMap', maxZoom: 19 }),
    "satellite": L.tileLayer(SATELLITE_URL, { attribution: 'Esri', maxZoom: 19 }),
    "debug": L.tileLayer(DATA_TILE_URL, { attribution: '<a href="https://github.com/mapterhorn/mapterhorn">Mapterhorn</a> ', maxZoom: 15, opacity: 1 })
};

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

// Load saved position
const savedLat = parseFloat(localStorage.getItem('topo_lat')) || 67.89;
const savedLng = parseFloat(localStorage.getItem('topo_lng')) || 18.52;
const savedZoom = parseInt(localStorage.getItem('topo_zoom')) || 11;
let savedLayer = localStorage.getItem('topo_layer') || "opentopo";

if (!layers[savedLayer]) {
    savedLayer = "opentopo";
}

// Create the map
const map = L.map('map', { zoomControl: false }).setView([savedLat, savedLng], savedZoom);
L.control.zoom({ position: 'bottomright' }).addTo(map);

// ==========================================
// 5. FUNCTIONS
// ==========================================

function isWaterPixel(r, g, b) {
    return Math.abs(r - WATER_COLOR.r) <= WATER_TOLERANCE &&
        Math.abs(g - WATER_COLOR.g) <= WATER_TOLERANCE &&
        Math.abs(b - WATER_COLOR.b) <= WATER_TOLERANCE;
}

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
        document.getElementById('scan-btn').textContent = t.btn_scan;
        document.getElementById('lbl-climb-dist').textContent = t.lbl_climb_dist;
        document.getElementById('lbl-num-climbs').textContent = t.lbl_num_climbs;
        document.getElementById('climb-btn').textContent = t.btn_climb;
        document.getElementById('clear-btn').textContent = t.btn_clear;

        document.getElementById('searchInput').placeholder = t.input_search_ph;
        document.getElementById('status').textContent = t.status_ready;

        document.getElementById('info-title').textContent = t.info_title;
        document.getElementById('info-desc').innerHTML = t.info_desc;

        document.getElementById('info-section-peaks').textContent = t.info_section_peaks;
        document.getElementById('info-help-radius').textContent = t.info_help_radius;
        document.getElementById('info-help-points').textContent = t.info_help_points;
        document.getElementById('info-help-show-radius').textContent = t.info_help_show_radius;
        document.getElementById('info-help-lock-radius').textContent = t.info_help_lock_radius;

        document.getElementById('info-section-climbs').textContent = t.info_section_climbs;
        document.getElementById('info-help-dist').textContent = t.info_help_dist;
        document.getElementById('info-help-climbs').textContent = t.info_help_climbs;

        document.getElementById('info-results-desc').textContent = t.info_results_desc;

        document.getElementById('info-creator').textContent = t.info_creator;
        document.getElementById('lbl-version').textContent = t.lbl_version;
        document.getElementById('app-version').textContent = APP_VERSION;
        if (document.getElementById('info-changelog-title')) document.getElementById('info-changelog-title').textContent = t.info_changelog_title;
        document.getElementById('info-privacy').textContent = t.info_privacy;
        if (document.getElementById('info-debug-title')) document.getElementById('info-debug-title').textContent = t.debug_settings;
        if (document.getElementById('lbl-water-analysis')) document.getElementById('lbl-water-analysis').textContent = t.lbl_water_analysis;
        const waterToggle = document.getElementById('water-analysis-toggle');
        if (waterToggle) waterToggle.checked = waterAnalysisEnabled;
        document.getElementById('info-close').textContent = t.btn_close;

        document.getElementById('modal-save').textContent = t.btn_save;
        document.getElementById('modal-cancel').textContent = t.btn_cancel;
        document.getElementById('api-key-input').placeholder = t.input_api_ph;

        if (layerSelect) {
            for (let i = 0; i < layerSelect.options.length; i++) {
                const val = layerSelect.options[i].value;
                if (val === 'lm_map') layerSelect.options[i].text = t.layer_lm_map;
                else if (val === 'satellite') layerSelect.options[i].text = t.layer_satellite + " (ESRI)";
                else if (val === 'debug') layerSelect.options[i].text = t.layer_debug;
            }
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
    const btn = document.querySelector('.toggle-btn');
    isControlsMinimized = !isControlsMinimized;
    if (isControlsMinimized) {
        controls.classList.add('minimized');
        btn.textContent = '➕';
    } else {
        controls.classList.remove('minimized');
        btn.textContent = '➖';
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

window.clearResults = function () {
    markers.forEach(m => map.removeLayer(m));
    polylines.forEach(p => map.removeLayer(p));
    markers = [];
    polylines = [];
    statusDiv.textContent = translations[currentLang].status_cleared;
};

window.copyCoords = function (lat, lng, btnElement) {
    navigator.clipboard.writeText(`${lat}, ${lng}`).then(() => {
        const originalText = btnElement.innerText;
        btnElement.innerText = "✅";
        setTimeout(() => btnElement.innerText = originalText, 1500);
    });
};

function getSearchCenter() { return isLocked && lockedCenterCoords ? lockedCenterCoords : map.getCenter(); }

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
    zoomLabel.innerText = 'Zoom: ' + map.getZoom();
    const searchCenter = getSearchCenter();
    const radiusKm = parseFloat(radiusInput.value) || 5;

    if (searchCircle) map.removeLayer(searchCircle);
    if (centerMarker) map.removeLayer(centerMarker);

    centerMarker = L.circleMarker(searchCenter, {
        radius: 4, color: isLocked ? '#e67e22' : '#007bff', fillColor: '#ffffff', fillOpacity: 1, weight: 2, interactive: false
    }).addTo(map);

    if (circleCheckbox.checked) {
        searchCircle = L.circle(searchCenter, {
            color: '#007bff', fillColor: '#007bff', fillOpacity: isLocked ? 0 : 0.1, weight: 1, radius: radiusKm * 1000, interactive: false
        }).addTo(map);
    }
}

async function updateCenterElevation() {
    if (!centerHeightDisplay) return;
    const center = map.getCenter();
    if (scanBtn) scanBtn.disabled = true;
    if (climbBtn) climbBtn.disabled = true;
    centerHeightDisplay.textContent = "...";

    const zoom = Math.min(Math.floor(map.getZoom()), 14);
    const point = map.project(center, zoom);
    const tileX = Math.floor(point.x / 256);
    const tileY = Math.floor(point.y / 256);

    // UPDATED: Since Mapterhorn is 512x512 we multiply the pixel offset by 2
    const pixelX = Math.floor((point.x % 256) * 2);
    const pixelY = Math.floor((point.y % 256) * 2);

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
        };
        img.onerror = () => { centerHeightDisplay.textContent = "N/A"; };
    } catch (err) { centerHeightDisplay.textContent = "N/A"; }
}

// Updated function that fetches both elevation and water tiles
async function fetchAnalysisData() {
    const size = map.getSize();
    canvas.width = size.x;
    canvas.height = size.y;
    waterCanvas.width = size.x;
    waterCanvas.height = size.y;

    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    waterCtx.imageSmoothingEnabled = false;
    waterCtx.clearRect(0, 0, waterCanvas.width, waterCanvas.height);

    const bounds = map.getBounds();
    const zoom = Math.min(Math.floor(map.getZoom()), 14);
    analysisZoom = zoom;
    const nw = map.project(bounds.getNorthWest(), zoom);
    analysisNwOrigin = nw;
    const se = map.project(bounds.getSouthEast(), zoom);
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
                targetCtx.drawImage(img, Math.floor(offset.x), Math.floor(offset.y), 256, 256);
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
    const minPixelDist = 40;
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

            const angles = 16;
            for (let a = 0; a < angles; a++) {
                const theta = (a / angles) * 2 * Math.PI;
                const x2 = Math.round(x + climbDistPx * Math.cos(theta));
                const y2 = Math.round(y + climbDistPx * Math.sin(theta));

                if (x2 >= 0 && x2 < w && y2 >= 0 && y2 < h) {

                    // CHECK WATER AT END POINT (if enabled)
                    const i2 = (y2 * w + x2) * 4;
                    if (waterData && isWaterPixel(waterData[i2], waterData[i2 + 1], waterData[i2 + 2])) continue;

                    if (imgData[i2 + 3] < 255) continue;
                    const h2 = (imgData[i2] * 256 + imgData[i2 + 1] + imgData[i2 + 2] / 256) - 32768;

                    const diff = h2 - h1;
                    if (diff > 1) {
                        candidates.push({
                            diff: diff,
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

            // START POPUP
            const searchCenter = getSearchCenter();
            const distStart = searchCenter.distanceTo(res.start.latlng);
            const distKmStart = (distStart / 1000).toFixed(2);
            const startPopup = `
                <span class="popup-header">${t.res_rank} #${rank} (${t.res_start})</span>
                <span class="popup-height">${t.res_elev}: ${Math.round(res.start.h)} m</span>
                <span class="popup-meta">${t.res_dist}: ${distKmStart} km</span>
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
                <span class="popup-height">${t.res_elev}: ${Math.round(res.end.h)} m</span>
                <span class="popup-meta">${t.res_climb}: +${Math.round(res.diff)} m</span>
                <span class="popup-meta">${t.res_dist}: ${distKmEnd} km</span>
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
// 6. START LOGIC (Event Listeners & Init)
// ==========================================

// Event Listeners
if (scanBtn) scanBtn.addEventListener('click', analyzeTerrain); // ADDED BACK THIS Event Listener
if (climbBtn) climbBtn.addEventListener('click', findSteepestClimb); // ADDED BACK THIS Event Listener
if (searchInput) searchInput.addEventListener("keypress", (e) => { if (e.key === "Enter") searchLocation(); });
if (radiusInput) radiusInput.addEventListener('input', updateUI);
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

const waterToggle = document.getElementById('water-analysis-toggle');
if (waterToggle) {
    waterToggle.checked = waterAnalysisEnabled;
    waterToggle.addEventListener('change', (e) => {
        waterAnalysisEnabled = e.target.checked;
        localStorage.setItem('topo_water_analysis', waterAnalysisEnabled);
    });
}

// Map Events
map.on('zoomend', () => { updateUI(); updateCenterElevation(); });
map.on('move', () => { updateUI(); }); // UI (circle) updates directly
map.on('moveend', () => { // Data saved/fetched at end of movement
    const center = map.getCenter();
    localStorage.setItem('topo_lat', center.lat);
    localStorage.setItem('topo_lng', center.lng);
    localStorage.setItem('topo_zoom', map.getZoom());
    updateCenterElevation();
});

// Initialize
updateLanguage();
if (layerSelect) {
    layerSelect.value = savedLayer;
}
handleLayerChange(savedLayer); // Now everything is loaded, so this works!
updateUI();
updateCenterElevation();