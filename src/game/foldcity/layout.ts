// The city sheet: a lattice of streets in sheet metres (u, v), the blocks between them, and the lots of buildings in
// each block. It knows nothing of the surface it will be bent onto, except where that surface folds: the street
// lattice puts an avenue on every crease, so a street runs across a fold instead of a building straddling it.
import { MODELS, type ModelInfo } from './models.ts';
import { pickWeighted, rng } from './rng.ts';

export interface Line {
  /** Sheet coordinate of the street's centre line and half its width. */
  c: number;
  hw: number;
  avenue: boolean;
}

export const BLOCK_PLAIN = 0;
export const BLOCK_PLAZA = 1;
export const BLOCK_PARK = 2;
export const BLOCK_LANDMARK = 3;
export type BlockType = 0 | 1 | 2 | 3;

export interface Cell {
  type: BlockType;
  /** A fixed random number per block, for the ground's variation. */
  r: number;
}

export interface Lattice {
  u: Line[];
  v: Line[];
  /** (u.length - 1) x (v.length - 1) blocks, index = i + j * (u.length - 1). */
  cells: Cell[];
}

/** Street half widths: the ordinary street, the avenue every few lines, and a crease (wider, so a fold sits inside it). */
export const STREET_HW = 5;
export const AVENUE_HW = 8.5;
export const CREASE_HW = 16;
/** The pavement along a block edge, before the lot's yard. */
export const SIDEWALK = 2.6;

export interface LatticeSpec {
  uRange: readonly [number, number];
  vRange: readonly [number, number];
  periodic: boolean;
  creaseU: readonly number[];
  creaseV: readonly number[];
  pitchU: number;
  pitchV: number;
  seed: number;
}

/** Positions from `a` to `b` in steps of about `pitch`, each varying a little, ending exactly on `b`. */
function spread(a: number, b: number, pitch: number, r: () => number): number[] {
  const n = Math.max(1, Math.round((b - a) / pitch));
  const w = Array.from({ length: n }, () => 0.82 + r() * 0.4);
  const sum = w.reduce((s, x) => s + x, 0);
  const out = [a];
  let acc = 0;
  for (let i = 0; i < n - 1; i++) {
    acc += w[i];
    out.push(a + ((b - a) * acc) / sum);
  }
  out.push(b);
  return out;
}

export function lines(
  range: readonly [number, number],
  must: readonly number[],
  pitch: number,
  periodic: boolean,
  r: () => number,
  avenueEvery: number,
  endCrease: readonly [boolean, boolean] = [false, false],
): Line[] {
  const stops = [range[0], ...must.filter((m) => m > range[0] + 1 && m < range[1] - 1).sort((a, b) => a - b), range[1]];
  const out: Line[] = [];
  const crease = new Set(must.map((m) => Math.round(m * 100)));
  for (let i = 0; i < stops.length - 1; i++) {
    const seg = spread(stops[i], stops[i + 1], pitch, r);
    seg.forEach((c, k) => {
      if (k === 0 && i > 0) return; // the shared stop
      out.push({ c, hw: STREET_HW, avenue: false });
    });
  }
  out.forEach((l, k) => {
    if (crease.has(Math.round(l.c * 100))) {
      l.hw = CREASE_HW;
      l.avenue = true;
    } else if (k % avenueEvery === 0) {
      l.hw = AVENUE_HW;
      l.avenue = true;
    }
  });
  if (endCrease[0]) Object.assign(out[0], { hw: CREASE_HW, avenue: true });
  if (endCrease[1]) Object.assign(out[out.length - 1], { hw: CREASE_HW, avenue: true });
  // a closed sheet's last line is its first again: the seam lies in a street of its own width on both sides
  if (periodic) {
    out[out.length - 1].hw = out[0].hw;
    out[out.length - 1].avenue = out[0].avenue;
  }
  return out;
}

export function makeLattice(spec: LatticeSpec): Lattice {
  const r = rng(spec.seed * 31 + 7);
  const u = lines(spec.uRange, spec.creaseU, spec.pitchU, spec.periodic, r, 4);
  const v = lines(spec.vRange, spec.creaseV, spec.pitchV, false, r, 3);
  return latticeFrom(u, v, spec.seed);
}

/** The blocks between given street lines: what each is (building block, plaza, park, landmark) is drawn from the seed. */
export function latticeFrom(u: Line[], v: Line[], seed: number): Lattice {
  const nu = u.length - 1;
  const nv = v.length - 1;
  const cells: Cell[] = [];
  const rc = rng(seed * 17 + 3);
  for (let j = 0; j < nv; j++)
    for (let i = 0; i < nu; i++) {
      const k = rc();
      let type: BlockType = k < 0.1 ? BLOCK_PLAZA : k < 0.17 ? BLOCK_PARK : k < 0.36 ? BLOCK_LANDMARK : BLOCK_PLAIN;
      // no two open blocks side by side: a plaza next to a plaza is a field
      const left = i > 0 ? cells[cells.length - 1].type : BLOCK_PLAIN;
      const below = j > 0 ? cells[cells.length - nu].type : BLOCK_PLAIN;
      if ((type === BLOCK_PLAZA || type === BLOCK_PARK) && (left === BLOCK_PLAZA || left === BLOCK_PARK || below === BLOCK_PLAZA || below === BLOCK_PARK)) type = BLOCK_PLAIN;
      cells.push({ type, r: rc() });
    }
  return { u, v, cells };
}

/** One building to stand in a block. Footprints are in sheet metres; (u, v) is the footprint's centre. */
export interface Lot {
  model: number;
  u: number;
  v: number;
  /** The model's X runs along v instead of u. */
  swap: boolean;
  /** Turned half a turn (the front towards the other side). */
  flip: boolean;
  scale: number;
  /** Length factor along the model's X on top of `scale` (a house is stretched to fill its place); 1 when absent. */
  stretch?: number;
  /** Extra height factor on top of `scale` (the roofline varies from block to block). */
  sy: number;
  cell: number;
}

const rowModels = MODELS.map((m, i) => (m.kind === 'row' ? i : -1)).filter((i) => i >= 0);
const landmarkAll = MODELS.map((m, i) => (m.kind === 'landmark' ? i : -1)).filter((i) => i >= 0);
/** The studies of variants.ts load city.glb only: they leave out the landmark of cityprops.glb. */
const landmarkCity = landmarkAll.filter((i) => !MODELS[i].props);
const shortModel = MODELS.findIndex((m) => m.name === 'haussmann_short');
const treeModels = MODELS.map((m, i) => (m.name.startsWith('tree_') ? i : -1)).filter((i) => i >= 0);

const propModel = (name: string) => MODELS.findIndex((m) => m.name === name);

/** Trees stand this far apart along a kerb, and this far out from it (in the roadway's edge, clear of the fronts). */
const TREE_PITCH = 12.5;
const TREE_OUT = 2.2;

/**
 * What stands in the streets and the open blocks: plane trees one by one along both kerbs of every avenue and boulevard
 * (each its own variant, size and turn, a little out of line), a loose stand of them in a park, and a fountain or a
 * monument in the middle of a plaza. Each is a `Lot` like a building's (its model is a prop of models.ts); `cell` is the
 * block it belongs to.
 */
export function layoutProps(lat: Lattice, seed: number): Lot[] {
  const r = rng(seed * 59 + 23);
  const out: Lot[] = [];
  const nu = lat.u.length - 1;
  const nv = lat.v.length - 1;
  const tree = (u: number, v: number, cell: number, size = 1) => {
    out.push({ model: treeModels[Math.floor(r() * treeModels.length)], swap: r() < 0.5, flip: r() < 0.5, scale: size * (0.78 + r() * 0.44), sy: 0.9 + r() * 0.25, u, v, cell });
  };
  const kerb = (alongU: boolean, lo: number, hi: number, across: number, cell: number) => {
    const n = Math.floor((hi - lo - 6) / TREE_PITCH);
    for (let k = 0; k <= n; k++) {
      if (r() < 0.12) continue; // a gap in the row
      const along = lo + 3 + (n > 0 ? ((hi - lo - 6) * k) / n : (hi - lo - 6) / 2) + (r() - 0.5) * 2.4;
      const off = across + (r() - 0.5) * 0.8;
      tree(alongU ? along : off, alongU ? off : along, cell);
    }
  };
  for (let j = 0; j < nv; j++)
    for (let i = 0; i < nu; i++) {
      const cell = i + j * nu;
      const type = lat.cells[cell].type;
      const [la, lb, lc, ld] = [lat.u[i], lat.u[i + 1], lat.v[j], lat.v[j + 1]];
      const [ua, ub, va, vb] = [la.c + la.hw, lb.c - lb.hw, lc.c + lc.hw, ld.c - ld.hw];
      if (ub - ua < 20 || vb - va < 20) continue;
      // along the kerb of each side that faces an avenue (the row runs along the other coordinate)
      if (la.avenue) kerb(false, va, vb, ua - TREE_OUT, cell);
      if (lb.avenue) kerb(false, va, vb, ub + TREE_OUT, cell);
      if (lc.avenue) kerb(true, ua, ub, va - TREE_OUT, cell);
      if (ld.avenue) kerb(true, ua, ub, vb + TREE_OUT, cell);
      const cu = (ua + ub) / 2;
      const cv = (va + vb) / 2;
      if (type === BLOCK_PLAZA) {
        const model = propModel(lat.cells[cell].r < 0.5 ? 'fountain' : 'monument');
        out.push({ model, swap: false, flip: false, scale: 1 + r() * 0.25, sy: 1, u: cu, v: cv, cell });
      } else if (type === BLOCK_PARK) {
        // a stand of trees: more of them near the rim, the lawn open in the middle
        const n = Math.round(((ub - ua) * (vb - va)) / 260);
        for (let k = 0; k < n; k++) {
          const x = r() * 2 - 1;
          const y = r() * 2 - 1;
          if (Math.max(Math.abs(x), Math.abs(y)) < 0.35 && r() < 0.7) continue;
          tree(cu + x * ((ub - ua) / 2 - 5), cv + y * ((vb - va) / 2 - 5), cell, 1.08);
        }
      }
    }
  return out;
}

/** Footprint of a model after scaling, along the sheet's u and v for the given orientation; `stretch` lengthens it along its own X. */
export function footprint(m: ModelInfo, scale: number, swap: boolean, stretch = 1): [number, number] {
  return swap ? [m.d * scale, m.w * scale * stretch] : [m.w * scale * stretch, m.d * scale];
}

/** A house may be stretched along its length by this much either way: its window bays widen or narrow with it. */
const STRETCH: readonly [number, number] = [0.8, 1.28];
/** A row house is at most this large (times the city's scale), and a house across a block's end is this deep. */
const MAX_SCALE = 1.14;
const END_DEPTH = 15.5;
/** The court between two rows of a block. */
const COURT = 4.2;
const COURT_CURLED = 9;
/** Houses of one block stand this far apart (the plan wants 2.4 m between any two boxes). */
const ALLEY = 3.2;

/**
 * `curled(v0, v1)` says where the sheet curls too tightly across v for a long house to lie across it: there every house
 * runs along u, and no deep landmark stands. `lowAt(v0, v1)` says where a block lies against a crease: its houses are low,
 * so the two sides of the fold do not reach into each other.
 *
 * Fill the blocks like a Paris block: houses along the whole of each long side, their fronts on the pavement, a narrow
 * court between the two rows, and a house across each end where the block is long enough, so the court is closed and
 * every side of the block is a street front. Each house is stretched along its length to fill its place. A landmark
 * block holds one tall building with houses across its ends; plazas and parks stay open. Whether a house also fits the
 * surface is decided later, in 3D.
 */
export function layoutLots(
  lat: Lattice, seed: number, scaleBase = 1, withProps = false, curled?: (v0: number, v1: number) => boolean, lowAt?: (v0: number, v1: number) => boolean,
): Lot[] {
  const landmarkModels = withProps ? landmarkAll : landmarkCity;
  const r = rng(seed * 101 + 11);
  const lots: Lot[] = [];
  const nu = lat.u.length - 1;
  const nv = lat.v.length - 1;
  let lastLandmark = -1;
  let lastRow = -1;
  for (let j = 0; j < nv; j++)
    for (let i = 0; i < nu; i++) {
      const idx = i + j * nu;
      const cell = lat.cells[idx];
      if (cell.type === BLOCK_PLAZA || cell.type === BLOCK_PARK) continue;
      const ua = lat.u[i].c + lat.u[i].hw + SIDEWALK;
      const ub = lat.u[i + 1].c - lat.u[i + 1].hw - SIDEWALK;
      const va = lat.v[j].c + lat.v[j].hw + SIDEWALK;
      const vb = lat.v[j + 1].c - lat.v[j + 1].hw - SIDEWALK;
      const W = ub - ua;
      const H = vb - va;
      if (W < 16 || H < 16) continue;
      // houses run along the block's longer side, unless the sheet curls across v here: then they lie along the curl's axis
      const curl = curled?.(va, vb) ?? false;
      const low = lowAt?.(lat.v[j].c, lat.v[j + 1].c) ?? false;
      const alongU = curl || W >= H;
      const L = alongU ? W : H;
      const D = alongU ? H : W;
      const put = (model: number, scale: number, stretch: number, sy: number, along: number, across: number, turned = false) => {
        lots.push({
          model, swap: alongU ? turned : !turned, flip: r() < 0.5, scale, stretch, sy,
          u: alongU ? ua + along : ua + across,
          v: alongU ? va + across : va + along,
          cell: idx,
        });
      };
      const height = () => (low ? 0.55 + r() * 0.2 : curl ? 0.7 + r() * 0.3 : r() < 0.14 ? 1.25 + r() * 0.25 : 0.78 + r() * 0.44);
      /** The row model whose length, at this scale, comes nearest to `len` (never the one just used); returns [model, stretch]. */
      const fit = (len: number, scale: number): [number, number] => {
        let best = rowModels[0];
        let err = Infinity;
        for (const mi of rowModels) {
          const e = Math.abs(Math.log(len / (MODELS[mi].w * scale))) + (mi === lastRow ? 0.25 : 0) + r() * 0.2 - 0.07 * MODELS[mi].weight;
          if (e < err) [best, err] = [mi, e];
        }
        lastRow = best;
        return [best, Math.min(STRETCH[1], Math.max(STRETCH[0], len / (MODELS[best].w * scale)))];
      };
      /**
       * Houses end to end from `from` to `to`, `depth` deep, their fronts at `front` on side `side`. They run along the
       * block's length, or (`turned`) across its depth at one end; returns how many were placed.
       */
      const row = (from: number, to: number, front: number, side: 1 | -1, depth: number, turned = false): number => {
        const span = to - from;
        const scale = Math.min(MAX_SCALE * scaleBase, depth / 17.2);
        if (span < 21.6 * scale * STRETCH[0] || scale < 0.6 * scaleBase) return 0;
        const n = Math.max(1, Math.ceil((span + ALLEY) / (45.2 * scale * 1.2 + ALLEY)));
        const len = (span - ALLEY * (n - 1)) / n;
        for (let k = 0; k < n; k++) {
          let [mi] = fit(len, scale);
          // a house never overhangs its place: the short one where the fitted one cannot narrow enough, smaller if it must
          if (len / (MODELS[mi].w * Math.min(scale, depth / MODELS[mi].d)) < STRETCH[0]) mi = shortModel;
          const m = MODELS[mi];
          const s = Math.min(scale, depth / m.d, len / (m.w * STRETCH[0]));
          const stretch = Math.min(STRETCH[1], Math.max(STRETCH[0], len / (m.w * s)));
          const mid = from + (len + ALLEY) * k + len / 2;
          const off = front + (side * m.d * s) / 2;
          if (turned) put(mi, s, stretch, height(), off, mid, true);
          else put(mi, s, stretch, height(), mid, off);
        }
        return n;
      };
      /** A row across the block's depth at one end (`dir` = 1: the low end); returns the length of block it takes, with its alley. */
      const cap = (along: number, dir: 1 | -1, room: number): number => {
        if (curl) return 0;
        const depth = Math.min(END_DEPTH * scaleBase, room);
        return row(0.2, D - 0.2, along, dir, depth, true) ? Math.min(MAX_SCALE * scaleBase, depth / 17.2) * 19.2 + ALLEY : 0;
      };
      if (cell.type === BLOCK_LANDMARK && !curl && !low) {
        const k = pickWeighted(landmarkModels.map((mi) => MODELS[mi].weight), r());
        let mi = landmarkModels[k];
        if (mi === lastLandmark) mi = landmarkModels[(k + 1) % landmarkModels.length];
        const m = MODELS[mi];
        const s = Math.min(1.12 * scaleBase, (L - 2) / m.w, (D - 2) / m.d);
        if (s >= 0.7 * scaleBase) {
          put(mi, s * (0.96 + r() * 0.08), 1, 1, L / 2, D / 2);
          lastLandmark = mi;
          // houses beside it where the block runs on
          const room = (L - m.w * s * 1.04) / 2 - 4;
          if (room > 13) {
            cap(0.2, 1, room);
            cap(L - 0.2, -1, room);
          }
          continue;
        }
      }
      // a shallow block is one row; a deeper one has a row on each long side, a court between, and its ends closed
      if (D < 32) {
        row(0.2, L - 0.2, 0.2, 1, D - 0.4);
        continue;
      }
      let from = 0.2;
      let to = L - 0.2;
      // rows of houses across the depth, narrow courts between them: on a curl they are shallower, to follow it
      const deepest = 17.2 * (curl ? 0.92 : MAX_SCALE) * scaleBase;
      const shallowest = 17.2 * 0.64 * scaleBase;
      // on a curl the rooflines of two rows lean towards each other: the court between them is wider
      const court = curl ? COURT_CURLED : COURT;
      const rows = Math.max(1, Math.min(Math.max(2, Math.ceil((D - 0.4 + court) / (deepest + court))), Math.floor((D - 0.4 + court) / (shallowest + court))));
      const depth = (D - 0.4 - court * (rows - 1)) / rows;
      // the rows keep at least a short house's length between the ends
      const least = 24 * Math.min(MAX_SCALE * scaleBase, depth / 17.2);
      const end = 19.2 * (END_DEPTH / 17.2) * scaleBase + ALLEY;
      if (L - end >= least) from += cap(0.2, 1, END_DEPTH * scaleBase);
      if (L - 2 * end >= least) to -= cap(L - 0.2, -1, END_DEPTH * scaleBase);
      for (let k = 0; k < rows; k++) {
        if (k < rows - 1) row(from, to, 0.2 + (depth + court) * k, 1, depth);
        else row(from, to, D - 0.2, -1, depth);
      }
    }
  return lots;
}
