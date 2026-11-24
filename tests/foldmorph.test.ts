// The city the game shows: one sheet folded differently for each section (sheet.ts), its plan (morphplan.ts) and the
// folds between the structures. The studies it grew from are tested in foldcity.test.ts.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import * as THREE from 'three';
import { CompiledStage } from '../src/core/compile.ts';
import type { StageFile } from '../src/core/types.ts';
import { pierKeepOut } from '../src/game/foldcity/keepout.ts';
import { footprint } from '../src/game/foldcity/layout.ts';
import { MODELS, UNIT_FAMILY, unitFit } from '../src/game/foldcity/models.ts';
import { boxAt, heightAt, lipBlocks, NEAR_STRETCH, nearLandmarks, planMorph, presenceAt, SAMPLES, shownSurface, SPIRE_CLEAR, SPIRE_FAR, type MorphBuilding } from '../src/game/foldcity/morphplan.ts';
import { cutsSheet, overlaps, PLAY, PLAY_CENTER, SheetPoints, type Obb } from '../src/game/foldcity/plan.ts';
import { parseFreeze, SECTION_STRUCTURE } from '../src/game/foldcity/progression.ts';
import { bakeHeights, castShadows, CELL, MAP_HEIGHT, MAP_WIDTH, modelHeights } from '../src/game/foldcity/shadow.ts';
import {
  A0, A1, B0, B1, blendState, CEILING_Y, CREASE2, CREASE3, FLAT, GROUND_Y, makeState, restState, RING_HALF, SHEET_SIGN, sheetAt, sheetFrame, SLOT, STRUCTURES, veilAt, W0, Z0,
  type SheetState, type StructureName,
} from '../src/game/foldcity/sheet.ts';
import { skyline, SKYLINE_CLEAR } from '../src/game/foldcity/skyline.ts';
import { chooseUnits } from '../src/game/foldcity/unitpick.ts';
import { UNITS } from '../src/game/foldcity/units.ts';
import { frameAt, makeFrame } from '../src/game/foldcity/surfaces.ts';
import { VARIANTS } from '../src/game/foldcity/variants.ts';
import { pierFeet, planSlabs } from '../src/game/kitLayout.ts';

const SEED = 1207;
const cs = new CompiledStage(JSON.parse(readFileSync('src/stages/area1.json', 'utf8')) as StageFile);
const keepOut = pierKeepOut(pierFeet(planSlabs(cs)));
const plan = planMorph(SEED, keepOut);
const houses = plan.buildings.filter((b) => !b.prop);
const P = new THREE.Vector3();
const Q = new THREE.Vector3();
/** The fractions of a fold that are checked: the plan's own samples and the three the review frames are taken at. */
const FRACTIONS = [...new Set([...SAMPLES, 0.25, 0.5, 0.75])].sort((a, b) => a - b);

test('the sections show the canyon, the right-angle channel and the tube, in that order', () => {
  assert.deepEqual([...SECTION_STRUCTURE], ['horizon', 'fold90', 'ring']);
  assert.deepEqual(parseFreeze('s1-s2:0.5'), { from: 0, to: 1, f: 0.5 });
  assert.deepEqual(parseFreeze('s3-s2:0.25'), { from: 2, to: 1, f: 0.25 });
  for (const bad of ['s1-s3:0.5', 's1-s2:1.5', 's0-s1:0.5', 'loop', null]) assert.equal(parseFreeze(bad), null, String(bad));
});

test('at rest the sheet is each structure: the approved canyon, the right-angle channel with its slot of sky, the closed tube', () => {
  // the canyon is the study the owner approved, to within half a metre
  const proto = VARIANTS.horizon.make()[0].surface;
  let worst = 0;
  for (let a = A0; a <= A1; a += 7.3)
    for (const b of [-900, -200, -160, 0, 155, 170, 400]) worst = Math.max(worst, sheetAt(restState('horizon'), a, b, P).distanceTo(proto.at(b, a, Q)));
  assert.ok(worst < 0.5, `horizon is ${worst.toFixed(2)} m off its study`);
  // the channel: flat ground, upright walls, a level ceiling running back in, then the slot's walls straight up
  const fold = restState('fold90');
  for (const a of [A0, -300, 0, 700, A1])
    for (const side of [-1, 1]) {
      const at = (b: number) => sheetAt(fold, a, side * b, P);
      assert.ok(Math.abs(at(W0 - 1).y - GROUND_Y) < 1e-6);
      const wall = at(250).z;
      assert.ok(Math.abs(at(CREASE2 - 2).z - wall) < 0.01 && Math.abs(Math.abs(wall - Z0) - (W0 + 60 / Math.PI)) < 0.2, `the wall stands at z ${wall.toFixed(1)}`);
      assert.ok(Math.abs(at(CREASE2 + 32).y - CEILING_Y) < 0.6 && Math.abs(at(CREASE3 - 2).y - CEILING_Y) < 0.6, `the ceiling is at y ${at(CREASE3 - 2).y.toFixed(1)}`);
      assert.ok(Math.abs(Math.abs(at(CREASE3 + 32).z - Z0) - SLOT) < 0.6 && Math.abs(Math.abs(at(900).z - Z0) - SLOT) < 0.6, `the slot's wall is at z ${at(900).z.toFixed(1)}`);
      assert.ok(at(900).y > CEILING_Y + 400);
    }
  // the tube closes over the axis, and holds the play volume with room to spare
  const ring = restState('ring');
  assert.equal(ring.cut, RING_HALF);
  assert.ok(sheetAt(ring, 0, RING_HALF, P).distanceTo(sheetAt(ring, 0, -RING_HALF, Q)) < 0.05, `the seam gapes by ${P.distanceTo(Q).toFixed(2)} m`);
  assert.ok(Math.abs(P.z - Z0) < 0.03 && P.y > PLAY.max.y + 40);
  // the strip under the play area lies in the same place in every structure and all through every fold
  const state = makeState();
  for (let ti = 0; ti + 1 < STRUCTURES.length; ti++)
    for (let f = 0; f <= 1; f += 0.05) {
      blendState({ from: STRUCTURES[ti], to: STRUCTURES[ti + 1] }, f, state);
      for (const b of [-FLAT, -30, 0, 45, FLAT]) {
        sheetAt(state, 20, b, P);
        assert.ok(Math.abs(P.y - GROUND_Y) < 1e-6 && Math.abs(P.z - Z0 - b) < 1e-6, `the floor moves at b ${b}`);
      }
    }
});

test('the plan is the same every time, and every structure is a city', () => {
  const again = planMorph(SEED, keepOut);
  assert.equal(again.buildings.length, plan.buildings.length);
  assert.deepEqual(again.buildings.map((b) => b.alive), plan.buildings.map((b) => b.alive));
  assert.deepEqual(again.buildings.map((b) => b.presence), plan.buildings.map((b) => b.presence));
  STRUCTURES.forEach((name, si) => {
    assert.ok(plan.stats.standing[si] > 450, `${name}: ${plan.stats.standing[si]} buildings`);
    assert.ok(plan.stats.props[si] > 100, `${name}: ${plan.stats.props[si]} props`);
    // what the batch holds of the structure, near models included (some 280 detailed buildings of 1200 to 2900 triangles
    // each). No frame draws all of it: each instance is culled on its own, and tests/e2e/budget.cjs holds every shot to
    // the frame's budget
    assert.ok(plan.stats.triangles[si] < 900_000, `${name}: ${plan.stats.triangles[si]} triangles`);
  });
  // what the batch holds: every building and prop that stands in some structure
  const instances = plan.buildings.filter((b) => b.alive.some(Boolean)).length;
  assert.ok(instances <= 4200, `${instances} instances`);
});

test('the frame the city poses its buildings with is the frame of the surface', () => {
  const state = makeState();
  const a = makeFrame();
  const b = makeFrame();
  for (const [tr, f] of [[{ from: 'horizon', to: 'horizon' }, 0], [{ from: 'horizon', to: 'fold90' }, 0.4], [{ from: 'fold90', to: 'ring' }, 0.6], [{ from: 'ring', to: 'ring' }, 0]] as const) {
    blendState(tr, f, state);
    const surface = shownSurface(state, 'frame');
    for (const u of [-900, -200, 31.3, 240, 600, 1100])
      for (const v of [-700, -430, -260, -171.3, -20, 0.5, 90, 158.2, 300, 371, 455, 520]) {
        if (Math.abs(v) > state.cut) continue;
        frameAt(surface, SHEET_SIGN, u, v, a);
        sheetFrame(state, u, v, b);
        const what = `${tr.from} to ${tr.to} at ${f}, sheet ${u}, ${v}`;
        assert.ok(a.p.distanceTo(b.p) < 1e-9, what);
        assert.ok(a.n.angleTo(b.n) < 0.02, `${what}: normals ${a.n.angleTo(b.n).toFixed(3)} rad apart`);
        assert.ok(a.eu.angleTo(b.eu) < 0.02 && Math.abs(b.ev.dot(b.n)) < 1e-6, `${what}: tangents ${a.eu.angleTo(b.eu).toFixed(3)} rad apart`);
      }
  }
});

const playBox = (grow: number): Obb => {
  const box = PLAY.clone().expandByScalar(grow);
  return {
    c: box.getCenter(new THREE.Vector3()), a: [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)],
    h: [(box.max.x - box.min.x) / 2, (box.max.y - box.min.y) / 2, (box.max.z - box.min.z) / 2],
  };
};

/** The boxes of the buildings that stand in a state, each at its height factor there. */
function boxes(state: SheetState, name: string, height: (b: MorphBuilding) => number) {
  const surface = shownSurface(state, name);
  const f = makeFrame();
  const out: { b: MorphBuilding; obb: Obb; r: number }[] = [];
  for (const b of houses) {
    const h = height(b);
    if (h <= 0.02) continue;
    frameAt(surface, SHEET_SIGN, b.lot.u, b.lot.v, f);
    const obb = boxAt(b.lot, f, h);
    out.push({ b, obb, r: Math.hypot(...obb.h) });
  }
  return { surface, list: out };
}

function overlapping(list: { obb: Obb; r: number }[]): number {
  let bad = 0;
  for (let i = 0; i < list.length; i++)
    for (let j = i + 1; j < list.length; j++) {
      if (list[i].obb.c.distanceTo(list[j].obb.c) > list[i].r + list[j].r) continue;
      if (overlaps(list[i].obb, list[j].obb)) bad++;
    }
  return bad;
}

/** The sheet itself stays 10 m clear of the play volume. */
function sheetClear(state: SheetState, what: string) {
  const clear = PLAY.clone().expandByScalar(10);
  const reach = Math.min(B1, state.cut);
  for (let a = A0; a <= A1; a += 12)
    for (let b = -reach; b <= reach; b += 12) assert.ok(!clear.containsPoint(sheetAt(state, a, b, P)), `${what}: the sheet passes through the play volume at ${P.toArray().map(Math.round)}`);
}

/** How often the cross-section of the sheet (what is shown of it) crosses itself, at a few places along the axis. */
function selfCrossings(state: SheetState): number {
  let n = 0;
  const reach = Math.min(B1, state.cut);
  for (const a of [A0 + 300, -200, 0, 300, 900]) {
    const pts: [number, number][] = [];
    for (let b = -reach; b <= reach + 1e-9; b += 4) {
      if (veilAt(state, a, b) > 0.98) continue;
      sheetAt(state, a, b, P);
      pts.push([P.z, P.y]);
    }
    const side = (p: [number, number], q: [number, number], c: [number, number]) => {
      const v = (q[0] - p[0]) * (c[1] - p[1]) - (q[1] - p[1]) * (c[0] - p[0]);
      return v > 1e-6 ? 1 : v < -1e-6 ? -1 : 0;
    };
    for (let i = 0; i < pts.length - 1; i++)
      for (let j = i + 3; j < pts.length - 1; j++) {
        if (i === 0 && j === pts.length - 2) continue; // the tube's two ends meet at the seam
        if (side(pts[i], pts[j], pts[j + 1]) * side(pts[i + 1], pts[j], pts[j + 1]) < 0 && side(pts[i], pts[i + 1], pts[j]) * side(pts[i], pts[i + 1], pts[j + 1]) < 0) n++;
      }
  }
  return n;
}

test('in every structure: no two buildings overlap, nothing enters the play volume, nothing cuts through the sheet', () => {
  STRUCTURES.forEach((name, si) => {
    const state = restState(name);
    const { surface, list } = boxes(state, name, (b) => (b.alive[si] ? b.sy[si] : 0));
    assert.equal(overlapping(list), 0, `${name}: overlapping buildings`);
    const keep = playBox(6);
    for (const { obb, b } of list) assert.ok(!overlaps(obb, keep), `${name}: a building at sheet ${Math.round(b.lot.u)}, ${Math.round(b.lot.v)} is in the play volume`);
    sheetClear(state, name);
    assert.equal(selfCrossings(state), 0, `${name}: the sheet crosses itself`);
    const points = new SheetPoints([{ surface }], 6, 1150, PLAY_CENTER, 3);
    let cut = 0;
    for (const { obb, b } of list) {
      const [fu, fv] = footprint(MODELS[b.model], b.lot.scale, b.lot.swap, b.lot.stretch);
      if (cutsSheet(points, obb, 0, b.lot.u, b.lot.v, fu, fv, 0, 0.8)) cut++;
    }
    assert.equal(cut, 0, `${name}: ${cut} buildings cut through the sheet`);
  });
});

test('nothing is built where a pier of the play area comes down, and a foot stands there in every structure', () => {
  assert.ok(keepOut.length >= 8, `${keepOut.length} piers`);
  const feet = plan.buildings.filter((b) => MODELS[b.model].name === 'pier_foot');
  assert.equal(feet.length, keepOut.length);
  for (const foot of feet) assert.ok(foot.alive.every(Boolean) && foot.presence.every((p) => presenceAt(p, 0.5) === 1));
  for (const b of plan.buildings) {
    if (MODELS[b.model].name === 'pier_foot') continue;
    const [fu, fv] = footprint(MODELS[b.model], b.lot.scale, b.lot.swap, b.lot.stretch);
    for (const k of keepOut) assert.ok(Math.abs(b.lot.u - k.a) >= fu / 2 + k.r || Math.abs(b.lot.v - k.b) >= fv / 2 + k.r, `${MODELS[b.model].name} on the foot of a pier`);
  }
  // the piers reach the ground in every structure: sheet (x, z + 7.5) lies under the pier, never below its end (y = 12 - 132)
  for (const name of STRUCTURES)
    for (const k of keepOut) {
      sheetAt(restState(name), k.a, k.b, P);
      assert.ok(Math.abs(P.x - k.a) < 0.5 && P.y > -120 && P.y < -90, `${name}: the ground under the pier at x ${k.a} is at ${P.toArray().map((v) => v.toFixed(1))}`);
    }
});

/** The review cameras that look at the background (title, s1-overview, s1-play, player-front), as measured in the game. */
const CAMERAS = [[74, 34, -6], [-42.5, 35.7, 27.8], [-46.5, 16.4, 2], [-35.2, 13.8, 4]].map((c) => new THREE.Vector3(...c));

test('from the play volume and the review cameras no building is seen from behind', () => {
  const eyes = [...CAMERAS, PLAY_CENTER];
  STRUCTURES.forEach((name, si) => {
    const { list } = boxes(restState(name), name, (b) => (b.alive[si] ? b.sy[si] : 0));
    for (const { obb, b } of list) {
      const base = P.copy(obb.c).addScaledVector(obb.a[1], -obb.h[1]);
      for (const eye of eyes) assert.ok(obb.a[1].dot(Q.subVectors(eye, base)) > 0, `${name}: the building at sheet ${Math.round(b.lot.u)}, ${Math.round(b.lot.v)} turns its back to ${eye.toArray()}`);
    }
  });
});

test('a fold starts and ends exactly on the two structures, and every building is whole or absent there', () => {
  const state = makeState();
  for (let ti = 0; ti + 1 < STRUCTURES.length; ti++) {
    const tr = { from: STRUCTURES[ti] as StructureName, to: STRUCTURES[ti + 1] as StructureName };
    for (const [f, name] of [[0, tr.from], [1, tr.to]] as const) {
      blendState(tr, f, state);
      const rest = restState(name);
      assert.deepEqual([...state.psi.slice(0, 50)], [...rest.psi.slice(0, 50)]);
      assert.deepEqual([...state.gy.slice(300, 500)], [...rest.gy.slice(300, 500)]);
      assert.equal(state.cut, rest.cut);
    }
    for (const b of plan.buildings) {
      assert.equal(presenceAt(b.presence[ti], 0), b.alive[ti] ? 1 : 0);
      assert.equal(presenceAt(b.presence[ti], 1), b.alive[ti + 1] ? 1 : 0);
    }
  }
});

test('all through a fold: no two buildings overlap, nothing enters the play volume, the sheet neither crosses itself nor comes near the play area', () => {
  const state = makeState();
  for (let ti = 0; ti + 1 < STRUCTURES.length; ti++) {
    const tr = { from: STRUCTURES[ti] as StructureName, to: STRUCTURES[ti + 1] as StructureName };
    for (const f of FRACTIONS) {
      const what = `${tr.from} to ${tr.to} at ${f}`;
      blendState(tr, f, state);
      const { list } = boxes(state, 'blend', (b) => heightAt(b, ti, f));
      assert.equal(overlapping(list), 0, `${what}: overlapping buildings`);
      const keep = playBox(6);
      for (const { obb } of list) assert.ok(!overlaps(obb, keep), `${what}: a building is in the play volume`);
      sheetClear(state, what);
      assert.equal(selfCrossings(state), 0, `${what}: the sheet crosses itself`);
    }
  }
});

test('a fold is continuous: no point of the sheet near the play area jumps between neighbouring fractions', () => {
  const a = makeState();
  const b = makeState();
  for (let ti = 0; ti + 1 < STRUCTURES.length; ti++) {
    const tr = { from: STRUCTURES[ti] as StructureName, to: STRUCTURES[ti + 1] as StructureName };
    let worst = 0;
    for (let f = 0; f < 1; f += 1 / 240) {
      blendState(tr, f, a);
      blendState(tr, Math.min(1, f + 1 / 240), b);
      for (let u = A0; u <= A1; u += 40)
        for (const v of [-900, -600, -400, -170, 0, 170, 400, 600, 900]) {
          sheetAt(a, u, v, P);
          if (P.distanceTo(PLAY_CENTER) < 450) worst = Math.max(worst, P.distanceTo(sheetAt(b, u, v, Q)));
        }
    }
    // one frame of a 4 s fold at 60 fps: nothing within sight sweeps past (the fold before this one moved the tops of its
    // walls 19 m a frame)
    assert.ok(worst < 6, `${tr.from} to ${tr.to}: a point moves ${worst.toFixed(1)} m in one frame`);
  }
});

test('at rest the back of the sheet is not turned to the play volume or a review camera, but for the far-up twist of the canyon walls', () => {
  // the cameras, and the corners of the play volume from the walkways' level up (no camera goes under the walkways)
  const eyes = [...CAMERAS];
  for (let i = 0; i < 8; i++) eyes.push(new THREE.Vector3(i & 1 ? PLAY.max.x : PLAY.min.x, i & 2 ? PLAY.max.y : 8, i & 4 ? PLAY.max.z : PLAY.min.z));
  const f = makeFrame();
  for (const name of STRUCTURES) {
    const state = restState(name);
    const surface = shownSurface(state, name);
    let seen = 0;
    let back = 0;
    for (let a = A0 + 5; a < A1; a += 25)
      for (let b = Math.max(B0, surface.vRange[0]) + 5; b < Math.min(B1, surface.vRange[1]); b += 25) {
        if (veilAt(state, a, b) > 0.6) continue; // more than half dissolved
        frameAt(surface, SHEET_SIGN, a, b, f);
        for (const eye of eyes) {
          const d = f.p.distanceTo(eye);
          if (d > 700) continue; // beyond that the haze has taken 9 parts in 10
          seen++;
          if (f.n.dot(Q.subVectors(eye, f.p)) >= 0) continue;
          back++;
          assert.ok(d > 280, `${name}: the back of the sheet at ${f.p.toArray().map(Math.round)} is ${Math.round(d)} m from ${eye.toArray()}`);
        }
      }
    assert.ok(seen > 10000, `${name}: ${seen} samples`);
    // the canyon's walls twist as they rise: far up, a strip of wall can be seen from behind (it is drawn as foundations)
    assert.ok(back <= (name === 'horizon' ? seen * 0.06 : 0), `${name}: ${back} of ${seen} samples of the sheet show their back`);
  }
});

test('trees, fountains, monuments and the piers feet stay out of the play volume too, at rest and all through a fold', () => {
  const props = plan.buildings.filter((b) => b.prop);
  const keep = playBox(6);
  const f = makeFrame();
  const state = makeState();
  const check = (s: SheetState, what: string, height: (b: MorphBuilding) => number) => {
    const surface = shownSurface(s, what);
    for (const b of props) {
      const h = height(b);
      if (h <= 0.02) continue;
      frameAt(surface, SHEET_SIGN, b.lot.u, b.lot.v, f);
      assert.ok(!overlaps(boxAt(b.lot, f, h), keep), `${what}: a ${MODELS[b.model].name} at sheet ${Math.round(b.lot.u)}, ${Math.round(b.lot.v)} is in the play volume`);
    }
  };
  STRUCTURES.forEach((name, si) => check(restState(name), name, (b) => (b.alive[si] ? b.sy[si] : 0)));
  for (let ti = 0; ti + 1 < STRUCTURES.length; ti++)
    for (const at of FRACTIONS) {
      const tr = { from: STRUCTURES[ti] as StructureName, to: STRUCTURES[ti + 1] as StructureName };
      check(blendState(tr, at, state), `${tr.from} to ${tr.to} at ${at}`, (b) => heightAt(b, ti, at));
    }
});

test('every near face of the city has landmarks, and its rows mix houses of four to twelve storeys', () => {
  STRUCTURES.forEach((name, si) => {
    // the faces the play shots and the turned views look at: within 400 m across the sheet, 500 m along it
    const near = houses.filter((b) => b.alive[si] && Math.abs(b.lot.v) < 400 && Math.abs(b.lot.u) < 500);
    const landmarks = near.filter((b) => MODELS[b.model].kind === 'landmark');
    assert.ok(landmarks.length >= 6, `${name}: ${landmarks.length} landmarks near the play area`);
    for (const sign of [-1, 1]) assert.ok(landmarks.some((b) => Math.sign(b.lot.v) === sign), `${name}: a landmark on side ${sign}`);
    const kinds = new Set(near.map((b) => MODELS[b.model].name));
    assert.ok(kinds.size >= 8, `${name}: ${kinds.size} kinds of building near the play area`);
    const share = new Map<string, number>();
    for (const b of near) share.set(MODELS[b.model].name, (share.get(MODELS[b.model].name) ?? 0) + 1 / near.length);
    for (const [kind, s] of share) assert.ok(s < 0.34, `${name}: ${kind} is ${(s * 100).toFixed(0)} % of the near city`);
    const heights = near.map((b) => MODELS[b.model].h * b.lot.scale * b.sy[si]);
    assert.ok(Math.min(...heights) < 22 && Math.max(...heights) > 55, `${name}: heights ${Math.min(...heights).toFixed(0)} to ${Math.max(...heights).toFixed(0)} m`);
  });
});

test("the sheet's upper edge ends block by block, and the houses' plan and the ground's shader agree on where", () => {
  const state = restState('fold90');
  const block = lipBlocks(plan.lattice);
  const nu = plan.lattice.u.length - 1;
  let whole = 0;
  let gone = 0;
  let between = 0;
  for (let j = 0; j + 1 < plan.lattice.v.length; j++)
    for (let i = 0; i < nu; i++) {
      const [ua, ub, va, vb] = [plan.lattice.u[i].c, plan.lattice.u[i + 1].c, plan.lattice.v[j].c, plan.lattice.v[j + 1].c];
      if (Math.min(Math.abs(va), Math.abs(vb)) < CREASE3 + 30 || ua < -500 || ub > 500) continue;
      // the same value all over a block (a little inside its street lines)
      const vs = [[0.1, 0.1], [0.9, 0.1], [0.5, 0.5], [0.1, 0.9], [0.9, 0.9]].map(([p, q]) => veilAt(state, ua + (ub - ua) * p, va + (vb - va) * q, block));
      assert.ok(Math.max(...vs) - Math.min(...vs) < 1e-9, `block ${i},${j} is cut through`);
      if (vs[0] === 0) whole++;
      else if (vs[0] === 1) gone++;
      else between++;
    }
  assert.ok(whole > 20 && gone > 20, `${whole} blocks whole, ${gone} gone`);
  assert.ok(between <= 0.2 * (whole + gone), `${between} blocks half dissolved at rest`);
  // no house stands on a block that has begun to go
  for (const b of houses) if (b.alive[1]) assert.ok(veilAt(state, b.lot.u, b.lot.v, block) <= 0.02, 'a house on a dissolving block');
});

test('the cast shadows: each model lies in the height map where the city draws it, and a tower throws a shadow away from the light', () => {
  // a box 8 x 6 x 4 m off-centre in its own frame
  const mh = modelHeights(new THREE.BoxGeometry(8, 6, 4).translate(1, 3, 0));
  assert.ok(Math.abs(mh.x0 + 3) < 1e-6 && Math.abs(mh.z0 + 2) < 1e-6);
  assert.ok(mh.h.every((v) => Math.abs(v - 6) < 1e-6), 'the box is 6 m high all over');
  // real lots, either way round: the map is filled inside the footprint and nowhere else
  const data = new Uint8Array(MAP_WIDTH * MAP_HEIGHT);
  for (const h of [houses.find((x) => x.alive[0] && !x.lot.swap)!, houses.find((x) => x.alive[0] && x.lot.swap)!]) {
    bakeHeights(data, new Map([[h.model, mh]]), [h], 0, 0);
    const [fu, fv] = footprint(MODELS[h.model], h.lot.scale, h.lot.swap, h.lot.stretch);
    let n = 0;
    let far = 0;
    for (let k = 0; k < data.length; k++) {
      if (!data[k]) continue;
      n++;
      const a = A0 + ((k % MAP_WIDTH) + 0.5) * CELL;
      const v = B0 + (Math.floor(k / MAP_WIDTH) + 0.5) * CELL;
      if (Math.abs(a - h.lot.u) > fu / 2 + 2 * CELL + 8 || Math.abs(v - h.lot.v) > fv / 2 + 2 * CELL + 8) far++;
    }
    assert.ok(n > 4, 'the building is in the map');
    assert.equal(far, 0, 'nothing of it lies outside its footprint');
  }
  // a tower 40 m high on flat sheet, the light from +a at 45 degrees: its shadow runs 40 m towards -a and not towards +a
  data.fill(0);
  const at = (a: number, b: number) => Math.floor((b - B0) / CELL) * MAP_WIDTH + Math.floor((a - A0) / CELL);
  for (let a = -4; a < 4; a += CELL) for (let b = -4; b < 4; b += CELL) data[at(a, b)] = 80;
  const out = new Uint8Array(data.length);
  for (const _ of castShadows(data, out, () => 0, { slope: 1, sun: { x: Math.SQRT1_2, y: Math.SQRT1_2, z: 0 } }, [-200, 200], 200)) void _;
  assert.ok(out[at(-20, 0)] > 200, 'in the shadow 20 m behind the tower');
  assert.equal(out[at(-60, 0)], 0, 'beyond the shadow');
  assert.equal(out[at(20, 0)], 0, 'towards the light');
  assert.equal(out[at(-20, 30)], 0, 'beside the shadow');
});

test("each wall's near stretch holds its landmark in every structure: the stepped tower on one side, the dome on the other, whole and in the near model", () => {
  const forced = nearLandmarks(plan.lattice);
  assert.deepEqual([...forced.values()].sort(), ['deco_tower', 'dome']);
  for (const [cell, name] of forced) {
    const b = houses.find((h) => h.lot.cell === cell && MODELS[h.model].name === name);
    assert.ok(b, `${name} stands in its block`);
    assert.equal(Math.sign(b.lot.v), name === 'deco_tower' ? -1 : 1);
    assert.ok(Math.abs(b.lot.u - NEAR_STRETCH) < 60, `${name} at ${Math.round(b.lot.u)} m along the axis`);
    STRUCTURES.forEach((structure, si) => {
      assert.ok(b.alive[si], `${name} stands in ${structure}`);
      assert.ok(b.sy[si] >= 0.99 * b.lot.sy, `${name} keeps its height in ${structure}`);
      assert.equal(b.lod[si], 0, `${name} is the near model in ${structure}`);
    });
  }
  // and no stone spire lies on its side along the stretch of wall the play cameras look down
  for (const b of houses)
    if (['belfry', 'cathedral'].includes(MODELS[b.model].name)) assert.ok(b.lot.u < PLAY.min.x - SPIRE_CLEAR || b.lot.u > PLAY.max.x + SPIRE_FAR, `${MODELS[b.model].name} at ${Math.round(b.lot.u)}`);
});

test('the trees along a kerb are not a ruled row: their gaps and their sizes vary', () => {
  const trees = plan.buildings.filter((b) => b.prop && MODELS[b.model].name.startsWith('tree_'));
  // rows: trees of one block that share (to a metre and a half) one coordinate; the gaps between neighbours along the other
  const gaps: number[] = [];
  const rows = new Map<string, number[]>();
  for (const t of trees) {
    for (const [key, along] of [[`u${t.lot.cell}:${Math.round(t.lot.u / 3)}`, t.lot.v], [`v${t.lot.cell}:${Math.round(t.lot.v / 3)}`, t.lot.u]] as const) {
      if (!rows.has(key)) rows.set(key, []);
      rows.get(key)!.push(along);
    }
  }
  for (const list of rows.values()) {
    if (list.length < 4) continue;
    list.sort((a, b) => a - b);
    for (let i = 1; i < list.length; i++) gaps.push(list[i] - list[i - 1]);
  }
  assert.ok(gaps.length > 200, `${gaps.length} gaps`);
  const mean = gaps.reduce((s, g) => s + g, 0) / gaps.length;
  const sd = Math.sqrt(gaps.reduce((s, g) => s + (g - mean) ** 2, 0) / gaps.length);
  assert.ok(sd / mean > 0.35, `gaps vary by ${(sd / mean).toFixed(2)} of their mean`);
  assert.ok(gaps.some((g) => g > 26), 'a stretch of kerb has no tree');
  const sizes = trees.map((t) => t.lot.scale);
  assert.ok(Math.min(...sizes) < 0.62 && Math.max(...sizes) > 1.4, `sizes ${Math.min(...sizes).toFixed(2)} to ${Math.max(...sizes).toFixed(2)}`);
});

test('the far skyline stands upright beyond the far end of the open canyon, the same every time, and never near the play volume', () => {
  const masses = skyline(SEED);
  assert.deepEqual(masses, skyline(SEED));
  assert.ok(masses.length >= 40 && masses.length <= 110, `${masses.length} masses`);
  const open = restState('horizon');
  const f = makeFrame();
  for (const m of masses) {
    assert.ok(m.a - PLAY.max.x >= SKYLINE_CLEAR, `a mass ${Math.round(m.a - PLAY.max.x)} m beyond the play volume`);
    assert.ok(m.a < A1 - 100 && Math.abs(m.b) < B1 - 100, 'on the sheet');
    assert.ok(m.layer >= 0 && m.layer <= 1);
    // the sheet under it lies nearly flat there (the canyon's walls have leaned back): a mass that stands upright stands on it
    sheetFrame(open, m.a, m.b, f);
    assert.ok(f.n.y > 0.985, `the sheet at ${Math.round(m.a)}, ${Math.round(m.b)} tilts ${(Math.acos(f.n.y) * 180 / Math.PI).toFixed(0)} degrees`);
    const top = f.p.y + MODELS[m.model].h * m.scale * m.sy;
    assert.ok(top < 380, `a mass ${Math.round(top)} m high`);
  }
  // every row has peaks, and the rows part: some towers and domes among the long roofs
  const peaks = masses.filter((m) => ['deco_tower', 'dome', 'cathedral', 'belfry'].includes(MODELS[m.model].name));
  assert.ok(peaks.length >= 8 && peaks.length < masses.length / 2, `${peaks.length} peaks of ${masses.length}`);
});

test('the textured units: every building has one whose proportions fit its box, and no unit stands twice in a row the same way', () => {
  const list = plan.buildings.filter((b) => b.alive.some(Boolean));
  const chosen = chooseUnits(list, SEED);
  const again = chooseUnits(list, SEED);
  // every model with a family has units, and the props stand in for themselves at their own size
  for (const m of MODELS) {
    const family = UNIT_FAMILY[m.name];
    if (!family) continue;
    if (family === 'prop') {
      const u = UNITS.find((x) => x.name === m.name);
      assert.ok(u && Math.abs(u.w - m.w) + Math.abs(u.d - m.d) + Math.abs(u.top - m.h) < 1, `${m.name} of buildings.glb is the prop's size`);
    } else assert.ok(UNITS.some((u) => u.family === family), `units of family ${family}`);
  }
  const errs: number[] = [];
  let rows = 0;
  let before: { b: MorphBuilding; c: NonNullable<ReturnType<typeof chosen.get>> } | null = null;
  const used = new Set<string>();
  for (const b of list) {
    const m = MODELS[b.model];
    const c = chosen.get(b);
    if (!UNIT_FAMILY[m.name]) {
      assert.equal(c, undefined, `${m.name} has no unit`);
      continue;
    }
    assert.ok(c, `${m.name} has a unit`);
    assert.deepEqual(c.units.map((u) => u?.name), again.get(b)!.units.map((u) => u?.name));
    assert.equal(c.turn, again.get(b)!.turn);
    for (const [si] of STRUCTURES.entries()) {
      const u = c.units[si];
      assert.ok(u, `${m.name}: a unit in every structure`);
      if (!b.alive[si] || m.kind === 'prop') continue;
      used.add(u.name);
      errs.push(unitFit(u, m.w * (b.lot.stretch ?? 1), m.h * b.sy[si], m.d).err);
    }
    if (m.kind === 'prop') continue;
    // the lot before it in the same block: not the same unit the same way round, in any structure where both stand
    if (before && before.b.lot.cell === b.lot.cell && b.lot.cell >= 0) {
      rows++;
      for (const [si] of STRUCTURES.entries())
        if (b.alive[si] && before.b.alive[si]) assert.ok(c.units[si] !== before.c.units[si] || c.turn !== before.c.turn, `${c.units[si]!.name} twice in a row in block ${b.lot.cell}`);
    }
    before = { b, c };
  }
  assert.ok(rows > 500, `${rows} neighbours checked`);
  // the fit: how far a unit's proportions are from its box's (the sum over length and height of |ln| of the two ratios)
  errs.sort((p, q) => p - q);
  const at = (q: number) => errs[Math.min(errs.length - 1, Math.floor(q * errs.length))];
  assert.ok(at(0.5) < 0.1, `median misfit ${at(0.5).toFixed(3)}`);
  assert.ok(at(0.9) < 0.2, `90th percentile misfit ${at(0.9).toFixed(3)}`);
  assert.ok(used.size >= 50, `${used.size} different units stand in the city`);
});
