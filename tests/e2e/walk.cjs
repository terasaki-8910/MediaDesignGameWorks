// E2E smoke test in a real browser: walk the route with simulated input and use the first console.
// Needs a running build: `npm run build && npm run preview` (or set BASE_URL to a deployment).
// CI does not run this; install the browser once with `npx playwright install chromium`.
const assert = require('node:assert/strict');
const { chromium } = require('playwright');

(async () => {
const BASE = process.env.BASE_URL ?? 'http://localhost:4173/';
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 480, height: 270 } });
page.setDefaultTimeout(180000);
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(`${BASE}?debug=1&q=low`, { waitUntil: 'load' });
await page.waitForFunction(() => !!window.__fold, null, { timeout: 60000 });
const F = (fn, ...a) => page.evaluate(fn, ...a);
await F(() => window.__fold.start());
const walk = (yaw, sec) => F(([y, s]) => { window.__fold.setYaw(y); return window.__fold.simulate(s, ['KeyW']); }, [yaw, sec]);
const east = -Math.PI / 2;

let r = await walk(east, 6);
assert.equal(r.cell, '-6,3,0', 'stops at the broken bridge');
assert.ok(Math.abs(r.x + 20.35) < 0.01, 'held back by the closed edge');
await F(() => window.__fold.press('KeyE'));
await F(() => window.__fold.simulate(0.1));
assert.equal(await F(() => window.__fold.mode()), 'fold', 'E opens Fold Mode at the console');
await F(() => window.__fold.press('KeyE'));
await F(() => window.__fold.simulate(3));
r = await walk(east, 4);
assert.equal(r.section, 's2_path_cube', 'crossing the turned bridge clears the first section');
assert.deepEqual(errors, []);
await browser.close();
console.log('e2e walk: ok');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
