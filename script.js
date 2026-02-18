// ==========================================
// 1. KONFIGURATION & KONSTANTER
// ==========================================
const APP_VERSION = "1.1";

// Vattenanalys (CartoDB Light No Labels)
const WATER_COLOR = { r: 203, g: 210, b: 211 }; // #cbd2d3
const WATER_TOLERANCE = 25;
const WATER_CHECK_URL = "https://basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}.png";

// Base64-flaggor
const FLAG_SE = "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxNiAxMCI+PHJlY3Qgd2lkdGg9IjE2IiBoZWlnaHQ9IjEwIiBmaWxsPSIjMDA2YWE3Ii8+PHJlY3QgeD0iNSIgd2lkdGg9IjIiIGhlaWdodD0iMTAiIGZpbGw9IiNmZWNjMDAiLz48cmVjdCB5PSI0IiB3aWR0aD0iMTYiIGhlaWdodD0iMiIgZmlsbD0iI2ZlY2MwMCIvPjwvc3ZnPg==";
const FLAG_GB = "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA2MCAzMCI+PHBhdGggZmlsbD0iIzAxMjE2OSIgZD0iTTAgMGg2MHYzMEgwVjB6Ii8+PHBhdGggc3Ryb2tlPSIjZmZmIiBzdHJva2Utd2lkdGg9IjYiIGQ9Ik0wIDAgNjAgMzBNNjAgMCAwIDMwIi8+PHBhdGggc3Ryb2tlPSIjQzgxMDJFIiBzdHJva2Utd2lkdGg9IjQiIGQ9Ik0wIDAgNjAgMzBNNjAgMCAwIDMwIi8+PHBhdGggc3Ryb2tlPSIjZmZmIiBzdHJva2Utd2lkdGg9IjEwIiBkPSJNMzAgMHYzME0wIDE1aDYwIi8+PHBhdGggc3Ryb2tlPSIjQzgxMDJFIiBzdHJva2Utd2lkdGg9IjYiIGQ9Ik0zMCAwdjMwTTAgMTVoNjAiLz48L3N2Zz4=";

// Tjänster som kräver API-nycklar
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

// Kart-URL:er
const OPENTOPO_URL = "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png";
const OSM_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const SATELLITE_URL = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
const DATA_TILE_URL = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png";
const WORKER_URL = "https://lm.clackspark.workers.dev"; 

// ==========================================
// 2. DOM ELEMENT
// ==========================================
const canvas = document.getElementById('analysis-canvas');
const ctx = canvas.getContext('2d', { willReadFrequently: true });
const spCanvas = document.getElementById('single-point-canvas');
const spCtx = spCanvas.getContext('2d', { willReadFrequently: true });

// Skapa en separat canvas för vattenanalys (visas ej i UI)
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
// 3. SPRÅK & ÖVERSÄTTNINGAR
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
        info_desc: "Detta verktyg hjälper dig att analysera terräng för att hitta de högsta punkterna samt beräkna maximal stigning inom ett givet område.Applikationen fungerar på mobila enheter, men gör sig bäst på större skärmar.",
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
        layer_debug: "Höjddata (Debug)"
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
        layer_debug: "Elevation Data (Debug)"
    }
};

let currentLang = localStorage.getItem('topo_lang') || 'en';

// ==========================================
// 4. KART- & VARIABELINITIERING
// ==========================================

const layers = {
    "opentopo": L.tileLayer(OPENTOPO_URL, { attribution: 'OpenTopoMap', maxZoom: 17 }),
    "tracetrack": L.tileLayer('', { attribution: 'Tracetrack', maxZoom: 19 }),
    "thunderforest": L.tileLayer('', { attribution: 'ThunderForest', maxZoom: 22 }),
    "lm_map": L.tileLayer(`${WORKER_URL}/{z}/{x}/{y}`, { 
        attribution: '&copy; <a href="https://www.lantmateriet.se/">Lantmäteriet</a>',
        maxZoom: 17 
    }),
    "osm": L.tileLayer(OSM_URL, { attribution: 'OpenStreetMap', maxZoom: 19 }),
    "satellite": L.tileLayer(SATELLITE_URL, { attribution: 'Esri', maxZoom: 19 }),
    "debug": L.tileLayer(DATA_TILE_URL, { attribution: 'Mapzen Rådata', maxZoom: 15, opacity: 1 })
};

// Ikoner
const goldIcon = new L.Icon({
    iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
    shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
    iconSize: [25, 41], iconAnchor: [12, 41], popupAnchor: [1, -34], shadowSize: [41, 41], className: 'gold-icon'
});
const greenIcon = new L.Icon({
    iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-green.png',
    shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png',
    iconSize: [25, 41], iconAnchor: [12, 41], popupAnchor: [1, -34], shadowSize: [41, 41]
});
const redIcon = new L.Icon({
    iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-red.png',
    shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png',
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

// Ladda sparad position
const savedLat = parseFloat(localStorage.getItem('topo_lat')) || 67.89;
const savedLng = parseFloat(localStorage.getItem('topo_lng')) || 18.52;
const savedZoom = parseInt(localStorage.getItem('topo_zoom')) || 11;
let savedLayer = localStorage.getItem('topo_layer') || "opentopo";

if(!layers[savedLayer]) {
    savedLayer = "opentopo";
}

// Skapa kartan
const map = L.map('map', { zoomControl: false }).setView([savedLat, savedLng], savedZoom);
L.control.zoom({position: 'bottomright'}).addTo(map);

// ==========================================
// 5. FUNKTIONER
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
    if(flagImg) flagImg.src = isEn ? FLAG_GB : FLAG_SE;

    if(document.getElementById('app-title')) {
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
        document.getElementById('info-privacy').textContent = t.info_privacy;
        document.getElementById('info-close').textContent = t.btn_close;

        document.getElementById('modal-save').textContent = t.btn_save;
        document.getElementById('modal-cancel').textContent = t.btn_cancel;
        document.getElementById('api-key-input').placeholder = t.input_api_ph;

        if(layerSelect) {
            for (let i = 0; i < layerSelect.options.length; i++) {
                const val = layerSelect.options[i].value;
                if(val === 'lm_map') layerSelect.options[i].text = t.layer_lm_map;
                else if(val === 'satellite') layerSelect.options[i].text = t.layer_satellite + " (ESRI)";
                else if(val === 'debug') layerSelect.options[i].text = t.layer_debug;
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
            if(editKeyBtn) editKeyBtn.style.display = 'block'; 
        } else {
            showKeyModal(layerKey);
        }
    } else {
        if(editKeyBtn) editKeyBtn.style.display = 'none';
        switchLayerTo(layerKey);
    }
}

function switchLayerTo(layerKey) {
    if (currentLayer) map.removeLayer(currentLayer);
    currentLayer = layers[layerKey];
    if(currentLayer) {
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
    if(layerSelect) {
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
        
        if(editKeyBtn) editKeyBtn.style.display = 'block';
        if(layerSelect) layerSelect.value = pendingServiceKey;
        document.getElementById('key-modal').style.display = 'none';
        pendingServiceKey = null;
    } else {
        alert(t.msg_api_alert);
    }
}

function cancelApiKey() {
    document.getElementById('key-modal').style.display = 'none';
    pendingServiceKey = null;
    
    if(currentLayer === null) {
        if(layerSelect) layerSelect.value = "opentopo";
        handleLayerChange("opentopo");
    } else {
        if(layerSelect) layerSelect.value = previousLayerValue;
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

window.clearResults = function() {
    markers.forEach(m => map.removeLayer(m));
    polylines.forEach(p => map.removeLayer(p));
    markers = [];
    polylines = [];
    statusDiv.textContent = translations[currentLang].status_cleared;
};

window.copyCoords = function(lat, lng, btnElement) {
    navigator.clipboard.writeText(`${lat}, ${lng}`).then(() => {
        const originalText = btnElement.innerText;
        btnElement.innerText = "✅";
        setTimeout(() => btnElement.innerText = originalText, 1500);
    });
};

function getSearchCenter() { return isLocked && lockedCenterCoords ? lockedCenterCoords : map.getCenter(); }

function updateUI() {
    if(!zoomLabel) return; 
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
            color: isLocked ? '#e67e22' : '#007bff', fillColor: isLocked ? '#e67e22' : '#007bff', fillOpacity: 0.1, weight: 1, radius: radiusKm * 1000, interactive: false 
        }).addTo(map);
    }
}

async function updateCenterElevation() {
    if(!centerHeightDisplay) return;
    const center = map.getCenter();
    if(scanBtn) scanBtn.disabled = true;
    if(climbBtn) climbBtn.disabled = true;
    centerHeightDisplay.textContent = "..."; 
    
    const zoom = Math.min(Math.floor(map.getZoom()), 14); 
    const point = map.project(center, zoom);
    const tileX = Math.floor(point.x / 256);
    const tileY = Math.floor(point.y / 256);
    const pixelX = Math.floor(point.x % 256);
    const pixelY = Math.floor(point.y % 256);
    const url = DATA_TILE_URL.replace('{z}', zoom).replace('{x}', tileX).replace('{y}', tileY);

    try {
        const img = new Image();
        img.crossOrigin = "Anonymous";
        img.src = url;
        img.onload = () => {
            spCtx.clearRect(0,0,1,1);
            spCtx.drawImage(img, pixelX, pixelY, 1, 1, 0, 0, 1, 1);
            const pData = spCtx.getImageData(0, 0, 1, 1).data;
            const h = (pData[0] * 256 + pData[1] + pData[2] / 256) - 32768;
            centerHeightDisplay.textContent = Math.round(h) + " m";
            if(scanBtn) scanBtn.disabled = false;
            if(climbBtn) climbBtn.disabled = false;
        };
        img.onerror = () => { centerHeightDisplay.textContent = "N/A"; };
    } catch (err) { centerHeightDisplay.textContent = "N/A"; }
}

// Uppdaterad funktion som hämtar både höjd- och vatten-tiles
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
    const nw = map.project(bounds.getNorthWest(), zoom);
    const se = map.project(bounds.getSouthEast(), zoom);
    const tileMin = nw.divideBy(256).floor();
    const tileMax = se.divideBy(256).floor();
    
    const tilesToLoad = [];
    for (let x = tileMin.x; x <= tileMax.x; x++) {
        for (let y = tileMin.y; y <= tileMax.y; y++) {
            tilesToLoad.push({ x, y, z: zoom });
        }
    }

    // Ladda båda lagren parallellt
    await Promise.all([
        loadAndDrawTiles(DATA_TILE_URL, ctx, tilesToLoad, nw),
        loadAndDrawTiles(WATER_CHECK_URL, waterCtx, tilesToLoad, nw)
    ]);
}

async function analyzeTerrain() {
    const t = translations[currentLang];
    clearResults();
    if(scanBtn) scanBtn.disabled = true;
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
    if(climbBtn) climbBtn.disabled = true;
    statusDiv.textContent = t.status_loading;
    try {
        // ÄNDRING: Använd fetchAnalysisData för att även ladda vattenkartan
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

// Generaliserad funktion
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

function findPeaks() {
    const t = translations[currentLang];
    const w = canvas.width;
    const h = canvas.height;
    const imgData = ctx.getImageData(0, 0, w, h).data;
    // Hämta data från vatten-canvasen
    const waterData = waterCtx.getImageData(0, 0, w, h).data;

    const searchCenterLatLng = getSearchCenter();
    const maxRadiusMeters = (parseFloat(radiusInput.value) || 5) * 1000;
    let candidates = [];
    for (let y = 0; y < h; y+=2) { 
        for (let x = 0; x < w; x+=2) {
            const i = (y * w + x) * 4;
            if (imgData[i+3] < 255) continue; 
            
            // KONTROLLERA VATTEN
            if (isWaterPixel(waterData[i], waterData[i+1], waterData[i+2])) {
                continue; // Hoppa över om det är vatten
            }

            const height = (imgData[i] * 256 + imgData[i+1] + imgData[i+2] / 256) - 32768;
            if (height > -50) candidates.push({ x, y, h: height });
        }
    }
    const validPeaks = [];
    for (let p of candidates) {
        const latlng = map.containerPointToLatLng([p.x, p.y]);
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
            if ((dx*dx + dy*dy) < (minPixelDist * minPixelDist)) { tooClose = true; break; }
        }
        if (!tooClose) finalPoints.push(p);
    }
    if (finalPoints.length === 0) { statusDiv.textContent = t.status_no_data; return; }
    finalPoints.forEach((p, idx) => {
        const distKm = (p.dist / 1000).toFixed(2);
        const isHighest = (idx === 0);
        const markerOptions = isHighest ? { icon: goldIcon, zIndexOffset: 1000 } : {};
        
        const popupContent = `
            <span class="popup-header" style="${isHighest ? 'color:#b8860b' : ''}">${t.res_rank} #${idx+1}</span>
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
    
    // NYTT: Hämta data från vatten-canvasen
    const waterData = waterCtx.getImageData(0, 0, w, h).data;

    const searchCenterLatLng = getSearchCenter();
    const searchRadiusMeters = (parseFloat(radiusInput.value) || 5) * 1000;
    const climbDistMeters = parseFloat(climbDistInput.value) || 200;
    const maxResults = parseInt(numClimbsInput.value) || 1; 

    const p1 = map.latLngToContainerPoint(searchCenterLatLng);
    const p2 = map.latLngToContainerPoint(moveLatLng(searchCenterLatLng, climbDistMeters, 0));
    const climbDistPx = Math.round(p1.distanceTo(p2));

    if (climbDistPx < 2) {
        statusDiv.textContent = t.status_zoom_in;
        return;
    }

    let candidates = [];

    const step = 4;
    for (let y = step; y < h - step; y += step) {
        for (let x = step; x < w - step; x += step) {
            
            // KONTROLLERA VATTEN PÅ STARTPUNKTEN
            const i1 = (y * w + x) * 4;
            if (isWaterPixel(waterData[i1], waterData[i1+1], waterData[i1+2])) continue;

            const startLatLng = map.containerPointToLatLng([x, y]);
            if (searchCenterLatLng.distanceTo(startLatLng) > searchRadiusMeters) continue;

            if (imgData[i1+3] < 255) continue;
            const h1 = (imgData[i1] * 256 + imgData[i1+1] + imgData[i1+2] / 256) - 32768;

            const angles = 16; 
            for (let a = 0; a < angles; a++) {
                const theta = (a / angles) * 2 * Math.PI;
                const x2 = Math.round(x + climbDistPx * Math.cos(theta));
                const y2 = Math.round(y + climbDistPx * Math.sin(theta));

                if (x2 >= 0 && x2 < w && y2 >= 0 && y2 < h) {
                    
                    // KONTROLLERA VATTEN PÅ SLUTPUNKTEN
                    const i2 = (y2 * w + x2) * 4;
                    if (isWaterPixel(waterData[i2], waterData[i2+1], waterData[i2+2])) continue;

                    if (imgData[i2+3] < 255) continue;
                    const h2 = (imgData[i2] * 256 + imgData[i2+1] + imgData[i2+2] / 256) - 32768;

                    const diff = h2 - h1;
                    if (diff > 1) { 
                        candidates.push({
                            diff: diff,
                            start: { x: x, y: y, h: h1, latlng: startLatLng },
                            end: { x: x2, y: y2, h: h2, latlng: map.containerPointToLatLng([x2, y2]) }
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
            if ((dx*dx + dy*dy) < (minPixelSeparation * minPixelSeparation)) {
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

            // TOPP POPUP
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
// 6. STARTA LOGIK (Event Listeners & Init)
// ==========================================

// Event Listeners
if(searchInput) searchInput.addEventListener("keypress", (e) => { if(e.key === "Enter") searchLocation(); });
if(radiusInput) radiusInput.addEventListener('input', updateUI);
if(circleCheckbox) circleCheckbox.addEventListener('change', updateUI);
if(lockCheckbox) lockCheckbox.addEventListener('change', (e) => {
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

// Map Events
map.on('zoomend', () => { updateUI(); updateCenterElevation(); });
map.on('move', () => { updateUI(); }); // UI (cirkel) uppdateras direkt
map.on('moveend', () => { // Data sparas/hämtas vid slut av rörelse
    const center = map.getCenter();
    localStorage.setItem('topo_lat', center.lat);
    localStorage.setItem('topo_lng', center.lng);
    localStorage.setItem('topo_zoom', map.getZoom());
    updateCenterElevation();
});

// Initiera
updateLanguage();
if(layerSelect) {
    layerSelect.value = savedLayer;
}
handleLayerChange(savedLayer); // Nu är allt laddat, så detta fungerar!
updateUI();
updateCenterElevation();