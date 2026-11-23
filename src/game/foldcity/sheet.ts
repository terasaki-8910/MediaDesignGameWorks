// One sheet of city for the whole game. Every section's structure (the canyon, the right-angle fold, the ring) is the same
// street sheet bent differently, so the city can fold from one into the next with every building riding along.
//
// Sheet coordinates: `a` runs along the play axis (world +X when the sheet lies flat), `b` across it (world +Z), in metres.
// A state bends the sheet in two steps, both true paper folds (lengths on the sheet stay lengths in the world):
//   1. a profile in the X-Y plane, given by its heading along `a` (0 = flat ground towards +X, 90 degrees = a wall, 180 =
//      a ceiling running back): the fold90 wall and ceiling, and the closed curve of the ring;
//   2. a fold along the two lines b = +-(W0 .. W0 + BEND), by a tilt that may change along `a`: the canyon's walls.
// A transition interpolates the headings and the tilts, never positions, so nothing stretches on the way.
import * as THREE from 'three';
import { filleted, lengthTo, Profile, superellipse, type Surface } from './surfaces.ts';

export type StructureName = 'horizon' | 'fold90' | 'ring';
export const STRUCTURES: readonly StructureName[] = ['horizon', 'fold90', 'ring'];

/** World position of sheet point (0, 0) when the sheet lies flat: below the play area. */
export const GROUND_Y = -96;
export const Z0 = -7.5;
/** The canyon's cross-section: flat ground this far each side, then a bend of this arc length, then a straight wall. */
export const W0 = 150;
export const BEND = 30;

// the approved shapes (variants.ts): fold90's creased profile and the ring's superellipse
const FAR = 1500;
const F90_MIDS: number[] = [];
const F90_POINTS = filleted([[-FAR, GROUND_Y], [205, GROUND_Y], [205, 104], [-FAR, 104]], 14, 0.4, F90_MIDS);
const F90 = new Profile(F90_POINTS, 0.4, false);
const RING = new Profile(superellipse(5, 12, 330, 130, 2.5), 0.5, true);
/** The ring's lowest point is sheet point a = RING_SHIFT (world x = 5), so `a` is world x under the play area in every state. */
const RING_SHIFT = 5;

/** Where the ring closes on the sheet: behind and below the play area. The sheet beyond it (the tail) lies outside the ring. */
export const SEAM = -200;
/** The tail's roll in the ring: its radius at the seam, and how fast the spiral opens (radius grows by 1 / TAIL_OPEN per metre). */
const TAIL_RADIUS = 40;
const TAIL_OPEN = 1.5;
const LID_LEAD = 1.5;
export const RING_LENGTH = RING.length;
/** The sheet: `a` from the far end of the tail to where the ring closes on SEAM again, `b` to both sides. */
export const A0 = SEAM - 1100;
export const A1 = SEAM + RING_LENGTH;
export const B0 = -1300;
export const B1 = 1300;
/** Sheet lines the states fold along: avenues lie on them. */
export const CREASES_A: readonly number[] = [...F90_MIDS.map((i) => lengthTo(F90_POINTS, i) - FAR), SEAM];
export const CREASES_B: readonly number[] = [-(W0 + BEND / 2), W0 + BEND / 2];

const N = Math.round(A1 - A0); // samples about 1 m apart
const DS = (A1 - A0) / N;
export const PROFILE_SAMPLES = N;
export const PROFILE_STEP = DS;
const ANCHOR = Math.round((0 - A0) / DS);

/** A bent sheet: the profile (position and heading) and the canyon tilt at each sample of `a`, and how its ends are shown. */
export interface SheetState {
  px: Float64Array;
  py: Float64Array;
  /** Heading of the profile, radians, continuous along a. */
  th: Float64Array;
  /** Tilt of the canyon walls, radians (0 = the sheet is not folded across b). */
  psi: Float64Array;
  /** 1 = the sheet's far end (a = A1) dissolves into the haze; 0 = it is the ring's seam and stays solid. */
  endFade: number;
  /** 1 = the tail (a < SEAM) is not drawn: the ring is closed and the tail lies outside it. */
  tailCut: number;
}

/**
 * Where the canyon's walls dissolve into the haze. Their tilt changes along the play axis (they lean back towards the
 * horizon), so a wall twists as it rises: `lever * d(tilt)/da` is the tangent of that twist. Past about 35 degrees the
 * wall is seen nearly edge-on or from behind from most of the play area: it fades out between these two values, some
 * 300 to 500 m up, and the canyon stays open to the sky. Below that a camera can still catch a strip of a wall from
 * behind at a grazing angle; the back of the sheet is drawn for that (ground.ts: the city's foundations). Behind the
 * player the walls do not twist and stand to their full height.
 */
export const TWIST_FADE: readonly [number, number] = [0.7, 1.2];

/** How far sheet point (a, b) has dissolved into the haze because of the wall's twist there: 0 solid, 1 gone. */
export function twistVeil(s: SheetState, a: number, b: number): number {
  const u = Math.min(N - 1e-9, Math.max(0, (a - A0) / DS));
  const i = Math.floor(u);
  const twist = (Math.max(0, Math.abs(b) - W0 - BEND / 2) * Math.abs(s.psi[i + 1] - s.psi[i])) / DS;
  return smooth((twist - TWIST_FADE[0]) / (TWIST_FADE[1] - TWIST_FADE[0]));
}

const newState = (): SheetState => ({
  px: new Float64Array(N + 1), py: new Float64Array(N + 1), th: new Float64Array(N + 1), psi: new Float64Array(N + 1), endFade: 1, tailCut: 0,
});

const aOf = (i: number) => A0 + i * DS;
const smooth = (t: number) => {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
};

/** The canyon's tilt along the play axis: just past upright behind the player, lying down towards the horizon. */
const horizonTilt = (a: number) => ((98 - 94 * smooth((a + 60) / 760)) * Math.PI) / 180;

function makeRest(name: StructureName): SheetState {
  const s = newState();
  const t = { x: 0, y: 0, tx: 0, ty: 0 };
  let last = 0;
  for (let i = 0; i <= N; i++) {
    const a = aOf(i);
    let th: number;
    if (name === 'horizon') {
      s.px[i] = a;
      s.py[i] = GROUND_Y;
      th = 0;
      s.psi[i] = horizonTilt(a);
    } else if (name === 'fold90') {
      F90.at(a + FAR, t);
      s.px[i] = t.x;
      s.py[i] = t.y;
      th = Math.atan2(t.ty, t.tx);
    } else {
      RING.at(Math.max(a, SEAM) - RING_SHIFT, t);
      s.px[i] = t.x;
      s.py[i] = t.y;
      // the tail leaves the seam along its tangent and rolls away under the ring like the loose end of a scroll (a spiral
      // that opens, so it never lies on itself): outside the ring, and out of the lid's way while the ring closes
      th = Math.atan2(t.ty, t.tx) + (a < SEAM ? TAIL_OPEN * Math.log(1 + (SEAM - a) / (TAIL_OPEN * TAIL_RADIUS)) : 0);
    }
    // keep the heading continuous (the ring turns through a full circle)
    if (i > 0) while (th - last > Math.PI) th -= 2 * Math.PI;
    if (i > 0) while (th - last < -Math.PI) th += 2 * Math.PI;
    s.th[i] = last = th;
  }
  // headings count from zero at the anchor (flat ground under the play area)
  const turn = Math.round(s.th[ANCHOR] / (2 * Math.PI)) * 2 * Math.PI;
  if (turn !== 0) for (let i = 0; i <= N; i++) s.th[i] -= turn;
  if (name === 'ring') {
    // the tail's positions follow from its headings, back from the seam
    for (let i = Math.floor((SEAM - A0) / DS); i >= 0; i--) {
      const m = (s.th[i] + s.th[i + 1]) / 2;
      s.px[i] = s.px[i + 1] - Math.cos(m) * DS;
      s.py[i] = s.py[i + 1] - Math.sin(m) * DS;
    }
  }
  s.endFade = name === 'ring' ? 0 : 1;
  s.tailCut = name === 'ring' ? 1 : 0;
  return s;
}

/** Positions from headings alone (midpoint rule from the anchor); the exact rest positions differ from this by centimetres. */
function integrate(th: Float64Array, x: Float64Array, y: Float64Array) {
  x[ANCHOR] = 0;
  y[ANCHOR] = 0;
  for (let i = ANCHOR + 1; i <= N; i++) {
    const m = (th[i] + th[i - 1]) / 2;
    x[i] = x[i - 1] + Math.cos(m) * DS;
    y[i] = y[i - 1] + Math.sin(m) * DS;
  }
  for (let i = ANCHOR - 1; i >= 0; i--) {
    const m = (th[i] + th[i + 1]) / 2;
    x[i] = x[i + 1] - Math.cos(m) * DS;
    y[i] = y[i + 1] - Math.sin(m) * DS;
  }
}

interface Rest {
  state: SheetState;
  /** Rest position minus the integral of its own headings: added back in a blend so both ends of a transition are exact. */
  ex: Float64Array;
  ey: Float64Array;
}

const REST = new Map<StructureName, Rest>();
function rest(name: StructureName): Rest {
  let r = REST.get(name);
  if (!r) {
    const state = makeRest(name);
    const ex = new Float64Array(N + 1);
    const ey = new Float64Array(N + 1);
    integrate(state.th, ex, ey);
    for (let i = 0; i <= N; i++) {
      ex[i] = state.px[i] - ex[i];
      ey[i] = state.py[i] - ey[i];
    }
    REST.set(name, (r = { state, ex, ey }));
  }
  return r;
}

/** The sheet at rest in a structure. Shared: do not write to it. */
export const restState = (name: StructureName): SheetState => rest(name).state;

export interface Transition {
  from: StructureName;
  to: StructureName;
}

const IX = new Float64Array(N + 1);
const IY = new Float64Array(N + 1);

/**
 * The sheet a fraction `f` of the way through a transition, written into `out`.
 *
 * horizon -> fold90: the canyon walls lie down first, from the horizon back past the player (a front that travels along the
 * play axis), and the far end rises into the wall and the ceiling behind that front: the two folds never bend the same
 * piece of sheet at once. fold90 -> ring: the headings blend, so the ceiling comes down behind the player as a lid and
 * meets the ground at the seam while the ground under the play area sinks into the ring's floor.
 */
export function blendState(tr: Transition, f: number, out: SheetState): SheetState {
  const A = rest(tr.from);
  const B = rest(tr.to);
  const t = Math.min(1, Math.max(0, f));
  if (t === 0 || t === 1 || tr.from === tr.to) return copyState(t === 1 ? B.state : A.state, out);
  let w: number;
  let front = Infinity; // canyon walls beyond this `a` have lain down
  const canyon = tr.from === 'horizon' ? A.state : tr.to === 'horizon' ? B.state : null;
  if (tr.from === 'horizon' || tr.to === 'horizon') {
    // k runs 0 at the canyon to 1 at the other structure, whichever way the transition goes
    const k = tr.from === 'horizon' ? t : 1 - t;
    // the front passes the far wall's place (a = 200) before that wall starts to rise, and runs on behind the player
    front = k < 0.4 ? 1100 - (1400 * k) / 0.4 : -300 - (1400 * (k - 0.4)) / 0.5;
    w = smooth((k - 0.36) / 0.64);
    if (tr.to === 'horizon') w = 1 - w;
  } else w = smooth(t);
  // the tail rolls away ahead of the ring's closing (and comes back late when the ring opens), measured from the seam's heading
  const ringK = tr.to === 'ring' ? t : tr.from === 'ring' ? 1 - t : -1;
  const wRoll = ringK < 0 ? w : tr.to === 'ring' ? smooth(ringK / 0.45) : 1 - smooth(ringK / 0.45);
  const seam = Math.floor((SEAM - A0) / DS) + 1;
  for (let i = seam; i <= N; i++) out.th[i] = A.state.th[i] + (B.state.th[i] - A.state.th[i]) * w;
  // the lid's last 300 m turn a little ahead of the rest while the ring closes, so its tip comes down onto the seam from
  // above instead of sliding in under the ground beside it
  if (ringK >= 0) for (let i = N - 300; i <= N; i++) out.th[i] += LID_LEAD * w * (1 - w) * smooth((i - (N - 300)) / 300);
  for (let i = 0; i < seam; i++) {
    const ra = A.state.th[i] - A.state.th[seam];
    const rb = B.state.th[i] - B.state.th[seam];
    out.th[i] = out.th[seam] + ra + (rb - ra) * wRoll;
  }
  integrate(out.th, IX, IY);
  const ax = A.state.px[ANCHOR] + (B.state.px[ANCHOR] - A.state.px[ANCHOR]) * w;
  const ay = A.state.py[ANCHOR] + (B.state.py[ANCHOR] - A.state.py[ANCHOR]) * w;
  for (let i = 0; i <= N; i++) {
    // the corrections are relative to each end's own anchor, which the integral starts from
    const cx = (A.ex[i] - A.state.px[ANCHOR]) * (1 - w) + (B.ex[i] - B.state.px[ANCHOR]) * w;
    const cy = (A.ey[i] - A.state.py[ANCHOR]) * (1 - w) + (B.ey[i] - B.state.py[ANCHOR]) * w;
    out.px[i] = ax + IX[i] + cx;
    out.py[i] = ay + IY[i] + cy;
    out.psi[i] = canyon ? canyon.psi[i] * (1 - smooth((aOf(i) - front + 400) / 800)) : 0;
  }
  // the ring's seam comes out of the haze as the lid closes; the tail is cut only once the ring is shut
  out.endFade = 1 - smooth((ringK - 0.35) / 0.6);
  out.tailCut = ringK > 0.82 ? 1 : 0;
  return out;
}

export function copyState(src: SheetState, out: SheetState): SheetState {
  out.px.set(src.px);
  out.py.set(src.py);
  out.th.set(src.th);
  out.psi.set(src.psi);
  out.endFade = src.endFade;
  out.tailCut = src.tailCut;
  return out;
}

export const makeState = (): SheetState => newState();

/** The profile at `a`: position, unit tangent and tilt, interpolated between samples. */
export interface ProfilePoint { x: number; y: number; tx: number; ty: number; psi: number }
export function profileAt(s: SheetState, a: number, out: ProfilePoint): ProfilePoint {
  const u = Math.min(N - 1e-9, Math.max(0, (a - A0) / DS));
  const i = Math.floor(u);
  const k = u - i;
  out.x = s.px[i] + (s.px[i + 1] - s.px[i]) * k;
  out.y = s.py[i] + (s.py[i + 1] - s.py[i]) * k;
  const th = s.th[i] + (s.th[i + 1] - s.th[i]) * k;
  out.tx = Math.cos(th);
  out.ty = Math.sin(th);
  out.psi = s.psi[i] + (s.psi[i + 1] - s.psi[i]) * k;
  // beyond the table the sheet runs on straight
  const over = a < A0 ? a - A0 : a > A1 ? a - A1 : 0;
  out.x += over * out.tx;
  out.y += over * out.ty;
  return out;
}

const PP: ProfilePoint = { x: 0, y: 0, tx: 0, ty: 0, psi: 0 };

/** World position of sheet point (a, b). */
export function sheetAt(s: SheetState, a: number, b: number, out: THREE.Vector3, pp: ProfilePoint = PP): THREE.Vector3 {
  profileAt(s, a, pp);
  return sideAt(pp, b, out);
}

/** The second fold: across b, at a profile point. `g` runs along world Z, `h` along the profile's normal (its left). */
export function sideAt(pp: ProfilePoint, b: number, out: THREE.Vector3): THREE.Vector3 {
  const d = Math.abs(b) - W0;
  let g = Math.abs(b);
  let h = 0;
  if (d > 0 && pp.psi > 1e-5) {
    const k = pp.psi / BEND;
    const t = Math.min(d, BEND);
    g = W0 + Math.sin(k * t) / k;
    h = (1 - Math.cos(k * t)) / k;
    if (d > BEND) {
      g += (d - BEND) * Math.cos(pp.psi);
      h += (d - BEND) * Math.sin(pp.psi);
    }
  }
  return out.set(pp.x - pp.ty * h, pp.y + pp.tx * h, Z0 + (b < 0 ? -g : g));
}

/** A state as a `Surface` (u = a, v = b) for the layout's and the tests' helpers. Its normal sign towards the play area is SHEET_SIGN. */
export function surfaceOf(s: SheetState, name = 'sheet'): Surface {
  const pp: ProfilePoint = { x: 0, y: 0, tx: 0, ty: 0, psi: 0 };
  return {
    name, uRange: [A0, A1], vRange: [B0, B1], periodic: false, creaseU: CREASES_A, creaseV: CREASES_B, ref: [0, 0],
    at: (u, v, out) => sheetAt(s, u, v, out, pp),
  };
}
export const SHEET_SIGN = -1 as const;

/**
 * Does some structure bend the sheet between a0 and a1 more tightly than a 45 m house can follow (its ends would stand
 * off the ground or dig into it)? There the layout turns the houses across the bend.
 */
export function bendsTightly(a0: number, a1: number): boolean {
  const i0 = Math.max(0, Math.floor((a0 - A0) / DS));
  const i1 = Math.min(N, Math.ceil((a1 - A0) / DS));
  return STRUCTURES.some((name) => {
    const th = restState(name).th;
    // the turn over any 45 m of the stretch
    for (let i = i0; i + 45 <= Math.max(i1, i0 + 45) && i + 45 <= N; i += 5) if (Math.abs(th[i + 45] - th[i]) > 0.2) return true;
    return false;
  });
}

/** The grid lines of `a` and `b` the ground mesh is cut along: fine wherever any state bends, coarse on the flats. */
export function sheetGrid(): { a: number[]; b: number[] } {
  const states = STRUCTURES.map(restState);
  const a: number[] = [A0];
  const maxTurn = (3.5 * Math.PI) / 180;
  let i0 = 0;
  for (let i = 1; i <= N; i++) {
    let need = aOf(i) - aOf(i0) >= 36 || i === N;
    // the next sample would turn too far from the last grid line in some state
    if (!need && i < N) need = states.some((s) => Math.abs(s.th[i + 1] - s.th[i0]) > maxTurn);
    // and the canyon's tilt changes along a: keep its twist smooth
    if (!need && i < N) need = Math.abs(states[0].psi[i + 1] - states[0].psi[i0]) > maxTurn * 1.2;
    if (need) {
      a.push(aOf(i));
      i0 = i;
    }
  }
  const b: number[] = [];
  const half: number[] = [0];
  for (let v = 30; v < W0 - 1; v += 30) half.push(v);
  for (let k = 0; k <= 26; k++) half.push(W0 + (BEND * k) / 26);
  for (let v = W0 + BEND + 40; v < B1 - 1; v += 40) half.push(v);
  half.push(B1);
  for (let k = half.length - 1; k > 0; k--) b.push(-half[k]);
  for (const v of half) b.push(v);
  return { a, b };
}
