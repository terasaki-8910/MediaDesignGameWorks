import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import * as THREE from 'three';
import { CompiledStage, actionKey } from '../src/core/compile.ts';
import { resolveSlots } from '../src/core/slots.ts';
import type { StageFile } from '../src/core/types.ts';
import { DIORAMA, sectionDiorama, sectionStates } from '../src/game/diorama.ts';
import {
  AngleTracker, HANDLE, MIN_FACE, REST, bodyWheel, clampTo, handleSpot, handleWheel, nearestStop, pixelRay, planeBasis, rangeOf, releaseAt,
  sideOf, stopAngles, toPixel, wheelNormal, wheelRadius, type Viewport,
} from '../src/game/drag.ts';
import { findBlockedFold, sectionStartStates } from '../src/game/shots.ts';

const stage = resolveSlots(JSON.parse(readFileSync('src/stages/area1.json', 'utf8')) as StageFile);
const cs = new CompiledStage(stage);
const deg = (r: number) => (r * 180) / Math.PI;
const rad = (d: number) => (d * Math.PI) / 180;
const AXES = { x: new THREE.Vector3(1, 0, 0), y: new THREE.Vector3(0, 1, 0), z: new THREE.Vector3(0, 0, 1) };

/** The angles of a console's options in a state, and which of them are blocked, as Fold Mode lists them. */
function stops(consoleId: string, state = cs.initialState()) {
  const options = cs.consoleActions(consoleId, state);
  return { options, angles: stopAngles(options.map((o) => cs.motionOf(state, o.action).quarters)), blocked: options.map((o) => o.blockedBy.length > 0) };
}

/** Everything about a console that the drag needs: the group's axis and pivot and its world boxes. */
function consoleFold(consoleId: string, state = cs.initialState()) {
  const c = cs.consoles.get(consoleId)!;
  const g = cs.groups.get(c.controls)!;
  const motion = cs.motionOf(state, cs.consoleActions(consoleId, state)[0].action);
  const ids = new Set(cs.modules.filter((m) => m.group === g.id).map((m) => m.id));
  return {
    axis: AXES[motion.axis].clone(), pivot: new THREE.Vector3(...motion.pivot),
    boxes: cs.worldBoxes(state).filter((b) => ids.has(b.module)),
  };
}

const camera = (pos: THREE.Vector3, look: THREE.Vector3, fov: number, vp: Viewport) => {
  const c = new THREE.PerspectiveCamera(fov, vp.width / vp.height, 4, 2000);
  c.position.copy(pos);
  c.lookAt(look);
  c.updateMatrixWorld();
  c.updateProjectionMatrix();
  return c;
};

test('the stops of a console are its options\' turns, and the group may be turned as far as the farthest of them each way', () => {
  // the first bridge turns one way only; the tower's half turn is a stop at +180, so it spans -90..+180
  assert.deepEqual(stops('c1').angles.map(deg), [-90]);
  assert.deepEqual(rangeOf(stops('c1').angles), { lo: -Math.PI / 2, hi: 0 });
  const tower = stops('c_t1').angles.map(deg).sort((a, b) => a - b);
  assert.deepEqual(tower, [-90, 90, 180]);
  const r = rangeOf(stops('c_t1').angles);
  assert.equal(deg(r.lo), -90);
  assert.equal(deg(r.hi), 180);
  // the cube rolls a quarter either way or a half
  assert.deepEqual(stops('c_roll').angles.map(deg).sort((a, b) => a - b), [-90, 90, 180]);
  assert.equal(clampTo(rad(-120), r), r.lo, 'held at the stop');
  assert.equal(clampTo(rad(200), r), r.hi);
  assert.equal(clampTo(rad(33), r), rad(33), 'in between it follows');
});

test('the nearest stop: a turn of less than half the way is no move, more than half is the stop, and a tie stays', () => {
  const angles = stops('c_t1').angles; // [180, -90, 90] in the order of the options
  const at = (d: number) => nearestStop(rad(d), angles);
  assert.equal(at(0), REST);
  assert.equal(at(44), REST, 'releasing near the pose it started in is no move');
  assert.equal(at(45), REST, 'a tie goes to staying');
  assert.equal(at(46), angles.indexOf(rad(90)));
  assert.equal(at(-46), angles.indexOf(-rad(90)));
  assert.equal(at(-44), REST);
  assert.equal(at(100), angles.indexOf(rad(90)));
  assert.equal(at(136), angles.indexOf(rad(180)), 'past 135 the half turn is nearer than the quarter');
  assert.equal(at(134), angles.indexOf(rad(90)));
  assert.equal(at(-170), angles.indexOf(-rad(90)), 'the half turn is a stop at +180 only: the sweep that was checked');
  // no options at all: nothing to turn to
  assert.equal(nearestStop(rad(80), []), REST);
});

test('letting go: no move near the start, a move to a free stop, a refusal at a blocked one', () => {
  const free = stops('c1');
  assert.deepEqual(releaseAt(rad(-10), free.angles, free.blocked), { kind: 'none' });
  assert.deepEqual(releaseAt(0, free.angles, free.blocked), { kind: 'none' });
  assert.deepEqual(releaseAt(rad(-80), free.angles, free.blocked), { kind: 'move', index: 0 });
  assert.deepEqual(releaseAt(rad(-90), free.angles, free.blocked), { kind: 'move', index: 0 });
  // a console that has a blocked option somewhere in the stage: the street under the turned tower
  const where = findBlockedFold(cs, sectionStartStates(cs));
  const s = stops(where.console, where.state);
  const bad = s.blocked.findIndex(Boolean);
  assert.ok(bad >= 0, `${where.console} has a blocked option`);
  assert.deepEqual(releaseAt(s.angles[bad], s.angles, s.blocked), { kind: 'blocked', index: bad }, 'the sweep would hit something: refused, the group goes back');
  assert.deepEqual(releaseAt(s.angles[bad] * 0.9, s.angles, s.blocked), { kind: 'blocked', index: bad });
  assert.deepEqual(releaseAt(s.angles[bad] * 0.2, s.angles, s.blocked), { kind: 'none' }, 'and a short pull on it is no move at all');
  const ok = s.blocked.findIndex((b) => !b);
  if (ok >= 0) assert.deepEqual(releaseAt(s.angles[ok], s.angles, s.blocked), { kind: 'move', index: ok });
});

test('the wheel is turned towards the lens just enough to read as a ring, and keeps to the axis', () => {
  const axis = new THREE.Vector3(1, 0, 0);
  for (const c of [1, 0.8, 0.62, 0.5, 0.26, 0.1, 0, -0.2]) {
    const toCamera = new THREE.Vector3(c, Math.sqrt(1 - c * c) * 0.6, Math.sqrt(1 - c * c) * 0.8).normalize();
    const n = wheelNormal(axis, toCamera);
    assert.ok(Math.abs(n.length() - 1) < 1e-9);
    if (c >= MIN_FACE) assert.deepEqual(n.toArray(), axis.toArray(), `a face-on view leaves the wheel on the axis (${c})`);
    else if (c > -0.2) assert.ok(n.dot(toCamera) >= MIN_FACE - 1e-9, `face ${n.dot(toCamera)} at ${c}`);
    assert.ok(n.dot(axis) > 0.29, `it still looks along its end of the axis (${n.dot(axis)} at ${c})`);
  }
  // looking along the axis from the far side leaves it untilted instead of turning it inside out
  assert.deepEqual(wheelNormal(axis, new THREE.Vector3(-1, 0, 0)).toArray(), axis.toArray());
});

test('the handle stands on the axis, in front of the group on the camera\'s side, and reads at least 44 px', () => {
  const vps: Viewport[] = [{ width: 1280, height: 720 }, { width: 1024, height: 768 }, { width: 360, height: 640 }];
  let checked = 0;
  for (const [i, sec] of stage.sections.entries()) {
    const view = sectionDiorama(cs, sec, 'fold');
    for (const id of sec.consoles) {
      const fold = consoleFold(id);
      for (const vp of vps) {
        for (const [dyaw, dpitch] of [[0, 0], [DIORAMA.orbit.yaw, 0], [-DIORAMA.orbit.yaw, 0], [0, DIORAMA.orbit.pitch], [0, -DIORAMA.orbit.pitch]]) {
          const pose = view.pose(vp.width / vp.height, dyaw, dpitch);
          const cam = camera(pose.pos, pose.look, pose.fov, vp);
          const base = view.pose(vp.width / vp.height);
          const side = sideOf(fold.axis, fold.pivot, base.pos);
          const spot = handleSpot(fold.boxes, fold.pivot, fold.axis, side, HANDLE.clearance);
          // on the axis, clear of the group
          assert.ok(spot.clone().sub(fold.pivot).cross(fold.axis).length() < 1e-9, `${id}: on the axis`);
          for (const b of fold.boxes) {
            const inside = ['x', 'y', 'z'].every((k, j) => spot.getComponent(j) > b.min[j] + 1e-6 && spot.getComponent(j) < b.max[j] - 1e-6);
            assert.ok(!inside, `${id}: the handle stands outside the group's boxes`);
          }
          const toCamera = pose.pos.clone().sub(spot).normalize();
          const n = wheelNormal(fold.axis.clone().multiplyScalar(side), toCamera);
          const r = wheelRadius(pose.pos.distanceTo(spot), pose.fov, vp.height, HANDLE.px, HANDLE.min, HANDLE.max);
          const centre = toPixel(cam, spot, vp)!;
          const { e1 } = planeBasis(n, new THREE.Vector3(0, 1, 0));
          const rim = toPixel(cam, spot.clone().addScaledVector(e1, r), vp)!;
          const major = Math.max(...Array.from({ length: 24 }, (_, k) => {
            const e = planeBasis(n, new THREE.Vector3(Math.cos(k / 4), Math.sin(k / 4), 0.3)).e1;
            const q = toPixel(cam, spot.clone().addScaledVector(e, r), vp)!;
            return Math.hypot(q.x - centre.x, q.y - centre.y);
          }));
          assert.ok(rim && major >= HANDLE.px * 0.9, `${id} ${vp.width}x${vp.height}: the wheel reads ${major.toFixed(0)} px from the middle to the rim`);
          // where it is: in the frame, above the panel's part (the bottom third is the panel's; the handle may be a little into it only at the orbit's limits)
          assert.ok(centre.x > 8 && centre.x < vp.width - 8 && centre.y > 8 && centre.y < vp.height * 0.8, `${id} ${vp.width}x${vp.height} orbit ${dyaw},${dpitch}: the handle is at (${centre.x.toFixed(0)}, ${centre.y.toFixed(0)})`);
          checked++;
        }
      }
    }
    assert.ok(i >= 0);
  }
  assert.ok(checked >= 6 * 3 * 5);
});

/** Turn a point about the axis through the pivot. */
const turned = (p: THREE.Vector3, pivot: THREE.Vector3, axis: THREE.Vector3, angle: number) =>
  p.clone().sub(pivot).applyQuaternion(new THREE.Quaternion().setFromAxisAngle(axis, angle)).add(pivot);

test('dragging a point of the group: the angle comes back from the pointer, in every console\'s Fold Mode view', () => {
  const vps: Viewport[] = [{ width: 1280, height: 720 }, { width: 360, height: 640 }];
  let exact = 0;
  for (const sec of stage.sections) {
    const view = sectionDiorama(cs, sec, 'fold');
    for (const id of sec.consoles) {
      const { axis, pivot, boxes } = consoleFold(id);
      // a point of the group, near the corner of its boxes that is farthest from the axis (where a hand would take it)
      let start = pivot.clone();
      let far = 0;
      for (const b of boxes)
        for (const x of [b.min[0], b.max[0]])
          for (const y of [b.min[1], b.max[1]])
            for (const z of [b.min[2], b.max[2]]) {
              const corner = new THREE.Vector3(x, y, z);
              const d = corner.clone().sub(pivot).cross(axis).length();
              if (d > far) [far, start] = [d, corner];
            }
      const centre = new THREE.Box3().setFromPoints(boxes.flatMap((b) => [new THREE.Vector3(...b.min), new THREE.Vector3(...b.max)])).getCenter(new THREE.Vector3());
      start = start.clone().lerp(centre, 0.1);
      for (const vp of vps)
        for (const dyaw of [0, DIORAMA.orbit.yaw, -DIORAMA.orbit.yaw]) {
          const pose = view.pose(vp.width / vp.height, dyaw, 0);
          const cam = camera(pose.pos, pose.look, pose.fov, vp);
          const toCamera = pose.pos.clone().sub(start).normalize();
          const wheel = bodyWheel(axis, pivot, start, toCamera);
          const tracker = new AngleTracker(wheel, 0.5);
          const at = (a: number) => {
            const px = toPixel(cam, turned(start, pivot, axis, a), vp)!;
            return tracker.update(pixelRay(cam, px.x, px.y, vp));
          };
          assert.ok(Math.abs(at(0)) < 1e-9);
          const wellSeen = Math.abs(axis.dot(toCamera)) >= 0.4;
          let last = 0;
          // (a point seen from the side goes to and fro along a thin ellipse: beyond the quarter turn its picture goes back on itself,
          // so the street is read as far as its one stop, +90)
          for (let a = 0; a <= rad(wellSeen ? 180 : 90); a += rad(5)) {
            const got = at(a);
            if (wellSeen) assert.ok(Math.abs(got - a) < 1e-6, `${id} ${vp.width}px yaw ${dyaw}: ${deg(a)} deg came back as ${deg(got)}`);
            else assert.ok(got >= last - 1e-9, `${id}: the turn only grows as the point goes on round (${deg(got)})`);
            last = got;
          }
          if (wellSeen) exact++;
          else assert.ok(last > rad(55) && last < rad(125), `${id}: a quarter turn of a point that is seen from the side reads as ${deg(last)} deg (a plane seen that edge-on gives a rough turn, in the right sense)`);
          // and back the other way, past the start (it goes on counting)
          if (wellSeen) {
            for (let a = rad(180); a >= -rad(90); a -= rad(5)) at(a);
            assert.ok(Math.abs(at(-rad(90)) + rad(90)) < 1e-6);
          }
        }
    }
  }
  assert.ok(exact >= 6, `the point stays under the pointer in ${exact} views`);
});

test('the sense of the turn: the pointer and the group go round the same way as seen on screen', () => {
  const vp: Viewport = { width: 1280, height: 720 };
  /** +1 for counter-clockwise on screen (y down), the way a point goes round `centre` when it moves from a to b. */
  const sense = (centre: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }) => {
    const cross = (a.x - centre.x) * (b.y - centre.y) - (a.y - centre.y) * (b.x - centre.x);
    return cross < 0 ? 1 : -1;
  };
  for (const sec of stage.sections) {
    const view = sectionDiorama(cs, sec, 'fold');
    for (const id of sec.consoles) {
      const { axis, pivot, boxes } = consoleFold(id);
      const pose = view.pose(vp.width / vp.height);
      const cam = camera(pose.pos, pose.look, pose.fov, vp);
      const side = sideOf(axis, pivot, pose.pos);
      const spot = handleSpot(boxes, pivot, axis, side, 1.6);
      const n = wheelNormal(axis.clone().multiplyScalar(side), pose.pos.clone().sub(spot).normalize());
      const wheel = handleWheel(spot, n, side);
      // the wheel's rim point at psi, turned by phi about the axis means psi = side * phi
      const { e1, e2 } = planeBasis(n, new THREE.Vector3(0, 1, 0));
      const rim = (phi: number) => spot.clone().addScaledVector(e1, Math.cos(side * phi) * 3).addScaledVector(e2, Math.sin(side * phi) * 3);
      const c = toPixel(cam, spot, vp)!;
      const wheelSense = sense(c, toPixel(cam, rim(0), vp)!, toPixel(cam, rim(0.1), vp)!);
      // a point of the group, well away from the axis: which way it goes round the pivot on screen
      const across = Math.abs(axis.y) < 0.9 ? new THREE.Vector3(0, 1, 0).cross(axis).normalize() : new THREE.Vector3(1, 0, 0);
      const p = pivot.clone().addScaledVector(across, 6);
      const p2 = turned(p, pivot, axis, 0.1);
      const bodySense = sense(toPixel(cam, pivot, vp)!, toPixel(cam, p, vp)!, toPixel(cam, p2, vp)!);
      assert.equal(wheelSense, bodySense, `${id}: turning the handle one way turns the group the way the handle goes round`);
      // and the tracker reads the wheel's own turn as the group's: a pointer carrying the rim point on gives positive angles
      const t = new AngleTracker(wheel, 0.5);
      for (let phi = 0; phi <= 0.5; phi += 0.05) {
        const px = toPixel(cam, rim(phi), vp)!;
        t.update(pixelRay(cam, px.x, px.y, vp));
      }
      assert.ok(Math.abs(t.angle - 0.5) < 1e-6, `${id}: the rim point carried through 0.5 rad of the group's turn reads ${t.angle}`);
    }
  }
});

test('a grab on the hub does not jump, and a ray that misses the wheel\'s plane changes nothing', () => {
  const vp: Viewport = { width: 800, height: 600 };
  const cam = camera(new THREE.Vector3(0, 60, 60), new THREE.Vector3(0, 0, 0), 25, vp);
  const wheel = { center: new THREE.Vector3(), normal: new THREE.Vector3(0, 1, 0), sign: 1 as const };
  const t = new AngleTracker(wheel, 0.6);
  const px = (x: number, z: number) => toPixel(cam, new THREE.Vector3(x, 0, z), vp)!;
  const ray = (x: number, z: number) => pixelRay(cam, px(x, z).x, px(x, z).y, vp);
  assert.equal(t.update(ray(0.1, 0.1)), 0, 'in the hub');
  assert.equal(t.update(ray(0.2, -0.1)), 0, 'and still');
  assert.equal(t.update(ray(2, 0)), 0, 'the first ray outside the hub sets the zero');
  assert.ok(Math.abs(t.update(ray(0, -2)) - rad(90)) < 1e-6 || Math.abs(t.update(ray(0, -2)) + rad(90)) < 1e-6, 'a quarter on');
  const sky = new THREE.Ray(new THREE.Vector3(0, 10, 0), new THREE.Vector3(0, 1, 0)); // going away from the plane
  const before = t.angle;
  assert.equal(t.update(sky), before);
});

test('the wheel is drawn as large as a finger needs, within limits', () => {
  // 1280x720 at 75 m with the 25 degree lens: a metre is about 22 px
  const near = wheelRadius(75, 25, 720, 36, 2, 7);
  assert.equal(near, 2, 'never smaller than its minimum');
  const far = wheelRadius(150, 25, 720, 36, 2, 7);
  assert.ok(far > 3.3 && far < 3.6, `${far}`);
  assert.equal(wheelRadius(600, 25, 720, 36, 2, 7), 7, 'and never more than its maximum');
  assert.ok(wheelRadius(80, 47, 640, 36, 2, 7) > 3.5, 'a phone-shaped window has a wider lens, so the same ring is bigger in the world');
});

test('a group turned by hand stops where its sweep meets something: the clearance is the whole turn exactly when nothing blocks it', () => {
  let blocked = 0;
  let free = 0;
  for (const sec of stage.sections)
    for (const state of sectionStates(cs, sec))
      for (const id of sec.consoles)
        for (const o of cs.consoleActions(id, state)) {
          const turn = (cs.motionOf(state, o.action).quarters * Math.PI) / 2;
          const clear = cs.sweepClearance(state, o.action);
          const where = `${actionKey(o.action)} in ${cs.stateKey(state)}`;
          assert.ok(Math.abs(clear) <= Math.abs(turn) + 1e-12 && clear * turn >= 0, `${where}: ${clear} is part of the turn ${turn}, the same way`);
          if (o.blockedBy.length) {
            blocked++;
            assert.ok(Math.abs(clear) < Math.abs(turn), `${where}: a blocked turn stops short`);
            // what is left of the sweep up to there is clear: the same action, cut short, has nothing in the way
            assert.ok(Math.abs(clear) <= Math.abs(turn) - (2.5 * Math.PI) / 180 + 1e-9, `${where}: at least one sample step short`);
          } else {
            free++;
            assert.equal(clear, turn, `${where}: a free turn can be made all the way`);
          }
        }
  assert.ok(blocked > 0 && free > 0, `${blocked} blocked and ${free} free options checked`);
});
