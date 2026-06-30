const CACHE_NAME = '2981';

// Version-stamped shell assets: their URLs carry ?v=<build> in index.html. Precache them
// under the SAME ?v= (derived from CACHE_NAME) so the cached key matches what the page
// requests; the fetch handler matches these search-SENSITIVELY, so a new build's ?v= misses
// the old cache and falls through to the network. index.html's ?v= MUST equal CACHE_NAME.
const VERSIONED = ['./style.css', './script.js', './lang/en.js', './lang/sv.js'];
const STATIC = [
    './',
    './index.html',
    './manifest.json',
    './icon.svg',
    './fonts/noto-sans-regular/0-255.pbf',
    './fonts/open-sans-regular/0-255.pbf'
];
const ASSETS = [...STATIC, ...VERSIONED.map((url) => `${url}?v=${CACHE_NAME}`)];

// Runtime cache for cross-origin map/elevation tiles. Its name is intentionally
// version-independent so cached tiles survive app releases; it is capped instead.
const TILE_CACHE = 'toposcout-tiles-v1';
const TILE_CACHE_MAX = 400;
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

function isTileRequest(url) {
    return TILE_HOSTS.some((host) => url.hostname === host || url.hostname.endsWith('.' + host));
}

// Store a tile response and evict the oldest entries once over the cap (cache
// keys come back in insertion order, so the front of the list is the oldest).
async function putTileAndTrim(cache, request, response) {
    await cache.put(request, response);
    const keys = await cache.keys();
    for (let i = 0; i < keys.length - TILE_CACHE_MAX; i++) {
        await cache.delete(keys[i]);
    }
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
        if (isTileRequest(url)) {
            event.respondWith(
                caches.open(TILE_CACHE).then((cache) =>
                    cache.match(event.request).then((cached) => {
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
        // Anything else cross-origin (Google Sign-In, Nominatim, unpkg) hits the network untouched.
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
