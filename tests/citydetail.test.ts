// What the low detail of the background city leaves out (foldcity/detail.ts), measured on the game's own plan.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import * as THREE from 'three';
import { CompiledStage } from '../src/core/compile.ts';
import type { StageFile } from '../src/core/types.ts';
import { LOW, keepBuilding, keepMass, lodShown } from '../src/game/foldcity/detail.ts';
import { pierKeepOut } from '../src/game/foldcity/keepout.ts';
import { MODELS } from '../src/game/foldcity/models.ts';
import { planMorph } from '../src/game/foldcity/morphplan.ts';
import { PLAY } from '../src/game/foldcity/plan.ts';
import { restState, sheetAt, STRUCTURES } from '../src/game/foldcity/sheet.ts';
import { SKYLINE_ROWS, skyline } from '../src/game/foldcity/skyline.ts';
import { pierFeet, planSlabs } from '../src/game/kitLayout.ts';

const cs = new CompiledStage(JSON.parse(readFileSync('src/stages/area1.json', 'utf8')) as StageFile);
const plan = planMorph(1207, pierKeepOut(pierFeet(planSlabs(cs))));
const at = new THREE.Vector3();

/** Every building that stands in structure `si`, with its distance from the play volume. */
function standing(si: number) {
  const state = restState(STRUCTURES[si]);
  return plan.buildings.filter((b) => b.alive[si]).map((b) => ({ b, model: MODELS[b.model], d: PLAY.distanceToPoint(sheetAt(state, b.lot.u, b.lot.v, at)) }));
}

test('the full detail draws everything the plan says, as it says', () => {
  for (const model of MODELS) for (const d of [0, 300, 900]) assert.equal(keepBuilding('full', model, d), true);
  assert.equal(lodShown('full', 0), 0);
  assert.equal(lodShown('full', 1), 1);
  for (const m of skyline(1207)) assert.equal(keepMass('full', m), true);
});

test('the low detail shows far models only, and draws a third of the triangles in every structure', () => {
  assert.equal(lodShown('low', 0), 1);
  assert.equal(lodShown('low', 1), 1);
  for (const [si, name] of STRUCTURES.entries()) {
    let full = 0;
    let low = 0;
    for (const { b, model, d } of standing(si)) {
      full += model.tris[b.lod[si]];
      if (keepBuilding('low', model, d)) low += model.tris[lodShown('low', b.lod[si])];
    }
    assert.ok(low <= full * 0.4, `${name}: ${low} of ${full} triangles`);
    assert.ok(low >= full * 0.15, `${name}: ${low} of ${full} triangles is too little city left`);
  }
});

test('the low detail draws fewer instances, shortens the draw distance, and keeps what is near', () => {
  for (const [si, name] of STRUCTURES.entries()) {
    const all = standing(si);
    const kept = all.filter((s) => keepBuilding('low', s.model, s.d));
    assert.ok(kept.length <= all.length * 0.65 && kept.length >= all.length * 0.25, `${name}: ${kept.length} of ${all.length}`);
    for (const s of kept) assert.ok(s.d <= LOW.reach || s.model.name === 'pier_foot', `${name}: a ${s.model.name} ${s.d.toFixed(0)} m away`);
    // nothing but trees is taken away within the reach, the piers' feet are never taken away, and trees stay near the walkways
    for (const s of all) {
      if (s.model.name === 'pier_foot') assert.ok(keepBuilding('low', s.model, s.d));
      else if (s.d <= LOW.treeReach) assert.ok(keepBuilding('low', s.model, s.d), `${name}: a ${s.model.name} at ${s.d.toFixed(0)} m is gone`);
      else if (s.model.name.startsWith('tree_')) assert.equal(keepBuilding('low', s.model, s.d), false);
      else assert.equal(keepBuilding('low', s.model, s.d), s.d <= LOW.reach);
    }
    const trees = (xs: typeof all) => xs.filter((s) => s.model.name.startsWith('tree_')).length;
    assert.ok(trees(kept) < trees(all) * 0.8, `${name}: the avenues keep ${trees(kept)} of ${trees(all)} trees`);
  }
});

test('the low detail thins the skyline to every other row, nearest row first, and keeps the layering', () => {
  const masses = skyline(1207);
  const kept = masses.filter((m) => keepMass('low', m));
  assert.ok(kept.length < masses.length * 0.7 && kept.length > masses.length * 0.4, `${kept.length} of ${masses.length}`);
  const rows = new Set(kept.map((m) => Math.round(m.layer * (SKYLINE_ROWS.length - 1))));
  assert.deepEqual([...rows].sort(), [0, 2, 4], 'the nearest row, the middle one and the palest one stay');
});
