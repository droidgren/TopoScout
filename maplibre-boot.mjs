// MapLibre GL JS v6 is ESM-only (the UMD bundle v5 shipped is gone), but script.js is a
// classic script: it declares the whole app in global scope because index.html drives it from
// inline onclick= handlers. So the module boundary stops here — this shim imports the v6
// namespace and republishes it as the `maplibregl` global that script.js and
// maplibre-contour already expect.
//
// Load order is guaranteed: module scripts and `defer` classic scripts share one queue and
// execute in document order, so this runs before maplibre-contour.min.js and script.js.
import * as maplibregl from './vendor/maplibre-gl.mjs';

// v6 auto-detects the worker from its own import.meta.url, which already resolves correctly
// for the self-hosted copy. Setting it explicitly documents that vendor/maplibre-gl-worker.mjs
// is a required precache entry, and covers non-http(s) origins where auto-detection gives up.
maplibregl.setWorkerUrl(new URL('./vendor/maplibre-gl-worker.mjs', import.meta.url).href);

window.maplibregl = maplibregl;
