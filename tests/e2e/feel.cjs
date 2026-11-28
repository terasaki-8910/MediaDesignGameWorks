// E2E check of the three clarity changes of the play: the feel of a fold (a pull-back, an overshoot, a settle; a shake and
// dust at the stop; a note for each joined path), the marks of the sections' exits, and the path lines that the Fold Mode
// preview of the path cube lays on its ghost. It drives the game through the review mode's hooks (?shots=1&debug=1: the
// frames are stepped by hand, so every run sees the same thing) and looks at what is drawn.
// Needs a running build: `npm run build && npm run preview` (or set BASE_URL to a deployment).
// FEEL_OUT=<dir> also saves the frames it looks at, for looking at.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { describeBackend, launch } = require('./browser.cjs');
const { blankReason, decodePng, diffFraction, frameStats } = require('./png.cjs');
const { loadStage } = require('./stage.cjs');

(async () => {
const BASE = process.env.BASE_URL ?? 'http://localhost:4173/';
const OUT = process.env.FEEL_OUT;
// the first puzzle solved: the groups it moves, as a player has them when the later puzzles begin (from the solver)
const S1 = (await loadStage()).solvedGroups(0);
const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.setDefaultTimeout(180000);
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
let sent = 0;
await page.route('**/api/telemetry', (route) => {
  sent++;
  return route.fulfill({ status: 202, body: '{"ok":true}' });
});
await page.goto(`${BASE}?shots=1&debug=1&telemetry=1`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__shots && window.__shots.ready() && window.__fold, null, { timeout: 60000 });
console.log(`feel: ${await describeBackend(browser, page)}`);
const F = (fn, ...a) => page.evaluate(fn, ...a);

// helpers that live in the page: a still scene at a place, stepping by hand
await F(() => {
  const g = window.__fold.game;
  const w = g.world;
  window.__feel = {
    g, w,
    /** Section `index` in its start state with the groups in `patch` set, the player at `cell` (facing east), the camera settled. */
    scene(index, patch, cell) {
      g.settings = { ...g.settings, reduceMotion: false };
      g.stageShot(index, { ...g.cs.initialState(), ...patch }, false);
      if (cell) {
        g.player.place(cell, 'E', g.cs.walkMap(g.state));
        g.rig.snapBehind(g.player.root.rotation.y);
        g.rig.cut();
      }
      for (let i = 0; i < 50; i++) g.advance(1 / 60, i === 49);
    },
    /** Step (without drawing) until the running fold has got `p` of the way, then draw it. */
    until(p) {
      while (w.animProgress < p && g.mode === 'anim') g.advance(1 / 60, false);
      g.advance(0, true);
      return w.animProgress;
    },
    draw(n = 1) {
      for (let i = 0; i < n; i++) g.advance(1 / 60, i === n - 1);
    },
    /** The turn of the group's pivot about x, in degrees (the roll of the cube). */
    rollDegrees(group) {
      const q = w.pivots.get(group).quaternion;
      return (2 * Math.atan2(q.x, q.w) * 180) / Math.PI;
    },
    /** Run the fold that is under way to its end, drawing nothing, and report what it did. */
    run(group) {
      const seen = { frames: 0, min: 0, max: 0, shake: false, dust: false, stopAt: -1, stops: 0 };
      while (g.mode === 'anim' && seen.frames < 60 * 10) {
        g.advance(1 / 60, false);
        seen.frames++;
        const r = this.rollDegrees(group);
        seen.min = Math.min(seen.min, r);
        seen.max = Math.max(seen.max, r);
        if (w.shake.active) seen.shake = true;
        if (w.dust.active) seen.dust = true;
        if (seen.stopAt < 0 && w.anim && w.anim.stopped) seen.stopAt = w.animProgress;
      }
      seen.end = this.rollDegrees(group);
      return seen;
    },
  };
});

await F((p) => { window.__feel.s1 = p; }, S1);

let shotNo = 0;
const take = async (name) => {
  const buf = await page.screenshot();
  if (OUT) {
    fs.mkdirSync(OUT, { recursive: true });
    fs.writeFileSync(path.join(OUT, `${String(++shotNo).padStart(2, '0')}-${name}.png`), buf);
  }
  const png = decodePng(buf);
  assert.equal(blankReason(frameStats(png)), null, `${name} is not a blank frame`);
  return png;
};

// ---- exit marks: the current section's is on the floor, drawn, and the others are not ----
const marks = () => F(() => window.__feel.w.exits.filter((e) => e.group.visible).map((e) => e.section));
const markDiff = async (name) => {
  const on = await take(name);
  await F(() => {
    for (const e of window.__feel.w.exits) e.group.userData.was = e.group.visible, (e.group.visible = false);
    window.__feel.draw();
  });
  const off = decodePng(await page.screenshot());
  await F(() => {
    for (const e of window.__feel.w.exits) e.group.visible = e.group.userData.was;
    window.__feel.draw();
  });
  return diffFraction(on, off, 6);
};
assert.deepEqual(await F(() => window.__feel.w.exits.map((e) => [e.section, e.cell])), [['s1_first_fold', '-2,3,0'], ['s2_path_cube', '7,3,0']], 'the first fold and the path cube have an exit mark; the gate is its own');
const seen = [];
for (const [index, patch, cells, label] of [
  [0, S1, [[-8, 3, 0], [-5, 3, 0], [-3, 3, 0]], 'first-fold'],
  [1, S1, [[3, 3, 0], [5, 3, 0], [6, 3, 0]], 'path-cube'],
]) {
  for (const cell of cells) {
    await F(([i, p, c]) => window.__feel.scene(i, p, c), [index, patch, cell]);
    assert.deepEqual(await marks(), [await F(() => window.__fold.section())], `only this section's exit is lit (${label} from ${cell})`);
    const d = await markDiff(`exit-${label}-from-${cell[0]}`);
    seen.push(`${label} from cell ${cell[0]}: ${(d * 100).toFixed(3)} % of the frame`);
    assert.ok(d > 0.0001, `the exit mark of ${label} is drawn from cell ${cell[0]} (${(d * 100).toFixed(4)} % of the pixels differ without it)`);
  }
}
console.log(`  exit marks, the share of the frame they change: ${seen.join('; ')}`);
// the third section's exit is the gate: nothing is lit there
await F(() => window.__feel.scene(2, window.__feel.s1, [8, 3, 0]));
assert.deepEqual(await marks(), [], 'the gate is its own mark');

// ---- the fold: pull-back, overshoot, settle; shake and dust at the stop; the time it takes ----
const roll = async (reduce) => {
  await F((r) => {
    window.__feel.scene(1, window.__feel.s1, [0, 3, 0]);
    window.__feel.g.settings = { ...window.__feel.g.settings, reduceMotion: r };
    window.__fold.act('c_roll', 'c_roll:x90');
  }, reduce);
  return F(() => window.__feel.run('g_cube'));
};
const plain = 2.2 * (await F(() => window.__feel.g.foldScale)) ; // the turn alone (the tunables' scale, reduceMotion off at this point)
const normal = await roll(false);
console.log(`  roll: ${(normal.frames / 60).toFixed(2)} s (the turn alone: ${plain.toFixed(2)} s), pull-back ${normal.min.toFixed(2)} deg, overshoot ${(normal.max - 90).toFixed(2)} deg, ends at ${normal.end.toFixed(3)}, stop at ${(normal.stopAt * 100).toFixed(0)} % of the time`);
assert.ok(normal.min < -0.5, 'it pulls back before it turns');
assert.ok(normal.max > 90.5 && normal.max < 94, `it overshoots a little (${normal.max})`);
assert.ok(Math.abs(normal.end - 90) < 1e-6, 'and ends exactly on the quarter turn');
assert.ok(normal.frames / 60 >= plain && normal.frames / 60 <= plain * 1.15, 'in at most 15 % more time than the turn alone');
assert.ok(normal.shake && normal.dust, 'the stop shakes the camera and raises dust');
assert.ok(normal.stopAt > 0.75 && normal.stopAt < 0.9);
assert.equal(await F(() => window.__feel.g.mode), 'play');

const calm = await roll(true);
console.log(`  roll with reduceMotion: ${(calm.frames / 60).toFixed(2)} s, pull-back ${calm.min.toFixed(3)} deg, overshoot ${(calm.max - 90).toFixed(3)} deg`);
assert.ok(calm.min > -1e-6 && calm.max < 90 + 1e-6, 'reduceMotion: no pull-back, no overshoot');
assert.ok(!calm.shake, 'reduceMotion: no shake');
assert.ok(Math.abs(calm.end - 90) < 1e-6);
assert.ok(calm.frames / 60 <= plain * 0.7 * 1.02, 'and no longer than before');

// the fold of the first puzzle has the same feel: the near bridge pulls back, overshoots its quarter turn about the vertical, and stops with a shake and dust
const bridge = await F(() => {
  const { g, w } = window.__feel;
  window.__feel.scene(0, {}, [-4, 3, 2]);
  window.__fold.act('c0', 'c0:set1');
  const yaw = () => (2 * Math.atan2(w.pivots.get('g_b0').quaternion.y, w.pivots.get('g_b0').quaternion.w) * 180) / Math.PI;
  const from = yaw();
  const seen = { frames: 0, min: 0, max: 0, shake: false, dust: false };
  while (g.mode === 'anim' && seen.frames < 600) {
    g.advance(1 / 60, false);
    seen.frames++;
    const d = yaw() - from;
    seen.min = Math.min(seen.min, d);
    seen.max = Math.max(seen.max, d);
    if (w.shake.active) seen.shake = true;
    if (w.dust.active) seen.dust = true;
  }
  seen.end = yaw() - from;
  return seen;
});
console.log(`  near bridge: ${(bridge.frames / 60).toFixed(2)} s, pull-back ${bridge.max.toFixed(2)} deg, overshoot ${(-90 - bridge.min).toFixed(2)} deg, ends at ${bridge.end.toFixed(3)}`);
assert.ok(bridge.max > 0.5, 'it pulls back before it turns');
assert.ok(bridge.min < -90.5 && bridge.min > -94, `it overshoots a little (${bridge.min})`);
assert.ok(Math.abs(bridge.end + 90) < 1e-6, 'and ends exactly on the quarter turn');
assert.ok(bridge.shake && bridge.dust, 'the stop shakes the camera and raises dust');

// frames at 0, 25, 50, 75 and 100 % of a fold, and at the stop (the cube, and the street)
const frames = async (label, index, patch, cell, group, consoleId, key) => {
  await F(([i, p, c]) => window.__feel.scene(i, p, c), [index, patch, cell]);
  assert.ok(await F(([c, k]) => window.__fold.act(c, k), [consoleId, key]), `${label}: ${key} is a free action in this scene`);
  const pose = [];
  for (const p of [0, 0.25, 0.5, 0.75, 1]) {
    const got = await F((x) => window.__feel.until(x), p);
    pose.push(`${Math.round(p * 100)} %: ${(await F((gr) => window.__feel.rollDegrees(gr), group)).toFixed(1)}`);
    await take(`${label}-fold-${String(Math.round(p * 100)).padStart(3, '0')}`);
    if (p === 0.75) {
      // just after the stop: dust up, the camera shaking
      await F(() => window.__feel.until(0.83));
      assert.ok(await F(() => window.__feel.w.dust.active), `${label}: dust is up just after the stop`);
      const withDust = await take(`${label}-fold-stop`);
      await F(() => { window.__feel.w.dust.group.visible = false; window.__feel.g.advance(0, true); });
      const without = decodePng(await page.screenshot());
      await F(() => { window.__feel.w.dust.group.visible = true; window.__feel.g.advance(0, true); });
      const d = diffFraction(withDust, without, 4);
      console.log(`  ${label}: the dust changes ${(d * 100).toFixed(3)} % of the frame at the stop`);
      assert.ok(d > 0.0005, `${label}: the dust shows`);
    }
  }
  console.log(`  ${label}, turn about x of the pivot: ${pose.join(', ')} (deg)`);
};
await frames('cube', 1, S1, [0, 3, 0], 'g_cube', 'c_roll', 'c_roll:x90');
await F(() => window.__feel.until(1));

// ---- the preview of the path cube: its lines are laid over the ghost, up face and sides, not the face that looks down ----
await F(() => {
  window.__feel.scene(1, window.__feel.s1, [0, 3, 0]);
  window.__feel.g.uiShot('fold');
  window.__feel.draw(90);
});
const previewKeys = ['c_roll:x90', 'c_roll:x180', 'c_roll:x270'];
const looks = [];
for (let option = 0; option < previewKeys.length; option++) {
  const info = await F(() => {
    const w = window.__feel.w;
    const holder = w.previewInlay;
    return holder
      ? { groups: holder.children.length, glass: holder.children.map((c) => c.getObjectByName('kit:M_path_glass')?.material.emissiveIntensity) }
      : null;
  });
  assert.ok(info, `option ${option + 1}: the lines of the faces after the roll are laid on the ghost`);
  assert.deepEqual(info.glass, [1.5, 0.9], 'the up face brighter than the sides');
  const on = await take(`preview-cube-${previewKeys[option].replace(':', '-')}`);
  await F(() => { window.__feel.w.previewInlay.visible = false; window.__feel.draw(); });
  const off = decodePng(await page.screenshot());
  await F(() => { window.__feel.w.previewInlay.visible = true; window.__feel.draw(); });
  looks.push(`${previewKeys[option]}: ${(diffFraction(on, off, 6) * 100).toFixed(2)} %`);
  assert.ok(diffFraction(on, off, 6) > 0.0005, `option ${option + 1}: the lines change the picture`);
  // the same option from straight above, without the panel: the cube's own lines dim, the lines of the turned cube bright
  await F(() => {
    const g = window.__feel.g;
    const V = g.engine.camera.position.constructor;
    g.hud.setVisible(false);
    g.rig.setCinematic(new V(14.5, 42, 2.5), new V(14, 12, 2));
    g.rig.cut();
    window.__feel.draw(3);
  });
  await take(`preview-cube-${previewKeys[option].replace(':', '-')}-from-above`);
  await F(() => {
    const g = window.__feel.g;
    g.rig.setCinematic(null);
    g.hud.setVisible(true);
    g.rig.cut();
    window.__feel.draw(3);
  });
  await F(() => { window.__fold.press('KeyD'); window.__feel.draw(75); });
}
console.log(`  cube preview, the share of the frame the laid lines change: ${looks.join('; ')}`);
// leaving Fold Mode takes them away
await F(() => { window.__fold.press('Escape'); window.__feel.draw(3); });
assert.equal(await F(() => window.__feel.w.previewInlay), null, 'no lines once Fold Mode is closed');

// ---- the street (the biggest fold) ----
await frames('street', 2, { ...S1, g_tower: 1 }, [10, 3, -2], 'g_street', 'c_h', 'c_h:set1');

// ---- the notes: one for each path a fold joins, each a step higher ----
const played = await F(() => {
  const g = window.__feel.g;
  window.__feel.scene(2, { ...window.__feel.s1, g_tower: 1 }, [10, 3, -2]);
  const log = { joined: [], notes: [], stops: 0 };
  const joined = g.sound.joined.bind(g.sound);
  const thud = g.sound.thud.bind(g.sound);
  g.sound.thud = (...a) => { log.stops++; thud(...a); };
  g.sound.joined = (n) => {
    const tone = g.sound.tone;
    const f = [];
    g.sound.tone = (freq) => f.push(freq); // (only what the notes ask for: nothing is sounded)
    joined(n);
    g.sound.tone = tone;
    log.joined.push(n);
    log.notes.push(f.filter((_, i) => i % 2 === 0)); // (each note comes with its octave)
  };
  window.__fold.act('c_h', 'c_h:set1');
  window.__feel.run('g_street');
  return log;
});
console.log(`  the street joins ${played.joined} paths and plays ${played.notes[0].map((f) => f.toFixed(0)).join(' < ')} Hz, ${played.stops} stop(s)`);
assert.deepEqual(played.joined, [3], 'lowering the street joins three paths');
assert.equal(played.notes[0].length, 3, 'a note for each');
assert.ok(played.notes[0][0] < played.notes[0][1] && played.notes[0][1] < played.notes[0][2], 'each one higher');
assert.equal(played.stops, 1, 'and one knock at the stop');

// ---- crossing an exit in a played game: the mark flares, the next section's is lit ----
const play = await browser.newPage({ viewport: { width: 480, height: 270 } });
play.setDefaultTimeout(180000);
play.on('pageerror', (e) => errors.push(e.message));
await play.goto(`${BASE}?debug=1&q=low`, { waitUntil: 'load' });
await play.waitForFunction(() => !!window.__fold && window.__fold.game.ready, null, { timeout: 60000 });
const P = (fn, ...a) => play.evaluate(fn, ...a);
await P(() => window.__fold.start());
const lit = () => P(() => window.__fold.game.world.exits.filter((e) => e.group.visible).map((e) => [e.section, e.flare > 0]));
assert.deepEqual(await lit(), [['s1_first_fold', false]], 'the first exit is marked from the start');
await P(() => window.__fold.teleport([-2, 3, 0]));
await P(() => window.__fold.simulate(0.2));
assert.equal(await P(() => window.__fold.section()), 's2_path_cube');
assert.deepEqual(await lit(), [['s1_first_fold', true], ['s2_path_cube', false]], 'the exit that was crossed flares, the next one is lit');
await P(() => window.__fold.simulate(1));
assert.deepEqual(await lit(), [['s2_path_cube', false]], 'and the crossed one goes out');
await play.close();

await F(() => window.dispatchEvent(new Event('pagehide')));
await page.waitForTimeout(300);
await browser.close();
assert.equal(sent, 0, 'no telemetry from the review mode');
assert.deepEqual(errors, []);
console.log('e2e feel: ok (fold curve, stop effects, reduceMotion, exit marks, cube preview)');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
