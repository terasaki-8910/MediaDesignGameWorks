// Third-person orbit camera with collision, plus a framing mode used by Fold Mode and cinematics, and the diorama view:
// a long lens high above a puzzle (diorama.ts computes where), which the camera moves into and out of on a timed ease.
import * as THREE from 'three';
import { DIORAMA, type DioramaView } from './diorama.ts';
import type { Input } from './input.ts';
import type { SunView } from './look.ts';

export interface CameraSettings { sensitivity: number; invertY: boolean; reduceMotion: boolean; distance: number }

/** The lens of the follow camera: what Engine.resize sets (62 degrees; 72 in a tall frame). The diorama's narrow lens eases to and from this. */
const FOLLOW_FOV = { wide: 62, tall: 72 };
/** How long the camera takes into the diorama and back out of it, in seconds (a cut under reduceMotion). */
export const DIORAMA_MOVE = { in: 1.2, out: 1.0 };
/** The nearest thing drawn in the diorama: everything is 60 m away or more, and a far near plane keeps the depth buffer fine. */
const DIORAMA_NEAR = 4;

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2); // in and out, cubic

type Mode = 'follow' | 'frame' | 'cinematic' | 'diorama';

export class CameraRig {
  /** The pitch the follow camera starts with. */
  static readonly DEFAULT_PITCH = 0.32;
  yaw = Math.PI / 2;
  pitch = CameraRig.DEFAULT_PITCH;
  private pos = new THREE.Vector3();
  private look = new THREE.Vector3();
  private fov: number;
  private frame: { center: THREE.Vector3; radius: number; from: THREE.Vector3; shot: THREE.Vector3 | null } | null = null;
  private cinematic: { pos: THREE.Vector3; look: THREE.Vector3 } | null = null;
  private diorama: DioramaView | null = null;
  /** The view the camera is in or leaving: its shadow map is still wanted while the camera is on its way out. */
  private lastView: DioramaView | null = null;
  /** How far the player has turned the view round the diorama (radians): what the mouse asks for, and what the camera is at. */
  private orbit = { yaw: 0, pitch: 0, toYaw: 0, toPitch: 0 };
  /** A timed move between two poses: where it began, how far it has run, and whether it runs into the diorama. */
  private move: { t: number; dur: number; pos: THREE.Vector3; look: THREE.Vector3; fov: number; into: boolean } | null = null;
  private mode: Mode = 'follow';
  private weight = 0; // 0 on the follow camera, 1 in the diorama, between during a move
  private ray = new THREE.Raycaster();
  private initialised = false;
  private atRest = false;
  private blend = 0; // 1 right after leaving a framing or cinematic shot, easing back to 0
  /** v0.5: how much of a swing's sway the follow camera has (0 to 1: it trails the player more loosely and stands a little back), and how much it is asked for. */
  private sway = 0;
  swayWanted = 0;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly colliders: () => THREE.Object3D[];

  constructor(camera: THREE.PerspectiveCamera, colliders: () => THREE.Object3D[]) {
    this.camera = camera;
    this.colliders = colliders;
    this.fov = camera.fov;
  }

  /** Frame a sphere, by default from above the side `from` is on; `shot` puts the camera at a chosen place instead. */
  setFrame(center: THREE.Vector3 | null, radius = 10, from?: THREE.Vector3, shot?: THREE.Vector3) {
    this.frame = center ? { center: center.clone(), radius, from: (from ?? this.pos).clone(), shot: shot?.clone() ?? null } : null;
  }

  /** Of the camera positions `shots`, the one that sees `look` across the fewest colliders (ties: the nearest to the camera now). */
  clearestShot(look: THREE.Vector3, shots: THREE.Vector3[]): THREE.Vector3 {
    let best = shots[0];
    let bestScore = Infinity;
    for (const s of shots) {
      const to = s.clone().sub(look);
      this.ray.set(look, to.clone().normalize());
      this.ray.far = to.length();
      const score = this.ray.intersectObjects(this.colliders(), false).length * 1000 + s.distanceTo(this.pos);
      if (score < bestScore) [best, bestScore] = [s, score];
    }
    return best;
  }

  setCinematic(pos: THREE.Vector3 | null, look?: THREE.Vector3) {
    this.cinematic = pos ? { pos: pos.clone(), look: (look ?? new THREE.Vector3()).clone() } : null;
  }

  /**
   * Hold the camera in the diorama of a puzzle (diorama.ts), moving there on a timed ease from wherever it is; `null` lets it
   * go back to the follow camera the same way. A framing or a cinematic shot set meanwhile takes over from it.
   */
  setDiorama(view: DioramaView | null) {
    this.diorama = view;
    if (view) this.lastView = view;
  }

  /** True while the camera is held in the diorama (or on its way there). */
  get inDiorama() {
    return this.diorama !== null;
  }

  /** The diorama's wish for the sun's shadow map: its centre and size, and how far the camera is in (null on the follow camera). */
  shadowView(): SunView | null {
    return this.lastView && this.weight > 0.001 ? { centre: this.lastView.centre, half: this.lastView.shadowHalf, weight: this.weight } : null;
  }

  /** Put the follow camera behind the player; `smooth` glides there instead of cutting. */
  snapBehind(facingYaw: number, smooth = false) {
    this.yaw = facingYaw;
    if (!smooth) this.cut();
  }

  /** Jump to wherever the camera is heading on the next update, without easing (review shots). */
  cut() {
    this.initialised = false;
  }

  /**
   * `allowLook` turns the follow camera with the mouse; `allowOrbit` turns the diorama a little round its puzzle
   * (mouse only: the keys are Fold Mode's).
   */
  update(dt: number, input: Input, player: THREE.Vector3, s: CameraSettings, allowLook: boolean, allowOrbit = false) {
    if (allowLook) {
      this.yaw -= input.mouseDX * 0.0024 * s.sensitivity;
      this.pitch += input.mouseDY * 0.0024 * s.sensitivity * (s.invertY ? -1 : 1);
      this.pitch = Math.min(1.25, Math.max(-0.25, this.pitch));
    }
    const target = player.clone().add(new THREE.Vector3(0, 1.6, 0));
    // a tall (phone-shaped) frame shows less to the sides, so stand further back
    const portrait = this.camera.aspect < 1;
    const mode: Mode = this.cinematic ? 'cinematic' : this.frame ? 'frame' : this.diorama ? 'diorama' : 'follow';
    const was = this.mode;
    this.mode = mode;
    if (mode !== was) {
      this.move = null; // whatever move was running ends here: the new one (if any) starts from where the camera is now
      if (mode === 'diorama') {
        this.orbit.yaw = this.orbit.pitch = this.orbit.toYaw = this.orbit.toPitch = 0;
        if (this.initialised) this.startMove(true, s.reduceMotion);
      } else if (was === 'diorama' && mode === 'follow') {
        if (this.initialised) this.startMove(false, s.reduceMotion);
      } else if (mode === 'follow') this.blend = 1;
    }
    this.blend = Math.max(0, this.blend - dt / 0.9);
    this.sway += ((s.reduceMotion ? 0 : this.swayWanted) - this.sway) * (1 - Math.exp(-dt * 7)); // (none with reduceMotion)
    let desiredPos: THREE.Vector3;
    let desiredLook: THREE.Vector3;
    let desiredFov = portrait ? FOLLOW_FOV.tall : FOLLOW_FOV.wide;
    let sharpness = 14;
    if (mode === 'cinematic') {
      desiredPos = this.cinematic!.pos;
      desiredLook = this.cinematic!.look;
      sharpness = s.reduceMotion ? 50 : 1.6;
    } else if (mode === 'frame') {
      const { center, radius, from, shot } = this.frame!;
      if (shot) desiredPos = shot;
      else {
        const dir = new THREE.Vector3(from.x - center.x, 0, from.z - center.z);
        if (dir.lengthSq() < 1e-3) dir.set(0, 0, 1);
        dir.normalize().applyAxisAngle(new THREE.Vector3(0, 1, 0), 0.6); // step aside so the player does not block the view
        const back = portrait ? 1.45 : 1;
        desiredPos = center.clone().addScaledVector(dir, radius * 1.55 * back).add(new THREE.Vector3(0, radius * 1.05 * back + 4, 0));
        desiredPos.y = Math.max(desiredPos.y, player.y + 9);
      }
      desiredLook = center.clone();
      sharpness = s.reduceMotion ? 50 : 3.2;
    } else if (mode === 'diorama') {
      if (allowOrbit) {
        const k = 0.0024 * s.sensitivity;
        this.orbit.toYaw = THREE.MathUtils.clamp(this.orbit.toYaw - input.mouseDX * k, -DIORAMA.orbit.yaw, DIORAMA.orbit.yaw);
        this.orbit.toPitch = THREE.MathUtils.clamp(this.orbit.toPitch + input.mouseDY * k * (s.invertY ? -1 : 1), -DIORAMA.orbit.pitch, DIORAMA.orbit.pitch);
      }
      const to = 1 - Math.exp(-dt * 8);
      this.orbit.yaw += (this.orbit.toYaw - this.orbit.yaw) * to;
      this.orbit.pitch += (this.orbit.toPitch - this.orbit.pitch) * to;
      const pose = this.diorama!.pose(this.camera.aspect, this.orbit.yaw, this.orbit.pitch);
      desiredPos = pose.pos;
      desiredLook = pose.look;
      desiredFov = pose.fov;
      sharpness = s.reduceMotion ? 50 : 6;
    } else {
      const off = new THREE.Vector3(
        Math.sin(this.yaw) * Math.cos(this.pitch),
        Math.sin(this.pitch),
        Math.cos(this.yaw) * Math.cos(this.pitch),
      );
      let dist = s.distance * (portrait ? 1.15 : 1) * (1 + 0.12 * this.sway);
      this.ray.set(target, off);
      this.ray.far = dist;
      const hit = this.ray.intersectObjects(this.colliders(), false)[0];
      if (hit) dist = Math.max(1.4, hit.distance - 0.45);
      desiredPos = target.clone().addScaledVector(off, dist);
      desiredLook = target;
      sharpness = s.reduceMotion ? 14 : 14 - 11 * this.blend - 6 * this.sway;
    }
    const weightWanted = mode === 'diorama' ? 1 : 0;
    if (!this.initialised) {
      this.pos.copy(desiredPos);
      this.look.copy(desiredLook);
      this.fov = desiredFov;
      this.weight = weightWanted;
      this.move = null;
      this.initialised = true;
    }
    const m = this.move;
    if (m) {
      m.t += dt;
      const e = m.dur > 0 ? ease(Math.min(1, m.t / m.dur)) : 1;
      this.pos.copy(m.pos).lerp(desiredPos, e);
      this.look.copy(m.look).lerp(desiredLook, e);
      this.fov = THREE.MathUtils.lerp(m.fov, desiredFov, e);
      this.weight = m.into ? e : 1 - e;
      if (m.t >= m.dur) this.move = null;
    } else {
      const k = 1 - Math.exp(-dt * sharpness);
      this.pos.lerp(desiredPos, k);
      this.look.lerp(desiredLook, Math.min(1, k * 1.3));
      this.fov += (desiredFov - this.fov) * k;
      this.weight += (weightWanted - this.weight) * (1 - Math.exp(-dt * (s.reduceMotion ? 50 : 4)));
    }
    // (in the diorama, with its move over and the camera on its pose: what is on screen stands still from here)
    this.atRest = mode === 'diorama' && !this.move && this.weight > 0.999 && this.pos.distanceToSquared(desiredPos) < 0.01 && Math.abs(this.fov - desiredFov) < 0.02;
    this.camera.position.copy(this.pos);
    this.camera.lookAt(this.look);
    // the lens is the rig's to set while the diorama has any hold on it (Engine.resize sets the follow camera's, and does so afresh at each change of the render scale)
    const near = THREE.MathUtils.lerp(0.1, DIORAMA_NEAR, this.weight);
    if (Math.abs(this.camera.fov - this.fov) > 1e-4 || Math.abs(this.camera.near - near) > 1e-4) {
      this.camera.fov = this.fov;
      this.camera.near = near;
      this.camera.updateProjectionMatrix();
    }
  }

  /** Begin a timed move from the camera as it is now: into the diorama or back out of it. */
  private startMove(into: boolean, reduceMotion: boolean) {
    this.move = { t: 0, dur: reduceMotion ? 0 : into ? DIORAMA_MOVE.in : DIORAMA_MOVE.out, pos: this.pos.clone(), look: this.look.clone(), fov: this.fov, into };
  }

  get position() {
    return this.pos;
  }

  /** True once the camera has come to rest in the diorama (a test waits for it before it reads where things are on screen). */
  get arrived() {
    return this.atRest;
  }
}
