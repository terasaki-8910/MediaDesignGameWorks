import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import * as THREE from 'three';
import { CompiledStage } from '../src/core/compile.ts';
import { cellFloor } from '../src/core/math.ts';
import { resolveSlots } from '../src/core/slots.ts';
import type { PuzzleSection, StageFile } from '../src/core/types.ts';
import {
  DIORAMA, MARGINS, dioramaAngles, dioramaFov, sectionDiorama, sectionModules, sectionPoints, sectionStates,
  type DioramaPose, type Margins,
} from '../src/game/diorama.ts';

const stage = resolveSlots(JSON.parse(readFileSync('src/stages/area1.json', 'utf8')) as StageFile);
const cs = new CompiledStage(stage);
const ASPECTS = [16 / 9, 16 / 10, 4 / 3, 21 / 9, 1, 360 / 640];
const deg = (r: number) => (r * 180) / Math.PI;

const camera = (pose: DioramaPose, aspect: number) => {
  const c = new THREE.PerspectiveCamera(pose.fov, aspect, 0.1, 2000);
  c.position.copy(pose.pos);
  c.lookAt(pose.look);
  c.updateMatrixWorld();
  c.updateProjectionMatrix();
  return c;
};
/** Where the points land in the frame: the extremes of their normalised device coordinates. */
const extent = (points: readonly THREE.Vector3[], c: THREE.Camera) => {
  const e = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity, minZ: Infinity, maxZ: -Infinity };
  for (const p of points) {
    const n = p.clone().project(c);
    e.minX = Math.min(e.minX, n.x); e.maxX = Math.max(e.maxX, n.x);
    e.minY = Math.min(e.minY, n.y); e.maxY = Math.max(e.maxY, n.y);
    e.minZ = Math.min(e.minZ, n.z); e.maxZ = Math.max(e.maxZ, n.z);
  }
  return e;
};
/** The same points, worked out here from the stage and not from `sectionPoints`: every box of the section's modules in every state, and its cells. */
const expectedPoints = (sec: PuzzleSection) => {
  const mods = sectionModules(cs, sec);
  const floorY = cellFloor(stage.checkpoints.find((c) => c.id === sec.start)!.at)[1];
  const pts: THREE.Vector3[] = [];
  for (const state of sectionStates(cs, sec))
    for (const b of cs.worldBoxes(state))
      if (mods.has(b.module))
        for (const x of [b.min[0], b.max[0]])
          for (const y of [b.min[1], b.max[1]])
            for (const z of [b.min[2], b.max[2]]) pts.push(new THREE.Vector3(x, Math.max(y, floorY - DIORAMA.below), z));
  for (const c of [stage.checkpoints.find((k) => k.id === sec.start)!.at, ...sec.consoles.map((id) => cs.consoles.get(id)!.at), ...sec.exit]) {
    const f = cellFloor(c);
    for (const dx of [-2, 2]) for (const dz of [-2, 2]) pts.push(new THREE.Vector3(f[0] + dx, f[1], f[2] + dz), new THREE.Vector3(f[0] + dx, f[1] + 1.8, f[2] + dz));
  }
  return pts;
};
const inside = (e: ReturnType<typeof extent>, m: Margins, tol = 1e-6) =>
  e.minX >= -(1 - m.left) - tol && e.maxX <= 1 - m.right + tol && e.minY >= -(1 - m.bottom) - tol && e.maxY <= 1 - m.top + tol;

test('a section\'s puzzle is its moving groups and everything the player can walk on from the start, up to the exit', () => {
  const [s1, s2, s3] = stage.sections;
  const has = (sec: PuzzleSection, ...ids: string[]) => {
    const got = sectionModules(cs, sec);
    for (const id of ids) assert.ok(got.has(id), `${sec.id} has ${id} (got ${[...got].join(', ')})`);
    return got;
  };
  const a = has(s1, 'm_start', 'm_road1', 'm_bridge1', 'm_road2');
  assert.ok(!a.has('m_cube') && !a.has('m_street'), 'the first puzzle stops at its exit');
  const b = has(s2, 'm_road2', 'm_cube', 'm_bal_n', 'm_bal_s', 'plate_w', 'plate_n', 'plate_s', 'plate_e', 'm_road3');
  assert.ok(!b.has('m_bridge1') && !b.has('m_n0') && !b.has('m_street'), 'the second puzzle is neither side\'s');
  const c = has(s3, 'm_road3', 'm_n0', 'm_ledge', 'm_plateau', 'm_street', 'm_tower');
  assert.ok(!c.has('m_cube'), 'the third puzzle stops at the exit before it');
});

test('the points of every section hold every box in every state, the consoles, the start and the exit with the gate\'s height', () => {
  for (const sec of stage.sections) {
    const got = sectionPoints(cs, sec);
    const box = new THREE.Box3().setFromPoints(got);
    for (const p of expectedPoints(sec)) assert.ok(box.containsPoint(p), `${sec.id}: ${p.toArray()} is in the points' box`);
    const exit = cellFloor(sec.exit[0]);
    const hasGate = cs.modules.some((m) => m.type === 'deco' && m.params.kind === 'gate' && m.at.join() === sec.exit[0].join());
    if (hasGate) assert.ok(box.max.y >= exit[1] + 11, `${sec.id}: the gate's head room is in (top ${box.max.y})`);
    // the tower's 30 m shaft does not count (its walkway does), the hanging street's 16 m does
    assert.ok(box.min.y >= cellFloor(sec.exit[0])[1] - DIORAMA.below - 1e-6, `${sec.id}: nothing deeper than ${DIORAMA.below} m below the walkways`);
  }
  const third = new THREE.Box3().setFromPoints(sectionPoints(cs, stage.sections[2]));
  assert.ok(third.min.y <= 12 - 16 + 1, 'the hanging street (16 m below the walkways) is in the third puzzle');
});

for (const use of ['intro', 'fold'] as const)
  test(`every point of every section is inside the frame with the ${use} margins, at every window shape, and the fit is tight`, () => {
    for (const sec of stage.sections) {
      const view = sectionDiorama(cs, sec, use);
      const expected = expectedPoints(sec);
      for (const aspect of ASPECTS) {
        const pose = view.pose(aspect);
        const cam = camera(pose, aspect);
        for (const pts of [view.points, expected]) {
          const e = extent(pts, cam);
          assert.ok(inside(e, MARGINS[use]), `${sec.id} at ${aspect.toFixed(2)}: ${JSON.stringify(e)}`);
          assert.ok(e.minZ > -1 && e.maxZ < 1, `${sec.id}: all points are between the near and far planes`);
        }
        // tight: at least one edge of the puzzle sits on the margin (the camera is as close as the margins allow)
        const e = extent(view.points, cam);
        const m = MARGINS[use];
        const gap = Math.min(e.minX + (1 - m.left), 1 - m.right - e.maxX, e.minY + (1 - m.bottom), 1 - m.top - e.maxY);
        assert.ok(gap < 1e-3, `${sec.id} at ${aspect.toFixed(2)} is not tight (the nearest edge is ${gap} from its margin)`);
      }
    }
  });

test('turning the view round its pivot to either limit keeps the whole puzzle in the frame', () => {
  for (const sec of stage.sections)
    for (const use of ['intro', 'fold'] as const) {
      const view = sectionDiorama(cs, sec, use);
      for (const aspect of ASPECTS)
        for (let a = -1; a <= 1.0001; a += 0.25)
          for (let b = -1; b <= 1.0001; b += 0.5) {
            const pose = view.pose(aspect, a * DIORAMA.orbit.yaw, b * DIORAMA.orbit.pitch);
            const e = extent(view.points, camera(pose, aspect));
            assert.ok(inside(e, { left: 0, right: 0, top: 0, bottom: 0 }), `${sec.id} ${use} at ${aspect.toFixed(2)} turned ${a},${b}: ${JSON.stringify(e)}`);
          }
    }
});

test('the view is a long lens high above, looking down the way through the puzzle from the side', () => {
  for (const sec of stage.sections) {
    const view = sectionDiorama(cs, sec, 'intro');
    const pose = view.pose(16 / 9);
    assert.ok(pose.fov >= 18 && pose.fov <= 28, `${sec.id}: a long lens (${pose.fov} degrees)`);
    const dir = pose.look.clone().sub(pose.pos);
    assert.ok(dir.length() > 55, `${sec.id}: far away (${dir.length().toFixed(0)} m)`);
    const pitch = deg(Math.asin(-dir.clone().normalize().y));
    assert.ok(pitch > 28 && pitch < 45, `${sec.id}: looking down at ${pitch.toFixed(0)} degrees, about isometric`);
    // the way through (start to exit) runs from the left to the right of the picture, and from near to far
    const cam = camera(pose, 16 / 9);
    const start = new THREE.Vector3(...cellFloor(stage.checkpoints.find((c) => c.id === sec.start)!.at));
    const exit = new THREE.Vector3(...cellFloor(sec.exit[0]));
    assert.ok(start.clone().project(cam).x < exit.clone().project(cam).x, `${sec.id}: the exit is to the right of the start`);
    assert.ok(start.distanceTo(pose.pos) < exit.distanceTo(pose.pos), `${sec.id}: the exit is further away than the start`);
  }
});

test('a tall window gets a wider lens so the width is held; angles do not depend on the window', () => {
  assert.equal(dioramaFov(16 / 9), DIORAMA.fov);
  assert.ok(dioramaFov(9 / 16) > DIORAMA.fov * 1.5 && dioramaFov(9 / 16) < 50);
  for (const sec of stage.sections) {
    const a = dioramaAngles(cs, sec);
    const v = sectionDiorama(cs, sec, 'fold');
    assert.ok(Math.abs(v.yaw - a.yaw) < 1e-12 && Math.abs(v.pitch - a.pitch) < 1e-12);
    for (const aspect of ASPECTS) {
      const pose = v.pose(aspect);
      for (const n of [...pose.pos.toArray(), ...pose.look.toArray(), pose.fov]) assert.ok(Number.isFinite(n));
    }
  }
});

test('turning the view swings the camera round the same point at a distance that only grows', () => {
  for (const sec of stage.sections) {
    const view = sectionDiorama(cs, sec, 'intro');
    const rest = view.pose(16 / 9);
    let last = rest.pos.distanceTo(rest.look);
    for (let t = 0.1; t <= 1.0001; t += 0.1) {
      const p = view.pose(16 / 9, DIORAMA.orbit.yaw * t, 0);
      assert.ok(p.look.distanceTo(rest.look) < 1e-9, 'the pivot stays put');
      const d = p.pos.distanceTo(p.look);
      assert.ok(d >= last - 1e-9, `${sec.id}: the camera backs off as the view turns`);
      last = d;
    }
    assert.ok(last < rest.pos.distanceTo(rest.look) * 1.3, `${sec.id}: by less than a third at the limit`);
  }
});
