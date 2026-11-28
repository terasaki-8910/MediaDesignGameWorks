// E2E check of the help a stuck player gets: hints come only after firstHintSec without progress, and keep their clock through
// folds that do not bring the goal closer (the first puzzle's wrong fold, the path cube's flips); the text says where to look, not
// what a light column is, and after a wrong fold it points at the undo. In the Fold Gate the Fold Mode panel says what moves the
// tower out of the street's way and what that frees.
// Needs a running build: `npm run build && npm run preview` (or set BASE_URL to a deployment).
// The e2e job of .github/workflows/ci.yml runs this (Linux, software WebGL); locally, install the browser once with `npx playwright install chromium`.
const assert = require('node:assert/strict');
const { describeBackend, launch } = require('./browser.cjs');
const { loadStage } = require('./stage.cjs');
const { installWalker, walkTo } = require('./walkto.cjs');

(async () => {
const BASE = process.env.BASE_URL ?? 'http://localhost:4173/';
// the improvement loop tunes these (src/stages/tunables.json), so the test reads them instead of repeating the numbers
const st = await loadStage();
const FIRST_HINT_SEC = st.tunables.sections.s2_path_cube.firstHintSec;
const S1 = st.tunables.sections.s1_first_fold;
const s1 = st.sections[0];
const browser = await launch();
const page = await browser.newPage({ viewport: { width: 480, height: 270 } });
page.setDefaultTimeout(180000);
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(`${BASE}?debug=1&q=low`, { waitUntil: 'load' });
await page.waitForFunction(() => !!window.__fold, null, { timeout: 60000 });
console.log(`hints: ${await describeBackend(browser, page)}`);
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
await installWalker(page);
const idle = () => F(() => window.__fold.game.time - window.__fold.game.run.lastProgress);
const lit = () => F(() => window.__fold.game.world.highlighted);

// The first puzzle: nothing is lit and nothing is said at the start. The fold that does not lead on (the far bridge first: it
// strands the player from the other console) is no progress, so the hint still comes firstHintSec after the section began.
const wrong = s1.firstMoves.find((f) => f.penalty > 0);
assert.ok(wrong, 'the puzzle has a first fold that does not lead on');
const [wrongConsole] = wrong.key.split(':');
await walkTo(page, st.cellOf(wrongConsole));
await act(wrongConsole, wrong.key);
assert.equal(await F(() => window.__fold.game.run.remaining), 3, 'the wrong fold is a fold further from the goal');
await sim(S1.firstHintSec - (await idle()) - 3);
assert.equal(await hint(), '', 'no hint before firstHintSec, though the player has been folding');
assert.equal(await lit(), null, 'and no console is lit');
await sim(6);
const first = await hint();
assert.match(first, /脈打つように光っている操作盤/, 'the first hint says where to look');
assert.ok(!/光の柱|柱/.test(first), 'and does not speak of a light column');
assert.equal(await lit(), wrongConsole, 'it lights the console where the way on is: the undo of the wrong fold');
await sim(S1.secondHintSec - S1.firstHintSec);
const second = await hint();
assert.match(second, /奥の橋の操作盤.*南北に向ける/, 'the second hint names that console and the undo');
const sinceStart = await F(() => window.__fold.game.time - window.__fold.game.run.start);
assert.ok(sinceStart > S1.secondHintSec, `the second hint came after secondHintSec (${sinceStart.toFixed(0)} s)`);
// the undo brings the goal closer again: the hint goes, and the clock starts over
await act(wrongConsole, `${wrongConsole}:set0`);
await sim(0.5);
assert.equal(await hint(), '', 'the undo is progress: the hint is gone');
assert.equal(await lit(), null);
assert.ok((await idle()) < 6, 'and the clock started over');
// the puzzle's own plan, from here: walk to each console and fold
for (const step of s1.plan) {
  await walkTo(page, step.cell);
  await act(step.console, step.key);
}
assert.equal(await F(() => { const g = window.__fold.game; const wm = g.cs.walkMap(g.state); return wm.region.get(g.player.cell) === wm.region.get(g.section.exit[0].join(',')); }), true, 'the exit can be walked to');
await walkTo(page, s1.exit);
await sim(0.2);
assert.equal(await F(() => window.__fold.section()), 's2_path_cube');

// Flipping the cube over and back is no progress, so the first hint still comes firstHintSec after the section began.
await to([0, 3, 0]);
await act('c_roll', 'c_roll:x180');
await act('c_roll', 'c_roll:x180');
await act('c_roll', 'c_roll:x180');
await sim(FIRST_HINT_SEC - 12 - 2);
assert.equal(await hint(), '', 'no hint before firstHintSec');
await sim(4);
assert.match(await hint(), /脈打つように光っている操作盤/, 'the hint arrives on time although the player kept folding');

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
