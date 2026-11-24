// The cast shadows of the city. First the height of everything that stands on the sheet, as a map in sheet coordinates
// (one byte a cell of CELL metres, half a metre of height a step), drawn from each model's own outline (a coarse height
// field of its mesh), so a tower throws a tower's shadow and a courtyard stays open. Then, from it, the shadows themselves
// (castShadows): one map per structure, since the key light's direction along the sheet and the buildings that stand
// differ between them. The ground's shader reads two of those maps and blends them through a fold (ground.ts).
import * as THREE from 'three';
import { MODELS } from './models.ts';
import type { MorphBuilding } from './morphplan.ts';
import { A0, A1, B0, B1 } from './sheet.ts';

/** Metres a cell of the maps covers: 1450 x 1300 cells, 1.9 MB a map. */
export const CELL = 2;
/** Metres of height one step of the byte stands for. */
export const HEIGHT_STEP = 0.5;
/** Cells along each side of a model's own height field. */
const GRID = 24;

export const MAP_WIDTH = Math.ceil((A1 - A0) / CELL);
export const MAP_HEIGHT = Math.ceil((B1 - B0) / CELL);

export interface ModelHeights {
  /** The model's bounds in its own frame (X along, Z across), and the height of its mesh over a GRID x GRID lattice of them. */
  x0: number;
  z0: number;
  dx: number;
  dz: number;
  h: Float32Array;
}

/** A model's height field: the highest point of its mesh over each cell of its footprint. */
export function modelHeights(geometry: THREE.BufferGeometry): ModelHeights {
  const pos = geometry.getAttribute('position');
  const index = geometry.index!;
  geometry.computeBoundingBox();
  const bb = geometry.boundingBox!;
  const x0 = bb.min.x;
  const z0 = bb.min.z;
  const dx = Math.max(bb.max.x - x0, 1e-3) / GRID;
  const dz = Math.max(bb.max.z - z0, 1e-3) / GRID;
  const h = new Float32Array(GRID * GRID);
  for (let t = 0; t < index.count; t += 3) {
    const ia = index.getX(t);
    const ib = index.getX(t + 1);
    const ic = index.getX(t + 2);
    const ax = pos.getX(ia), ay = pos.getY(ia), az = pos.getZ(ia);
    const bx = pos.getX(ib), by = pos.getY(ib), bz = pos.getZ(ib);
    const cx = pos.getX(ic), cy = pos.getY(ic), cz = pos.getZ(ic);
    const det = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
    const i0 = Math.max(0, Math.floor((Math.min(ax, bx, cx) - x0) / dx));
    const i1 = Math.min(GRID - 1, Math.floor((Math.max(ax, bx, cx) - x0) / dx));
    const j0 = Math.max(0, Math.floor((Math.min(az, bz, cz) - z0) / dz));
    const j1 = Math.min(GRID - 1, Math.floor((Math.max(az, bz, cz) - z0) / dz));
    if (Math.abs(det) < 1e-9) {
      // an upright face: it reaches its own height along its foot
      const top = Math.max(ay, by, cy);
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) if (i1 - i0 < 2 || j1 - j0 < 2) h[j * GRID + i] = Math.max(h[j * GRID + i], top);
      continue;
    }
    for (let j = j0; j <= j1; j++)
      for (let i = i0; i <= i1; i++) {
        const px = x0 + (i + 0.5) * dx;
        const pz = z0 + (j + 0.5) * dz;
        const wa = ((bz - cz) * (px - cx) + (cx - bx) * (pz - cz)) / det;
        const wb = ((cz - az) * (px - cx) + (ax - cx) * (pz - cz)) / det;
        const wc = 1 - wa - wb;
        if (wa < -0.02 || wb < -0.02 || wc < -0.02) continue;
        const y = wa * ay + wb * by + wc * cy;
        if (y > h[j * GRID + i]) h[j * GRID + i] = y;
      }
  }
  return { x0, z0, dx, dz, h };
}

/** What stands in a building's box instead of its model: a mesh's height field, its factors along the box's three axes, its own centre, and a half turn. */
export interface ShadowFit {
  mh: ModelHeights;
  kx: number;
  ky: number;
  kz: number;
  cx: number;
  cz: number;
  turn: boolean;
}

/**
 * Draw the heights of the buildings that stand in structure `si` into `data` (MAP_WIDTH x MAP_HEIGHT bytes, rows along b).
 * `fit` gives the mesh that stands in a building's box where it is not the model's own (the textured units: morphcity.ts).
 */
export function bakeHeights(
  data: Uint8Array, models: ReadonlyMap<number, ModelHeights>, buildings: readonly MorphBuilding[], si: number, sinkExtra: number,
  fit?: (b: MorphBuilding, si: number) => ShadowFit | undefined,
) {
  const w = MAP_WIDTH;
  data.fill(0);
  for (const b of buildings) {
    if (!b.alive[si]) continue;
    const own = fit?.(b, si);
    const mh = own?.mh ?? models.get(b.model);
    if (!mh) continue;
    const m = MODELS[b.model];
    const lot = b.lot;
    const s = lot.scale;
    const sx = s * (lot.stretch ?? 1);
    const c = (lot.flip ? -1 : 1) * (own?.turn ? -1 : 1);
    const sy = s * b.sy[si] * (own?.ky ?? 1);
    const kx = own?.kx ?? 1;
    const kz = own?.kz ?? 1;
    const cx = own ? own.cx : m.cx;
    const cz = own ? own.cz : m.cz;
    const drop = b.sink[si] + sinkExtra;
    // the footprint's reach along a and b (the model's X runs along b when swapped)
    const ru = (lot.swap ? m.d * s : m.w * sx) / 2 + CELL;
    const rv = (lot.swap ? m.w * sx : m.d * s) / 2 + CELL;
    const i0 = Math.max(0, Math.floor((lot.u - ru - A0) / CELL));
    const i1 = Math.min(w - 1, Math.ceil((lot.u + ru - A0) / CELL));
    const j0 = Math.max(0, Math.floor((lot.v - rv - B0) / CELL));
    const j1 = Math.min(MAP_HEIGHT - 1, Math.ceil((lot.v + rv - B0) / CELL));
    for (let j = j0; j <= j1; j++)
      for (let i = i0; i <= i1; i++) {
        const da = A0 + (i + 0.5) * CELL - lot.u;
        const db = B0 + (j + 0.5) * CELL - lot.v;
        // morphcity.ts, write(): x = c * (swap ? ev : eu), z = x cross n
        const mx = cx + (c * (lot.swap ? db : da)) / (sx * kx);
        const mz = cz + (lot.swap ? -c * da : c * db) / (s * kz);
        const gi = Math.floor((mx - mh.x0) / mh.dx);
        const gj = Math.floor((mz - mh.z0) / mh.dz);
        if (gi < 0 || gj < 0 || gi >= GRID || gj >= GRID) continue;
        const y = mh.h[gj * GRID + gi] * sy - drop;
        const v = Math.min(255, Math.round(y / HEIGHT_STEP));
        if (v > data[j * w + i]) data[j * w + i] = v;
      }
  }
}

export interface CastLight {
  /** tan of the key light's elevation above the sheet. */
  slope: number;
  /** The world's direction towards the sun (unit): the key's direction along the sheet is its projection onto the sheet there. */
  sun: { x: number; y: number; z: number };
}

/**
 * The shadows the heights of `heights` cast on the sheet in one structure, into `out`: a byte a cell, 255 = all of the key
 * light taken away. From every cell the height map is walked towards the key light (the sun projected onto the sheet
 * there: atmosphere.ts, bgLight) in steps that lengthen a little; a thing casts if it stands higher than the ray is
 * there, and the shadow's edge softens with the distance from the thing that casts it. `heading(a, |b|)` is the sheet's
 * heading in the structure; only cells with a in `reach` and |b| up to `maxB` are worked out. A generator: it yields
 * after every `rows` rows, so the game can spread the work over frames (a whole map is some tens of millions of steps).
 */
export function* castShadows(
  heights: Uint8Array, out: Uint8Array, heading: (a: number, d: number) => number, light: CastLight, reach: readonly [number, number], maxB: number, rows = 16,
): Generator<void, void> {
  const w = MAP_WIDTH;
  const hgt = MAP_HEIGHT;
  out.fill(0);
  let top = 0;
  for (let k = 0; k < heights.length; k++) if (heights[k] > top) top = heights[k];
  const tEnd = Math.min(260, (top * HEIGHT_STEP) / light.slope);
  const i0 = Math.max(0, Math.floor((reach[0] - A0) / CELL));
  const i1 = Math.min(w - 1, Math.ceil((reach[1] - A0) / CELL));
  for (let j = 0; j < hgt; j++) {
    const b = B0 + (j + 0.5) * CELL;
    if (Math.abs(b) <= maxB) {
      const sg = b < 0 ? -1 : 1;
      let lastA = Infinity;
      let da = 0;
      let db = 0;
      for (let i = i0; i <= i1; i++) {
        const a = A0 + (i + 0.5) * CELL;
        // the heading changes slowly along a (the canyon's walls lean back): every 16 m is enough
        if (Math.abs(a - lastA) >= 16) {
          const phi = heading(a, Math.abs(b));
          const kb = light.sun.y * Math.sin(phi) * sg + light.sun.z * Math.cos(phi);
          const l = Math.hypot(light.sun.x, kb) || 1;
          da = light.sun.x / l / CELL;
          db = kb / l / CELL;
          lastA = a;
        }
        // (under a building the ground is not seen: no walk)
        if (heights[j * w + i] > 6) {
          out[j * w + i] = 255;
          continue;
        }
        let sh = 0;
        for (let t = 2; t < tEnd; t += 2.6 + 0.045 * t) {
          const x = Math.floor(i + 0.5 + da * t);
          const y = Math.floor(j + 0.5 + db * t);
          if (x < 0 || y < 0 || x >= w || y >= hgt) break;
          const over = heights[y * w + x] * HEIGHT_STEP - t * light.slope;
          if (over <= 0) continue;
          const s = over / (1 + 0.05 * t);
          if (s > sh) {
            sh = s;
            if (sh >= 1) break;
          }
        }
        if (sh > 0) {
          const k = Math.min(1, sh);
          out[j * w + i] = Math.round(255 * k * k * (3 - 2 * k));
        }
      }
    }
    if (j % rows === rows - 1) yield;
  }
}

/** A texture for one shadow map: one byte a cell, filtered. */
export function shadowTexture(): THREE.DataTexture {
  const texture = new THREE.DataTexture(new Uint8Array(MAP_WIDTH * MAP_HEIGHT), MAP_WIDTH, MAP_HEIGHT, THREE.RedFormat, THREE.UnsignedByteType);
  texture.minFilter = texture.magFilter = THREE.LinearFilter;
  texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.generateMipmaps = false;
  texture.unpackAlignment = 1;
  texture.needsUpdate = true;
  return texture;
}
