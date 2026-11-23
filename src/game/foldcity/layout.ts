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
const landmarkModels = MODELS.map((m, i) => (m.kind === 'landmark' ? i : -1)).filter((i) => i >= 0);
const courtModel = MODELS.findIndex((m) => m.kind === 'court');

/** Footprint of a model after scaling, along the sheet's u and v for the given orientation. */
export function footprint(m: ModelInfo, scale: number, swap: boolean): [number, number] {
  return swap ? [m.d * scale, m.w * scale] : [m.w * scale, m.d * scale];
}

/**
 * Fill the blocks. A plain block holds a row building against each long side (a courtyard between), or one court
 * building; a landmark block holds one tall building in the middle; plazas and parks stay open. Buildings are kept
 * apart from the street by the pavement; whether they also fit the surface is decided later, in 3D.
 */
export function layoutLots(lat: Lattice, seed: number, scaleBase = 1): Lot[] {
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
      // buildings run along the longer side most of the time
      const alongU = W >= H ? r() < 0.88 : r() < 0.12;
      const L = alongU ? W : H;
      const D = alongU ? H : W;
      const put = (model: number, scale: number, sy: number, along: number, across: number) => {
        const flip = r() < 0.5;
        lots.push({
          model, swap: !alongU, flip, scale, sy,
          u: alongU ? ua + along : ua + across,
          v: alongU ? va + across : va + along,
          cell: idx,
        });
      };
      const fit = (mi: number, maxScale: number, slackAlong = 2, slackAcross = 2) => {
        const m = MODELS[mi];
        return Math.min(maxScale, (L - slackAlong) / m.w, (D - slackAcross) / m.d);
      };
      if (cell.type === BLOCK_LANDMARK) {
        const k = pickWeighted(landmarkModels.map((mi) => MODELS[mi].weight), r());
        let mi = landmarkModels[k];
        if (mi === lastRow) mi = landmarkModels[(k + 1) % landmarkModels.length];
        const s = fit(mi, 1.12 * scaleBase);
        if (s >= 0.7 * scaleBase) {
          put(mi, s * (0.96 + r() * 0.08), 1, L / 2, D / 2);
          lastRow = mi;
          continue;
        }
      }
      const m0 = pickWeighted(rowModels.map((mi) => MODELS[mi].weight), r());
      const wantCourt = D >= MODELS[courtModel].d * 0.95 && L >= MODELS[courtModel].w * 0.9 && r() < 0.4;
      if (wantCourt) {
        const s = fit(courtModel, 1.1 * scaleBase);
        put(courtModel, s * (0.95 + r() * 0.07), 0.9 + r() * 0.25, L / 2 + (r() - 0.5) * 2, D / 2);
        continue;
      }
      let mi = rowModels[m0];
      let s1 = fit(mi, (1 + r() * 0.2) * scaleBase);
      if (s1 < 0.72 * scaleBase) {
        mi = rowModels[3]; // the short one
        s1 = fit(mi, scaleBase);
      }
      if (s1 < 0.6 * scaleBase) continue;
      const m1 = MODELS[mi];
      const d1 = m1.d * s1;
      const slack = Math.max(0, L - m1.w * s1);
      put(mi, s1, 0.85 + r() * 0.3, m1.w * s1 * 0.5 + slack * r() * 0.5, d1 / 2 + 0.5);
      // the second row against the other long side, when it fits
      const left = D - d1 - 8;
      if (left > 14) {
        const cand = rowModels.filter((c) => MODELS[c].d * 0.8 <= left);
        if (cand.length) {
          const mj = cand[Math.floor(r() * cand.length)];
          const s2 = Math.min(fit(mj, (0.95 + r() * 0.2) * scaleBase), (left - 0.5) / MODELS[mj].d);
          if (s2 > 0.62 * scaleBase) {
            const sl = Math.max(0, L - MODELS[mj].w * s2);
            put(mj, s2, 0.85 + r() * 0.3, MODELS[mj].w * s2 * 0.5 + sl * r() * 0.5, D - MODELS[mj].d * s2 * 0.5 - 0.5);
          }
        }
      }
    }
  return lots;
}
