// E2E check of Fold Mode's drag, with real mouse events (page.mouse) in the game's own loop: the handle on the fold axis and the
// group itself are taken hold of, turned and let go of; the preview follows the stop that is nearest; letting go at a free stop folds
// as the keys do, near the start does nothing, and at a blocked stop the group goes back and the panel says what is in the way. The
// keys (A / D / E / Esc) and the look-round drag on empty space still work. Needs a running build: `npm run build && npm run preview`
// (or set BASE_URL to a deployment). DRAG_OUT=<dir> also saves, for each console, the handle at rest and a drag half way, for looking at.
// The e2e job of .github/workflows/ci.yml runs this (Linux, software WebGL); locally, install the browser once with `npx playwright install chromium`.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { describeBackend, launch } = require('./browser.cjs');
const { blankReason, decodePng, frameStats } = require('./png.cjs');

(async () => {
const BASE = process.env.BASE_URL ?? 'http://localhost:4173/';
const OUT = process.env.DRAG_OUT;
const QUALITY = process.env.DRAG_Q ?? 'low'; // (DRAG_Q=high for pictures that look as the game does at its best)
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
await page.goto(`${BASE}?debug=1&q=${QUALITY}&telemetry=1`, { waitUntil: 'load' });
await page.waitForFunction(() => !!window.__fold, null, { timeout: 60000 });
await page.waitForFunction(() => { const b = document.querySelector('.btn.primary'); return !!b && !b.disabled; }, null, { timeout: 120000 });
console.log(`drag: ${await describeBackend(browser, page)}`);
const F = (fn, ...a) => page.evaluate(fn, ...a);
const view = () => F(() => window.__fold.foldView());
const mode = () => F(() => window.__fold.mode());
const state = () => F(() => ({ ...window.__fold.game.state }));
const panel = () => F(() => document.querySelector('.panel.show')?.textContent ?? '');
const ghostShown = (group) => F((g) => !!window.__fold.game.world.ghosts.get(g)?.visible, group);
const stopAt = (v, deg) => v.angles.findIndex((a) => Math.abs(a - deg) < 1e-6);
const rounded = (xs) => xs.map((x) => Math.round(x));
const near = (a, b, eps, what) => assert.ok(Math.abs(a - b) <= eps, `${what}: ${a.toFixed(2)} is not within ${eps} of ${b}`);
let shotNo = 0;
const take = async (name) => {
  const buf = await page.screenshot();
  if (OUT) {
    fs.mkdirSync(OUT, { recursive: true });
    fs.writeFileSync(path.join(OUT, `${String(++shotNo).padStart(2, '0')}-${name}.png`), buf);
  }
  assert.equal(blankReason(frameStats(decodePng(buf))), null, `${name} is not a blank frame`);
};

/** Wait for the camera to be at rest in the diorama (the handle stands still on screen), and say what Fold Mode shows. */
const arrived = async () => {
  await page.waitForFunction(() => window.__fold.foldView()?.arrived === true, null, { timeout: 120000, polling: 100 });
  return view();
};
/** Section `index` in `state` (a player walks into it), the player at the console, Fold Mode opened with the E key. */
const openAt = async (index, state, consoleId) => {
  await F(([i, s, c]) => {
    window.__fold.scene(i, s);
    window.__fold.teleport(window.__fold.game.cs.consoles.get(c).at);
    window.__fold.simulate(0.2);
  }, [index, state, consoleId]);
  await page.keyboard.press('KeyE');
  await page.waitForFunction(() => window.__fold.mode() === 'fold', null, { polling: 50 });
  return arrived();
};
const closeFold = async () => {
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.__fold.mode() === 'play', null, { polling: 50 });
};
/** Move the pointer along the handle's rim (or a point of the group) to where it is when the group has been turned by `deg`. */
const moveTo = async (kind, deg) => {
  const p = await F(([k, d]) => window.__fold.grabPoint(k, d), [kind, deg]);
  assert.ok(p, `the ${kind} has a place on screen at ${deg} deg`);
  await page.mouse.move(p.x, p.y);
  return p;
};
/** Take hold at 0 and turn by hand to `deg`, in steps of at most 6 degrees; the button stays down. */
const dragTo = async (kind, deg) => {
  await moveTo(kind, 0);
  await page.mouse.down();
  const n = Math.max(2, Math.ceil(Math.abs(deg) / 6));
  for (let i = 1; i <= n; i++) await moveTo(kind, (deg * i) / n);
};
const turn = async () => (await view()).turn;
/** The fold is over, or the group is back: nothing is animating and no pointer holds the group. */
const settled = () => page.waitForFunction(() => { const v = window.__fold.foldView(); return !v || (!v.animating && v.drag === null); }, null, { timeout: 120000, polling: 50 });
/** Wait (polling, not sleeping) until `pred` holds. */
const until = async (pred, what, ms = 20000) => {
  const t0 = Date.now();
  while (!(await pred())) {
    if (Date.now() - t0 > ms) assert.fail(`timed out waiting for: ${what}`);
    await page.waitForTimeout(40);
  }
};
/** What the game has logged and not yet sent. */
const queued = (type) => F((t) => window.__fold.game.telemetry.queue.filter((e) => e.type === t).length, type);
/** Send what the game has logged, and wait until the page the route stands for has it. */
const flush = () => F(() => window.__fold.game.telemetry.flush());

await F(() => window.__fold.start());
await page.waitForTimeout(300);
await F(() => window.__fold.simulate(4)); // (the establishing view is over)
const initial = await state();

// ---- 1. the first bridge: the handle, the cursor, the look-round drag, a tap, a short drag, a drag to the stop ----
let v = await openAt(0, initial, 'c1');
assert.equal(v.group, 'g_b1');
assert.deepEqual(rounded(v.angles), [-90], 'the bridge has one stop, a quarter turn the one way');
assert.deepEqual(rounded([v.range.lo, v.range.hi]), [-90, 0], 'and may be turned that way and no other');
assert.ok(v.handle.reach * 2 >= 44, `the handle's grab area is at least 44 px across (${(v.handle.reach * 2).toFixed(0)})`);
assert.ok(v.handle.radiusPx * 2 >= 70, `and the ring reads ${(v.handle.radiusPx * 2).toFixed(0)} px across`);
assert.equal(await F(() => window.__fold.game.world.handle.visible), true, 'the handle is shown in Fold Mode');
assert.ok(/ドラッグで回す/.test(await panel()), 'the panel says the drag turns it');
assert.ok(/A.*D.*選択.*E.*実行.*Esc.*戻る/s.test(await panel()), 'and the keys are still there');
await take('c1-handle');

const at0 = await moveTo('handle', 0);
await page.waitForFunction(() => window.__fold.foldView().cursor === 'grab', null, { polling: 50 });
assert.equal(await F(([x, y]) => window.__fold.pickAt(x, y), [at0.x, at0.y]), 'handle', 'the press would take hold of the handle');
await page.mouse.move(40, 330); // empty space: the city
await page.waitForFunction(() => window.__fold.foldView().cursor === '', null, { polling: 50 });
assert.equal(await F(() => window.__fold.pickAt(40, 330)), null, 'nothing to take hold of out in the city');

// dragging on empty space looks round, as before, and turns nothing
const cam = () => F(() => window.__fold.game.engine.camera.position.toArray());
const before = await cam();
await page.mouse.down();
for (let i = 1; i <= 12; i++) await page.mouse.move(40 + i * 14, 330 + i * 2);
await page.mouse.up();
const moved = async () => Math.hypot(...(await cam()).map((x, i) => x - before[i]));
await until(async () => (await moved()) > 1, 'the view turns');
const orbit = await moved();
assert.ok(orbit > 1, `a drag on empty space turns the view (${orbit.toFixed(1)} m)`);
v = await arrived();
assert.equal(v.drag, null);
assert.equal(v.turn, 0, 'and turns nothing');
assert.deepEqual(await state(), initial);

// a press on the handle that does not move is no drag
await moveTo('handle', 0);
await page.mouse.down();
await page.mouse.up();
v = await view();
assert.equal(v.drag, null);
assert.equal(v.turn, 0);
assert.equal(await F(() => window.__fold.game.world.dragging), false, 'nothing was put away for a tap');

// a short drag: held near the start it is "no move": no ghost, the panel says so, and letting go brings it back
await dragTo('handle', -20);
v = await view();
assert.ok(v.drag.live && v.drag.near === -1, 'held near the start');
near(v.turn, -20, 0.5, 'the group follows the pointer');
assert.ok(/動かさない/.test(await panel()), 'the panel says nothing moves');
assert.equal(await ghostShown('g_b1'), false, 'and no ghost is shown');
assert.equal(await F(() => window.__fold.foldView().cursor), 'grabbing');
await page.mouse.up();
await settled();
v = await view();
assert.equal(v.turn, 0, 'letting go near the start puts it back');
assert.equal(await mode(), 'fold', 'and Fold Mode stays open');
assert.deepEqual(await state(), initial, 'no move');
assert.ok(/東西に向ける/.test(await panel()), 'with the option shown again');
assert.equal(await queued('action'), 0, 'and nothing is logged');

// half way to the stop: the preview follows
await dragTo('handle', -50);
v = await view();
near(v.turn, -50, 0.5, 'the group is turned as far as the pointer has taken it');
assert.equal(v.drag.near, 0, 'the nearest stop is the quarter turn');
assert.ok(/東西に向ける/.test(await panel()) && !/動かさない/.test(await panel()), 'the panel names it');
assert.equal(await ghostShown('g_b1'), true, 'and the ghost shows where it would end');
await take('c1-drag-half');
// past the stop the group is held there
await moveTo('handle', -120);
near((await view()).turn, -90, 0.5, 'held at the stop');
await moveTo('handle', -90);
await page.mouse.up();
await page.waitForFunction(() => window.__fold.mode() === 'play', null, { timeout: 120000, polling: 100 });
await settled();
let s = await state();
assert.equal(s.g_b1, 1 - initial.g_b1, 'the bridge has turned: the section\'s state changed');
await F(() => window.__fold.simulate(4));
assert.equal(await F(() => { const g = window.__fold.game; const wm = g.cs.walkMap(g.state); return wm.region.get(g.player.cell) === wm.region.get(g.section.exit[0].join(',')); }), true, 'and its two ends are joined');
await flush();
await until(() => sent.some((e) => e.type === 'action' && e.console === 'c1' && e.ok === true), 'the fold is logged as one by the keys');
assert.ok(sent.some((e) => e.type === 'preview' && e.console === 'c1' && e.committed === true));

// ---- 2. the group itself, not the handle ----
v = await openAt(0, initial, 'c1');
const body0 = await moveTo('body', 0);
assert.equal(await F(([x, y]) => window.__fold.pickAt(x, y), [body0.x, body0.y]), 'body', 'a point of the bridge can be taken hold of');
await page.waitForFunction(() => window.__fold.foldView().cursor === 'grab', null, { polling: 50 });
await dragTo('body', -80);
v = await view();
assert.equal(v.drag.kind, 'body');
near(v.turn, -80, 3, 'the bridge follows the pointer that has hold of it');
assert.equal(v.drag.near, 0);
await take('c1-body-drag');
await page.mouse.up();
await page.waitForFunction(() => window.__fold.mode() === 'play', null, { timeout: 120000, polling: 100 });
await settled();
assert.equal((await state()).g_b1, 1, 'letting go of it past the middle turns it all the way');

// ---- 3. the cube: three stops, the keys as before, the drag on the other side of the axis ----
v = await openAt(1, initial, 'c_roll');
assert.deepEqual(rounded([...v.angles].sort((a, b) => a - b)), [-90, 90, 180]);
assert.deepEqual(rounded([v.range.lo, v.range.hi]), [-90, 180]);
await take('c_roll-handle');
// the keys: D and A browse the options, as ever (the panel counts), Escape goes back
assert.ok(/1 \/ 3/.test(await panel()));
await page.keyboard.press('KeyD');
await page.waitForFunction(() => /2 \/ 3/.test(document.querySelector('.panel.show')?.textContent ?? ''), null, { polling: 50 });
await page.keyboard.press('KeyA');
await page.waitForFunction(() => /1 \/ 3/.test(document.querySelector('.panel.show')?.textContent ?? ''), null, { polling: 50 });
await closeFold();
assert.equal(await mode(), 'play');
// and E carries out the option on view: the key path is untouched by the drag
v = await openAt(1, initial, 'c_roll');
await page.keyboard.press('KeyE');
await page.waitForFunction(() => window.__fold.mode() === 'play', null, { timeout: 120000, polling: 100 });
await settled();
const keyed = await state();
assert.notEqual(keyed.g_cube, initial.g_cube, 'E folds');
// a drag of the same console to a quarter turn the other way folds to what that option says
v = await openAt(1, initial, 'c_roll');
const quarter = await F(() => {
  const g = window.__fold.game;
  const opts = g.cs.consoleActions('c_roll', g.state);
  return opts.map((o) => JSON.stringify(g.cs.apply(g.state, o.action)));
});
const wanted = quarter[stopAt(v, 90)];
await dragTo('handle', 96);
v = await view();
near(v.turn, 96, 0.8, 'turned past the stop by the hand');
assert.ok(Math.abs(v.angles[v.drag.near] - 90) < 1e-6);
await take('c_roll-drag-half');
await moveTo('handle', 90);
await page.mouse.up();
await page.waitForFunction(() => window.__fold.mode() === 'play', null, { timeout: 120000, polling: 100 });
await settled();
assert.equal(JSON.stringify(await state()), wanted, 'the cube turned to what the quarter-turn option does');
// a half turn is a stop at +180 only; the hand has to go that way
v = await openAt(1, initial, 'c_roll');
await dragTo('handle', 150);
v = await view();
assert.ok(Math.abs(v.angles[v.drag.near] - 180) < 1e-6);
await moveTo('handle', 0);
// Escape while holding the group: it goes back, nothing folds, the keys are the player's again
await moveTo('handle', 70);
assert.ok((await view()).drag.live);
await page.keyboard.press('Escape');
await page.waitForFunction(() => window.__fold.mode() === 'play', null, { polling: 50 });
await page.mouse.up();
assert.equal(await F(() => window.__fold.game.world.dragging), false, 'Escape drops the drag');
assert.equal(await F(() => { const g = window.__fold.game; return g.world.pivots.get('g_cube').quaternion.angleTo(g.world.groupQuaternion('g_cube', g.state)); }) < 1e-6, true, 'the cube is back in its pose');
assert.deepEqual(await state(), initial, 'and the state is as it was');

// ---- 4. a stop that is blocked: the group goes back with a shake, the panel says what is in the way ----
const blocked = await F(() => {
  const g = window.__fold.game;
  const cs = g.cs;
  for (const [index, sec] of cs.stage.sections.entries()) {
    let states = [{ ...cs.initialState() }];
    for (const id of sec.groups) {
      const gr = cs.groups.get(id);
      const n = gr.kind === 'states' ? gr.states.length : 24;
      states = states.flatMap((st) => Array.from({ length: n }, (_, k) => ({ ...st, [id]: k })));
    }
    for (const st of states)
      for (const c of sec.consoles) if (cs.consoleActions(c, st).some((o) => o.blockedBy.length)) return { index, state: st, console: c };
  }
  return null;
});
assert.ok(blocked, 'the stage has a blocked option somewhere');
v = await openAt(blocked.index, blocked.state, blocked.console);
const bad = v.blocked.indexOf(true);
const target = v.angles[bad];
const limit = target > 0 ? v.reach.hi : v.reach.lo;
console.log(`  blocked: ${blocked.console} in section ${blocked.index}, stop ${target} deg, the sweep is clear as far as ${limit.toFixed(1)}`);
assert.ok(Math.abs(limit) < Math.abs(target), 'the turn towards a blocked stop ends short of it, where the sweep meets something');
await dragTo('handle', target * 0.9);
v = await view();
assert.equal(v.drag.near, bad, 'the nearest stop is the blocked one');
near(v.turn, Math.sign(target) * Math.min(Math.abs(target) * 0.9, Math.abs(limit)), 0.6, 'the group is held where it would meet the thing in the way, not carried through it');
near(v.drag.angle, target * 0.9, 0.6, 'while the hand has gone on');
assert.ok(/干渉しています/.test(await panel()), 'and the panel says what is in the way, as it does for the key');
await take('blocked-drag');
const heldState = await state();
await page.mouse.up();
await page.waitForFunction(() => window.__fold.game.world.shake.active, null, { timeout: 60000, polling: 30 });
await settled();
v = await view();
assert.equal(v.turn, 0, 'letting go at a blocked stop puts the group back');
assert.equal(await mode(), 'fold', 'Fold Mode stays open');
assert.deepEqual(await state(), heldState, 'and nothing folded');
assert.ok(/干渉しています/.test(await panel()), 'the panel still says what is in the way');
await flush();
await until(() => sent.some((e) => e.type === 'action' && e.ok === false && e.console === blocked.console && e.blockedBy.length > 0), 'the refusal is logged as the key\'s is');
// ... and a refused drag can be tried again at once
await dragTo('handle', target * 0.4);
assert.ok((await view()).drag.live, 'the handle can be taken again');
await page.mouse.up();
await settled();
await closeFold();

// ---- 5. the street has a camera of its own for a fold; a fold the hand has carried most of the way keeps the view it was watched in ----
v = await openAt(2, initial, 'c_h');
assert.deepEqual(v.blocked, [false], "the street is free to lower from the stage's start");
await F(() => {
  window.__atRelease = null;
  window.addEventListener('pointerup', () => {
    const g = window.__fold.game;
    window.__atRelease = { mode: g.mode, inDiorama: g.rig.inDiorama, framed: g.rig.frame !== null, fov: g.engine.camera.fov };
  }, { once: true }); // (the window hears it after the game has)
});
await dragTo('handle', v.angles[0]);
await page.mouse.up();
const atRelease = await F(() => window.__atRelease);
assert.equal(atRelease.mode, 'anim', 'the fold goes on from where the hand let go');
assert.ok(atRelease.inDiorama && !atRelease.framed && atRelease.fov < 30, 'and the camera stays in the diorama, where it was watched');
await page.waitForFunction(() => window.__fold.mode() === 'play', null, { timeout: 120000, polling: 100 });
assert.equal((await state()).g_street, 1 - initial.g_street, 'the street is down');

// ---- 6. a narrow window (a phone held upright): the panel is at its tallest; the handle is above it and as large as a finger needs ----
await page.setViewportSize({ width: 360, height: 640 });
const narrow = [];
for (const [index, id, st] of [[0, 'c1', initial], [1, 'c_roll', initial], [1, 'c_yaw', initial], [2, 'c_t1', initial], [2, 'c_h', initial], [blocked.index, blocked.console, blocked.state]]) {
  v = await openAt(index, st, id);
  const panelTop = await F(() => document.querySelector('.panel.show').getBoundingClientRect().top);
  const w = await F(() => window.innerWidth);
  narrow.push(`${id} (${v.handle.x.toFixed(0)}, ${v.handle.y.toFixed(0)}) r ${v.handle.radiusPx.toFixed(0)} px, panel from ${panelTop.toFixed(0)}`);
  assert.ok(v.handle.reach * 2 >= 44, `${id}: the grab area is ${(v.handle.reach * 2).toFixed(0)} px across`);
  assert.ok(v.handle.x > 0 && v.handle.x < w && v.handle.y > 0 && v.handle.y < panelTop - 4, `${id}: the handle is in the frame, above the panel`);
  await take(`narrow-${id}`);
  await closeFold();
}
console.log(`  narrow window: ${narrow.join('; ')}`);
// a drag works there too
v = await openAt(0, initial, 'c1');
await dragTo('handle', -90);
await page.mouse.up();
await page.waitForFunction(() => window.__fold.mode() === 'play', null, { timeout: 120000, polling: 100 });
assert.equal((await state()).g_b1, 1 - initial.g_b1, 'a drag turns the bridge in the narrow window');
await page.setViewportSize({ width: 1280, height: 720 });

// ---- looking at them: the handle at rest and a drag half way, in every console of the stage ----
if (OUT) {
  for (const [index, sec] of (await F(() => window.__fold.game.cs.stage.sections.map((x) => ({ id: x.id, consoles: x.consoles })))).entries()) {
    for (const id of sec.consoles) {
      v = await openAt(index, initial, id);
      await take(`${id}-rest`);
      const free = v.blocked.findIndex((b) => !b);
      const stop = v.angles[free >= 0 ? free : 0];
      await dragTo('handle', stop * 0.55);
      await take(`${id}-half`);
      await closeFold(); // (Escape while holding: nothing folds)
      await page.mouse.up();
    }
  }
}

await F(() => window.dispatchEvent(new Event('pagehide')));
await browser.close();
assert.deepEqual(errors, []);
console.log('e2e drag: ok (the handle and the group by mouse: no move, a fold, a refusal; the keys and the look-round drag as before)');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
