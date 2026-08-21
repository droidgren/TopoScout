import { test, expect, type Page } from '@playwright/test';

/**
 * GPS button recentering (script.js: locateUser / updateGpsMarker).
 *
 * Pressing GPS used to move the map twice: once on the coarse first fix, and again a few
 * seconds later when accuracy dropped below GPS_PINPOINT_M and the accuracy ring was
 * removed. Centering is now guarded by gpsHasCentered, so only the first fix of a
 * tracking session moves the map.
 *
 * Geolocation is Chromium's mock, driven through context.setGeolocation(); the app is
 * unaware of the test.
 */

test.use({ permissions: ['geolocation'], geolocation: { latitude: 57.70, longitude: 11.97, accuracy: 100 } });

async function setup(page: Page) {
    await page.addInitScript(() => localStorage.setItem('topo_tutorial_done', '1'));
    await page.goto('/');
    await page.waitForFunction(() => typeof (window as any).locateUser === 'function');
    await page.waitForFunction('!!map && !!map._map');
    // Count every recentering by wrapping the setView shim that locateUser() calls.
    // String form: `map` is a top-level const in a classic script, so it lives in the
    // global lexical scope. (window.map is the #map <div>, not the map object.)
    const patched = await page.evaluate(`(() => {
        window.__centers = [];
        const orig = map.setView;
        map.setView = function (latlng, zoom) {
            window.__centers.push(Array.isArray(latlng) ? latlng.slice() : latlng);
            return orig.call(this, latlng, zoom);
        };
        return typeof orig === 'function';
    })()`);
    expect(patched).toBe(true);
}

test('GPS button centers the map exactly once, even when the fix tightens to pinpoint', async ({ page, context }) => {
    await setup(page);
    await page.click('.gps-ctrl-btn');
    // Coarse first fix: the ring is drawn and the map centers once, even though both
    // getCurrentPosition and watchPosition deliver it.
    await page.waitForFunction('!!gpsAccuracyCircle');
    expect(await page.evaluate('__centers.length')).toBe(1);
    expect(await page.evaluate('__centers[0]')).toEqual([57.70, 11.97]);

    // Signal tightens to pinpoint: the ring vanishes and the map must NOT move again.
    await context.setGeolocation({ latitude: 57.75, longitude: 12.05, accuracy: 1 });
    await page.waitForFunction('gpsAccuracyCircle === null');
    await page.waitForFunction('lastGpsPosition && Math.abs(lastGpsPosition.lat - 57.75) < 1e-6');
    expect(await page.evaluate('__centers.length')).toBe(1);

    // Degrading and re-tightening must not move it either.
    await context.setGeolocation({ latitude: 57.76, longitude: 12.06, accuracy: 200 });
    await page.waitForFunction('!!gpsAccuracyCircle');
    await context.setGeolocation({ latitude: 57.77, longitude: 12.07, accuracy: 2 });
    await page.waitForFunction('gpsAccuracyCircle === null');
    expect(await page.evaluate('__centers.length')).toBe(1);

    // Toggling tracking off and on again recenters once more, on the current fix.
    await page.click('.gps-ctrl-btn');
    await page.waitForFunction('gpsWatchId === null');
    await page.click('.gps-ctrl-btn');
    await page.waitForFunction('__centers.length === 2');
    await page.waitForTimeout(1000);
    expect(await page.evaluate('__centers.length')).toBe(2);
    expect(await page.evaluate('__centers[1]')).toEqual([57.77, 12.07]);
});
