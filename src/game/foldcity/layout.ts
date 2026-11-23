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
export const STREET_HW = 7;
export const AVENUE_HW = 11.5;
export const CREASE_HW = 16;
/** The pavement along a block edge, before the lot's yard. */
export const SIDEWALK = 3.4;

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
  /** Extra height factor on top of `scale` (the roofline varies from block to block). */
  sy: number;
  cell: number;
}

const rowModels = MODELS.map((m, i) => (m.kind === 'row' ? i : -1)).filter((i) => i >= 0);
const landmarkAll = MODELS.map((m, i) => (m.kind === 'landmark' ? i : -1)).filter((i) => i >= 0);
/** The studies of variants.ts load city.glb only: they leave out the landmark of cityprops.glb. */
const landmarkCity = landmarkAll.filter((i) => !MODELS[i].props);
const courtModel = MODELS.findIndex((m) => m.kind === 'court');

const propModel = (name: string) => MODELS.findIndex((m) => m.name === name);

/**
 * What stands in the streets and the open blocks: a row of trees with its lamps along every block side that faces an
 * avenue, a row down the middle of each boulevard (a crease's wide avenue), a fountain or a monument in the middle of a
 * plaza and two groves in a park. Each is a `Lot` like a building's (its model is a prop of models.ts); `cell` is the
 * block it belongs to.
 */
export function layoutProps(lat: Lattice, seed: number): Lot[] {
  const r = rng(seed * 59 + 23);
  const row = propModel('tree_row');
  const rowLen = MODELS[row].w;
  const out: Lot[] = [];
  const nu = lat.u.length - 1;
  const nv = lat.v.length - 1;
  const rows = (alongU: boolean, lo: number, hi: number, across: number, cell: number) => {
    const len = hi - lo;
    if (len < 34) return;
    const n = Math.max(1, Math.round(len / 54));
    for (let k = 0; k < n; k++) {
      const scale = Math.min(1.12, Math.max(0.7, (len / n - 3) / rowLen));
      const along = lo + ((k + 0.5) * len) / n;
      out.push({ model: row, swap: !alongU, flip: r() < 0.5, scale, sy: 0.9 + r() * 0.25, u: alongU ? along : across, v: alongU ? across : along, cell });
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
      if (la.avenue) rows(false, va, vb, ua + 0.6, cell);
      if (lb.avenue) rows(false, va, vb, ub - 0.6, cell);
      if (lc.avenue) rows(true, ua, ub, va + 0.6, cell);
      if (ld.avenue) rows(true, ua, ub, vb - 0.6, cell);
      // the boulevard's middle belongs to the block on its far side
      if (la.hw >= CREASE_HW) rows(false, va, vb, la.c, cell);
      if (lc.hw >= CREASE_HW) rows(true, ua, ub, lc.c, cell);
      const cu = (ua + ub) / 2;
      const cv = (va + vb) / 2;
      if (type === BLOCK_PLAZA) {
        const model = propModel(lat.cells[cell].r < 0.5 ? 'fountain' : 'monument');
        out.push({ model, swap: false, flip: false, scale: 1 + r() * 0.25, sy: 1, u: cu, v: cv, cell });
      } else if (type === BLOCK_PARK) {
        const model = propModel('grove');
        const wide = ub - ua >= vb - va;
        for (const side of [-1, 1]) {
          const off = side * (wide ? ub - ua : vb - va) * 0.22;
          out.push({ model, swap: !wide, flip: side > 0, scale: 0.95 + r() * 0.3, sy: 0.9 + r() * 0.3, u: cu + (wide ? off : 0), v: cv + (wide ? 0 : off), cell });
        }
      }
    }
  return out;
}

/** Footprint of a model after scaling, along the sheet's u and v for the given orientation. */
export function footprint(m: ModelInfo, scale: number, swap: boolean): [number, number] {
  return swap ? [m.d * scale, m.w * scale] : [m.w * scale, m.d * scale];
}

/**
 * `acrossAt(u0, u1)` says where the sheet bends too tightly along u for a long house to follow it.
 * Fill the blocks. A plain block holds a row building against each long side (a courtyard between), or one court
 * building; a landmark block holds one tall building in the middle; plazas and parks stay open. Buildings are kept
 * apart from the street by the pavement; whether they also fit the surface is decided later, in 3D.
 */
export function layoutLots(lat: Lattice, seed: number, scaleBase = 1, withProps = false, acrossAt?: (u0: number, u1: number) => boolean): Lot[] {
  const landmarkModels = withProps ? landmarkAll : landmarkCity;
  const r = rng(seed * 101 + 11);
  const lots: Lot[] = [];
  const nu = lat.u.length - 1;
  const nv = lat.v.length - 1;
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
      // A block is built up like a Paris block: a row of houses against each long side with a narrow court between
      // them (or one house with wings round its court where the block is shallow), each scaled to fill its share of
      // the depth, and where the block is long a shorter house across one end. Little of the ground is left to see.
      // houses run along the block's longer side, unless the sheet bends along u here: then they stand across the bend
      const alongU = acrossAt?.(ua, ub) ? false : W >= H;
      const L = alongU ? W : H;
      const D = alongU ? H : W;
      const put = (model: number, scale: number, sy: number, along: number, across: number, turned = false) => {
        lots.push({
          model, swap: alongU ? turned : !turned, flip: r() < 0.5, scale, sy,
          u: alongU ? ua + along : ua + across,
          v: alongU ? va + across : va + along,
          cell: idx,
        });
      };
      const low = rowModels[3];
      /** A house across the block's depth, its side at `along`; returns the length of block it takes. */
      const cap = (along: number, dir: 1 | -1, room: number): number => {
        const m = MODELS[low];
        const s = Math.min(1.12 * scaleBase, (D - 1) / m.w, (room - 0.5) / m.d);
        if (s < 0.62 * scaleBase) return 0;
        put(low, s, 0.8 + r() * 0.45, along + (dir * m.d * s) / 2, D / 2, true);
        return m.d * s + 5;
      };
      if (cell.type === BLOCK_LANDMARK) {
        const k = pickWeighted(landmarkModels.map((mi) => MODELS[mi].weight), r());
        let mi = landmarkModels[k];
        if (mi === lastRow) mi = landmarkModels[(k + 1) % landmarkModels.length];
        const m = MODELS[mi];
        const s = Math.min(1.12 * scaleBase, (L - 2) / m.w, (D - 2) / m.d);
        if (s >= 0.7 * scaleBase) {
          put(mi, s * (0.96 + r() * 0.08), 1, L / 2, D / 2);
          lastRow = mi;
          // houses beside it where the block runs on
          const room = (L - m.w * s * 1.04) / 2 - 4;
          if (room > 13) {
            cap(0.25, 1, room);
            cap(L - 0.25, -1, room);
          }
          continue;
        }
      }
      // the end house first, then the rows share what is left of the length
      let from = 0;
      let to = L;
      if (L > 66 * scaleBase * 0.8) {
        if (r() < 0.5) from = cap(0.25, 1, L - 40);
        else to = L - cap(L - 0.25, -1, L - 40);
      }
      const span = to - from;
      const mid = (from + to) / 2;
      const height = () => (r() < 0.12 ? 1.3 + r() * 0.2 : 0.8 + r() * 0.42);
      const row = (across0: number, side: 1 | -1, depth: number) => {
        const mi = rowModels[pickWeighted(rowModels.map((c) => MODELS[c].weight), r())];
        const m = MODELS[mi];
        const s = Math.min(1.24 * scaleBase, (span - 1) / m.w, depth / m.d);
        if (s < 0.6 * scaleBase) return;
        const slack = Math.max(0, span - m.w * s);
        put(mi, s, height(), mid + (r() - 0.5) * slack * 0.8, across0 + (side * m.d * s) / 2);
      };
      if (span < 20) continue;
      if (D >= 43) {
        const depth = (D - 6.5 - 0.6) / 2;
        row(0.3, 1, depth);
        row(D - 0.3, -1, depth);
      } else if (D >= 29 && span >= 34) {
        const m = MODELS[courtModel];
        const s = Math.min(1.3 * scaleBase, (span - 1) / m.w, (D - 0.6) / m.d);
        if (s >= 0.6 * scaleBase) put(courtModel, s, height(), mid, D / 2);
      } else row(0.3, 1, D - 0.6);
    }
  return lots;
}
