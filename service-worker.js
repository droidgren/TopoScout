const CACHE_NAME = '3013';

// Version-stamped shell assets: their URLs carry ?v=<build> in index.html. Precache them
// under the SAME ?v= (derived from CACHE_NAME) so the cached key matches what the page
// requests; the fetch handler matches these search-SENSITIVELY, so a new build's ?v= misses
// the old cache and falls through to the network. index.html's ?v= MUST equal CACHE_NAME.
const VERSIONED = ['./style.css', './maplibre-boot.mjs', './script.js', './lang/en.js', './lang/sv.js'];
const STATIC = [
    './',
    './index.html',
    './manifest.json',
    './icon.svg',
    // MapLibre v6 is ESM: the main bundle and the worker BOTH import the shared chunk, and the
    // worker (a client of this service worker) fetches it through the handler below. All three
    // must be precached or the map goes blank offline.
    './vendor/maplibre-gl.mjs',
    './vendor/maplibre-gl-shared.mjs',
    './vendor/maplibre-gl-worker.mjs',
    './vendor/maplibre-gl.css',
    './vendor/maplibre-contour.min.js',
    './vendor/jspdf.umd.min.js',
    './fonts/noto-sans-regular/0-255.pbf',
    './fonts/open-sans-regular/0-255.pbf'
];
const ASSETS = [...STATIC, ...VERSIONED.map((url) => `${url}?v=${CACHE_NAME}`)];

// Runtime cache for cross-origin map/elevation tiles. Its name is intentionally
// version-independent so cached tiles survive app releases; it is capped instead.
const TILE_CACHE = 'toposcout-tiles-v1';
// A viewport can pull three tile families at once (basemap + elevation + a Waymarked/
// Strava overlay), so the cap has to cover all three or ordinary panning evicts tiles
// the user is about to pan back onto. The trim below is amortized, so a large cap is
// cheap. Exceeded briefly between sweeps by design - this is a best-effort cache.
const TILE_CACHE_MAX = 1200;        // ceiling; a sweep only evicts once past it
const TILE_CACHE_LOW_WATER = 1000;  // ...and then cuts back to here, not to the cap
const TILE_TRIM_INTERVAL = 50;      // puts between eviction sweeps
const KEEP_CACHES = [CACHE_NAME, TILE_CACHE];

// Hosts that serve map/elevation/overlay tiles. Subdomains (e.g. the {s} in
// a/b/c.tile.opentopomap.org or a.basemaps.cartocdn.com) are matched by suffix.
const TILE_HOSTS = [
    'tiles.mapterhorn.com',
    'tile.openstreetmap.org',
    'tile.opentopomap.org',
    'basemaps.cartocdn.com',
    'server.arcgisonline.com',
    'cache.kartverket.no',
    'tile.waymarkedtrails.org',
    'tile.tracestrack.com',
    'tile.thunderforest.com',
    'tile.jawg.io',
    'lm.clackspark.workers.dev'
];

// Hosts whose tiles are a static dataset addressed by z/x/y: the bytes behind a
// given URL never change, so a cache hit needs no revalidation. Everything else
// (basemaps, Waymarked, Strava) is re-rendered upstream and stays on
// stale-while-revalidate. This matters most for the elevation tiles, which three
// separate consumers request under identical URLs: MapLibre's raster-dem source,
// maplibre-contour's own worker, and the canvas Image cache used by the analyses.
const IMMUTABLE_TILE_HOSTS = ['tiles.mapterhorn.com'];

function matchesHost(url, hosts) {
    return hosts.some((host) => url.hostname === host || url.hostname.endsWith('.' + host));
}

function isTileRequest(url) {
    return matchesHost(url, TILE_HOSTS);
}

function isImmutableTileRequest(url) {
    return matchesHost(url, IMMUTABLE_TILE_HOSTS);
}

// Eviction is amortized: cache.keys() enumerates the whole tile cache, so running
// it per stored tile made a fast pan re-walk the index dozens of times. Sweep only
// every TILE_TRIM_INTERVAL puts, and trim down to the low-water mark so the next
// sweep is far away.
//
// The counter starts near the interval rather than at 0 on purpose. A service worker
// is torn down after a short idle, so a user who loads a few tiles and pauses would
// otherwise reset the count every session and never reach a sweep, letting the cache
// grow without bound. Seeding it means each fresh worker sweeps once early, then
// settles into the amortized cadence.
let tilePutsSinceTrim = TILE_TRIM_INTERVAL - 5;
let tileTrimInFlight = false;

// Evict the oldest entries (cache keys come back in insertion order, so the front
// of the list is the oldest). Guarded against overlap - the worker services many
// tile fetches in parallel.
async function trimTileCache(cache) {
    if (tileTrimInFlight) return;
    tileTrimInFlight = true;
    tilePutsSinceTrim = 0;
    try {
        const keys = await cache.keys();
        // Hysteresis: let the cache fill to the cap, then cut back to the low-water
        // mark, so eviction runs in occasional batches instead of on every sweep.
        if (keys.length <= TILE_CACHE_MAX) return;
        for (let i = 0; i < keys.length - TILE_CACHE_LOW_WATER; i++) {
            await cache.delete(keys[i]);
        }
    } finally {
        tileTrimInFlight = false;
    }
}

// Store a tile response, sweeping for eviction only once in a while.
async function putTileAndTrim(cache, request, response) {
    await cache.put(request, response);
    if (++tilePutsSinceTrim < TILE_TRIM_INTERVAL) return;
    await trimTileCache(cache);
}

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => Promise.allSettled(
            // `cache: 'reload'` forces each asset from the network, not the browser HTTP
            // cache, so a new release never re-caches stale files. Settle per-asset (instead
            // of the all-or-nothing cache.addAll) so one failed fetch can't abort the install
            // and leave users stranded on the old worker.
            ASSETS.map((url) => fetch(new Request(url, { cache: 'reload' })).then((resp) => {
                if (resp && resp.ok) return cache.put(url, resp);
            }))
        // Activate as soon as the new shell is cached instead of waiting for every tab to
        // close, so updates apply on their own — no "Update" tap needed (key for iOS PWAs).
        )).then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames.map((cacheName) => {
                    // Keep the current shell cache and the runtime tile cache; drop old shells.
                    if (!KEEP_CACHES.includes(cacheName)) {
                        return caches.delete(cacheName);
                    }
                })
            );
        }).then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);
    if (event.request.method !== 'GET') return;

    if (url.origin !== self.location.origin) {
        // Cross-origin tiles: serve cached copy immediately while refreshing in the
        // background (stale-while-revalidate), so revisited areas render instantly
        // and the map keeps working offline. Only successful responses are cached.
        // Immutable tiles skip the background refresh entirely - re-fetching them
        // could only ever return the same bytes.
        if (isTileRequest(url)) {
            const immutable = isImmutableTileRequest(url);
            event.respondWith(
                caches.open(TILE_CACHE).then((cache) =>
                    cache.match(event.request).then((cached) => {
                        if (cached && immutable) return cached;
                        const network = fetch(event.request).then((response) => {
                            if (response && response.ok) {
                                putTileAndTrim(cache, event.request, response.clone());
                            }
                            return response;
                        }).catch(() => cached || Response.error());
                        return cached || network;
                    })
                )
            );
        }
        // Anything else cross-origin (Google Sign-In, Nominatim) hits the network untouched.
        return;
    }

    // Same-origin: serve the precached app shell, falling back to the network.
    // Let the optional backend API hit the network directly.
    if (url.pathname.startsWith('/api/')) return;

    // Navigations (the HTML document) go network-first so an online PWA always boots the
    // freshest index.html; fall back to the cached shell only when the network is down.
    if (event.request.mode === 'navigate') {
        event.respondWith(
            fetch(event.request).catch(() => caches.match('./index.html', { ignoreSearch: true }))
        );
        return;
    }

    // Other same-origin assets: cache-first, but search-SENSITIVE so a version-stamped URL
    // (e.g. script.js?v=<new>) misses the old cache and falls through to the network. The
    // ?v= shell assets are precached under their ?v= key, so this still hits when offline.
    event.respondWith(
        caches.match(event.request).then((response) => {
            return response || fetch(event.request);
        })
    );
});

self.addEventListener('message', (event) => {
    if (event.data && event.data.action === 'skipWaiting') {
        self.skipWaiting();
    }
});
