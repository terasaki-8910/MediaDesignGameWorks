import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import { CREASE_HW } from '../src/game/foldcity/layout.ts';
import { MODELS } from '../src/game/foldcity/models.ts';
import { cutsSheet, overlaps, planCity, PLAY, PLAY_CENTER, SheetPoints, type Building, type CityPlan } from '../src/game/foldcity/plan.ts';
import { frameAt, makeFrame } from '../src/game/foldcity/surfaces.ts';
import { VARIANTS, VARIANT_NAMES } from '../src/game/foldcity/variants.ts';

const SEED = 1207;
const plans = new Map<string, CityPlan>();
const planOf = (name: string) => {
  let p = plans.get(name);
  if (!p) plans.set(name, (p = planCity(VARIANTS[name], SEED)));
  return p;
};

test('every variant lays out a city, the same one every time', () => {
  assert.ok(VARIANT_NAMES.length >= 4);
  for (const name of VARIANT_NAMES) {
    const a = planOf(name);
    const b = planCity(VARIANTS[name], SEED);
    assert.ok(a.buildings.length > 150, `${name}: ${a.buildings.length} buildings`);
    assert.equal(a.buildings.length, b.buildings.length, `${name} is deterministic`);
    assert.deepEqual(a.buildings[10].p.toArray(), b.buildings[10].p.toArray());
  }
});

test('no two buildings cut through each other, in any variant', () => {
  for (const name of VARIANT_NAMES) {
    const list = planOf(name).buildings;
    const spheres = list.map((b) => ({ r: Math.hypot(...b.obb.h) }));
    let bad = 0;
    for (let i = 0; i < list.length; i++)
      for (let j = i + 1; j < list.length; j++) {
        if (list[i].obb.c.distanceTo(list[j].obb.c) > spheres[i].r + spheres[j].r) continue;
        if (overlaps(list[i].obb, list[j].obb)) bad++;
      }
    assert.equal(bad, 0, `${name}: ${bad} overlapping pairs`);
  }
});

test('nothing of the background enters the play volume, nor comes within 6 m of it', () => {
  const box = PLAY.clone().expandByScalar(6);
  const o = { c: box.getCenter(new THREE.Vector3()), a: [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)] as Building['obb']['a'], h: [(box.max.x - box.min.x) / 2, (box.max.y - box.min.y) / 2, (box.max.z - box.min.z) / 2] as Building['obb']['h'] };
  const p = new THREE.Vector3();
  for (const name of VARIANT_NAMES) {
    const plan = planOf(name);
    for (const b of plan.buildings) assert.ok(!overlaps(b.obb, o), `${name}: a building at ${b.p.toArray().map(Math.round)} is in the play volume`);
    // and the surfaces themselves stay 10 m clear of it
    const clear = PLAY.clone().expandByScalar(10);
    for (const face of plan.faces) {
      const s = face.surface;
      for (let u = s.uRange[0]; u <= s.uRange[1]; u += 12)
        for (let v = s.vRange[0]; v <= s.vRange[1]; v += 12) {
          s.at(u, v, p);
          assert.ok(!clear.containsPoint(p), `${name}/${s.name}: the sheet passes through the play volume at ${p.toArray().map(Math.round)}`);
        }
    }
  }
});

test('every building stands on its surface: no gap under its footprint, nothing buried deeper than 14 m', () => {
  const f = makeFrame();
  const q = new THREE.Vector3();
  for (const name of VARIANT_NAMES) {
    const plan = planOf(name);
    let worstGap = 0;
    let worstBury = 0;
    for (const b of plan.buildings) {
      const face = plan.faces[b.face];
      const m = MODELS[b.model];
      const len = m.w * b.scale * (b.lot.stretch ?? 1); // a house is stretched along its length to fill its place
      const w = b.lot.swap ? m.d * b.scale : len;
      const d = b.lot.swap ? len : m.d * b.scale;
      frameAt(face.surface, face.sign, b.lot.u, b.lot.v, f);
      for (let i = -2; i <= 2; i++)
        for (let j = -2; j <= 2; j++) {
          face.surface.at(b.lot.u + (i * w) / 4, b.lot.v + (j * d) / 4, q);
          const dev = q.sub(f.p).dot(f.n); // how far the surface lies above the tangent plane here
          worstGap = Math.max(worstGap, -dev - b.sink); // the base is `sink` below the tangent plane
          worstBury = Math.max(worstBury, dev + b.sink);
        }
    }
    assert.ok(worstGap < 0.05, `${name}: the surface falls ${worstGap.toFixed(2)} m below a building's base`);
    assert.ok(worstBury < 14, `${name}: a building is buried ${worstBury.toFixed(1)} m`);
  }
});

test('buildings keep off the creases: an avenue lies on every fold and no footprint reaches into it', () => {
  for (const name of VARIANT_NAMES) {
    const plan = planOf(name);
    for (const [fi, face] of plan.faces.entries()) {
      for (const c of face.surface.creaseU) {
        const line = face.lattice.u.find((l) => Math.abs(l.c - c) < 1e-6);
        assert.ok(line && line.avenue && line.hw >= CREASE_HW - 1e-6, `${name}/${face.surface.name}: no avenue on the crease at u=${c.toFixed(1)}`);
        for (const b of plan.buildings.filter((x) => x.face === fi)) {
          const m = MODELS[b.model];
          const half = (b.lot.swap ? m.d : m.w * (b.lot.stretch ?? 1)) * b.scale * 0.5;
          assert.ok(Math.abs(b.lot.u - c) >= half + CREASE_HW - 0.5, `${name}: a building reaches into the crease avenue at u=${c.toFixed(1)}`);
        }
      }
    }
  }
});

/** The four review cameras that look at the background (shots title, s1-overview, s1-play, player-front), as measured in the game. */
const CAMERAS = [[74, 34, -6], [-42.5, 35.7, 27.8], [-46.5, 16.4, 2], [-35.2, 13.8, 4]].map((c) => new THREE.Vector3(...c));

test('from the review cameras no building, and no ground drawn on one side only, is seen from behind', () => {
  const p = new THREE.Vector3();
  const f = makeFrame();
  for (const name of VARIANT_NAMES) {
    const plan = planOf(name);
    for (const cam of CAMERAS) {
      for (const b of plan.buildings) {
        if (b.p.distanceTo(cam) > 700) continue;
        assert.ok(b.n.dot(p.subVectors(cam, b.p)) > 0, `${name}: a building at ${b.p.toArray().map(Math.round)} stands on a surface that turns its back to ${cam.toArray()}`);
      }
      if (plan.def.underside) continue; // those sheets are drawn on both sides, the back as a plain underside
      for (const face of plan.faces)
        for (let u = face.surface.uRange[0]; u <= face.surface.uRange[1]; u += 30)
          for (let v = face.surface.vRange[0]; v <= face.surface.vRange[1]; v += 30) {
            frameAt(face.surface, face.sign, u, v, f);
            if (f.p.distanceTo(cam) > 700) continue;
            assert.ok(f.n.dot(p.subVectors(cam, f.p)) > 0, `${name}/${face.surface.name}: the ground at ${f.p.toArray().map(Math.round)} shows its back to ${cam.toArray()}`);
          }
    }
  }
});

test('no building cuts through another part of the sheet (another turn of a curl, a facing wall)', () => {
  for (const name of VARIANT_NAMES) {
    const plan = planOf(name);
    // a finer grid than the layout's own, offset from it
    const points = new SheetPoints(plan.faces, 6, plan.def.reach + 150, PLAY_CENTER, 3);
    let bad = 0;
    for (const b of plan.buildings) {
      const face = plan.faces[b.face];
      const m = MODELS[b.model];
      const fu = (b.lot.swap ? m.d : m.w) * b.scale;
      const fv = (b.lot.swap ? m.w : m.d) * b.scale;
      const [u0, u1] = face.surface.uRange;
      if (cutsSheet(points, b.obb, b.face, b.lot.u, b.lot.v, fu, fv, face.surface.periodic ? u1 - u0 : 0, 0.8)) bad++;
    }
    assert.equal(bad, 0, `${name}: ${bad} buildings cut through the sheet`);
  }
});

test('the city stays inside the budget it is drawn with: instances and triangles', () => {
  const tris = (b: Building) => (b.lod === 0 ? 600 : 220); // generous means of the two levels of detail (city.glb)
  for (const name of VARIANT_NAMES) {
    const list = planOf(name).buildings;
    assert.ok(list.length <= 2600, `${name}: ${list.length} instances`); // a block is four or more houses now
    const total = list.reduce((s, b) => s + tris(b), 0);
    assert.ok(total < 900_000, `${name}: about ${total} triangles if everything were in view`);
  }
  assert.ok(PLAY_CENTER.y > -50);
});
