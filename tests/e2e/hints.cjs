// E2E check of the help a stuck player gets: hints keep their clock through folds that do not bring the goal closer,
// and in the Fold Gate the Fold Mode panel says what moves the tower out of the street's way and what that frees.
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
const sim = (sec) => F((s) => window.__fold.simulate(s), sec);
const act = async (consoleId, key) => {
  assert.ok(await F(([c, k]) => window.__fold.act(c, k), [consoleId, key]), `${key} is possible`);
  await sim(4); // the fold animation
};
const to = (cell) => F((c) => window.__fold.teleport(c), cell);
const hint = () => F(() => (document.querySelector('.hint.show')?.textContent ?? ''));
const panel = () => F(() => document.querySelector('.panel')?.textContent ?? '');

await F(() => window.__fold.start());
await to([-6, 3, 0]);
await act('c1', 'c1:set1');
await to([-2, 3, 0]);
await sim(0.2);
assert.equal(await F(() => window.__fold.section()), 's2_path_cube');

// Flipping the cube over and back is no progress, so the first hint still comes 50 s after the section began.
await to([0, 3, 0]);
await act('c_roll', 'c_roll:x180');
await act('c_roll', 'c_roll:x180');
await act('c_roll', 'c_roll:x180');
await sim(50 - 12 - 2);
assert.equal(await hint(), '', 'no hint before firstHintSec');
await sim(4);
assert.match(await hint(), /光の柱/, 'the hint arrives on time although the player kept folding');

// Into the Fold Gate the shortest way, then onto the ledge.
const plan = await F(() => window.__fold.solve());
for (const key of plan) {
  const c = key.split(':')[0];
  await to(c === 'c_roll' ? [0, 3, 0] : [4, 3, -3]);
  await act(c, key);
}
await to([7, 3, 0]);
await sim(0.2);
assert.equal(await F(() => window.__fold.section()), 's3_fold_gate');
await to([10, 3, 0]);
await act('c_t1', 'c_t1:set0');

// The street is blocked by the tower: the panel says which console moves it.
await to([10, 3, -2]);
await F(() => window.__fold.openFold('c_h'));
await sim(0.1);
assert.match(await panel(), /干渉しています：腕の塔.*腕の塔は「塔の操作盤（岩棚）」で動かせる/);
await F(() => window.__fold.press('Escape'));
await sim(0.1);

// At that console, the option that clears the street's sweep says so.
await to([10, 3, -3]);
await F(() => window.__fold.openFold('c_t2'));
await sim(0.1);
let freed = false;
for (let i = 0; i < 3 && !freed; i++) {
  freed = /「街路の操作盤」で「倒して水平にする」ができるようになる/.test(await panel());
  if (!freed) {
    await F(() => window.__fold.press('KeyD'));
    await sim(0.1);
  }
}
assert.ok(freed, 'one of the tower options frees the street');
assert.deepEqual(errors, []);
await browser.close();
console.log('e2e hints: ok');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
