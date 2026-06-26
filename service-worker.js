const CACHE_NAME = '2959';
const ASSETS = [
    './',
    './index.html',
    './style.css',
    './script.js',
    './manifest.json',
    './icon.svg',
    './lang/en.js',
    './lang/sv.js'
];

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
                    if (cacheName !== CACHE_NAME) {
                        return caches.delete(cacheName);
                    }
                })
            );
        }).then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);
    // Only handle same-origin GETs from the cache. Let cross-origin requests
    // (Google Sign-In, map tiles, etc.) and the optional backend API hit the
    // network directly and untouched.
    if (url.origin !== self.location.origin) return;
    if (event.request.method !== 'GET') return;
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
