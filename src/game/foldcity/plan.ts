// Turns a variant's surface and street sheet into a list of buildings standing on it: each lot of the layout is put on the
// surface along its local normal, kept off high curvature and off the play area, and checked against every building already
// placed in 3D (oriented boxes), so nothing cuts through anything. Pure: no GLB, no DOM (tests/foldcity.test.ts runs it).
import * as THREE from 'three';
import { layoutLots, makeLattice, footprint, type Lattice, type Lot } from './layout.ts';
import { MODELS } from './models.ts';
import { frameAt, interiorSign, makeFrame, type Frame, type Surface } from './surfaces.ts';
import type { FaceDef, VariantDef } from './variants.ts';

/** The volume the player's modules sweep, with room for the camera: nothing of the background may enter it. */
export const PLAY = new THREE.Box3(new THREE.Vector3(-70, -48, -55), new THREE.Vector3(80, 58, 40));
export const PLAY_CENTER = PLAY.getCenter(new THREE.Vector3());
/** Buildings keep at least this far from the play volume. */
export const PLAY_MARGIN = 8;
/** A building stands this far from the next one at least (metres, between the boxes). */
export const GAP = 1.2;

/** The ground may rise into a building's footprint by at most this much at its corners, and fall away by at most `MAX_GAP`. */
export const MAX_BURY = 7;
export const MAX_GAP = 5;
export const MAX_TILT = (17 * Math.PI) / 180;
/** Buildings nearer than this to the play area get the detailed model. */
export const NEAR_LOD = 250;

export interface Obb {
  c: THREE.Vector3;
  /** Axes (unit) and half extents. */
  a: [THREE.Vector3, THREE.Vector3, THREE.Vector3];
  h: [number, number, number];
}

export interface Building {
  lot: Lot;
  face: number;
  model: number;
  /** Footprint centre on the surface, the unit axes (X along the building, n up from the surface, Z across). */
  p: THREE.Vector3;
  x: THREE.Vector3;
  n: THREE.Vector3;
  z: THREE.Vector3;
  /** Uniform scale, vertical scale factor (on top of it), and how far the base is sunk into the surface. */
  scale: number;
  sy: number;
  sink: number;
  lod: 0 | 1;
  /** Distance from the play area's centre. */
  dist: number;
  obb: Obb;
}

/** One sheet of the city: its surface, which way its normal must flip to face the play area, and its street lattice. */
export interface FacePlan {
  surface: Surface;
  sign: 1 | -1;
  lattice: Lattice;
}

export interface CityPlan {
  def: VariantDef;
  faces: FacePlan[];
  buildings: Building[];
  stats: { lots: number; placed: number; offSurface: number; blocked: number; shortened: number; far: number; backFacing: number; throughSheet: number };
}

const AX = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)] as const;

export const boxObb = (b: THREE.Box3): Obb => ({
  c: b.getCenter(new THREE.Vector3()),
  a: [AX[0].clone(), AX[1].clone(), AX[2].clone()],
  h: [(b.max.x - b.min.x) / 2, (b.max.y - b.min.y) / 2, (b.max.z - b.min.z) / 2],
});

const T = new THREE.Vector3();
const AXIS = new THREE.Vector3();

/** Separating axis test: true when the two boxes (each grown by `margin`) overlap. */
export function overlaps(p: Obb, q: Obb, margin = 0): boolean {
  T.subVectors(q.c, p.c);
  const test = (axis: THREE.Vector3) => {
    const len = axis.length();
    if (len < 1e-6) return false; // parallel edges: no axis from this pair
    AXIS.copy(axis).divideScalar(len);
    let rp = margin;
    let rq = margin;
    for (let i = 0; i < 3; i++) {
      rp += p.h[i] * Math.abs(p.a[i].dot(AXIS));
      rq += q.h[i] * Math.abs(q.a[i].dot(AXIS));
    }
    return Math.abs(T.dot(AXIS)) > rp + rq; // separated
  };
  for (let i = 0; i < 3; i++) if (test(p.a[i]) || test(q.a[i])) return false;
  const cross = new THREE.Vector3();
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) if (test(cross.crossVectors(p.a[i], q.a[j]))) return false;
  return true;
}

export function bounds(o: Obb, out: THREE.Box3) {
  const e = new THREE.Vector3();
  for (let i = 0; i < 3; i++) e.setComponent(i, o.h[0] * Math.abs(o.a[0].getComponent(i)) + o.h[1] * Math.abs(o.a[1].getComponent(i)) + o.h[2] * Math.abs(o.a[2].getComponent(i)));
  out.min.copy(o.c).sub(e);
  out.max.copy(o.c).add(e);
  return out;
}

const CELL = 64;
export class Hash {
  private map = new Map<number, Obb[]>();
  private box = new THREE.Box3();
  private key(i: number, j: number, k: number) {
    return ((i + 512) * 1024 + (j + 512)) * 1024 + (k + 512);
  }
  insert(o: Obb) {
    bounds(o, this.box);
    for (let i = Math.floor(this.box.min.x / CELL); i <= Math.floor(this.box.max.x / CELL); i++)
      for (let j = Math.floor(this.box.min.y / CELL); j <= Math.floor(this.box.max.y / CELL); j++)
        for (let k = Math.floor(this.box.min.z / CELL); k <= Math.floor(this.box.max.z / CELL); k++) {
          const key = this.key(i, j, k);
          const list = this.map.get(key);
          if (list) list.push(o);
          else this.map.set(key, [o]);
        }
  }
  hits(o: Obb, margin: number): boolean {
    bounds(o, this.box);
    this.box.expandByScalar(margin);
    const seen = new Set<Obb>();
    for (let i = Math.floor(this.box.min.x / CELL); i <= Math.floor(this.box.max.x / CELL); i++)
      for (let j = Math.floor(this.box.min.y / CELL); j <= Math.floor(this.box.max.y / CELL); j++)
        for (let k = Math.floor(this.box.min.z / CELL); k <= Math.floor(this.box.max.z / CELL); k++)
          for (const q of this.map.get(this.key(i, j, k)) ?? []) {
            if (seen.has(q)) continue;
            seen.add(q);
            if (overlaps(o, q, margin)) return true;
          }
    return false;
  }
}

/** Points of every sheet (a coarse grid), kept with their sheet coordinates: what a building must not cut through. */
export class SheetPoints {
  private cell = 48;
  private map = new Map<number, number[]>();
  readonly x: number[] = [];
  readonly y: number[] = [];
  readonly z: number[] = [];
  readonly face: number[] = [];
  readonly u: number[] = [];
  readonly v: number[] = [];
  constructor(faces: ReadonlyArray<{ surface: Surface }>, step: number, within: number, around: THREE.Vector3, offset = 0) {
    const p = new THREE.Vector3();
    faces.forEach(({ surface }, fi) => {
      const [u0, u1] = surface.uRange;
      const [v0, v1] = surface.vRange;
      for (let u = u0 + offset; u <= u1; u += step)
        for (let v = v0 + offset; v <= v1; v += step) {
          surface.at(u, v, p);
          if (p.distanceTo(around) > within) continue;
          const id = this.x.length;
          this.x.push(p.x);
          this.y.push(p.y);
          this.z.push(p.z);
          this.face.push(fi);
          this.u.push(u);
          this.v.push(v);
          const key = this.key(Math.floor(p.x / this.cell), Math.floor(p.y / this.cell), Math.floor(p.z / this.cell));
          const list = this.map.get(key);
          if (list) list.push(id);
          else this.map.set(key, [id]);
        }
    });
  }
  private key(i: number, j: number, k: number) {
    return ((i + 1024) * 2048 + (j + 1024)) * 2048 + (k + 1024);
  }
  /** Ids of the points whose cell touches the box. */
  near(box: THREE.Box3, out: number[] = []): number[] {
    out.length = 0;
    for (let i = Math.floor(box.min.x / this.cell); i <= Math.floor(box.max.x / this.cell); i++)
      for (let j = Math.floor(box.min.y / this.cell); j <= Math.floor(box.max.y / this.cell); j++)
        for (let k = Math.floor(box.min.z / this.cell); k <= Math.floor(box.max.z / this.cell); k++) {
          const list = this.map.get(this.key(i, j, k));
          if (list) for (const id of list) out.push(id);
        }
    return out;
  }
}

/** True when some point of another part of a sheet lies inside the box (shrunk by `shrink`), the lot's own sheet around it excluded. */
export function cutsSheet(points: SheetPoints, o: Obb, face: number, u: number, v: number, fu: number, fv: number, periodLength: number, shrink = 0.4): boolean {
  const box = new THREE.Box3();
  bounds(o, box);
  const q = new THREE.Vector3();
  for (const id of points.near(box)) {
    if (points.face[id] === face) {
      let du = Math.abs(points.u[id] - u);
      if (periodLength > 0) du = Math.min(du, periodLength - du);
      const dv = Math.abs(points.v[id] - v);
      if (du < fu / 2 + 28 && dv < fv / 2 + 28) continue; // the lot's own patch of sheet
    }
    q.set(points.x[id], points.y[id], points.z[id]).sub(o.c);
    if (Math.abs(q.dot(o.a[0])) < o.h[0] - shrink && Math.abs(q.dot(o.a[1])) < o.h[1] - shrink && Math.abs(q.dot(o.a[2])) < o.h[2] - shrink) return true;
  }
  return false;
}

/** The corners of the play volume and its centre: a sheet must face all of them, or part of the play area sees its back. */
const PLAY_SEEN_FROM = [PLAY_CENTER, ...[0, 1, 2, 3, 4, 5, 6, 7].map((i) => new THREE.Vector3(i & 1 ? PLAY.max.x : PLAY.min.x, i & 2 ? PLAY.max.y : PLAY.min.y, i & 4 ? PLAY.max.z : PLAY.min.z))];
export const facesPlayArea = (p: THREE.Vector3, n: THREE.Vector3) => PLAY_SEEN_FROM.every((c) => n.dot(T2.subVectors(c, p)) > 0);
const T2 = new THREE.Vector3();

export function planCity(def: VariantDef, seed: number): CityPlan {
  const defs: FaceDef[] = def.make();
  const faces: FacePlan[] = defs.map((d, i) => ({
    surface: d.surface,
    sign: interiorSign(d.surface, PLAY_CENTER),
    lattice:
      d.lattice ??
      makeLattice({
        uRange: d.surface.uRange, vRange: d.surface.vRange, periodic: d.surface.periodic,
        creaseU: d.surface.creaseU, creaseV: d.surface.creaseV, pitchU: def.pitch[0], pitchV: def.pitch[1], seed: seed + i * 7,
      }),
  }));
  const stats = { lots: 0, placed: 0, offSurface: 0, blocked: 0, shortened: 0, far: 0, backFacing: 0, throughSheet: 0 };
  const sheets = new SheetPoints(faces, 6, def.reach + 150, PLAY_CENTER);

  // nearest to the play area first: what is close keeps its full height, what is far fits around it
  const f = makeFrame();
  const fc = makeFrame();
  const all: Array<{ lot: Lot; face: number; d: number }> = [];
  faces.forEach((fp, face) => {
    for (const lot of layoutLots(fp.lattice, seed + face * 13, def.scale)) all.push({ lot, face, d: fp.surface.at(lot.u, lot.v, T).distanceTo(PLAY_CENTER) });
  });
  stats.lots = all.length;
  all.sort((a, b) => a.d - b.d);
  const playObb = boxObb(PLAY.clone().expandByScalar(PLAY_MARGIN));
  const hash = new Hash();
  const buildings: Building[] = [];
  for (const { lot, face, d } of all) {
    if (d > def.reach) {
      stats.far++;
      continue;
    }
    const { surface, sign } = faces[face];
    const [u0, u1] = surface.uRange;
    const [v0, v1] = surface.vRange;
    const m = MODELS[lot.model];
    const [fu, fv] = footprint(m, lot.scale, lot.swap, lot.stretch);
    if (!surface.periodic && (lot.u - fu / 2 < u0 || lot.u + fu / 2 > u1)) continue;
    if (lot.v - fv / 2 < v0 || lot.v + fv / 2 > v1) continue;
    frameAt(surface, sign, lot.u, lot.v, f);
    if (!facesPlayArea(f.p, f.n)) {
      stats.backFacing++;
      continue;
    }
    // the surface under the footprint: how far it tilts and how far it rises or falls away from the tangent plane
    let ok = true;
    let sink = 0.5;
    for (const [su, sv] of [[-1, -1], [1, -1], [1, 1], [-1, 1], [0, -1], [0, 1], [-1, 0], [1, 0]] as const) {
      frameAt(surface, sign, lot.u + (su * fu) / 2, lot.v + (sv * fv) / 2, fc);
      const dev = fc.p.clone().sub(f.p).dot(f.n);
      if (fc.n.angleTo(f.n) > MAX_TILT || dev > MAX_BURY || -dev > MAX_GAP) {
        ok = false;
        break;
      }
      sink = Math.max(sink, -dev + 0.5);
    }
    if (!ok) {
      stats.offSurface++;
      continue;
    }
    const x = (lot.swap ? f.ev : f.eu).clone().multiplyScalar(lot.flip ? -1 : 1);
    const z = new THREE.Vector3().crossVectors(x, f.n);
    let placed = false;
    let sy = lot.sy;
    for (let attempt = 0; attempt < 4 && !placed; attempt++, sy *= 0.78) {
      const H = m.h * lot.scale * sy;
      const obb: Obb = {
        c: f.p.clone().addScaledVector(f.n, H / 2),
        a: [x.clone(), f.n.clone(), z.clone()],
        h: [(m.w * lot.scale * (lot.stretch ?? 1)) / 2, H / 2, (m.d * lot.scale) / 2],
      };
      if (overlaps(obb, playObb) || hash.hits(obb, GAP)) continue;
      if (cutsSheet(sheets, obb, face, lot.u, lot.v, fu, fv, surface.periodic ? u1 - u0 : 0)) {
        stats.throughSheet++;
        continue;
      }
      hash.insert(obb);
      buildings.push({
        lot, face, model: lot.model, p: f.p.clone(), x, n: f.n.clone(), z, scale: lot.scale, sy, sink,
        lod: d < NEAR_LOD ? 0 : 1, dist: d, obb,
      });
      if (attempt > 0) stats.shortened++;
      placed = true;
    }
    if (placed) stats.placed++;
    else stats.blocked++;
  }
  return { def, faces, buildings, stats };
}

/** The Frame type for callers that only import the plan. */
export type { Frame };
