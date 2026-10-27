// Third-person orbit camera with collision, plus a framing mode used by Fold Mode and cinematics.
import * as THREE from 'three';
import type { Input } from './input.ts';

export interface CameraSettings { sensitivity: number; invertY: boolean; reduceMotion: boolean; distance: number }

export class CameraRig {
  yaw = Math.PI / 2;
  pitch = 0.32;
  private pos = new THREE.Vector3();
  private look = new THREE.Vector3();
  private frame: { center: THREE.Vector3; radius: number; from: THREE.Vector3 } | null = null;
  private cinematic: { pos: THREE.Vector3; look: THREE.Vector3 } | null = null;
  private ray = new THREE.Raycaster();
  private initialised = false;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly colliders: () => THREE.Object3D[];

  constructor(camera: THREE.PerspectiveCamera, colliders: () => THREE.Object3D[]) {
    this.camera = camera;
    this.colliders = colliders;
  }

  setFrame(center: THREE.Vector3 | null, radius = 10, from?: THREE.Vector3) {
    this.frame = center ? { center: center.clone(), radius, from: (from ?? this.pos).clone() } : null;
  }

  setCinematic(pos: THREE.Vector3 | null, look?: THREE.Vector3) {
    this.cinematic = pos ? { pos: pos.clone(), look: (look ?? new THREE.Vector3()).clone() } : null;
  }

  snapBehind(facingYaw: number) {
    this.yaw = facingYaw;
    this.initialised = false;
  }

  update(dt: number, input: Input, player: THREE.Vector3, s: CameraSettings, allowLook: boolean) {
    if (allowLook) {
      this.yaw -= input.mouseDX * 0.0024 * s.sensitivity;
      this.pitch += input.mouseDY * 0.0024 * s.sensitivity * (s.invertY ? -1 : 1);
      this.pitch = Math.min(1.25, Math.max(-0.25, this.pitch));
    }
    const target = player.clone().add(new THREE.Vector3(0, 1.6, 0));
    let desiredPos: THREE.Vector3;
    let desiredLook: THREE.Vector3;
    let sharpness = 14;
    if (this.cinematic) {
      desiredPos = this.cinematic.pos;
      desiredLook = this.cinematic.look;
      sharpness = s.reduceMotion ? 50 : 1.6;
    } else if (this.frame) {
      const { center, radius, from } = this.frame;
      const dir = new THREE.Vector3(from.x - center.x, 0, from.z - center.z);
      if (dir.lengthSq() < 1e-3) dir.set(0, 0, 1);
      dir.normalize().applyAxisAngle(new THREE.Vector3(0, 1, 0), 0.6); // step aside so the player does not block the view
      desiredPos = center.clone().addScaledVector(dir, radius * 1.55).add(new THREE.Vector3(0, radius * 1.05 + 4, 0));
      desiredPos.y = Math.max(desiredPos.y, player.y + 9);
      desiredLook = center.clone();
      sharpness = s.reduceMotion ? 50 : 3.2;
    } else {
      const off = new THREE.Vector3(
        Math.sin(this.yaw) * Math.cos(this.pitch),
        Math.sin(this.pitch),
        Math.cos(this.yaw) * Math.cos(this.pitch),
      );
      let dist = s.distance;
      this.ray.set(target, off);
      this.ray.far = dist;
      const hit = this.ray.intersectObjects(this.colliders(), false)[0];
      if (hit) dist = Math.max(1.4, hit.distance - 0.45);
      desiredPos = target.clone().addScaledVector(off, dist);
      desiredLook = target;
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
