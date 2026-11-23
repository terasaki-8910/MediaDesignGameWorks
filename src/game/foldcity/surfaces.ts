// The surface the city sheet is mapped onto: S(u, v) in metres of sheet, a tangent frame, and the tessellation of the
// ground. Most surfaces here are a 2D profile (lines, arcs, curls) extruded along an axis: that is "folded paper", so
// sheet metres stay true metres and lots keep their size. Others bend further (see variants.ts).
import * as THREE from 'three';

/** A planar path resampled at a fixed arc length, evaluated with a Catmull-Rom spline (smooth tangents). */
export class Profile {
  readonly length: number;
  readonly closed: boolean;
  private readonly ds: number;
  private readonly n: number;
  private readonly px: Float64Array;
  private readonly py: Float64Array;

  /** `points` are joined by straight lines and resampled to `step` metres; a closed path ends where it starts. */
  constructor(points: ReadonlyArray<readonly [number, number]>, step = 0.5, closed = false) {
    const cum = [0];
    for (let i = 1; i < points.length; i++) cum.push(cum[i - 1] + Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]));
    this.length = cum[cum.length - 1];
    this.closed = closed;
    const count = Math.max(4, Math.ceil(this.length / step) + 1);
    this.n = count;
    this.ds = this.length / (count - 1);
    this.px = new Float64Array(count);
    this.py = new Float64Array(count);
    let j = 0;
    for (let i = 0; i < count; i++) {
      const s = i * this.ds;
      while (j < cum.length - 2 && cum[j + 1] < s) j++;
      const span = cum[j + 1] - cum[j];
      const f = span > 1e-12 ? (s - cum[j]) / span : 0;
      this.px[i] = points[j][0] + (points[j + 1][0] - points[j][0]) * f;
      this.py[i] = points[j][1] + (points[j + 1][1] - points[j][1]) * f;
    }
  }

  private index(i: number) {
    if (this.closed) {
      const m = this.n - 1;
      return ((i % m) + m) % m;
    }
    return Math.min(this.n - 1, Math.max(0, i));
  }

  /** Position and unit tangent at arc length `s` (clamped, or wrapped for a closed path). */
  at(s: number, out: { x: number; y: number; tx: number; ty: number }) {
    let t = s / this.ds;
    if (this.closed) {
      const m = this.n - 1;
      t = ((t % m) + m) % m;
    } else t = Math.min(this.n - 1 - 1e-9, Math.max(0, t));
    const i = Math.floor(t);
    const f = t - i;
    const a = this.index(i - 1);
    const b = this.index(i);
    const c = this.index(i + 1);
    const d = this.index(i + 2);
    const f2 = f * f;
    const f3 = f2 * f;
    const ev = (p: Float64Array) => 0.5 * (2 * p[b] + (-p[a] + p[c]) * f + (2 * p[a] - 5 * p[b] + 4 * p[c] - p[d]) * f2 + (-p[a] + 3 * p[b] - 3 * p[c] + p[d]) * f3);
    const dv = (p: Float64Array) => 0.5 * (-p[a] + p[c] + 2 * (2 * p[a] - 5 * p[b] + 4 * p[c] - p[d]) * f + 3 * (-p[a] + 3 * p[b] - 3 * p[c] + p[d]) * f2);
    out.x = ev(this.px);
    out.y = ev(this.py);
    const tx = dv(this.px);
    const ty = dv(this.py);
    const l = Math.hypot(tx, ty) || 1;
    out.tx = tx / l;
    out.ty = ty / l;
    return out;
  }
}

type P2 = [number, number];

/** A polyline with each interior corner rounded by an arc of the given radius. */
export function filleted(corners: P2[], radius: number | number[], arcStep = 0.4, mids?: number[]): P2[] {
  const out: P2[] = [corners[0]];
  for (let i = 1; i < corners.length - 1; i++) {
    const [p0, p1, p2] = [corners[i - 1], corners[i], corners[i + 1]];
    const l1 = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
    const l2 = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
    const d1: P2 = [(p1[0] - p0[0]) / l1, (p1[1] - p0[1]) / l1];
    const d2: P2 = [(p2[0] - p1[0]) / l2, (p2[1] - p1[1]) / l2];
    const turn = Math.atan2(d1[0] * d2[1] - d1[1] * d2[0], d1[0] * d2[0] + d1[1] * d2[1]);
    const r = typeof radius === 'number' ? radius : radius[i - 1];
    const t = r * Math.tan(Math.abs(turn) / 2);
    const a: P2 = [p1[0] - d1[0] * t, p1[1] - d1[1] * t];
    const nrm: P2 = turn > 0 ? [-d1[1], d1[0]] : [d1[1], -d1[0]];
    const c: P2 = [a[0] + nrm[0] * r, a[1] + nrm[1] * r];
    const a0 = Math.atan2(a[1] - c[1], a[0] - c[0]);
    const steps = Math.max(2, Math.ceil((Math.abs(turn) * r) / arcStep));
    for (let k = 0; k <= steps; k++) {
      const ang = a0 + (turn * k) / steps;
      if (k === Math.floor(steps / 2)) mids?.push(out.length);
      out.push([c[0] + r * Math.cos(ang), c[1] + r * Math.sin(ang)]);
    }
  }
  out.push(corners[corners.length - 1]);
  return out;
}

/** A closed superellipse (exponent 2 = ellipse, higher = squarer), counter-clockwise from its lowest point. */
export function superellipse(cx: number, cy: number, a: number, b: number, p: number, n = 4096): P2[] {
  const e = 2 / p;
  const pts: P2[] = [];
  for (let i = 0; i <= n; i++) {
    const t = -Math.PI / 2 + (i / n) * Math.PI * 2;
    const c = Math.cos(t);
    const s = Math.sin(t);
    pts.push([cx + a * Math.sign(c) * Math.abs(c) ** e, cy + b * Math.sign(s) * Math.abs(s) ** e]);
  }
  return pts;
}

/** A path from its curvature: pieces of `len` metres whose curvature (1/radius, + = left) runs linearly from k0 to k1. */
export function byCurvature(start: P2, pieces: Array<{ len: number; k0: number; k1?: number }>, step = 0.5): P2[] {
  let [x, y] = start;
  let th = 0;
  const pts: P2[] = [[x, y]];
  for (const piece of pieces) {
    const n = Math.max(1, Math.ceil(piece.len / step));
    const ds = piece.len / n;
    for (let i = 0; i < n; i++) {
      const k = piece.k0 + ((piece.k1 ?? piece.k0) - piece.k0) * ((i + 0.5) / n);
      th += k * ds * 0.5;
      x += Math.cos(th) * ds;
      y += Math.sin(th) * ds;
      th += k * ds * 0.5;
      pts.push([x, y]);
    }
  }
  return pts;
}

/** What the layout and the mesh need from a surface. u and v are metres of sheet. */
export interface Surface {
  readonly name: string;
  readonly uRange: readonly [number, number];
  readonly vRange: readonly [number, number];
  /** The sheet closes on itself in u (a ring): the street lattice must fit the length exactly. */
  readonly periodic: boolean;
  /** Sheet lines the surface folds along: the street lattice puts an avenue on each. */
  readonly creaseU: readonly number[];
  readonly creaseV: readonly number[];
  /** A sheet point from which the interior (the play area) is on the +normal side. */
  readonly ref: readonly [number, number];
  at(u: number, v: number, out: THREE.Vector3): THREE.Vector3;
}

/** A surface from a plain function. */
export function surfaceFrom(def: Omit<Surface, 'at'> & { at: Surface['at'] }): Surface {
  return def;
}

/** A profile extruded along an axis: z (profile in x-y) or x (profile in z-y); v is the distance along the axis from `origin`. */
export function extruded(
  name: string,
  profile: Profile,
  axis: 'x' | 'z',
  origin: number,
  vRange: readonly [number, number],
  extra: { creaseU?: number[]; creaseV?: number[]; ref: readonly [number, number] },
): Surface {
  const tmp = { x: 0, y: 0, tx: 0, ty: 0 };
  return {
    name,
    uRange: [0, profile.length],
    vRange,
    periodic: profile.closed,
    creaseU: extra.creaseU ?? [],
    creaseV: extra.creaseV ?? [],
    ref: extra.ref,
    at(u, v, out) {
      profile.at(u, tmp);
      return axis === 'z' ? out.set(tmp.x, tmp.y, origin + v) : out.set(origin + v, tmp.y, tmp.x);
    },
  };
}

/** The tangent frame at a sheet point: `n` towards the interior, `eu` and `ev` the unit directions of u and v in the tangent plane. */
export interface Frame {
  p: THREE.Vector3;
  n: THREE.Vector3;
  eu: THREE.Vector3;
  ev: THREE.Vector3;
}

export const makeFrame = (): Frame => ({ p: new THREE.Vector3(), n: new THREE.Vector3(), eu: new THREE.Vector3(), ev: new THREE.Vector3() });

const A = new THREE.Vector3();
const B = new THREE.Vector3();
const PU = new THREE.Vector3();
const PV = new THREE.Vector3();

/** Which way the normal must be flipped so that it points to `interior` from the surface's reference point. */
export function interiorSign(s: Surface, interior: THREE.Vector3): 1 | -1 {
  const h = 0.6;
  const [u, v] = s.ref;
  s.at(u, v, A);
  s.at(u + h, v, PU).sub(s.at(u - h, v, B));
  s.at(u, v + h, PV).sub(s.at(u, v - h, B));
  const n = new THREE.Vector3().crossVectors(PU, PV);
  return n.dot(B.copy(interior).sub(A)) >= 0 ? 1 : -1;
}

/** Fill `f` for the surface at (u, v); `sign` from `interiorSign`. */
export function frameAt(s: Surface, sign: 1 | -1, u: number, v: number, f: Frame, h = 0.6): Frame {
  s.at(u, v, f.p);
  s.at(u + h, v, PU).sub(s.at(u - h, v, B));
  s.at(u, v + h, PV).sub(s.at(u, v - h, B));
  f.n.crossVectors(PU, PV).normalize().multiplyScalar(sign);
  f.eu.copy(PU).addScaledVector(f.n, -PU.dot(f.n)).normalize();
  f.ev.copy(PV).addScaledVector(f.n, -PV.dot(f.n)).normalize();
  return f;
}

/**
 * Where to cut a sheet range into strips for the ground mesh: at most `maxStep` apart, and finer where the surface
 * turns (normals more than `maxAngle` apart, or the middle further than `tol` from the chord), never under `minStep`.
 * `others` are values of the other coordinate to test at.
 */
export function breaks(
  s: Surface,
  sign: 1 | -1,
  along: 'u' | 'v',
  others: number[],
  maxStep = 40,
  maxAngle = (4 * Math.PI) / 180,
  tol = 0.25,
  minStep = 0.8,
): number[] {
  const [lo, hi] = along === 'u' ? s.uRange : s.vRange;
  const fa = makeFrame();
  const fb = makeFrame();
  const P = new THREE.Vector3();
  const Q = new THREE.Vector3();
  const at = (t: number, o: number, f: Frame) => (along === 'u' ? frameAt(s, sign, t, o, f) : frameAt(s, sign, o, t, f));
  const out: number[] = [lo];
  const split = (a: number, b: number) => {
    if (b - a <= minStep) return;
    let need = b - a > maxStep;
    for (let i = 0; i < others.length && !need; i++) {
      at(a, others[i], fa);
      at(b, others[i], fb);
      if (fa.n.angleTo(fb.n) > maxAngle) need = true;
      else {
        at((a + b) / 2, others[i], fb);
        Q.copy(fa.p);
        (along === 'u' ? s.at(b, others[i], P) : s.at(others[i], b, P));
        const mid = fb.p;
        Q.add(P).multiplyScalar(0.5);
        if (Q.distanceTo(mid) > tol) need = true;
      }
    }
    if (!need) return;
    const m = (a + b) / 2;
    split(a, m);
    out.push(m);
    split(m, b);
  };
  const first = Math.max(1, Math.ceil((hi - lo) / maxStep));
  for (let i = 0; i < first; i++) {
    const a = lo + ((hi - lo) * i) / first;
    const b = lo + ((hi - lo) * (i + 1)) / first;
    split(a, b);
    out.push(b);
  }
  return out;
}

/** Arc length along a polyline up to its `index`th point. */
export function lengthTo(points: ReadonlyArray<readonly [number, number]>, index: number): number {
  let l = 0;
  for (let i = 1; i <= index; i++) l += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
  return l;
}
