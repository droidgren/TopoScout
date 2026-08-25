# og-image

Source for `og-image.png` — the 1200×630 social preview card referenced by the
`og:image` / `twitter:image` tags in `index.html`.

Build-time only. Nothing here is served, imported by the app, or precached by
the service worker; the committed PNG is what ships.

## Regenerate

```sh
npm i -D playwright && npx playwright install chromium   # once
node tools/og-image/build.mjs
```

That overwrites `og-image.png` at the repo root and verifies it came out at
exactly 1200×630. The render is deterministic — same input, same pixels — so
re-running without editing anything leaves the file byte-identical.

Playwright rather than a bare `chromium --screenshot`: a headless window is not
its viewport (the window runs ~87px taller than the page area, and the
screenshot follows the window), so the CLI cannot produce an exact 1200×630.
Playwright also waits for the webfont instead of racing it.

## Files

| File | |
|---|---|
| `card.html` | The card itself — layout, copy, colors. Edit this. |
| `terrain.js` | Synthetic height field + marching-squares contours. |
| `build.mjs` | Renders `card.html` to `og-image.png`. |
| `opensans-latin.woff2` | Open Sans, latin subset, variable weight 300–800. |

## Notes

- **The contours are real.** `terrain.js` builds a height field and traces it
  with marching squares, so lines crowd on steep ground and spread over flats
  the way a printed map does. The regional `tilt` keeps that density even
  across the frame instead of leaving a bald patch around the summit.
- **The mountain is `icon.svg`.** `card.html` draws the same two paths, minus
  the rounded-square chip so the glyph can run larger in the same footprint.
- **The route uses the app's own colors** — the slope ramp from
  `slopeToColor()` in `script.js`, and the drag-handle colors from
  `.gpx-edit-handle` in `style.css`: green start, purple middles, red end.
- **The font is embedded** as a base64 `@font-face`, so the render needs no
  network. Open Sans is what the map labels already use
  (`fonts/open-sans-regular/`).
- **Changing the artwork means changing the alt text.** `og:image:alt` and
  `twitter:image:alt` in `index.html` describe this image and both need to
  keep matching it.
- **Social scrapers cache by URL.** The filename does not change between
  builds, so Facebook and LinkedIn keep serving the old card until the page is
  re-scraped in their sharing debuggers.
