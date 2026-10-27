// Player avatar and grid-aware movement. The walk map is the collision: a tile can only be left through an
// open edge, so jumping or falling can never create a shortcut (ports rule R1 in the design docs).
import * as THREE from 'three';
import type { WalkMap } from '../core/compile.ts';
import { CELL, DIRS, cellFloor, cellKey, type Side, type Vec3 } from '../core/math.ts';
import type { Input } from './input.ts';
import type { Materials } from './materials.ts';

const R = 0.35;
const GRAVITY = 14;
const JUMP_V = 5.2;

export interface Avatar {
  object: THREE.Object3D;
  animate(dt: number, speed: number, airborne: boolean): void;
}

export function cloakAvatar(M: Materials): Avatar {
  const g = new THREE.Group();
  const profile = [
    [0.0, 1.74], [0.16, 1.72], [0.22, 1.63], [0.2, 1.5], [0.31, 1.42], [0.35, 1.12], [0.41, 0.62], [0.47, 0.06], [0.0, 0.06],
  ].map(([x, y]) => new THREE.Vector2(x, y));
  const cloth = new THREE.MeshStandardMaterial({ color: '#2b2f5e', roughness: 0.82, metalness: 0.05 });
  const body = new THREE.Mesh(new THREE.LatheGeometry(profile, 28), cloth);
  body.castShadow = true;
  const face = new THREE.Mesh(new THREE.SphereGeometry(0.15, 16, 12), new THREE.MeshStandardMaterial({ color: '#121426', roughness: 1 }));
  face.position.set(0, 1.56, -0.07);
  const eyeGeo = new THREE.SphereGeometry(0.022, 8, 6);
  const eyes = [-0.05, 0.05].map((x) => {
    const e = new THREE.Mesh(eyeGeo, M.glow);
    e.position.set(x, 1.58, -0.205);
    return e;
  });
  const hem = new THREE.Mesh(new THREE.TorusGeometry(0.46, 0.025, 6, 40), M.glow);
  hem.rotation.x = Math.PI / 2;
  hem.position.y = 0.08;
  const sash = new THREE.Mesh(new THREE.TorusGeometry(0.355, 0.03, 6, 32), M.brass);
  sash.rotation.x = Math.PI / 2;
  sash.position.y = 1.05;
  const shard = new THREE.Mesh(new THREE.OctahedronGeometry(0.12), M.glow);
  shard.position.set(0.55, 1.7, 0.1);
  g.add(body, face, ...eyes, hem, sash, shard);
  let phase = 0;
  return {
    object: g,
    animate(dt, speed, airborne) {
      phase += dt * (4 + speed * 1.6);
      const k = Math.min(1, speed / 5);
      body.position.y = airborne ? 0 : Math.abs(Math.sin(phase)) * 0.045 * k;
      body.rotation.x = -0.12 * k;
      body.scale.set(1 + 0.05 * k, 1, 1 + 0.05 * k);
      shard.position.y = 1.7 + Math.sin(phase * 0.5) * 0.08;
      shard.rotation.y += dt * 2;
    },
  };
}

export class Player {
  readonly root = new THREE.Group();
  readonly pos = new THREE.Vector3();
  cell = '';
  private vel = new THREE.Vector2();
  private facing = 0;
  private jump = 0;
  private vy = 0;
  private avatar: Avatar;
  speed = 0;

  constructor(avatar: Avatar) {
    this.avatar = avatar;
    this.root.add(avatar.object);
  }

  setAvatar(a: Avatar) {
    this.root.remove(this.avatar.object);
    this.avatar = a;
    this.root.add(a.object);
  }

  place(cell: Vec3, facing: Side, wm: WalkMap) {
    const f = cellFloor(cell);
    this.cell = cellKey(cell);
    this.pos.set(f[0], wm.tiles.get(this.cell)?.floorY ?? f[1], f[2]);
    this.vel.set(0, 0);
    this.jump = this.vy = 0;
    const d = DIRS[facing];
    this.facing = Math.atan2(-d[0], -d[2]);
    this.sync();
  }

  get airborne() {
    return this.jump > 0;
  }

  update(dt: number, input: Input, camYaw: number, wm: WalkMap, opts: { locked: boolean; walkSpeed: number; dash: number }) {
    let mx = 0;
    let mz = 0;
    if (!opts.locked) {
      const f = (input.down('KeyW') || input.down('ArrowUp') ? 1 : 0) - (input.down('KeyS') || input.down('ArrowDown') ? 1 : 0);
      const r = (input.down('KeyD') || input.down('ArrowRight') ? 1 : 0) - (input.down('KeyA') || input.down('ArrowLeft') ? 1 : 0);
      mx = -Math.sin(camYaw) * f + Math.cos(camYaw) * r;
      mz = -Math.cos(camYaw) * f - Math.sin(camYaw) * r;
      const len = Math.hypot(mx, mz);
      if (len > 0) {
        mx /= len;
        mz /= len;
      }
      if (input.hit('Space') && this.jump === 0) this.vy = JUMP_V;
    }
    const sp = opts.walkSpeed * (input.down('ShiftLeft') || input.down('ShiftRight') ? opts.dash : 1);
    const k = Math.min(1, dt * 10);
    this.vel.x += (mx * sp - this.vel.x) * k;
    this.vel.y += (mz * sp - this.vel.y) * k;
    if (opts.locked) this.vel.multiplyScalar(0.8);
    this.stepAxis('x', this.vel.x * dt, wm);
    this.stepAxis('z', this.vel.y * dt, wm);
    this.speed = this.vel.length();
    if (this.speed > 0.3) {
      const target = Math.atan2(-this.vel.x, -this.vel.y);
      let diff = target - this.facing;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      this.facing += diff * Math.min(1, dt * 12);
    }
    // cosmetic jump
    if (this.vy !== 0 || this.jump > 0) {
      this.vy -= GRAVITY * dt;
      this.jump = Math.max(0, this.jump + this.vy * dt);
      if (this.jump === 0) this.vy = 0;
    }
    const t = wm.tiles.get(this.cell);
    if (t) this.pos.y += (t.floorY - this.pos.y) * Math.min(1, dt * 20);
    this.avatar.animate(dt, this.speed, this.jump > 0);
    this.sync();
  }

  private sync() {
    this.root.position.set(this.pos.x, this.pos.y + this.jump, this.pos.z);
    this.root.rotation.y = this.facing;
  }

  private stepAxis(axis: 'x' | 'z', delta: number, wm: WalkMap) {
    if (Math.abs(delta) < 1e-6) return;
    const t = wm.tiles.get(this.cell);
    if (!t) return;
    const i = axis === 'x' ? 0 : 2;
    const lo = t.cell[i] * CELL;
    const hi = lo + CELL;
    const plus: Side = axis === 'x' ? 'E' : 'S';
    const minus: Side = axis === 'x' ? 'W' : 'N';
    let v = (axis === 'x' ? this.pos.x : this.pos.z) + delta;
    let next: string | null = null;
    if (delta > 0) {
      if (!t.open[plus]) v = Math.min(v, hi - R);
      else if (v >= hi) next = neighbour(t.cell, plus);
    } else {
      if (!t.open[minus]) v = Math.max(v, lo + R);
      else if (v < lo) next = neighbour(t.cell, minus);
    }
    if (next) {
      if (wm.tiles.has(next)) this.cell = next;
      else v = delta > 0 ? hi - R : lo + R;
    }
    if (axis === 'x') this.pos.x = v;
    else this.pos.z = v;
    if (next && this.cell === next) this.clampOther(axis === 'x' ? 'z' : 'x', wm);
  }

  /** After entering a tile, keep clear of its closed edges on the other axis. */
  private clampOther(axis: 'x' | 'z', wm: WalkMap) {
    const t = wm.tiles.get(this.cell)!;
    const i = axis === 'x' ? 0 : 2;
    const lo = t.cell[i] * CELL;
    const hi = lo + CELL;
    const plus: Side = axis === 'x' ? 'E' : 'S';
    const minus: Side = axis === 'x' ? 'W' : 'N';
    let v = axis === 'x' ? this.pos.x : this.pos.z;
    if (!t.open[plus]) v = Math.min(v, hi - R);
    if (!t.open[minus]) v = Math.max(v, lo + R);
    if (axis === 'x') this.pos.x = v;
    else this.pos.z = v;
  }
}

function neighbour(c: readonly number[], s: Side): string {
  const d = DIRS[s];
  return cellKey([c[0] + d[0], c[1], c[2] + d[2]]);
}
