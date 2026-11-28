// E2E check of the v0.5 movement in a real browser, on the prototype stage (?stage=proto), driven by real input (page.keyboard,
// page.mouse) in the game's own live loop: a swing on a thread lands exactly on the far cell, a chain goes on without landing, a
// handle turns its group from inside its reach and from nowhere else, a step the player blocks says so and changes nothing, a
// ride lands on the cell the solver named, a group in the middle of a turn cannot be walked onto; and the whole prototype is
// solved from its start by keys alone, timed. Teleports (`__fold.teleport`, `scene`) only set a case up; the other hooks only read.
// Needs a running build: `npm run build && npm run preview` (or set BASE_URL to a deployment).
// MECHANICS_OUT=<dir> also saves the pictures for looking at (a swing mid-arc, a chain, a targeted handle, a ride mid-turn, a
// blocked step), taken with the game's clock held (`halt`) at the moment they show. MECHANICS_Q=high draws them at the best tier.
// The e2e job of .github/workflows/ci.yml runs this (Linux, software WebGL); locally, install the browser once with `npx playwright install chromium`.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { describeBackend, launch } = require('./browser.cjs');
const { blankReason, decodePng, frameStats } = require('./png.cjs');

(async () => {
const BASE = process.env.BASE_URL ?? 'http://localhost:4173/';
const OUT = process.env.MECHANICS_OUT;
const QUALITY = process.env.MECHANICS_Q ?? 'low';
const browser = await launch();
const errors = [];
const open = async (query, viewport = { width: 1280, height: 720 }, settings = null) => {
  const page = await browser.newPage({ viewport });
  page.setDefaultTimeout(180000);
  if (settings) await page.addInitScript((v) => localStorage.setItem('fold-city:settings', JSON.stringify(v)), { v: 2, sensitivity: 1, invertY: false, reduceMotion: false, telemetry: true, muted: false, ...settings });
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/api/telemetry', (route) => route.fulfill({ status: 202, body: '{"ok":true}' }));
  await page.goto(`${BASE}?debug=1&q=${QUALITY}${query}`, { waitUntil: 'load' });
  await page.waitForFunction(() => !!window.__fold, null, { timeout: 60000 });
  await page.waitForFunction(() => { const b = document.querySelector('.btn.primary'); return !!b && !b.disabled; }, null, { timeout: 120000 });
  return page;
};
const near = (a, b, eps, what) => assert.ok(Math.abs(a - b) <= eps, `${what}: ${a} is not within ${eps} of ${b}`);

// keys are world axes while the camera faces east (yaw -90 degrees, as a section starts): W east, S west, D south, A north
const DIRKEY = { E: 'KeyW', W: 'KeyS', S: 'KeyD', N: 'KeyA' };
const dirOf = (a, b) => {
  const [ax, ay, az] = a.split(',').map(Number);
  const [bx, by, bz] = b.split(',').map(Number);
  if (ay !== by || Math.abs(bx - ax) + Math.abs(bz - az) !== 1) return null;
  return bx > ax ? 'E' : bx < ax ? 'W' : bz > az ? 'S' : 'N';
};
const CENTRE = (c) => { const [x, , z] = c.split(',').map(Number); return [x * 4 + 2, z * 4 + 2]; };

// --- 0. which stage is played: area1 by default, ?stage=proto the prototype, an unknown one falls back with a warning
{
  const warnings = [];
  const page = await browser.newPage({ viewport: { width: 320, height: 180 } });
  page.on('console', (m) => m.type() === 'warning' && warnings.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));
  const stageOf = async (query) => {
    await page.goto(`${BASE}?debug=1&q=low${query}`, { waitUntil: 'load' });
    await page.waitForFunction(() => !!window.__fold, null, { timeout: 60000 });
    return page.evaluate(() => window.__fold.game.cs.stage.stageId);
  };
  assert.equal(await stageOf(''), 'area1', 'no ?stage= plays area1');
  assert.equal(await stageOf('&stage=proto'), 'proto', '?stage=proto plays the prototype');
  assert.equal(warnings.length, 0, 'and says nothing');
  assert.equal(await stageOf('&stage=nowhere'), 'area1', 'an unknown stage plays area1');
  assert.ok(warnings.some((w) => /nowhere/.test(w)), `with a warning in the console (${warnings.join(' | ')})`);
  await page.close();
}

const page = await open('&stage=proto&telemetry=1');
console.log(`mechanics: ${await describeBackend(browser, page)}`);
const F = (fn, ...a) => page.evaluate(fn, ...a);
const cell = () => F(() => window.__fold.cell());
const live = () => F(() => window.__fold.live());
const state = () => F(() => ({ ...window.__fold.game.state }));
const queued = (type) => F((t) => window.__fold.game.telemetry.queue.filter((e) => e.type === t), type);
const settle = (sec = 1.2) => F((s) => window.__fold.simulate(s), sec);
const teleport = async (c) => {
  await F((x) => window.__fold.teleport(x), c.split(',').map(Number));
  await settle(0.3);
};
/** Section `index` in `state` (a player walks into it), the player on `c`, the camera at rest behind them, facing east. */
const setup = async (index, st, c) => {
  await F(([i, s]) => window.__fold.scene(i, s), [index, st]);
  await teleport(c);
  await F(() => window.__fold.setYaw(-Math.PI / 2));
  await settle(1.5);
};
/** Wait (polling every frame) until the in-page predicate holds. */
const until = (fn, arg, what, timeout = 30000) =>
  page.waitForFunction(fn, arg, { polling: 'raf', timeout }).catch((e) => { throw new Error(`timed out waiting for: ${what} (${e.message.split('\n')[0]})`); });
const idle = () => until(() => { const l = window.__fold.live(); return !l.swing && !l.turn; }, null, 'the swing or the turn to be over');
const atCentre = async (c, what) => {
  const l = await live();
  const [x, z] = CENTRE(c);
  near(l.pos[0], x, 1e-6, `${what}: x`);
  near(l.pos[2], z, 1e-6, `${what}: z`);
  near(l.pos[1], 12, 1e-6, `${what}: on the floor`);
};
let shotNo = 0;
/** Hold the game's clock and show the moment `body` leads to; `check` looks at it; with MECHANICS_OUT the frame is saved. Then the clock goes on. */
const moment = async (name, body, check = async () => {}) => {
  await F(() => window.__fold.halt(true));
  try {
    await body();
    await check();
    if (OUT) {
      await page.waitForTimeout(300); // (the loop draws the held game a few times)
      const buf = await page.screenshot();
      fs.mkdirSync(OUT, { recursive: true });
      fs.writeFileSync(path.join(OUT, `${String(++shotNo).padStart(2, '0')}-${name}.png`), buf);
      assert.equal(blankReason(frameStats(decodePng(buf))), null, `${name} is not a blank frame`);
    }
  } finally {
    await F(() => window.__fold.halt(false));
  }
};
/** Walk to one of the cells by keys alone: a key held until the cell changes, a thread crossed with Space. */
const walkTo = async (P, targets, { guard = 400 } = {}) => {
  const goal = [].concat(targets);
  const g = (fn, ...a) => P.evaluate(fn, ...a);
  const waitIdle = () => P.waitForFunction(() => { const l = window.__fold.live(); return !l.swing && !l.turn; }, null, { polling: 'raf', timeout: 60000 });
  for (let n = 0; n < guard; n++) {
    await waitIdle();
    const here = await g(() => window.__fold.cell());
    if (goal.includes(here)) return;
    const route = await g((t) => window.__fold.route(t), goal);
    assert.ok(route && route.length, `there is a route from ${here} to ${goal}`);
    const dir = dirOf(here, route[0]);
    if (!dir) {
      // a thread: the next cell is not a neighbour; Space swings along it (the camera faces east: the thread going east is taken)
      await P.keyboard.press('Space');
      await P.waitForFunction((c) => window.__fold.cell() === c && !window.__fold.live().swing, route[0], { polling: 'raf', timeout: 20000 });
      continue;
    }
    await P.keyboard.down(DIRKEY[dir]);
    try {
      await P.waitForFunction((c) => window.__fold.cell() !== c, here, { polling: 'raf', timeout: 15000 });
    } finally {
      await P.keyboard.up(DIRKEY[dir]);
    }
  }
  assert.fail(`never reached ${goal}`);
};

await F(() => window.__fold.start());
await page.waitForTimeout(300);
await settle(4); // (the establishing view is over)
const initial = await state();
assert.equal(await F(() => window.__fold.section()), 'p_threads');
assert.equal(await cell(), '-17,3,6');

// ---- 0b. a stuck player is hinted at a handle's step as at a console's (the prototype's sections use the default timings) ----
const hint = () => F(() => document.querySelector('.hint.show')?.textContent ?? '');
await settle(38); // (about 42 s since the section began: past the 40 s of the defaults)
assert.match(await hint(), /把手/, 'the first hint points at a handle');
assert.equal(await F(() => window.__fold.game.world.hintedHandle), 'h_ring', 'and the handle the plan starts with pulses');
await settle(60);
assert.match(await hint(), /「輪の把手」のそばで\s*Q\s*を押して回してみよう/, 'the second names the handle and the key');

// ---- 1. a swing: Space at a ring, along the thread, onto the far cell exactly ----
await teleport('-16,3,6');
let l = await live();
assert.equal(l.threads.preview, true, `the thread to the other ring is drawn where the player stands (${JSON.stringify(l)})`);
assert.match(l.prompt, /Space\s*渡る/, 'and the prompt says Space crosses');
const t0 = Date.now();
await page.keyboard.press('Space');
await until(() => !!window.__fold.live().swing, null, 'the swing to begin');
await until(() => window.__fold.live().swing?.k > 0.3 || !window.__fold.live().swing, null, 'the swing to be under way');
l = await live();
if (l.swing) {
  assert.equal(l.threads.hand, true, 'a thread runs from the hand to the far ring');
  assert.equal(l.threads.preview, false, 'and the preview is put away');
  assert.equal(l.swing.seconds, 0.45 + 0.06 * 4, 'a swing over four cells takes 0.45 s and 0.06 s a cell');
}
await until((c) => window.__fold.cell() === c && !window.__fold.live().swing, '-12,3,6', 'the swing to land');
const took = (Date.now() - t0) / 1000;
await atCentre('-12,3,6', 'landed on the far cell');
assert.equal((await live()).threads.hand, false, 'the thread in the hand is gone');
assert.deepEqual((await queued('swing')).map((e) => [e.from, e.to, e.chain]), [['-16,3,6', '-12,3,6', 0]], 'the swing is logged, with its chain index');
console.log(`swing: four cells in the game's 0.69 s (${took.toFixed(2)} s of the machine's clock with the frames it drew)`);
await moment('swing-mid-arc', async () => {
  await teleport('-16,3,6');
  await F(() => window.__fold.setYaw(-Math.PI / 2 + 0.5)); // a little to the side, so the arc is seen across
  await settle(1.2);
  await page.keyboard.press('Space');
  await F(() => window.__fold.simulate(0.01));
  await F(() => window.__fold.simulate(0.3)); // (about 40 % of the way)
}, async () => {
  const s = (await live()).swing;
  assert.ok(s && s.k > 0.3 && s.k < 0.6, `mid-arc (${s?.k})`);
  assert.ok((await live()).pos[1] < 12 - 1, 'below the floor it left, where the pendulum dips');
});
await F(() => window.__fold.setYaw(-Math.PI / 2));
await idle();

// ---- 2. a chain: Space in the last 40 % of a swing goes on along the next thread without landing ----
let chained = false;
for (let attempt = 1; attempt <= 12 && !chained; attempt++) {
  await teleport('-2,3,6');
  const before = (await queued('swing')).length;
  await page.keyboard.press('Space'); // -2 -> 1
  await until(() => !!window.__fold.live().swing, null, 'the swing to begin');
  const window1 = await page
    .waitForFunction(() => { const s = window.__fold.live().swing; return !s ? 'over' : s.open && !s.chained && s.k < 0.9 ? 'open' : false; }, null, { polling: 'raf', timeout: 10000 })
    .then((h) => h.jsonValue());
  if (window1 !== 'open') continue; // (a slow machine's frame went by the window: again)
  assert.match((await live()).prompt, /Space\s*続けて渡る/, 'the prompt offers the chain');
  await page.keyboard.press('Space');
  const second = await page
    .waitForFunction(() => { const s = window.__fold.live().swing; return !s ? 'over' : s.chain === 1 ? s : false; }, null, { polling: 'raf', timeout: 10000 })
    .then((h) => h.jsonValue());
  if (process.env.MECHANICS_DEBUG) console.log(`chain attempt ${attempt}: before ${before}, second ${JSON.stringify(second)}`);
  if (second === 'over') {
    await idle();
    continue; // (the first swing landed before the key was read)
  }
  chained = true;
  assert.equal(second.from, '1,3,6', 'the second swing leaves from the landing of the first');
  assert.equal(second.to, '4,3,6');
  assert.match((await live()).chain, /×2/, 'the HUD counts the chain');
  await idle();
  await atCentre('4,3,6', 'the chain lands on the far end');
  const log = (await queued('swing')).slice(before);
  assert.deepEqual(log.map((e) => [e.from, e.to, e.chain]), [['-2,3,6', '1,3,6', 0], ['1,3,6', '4,3,6', 1]], 'both swings are logged, the second with chain 1');
}
assert.ok(chained, 'a chain was made (Space in the last 40 % of the swing)');
await moment('chain', async () => {
  await teleport('-2,3,6');
  await F(() => window.__fold.setYaw(-Math.PI / 2 + 0.45));
  await settle(1.2);
  await page.keyboard.press('Space');
  await F(() => window.__fold.simulate(0.01));
  await F(() => window.__fold.simulate(0.45)); // (into the window: 65 % of 0.63 s)
  await page.keyboard.press('Space');
  await F(() => window.__fold.simulate(0.01));
  await F(() => window.__fold.simulate(0.4)); // (the first swing ends, the second is under way)
}, async () => {
  const s = (await live()).swing;
  assert.ok(s && s.chain === 1 && s.to === '4,3,6', `the second swing of the chain is in the air (${JSON.stringify(s)})`);
  assert.match((await live()).chain, /×2/);
});
await F(() => window.__fold.setYaw(-Math.PI / 2));
await idle();
// without the second Space the same swing lands on the stone
await teleport('-2,3,6');
await page.keyboard.press('Space');
await until((c) => window.__fold.cell() === c && !window.__fold.live().swing, '1,3,6', 'the plain swing to land on the stone');
await atCentre('1,3,6', 'landed on the stone');
assert.match((await live()).prompt, /Space\s*渡る/, 'where two threads leave, Space swings along the one the camera faces');

// ---- 3. a handle: from inside its reach, not from outside it ----
await F((s) => window.__fold.scene(0, s), initial);
await teleport('-16,3,6'); // out of reach of the ring's handle
await page.keyboard.press('KeyQ');
await page.keyboard.press('KeyE');
await settle(0.2);
l = await live();
assert.equal(l.target, null, 'no handle is targeted out of reach');
assert.equal(l.turn, null);
assert.doesNotMatch(l.prompt, /回す/, 'and the prompt does not offer one');
assert.deepEqual(await state(), initial, 'Q and E change nothing');
assert.equal((await queued('handle_step')).length, 0, 'and nothing is logged');

await teleport('-10,3,6'); // inside the reach of the ring's handle
l = await live();
assert.equal(l.target, 'h_ring', 'the handle in reach is targeted');
assert.match(l.prompt, /Q\s*\/\s*E\s*回す/, 'the prompt says Q / E turn it');
assert.match(l.prompt, /北を向いている/, 'with the pose it is in');
await moment('handle-targeted', async () => {
  await F(() => window.__fold.setYaw(-Math.PI / 2 - 0.35));
  await settle(1.4);
}, async () => assert.equal((await live()).target, 'h_ring'));
await F(() => window.__fold.setYaw(-Math.PI / 2));
await settle(0.6);
// the turn plays in real time
await page.keyboard.press('KeyQ'); // the ring faces east after one step back
await until(() => !!window.__fold.live().turn, null, 'the turn to begin');
assert.equal((await live()).turn.handle, 'h_ring');
await idle();
assert.equal((await state()).g_ring, 3, 'the ring now faces east');
assert.deepEqual((await queued('handle_step')).map((e) => [e.handle, e.dir, e.ok]), [['h_ring', -1, true]], 'the step is logged');

// ---- 4. the turned ring joins a thread from its post: swing from there ----
await teleport('-9,3,6');
assert.match((await live()).prompt, /Space\s*渡る/, 'the ring on its post now has a thread');
await page.keyboard.press('Space');
await until((c) => window.__fold.cell() === c && !window.__fold.live().swing, '-3,3,6', 'the long swing to land');
await atCentre('-3,3,6', 'six cells across the gap');

// ---- 5. a group in the middle of a turn: the player walks on meanwhile, but cannot walk onto it; once it is still, they can ----
await F((s) => window.__fold.scene(0, s), initial);
await teleport('4,3,6'); // on the platform next to the bridge, which lies the wrong way
assert.equal((await live()).target, 'h_bridge');
await page.keyboard.down('KeyW'); // east, towards it
await until(() => window.__fold.cell() === '5,3,6', null, 'the walk to the edge of the platform');
await page.keyboard.press('KeyE');
await until(() => window.__fold.live().turn?.progress > 0.3, null, 'the bridge to be well into its turn');
l = await live();
assert.ok(l.turn, 'the bridge is still turning');
assert.equal(await cell(), '5,3,6', 'held back at the edge of the turning bridge, on the last tile before it');
assert.ok(l.pos[0] < 6 * 4, 'not in the cell of the bridge');
await page.keyboard.up('KeyW');
const x5 = l.pos[0];
await page.keyboard.down('KeyS'); // west, back along the platform, while the bridge goes on turning
const walked = await page
  .waitForFunction((x) => { const v = window.__fold.live(); return x - v.pos[0] > 0.5 ? { turning: !!v.turn } : false; }, x5, { polling: 'raf', timeout: 20000 })
  .then((h) => h.jsonValue());
await page.keyboard.up('KeyS');
assert.equal(walked.turning, true, 'the player walked on while the bridge was still turning');
await idle();
assert.equal((await state()).g_bridge, 1, 'the bridge lies across the gap now');
await page.keyboard.down('KeyW');
await until(() => ['6,3,6', '7,3,6'].includes(window.__fold.cell()), null, 'the walk onto the bridge, once it is still', 20000);
await page.keyboard.up('KeyW');

// ---- 6. a step the player blocks: it says so and changes nothing ----
await setup(1, { ...initial, g_street: 1 }, '14,3,2'); // on the street, which lies level
l = await live();
assert.equal(l.target, 'h_street', 'the street handle is in reach');
const stateBefore = await state();
const stepsBefore = (await queued('handle_step')).length;
await page.keyboard.press('KeyQ'); // standing the street up again would take it from under their feet
await until(() => /干渉しています/.test(window.__fold.live().prompt), null, 'the refusal to be said');
l = await live();
assert.match(l.prompt, /干渉しています：.*あなたの立ち位置/, `the prompt says what blocks (${l.prompt})`);
assert.equal(l.turn, null, 'nothing turns');
assert.deepEqual(await state(), stateBefore, 'and the state is as it was');
assert.equal(await cell(), '14,3,2');
assert.equal(await F(() => window.__fold.game.world.glows.length > 0), true, 'the blocker flashes');
assert.deepEqual((await queued('handle_step')).slice(stepsBefore).map((e) => [e.handle, e.dir, e.ok, e.blockedBy.includes('player')]), [['h_street', -1, false, true]], 'the refusal is logged with what blocked');
await moment('blocked-step', async () => {
  await setup(1, { ...initial, g_street: 1 }, '14,3,2');
  await F(() => window.__fold.setYaw(-Math.PI / 2 + 0.3));
  await settle(1.0);
  await page.keyboard.press('KeyQ');
  await F(() => window.__fold.simulate(0.12));
}, async () => assert.match((await live()).prompt, /干渉しています/));

// ---- 7. a ride: on the ferry's end, the handle carries the player to the cell the solver named ----
await setup(1, initial, '11,3,5'); // the ferry's southern end, which is a tile of the group the handle turns
l = await live();
assert.equal(l.target, 'h_ferry');
const outcome = await F(() => {
  const g = window.__fold.game;
  const a = g.cs.handleActions('h_ferry', g.state).find((o) => o.action.dir === 1).action;
  return g.cs.motionOutcome(g.state, a, g.player.cell);
});
assert.equal(outcome.ok && outcome.ride, true, 'the core says this is a ride');
const yaw0 = (await live()).yaw;
await page.keyboard.press('KeyE');
await until(() => !!window.__fold.live().turn?.ride, null, 'the ride to begin');
assert.equal((await live()).turn.ride.to, outcome.cell, 'it is set to land where the core said');
await page.keyboard.down('KeyS'); // the keys do nothing meanwhile: the player is carried
await until(() => window.__fold.live().turn?.progress > 0.35, null, 'the ride to be under way');
const mid = await live();
await page.keyboard.up('KeyS');
assert.ok(Math.hypot(mid.pos[0] - 46, mid.pos[2] - 22) > 0.5, 'the player has been carried away from where they stood');
await idle();
await atCentre(outcome.cell, 'landed on the cell of the outcome');
assert.equal(await cell(), outcome.cell);
let dyaw = (await live()).yaw - yaw0;
dyaw = ((((dyaw + Math.PI) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) - Math.PI;
near(Math.abs(dyaw), Math.PI / 2, 0.05, 'and faces the same way to the ferry: turned with it by a quarter');
assert.deepEqual((await queued('ride')).map((e) => [e.handle, e.from, e.to]), [['h_ferry', '11,3,5', outcome.cell]], 'the ride is logged');
// a rider who stood at the edge of the tile comes down at the edge of the other cell, not at its middle
await setup(1, initial, '11,3,5');
await page.keyboard.down('KeyW'); // east, to the edge of the ferry's tile (its sides are closed)
await until(() => window.__fold.live().pos[0] > 11 * 4 + 3.4, null, 'the walk to the edge of the ferry tile');
await page.keyboard.up('KeyW');
await settle(0.3);
const edge = await live();
assert.equal(await cell(), '11,3,5');
await page.keyboard.press('KeyE');
await until(() => !!window.__fold.live().turn?.ride, null, 'the second ride to begin');
await idle();
const down = await live();
assert.equal(await cell(), outcome.cell, 'the second ride lands on the same cell');
const [cx, cz] = CENTRE(outcome.cell);
assert.ok(Math.hypot(down.pos[0] - cx, down.pos[2] - cz) > 1, `at the edge of the cell, not its middle (${down.pos[0].toFixed(2)}, ${down.pos[2].toFixed(2)} against ${cx}, ${cz})`);
assert.ok(Math.abs(down.pos[0] - cx) <= 2 && Math.abs(down.pos[2] - cz) <= 2, 'but inside it');
// (it is where the turn put the place they stood: the quarter turn about the pivot (46, 18) of the offset the player had)
const dx = edge.pos[0] - 46;
const dz = edge.pos[2] - 18;
near(down.pos[0], 46 + dz, 0.15, 'x after the quarter turn');
near(down.pos[2], 18 - dx, 0.15, 'z after the quarter turn');
await moment('ride-mid-turn', async () => {
  await setup(1, initial, '11,3,5');
  await F(() => window.__fold.setYaw(-Math.PI / 2 + 0.6));
  await settle(1.2);
  await page.keyboard.press('KeyE');
  await F(() => window.__fold.simulate(0.01));
  await F(() => window.__fold.simulate(0.85)); // (about half way round)
}, async () => {
  const t = (await live()).turn;
  assert.ok(t && t.ride && t.progress > 0.3 && t.progress < 0.8, `mid-turn (${JSON.stringify(t)})`);
});
await idle();

// ---- 8. which handle Q / E turn: the one nearest the camera's forward direction ----
await setup(1, { ...initial, g_ferry: 1 }, '14,3,4'); // in reach of both the ferry's handle (south) and the street's (east)
assert.equal((await live()).target, 'h_street', 'facing east: the street handle');
const canvas = await page.locator('canvas').first().boundingBox();
await page.mouse.move(canvas.x + 300, canvas.y + 360);
await page.mouse.down();
for (let i = 1; i <= 12; i++) await page.mouse.move(canvas.x + 300 + i * 55, canvas.y + 360); // right: the view turns to the south
await page.mouse.up();
await until(() => window.__fold.live().target === 'h_ferry', null, 'the camera turned to the other handle');

await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
await page.waitForTimeout(300);
await page.close();

// ---- 9. reduceMotion: a shorter, flatter swing and no camera sway ----
{
  const sway = async (settings) => {
    const R = await open('&stage=proto', { width: 640, height: 360 }, settings);
    const r = (fn, ...a) => R.evaluate(fn, ...a);
    await r(() => window.__fold.start());
    await R.waitForTimeout(300);
    await r(() => window.__fold.simulate(4));
    await r(() => window.__fold.teleport([-16, 3, 6]));
    await r(() => window.__fold.simulate(0.3));
    await r(() => {
      window.__low = 99;
      window.__sway = 0;
      const tick = () => {
        const l = window.__fold.live();
        if (l.swing) {
          window.__low = Math.min(window.__low, l.pos[1]);
          window.__sway = Math.max(window.__sway, window.__fold.game.rig.sway);
        }
        requestAnimationFrame(tick);
      };
      tick();
    });
    await R.keyboard.press('Space');
    await R.waitForFunction(() => !!window.__fold.live().swing, null, { polling: 'raf', timeout: 20000 });
    const seconds = await r(() => window.__fold.live().swing.seconds);
    await R.waitForFunction(() => window.__fold.cell() === '-12,3,6' && !window.__fold.live().swing, null, { polling: 'raf', timeout: 20000 });
    const result = { seconds, low: await r(() => window.__low), sway: await r(() => window.__sway) };
    await R.close();
    return result;
  };
  const plain = await sway(null);
  const calm = await sway({ reduceMotion: true });
  near(plain.seconds, 0.69, 1e-9, 'a swing over four cells');
  near(calm.seconds, 0.3 + 0.04 * 4, 1e-9, 'and with reduceMotion');
  assert.ok(calm.low > 12 - 1.6, `the arc is flatter with reduceMotion (lowest ${calm.low.toFixed(2)} m against the floor at 12; the plain dip is a third of 16 m)`);
  assert.ok(plain.sway > 0.05, `the camera sways in a swing (${plain.sway.toFixed(2)})`);
  assert.equal(calm.sway, 0, 'and not with reduceMotion');
}

// ---- 10. the whole prototype from its start, by keys alone, timed ----
{
  const P = await open('&stage=proto');
  const g = (fn, ...a) => P.evaluate(fn, ...a);
  await g(() => window.__fold.start());
  await P.waitForTimeout(300);
  await g(() => window.__fold.simulate(4));
  const started = Date.now();
  const log = [];
  let cleared = 0;
  for (let n = 0; n < 40; n++) {
    const mode = await g(() => window.__fold.mode());
    if (mode === 'finale' || mode === 'clear') break;
    const section = await g(() => window.__fold.section());
    const moves = await g(() => window.__fold.moves());
    if (!moves.length) {
      const exit = await g(() => window.__fold.game.section.exit.map((c) => c.join(',')));
      await walkTo(P, exit);
      await P.waitForFunction((s) => window.__fold.section() !== s || ['finale', 'clear'].includes(window.__fold.mode()), section, { timeout: 15000 });
      cleared++;
      log.push(`${section} cleared at ${((Date.now() - started) / 1000).toFixed(1)} s`);
      continue;
    }
    const m = moves[0];
    await walkTo(P, m.at);
    // the handle Q and E turn is the one the camera faces: look round by the mouse when another one in reach is nearer the view
    const want = m.action.handle;
    let dragged = 0;
    if ((await g(() => window.__fold.live().target)) !== want) {
      const box = await P.locator('canvas').first().boundingBox();
      for (const sign of [1, -1]) {
        await P.mouse.move(box.x + 300, box.y + 360);
        await P.mouse.down();
        for (let i = 1; i <= 12 && (await g(() => window.__fold.live().target)) !== want; i++) {
          await P.mouse.move(box.x + 300 + sign * i * 55, box.y + 360);
          dragged = sign * i * 55;
        }
        await P.mouse.up();
        if ((await g(() => window.__fold.live().target)) === want) break;
        await P.mouse.move(box.x + 300, box.y + 360);
        await P.mouse.down();
        await P.mouse.move(box.x + 300 - dragged, box.y + 360); // (back to where the camera was)
        await P.mouse.up();
        dragged = 0;
      }
    }
    assert.equal(await g(() => window.__fold.live().target), want, `facing the handle ${want} at ${m.at}`);
    await P.keyboard.press(m.action.dir > 0 ? 'KeyE' : 'KeyQ');
    await P.waitForFunction(() => !!window.__fold.live().turn, null, { polling: 'raf', timeout: 10000 });
    if (dragged) {
      const box = await P.locator('canvas').first().boundingBox(); // (the camera back where it was: the keys are world axes again)
      await P.mouse.move(box.x + 300, box.y + 360);
      await P.mouse.down();
      await P.mouse.move(box.x + 300 - dragged, box.y + 360);
      await P.mouse.up();
    }
    await P.waitForFunction(() => { const l = window.__fold.live(); return !l.swing && !l.turn; }, null, { polling: 'raf', timeout: 60000 });
    log.push(`${m.key} from ${m.at}${m.ride ? ' (a ride)' : ''} at ${((Date.now() - started) / 1000).toFixed(1)} s`);
    assert.equal(await g(() => window.__fold.cell()), m.to, `after ${m.key} the player stands where the solver said`);
  }
  const mode = await g(() => window.__fold.mode());
  const total = (Date.now() - started) / 1000;
  assert.ok(mode === 'finale' || mode === 'clear', `the prototype is solved by keys alone (mode ${mode})`);
  assert.equal(cleared, 2, 'both sections cleared');
  const results = await g(() => window.__fold.game.results.map((r) => [r.name, r.actions, r.optimal]));
  for (const r of results) assert.equal(r[1], r[2], `${r[0]}: solved in the optimal ${r[2]} actions`);
  console.log(`solve: the prototype solved by real input in ${total.toFixed(1)} s (${log.join('; ')})`);
  await P.close();
}

assert.deepEqual(errors, []);
await browser.close();
console.log('e2e mechanics: ok (stage loading, hints at a handle, a swing, a chain, handles in and out of reach, a turning group closed to walkers, a blocked step, a ride, the camera picks the handle, reduceMotion, the whole prototype solved by keys)');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
