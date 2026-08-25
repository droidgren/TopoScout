#!/usr/bin/env node
/*
 * Renders tools/og-image/card.html to og-image.png (1200x630) at the repo root.
 *
 *   node tools/og-image/build.mjs
 *
 * Needs Playwright (the same dependency the Playwright test suite uses):
 *
 *   npm i -D playwright && npx playwright install chromium
 *
 * Playwright rather than a bare `chromium --screenshot` because a headless
 * window is not its viewport — the window is ~87px taller than the page area
 * and the screenshot follows the window, so the bare CLI cannot produce an
 * exact 1200x630. Playwright also lets the render wait on the webfont instead
 * of racing it.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const ROOT = path.resolve(HERE, '..', '..');
const OUT = path.join(ROOT, 'og-image.png');
const W = 1200, H = 630;

/* Function-form replacements: a string replacement would interpret $ patterns
   inside the font's base64 and the terrain source. */
const font = fs.readFileSync(path.join(HERE, 'opensans-latin.woff2')).toString('base64');
const terrain = fs.readFileSync(path.join(HERE, 'terrain.js'), 'utf8');
const html = fs.readFileSync(path.join(HERE, 'card.html'), 'utf8')
  .replace('__FONT_B64__', () => font)
  .replace('__TERRAIN_JS__', () => terrain);

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  console.error('This needs Playwright:  npm i -D playwright && npx playwright install chromium');
  process.exit(1);
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'toposcout-og-'));
const page = path.join(tmp, 'card.html');
fs.writeFileSync(page, html);

const browser = await chromium.launch();
try {
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));

  await p.goto(`file://${page}`, { waitUntil: 'load' });
  await p.evaluate(async () => {
    await document.fonts.load('800 88px "Open Sans"');
    await document.fonts.load('400 33px "Open Sans"');
    await document.fonts.ready;
  });

  if (errors.length) throw new Error(`card.html raised: ${errors.join('; ')}`);
  if (!await p.evaluate(() => document.documentElement.dataset.ready === '1')) {
    throw new Error('card.html never finished drawing');
  }
  if (!await p.evaluate(() => document.fonts.check('800 88px "Open Sans"'))) {
    throw new Error('Open Sans did not load — refusing to render with a fallback face');
  }

  await p.screenshot({ path: OUT, clip: { x: 0, y: 0, width: W, height: H } });
} finally {
  await browser.close();
  fs.rmSync(tmp, { recursive: true, force: true });
}

const buf = fs.readFileSync(OUT);
const gotW = buf.readUInt32BE(16), gotH = buf.readUInt32BE(20);
if (gotW !== W || gotH !== H) {
  console.error(`og-image.png is ${gotW}x${gotH}, expected ${W}x${H}`);
  process.exit(1);
}
console.log(`og-image.png  ${gotW}x${gotH}  ${(buf.length / 1024).toFixed(0)} KB`);
