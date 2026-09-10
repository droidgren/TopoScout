# Plan: upgrade MapLibre GL JS 6.6.0 → 6.9.0

**Branch:** `claude/maplibre-gl-upgrade-x9odwy`
**Target release:** v2.28.0, build 3056 (from v2.27.3 / 3055)
**Scope:** vendor swap (required) + two small code changes the upgrade makes worthwhile (optional but recommended)

---

## Why this upgrade

TopoScout is a terrain app: 7 `setTerrain` call sites, a dedicated hillshade layer, a 3D/tilt
mode, and contours draped over the DEM via maplibre-contour. Releases 6.7.0 → 6.9.0 are
unusually terrain-heavy, so the delta lands almost entirely on this app's core feature.

**Lands automatically, no code change:**

| Fix | Effect here |
|---|---|
| #8328 (6.8.0) mipmapped + trilinear drape sampling | Contours/hillshade/routes stop shimmering in 3D |
| #8251 (6.8.0) drape textures refreshed after zoom | Adjacent to the coarse-DEM bug fixed in `c02bbc1` |
| #8302 (6.8.0) hillshade tile seams | The `hillshade-layer` |
| #8368 (6.9.0) ≤1 stale drape re-render per frame | Smoother panning with 3D on |
| #7989 (6.7.0) camera jump at end of pan/zoom on terrain | Real touch-UX bug |
| #8212 (6.7.0) `project()` agrees with rendered terrain surface | The 12 native `nm.project`/`unproject` sites |
| #1551 (6.8.0) HTTP 204 treated as no data for raster-DEM | Mapterhorn DEM fetches |
| #6093 (6.8.0) map no longer freezes when a render task throws | Robustness |
| #5316 (6.7.0) nav-control zoom-out disabled when constrained | `NavigationControl` + overzoom logic |
| #8396 (6.9.0) iframe/srcdoc sanitization | The one `Popup().setHTML()` |

**Does NOT apply — do not put these in the changelog:**
`setStyle()` while terrain loads (#6824): the only `setStyle` in the codebase is the overlay
adapter's own method (`script.js` ~line 595); MapLibre's `map.setStyle()` is never called.
Undefined camera options → `NaN` (#8373): the `easeTo` wrapper already guards
`typeof nextOptions.zoom === 'number'` and `getMaxPitch()` always returns a finite number, so
this is latent robustness only. Also N/A: complex-script/RTL rendering (#8343 — Latin-only
`noto-sans`/`open-sans`, en/sv), Thai/Khmer wrapping and `font-faces` (#8237), OffscreenCanvas
sprite readback (#8339 — no map sprites), cloned default `Marker` pins (#8340 — nearly all
markers pass a custom `element`), all globe fixes, hidden-container `400x300` (#8277 — the
print map is off-screen via `left:-100000px` with explicit width/height, not `display:none`).

---

## Pre-verified facts

Already checked against the real 6.9.0 npm tarball — no need to re-derive, but the commands
are here so you can confirm after copying the files:

- **No breaking changes** in 6.7.0, 6.8.0 or 6.9.0. Sole deprecation is
  `setRTLTextPlugin`/`getRTLTextPluginStatus`, which this app never calls.
- **Export surface identical: 85 exports in both, nothing added or removed.**
- **`vendor/maplibre-gl.css` is byte-for-byte identical to the 6.6.0 copy** — the
  `.maplibregl-*` overrides in `style.css` are untouched.
- **The worker still imports `./maplibre-gl-shared.mjs`**, so the three-file service-worker
  precache set still holds.
- Every version-sensitive call the app makes is still present: `setWorkerUrl`, `addProtocol`
  (via maplibre-contour), `setTerrain`, `hillshade-exaggeration`, `canvasContextAttributes`,
  `setPixelRatio`, `maxCanvasSize`.
- Size delta: `maplibre-gl.mjs` 568135 → 585178, `maplibre-gl-shared.mjs` 489575 → 513245,
  `maplibre-gl-worker.mjs` 18592 → 19011, `maplibre-gl.css` unchanged. About +41 KB (+3.4%).
- `GPUInitializationError` was already an *export* in 6.6.0; what 6.7.0 changed is that it is
  now **thrown synchronously from the `Map` constructor**. `getStyleUrl` is genuinely new
  (absent in 6.6.0), which independently confirms the version delta.

**Known risk:** 6.9.0 was released 2026-09-09 and MapLibre v6 ships every 3–7 days (6.4.0
needed a 6.4.1 within two days). #8328 and #8368 rewrite drape scheduling and texture sampling
— the exact subsystem this app leans on. The upside and the regression risk are in the same
place, so Phase 5's device test is not optional. If you would rather de-risk, 6.8.0 carries
most of the terrain quality wins.

---

## Phase 0 — baseline

```bash
git checkout claude/maplibre-gl-upgrade-x9odwy 2>/dev/null || git checkout -b claude/maplibre-gl-upgrade-x9odwy
git status --short          # expect clean
grep -n "APP_VERSION\|BUILD_NUMBER" script.js | head -2   # expect 2.27.3 / 3055
```

Serve the app and confirm the *current* build works, so anything you see later is attributable:

```bash
uvicorn main:app --port 8000
```

Open http://localhost:8000/, switch on 3D and contours, and note the frame feel. Take a
**baseline A2 landscape PDF export** — Phase 3 changes its resolution and you will want the
before/after.

---

## Phase 1 — vendor swap (the whole required change)

```bash
cd /tmp
curl -sSLO https://registry.npmjs.org/maplibre-gl/-/maplibre-gl-6.9.0.tgz
tar xzf maplibre-gl-6.9.0.tgz
REPO=~/path/to/TopoScout          # <-- set this
cp package/dist/maplibre-gl.mjs        "$REPO/vendor/"
cp package/dist/maplibre-gl-shared.mjs "$REPO/vendor/"
cp package/dist/maplibre-gl-worker.mjs "$REPO/vendor/"
cp package/dist/maplibre-gl.css        "$REPO/vendor/"
```

Copy **only** those four. Do not bring in `*-dev.mjs`, `*.map`, or `maplibre-gl.d.ts` — they
are not vendored and would bloat the precache.

Verify:

```bash
cd "$REPO"
head -4 vendor/maplibre-gl.mjs | grep -o 'v6\.[0-9.]*'        # expect v6.9.0
git diff --stat vendor/                                        # css should show 0 changes
grep -oE '\./maplibre-gl-shared\.mjs' vendor/maplibre-gl-worker.mjs   # must match
```

Export-surface check (should print `85 85` and no +/- lines):

```bash
exp() { grep -oE "export\{[^}]*\}" "$1" | sed 's/^export{//; s/}$//' | tr ',' '\n' \
  | sed -nE 's/.* as ([A-Za-z_$][A-Za-z0-9_$]*)$/\1/p; s/^([A-Za-z_$][A-Za-z0-9_$]*)$/\1/p' | sort -u; }
git show HEAD:vendor/maplibre-gl.mjs > /tmp/old.mjs
exp /tmp/old.mjs > /tmp/e_old.txt; exp vendor/maplibre-gl.mjs > /tmp/e_new.txt
echo "$(wc -l < /tmp/e_old.txt) $(wc -l < /tmp/e_new.txt)"
diff /tmp/e_old.txt /tmp/e_new.txt
```

**Commit 1:** `Update MapLibre GL JS to 6.9.0`
Vendor files only. This is self-consistent on its own — the `vendor/` files live in the
service worker's `STATIC` list and carry no `?v=` stamp, so no bookkeeping is due yet.

---

## Phase 2 — fail gracefully when WebGL2 is unavailable (#8066)

**Why:** from 6.7.0 a failed WebGL2 context throws `GPUInitializationError` *synchronously
from the `Map` constructor*. Neither construction site has a `try`/`catch`, so on a device
without WebGL2 you now get an unhandled exception and a dead page. The app already has the
right machinery — a `showMapEngineError()` overlay and an aborting guard for
`typeof maplibregl === 'undefined'` just above the map creation — so this is an extension of
an existing pattern, not a new one.

**2a. `script.js` — teach `showMapEngineError()` about the GPU case.**
Anchor: `function showMapEngineError()`. Give it an optional `error` parameter and pick the
WebGL2 message when the constructor threw:

```js
function showMapEngineError(error) {
    const t = translations[currentLang] || translations.en || {};
    // Since MapLibre 6.7.0 a failed WebGL2 context throws GPUInitializationError straight
    // from the Map constructor, so this overlay now covers a second, unrelated cause: the
    // engine loaded fine, the device just cannot draw with it. Different advice, same overlay.
    const message = error && error.name === 'GPUInitializationError'
        ? (t.err_map_webgl || 'TopoScout could not start WebGL2, which it needs to draw the map. Update your browser, or turn on hardware acceleration in its settings.')
        : location.protocol === 'file:'
            ? (t.err_map_engine_file || "TopoScout can't run from a file:// URL: ...")
            : (t.err_map_engine || 'The map engine failed to load. Check your connection and reload the page.');
    // ...rest unchanged (textContent, never innerHTML — same rule as the rest of the app)
}
```

Keep the existing two fallback strings verbatim; only the new branch is added. Check
`error.name` rather than `instanceof maplibregl.GPUInitializationError` — both work here
(the class is exported), but the name check cannot be broken by bundling.

**2b. `script.js` — wrap the map construction.**
Anchor: `const map = L.map('map', {`. It is a top-level `const` in a classic script, so
switch it to `let` and assign inside a `try`:

```js
// Create the map
let map;
try {
    map = L.map('map', {
        // ...options unchanged...
    }).setView([savedLat, savedLng], savedZoom);
} catch (error) {
    // Aborts the rest of script.js for the same reason as the maplibregl guard above:
    // nothing below works without a map, and the overlay covers the control panel that
    // would otherwise sit there looking operational.
    showMapEngineError(error);
    throw error;
}
```

**2c. i18n.** Add `err_map_webgl` next to `err_map_engine`:
- `lang/en.js` (after line ~112)
- `lang/sv.js` (after line ~110)

**2d.** Also consider the print map at `capturePrintComposite` (anchor:
`const pmap = new maplibregl.Map({`). A second WebGL2 context can fail independently — on
mobile especially, where contexts are scarce — and it currently sits inside an `async`
function whose rejection would surface as an unhandled promise rejection rather than a
message in the print panel. Wrap it and report through the print panel's existing status line.

**Commit 2:** `Fail gracefully when WebGL2 cannot be initialized`

---

## Phase 3 — raise the print map canvas cap

**Why:** MapLibre defaults to `maxCanvasSize: [4096, 4096]`. At `PRINT_DPI = 200` the A2
layouts exceed it in both orientations, so **A2 exports are already being silently clamped to
roughly 180 DPI** — and from 6.8.0 (#8200) MapLibre warns once when it clamps, so this will
start appearing in the console whether or not you fix it:

```
a4 portrait  1520x2181      a3 portrait  2205x3150
a4 landscape 2205x1496      a3 landscape 3173x2181
a2 portrait  3173x4520  <-- clamped
a2 landscape 4543x3150  <-- clamped
```

This is not a crash: `capturePrintComposite` derives `ratio = glCanvas.width / printW` and
carries `cap.printW` into the scale denominator, so a clamped canvas already degrades
correctly. Raising the cap just stops the degradation where the GPU allows it.

**Change.** Anchor: `const pmap = new maplibregl.Map({`. Add alongside
`canvasContextAttributes`:

```js
// A2 at 200 DPI wants 4543x3150 px, past MapLibre's default 4096 cap, which silently
// clamped the capture to ~180 DPI. The GL driver still limits us to MAX_TEXTURE_SIZE
// (4096 on many older mobile GPUs), and the ratio maths below already handles a clamped
// canvas — so where 8192 is refused this degrades exactly as it did before.
maxCanvasSize: [8192, 8192],
```

**Verify:** export A2 landscape and confirm the captured canvas is 4543 px wide, not 4096.
Compare against the Phase 0 baseline PDF. On a phone, confirm A2 still produces a usable
(clamped) PDF rather than failing.

**Commit 3:** `Raise the print map canvas cap so A2 exports keep full 200 DPI`

---

## Phase 4 — release bookkeeping

Four files. The `?v=` values, `CACHE_NAME` and `BUILD_NUMBER` must all agree — the fetch
handler matches versioned URLs search-sensitively, so a mismatch means a normal refresh
misses the cache and offline breaks.

**Build number 3055 → 3056** (8 occurrences). A global replace is safe — `3055` appears
nowhere else:

```bash
sed -i 's/3055/3056/g' index.html service-worker.js script.js
grep -rn '3056' index.html service-worker.js script.js | wc -l    # expect 8
grep -rn '3055' index.html service-worker.js script.js            # expect no output
```

That covers `index.html` lines 55, 924, 928, 929, 930 (the five `?v=` tags) and line 157
(`#app-build`), plus `service-worker.js:1` (`CACHE_NAME`) and `script.js:5` (`BUILD_NUMBER`).

**App version 2.27.3 → 2.28.0 — do NOT sed this globally.** `2.27.3` appears three times and
one of them is *history*:

| Location | Action |
|---|---|
| `script.js:4` `APP_VERSION` | change to `2.28.0` |
| `index.html:157` `<span id="app-version">` | change to `2.28.0` |
| `index.html:165` `<li><strong>v2.27.3:</strong>` | **leave alone — past changelog entry** |

**`index.html` changelog** — add a new `<li>` at the *top* of the `<ul>` inside the
`<details>`. User-facing, plain language, `&mdash;` for dashes, matching the v2.27.1 entry's
register. Draft:

```html
<li><strong>v2.28.0:</strong> Updated the map engine to <strong>MapLibre GL JS 6.9.0</strong> &mdash; the biggest gains are in 3D: contour lines, relief and routes no longer shimmer as you move, the view no longer jumps at the end of a pan or pinch over terrain, and relief detail refreshes correctly when you zoom. Elevation readings taken from the map now match the terrain you can see. <strong>A2 printouts</strong> also keep their full resolution instead of being quietly reduced, and a device that cannot run WebGL2 now says so instead of showing a blank map.</li>
```

**`README.md` changelog** — add above the `v2.27.3` entry, under `## Changelog`. House style
is one dense technical paragraph. Draft:

```
- **v2.28.0:** Updated the vendored map engine from **MapLibre GL JS 6.6.0 to 6.9.0** — a drop-in replacement of the self-hosted `vendor/maplibre-gl*` dist files, taken verbatim from the npm package as before, spanning three upstream releases (6.7.0, 6.8.0, 6.9.0) with **no breaking changes**. The exported API surface is identical (85 exports, nothing added or removed), `vendor/maplibre-gl.css` is **byte-for-byte identical** to the 6.6.0 copy so the `.maplibregl-*` overrides in `style.css` are untouched, and the ESM loading path through `maplibre-boot.mjs` is unchanged — the worker still imports `./maplibre-gl-shared.mjs`, so the three-file service-worker precache set still holds. Every version-sensitive call the app makes is still present: `setWorkerUrl`, `addProtocol` (via maplibre-contour), `setTerrain`, `hillshade-exaggeration`, and `canvasContextAttributes`/`setPixelRatio`/`maxCanvasSize` on the offscreen print map. The upstream run is unusually well aimed at this app's core: terrain render-to-texture output is now sampled through **mipmaps with trilinear filtering**, so draped layers — contours, hillshade and route lines — stop shimmering; drape textures are **refreshed after a zoom change** rather than left stale; at most **one stale drape is re-rendered per frame** and drapes differing only by zoom survive map movement; **hillshade tile seams** are gone; and the **camera no longer jumps at the end of a pan or zoom gesture on terrain**. `project()` and `queryTerrainElevation` now agree with the rendered terrain surface, which the analysis scan rectangle and the print framing both read through. Also fixed upstream: an empty tile response (HTTP 204) is treated as no data so raster-DEM tiles load without elevation, a throwing render task no longer freezes the map, and the navigation control's zoom-out button is disabled when viewport constraints prevent zooming out. Two app-side changes ride along. A failed WebGL2 context now throws `GPUInitializationError` **synchronously from the `Map` constructor** (6.7.0), which the unguarded construction site would have surfaced as an unhandled exception and a dead page, so both map constructions are wrapped and the existing map-engine overlay gained a WebGL2 message. And MapLibre's default `maxCanvasSize` of 4096 was **silently clamping A2 print exports** — A2 at `PRINT_DPI = 200` needs 4543×3150 px — to roughly 180 DPI; the print map now asks for 8192, which the GL driver still limits to `MAX_TEXTURE_SIZE`, and the existing `ratio` maths means a device that refuses it degrades exactly as before. New upstream but unused here: `map.getStyleUrl()`, `Style#triggerSymbolPlacement`, image sources without a `url`, SDF fill patterns, and the `font-faces` style property. The one upstream deprecation, `setRTLTextPlugin`/`getRTLTextPluginStatus` (RTL text no longer needs a plugin), is not called by this app. Requirements are unchanged from v2.17.0 — WebGL2, and served over http/https.
```

**Commit 4:** `Bump version to v2.28.0 and update changelog`

(Their history sometimes folds the bump into the feature commit — e.g. `c02bbc1` — so
squashing 2–4 into one is equally in keeping. Keep Phase 1 separate either way: a clean
vendor-only commit is what makes a bisect or revert cheap.)

---

## Phase 5 — test plan

The vendor swap has no build step, so testing *is* the verification. Hard-reload with DevTools
open and **Application → Service Workers → check "Update on reload"**, or the old worker will
keep serving the previous shell.

**Console must be clean.** Specifically watch for: a `maxCanvasSize` clamp warning (expected
before Phase 3, gone after on desktop), and any warning about a source used for both terrain
and hillshade (should not appear — the split sources from `c02bbc1` prevent it).

Desktop:
- [ ] Map loads; basemap switching works
- [ ] **3D on**: pan, pinch, rotate — no shimmer on contours/hillshade/routes, and no camera jump at gesture end (this is the headline win; compare against the Phase 0 baseline)
- [ ] Zoom several levels with 3D on — relief detail refreshes, no stale drape
- [ ] Hillshade slider across its range; no tile seams
- [ ] Contour overlay on/off, metric **and** imperial (exercises `contourProtocolUrl` through `addProtocol`)
- [ ] Terrain scan analyses (points / climbs / slope) — `flattenViewForAnalysis()` still flattens pitch, results unchanged
- [ ] Elevation profile scrubbing with map sync
- [ ] Print export A4 / A3 / A2, both orientations; A2 at full resolution after Phase 3
- [ ] GPX load, track edit, save
- [ ] Nav control zoom-out disables at the overzoom ceiling (#5316)

Real device — **do not skip; this is where the drape changes will show:**
- [ ] iOS PWA and/or Android: 3D pan/pinch under load
- [ ] Offline: install, go offline, reload — map still draws (confirms the 3-file precache set and the `CACHE_NAME` bump)
- [ ] A2 print on mobile still yields a PDF (clamped is fine)

---

## Rollback

```bash
git revert <commit>        # per-commit, or
git checkout HEAD~1 -- vendor/    # vendor files only
```

Because the vendor swap is its own commit and the `?v=`/`CACHE_NAME` bump is another,
reverting the engine without losing the release bookkeeping is a single `git revert`. Users on
the bad build recover on their next load: the reverted `CACHE_NAME` installs a fresh worker,
and `cache: 'reload'` in the install handler forces every asset from the network rather than
the browser HTTP cache — which is also why the un-stamped `vendor/` URLs still refresh even
though their paths never change.

---

## Do not touch

Two existing workarounds look related to fixes in this range but are **not** superseded:

- **`flattenViewForAnalysis()`** — #8212 makes `project()` agree with the terrain *surface*;
  it does not fix the trapezoidal `getBounds()`/`project()` skew in a tilted view, which is
  inherent to perspective projection. The pitch-0 flattening before a terrain scan stays.
- **The separate `HILLSHADE_SOURCE_ID` DEM source** (from `c02bbc1`) — nothing in 6.7–6.9
  addresses `usedForTerrain` doubling a shared source's `tileSize` to 1024 and costing the
  hillshade a zoom level of detail. Keep the two sources split.

Also leave the `typeof pmap.setPixelRatio === 'function'` guard in the print path alone. It is
cheap, and it is the kind of thing that only proves necessary on a device you do not have.
