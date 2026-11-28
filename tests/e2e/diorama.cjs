// E2E check of the diorama view (src/game/diorama.ts, camera.ts): at the start of a section the camera goes up to look over the
// whole puzzle and comes back behind the player in about 3 s, any new step or click ends it early, with reduce motion it cuts;
// Fold Mode holds the diorama and leaves it again; a fold's camera is the diorama's or the moving part's own view.
// The page runs in review mode (virtual clock, no animation loop), so the game is stepped by hand and nothing depends on timing.
// Needs a running build: `npm run build && npm run preview` (or set BASE_URL to a deployment).
// The e2e job of .github/workflows/ci.yml runs this (Linux, software WebGL); locally, install the browser once with `npx playwright install chromium`.
const assert = require('node:assert/strict');
const { describeBackend, launch } = require('./browser.cjs');
const { blankReason, decodePng, frameStats } = require('./png.cjs');
const { loadStage } = require('./stage.cjs');

(async () => {
const BASE = process.env.BASE_URL ?? 'http://localhost:4173/';
const S1 = (await loadStage()).tunables.sections.s1_first_fold; // (the improvement loop tunes the hint times)
const browser = await launch();
const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
page.setDefaultTimeout(180000);
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(`${BASE}?shots=1&debug=1&q=low`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__shots && window.__shots.ready(), null, { timeout: 60000 });
console.log(`diorama: ${await describeBackend(browser, page)}`);
const F = (fn, ...a) => page.evaluate(fn, ...a);
/** Step the game `sec` seconds (drawing the last frame when asked) and say where the camera is. */
const run = (sec, draw = false) =>
  F(([s, d]) => {
    const g = window.__fold.game;
    const n = Math.max(1, Math.round(s * 60));
    for (let i = 0; i < n; i++) g.advance(1 / 60, d && i === n - 1);
    const c = g.engine.camera;
    const p = g.player.pos;
    return {
      fov: c.fov, near: c.near, mode: g.mode, establishing: window.__fold.establishing(),
      far: Math.hypot(c.position.x - p.x, c.position.y - p.y, c.position.z - p.z),
      hint: !!document.querySelector('.hint.show:not(.hold)'),
    };
  }, [sec, draw]);
const WIDE = 62;
const near = (a, b, eps = 0.5) => Math.abs(a - b) < eps;

// the title's orbit runs first, as for a player; then Start
await run(0.3);
await F(() => window.__fold.start());
let r = await run(0.1);
assert.equal(r.establishing, true, 'the establishing view starts with the first puzzle');
assert.equal(r.hint, false, 'the intro text waits for the camera to be back (its box would stand over the view)');
r = await run(1.5, true);
assert.ok(r.fov < 30 && r.far > 50 && r.near > 1, `up in the diorama: a long lens (${r.fov.toFixed(1)}), far (${r.far.toFixed(0)} m)`);
assert.equal(blankReason(frameStats(decodePng(await page.screenshot()))), null, 'the diorama is not a blank frame');
r = await run(1.0); // 2.6 s in: the view has ended (2.2 s) and the camera is on its way back
assert.equal(r.establishing, false, 'the view ends by itself after about two seconds');
assert.ok(r.hint, 'and the section\'s intro text comes up');
r = await run(1.0);
assert.ok(near(r.fov, WIDE) && r.far < 12 && r.near < 0.2, `3.6 s in: back behind the player (${r.far.toFixed(1)} m, lens ${r.fov.toFixed(0)})`);
assert.equal(r.mode, 'play');

// Fold Mode at the first console: the diorama, with the intro hint out of the way; Escape and the camera goes back
await F(() => window.__fold.teleport(window.__fold.game.cs.consoles.get('c1').at));
await run(0.1);
await F(() => window.__fold.openFold('c1'));
r = await run(1.6, true);
assert.equal(r.mode, 'fold');
assert.ok(r.fov < 30 && r.far > 50, `Fold Mode holds the diorama (lens ${r.fov.toFixed(1)}, ${r.far.toFixed(0)} m)`);
assert.equal(r.hint, false, 'no hint box over the preview');
// the mouse turns the view a little way, and not beyond
const before = await F(() => window.__fold.game.engine.camera.position.toArray());
await F(() => { window.__fold.game.input.mouseDX = 10000; });
r = await run(2.5);
const after = await F(() => window.__fold.game.engine.camera.position.toArray());
const moved = Math.hypot(...after.map((v, i) => v - before[i]));
assert.ok(moved > 10 && moved < 120, `the mouse turns the view (${moved.toFixed(0)} m), within its limit`);
assert.ok(r.fov < 30, 'the lens stays');
await F(() => window.__fold.press('Escape'));
r = await run(1.6);
assert.equal(r.mode, 'play');
assert.ok(near(r.fov, WIDE) && r.far < 12, `closing Fold Mode returns to the follow camera (${r.far.toFixed(1)} m)`);

// a hint that helps the player choose (they have been stuck for a while) stays up in Fold Mode; only the intro text steps aside
await run(S1.firstHintSec, false);
r = await run(0.1);
assert.ok(r.hint, 'the hint a stuck player gets is on screen');
await F(() => window.__fold.openFold('c1'));
r = await run(0.5);
assert.equal(r.mode, 'fold');
assert.ok(r.hint, 'and it stays in Fold Mode');
await F(() => window.__fold.press('Escape'));
await run(1.6);

// a step ends the establishing view of the next puzzle early; a key held on entering it does not
// (the first puzzle's own plan, console by console; the exit has to be in reach of where the player ends up before they are put there)
for (const key of await F(() => window.__fold.solve())) {
  const id = key.split(':')[0];
  await F((c) => window.__fold.teleport(window.__fold.game.cs.consoles.get(c).at), id);
  await run(0.1);
  assert.ok(await F(([c, k]) => window.__fold.act(c, k), [id, key]), `${key} is possible`);
  await run(2.5);
}
assert.equal(await F(() => { const g = window.__fold.game; const wm = g.cs.walkMap(g.state); return wm.region.get(g.player.cell) === wm.region.get(g.section.exit[0].join(',')); }), true, 'the first puzzle is solved: the exit is in reach');
await F(() => window.__fold.hold('KeyW', true)); // the player runs through the exit holding W
await F(() => window.__fold.teleport(window.__fold.game.section.exit[0]));
r = await run(0.5);
assert.equal(await F(() => window.__fold.section()), 's2_path_cube');
assert.equal(r.establishing, true, 'a key that was held when the puzzle began does not skip the view');
await F(() => window.__fold.hold('KeyW', false));
await run(0.2);
await F(() => window.__fold.press('KeyD'));
r = await run(0.1);
assert.equal(r.establishing, false, 'a new key press ends it');
r = await run(1.4);
assert.ok(near(r.fov, WIDE) && r.far < 12, 'and the camera is back behind the player');

// reduce motion: a cut and a short hold
await F(() => { window.__fold.game.settings = { ...window.__fold.game.settings, reduceMotion: true }; });
const plan = await F(() => window.__fold.solve());
for (const key of plan) {
  const c = key.split(':')[0];
  await F((id) => window.__fold.teleport(window.__fold.game.cs.consoles.get(id).at), c);
  await run(0.1);
  assert.ok(await F(([id, k]) => window.__fold.act(id, k), [c, key]), `${key} is possible`);
  await run(3);
}
await F(() => window.__fold.teleport(window.__fold.game.section.exit[0]));
r = await run(0.2);
assert.equal(await F(() => window.__fold.section()), 's3_fold_gate');
assert.equal(r.establishing, true);
assert.ok(r.fov < 30 && r.far > 50, 'with reduce motion the camera is in the diorama at once');
r = await run(2.2);
assert.equal(r.establishing, false, 'and the short hold is over');
assert.ok(near(r.fov, WIDE) && r.far < 12, 'the camera is back behind the player at once');
await F(() => { window.__fold.game.settings = { ...window.__fold.game.settings, reduceMotion: false }; });

// each fold's camera: the diorama (the bridge, the cube, the tower) or the moving part's own view (the street)
await run(3);
const cameraDuring = async (console, key) => {
  await F((id) => window.__fold.teleport(window.__fold.game.cs.consoles.get(id).at), console);
  await run(0.1);
  assert.ok(await F(([id, k]) => window.__fold.act(id, k), [console, key]), `${key} is possible`);
  const r = await run(1.2);
  assert.equal(r.mode, 'anim', `${key}: the fold is running`);
  await run(4);
  return r;
};
const tower = await cameraDuring('c_t1', 'c_t1:set0');
assert.ok(tower.fov < 30 && tower.far > 50, `the tower's turn stays in the diorama (lens ${tower.fov.toFixed(1)})`);
await F(() => window.__fold.foldCamera('g_tower', 'view')); // the other camera, set from the debug hook
const own = await cameraDuring('c_t2', 'c_t2:set1');
assert.ok(near(own.fov, WIDE, 3), `a fold set to its own view takes it (lens ${own.fov.toFixed(0)})`);
const street = await cameraDuring('c_h', 'c_h:set1');
assert.ok(near(street.fov, WIDE, 3), `the street's fold has its own view (lens ${street.fov.toFixed(0)})`);
assert.equal(await F(() => window.__fold.game.mode), 'play');
const back = await run(2);
assert.ok(near(back.fov, WIDE) && back.far < 12, 'the camera is back behind the player when the fold is done');
await F(() => window.dispatchEvent(new Event('pagehide')));
await browser.close();
assert.deepEqual(errors, []);
console.log('e2e diorama: ok (the establishing view, its skip and its cut, Fold Mode, the orbit, the fold cameras)');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
