// E2E check of what makes the game playable on a weak PC, in a real browser:
//  1. quality 'auto': what it picks for a GPU name, that a chosen tier overrides it, and its live step down on the title,
//  2. game time follows the clock whatever the frame rate (a 5 fps machine used to run the game at a quarter of real time),
//  3. the keyboard: a key is read by its character when the browser sends no `code`, and by its code under an IME.
// Needs a running build: `npm run build && npm run preview` (or set BASE_URL to a deployment).
// The e2e job of .github/workflows/ci.yml runs this (Linux, software WebGL); locally, install the browser once with `npx playwright install chromium`.
const assert = require('node:assert/strict');
const { describeBackend, launch } = require('./browser.cjs');

(async () => {
const BASE = process.env.BASE_URL ?? 'http://localhost:4173/';
const browser = await launch();
const errors = [];
const open = async (query, viewport = { width: 320, height: 180 }) => {
  const page = await browser.newPage({ viewport });
  page.setDefaultTimeout(180000);
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${BASE}?debug=1${query}`, { waitUntil: 'load' });
  await page.waitForFunction(() => !!window.__fold, null, { timeout: 60000 });
  await page.waitForFunction(() => { const b = document.querySelector('.btn.primary'); return !!b && !b.disabled; }, null, { timeout: 120000 });
  return page;
};

// --- 1. what auto picks for a GPU name, and what a chosen tier does
const quality = async (query) => {
  const page = await open(query);
  const q = await page.evaluate(() => {
    const g = window.__fold.game;
    return { ...window.__fold.quality(), shadows: g.engine.renderer.shadowMap.enabled, smaa: g.engine.composer.passes.flatMap((p) => p.effects ?? []).some((e) => /SMAA/.test(e.name)) };
  });
  await page.close();
  return q;
};
const NAMES = { rtx: 'NVIDIA%20GeForce%20RTX%203060', gtx: 'NVIDIA%20GeForce%20GTX%201650', uhd: 'Intel(R)%20UHD%20Graphics%20620', swift: 'SwiftShader' };
let q = await quality(`&gpu=${NAMES.uhd}`);
assert.deepEqual([q.setting, q.quality, q.guess, q.shadows, q.smaa], ['auto', 'low', 'low', false, false], 'auto on an Intel UHD: low, with no shadow map and no SMAA');
q = await quality(`&gpu=${NAMES.swift}`);
assert.deepEqual([q.quality, q.guess], ['low', 'low'], 'auto on SwiftShader: low');
q = await quality(`&gpu=${NAMES.gtx}&q=auto`);
assert.deepEqual([q.quality, q.shadows, q.smaa], ['medium', true, true], 'auto on a GPU of no known class: medium');
q = await quality(`&gpu=${NAMES.rtx}`);
assert.equal(q.guess, 'high', 'auto on an RTX: high');
q = await quality(`&gpu=${NAMES.uhd}&q=high`);
assert.deepEqual([q.setting, q.quality, q.guess, q.shadows, q.smaa], ['high', 'high', 'low', true, true], 'a chosen tier overrides auto');
q = await quality(`&gpu=${NAMES.rtx}&q=low`);
assert.deepEqual([q.quality, q.shadows, q.smaa], ['low', false, false]);
console.log('realtime: auto picks low / medium / high by the GPU name, and a chosen tier overrides it');

// the live step down: auto starts at high for an RTX, measures the title, and steps down when the machine is not one
{
  const page = await open(`&gpu=${NAMES.rtx}`, { width: 640, height: 360 });
  await page.waitForFunction(() => window.__fold.quality().measured, null, { timeout: 120000 });
  const r = await page.evaluate(() => {
    const g = window.__fold.game;
    return { ...window.__fold.quality(), shadows: g.engine.renderer.shadowMap.enabled, matrix: g.sun.light.shadow.matrix.elements[12], smaa: g.engine.composer.passes.flatMap((p) => p.effects ?? []).some((e) => /SMAA/.test(e.name)) };
  });
  console.log(`realtime: measured on the title: median ${r.p50.toFixed(1)} ms, time-weighted ${r.typical.toFixed(1)} ms; ${r.guess} -> ${r.quality} at render scale ${r.scale}`);
  assert.equal(r.quality, r.typical > 33 ? 'low' : r.typical > 20 ? 'medium' : 'high', 'steps down by the thresholds');
  if (r.quality === 'low') {
    assert.equal(r.shadows, false, 'the shadow pass is off');
    assert.equal(r.matrix, 5, 'and every surface is outside the shadow frustum');
    assert.equal(r.smaa, false, 'the SMAA effect is gone');
    assert.ok(r.scale <= 0.6, `the render scale came down to the low tier's (${r.scale})`);
  }
  await page.evaluate(() => window.__fold.start());
  await page.waitForTimeout(1500);
  assert.equal(await page.evaluate(() => window.__fold.mode()), 'play', 'the game plays after the step down');
  await page.close();
}

// --- 2. game time follows the clock: a machine held to about 5 frames a second (a frame never ends before 200 ms)
{
  const page = await open('&q=low');
  console.log(`realtime: ${await describeBackend(browser, page)}`);
  await page.evaluate(() => window.__fold.start());
  await page.waitForTimeout(2000);
  const east = -Math.PI / 2;
  // the distance 3 s of W covers at 60 steps a second (the debug hook runs the game without drawing)
  const ref = await page.evaluate((yaw) => {
    const f = window.__fold;
    f.teleport([-9, 3, -3]); // (the west end of the north road: a straight of six cells, 24 m, east)
    f.setYaw(yaw);
    const x0 = f.game.player.pos.x;
    f.simulate(3, ['KeyW']);
    return f.game.player.pos.x - x0;
  }, east);
  const run = await page.evaluate(
    ([yaw, ms]) =>
      new Promise((resolve) => {
        const f = window.__fold;
        const g = f.game;
        f.teleport([-9, 3, -3]); // (the west end of the north road: a straight of six cells, 24 m, east)
        f.setYaw(yaw);
        f.simulate(0.5); // (stand still: no speed carried over)
        // hold the page to ms per frame: a frame callback does not start before ms after the one before it
        const raf = window.requestAnimationFrame.bind(window);
        let prev = 0;
        let lastFrame = -1;
        window.requestAnimationFrame = (cb) =>
          raf((t) => {
            if (t !== lastFrame) {
              lastFrame = t; // (the callbacks of one frame wait once)
              while (performance.now() - prev < ms);
              prev = performance.now();
            }
            cb(performance.now());
          });
        const x0 = g.player.pos.x;
        const game0 = g.time;
        f.hold('KeyW', true);
        const wall0 = performance.now();
        let frames = 0;
        const tick = () => {
          frames++;
          const wall = (performance.now() - wall0) / 1000;
          if (wall >= 3) {
            f.hold('KeyW', false);
            window.requestAnimationFrame = raf;
            resolve({ wall, game: g.time - game0, dx: g.player.pos.x - x0, frames });
          } else window.requestAnimationFrame(tick);
        };
        window.requestAnimationFrame(tick);
      }),
    [east, 200],
  );
  const fps = run.frames / run.wall;
  // the cap: a frame simulates at most 0.25 s, so down to 4 frames a second the game keeps the clock, and below it runs at 0.25 s per frame
  const expected = Math.min(1, 0.25 * fps);
  console.log(`realtime: ${fps.toFixed(1)} frames/s; game time ${run.game.toFixed(2)} s in ${run.wall.toFixed(2)} s of the clock (expected at least ${(0.85 * expected).toFixed(2)} of it); 3 s of W moved ${run.dx.toFixed(2)} m against ${ref.toFixed(2)} m at 60 steps a second`);
  assert.ok(fps < 8, `the test holds the page to a few frames a second (${fps})`);
  assert.ok(run.game / run.wall >= 0.85 * expected, `game time ran at ${(run.game / run.wall).toFixed(2)} of the clock`);
  assert.ok(run.dx >= 0.8 * expected * ref && run.dx <= 1.15 * ref, `W moved ${run.dx} m, at 60 steps a second ${ref} m`);
  await page.close();
}

// --- 3. keys read by their character when the browser sends no code, and under an IME
{
  const page = await open('&q=low');
  const key = (type, init) => page.evaluate(([t, i]) => window.dispatchEvent(new KeyboardEvent(t, i)), [type, init]);
  const down = (code) => page.evaluate((c) => window.__fold.game.input.down(c), code);
  await key('keydown', { key: 'w', code: '', keyCode: 87 });
  assert.equal(await down('KeyW'), true, 'W with an empty code is read by its character');
  await key('keyup', { key: 'w', code: '', keyCode: 87 });
  assert.equal(await down('KeyW'), false);
  await key('keydown', { key: 'ArrowUp', code: 'Unidentified' });
  assert.equal(await down('ArrowUp'), true, 'an arrow with code Unidentified');
  await key('keyup', { key: 'ArrowUp', code: 'Unidentified' });
  await key('keydown', { key: 'Process', code: 'KeyD', keyCode: 229 });
  assert.equal(await down('KeyD'), true, 'a keydown an IME took (keyCode 229) is still a held key');
  await key('keydown', { key: 'Process', code: 'KeyD', keyCode: 229, repeat: true });
  assert.equal(await down('KeyD'), true);
  await key('keyup', { key: 'd', code: 'KeyD', keyCode: 68 });
  assert.equal(await down('KeyD'), false);
  // a real key press through the browser (the code is there) still walks
  await page.evaluate(() => window.__fold.start());
  await page.waitForTimeout(500);
  await page.keyboard.down('w');
  assert.equal(await down('KeyW'), true);
  await page.keyboard.up('w');
  assert.equal(await down('KeyW'), false);
  await page.close();
}
assert.deepEqual(errors, []);
await browser.close();
console.log('e2e realtime: ok');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
