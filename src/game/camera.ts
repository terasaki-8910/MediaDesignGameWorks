// Third-person orbit camera with collision, plus a framing mode used by Fold Mode and cinematics.
import * as THREE from 'three';
import type { Input } from './input.ts';

export interface CameraSettings { sensitivity: number; invertY: boolean; reduceMotion: boolean; distance: number }

export class CameraRig {
  yaw = Math.PI / 2;
  pitch = 0.32;
  private pos = new THREE.Vector3();
  private look = new THREE.Vector3();
  private frame: { center: THREE.Vector3; radius: number; from: THREE.Vector3; shot: THREE.Vector3 | null } | null = null;
  private cinematic: { pos: THREE.Vector3; look: THREE.Vector3 } | null = null;
  private ray = new THREE.Raycaster();
  private initialised = false;
  private following = true;
  private blend = 0; // 1 right after leaving a framing or cinematic shot, easing back to 0
  private readonly camera: THREE.PerspectiveCamera;
  private readonly colliders: () => THREE.Object3D[];

  constructor(camera: THREE.PerspectiveCamera, colliders: () => THREE.Object3D[]) {
    this.camera = camera;
    this.colliders = colliders;
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

  /** Put the follow camera behind the player; `smooth` glides there instead of cutting. */
  snapBehind(facingYaw: number, smooth = false) {
    this.yaw = facingYaw;
    if (!smooth) this.initialised = false;
  }

  update(dt: number, input: Input, player: THREE.Vector3, s: CameraSettings, allowLook: boolean) {
    if (allowLook) {
      this.yaw -= input.mouseDX * 0.0024 * s.sensitivity;
      this.pitch += input.mouseDY * 0.0024 * s.sensitivity * (s.invertY ? -1 : 1);
      this.pitch = Math.min(1.25, Math.max(-0.25, this.pitch));
    }
    const target = player.clone().add(new THREE.Vector3(0, 1.6, 0));
    // a tall (phone-shaped) frame shows less to the sides, so stand further back
    const portrait = this.camera.aspect < 1;
    let desiredPos: THREE.Vector3;
    let desiredLook: THREE.Vector3;
    let sharpness = 14;
    const following = !this.cinematic && !this.frame;
    if (following && !this.following) this.blend = 1;
    this.following = following;
    this.blend = Math.max(0, this.blend - dt / 0.9);
    if (this.cinematic) {
      desiredPos = this.cinematic.pos;
      desiredLook = this.cinematic.look;
      sharpness = s.reduceMotion ? 50 : 1.6;
    } else if (this.frame) {
      const { center, radius, from, shot } = this.frame;
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
    } else {
      const off = new THREE.Vector3(
        Math.sin(this.yaw) * Math.cos(this.pitch),
        Math.sin(this.pitch),
        Math.cos(this.yaw) * Math.cos(this.pitch),
      );
      let dist = s.distance * (portrait ? 1.15 : 1);
      this.ray.set(target, off);
      this.ray.far = dist;
      const hit = this.ray.intersectObjects(this.colliders(), false)[0];
      if (hit) dist = Math.max(1.4, hit.distance - 0.45);
      desiredPos = target.clone().addScaledVector(off, dist);
      desiredLook = target;
      sharpness = s.reduceMotion ? 14 : 14 - 11 * this.blend;
    }
    if (!this.initialised) {
      this.pos.copy(desiredPos);
      this.look.copy(desiredLook);
      this.initialised = true;
    }
    const k = 1 - Math.exp(-dt * sharpness);
    this.pos.lerp(desiredPos, k);
    this.look.lerp(desiredLook, Math.min(1, k * 1.3));
    this.camera.position.copy(this.pos);
    this.camera.lookAt(this.look);
  }

  get position() {
    return this.pos;
  }
}
