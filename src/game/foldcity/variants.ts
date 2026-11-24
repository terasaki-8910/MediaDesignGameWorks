// The folded-city variants (?city=<name>): each is one or more surfaces the street sheet is mapped onto, and the numbers
// that fit them to the play area. World frame: the play axis runs +X, up is +Y, the play volume is PLAY (plan.ts),
// centre (5, 5, -7.5). Cross-sections are drawn with the interior (the play area) on the left of the path.
import { latticeFrom, lines, type Lattice, type Line } from './layout.ts';
import { rng } from './rng.ts';
import { byCurvature, extruded, filleted, lengthTo, Profile, superellipse, type Surface } from './surfaces.ts';
import type { AtmosphereParams } from './atmosphere.ts';

/** One sheet of a variant; `lattice` is given when several sheets must share their street lines (the corner variant). */
export interface FaceDef {
  surface: Surface;
  lattice?: Lattice;
}

export interface VariantDef {
  name: string;
  label: string;
  /** One line for the review sheet. */
  summary: string;
  make(): FaceDef[];
  /** Nominal block pitch along u and v (metres): streets, avenues and the blocks between them. */
  pitch: [number, number];
  /** Scale of the buildings (1 = the model's own size). */
  scale: number;
  /** Buildings are laid out up to this distance from the play area; beyond it the haze has taken everything. */
  reach: number;
  /** Overrides of the background haze for this variant. */
  atmosphere?: Partial<AtmosphereParams>;
  /** Part of the sheet turns its back to the play area (a scroll): its ground is drawn on both sides, the back as a plain underside. */
  underside?: boolean;
}

const FAR = 1500;
type P2 = [number, number];

/** A filleted path as an extruded surface with its creases (the arcs' middles) as avenues. */
function folded(name: string, corners: P2[], radius: number, axis: 'x' | 'z', origin: number, ref: readonly [number, number]): Surface {
  const mids: number[] = [];
  const pts = filleted(corners, radius, 0.4, mids);
  const prof = new Profile(pts, 0.4, false);
  return extruded(name, prof, axis, origin, [-FAR, FAR], { creaseU: mids.map((i) => lengthTo(pts, i)), ref });
}

/** A closed profile (a tube) around the play area, extruded along z (streets across the view) or x (streets down the view). */
function ring(axis: 'x' | 'z'): FaceDef[] {
  if (axis === 'z') {
    const prof = new Profile(superellipse(5, 12, 330, 130, 2.5), 0.5, true);
    return [{ surface: extruded('ring', prof, 'z', -7.5, [-FAR, FAR], { ref: [0, 0] }) }];
  }
  const prof = new Profile(superellipse(-7.5, 12, 170, 125, 2.4), 0.5, true);
  return [{ surface: extruded('ringx', prof, 'x', 5, [-FAR, FAR], { ref: [0, 0] }) }];
}

/** Ground, a wall of city at +X, then a ceiling back over the play area: right-angle creases like folded paper. */
function fold90(): FaceDef[] {
  const wall = 205;
  const floor = -96;
  const ceil = 104;
  return [{ surface: folded('fold90', [[-FAR, floor], [wall, floor], [wall, ceil], [-FAR, ceil]], 14, 'z', -7.5, [FAR + 5, 0]) }];
}

/**
 * A canyon that opens toward the horizon: the ground rises on both sides into walls of city, and along +X those walls lean
 * back further and further until, at the horizon, the sheet lies flat. Behind the player they stand just past upright. The
 * cross-section is flat ground, a bend of fixed length (so one avenue follows it) and a straight wall at a tilt that depends on x.
 */
function horizon(): FaceDef[] {
  const W0 = 150; // half width of the flat ground
  const BEND = 30; // arc length of each bend
  const tilt = (x: number) => {
    const t = Math.min(1, Math.max(0, (x + 60) / 760));
    return ((98 - 94 * (t * t * (3 - 2 * t))) * Math.PI) / 180;
  };
  const surface: Surface = {
    name: 'horizon',
    uRange: [-1700, 1700],
    vRange: [-FAR, FAR],
    periodic: false,
    creaseU: [-(W0 + BEND / 2), W0 + BEND / 2],
    creaseV: [],
    ref: [0, 0],
    at(u, v, out) {
      const s = Math.abs(u);
      const psi = tilt(v);
      const k = psi / BEND;
      let g: number;
      let h: number;
      if (s <= W0) {
        g = s;
        h = 0;
      } else {
        const t = Math.min(s - W0, BEND);
        const sinKt = Math.sin(k * t);
        g = W0 + sinKt / k;
        h = (1 - Math.cos(k * t)) / k;
        if (s - W0 > BEND) {
          g = W0 + Math.sin(psi) / k + (s - W0 - BEND) * Math.cos(psi);
          h = (1 - Math.cos(psi)) / k + (s - W0 - BEND) * Math.sin(psi);
        }
      }
      return out.set(v, -96 + h, -7.5 + Math.sign(u) * g);
    },
  };
  return [{ surface }];
}

/**
 * A wave along the play axis on the -z side: the ground rises into a wall that curls over like a breaking wave, its lip
 * hanging over the play area. Built from a curvature profile (the curl tightens towards the lip), in two strengths that the
 * surface blends along the wave, so the crest swells and eases every few hundred metres: a smooth distortion, no longer
 * folded paper (it stretches the sheet a little, which the street lattice carries).
 */
function warp(): FaceDef[] {
  // profiles in (z, y): the wave is mirrored to the -z side; heading 0 = -z
  const curl = (k: number) =>
    new Profile(
      byCurvature([-FAR, -96], [
        { len: FAR + 30, k0: 0 },
        { len: 200, k0: 0, k1: k / 150 },
        { len: 260, k0: k / 150, k1: k / 105 },
        { len: 170, k0: k / 105, k1: k / 58 },
        { len: 70, k0: k / 58, k1: k / 24 },
      ]).map((p): P2 => [-p[0], p[1]]),
      0.5,
      false,
    );
  const lo = curl(0.86);
  const hi = curl(1.08);
  const a = { x: 0, y: 0, tx: 0, ty: 0 };
  const b = { x: 0, y: 0, tx: 0, ty: 0 };
  const surface: Surface = {
    name: 'warp',
    uRange: [0, lo.length],
    vRange: [-FAR, FAR],
    periodic: false,
    creaseU: [],
    creaseV: [],
    ref: [FAR, 0],
    at(u, v, out) {
      lo.at(u, a);
      hi.at(u, b);
      const m = 0.5 + 0.5 * Math.sin(v / 300 + 0.9);
      return out.set(5 + v, a.y + (b.y - a.y) * m, a.x + (b.x - a.x) * m);
    },
  };
  return [{ surface }];
}

/**
 * A corner of a room folded round the play area: floor, a wall at +X, a wall at -Z and a ceiling, each its own flat sheet
 * with its own mesh. Their street lines are shared along each axis, so a street crosses every crease and runs round the
 * vertical corner; the corners are three-way cube corners.
 */
function corner(): FaceDef[] {
  const X1 = 215;
  const Z0 = -175;
  const Y0 = -96;
  const Y1 = 134;
  const r = rng(77);
  const lx = lines([-FAR, X1], [], 86, false, r, 4, [false, true]);
  const lz = lines([Z0, FAR], [], 74, false, r, 3, [true, false]);
  const ly = lines([Y0, Y1], [], 76, false, r, 3, [true, true]);
  const L = (a: Line[], b: Line[], seed: number): Lattice => latticeFrom(a, b, seed);
  const plane = (name: string, at: (u: number, v: number) => [number, number, number], u: [number, number], v: [number, number], ref: [number, number]): Surface => ({
    name, uRange: u, vRange: v, periodic: false, creaseU: [], creaseV: [], ref,
    at: (a, b, out) => out.set(...at(a, b)),
  });
  return [
    { surface: plane('floor', (x, z) => [x, Y0, z], [-FAR, X1], [Z0, FAR], [5, -7.5]), lattice: L(lx, lz, 11) },
    { surface: plane('ceiling', (x, z) => [x, Y1, z], [-FAR, X1], [Z0, FAR], [5, -7.5]), lattice: L(lx, lz, 12) },
    { surface: plane('wall+x', (z, y) => [X1, y, z], [Z0, FAR], [Y0, Y1], [-7.5, 5]), lattice: L(lz, ly, 13) },
    { surface: plane('wall-z', (x, y) => [x, y, Z0], [-FAR, X1], [Y0, Y1], [5, 5]), lattice: L(lx, ly, 14) },
  ];
}

export const VARIANTS: Record<string, VariantDef> = {
  fold90: {
    name: 'fold90',
    label: 'fold90',
    summary: 'Right-angle creases: the ground rises into a wall of city that creases again into a ceiling over the play area.',
    make: fold90,
    pitch: [86, 74],
    scale: 1.25,
    reach: 1000,
  },
  ring: {
    name: 'ring',
    label: 'ring',
    summary: 'The sheet curls into a tube around the play area (axis across the view): streets rise ahead and behind and pass overhead.',
    make: () => ring('z'),
    pitch: [86, 74],
    scale: 1.25,
    reach: 1000,
  },
  ringx: {
    name: 'ringx',
    label: 'ring-x',
    summary: 'The same tube with its axis along the play direction: streets run down a tunnel of city.',
    make: () => ring('x'),
    pitch: [80, 70],
    scale: 1.12,
    reach: 1000,
  },
  warp: {
    name: 'warp',
    label: 'warp',
    summary: 'A breaking wave of city along the play axis: the ground rises on one side and rolls over the play area.',
    make: warp,
    underside: true,
    pitch: [86, 74],
    scale: 1.25,
    reach: 1000,
  },
  horizon: {
    name: 'horizon',
    label: 'horizon',
    summary: 'A canyon of city that opens toward the horizon: the walls beside the play area lean back further along the play axis until the sheet lies flat.',
    make: horizon,
    underside: true,
    pitch: [86, 74],
    scale: 1.25,
    reach: 1000,
  },
  corner: {
    name: 'corner',
    label: 'corner',
    summary: 'A room corner folded round the play area: floor, two walls and a ceiling meet at right angles; streets run round every edge.',
    make: corner,
    pitch: [86, 74],
    scale: 1.25,
    reach: 1000,
  },
};

export const VARIANT_NAMES = Object.keys(VARIANTS);
