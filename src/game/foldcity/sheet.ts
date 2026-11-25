// One sheet of city for the whole game. Every section's structure (the canyon, the right-angle channel, the tube) is the
// same street sheet curled differently across the play axis, so the city can fold from one into the next with every
// building riding along, and the progression is a channel of city that tightens around the player: the walls rise,
// crease and close.
//
// Sheet coordinates: `a` runs along the play axis (world +X, never bent), `b` across it (world +Z when the sheet lies
// flat), in metres. A state is the cross-section of the sheet, the same on both sides of the axis, as the heading of the
// section along |b| (0 = flat ground running outwards, 90 degrees = a wall, 180 = a ceiling running back in):
//   heading(a, b) = psi(a) * ramp(|b|) + G(|b|)
// `ramp` is the first crease, between |b| = W0 and W0 + BEND; its angle `psi` may change along the play axis (the canyon's
// walls lean back towards the horizon). `G` is everything else, one table along |b|: the second and third creases of the
// channel, the curve of the tube. Lengths across the sheet stay lengths in the world (paper folds). A transition
// interpolates psi and G, never positions, so nothing stretches on the way.
//
// The strip under the play area (|b| < FLAT) is flat and in the same place in every state: the piers' feet stand on it.
import * as THREE from 'three';
import type { Surface } from './surfaces.ts';

export type StructureName = 'horizon' | 'fold90' | 'ring';
export const STRUCTURES: readonly StructureName[] = ['horizon', 'fold90', 'ring'];

/** World position of sheet point (0, 0): below the play area. */
export const GROUND_Y = -96;
export const Z0 = -7.5;
/** The first crease: flat ground this far each side, then a bend of this arc length. */
export const W0 = 150;
export const BEND = 30;
const W1 = W0 + BEND;

/** The sheet: `a` along the play axis, `b` to both sides. Its far ends lie in the haze. */
export const A0 = -1400;
export const A1 = 1500;
export const B0 = -1300;
export const B1 = 1300;

// fold90: the ground creases into walls, the walls into ceilings that run back towards the axis, and the ceilings crease
// up again either side of a slot of sky: two walls of city facing each other, rising until they dissolve.
/** Height of the channel's ceiling (the play volume ends at y = 58). */
export const CEILING_Y = 110;
/** Half the width of the slot of sky in the channel's ceiling. */
export const SLOT = 60;
const R90 = BEND / (Math.PI / 2);
/** Where the second and the third crease begin, along |b|: whole metres, so the tube's seam is a sample of the tables. */
export const CREASE2 = Math.round(W1 + (CEILING_Y - GROUND_Y - 2 * R90));
export const CREASE3 = Math.round(CREASE2 + BEND + (W0 - R90 - SLOT));
/** The slot's walls end between these |b|, block by block (veilAt): some 130 to 420 m above the ceiling. */
const LIP_FOLD90: readonly [number, number] = [CREASE3 + BEND + 130, CREASE3 + BEND + 420];

// ring: a tube round the play axis. A flat floor, a quarter circle up each side, a quarter circle back overhead and a flat
// ceiling; the two edges meet over the axis, in the middle of the boulevard that lies on the channel's third crease.
/** Half the tube's perimeter: the seam overhead. The sheet beyond it is not part of the tube. */
export const RING_HALF = CREASE3 + BEND / 2;
/** Half the width of the tube's flat floor (and of its flat ceiling). */
export const FLAT = 70;
export const RING_RADIUS = (RING_HALF - 2 * FLAT) / Math.PI;

/** Sheet lines the states fold along: boulevards lie on them. */
export const CREASES_A: readonly number[] = [];
export const CREASES_B: readonly number[] = [W0 + BEND / 2, CREASE2 + BEND / 2, RING_HALF].flatMap((c) => [-c, c]).sort((p, q) => p - q);

const NA = Math.round(A1 - A0); // samples 1 m apart
const NB = B1;
export const SAMPLES_A = NA;
export const SAMPLES_B = NB;

/** A curled sheet. */
export interface SheetState {
  /** Angle of the first crease at each sample of `a`, radians. */
  psi: Float64Array;
  /** The rest of the cross-section at each metre of |b|: its heading, and the integral of (cos, sin) of it from 0. */
  g: Float64Array;
  gx: Float64Array;
  gy: Float64Array;
  /** The sheet dissolves into the sky between these |b| (beyond the second it is gone). */
  lip: [number, number];
  /** The sheet is not drawn beyond this |b| (the tube's seam); Infinity = all of it. */
  cut: number;
}

/**
 * Where the canyon's walls dissolve into the sky. Their tilt changes along the play axis (they lean back towards the
 * horizon), so a wall twists as it rises: `lever * d(tilt)/da` is the tangent of that twist. Past about 35 degrees the
 * wall is seen nearly edge-on or from behind from most of the play area: it fades out between these two values, some
 * 300 to 500 m up, and the canyon stays open to the sky. Below that a camera can still catch a strip of a wall from
 * behind at a grazing angle; the back of the sheet is drawn for that (ground.ts: the city's foundations). Behind the
 * player the walls do not twist and stand to their full height.
 */
export const TWIST_FADE: readonly [number, number] = [0.7, 1.2];

const smooth = (t: number) => {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
};
const ramp = (s: number, from: number) => Math.min(1, Math.max(0, (s - from) / BEND));

/** A block of the street lattice as the sheet's upper edge sees it: the middle of the block across the sheet, and its fixed random number. */
export interface LipBlock { c: number; r: number }
/** A block at the sheet's upper edge goes from whole to gone over this much travel of the edge (metres): only a fold shows it. */
export const LIP_SOFT = 30;

/**
 * How far sheet point (a, b) has dissolved: 0 solid, 1 gone. The canyon's twisting walls fade smoothly. The sheet's upper
 * edge (`lip`: the walls of the channel's slot) ends block by block when `block` gives the lattice: each block is whole,
 * with its houses, or gone, at a place between lip[0] and lip[1] drawn from the block's number, so that what meets the sky
 * is a roofline of houses and never a ruled edge. The ground's shader does the same (ground.ts, bgGround). Without
 * `block` the edge is the smooth band between the two.
 */
export function veilAt(s: SheetState, a: number, b: number, block?: (a: number, b: number) => LipBlock): number {
  const u = Math.min(NA - 1e-9, Math.max(0, a - A0));
  const i = Math.floor(u);
  const twist = Math.max(0, Math.abs(b) - W0 - BEND / 2) * Math.abs(s.psi[i + 1] - s.psi[i]);
  let lip: number;
  if (block) {
    const k = block(a, b);
    lip = smooth((Math.abs(k.c) - (s.lip[0] + k.r * (s.lip[1] - s.lip[0]))) / LIP_SOFT);
  } else lip = smooth((Math.abs(b) - s.lip[0]) / Math.max(s.lip[1] - s.lip[0], 1e-6));
  return Math.max(smooth((twist - TWIST_FADE[0]) / (TWIST_FADE[1] - TWIST_FADE[0])), lip);
}

const newState = (): SheetState => ({
  psi: new Float64Array(NA + 1), g: new Float64Array(NB + 1), gx: new Float64Array(NB + 1), gy: new Float64Array(NB + 1), lip: [B1 + 1, B1 + 2], cut: Infinity,
});

/** The integral of (cos g, sin g) along |b|, by the midpoint rule: the table itself is the shape, for the shader too. */
function integrate(s: SheetState) {
  s.gx[0] = 0;
  s.gy[0] = 0;
  for (let i = 1; i <= NB; i++) {
    const m = (s.g[i] + s.g[i - 1]) / 2;
    s.gx[i] = s.gx[i - 1] + Math.cos(m);
    s.gy[i] = s.gy[i - 1] + Math.sin(m);
  }
}

/** The canyon's tilt along the play axis: just past upright behind the player, lying down towards the horizon. */
const horizonTilt = (a: number) => ((98 - 94 * smooth((a + 60) / 760)) * Math.PI) / 180;
/** The tube's share of turning inside the first crease: the crease lies on its first quarter circle. */
const RING_PSI = BEND / RING_RADIUS;

/**
 * The tube's whole heading along |b|. The sheet beyond the seam is not part of the tube; it is given the heading of the
 * channel's slot walls (straight up), so that while the channel closes into the tube those walls only draw together and
 * never lean across the axis.
 */
function ringHeading(s: number): number {
  if (s < FLAT) return 0;
  if (s < FLAT + Math.PI * RING_RADIUS) return (s - FLAT) / RING_RADIUS;
  return s <= RING_HALF ? Math.PI : Math.PI / 2;
}

function makeRest(name: StructureName): SheetState {
  const s = newState();
  for (let i = 0; i <= NA; i++) s.psi[i] = name === 'horizon' ? horizonTilt(A0 + i) : name === 'fold90' ? Math.PI / 2 : RING_PSI;
  for (let i = 0; i <= NB; i++) {
    if (name === 'fold90') s.g[i] = (Math.PI / 2) * (ramp(i, CREASE2) - ramp(i, CREASE3));
    else if (name === 'ring') s.g[i] = ringHeading(i) - RING_PSI * ramp(i, W0);
  }
  integrate(s);
  if (name === 'fold90') s.lip = [LIP_FOLD90[0], LIP_FOLD90[1]];
  if (name === 'ring') {
    s.cut = RING_HALF;
    s.lip = [RING_HALF + 1, RING_HALF + 2];
  }
  return s;
}

const REST = new Map<StructureName, SheetState>();
/** The sheet at rest in a structure. Shared: do not write to it. */
export function restState(name: StructureName): SheetState {
  let r = REST.get(name);
  if (!r) REST.set(name, (r = makeRest(name)));
  return r;
}

export interface Transition {
  from: StructureName;
  to: StructureName;
}

/** Eases a stretch of a fold: slow at both ends, never faster than 1.5 times its mean speed. */
const stage = (t: number, from: number, to: number) => smooth((t - from) / (to - from));

/**
 * The sheet a fraction `f` of the way through a transition, written into `out`.
 *
 * horizon -> fold90: the canyon's walls rise to upright all along the axis; while they do, their tops crease inwards into
 * the ceilings, and the ceilings' ends crease up into the slot's walls. fold90 -> ring: every heading blends, so the square
 * channel rounds into the tube, the slot narrows and its walls dissolve from the top down, and the two edges meet overhead.
 */
export function blendState(tr: Transition, f: number, out: SheetState): SheetState {
  const A = restState(tr.from);
  const B = restState(tr.to);
  const t = Math.min(1, Math.max(0, f));
  if (t === 0 || t === 1 || tr.from === tr.to) return copyState(t === 1 ? B : A, out);
  const canyon = tr.from === 'horizon' || tr.to === 'horizon';
  // k runs from the earlier structure of the progression to the later one, whichever way the transition goes
  const forwards = STRUCTURES.indexOf(tr.from) < STRUCTURES.indexOf(tr.to);
  const k = forwards ? t : 1 - t;
  const [P, Q] = forwards ? [A, B] : [B, A];
  // the walls (the first crease) lead, the creases above them follow
  const wPsi = canyon ? stage(k, 0, 0.9) : stage(k, 0, 1);
  const wG = canyon ? stage(k, 0.1, 1) : stage(k, 0, 1);
  for (let i = 0; i <= NA; i++) out.psi[i] = P.psi[i] + (Q.psi[i] - P.psi[i]) * wPsi;
  for (let i = 0; i <= NB; i++) out.g[i] = P.g[i] + (Q.g[i] - P.g[i]) * wG;
  integrate(out);
  if (canyon) {
    // the sheet above the slot's walls dissolves as the ceilings fold over
    const w = stage(k, 0.1, 0.9);
    out.lip[0] = B1 + 1 + (Q.lip[0] - B1 - 1) * w;
    out.lip[1] = out.lip[0] + (Q.lip[1] - Q.lip[0]);
    out.cut = Infinity;
  } else {
    // the slot's walls dissolve from the top down ahead of the closing; the edges stay soft until they meet
    const w = stage(k, 0, 0.7);
    const soft = 60 * (1 - k);
    out.lip[0] = P.lip[0] + (RING_HALF - soft - P.lip[0]) * w;
    out.lip[1] = P.lip[1] + (RING_HALF + soft - P.lip[1]) * w;
    out.cut = Infinity;
  }
  return out;
}

export function copyState(src: SheetState, out: SheetState): SheetState {
  out.psi.set(src.psi);
  out.g.set(src.g);
  out.gx.set(src.gx);
  out.gy.set(src.gy);
  out.lip[0] = src.lip[0];
  out.lip[1] = src.lip[1];
  out.cut = src.cut;
  return out;
}

export const makeState = (): SheetState => newState();

/** The first crease's angle at `a`, interpolated between samples. */
export function psiAt(s: SheetState, a: number): number {
  const u = Math.min(NA - 1e-9, Math.max(0, a - A0));
  const i = Math.floor(u);
  return s.psi[i] + (s.psi[i + 1] - s.psi[i]) * (u - i);
}

/**
 * The cross-section at |b| = `d` for a first-crease angle `psi`: how far out from the axis (`out[0]`) and how high above
 * the flat sheet (`out[1]`). The same arithmetic as the ground's vertex shader (ground.ts).
 */
export function sectionAt(s: SheetState, psi: number, d: number, out: [number, number]): [number, number] {
  const u = Math.min(NB - 1e-9, Math.max(0, d));
  const i = Math.floor(u);
  const k = u - i;
  const tx = s.gx[i] + (s.gx[i + 1] - s.gx[i]) * k;
  const ty = s.gy[i] + (s.gy[i + 1] - s.gy[i]) * k;
  if (d <= W0) {
    out[0] = tx;
    out[1] = ty;
    return out;
  }
  // inside the first crease: an arc from heading G(W0) that turns by psi and by G's own share. The chord of the arc: its
  // length is t * sinc(half the turn), its direction the heading half-way
  const phi0 = s.g[W0];
  const t = Math.min(d - W0, BEND);
  const half = ((psi + s.g[W1] - phi0) / BEND) * t * 0.5;
  const chord = t * (Math.abs(half) < 1e-3 ? 1 - (half * half) / 6 : Math.sin(half) / half);
  const ax = s.gx[W0] + chord * Math.cos(phi0 + half);
  const ay = s.gy[W0] + chord * Math.sin(phi0 + half);
  if (d <= W1) {
    out[0] = ax;
    out[1] = ay;
    return out;
  }
  // beyond it: the table from the crease on, turned by psi
  const dx = tx - s.gx[W1];
  const dy = ty - s.gy[W1];
  const c = Math.cos(psi);
  const sn = Math.sin(psi);
  out[0] = ax + dx * c - dy * sn;
  out[1] = ay + dx * sn + dy * c;
  return out;
}

const SEC: [number, number] = [0, 0];
export const SHEET_SIGN = -1 as const;

/** World position of sheet point (a, b). */
export function sheetAt(s: SheetState, a: number, b: number, out: THREE.Vector3): THREE.Vector3 {
  sectionAt(s, psiAt(s, a), Math.abs(b), SEC);
  return out.set(a, GROUND_Y + SEC[1], Z0 + (b < 0 ? -SEC[0] : SEC[0]));
}

/** The whole heading of the cross-section at (a, |b|), radians. */
export function headingAt(s: SheetState, a: number, d: number): number {
  const u = Math.min(NB - 1e-9, Math.max(0, d));
  const i = Math.floor(u);
  return psiAt(s, a) * ramp(d, W0) + s.g[i] + (s.g[i + 1] - s.g[i]) * (u - i);
}

const SEC2: [number, number] = [0, 0];

/**
 * The sheet's frame at (a, b), from the tables directly: the point `p`, the unit normal `n` towards the play area, and the
 * unit tangents `eu` (along a) and `ev` (along b). What `frameAt` of surfaces.ts finds by differences, at a fifth of the
 * cost: the city poses every building with this in every frame of a fold.
 */
export function sheetFrame(s: SheetState, a: number, b: number, f: { p: THREE.Vector3; n: THREE.Vector3; eu: THREE.Vector3; ev: THREE.Vector3 }) {
  const d = Math.abs(b);
  const sg = b < 0 ? -1 : 1;
  const u = Math.min(NA - 1e-9, Math.max(0, a - A0));
  const i = Math.floor(u);
  const psi = s.psi[i] + (s.psi[i + 1] - s.psi[i]) * (u - i);
  const dpsi = s.psi[i + 1] - s.psi[i]; // per metre of a
  sectionAt(s, psi, d, SEC);
  f.p.set(a, GROUND_Y + SEC[1], Z0 + sg * SEC[0]);
  const v = Math.min(NB - 1e-9, d);
  const j = Math.floor(v);
  const phi = psi * ramp(d, W0) + s.g[j] + (s.g[j + 1] - s.g[j]) * (v - j);
  f.ev.set(0, sg * Math.sin(phi), Math.cos(phi));
  if (d > W0 && Math.abs(dpsi) > 1e-9) {
    // the canyon's wall twists along the axis: the point moves with psi
    sectionAt(s, psi + dpsi, d, SEC2);
    f.eu.set(1, SEC2[1] - SEC[1], sg * (SEC2[0] - SEC[0]));
  } else f.eu.set(1, 0, 0);
  f.n.crossVectors(f.eu, f.ev).normalize().multiplyScalar(SHEET_SIGN);
  f.eu.addScaledVector(f.n, -f.eu.dot(f.n)).normalize();
  return f;
}

/** A state as a `Surface` (u = a, v = b) for the layout's and the tests' helpers. Its normal sign towards the play area is SHEET_SIGN. */
export function surfaceOf(s: SheetState, name = 'sheet'): Surface {
  return {
    name, uRange: [A0, A1], vRange: [B0, B1], periodic: false, creaseU: CREASES_A, creaseV: CREASES_B, ref: [0, 0],
    at: (u, v, out) => sheetAt(s, u, v, out),
  };
}

/**
 * Does some structure curl the sheet between b0 and b1 (one side of the axis) more tightly than a 45 m house lying across
 * the curl can follow? There the layout lays the houses along the play axis.
 */
export function curlsTightly(b0: number, b1: number): boolean {
  const lo = Math.max(0, Math.floor(Math.min(Math.abs(b0), Math.abs(b1))));
  const hi = Math.min(NB, Math.ceil(Math.max(Math.abs(b0), Math.abs(b1))));
  return STRUCTURES.some((name) => {
    const s = restState(name);
    const psi = name === 'horizon' ? Math.PI / 2 : s.psi[0];
    const h = (i: number) => psi * ramp(i, W0) + s.g[i];
    for (let i = lo; i + 45 <= Math.max(hi, lo + 45) && i + 45 <= NB; i += 5) if (Math.abs(h(i + 45) - h(i)) > 0.2) return true;
    return false;
  });
}

/** The grid lines of `a` and `b` the ground mesh is cut along: fine wherever any state bends, coarse on the flats. */
export function sheetGrid(): { a: number[]; b: number[] } {
  const states = STRUCTURES.map(restState);
  const maxTurn = (3.5 * Math.PI) / 180;
  const a: number[] = [A0];
  let i0 = 0;
  for (let i = 1; i <= NA; i++) {
    let need = i - i0 >= 36 || i === NA;
    // the canyon's tilt changes along a: keep its twist smooth
    if (!need && i < NA) need = Math.abs(states[0].psi[i + 1] - states[0].psi[i0]) > maxTurn * 1.2;
    if (need) {
      a.push(A0 + i);
      i0 = i;
    }
  }
  const half: number[] = [0];
  const heading = (s: SheetState, k: number, i: number) => (k === 0 ? Math.PI / 2 : s.psi[0]) * ramp(i, W0) + s.g[i];
  let j0 = 0;
  for (let j = 1; j <= NB; j++) {
    let need = j - j0 >= 40 || j === NB;
    if (!need) need = states.some((s, k) => Math.abs(heading(s, k, j + 1) - heading(s, k, j0)) > maxTurn);
    if (need) {
      half.push(j);
      j0 = j;
    }
  }
  const b: number[] = [];
  for (let k = half.length - 1; k > 0; k--) b.push(-half[k]);
  for (const v of half) b.push(v);
  return { a, b };
}
