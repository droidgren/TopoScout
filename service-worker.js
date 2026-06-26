const CACHE_NAME = '2969';
const ASSETS = [
    './',
    './index.html',
    './style.css',
    './script.js',
    './manifest.json',
    './icon.svg',
    './lang/en.js',
    './lang/sv.js',
    './fonts/noto-sans-regular/0-255.pbf',
    './fonts/open-sans-regular/0-255.pbf'
];

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
        caches.open(CACHE_NAME).then((cache) => {
            // `cache: 'reload'` forces each asset to come from the network instead of
            // the browser HTTP cache, so a new release never re-caches stale files.
            return cache.addAll(ASSETS.map((url) => new Request(url, { cache: 'reload' })));
        })
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
    event.respondWith(
        caches.match(event.request, { ignoreSearch: true }).then((response) => {
            return response || fetch(event.request);
        })
    );
});

self.addEventListener('message', (event) => {
    if (event.data && event.data.action === 'skipWaiting') {
        self.skipWaiting();
    }
});
