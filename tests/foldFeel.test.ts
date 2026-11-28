import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import * as THREE from 'three';
import { CompiledStage, actionKey, type WalkMap, type WalkTile } from '../src/core/compile.ts';
import { CUBE_GROUP, SIDES, cellKey, type Side } from '../src/core/math.ts';
import { solveSection } from '../src/core/solver.ts';
import type { StageFile } from '../src/core/types.ts';
import { exitMarks, exitPad, exitPlacements, exitSide } from '../src/game/exitMarker.ts';
import {
  FOLD_TIME_GAIN, NOTE_LADDER, NO_FEEL, OVER_MAX, PULL_MAX, STOP_AT, Shake,
  feelFor, feelOf, feelReach, foldCurve, foldSeconds, jointsOf, joinNotes, settleCurve, settleSeconds, sweepRadius,
} from '../src/game/foldFeel.ts';
import { cubeFaceRoles, cubePlacements, faceInlays } from '../src/game/setPieces.ts';
import { sectionStartStates } from '../src/game/shots.ts';

const cs = new CompiledStage(JSON.parse(readFileSync('src/stages/area1.json', 'utf8')) as StageFile);
const starts = sectionStartStates(cs);

/** The optimal plan of every section, with the state before each action. */
function plans() {
  const out: { section: string; state: ReturnType<typeof cs.initialState>; action: ReturnType<typeof solveSection>['plan'][number] }[] = [];
  for (const [i, sec] of cs.stage.sections.entries()) {
    let state = starts[i];
    const cp = cs.stage.checkpoints.find((c) => c.id === sec.start)!;
    for (const action of solveSection(cs, sec.id, { state, cell: cellKey(cp.at) }).plan) {
      out.push({ section: sec.id, state, action });
      state = cs.apply(state, action);
    }
  }
  return out;
}

const moving = (group: string) => new Set(cs.modules.filter((m) => m.group === group).map((m) => m.id));

test('the fold curve pulls back, overshoots and ends exactly on the turn, without a jump', () => {
  const feel = { ant: 0.04, over: 0.03 };
  assert.equal(foldCurve(0, feel), 0);
  assert.equal(foldCurve(1, feel), 1, 'the turn ends exactly where the state says');
  let min = 0;
  let max = 0;
  let last = 0;
  let step = 0;
  for (let i = 1; i <= 2000; i++) {
    const v = foldCurve(i / 2000, feel);
    min = Math.min(min, v);
    max = Math.max(max, v);
    step = Math.max(step, Math.abs(v - last));
    last = v;
  }
  assert.ok(min < -0.039 && min >= -0.04 - 1e-9, `pulled back by its share of the turn (${min})`);
  assert.ok(max > 1.029 && max <= 1.03 + 1e-9, `overshoots by its share of the turn (${max})`);
  assert.ok(step < 0.01, `no jump in the curve (largest step ${step})`);
  // the peak of the overshoot is where the stop is
  assert.ok(Math.abs(foldCurve(STOP_AT, feel) - (1 + feel.over)) < 1e-9);
  // it starts by going back, and ends by coming back
  assert.ok(foldCurve(0.04, feel) < 0);
  assert.ok(foldCurve(0.9, feel) > 1);
  assert.ok(foldCurve(0.9, feel) < 1 + feel.over);
});

test('with reduceMotion the curve is one gentle ease: no pull-back, no overshoot, no step back', () => {
  const feel = { ant: 0.04, over: 0.03 };
  let last = 0;
  for (let i = 1; i <= 1000; i++) {
    const v = foldCurve(i / 1000, feel, true);
    assert.ok(v >= last - 1e-12 && v <= 1, `never back, never past (${v})`);
    last = v;
  }
  assert.equal(foldCurve(1, feel, true), 1);
  assert.equal(foldSeconds(2, true), 2, 'no longer than the plain turn');
});

test('a fold takes at most 15 % longer than the turn alone did', () => {
  assert.ok(FOLD_TIME_GAIN > 1 && FOLD_TIME_GAIN <= 1.15);
  assert.equal(foldSeconds(3.2, false), 3.2 * FOLD_TIME_GAIN);
  // ... and every fold of the stage still fits where the e2e tests wait for one (hints.cjs waits 4 s after a fold; a half turn takes 1.35 times)
  for (const g of cs.stage.groups) {
    const half = g.kind === 'orientation' || g.states.some((a) => g.states.some((b) => (((b - a) % 4) + 4) % 4 === 2));
    const longest = foldSeconds(((g.durationMs ?? 2000) / 1000) * (half ? 1.35 : 1), false);
    assert.ok(longest < 4, `${g.id}: ${longest} s`);
  }
});

test('the pull-back and the overshoot are small angles: the far end moves by a few decimetres', () => {
  for (const radius of [4, 6, 8.5, 16.5, 40]) {
    for (const angle of [Math.PI / 2, Math.PI, -Math.PI / 2]) {
      const f = feelFor(radius, angle);
      const over = f.over * Math.abs(angle);
      const pull = f.ant * Math.abs(angle);
      assert.ok(over <= OVER_MAX + 1e-12 && pull <= PULL_MAX + 1e-12);
      assert.ok(over * radius <= 0.3 + 1e-9, `overshoot at the far end: ${over * radius} m`);
      assert.ok(pull * radius <= 0.42 + 1e-9, `pull-back at the far end: ${pull * radius} m`);
      assert.ok(over > 0 && pull > 0);
    }
  }
  assert.deepEqual(feelFor(8.5, 0), NO_FEEL);
  assert.deepEqual(feelFor(0, Math.PI / 2), NO_FEEL);
});

test('every fold of the optimal plans has a pull-back and an overshoot that stay clear of everything', () => {
  for (const { section, state, action } of plans()) {
    const { feel, radius, angle } = feelOf(cs, state, action);
    assert.ok(radius > 3, `${section} ${actionKey(action)}: radius ${radius}`);
    assert.ok(feel.ant > 0 && feel.over > 0, `${section} ${actionKey(action)} keeps both (the sweep with its margin is free)`);
    assert.deepEqual(cs.sweepBlockers(state, action, [feelReach(feel, angle), feelReach(feel, angle)]), [], `${section} ${actionKey(action)}`);
  }
});

test('feelOf leaves out the pull-back or the overshoot whose extra sweep would pass through something', () => {
  const { state, action } = plans()[0];
  // a stage in which anything swept beyond the end hits a module, or anything swept before the start does
  const blockedAfter = Object.create(cs, { sweepBlockers: { value: (_s: unknown, _a: unknown, m: readonly [number, number]) => (m[1] > 0 ? ['m_wall'] : []) } }) as CompiledStage;
  const blockedBefore = Object.create(cs, { sweepBlockers: { value: (_s: unknown, _a: unknown, m: readonly [number, number]) => (m[0] > 0 ? ['m_wall'] : []) } }) as CompiledStage;
  const plain = feelOf(cs, state, action).feel;
  assert.ok(plain.ant > 0 && plain.over > 0);
  assert.deepEqual(feelOf(blockedAfter, state, action).feel, { ant: plain.ant, over: 0 });
  assert.deepEqual(feelOf(blockedBefore, state, action).feel, { ant: 0, over: plain.over });
});

test('the sweep with a margin finds what the extra angle would hit, and none of what the turn itself passes', () => {
  // lowering the street is free; swept 0.4 rad further it would go into the plaza it comes to lie against
  const state = starts[2];
  const lower = cs.consoleActions('c_h', state).find((o) => actionKey(o.action) === 'c_h:set1')!;
  assert.deepEqual(lower.blockedBy, []);
  assert.deepEqual(cs.sweepBlockers(state, lower.action, [0.05, 0.05]), [], 'a few degrees either way is clear');
  assert.deepEqual(cs.sweepBlockers(state, lower.action, [0.4, 0]), [], 'the pull-back swings away from the plaza');
  assert.deepEqual(cs.sweepBlockers(state, lower.action, [0, 0.4]), ['m_n0']);
  assert.deepEqual(cs.sweepBlockers(state, lower.action), cs.sweepBlockers(state, lower.action, [0, 0]), 'no margin: as before');
});

test('the radius of a group is its farthest corner from the axis', () => {
  const cube = cs.worldBoxes(cs.initialState()).filter((b) => moving('g_cube').has(b.module));
  const g = cs.groups.get('g_cube')!;
  assert.ok(Math.abs(sweepRadius(cube, g.pivot, 'x') - 6 * Math.SQRT2) < 1e-9, 'a 12 m cube about its middle: from the middle to a corner of a face');
  assert.ok(Math.abs(sweepRadius(cube, g.pivot, 'y') - 6 * Math.SQRT2) < 1e-9);
});

/** A walk map of a few tiles, by hand: `[cell x, module, open sides, plate?]` on one level. */
function walkMap(tiles: [number, string, Side[], boolean?][]): WalkMap {
  const map = new Map<string, WalkTile>();
  for (const [x, module, open, plate] of tiles) {
    const cell: [number, number, number] = [x, 0, 0];
    map.set(cellKey(cell), {
      key: cellKey(cell), cell, module, floorY: 0, plate: !!plate,
      open: Object.fromEntries(SIDES.map((s) => [s, open.includes(s)])) as Record<Side, boolean>,
    });
  }
  return { tiles: map, region: new Map(), conflicts: [] };
}

test('a joined path is a new open seam between two modules; a plate between two roads counts once', () => {
  const before = walkMap([[0, 'a', ['E']], [1, 'b', []]]);
  const after = walkMap([[0, 'a', ['E']], [1, 'b', ['W', 'E']], [2, 'c', ['W']]]);
  assert.equal(jointsOf(before, after, new Set(['b'])).joined, 2, 'b joins a (its edge was closed) and joins c');
  const alreadyA = walkMap([[0, 'a', ['E']], [1, 'b', ['W']]]);
  assert.equal(jointsOf(alreadyA, after, new Set(['b'])).joined, 1, 'a and b were joined already: only c is new');
  // a plate has an open edge at each end, and the two make one path
  const gap = walkMap([[0, 'a', []], [2, 'b', []]]);
  const bridged = walkMap([[0, 'a', ['E']], [1, 'p', ['W', 'E'], true], [2, 'b', ['W']]]);
  assert.equal(jointsOf(gap, bridged, new Set(['b'])).joined, 1);
  // seams that stay open are not new, and a module's own links are not seams
  assert.equal(jointsOf(bridged, bridged, new Set(['b'])).joined, 0);
  const inside = walkMap([[0, 'a', ['E']], [1, 'a', ['W']]]);
  assert.equal(jointsOf(walkMap([[0, 'a', []], [1, 'a', []]]), inside, new Set(['a'])).joined, 0);
});

test('turning the first bridge joins both its ends; the dust seams are where the group meets its neighbours', () => {
  const [first] = plans();
  assert.equal(actionKey(first.action), 'c1:set1');
  const next = cs.apply(first.state, first.action);
  const j = jointsOf(cs.walkMap(first.state), cs.walkMap(next), moving('g_b1'));
  assert.equal(j.joined, 2, 'the bridge meets the road on each side');
  assert.equal(j.seams.length, 2);
  for (const s of j.seams) assert.ok(s.side === 'E' || s.side === 'W');
});

test('the fold that closes a section joins at least one path, and every fold reports a plausible number', () => {
  const all = plans();
  for (const sec of cs.stage.sections) {
    const own = all.filter((p) => p.section === sec.id);
    const last = own[own.length - 1];
    const j = jointsOf(cs.walkMap(last.state), cs.walkMap(cs.apply(last.state, last.action)), moving(last.action.group));
    assert.ok(j.joined >= 1, `${sec.id}: the last fold joins something`);
  }
  for (const p of all) {
    const j = jointsOf(cs.walkMap(p.state), cs.walkMap(cs.apply(p.state, p.action)), moving(p.action.group));
    assert.ok(j.joined <= NOTE_LADDER.length, `${actionKey(p.action)}: ${j.joined}`);
  }
});

test('each joined path plays a note one step higher than the one before', () => {
  assert.deepEqual(joinNotes(0), []);
  assert.equal(joinNotes(1).length, 1);
  for (let n = 1; n <= NOTE_LADDER.length; n++) {
    const notes = joinNotes(n);
    assert.equal(notes.length, n);
    for (let i = 1; i < n; i++) assert.ok(notes[i] > notes[i - 1], `note ${i + 1} of ${n} is higher`);
  }
  assert.equal(joinNotes(99).length, NOTE_LADDER.length, 'a long run of paths stops at the top of the ladder');
  // one step is a whole tone or a minor third: a scale, not a siren
  const notes = joinNotes(NOTE_LADDER.length);
  for (let i = 1; i < notes.length; i++) assert.ok(notes[i] / notes[i - 1] < 2 ** (5 / 12) + 1e-9);
});

test('the shake is small, dies away, and is the same every time', () => {
  const a = new Shake();
  assert.equal(a.yaw, 0);
  a.kick(0.01);
  const first = [a.yaw, a.pitch];
  let peak = 0;
  for (let t = 0; t < 1; t += 1 / 60) {
    peak = Math.max(peak, Math.abs(a.yaw), Math.abs(a.pitch));
    a.update(1 / 60);
  }
  assert.ok(peak <= 0.01 && peak > 0.002);
  assert.equal(a.active, false);
  assert.equal(a.yaw, 0);
  const b = new Shake();
  b.kick(0.01);
  assert.deepEqual([b.yaw, b.pitch], first);
  b.clear();
  assert.equal(b.pitch, 0);
});

test('after any turn of the path cube exactly one face looks up, one down and four sideways', () => {
  for (const R of CUBE_GROUP) {
    const roles = Object.values(cubeFaceRoles(R));
    assert.equal(roles.filter((r) => r === 'up').length, 1);
    assert.equal(roles.filter((r) => r === 'down').length, 1);
    assert.equal(roles.filter((r) => r === 'side').length, 4);
  }
});

test('the face that the preview calls up is the face whose tiles the solver walks on after the turn', () => {
  const cube = cs.modules.find((m) => m.type === 'cube3')!;
  if (cube.type !== 'cube3') return;
  const g = cs.groups.get('g_cube')!;
  const floor = cs.stage.sections[0] && cs.walkMap(cs.initialState()).tiles.get(cellKey(cs.stage.checkpoints[0].at))!.floorY;
  CUBE_GROUP.forEach((R, index) => {
    const up = Object.entries(cubeFaceRoles(R)).find(([, role]) => role === 'up')![0] as keyof typeof cube.params.faces;
    const tiles = [...cs.walkMap({ ...cs.initialState(), [g.id]: index }).tiles.values()].filter((t) => t.module === cube.id);
    assert.equal(tiles.length, 1 + cube.params.faces[up].length, `orientation ${index}: the middle of the ${up} face and one tile for each of its arms`);
    for (const t of tiles) assert.equal(t.floorY, floor, 'level with the roads: the cube lies in the stage with its up face at their height');
  });
});

test('the preview lays the hub and one arm per arm of a face, lifted off it, looking the way the face looks', () => {
  const cube = cs.modules.find((m) => m.type === 'cube3')!;
  if (cube.type !== 'cube3') return;
  for (const face of Object.keys(cube.params.faces) as (keyof typeof cube.params.faces)[]) {
    const lifted = faceInlays(cube, face, 0.05);
    const flush = faceInlays(cube, face);
    assert.equal(lifted.length, 1 + cube.params.faces[face].length);
    assert.equal(lifted.filter((p) => p.piece === 'cube_inlay_hub').length, 1);
    lifted.forEach((p, i) => {
      const a = new THREE.Vector3().setFromMatrixPosition(p.matrix);
      const b = new THREE.Vector3().setFromMatrixPosition(flush[i].matrix);
      assert.ok(Math.abs(a.distanceTo(b) - 0.05) < 1e-9, 'lifted by 5 cm');
      assert.ok(Math.abs(p.matrix.determinant() - 1) < 1e-6, 'turned, never mirrored');
    });
  }
  // the same lines as the cube itself carries
  const own = cubePlacements(cube).filter((p) => p.piece.startsWith('cube_inlay'));
  const all = (Object.keys(cube.params.faces) as (keyof typeof cube.params.faces)[]).flatMap((f) => faceInlays(cube, f));
  assert.equal(own.length, all.length);
});

test('every exit but the gate is marked, with the way on along the road from the section start', () => {
  const marks = exitMarks(cs.stage);
  assert.deepEqual(marks.map((m) => m.section), ['s1_first_fold', 's2_path_cube'], "the third exit is the gate's own cell");
  assert.deepEqual(marks.map((m) => m.side), ['E', 'E']);
  assert.equal(exitSide([0, 3, 0], [0, 3, -5]), 'N');
  assert.equal(exitSide([0, 3, 0], [-5, 3, 1]), 'W');
  assert.equal(exitSide([0, 3, 0], [1, 3, 5]), 'S');
});

test('the exit mark is laid from the cube\'s path-line pieces inside the exit cell, its chevrons pointing on', () => {
  for (const m of exitMarks(cs.stage)) {
    const placed = exitPlacements(m.cell, m.side);
    assert.ok(placed.every((p) => p.piece === 'cube_inlay_arm'));
    const f = new THREE.Vector3(m.cell[0] * 4 + 2, m.cell[1] * 4, m.cell[2] * 4 + 2);
    const forward = new THREE.Vector3(1, 0, 0); // east
    // an arm runs along -Z of its piece, from 0.39 m to 5.81 m; the ends of every arm in the world
    for (const p of placed) {
      const ends = [0.39, 5.81].map((z) => new THREE.Vector3(0, 0, -z).applyMatrix4(p.matrix));
      for (const e of ends) {
        assert.ok(Math.abs(e.x - f.x) <= 2.05 + 1e-6 && Math.abs(e.z - f.z) <= 2.05 + 1e-6, `inside the cell: ${e.x - f.x}, ${e.z - f.z}`);
        assert.ok(Math.abs(e.y - f.y) < 1e-9, 'on the floor');
      }
      assert.ok(Math.abs(p.matrix.determinant()) > 0);
    }
    // the threshold crosses the road at the cell's near edge
    const bar = placed[0];
    const [a, b] = [0.39, 5.81].map((z) => new THREE.Vector3(0, 0, -z).applyMatrix4(bar.matrix));
    assert.ok(Math.abs(a.x - b.x) < 1e-9 && Math.abs(a.x - (f.x - 1.75)) < 1e-9, 'across the road, at the near edge');
    assert.ok(Math.abs(Math.abs(a.z - b.z) - 3.2) < 1e-9);
    // each chevron's two arms meet at a point ahead of where they trail to
    const arms = placed.slice(1);
    assert.equal(arms.length % 2, 0);
    for (let i = 0; i < arms.length; i += 2) {
      const [t0, t1] = [arms[i], arms[i + 1]].map((p) => new THREE.Vector3(0, 0, -0.39).applyMatrix4(p.matrix));
      assert.ok(t0.distanceTo(t1) < 1e-9, 'the arms meet at the point');
      for (const p of [arms[i], arms[i + 1]]) {
        const tail = new THREE.Vector3(0, 0, -5.81).applyMatrix4(p.matrix);
        assert.ok(tail.clone().sub(t0).dot(forward) < 0, 'and trail back from it');
      }
    }
  }
});

test('the pad of light under an exit mark is a soft-edged rectangle on the floor of the exit cell', () => {
  for (const m of exitMarks(cs.stage)) {
    const g = exitPad(m.cell, m.side);
    const pos = g.getAttribute('position');
    const col = g.getAttribute('color');
    const f = new THREE.Vector3(m.cell[0] * 4 + 2, m.cell[1] * 4, m.cell[2] * 4 + 2);
    let centre = 0;
    for (let i = 0; i < pos.count; i++) {
      const p = new THREE.Vector3().fromBufferAttribute(pos, i);
      assert.ok(Math.abs(p.y - f.y - 0.03) < 1e-4, 'a few millimetres above the floor');
      assert.ok(Math.abs(p.x - f.x) <= 2.1 + 1e-4 && Math.abs(p.z - f.z) <= 2.1 + 1e-4, 'within the cell and its joint');
      const v = col.getX(i);
      assert.ok(v >= 0 && v <= 1);
      const [hx, hz] = m.side === 'E' || m.side === 'W' ? [2.1, 1.85] : [1.85, 2.1]; // along the way on it is 4.2 m, across 3.7 m
      const edge = Math.abs(Math.abs(p.x - f.x) - hx) < 1e-4 || Math.abs(Math.abs(p.z - f.z) - hz) < 1e-4;
      if (edge) assert.ok(v < 1e-6, 'no light at the edge: nothing shows where it ends');
      if (p.distanceTo(f.clone().setY(f.y + 0.03)) < 1e-4) centre = v;
    }
    assert.equal(centre, 1);
    assert.ok(g.getAttribute('position').count > 100);
  }
});

test('a settle (a group let go of by the pointer) has no pull-back, overshoots at the same instant a fold stops, and ends exactly on the stop', () => {
  const over = 0.04;
  assert.equal(settleCurve(0, over), 0);
  assert.equal(settleCurve(1, over), 1, 'ends where the state says');
  assert.ok(Math.abs(settleCurve(STOP_AT, over) - (1 + over)) < 1e-12, 'the peak of the overshoot is at the stop');
  let last = 0;
  let max = 0;
  let step = 0;
  for (let i = 1; i <= 2000; i++) {
    const v = settleCurve(i / 2000, over);
    assert.ok(v >= 0, 'it never goes back before the start');
    if (i / 2000 <= STOP_AT) assert.ok(v >= last - 1e-12, 'it only goes on until the stop');
    step = Math.max(step, Math.abs(v - last));
    max = Math.max(max, v);
    last = v;
  }
  assert.ok(max <= 1 + over + 1e-12 && max > 1 + over - 1e-6);
  assert.ok(step < 0.01, `no jump (${step})`);
  // it is already moving: the first moments take it a good way (an ease-out), unlike a fold's slow start
  assert.ok(settleCurve(0.1, over) > 0.2);
  // with reduceMotion: one ease-out, no overshoot
  for (let i = 0; i <= 100; i++) assert.ok(settleCurve(i / 100, over, true) <= 1 + 1e-12);
  assert.equal(settleCurve(1, over, true), 1);
  // and with no overshoot (snapping back to where it was) it is a plain ease-out
  assert.equal(Math.max(...Array.from({ length: 101 }, (_, i) => settleCurve(i / 100, 0))), 1);
});

test("a settle takes the share of the turn's time that is left, and never so little that it cannot be seen", () => {
  assert.equal(settleSeconds(1.8, 1, false), foldSeconds(1.8, false));
  assert.ok(Math.abs(settleSeconds(1.8, 0.5, false) - foldSeconds(1.8, false) / 2) < 1e-12);
  assert.equal(settleSeconds(1.8, 0.01, false), 0.32, "a stop a hand's width away still takes a moment");
  assert.equal(settleSeconds(1.8, 0, true), 0.32);
  assert.equal(settleSeconds(0.2, 0.01, false), 0.2, 'and never longer than the whole turn');
  assert.equal(settleSeconds(1.8, 3, false), foldSeconds(1.8, false), 'a drag past the stop takes the whole turn at most');
});
