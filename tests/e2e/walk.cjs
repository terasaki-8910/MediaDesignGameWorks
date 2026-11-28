// E2E smoke test in a real browser: walk the first puzzle with simulated input and use its consoles, in the order the solver gives.
// Needs a running build: `npm run build && npm run preview` (or set BASE_URL to a deployment).
// The e2e job of .github/workflows/ci.yml runs this (Linux, software WebGL); locally, install the browser once with `npx playwright install chromium`.
const assert = require('node:assert/strict');
const { describeBackend, launch } = require('./browser.cjs');
const { loadStage } = require('./stage.cjs');
const { installWalker, walkTo } = require('./walkto.cjs');

(async () => {
const BASE = process.env.BASE_URL ?? 'http://localhost:4173/';
const st = await loadStage();
const s1 = st.sections[0];
const browser = await launch();
const page = await browser.newPage({ viewport: { width: 480, height: 270 } });
page.setDefaultTimeout(180000);
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(`${BASE}?debug=1&q=low`, { waitUntil: 'load' });
await page.waitForFunction(() => !!window.__fold, null, { timeout: 60000 });
console.log(`walk: ${await describeBackend(browser, page)}`);
const F = (fn, ...a) => page.evaluate(fn, ...a);
await F(() => window.__fold.start());
await installWalker(page);
const walk = (yaw, sec) => F(([y, s]) => { window.__fold.setYaw(y); return window.__fold.simulate(s, ['KeyW']); }, [yaw, sec]);
const east = -Math.PI / 2;

// the road east of the start is broken: the plaza's edge is closed, and holding W stops there
let r = await walk(east, 6);
assert.equal(r.cell, '-9,3,0', 'stops at the edge of the plaza, where the bridge is turned away');
assert.ok(Math.abs(r.x + 32.35) < 0.01, 'held back by the closed edge');

// the puzzle's own plan: walk to each console (the way round, not teleporting), E opens Fold Mode, E folds
for (const step of s1.plan) {
  await walkTo(page, step.cell);
  assert.equal(await F(() => window.__fold.cell()), step.cell, `at the console of ${step.key}`);
  await F(() => window.__fold.press('KeyE'));
  await F(() => window.__fold.simulate(0.1));
  assert.equal(await F(() => window.__fold.mode()), 'fold', 'E opens Fold Mode at the console');
  await F(() => window.__fold.press('KeyE'));
  await F(() => window.__fold.simulate(3));
  assert.equal(await F(() => window.__fold.mode()), 'play', `${step.key} is done`);
}
assert.deepEqual(await F(() => window.__fold.solve()), [], 'nothing is left of the plan');
await walkTo(page, s1.exit);
await F(() => window.__fold.simulate(0.2));
assert.equal(await F(() => window.__fold.section()), 's2_path_cube', 'crossing the turned bridges clears the first section');
assert.deepEqual(errors, []);
await browser.close();
console.log(`e2e walk: ok (${s1.plan.map((s) => s.key).join(', ')})`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
