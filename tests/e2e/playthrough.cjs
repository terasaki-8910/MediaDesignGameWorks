// E2E: the first puzzle played by real input, as a player plays it, from the title to the second puzzle: a click on Start, the
// keys W A S D to walk (the camera stays where the game put it), E at a console, and the mouse on Fold Mode's handle for one of the
// folds. The way the layout invites is tried first (the far bridge: the wrong fold, which strands the player from the other
// console), then undone at the console it was made at, then the puzzle is solved. No teleport and no debug move: the hooks only
// read (the cell, the mode, the state, the camera's yaw, and where Fold Mode's handle is on screen, to put the pointer on it).
// What it reports: the wall-clock time and the game time from Start to the second puzzle, the folds made, and whether a hint came.
// Needs a running build: `npm run build && npm run preview` (or set BASE_URL to a deployment).
// PLAYTHROUGH_OUT=<dir> also saves the frames it looks at (the title, the establishing view, each console, Fold Mode, the end).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { describeBackend, launch } = require('./browser.cjs');
const { blankReason, decodePng, frameStats } = require('./png.cjs');
const { loadStage } = require('./stage.cjs');

const STEP = { N: [0, -1], E: [1, 0], S: [0, 1], W: [-1, 0] };

(async () => {
const BASE = process.env.BASE_URL ?? 'http://localhost:4173/';
const OUT = process.env.PLAYTHROUGH_OUT;
const st = await loadStage();
const s1 = st.sections[0];
const wrong = s1.firstMoves.find((f) => f.penalty > 0);
assert.ok(wrong, 'the puzzle has a first fold that does not lead on');
const [wrongConsole] = wrong.key.split(':');
const wrongBack = `${wrongConsole}:set0`;
const FIRST_HINT_SEC = st.tunables.sections.s1_first_fold.firstHintSec;

const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.setDefaultTimeout(180000);
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const sent = [];
await page.route('**/api/telemetry', (route) => {
  sent.push(...JSON.parse(route.request().postData() ?? '{}').events);
  return route.fulfill({ status: 202, body: '{"ok":true}' });
});
await page.goto(`${BASE}?debug=1&telemetry=1`, { waitUntil: 'load' });
await page.waitForFunction(() => !!window.__fold, null, { timeout: 60000 });
await page.waitForFunction(() => { const b = document.querySelector('.btn.primary'); return !!b && !b.disabled; }, null, { timeout: 120000 });
console.log(`playthrough: ${await describeBackend(browser, page)}`);

const F = (fn, ...a) => page.evaluate(fn, ...a);
const cell = () => F(() => window.__fold.cell());
const gameState = () => F(() => ({ ...window.__fold.game.state }));
const text = (sel) => F((s) => document.querySelector(s)?.textContent ?? '', sel);
const remaining = () => F(() => window.__fold.game.run.remaining);
/** Game seconds since the goal last came closer (the clock the hints run on), noted at each console as the fold begins. */
const idles = [];
let shotNo = 0;
/** Save the frame (when asked to) and check it is drawn. */
const look = async (name) => {
  const buf = await page.screenshot();
  if (OUT) {
    fs.mkdirSync(OUT, { recursive: true });
    fs.writeFileSync(path.join(OUT, `${String(++shotNo).padStart(2, '0')}-${name}.png`), buf);
  }
  assert.equal(blankReason(frameStats(decodePng(buf))), null, `${name} is not a blank frame`);
};
const until = (pred, what, ms = 60000) => page.waitForFunction(pred, null, { timeout: ms, polling: 'raf' }).catch((e) => { throw new Error(`${what}: ${e.message}`); });

// which key takes the player which way: W is where the camera looks, A to its left, D to its right, S back (read once the game runs)
let forward;
let right;
const keyFor = (dir) => {
  const [dx, dz] = STEP[dir];
  const f = dx * forward[0] + dz * forward[1];
  const r = dx * right[0] + dz * right[1];
  return f > 0.9 ? 'KeyW' : f < -0.9 ? 'KeyS' : r > 0.9 ? 'KeyD' : r < -0.9 ? 'KeyA' : null;
};
const dirOf = (a, b) => {
  const [ax, , az] = a.split(',').map(Number);
  const [bx, , bz] = b.split(',').map(Number);
  return Object.entries(STEP).find(([, [dx, dz]]) => bx - ax === dx && bz - az === dz)[0];
};

/** Walk to a cell with the keys: along the shortest way over the walk map, holding the key of each straight run until its last cell. */
async function walkTo(target, state) {
  const from = await cell();
  const route = st.path(state, from, target);
  assert.ok(route, `there is a way from ${from} to ${target}`);
  const cells = [from, ...route];
  const runs = [];
  for (let i = 1; i < cells.length; i++) {
    const d = dirOf(cells[i - 1], cells[i]);
    if (runs.length && runs.at(-1).dir === d) runs.at(-1).end = cells[i];
    else runs.push({ dir: d, end: cells[i] });
  }
  for (const run of runs) {
    const key = keyFor(run.dir);
    assert.ok(key, `a key for ${run.dir} (the camera has not been turned)`);
    await page.keyboard.down(key);
    await until(`window.__fold.cell() === '${run.end}'`, `${key} to ${run.end}`);
    await page.keyboard.up(key);
  }
  return runs.length;
}

/** E at the console the player stands at: Fold Mode opens, and the fold is made with the key (E again) or the mouse on the handle. */
async function foldAtConsole(consoleId, how) {
  assert.equal(await cell(), st.cellOf(consoleId), `standing at ${consoleId}`);
  await until(`document.querySelector('.prompt.show') !== null`, 'the console prompt');
  assert.match(await text('.prompt'), /E/, 'the prompt says E');
  idles.push([consoleId, await F(() => window.__fold.game.time - window.__fold.game.run.lastProgress)]);
  await page.keyboard.press('KeyE');
  await until(`window.__fold.mode() === 'fold'`, 'Fold Mode');
  const panel = await text('.panel.show');
  if (how === 'key') {
    await page.keyboard.press('KeyE');
  } else {
    await until(`window.__fold.foldView()?.arrived === true`, 'the camera at rest in the diorama', 120000);
    await look(`fold-mode-${consoleId}`);
    const at = async (deg) => {
      const p = await F((d) => window.__fold.grabPoint('handle', d), deg);
      assert.ok(p, `the handle is on screen at ${deg} deg`);
      await page.mouse.move(p.x, p.y);
    };
    await at(0);
    await page.mouse.down();
    for (let i = 1; i <= 15; i++) await at((-90 * i) / 15);
    await look(`handle-dragged-${consoleId}`);
    await page.mouse.up();
  }
  await until(`window.__fold.mode() === 'play'`, `the fold at ${consoleId} to end`, 120000);
  return panel;
}

// ---- the title, and Start with the mouse ----
await look('title');
const wall0 = Date.now();
await page.click('.btn.primary');
await until(`window.__fold.mode() === 'play'`, 'the game to start');
const game0 = await F(() => window.__fold.game.time);
const yaw = await F(() => window.__fold.game.rig.yaw);
forward = [-Math.sin(yaw), -Math.cos(yaw)];
right = [Math.cos(yaw), -Math.sin(yaw)];
await page.waitForTimeout(700);
// (one read, so a slow frame cannot end the view between the two questions: while it runs the intro text waits)
const seen = await F(() => ({ establishing: window.__fold.establishing(), hint: document.querySelector('.hint.show') !== null }));
assert.deepEqual(seen, { establishing: true, hint: false }, 'the establishing view comes first, with no text over it');
await look('establishing');

// a first step ends it, and the one line of the intro comes up
const first = keyFor('N');
await page.keyboard.down(first);
await until(`!window.__fold.establishing()`, 'the establishing view to end');
await page.keyboard.up(first);
assert.match(await text('.hint.show'), /道が途切れている/, 'the intro says that the road is broken, and nothing more');
assert.ok(!/E|操作盤|折/.test(await text('.hint.show')), 'it names no key and no console');
await look('the-start');

let state = s1.start;
const folds = [];

// ---- 1. the way the layout invites: the far bridge's console is the nearer one to walk to, and its fold is the wrong one ----
await walkTo(st.cellOf(wrongConsole), state);
await look('at-the-far-bridge');
const wrongPanel = await foldAtConsole(wrongConsole, 'key');
assert.match(wrongPanel, /行けなくなる場所/, 'Fold Mode said what the fold closes');
state = st.fold(state, wrongConsole, wrong.key);
folds.push(wrong.key);
assert.deepEqual(await gameState(), state, 'the game is where the model says it is');
assert.equal(await remaining(), 3, 'one fold further from the goal');
await look('after-the-wrong-fold');

// ---- 2. the console they stand at undoes it ----
await foldAtConsole(wrongConsole, 'key');
state = st.fold(state, wrongConsole, wrongBack);
folds.push(wrongBack);
assert.deepEqual(await gameState(), s1.start, 'back where the puzzle began');
assert.equal(await remaining(), 2, 'two folds to go again');

// ---- 3. the way on: the puzzle's own plan; the first fold with the mouse on the handle, the rest with the key ----
for (const [i, step] of s1.plan.entries()) {
  await walkTo(step.cell, state);
  if (i === 0) await look('at-the-near-bridge');
  const panel = await foldAtConsole(step.console, i === 0 ? 'mouse' : 'key');
  if (i === 0) assert.match(panel, /新しく行ける場所/, 'Fold Mode says what the fold opens');
  state = st.fold(state, step.console, step.key);
  folds.push(step.key);
  assert.deepEqual(await gameState(), state, `${step.key}: the game is where the model says it is`);
  assert.equal(await remaining(), s1.plan.length - 1 - i, `${step.key}: the goal came closer`);
}
const hints = await F(() => window.__fold.game.run.hints);
assert.equal(st.regionOf(state, await cell()), st.regionOf(state, s1.exit), 'the exit is in reach');
await look('solved');

// ---- the exit ----
await walkTo(s1.exit, state);
await until(`window.__fold.section() === 's2_path_cube'`, 'the second puzzle');
const wall = (Date.now() - wall0) / 1000;
const result = await F(() => window.__fold.game.results[0]);
const gameSec = await F((g0) => window.__fold.game.time - g0, game0);
await look('second-puzzle');

// what the game logged of it: every fold, the wrong one and its undo included, and no hint
await F(() => window.__fold.game.telemetry.flush());
await page.waitForTimeout(300);
const actions = sent.filter((e) => e.type === 'action');
assert.deepEqual(actions.map((e) => e.action), folds, 'every fold is logged, in order');
assert.ok(actions.every((e) => e.ok === true && e.section === 's1_first_fold'));
// A hint is the game doing its job when the player is slow (a slow machine is a slow player): it is asserted away only when the clock
// stayed well short of firstHintSec at every fold (with a fold's own seconds to spare), and reported either way.
const idleReport = idles.map(([c, s]) => `${c} ${s.toFixed(1)} s`).join(', ');
const hinted = sent.filter((e) => e.type === 'hint').length;
if (Math.max(...idles.map(([, s]) => s)) + 4 < FIRST_HINT_SEC) {
  assert.equal(hints, 0, 'no hint came');
  assert.equal(hinted, 0, 'and none was logged');
} else console.log(`  (the hint clock came within 4 s of firstHintSec (${FIRST_HINT_SEC} s) here: ${hints} hints counted, ${hinted} logged)`);
assert.equal(result.actions, folds.length, 'the section counted the folds');
assert.equal(result.optimal, 2);

assert.deepEqual(errors, []);
await F(() => window.dispatchEvent(new Event('pagehide')));
await browser.close();
console.log(
  `e2e playthrough: ok. Start to the second puzzle: ${wall.toFixed(1)} s on the clock, ${gameSec.toFixed(1)} s of game time ` +
  `(the puzzle itself ${result.sec.toFixed(1)} s); ${folds.length} folds (${folds.join(', ')}); ${hints} hints; the hint clock at each console: ${idleReport} (firstHintSec ${FIRST_HINT_SEC} s)`,
);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
