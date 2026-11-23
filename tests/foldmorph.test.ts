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
import { MODELS } from '../src/game/foldcity/models.ts';
import { boxAt, heightAt, planMorph, presenceAt, SAMPLES, shownSurface, type MorphBuilding } from '../src/game/foldcity/morphplan.ts';
import { cutsSheet, overlaps, PLAY, PLAY_CENTER, SheetPoints, type Obb } from '../src/game/foldcity/plan.ts';
import { parseFreeze, SECTION_STRUCTURE } from '../src/game/foldcity/progression.ts';
import {
  A0, A1, B0, B1, blendState, makeState, restState, SEAM, SHEET_SIGN, sheetAt, STRUCTURES, twistVeil, type SheetState, type StructureName,
} from '../src/game/foldcity/sheet.ts';
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

test('the sections show the canyon, the right-angle fold and the ring, in that order', () => {
  assert.deepEqual([...SECTION_STRUCTURE], ['horizon', 'fold90', 'ring']);
  assert.deepEqual(parseFreeze('s1-s2:0.5'), { from: 0, to: 1, f: 0.5 });
  assert.deepEqual(parseFreeze('s3-s2:0.25'), { from: 2, to: 1, f: 0.25 });
  for (const bad of ['s1-s3:0.5', 's1-s2:1.5', 's0-s1:0.5', 'loop', null]) assert.equal(parseFreeze(bad), null, String(bad));
});

test('at rest the sheet is the approved shape of each structure, to within half a metre', () => {
  const proto = { horizon: VARIANTS.horizon.make()[0].surface, fold90: VARIANTS.fold90.make()[0].surface, ring: VARIANTS.ring.make()[0].surface };
  for (const name of STRUCTURES) {
    const s = restState(name);
    let worst = 0;
    for (let a = name === 'ring' ? SEAM : A0; a <= A1; a += 7.3)
      for (const b of [-900, -200, -160, 0, 155, 170, 400]) {
        sheetAt(s, a, b, P);
        if (name === 'horizon') proto.horizon.at(b, a, Q);
        else if (name === 'fold90') proto.fold90.at(a + 1500, b, Q);
        else proto.ring.at(a - 5, b, Q);
        worst = Math.max(worst, P.distanceTo(Q));
      }
    assert.ok(worst < 0.5, `${name} is ${worst.toFixed(2)} m off its study`);
  }
  // and the ring closes: the far end of the sheet meets the seam
  const ring = restState('ring');
  assert.ok(sheetAt(ring, SEAM, 0, P).distanceTo(sheetAt(ring, A1, 0, Q)) < 0.01);
});

test('the plan is the same every time, and every structure is a city', () => {
  const again = planMorph(SEED, keepOut);
  assert.equal(again.buildings.length, plan.buildings.length);
  assert.deepEqual(again.buildings.map((b) => b.alive), plan.buildings.map((b) => b.alive));
  assert.deepEqual(again.buildings.map((b) => b.presence), plan.buildings.map((b) => b.presence));
  STRUCTURES.forEach((name, si) => {
    assert.ok(plan.stats.standing[si] > 450, `${name}: ${plan.stats.standing[si]} buildings`);
    assert.ok(plan.stats.props[si] > 100, `${name}: ${plan.stats.props[si]} props`);
    // what the batch draws if everything were in view (the frame's budget is 1.5 M with the play area)
    assert.ok(plan.stats.triangles[si] < 600_000, `${name}: ${plan.stats.triangles[si]} triangles`);
  });
  assert.ok(plan.buildings.length <= 4200, `${plan.buildings.length} instances`);
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
  for (let a = state.tailCut ? SEAM : A0; a <= A1; a += 12)
    for (let b = B0; b <= B1; b += 12) assert.ok(!clear.containsPoint(sheetAt(state, a, b, P)), `${what}: the sheet passes through the play volume at ${P.toArray().map(Math.round)}`);
}

/** How often the profile (the cross-section of the sheet along a) crosses itself. */
function selfCrossings(state: SheetState): number {
  const pts: [number, number][] = [];
  for (let a = state.tailCut ? SEAM : A0; a <= A1 - 2; a += 4) {
    sheetAt(state, a, 0, P);
    pts.push([P.x, P.y]);
  }
  const side = (a: [number, number], b: [number, number], c: [number, number]) => {
    const v = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    return v > 1e-6 ? 1 : v < -1e-6 ? -1 : 0;
  };
  let n = 0;
  for (let i = 0; i < pts.length - 1; i++)
    for (let j = i + 3; j < pts.length - 1; j++)
      if (side(pts[i], pts[j], pts[j + 1]) * side(pts[i + 1], pts[j], pts[j + 1]) < 0 && side(pts[i], pts[i + 1], pts[j]) * side(pts[i], pts[i + 1], pts[j + 1]) < 0) n++;
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
      const [fu, fv] = footprint(MODELS[b.model], b.lot.scale, b.lot.swap);
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
    const [fu, fv] = footprint(MODELS[b.model], b.lot.scale, b.lot.swap);
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
      assert.deepEqual([...state.px.slice(0, 50)], [...rest.px.slice(0, 50)]);
      assert.equal(state.tailCut, rest.tailCut);
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
      for (let u = SEAM; u <= A1; u += 40)
        for (const v of [-600, -170, 0, 170, 600]) {
          sheetAt(a, u, v, P);
          if (P.distanceTo(PLAY_CENTER) < 450) worst = Math.max(worst, P.distanceTo(sheetAt(b, u, v, Q)));
        }
    }
    // one frame of a 4 s fold at 60 fps. The fastest piece is the top of a canyon wall some 400 m up, which swings down in
    // under a second (about 19 m a frame); a cut or a wrong branch in the blend would show as hundreds of metres
    assert.ok(worst < 24, `${tr.from} to ${tr.to}: a point moves ${worst.toFixed(1)} m in one frame`);
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
    for (let a = surface.uRange[0] + 5; a < A1; a += 25)
      for (let b = B0 + 5; b < B1; b += 25) {
        if (twistVeil(state, a, b) > 0.6) continue; // more than half gone into the haze
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
