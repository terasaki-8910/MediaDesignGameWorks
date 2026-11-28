import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import * as THREE from 'three';
import { CompiledStage } from '../src/core/compile.ts';
import { resolveSlots } from '../src/core/slots.ts';
import type { StageFile } from '../src/core/types.ts';
import { CameraRig, DIORAMA_MOVE, type CameraSettings } from '../src/game/camera.ts';
import { DIORAMA, sectionDiorama } from '../src/game/diorama.ts';
import type { Input } from '../src/game/input.ts';

const cs = new CompiledStage(resolveSlots(JSON.parse(readFileSync('src/stages/area1.json', 'utf8')) as StageFile));
const view = sectionDiorama(cs, cs.stage.sections[1], 'intro');
const SETTINGS: CameraSettings = { sensitivity: 1, invertY: false, reduceMotion: false, distance: 9 };
const PLAYER = new THREE.Vector3(-4, 12, 2);
const DT = 1 / 60;

const setup = () => {
  const camera = new THREE.PerspectiveCamera(62, 16 / 9, 0.1, 2000);
  const rig = new CameraRig(camera, () => []);
  const input = { mouseDX: 0, mouseDY: 0 } as Input;
  const step = (n = 1, s = SETTINGS, orbit = false) => {
    for (let i = 0; i < n; i++) {
      rig.update(DT, input, PLAYER, s, false, orbit);
      input.mouseDX = input.mouseDY = 0;
    }
  };
  rig.yaw = -Math.PI / 2;
  step(); // the first update cuts to the follow camera
  return { camera, rig, input, step, follow: camera.position.clone() };
};
const seconds = (s: number) => Math.round(s / DT);

test('into the diorama on a timed ease that starts and ends at rest, and lands on its pose with its lens', () => {
  const { camera, rig, step, follow } = setup();
  const pose = view.pose(16 / 9);
  rig.setDiorama(view);
  const path: number[] = [];
  for (let i = 0; i < seconds(DIORAMA_MOVE.in) + 2; i++) {
    step();
    path.push(camera.position.distanceTo(follow));
  }
  const total = pose.pos.distanceTo(follow);
  assert.ok(path[0] < total * 0.01, 'it starts gently (no jump on the first frame)');
  for (let i = 1; i < path.length; i++) assert.ok(path[i] >= path[i - 1] - 1e-9, 'it only ever moves on');
  const last = path[path.length - 1] - path[path.length - 2];
  assert.ok(last < total * 0.005, 'it arrives gently');
  assert.ok(camera.position.distanceTo(pose.pos) < 1e-6, 'on the diorama pose');
  assert.ok(Math.abs(camera.fov - pose.fov) < 1e-6 && camera.fov < 30, `a long lens (${camera.fov})`);
  assert.ok(camera.near > 1, 'with a far near plane');
  // it has to be there in the time the spec gives the whole move (2.5 to 4 s with the hold)
  assert.ok(DIORAMA_MOVE.in + DIORAMA_MOVE.out + 1 >= 2.5 && DIORAMA_MOVE.in + DIORAMA_MOVE.out + 1.5 <= 4);
});

test('back out to the follow camera on a timed ease, with the follow lens, whatever the player did meanwhile', () => {
  const { camera, rig, step, follow } = setup();
  rig.setDiorama(view);
  step(seconds(2));
  rig.setDiorama(null);
  step(seconds(DIORAMA_MOVE.out) + 2);
  assert.ok(camera.position.distanceTo(follow) < 1e-3, 'behind the player again');
  assert.ok(Math.abs(camera.fov - 62) < 1e-6 && Math.abs(camera.near - 0.1) < 1e-6);
  assert.equal(rig.shadowView(), null);
});

test('a move cut short carries on from where the camera is: no jump', () => {
  const { camera, rig, step } = setup();
  rig.setDiorama(view);
  step(seconds(0.5));
  const before = camera.position.clone();
  rig.setDiorama(null); // skipped half way in
  step();
  const jump = camera.position.distanceTo(before);
  step();
  const next = camera.position.distanceTo(before);
  assert.ok(jump < 3 && next < 6, `the camera turns round without a jump (${jump.toFixed(2)} m, then ${next.toFixed(2)} m)`);
  step(seconds(DIORAMA_MOVE.out) + 2);
  assert.ok(Math.abs(camera.fov - 62) < 1e-6);
});

test('with reduce motion the camera cuts there and back', () => {
  const { camera, rig, step } = setup();
  const still = { ...SETTINGS, reduceMotion: true };
  rig.setDiorama(view);
  step(2, still);
  assert.ok(camera.position.distanceTo(view.pose(16 / 9).pos) < 1e-3 && camera.fov < 30, 'in the diorama after a frame or two');
  rig.setDiorama(null);
  step(2, still);
  assert.ok(Math.abs(camera.fov - 62) < 0.5, 'and back on the follow lens');
});

test('the mouse turns the view a little way round, only when asked to, and the review shots\' cut lands at once', () => {
  const { camera, rig, input, step } = setup();
  rig.setDiorama(view);
  step(seconds(2));
  const rest = camera.position.clone();
  input.mouseDX = 5000;
  step(1, SETTINGS, false);
  step(seconds(1.5));
  assert.ok(camera.position.distanceTo(rest) < 1e-6, 'the mouse does nothing unless the game lets the view turn');
  input.mouseDX = 5000; // far more than the range: it stops at the limit
  step(1, SETTINGS, true);
  step(seconds(3), SETTINGS, true);
  const left = view.pose(16 / 9, -DIORAMA.orbit.yaw, 0).pos; // a mouse to the right turns the view the way it turns the follow camera: yaw goes down
  assert.ok(camera.position.distanceTo(left) < 0.01, `at the limit of the turn (${camera.position.distanceTo(left)})`);
  input.mouseDY = 5000;
  step(1, SETTINGS, true);
  step(seconds(3), SETTINGS, true);
  const tilted = view.pose(16 / 9, -DIORAMA.orbit.yaw, DIORAMA.orbit.pitch).pos;
  assert.ok(camera.position.distanceTo(tilted) < 0.01, 'and the pitch has its own, smaller limit');
  rig.setDiorama(null);
  step(seconds(2));
  rig.setDiorama(view);
  step(seconds(3));
  assert.ok(camera.position.distanceTo(rest) < 0.01, 'the turn starts from nothing each time the diorama is entered');
  rig.cut();
  rig.setDiorama(null);
  rig.cut();
  step();
  assert.ok(Math.abs(camera.fov - 62) < 1e-9 && camera.position.distanceTo(setup().follow) < 1e-6, 'a cut lands on the follow camera at once, lens and all');
});

test('a framing or a cinematic shot takes over from the diorama without a timed move, and the lens eases back', () => {
  const { camera, rig, step } = setup();
  rig.setDiorama(view);
  step(seconds(2));
  rig.setFrame(new THREE.Vector3(-4, 12, 2), 10, PLAYER);
  step(1);
  assert.ok(camera.fov < 30 && camera.fov > 21, 'the lens has not jumped');
  step(seconds(4));
  assert.ok(Math.abs(camera.fov - 62) < 0.5, 'it comes to the wide lens on the framing');
  rig.setDiorama(null);
  rig.setFrame(null);
  step(seconds(3));
  assert.ok(Math.abs(camera.fov - 62) < 1e-3 && Math.abs(camera.near - 0.1) < 1e-3);
});

test('the engine setting the lens (a change of render scale resizes it) does not hold the diorama\'s lens back', () => {
  const { camera, rig, step } = setup();
  rig.setDiorama(view);
  step(seconds(2));
  camera.fov = 62; // Engine.resize
  camera.updateProjectionMatrix();
  step();
  assert.ok(camera.fov < 30, `the rig set it again (${camera.fov})`);
});

test('the sun\'s shadow map is asked to the puzzle while the camera is in the diorama, and not otherwise', () => {
  const { rig, step } = setup();
  assert.equal(rig.shadowView(), null);
  rig.setDiorama(view);
  step(seconds(DIORAMA_MOVE.in) + 2);
  const sun = rig.shadowView()!;
  assert.ok(sun && Math.abs(sun.weight - 1) < 1e-6 && sun.centre.distanceTo(view.centre) < 1e-9 && sun.half === view.shadowHalf);
  rig.setDiorama(null);
  step(seconds(DIORAMA_MOVE.out) + 2);
  assert.equal(rig.shadowView(), null);
});
