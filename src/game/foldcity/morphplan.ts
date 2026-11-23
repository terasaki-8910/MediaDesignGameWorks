// The plan of the one city that every structure shares (sheet.ts): one street lattice, one list of lots, and for each lot
// where it stands in each structure and how it gets through each transition. A lot keeps its sheet coordinates for good;
// a structure only decides whether a building can stand there (the sheet is not too bent, it faces the play area, it cuts
// through nothing) and how tall. In a transition a building rides the sheet; one that cannot stand in the next structure
// sinks away before it would touch anything, one that only stands there rises once it can. Pure: no GLB, no DOM.
import * as THREE from 'three';
import { footprint, latticeFrom, layoutLots, layoutProps, lines, type Lattice, type Lot } from './layout.ts';
import { MODEL_INDEX, MODELS } from './models.ts';
import {
  boxObb, cutsSheet, facesPlayArea, GAP, Hash, MAX_BURY, MAX_GAP, MAX_TILT, NEAR_LOD, overlaps, PLAY, PLAY_CENTER, PLAY_MARGIN, SheetPoints, type Obb,
} from './plan.ts';
import { rng } from './rng.ts';
import {
  A0, A1, B0, B1, blendState, CREASE3, CREASES_A, CREASES_B, curlsTightly, makeState, restState, SHEET_SIGN, STRUCTURES, surfaceOf, veilAt, type SheetState, type StructureName,
  type Transition,
} from './sheet.ts';
import { frameAt, makeFrame, type Frame, type Surface } from './surfaces.ts';

/** Block pitch along a and b, and the scale of the buildings. */
export const PITCH: [number, number] = [86, 74];
export const SCALE = 1.25;
/** Buildings stand up to this far from the play area. */
export const REACH = 1000;
/** Trees, lamps and fountains stand only this near: further off they are smaller than a pixel. */
export const PROP_REACH = 540;
/** A building takes this share of a transition to sink away or to rise. */
export const RAMP = 0.18;
/** The fractions of a transition the plan checks (and the tests check again). */
export const SAMPLES = Array.from({ length: 19 }, (_, i) => (i + 1) / 20);

/** How a building gets through a transition: it stands until `fall` (gone by then) and again from `rise` on. */
export interface Presence {
  fall: number;
  rise: number;
}

export interface MorphBuilding {
  lot: Lot;
  model: number;
  /** Street furniture, a plaza's centrepiece or a pier's foot rather than a building: it collides with nothing. */
  prop: boolean;
  /** Per structure (the order of STRUCTURES): does it stand there, its height factor, how far its base is sunk, its level of detail. */
  alive: boolean[];
  sy: number[];
  sink: number[];
  lod: (0 | 1)[];
  /** Per transition (STRUCTURES[i] to STRUCTURES[i + 1]). */
  presence: Presence[];
}

export interface MorphPlan {
  lattice: Lattice;
  buildings: MorphBuilding[];
  stats: { lots: number; standing: number[]; props: number[]; triangles: number[]; dips: number[] };
}

/**
 * A square of sheet (centre and half side) nothing may be built on: the foot of one of the play area's piers. `foot` is the
 * scale of the masonry foot that stands there (the pier comes down into it).
 */
export interface KeepOut { a: number; b: number; r: number; foot: number }

const smooth = (t: number) => {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
};

/** How much of a building stands at fraction `f` of a transition (0 to 1). */
export function presenceAt(p: Presence, f: number): number {
  // a ramp never reaches past either end of the transition: at rest a building stands whole or not at all
  const down = Math.min(RAMP, Math.max(p.fall, 1e-3));
  const up = Math.min(RAMP, Math.max(1 - p.rise, 1e-3));
  return Math.max(p.fall <= 0 ? 0 : 1 - smooth((f - (p.fall - down)) / down), p.rise >= 1 ? 0 : smooth((f - p.rise) / up));
}

const STAY: Presence = { fall: Infinity, rise: -Infinity };
const NONE: Presence = { fall: -Infinity, rise: Infinity };

export function sharedLattice(seed: number): Lattice {
  const r = rng(seed * 31 + 7);
  const a = lines([A0, A1], CREASES_A, PITCH[0], false, r, 4);
  const b = lines([B0, B1], CREASES_B, PITCH[1], false, r, 3);
  return latticeFrom(a, b, seed);
}

/** The surface a structure shows: the sheet beyond the tube's seam is cut away, and where it dissolves nothing stands. */
export function shownSurface(s: SheetState, name: string): Surface {
  const surf = surfaceOf(s, name);
  return { ...surf, vRange: Number.isFinite(s.cut) ? [-s.cut, s.cut] : surf.vRange, veil: (u: number, v: number) => veilAt(s, u, v) } as Surface;
}

/**
 * Does the block between street lines v0 and v1 lie against a crease, or on the walls of the channel's slot? Its houses
 * stay low, clear of the fold's other side and of the sky between the slot's walls.
 */
const byCrease = (v0: number, v1: number) => CREASES_B.some((c) => Math.abs(c - v0) < 1 || Math.abs(c - v1) < 1) || Math.min(Math.abs(v0), Math.abs(v1)) > CREASE3;

/** Trees thin out with distance: all of them stand within 240 m of the play area, one in four at PROP_REACH. */
function treeKept(lot: Lot, d: number): boolean {
  if (!MODELS[lot.model].name.startsWith('tree_')) return true;
  const h = Math.sin(lot.u * 12.9898 + lot.v * 78.233) * 43758.5453;
  return h - Math.floor(h) < 1 - 0.75 * smooth((d - 240) / (PROP_REACH - 240));
}

const T = new THREE.Vector3();
const FC = makeFrame();
const CORNERS = [[-1, -1], [1, -1], [1, 1], [-1, 1], [0, -1], [0, 1], [-1, 0], [1, 0]] as const;

/** Can a lot stand on this surface at all: inside it, facing the play area, the sheet under it flat enough. Returns the sink, or -1. */
function seat(surface: Surface, lot: Lot, f: Frame): number {
  const m = MODELS[lot.model];
  const [fu, fv] = footprint(m, lot.scale, lot.swap, lot.stretch);
  if (lot.u - fu / 2 < surface.uRange[0] || lot.u + fu / 2 > surface.uRange[1]) return -1;
  if (lot.v - fv / 2 < surface.vRange[0] || lot.v + fv / 2 > surface.vRange[1]) return -1;
  // nothing stands where the sheet has begun to dissolve into the haze
  const veil = (surface as Surface & { veil?: (u: number, v: number) => number }).veil;
  if (veil && Math.max(veil(lot.u - fu / 2, lot.v), veil(lot.u + fu / 2, lot.v), veil(lot.u, lot.v - Math.sign(lot.v) * fv / 2), veil(lot.u, lot.v + Math.sign(lot.v) * fv / 2)) > 0.02) return -1;
  frameAt(surface, SHEET_SIGN, lot.u, lot.v, f);
  if (!facesPlayArea(f.p, f.n)) return -1;
  let sink = 0.5;
  for (const [su, sv] of CORNERS) {
    frameAt(surface, SHEET_SIGN, lot.u + (su * fu) / 2, lot.v + (sv * fv) / 2, FC);
    const dev = T.subVectors(FC.p, f.p).dot(f.n);
    if (FC.n.angleTo(f.n) > MAX_TILT || dev > MAX_BURY || -dev > MAX_GAP) return -1;
    sink = Math.max(sink, -dev + 0.5);
  }
  return sink;
}

/** The box of a building of height factor `sy` standing at frame `f`. */
export function boxAt(lot: Lot, f: Frame, sy: number): Obb {
  const m = MODELS[lot.model];
  const x = (lot.swap ? f.ev : f.eu).clone().multiplyScalar(lot.flip ? -1 : 1);
  const z = new THREE.Vector3().crossVectors(x, f.n);
  const H = m.h * lot.scale * sy;
  return { c: f.p.clone().addScaledVector(f.n, H / 2), a: [x, f.n.clone(), z], h: [(m.w * lot.scale * (lot.stretch ?? 1)) / 2, H / 2, (m.d * lot.scale) / 2] };
}

export const PLAY_OBB = boxObb(PLAY.clone().expandByScalar(PLAY_MARGIN));

/**
 * The plan, in steps: each structure, then each sample of each transition. The game runs one step at a time between frames
 * (the whole plan takes about half a second); `planMorph` runs them all at once.
 */
export function* planSteps(seed: number, keepOut: readonly KeepOut[] = []): Generator<void, MorphPlan> {
  const lattice = sharedLattice(seed);
  const clear = (lot: Lot) => {
    const [fu, fv] = footprint(MODELS[lot.model], lot.scale, lot.swap, lot.stretch);
    return !keepOut.some((k) => Math.abs(lot.u - k.a) < fu / 2 + k.r && Math.abs(lot.v - k.b) < fv / 2 + k.r);
  };
  const lots = layoutLots(lattice, seed, SCALE, true, curlsTightly, byCrease).filter(clear);
  const foot = MODEL_INDEX.get('pier_foot')!;
  const feet: Lot[] = keepOut.map((k) => ({ model: foot, u: k.a, v: k.b, swap: false, flip: false, scale: k.foot, sy: 1, cell: -1 }));
  const entry = (lot: Lot, prop: boolean): MorphBuilding => ({
    lot, model: lot.model, prop, alive: STRUCTURES.map(() => false), sy: STRUCTURES.map(() => lot.sy), sink: STRUCTURES.map(() => 0.5),
    lod: STRUCTURES.map(() => 1 as const), presence: [],
  });
  const buildings: MorphBuilding[] = [...lots.map((l) => entry(l, false)), ...layoutProps(lattice, seed).filter(clear).map((l) => entry(l, true)), ...feet.map((l) => entry(l, true))];
  const stats = { lots: lots.length, standing: [] as number[], props: [] as number[], triangles: [] as number[], dips: [] as number[] };
  const f = makeFrame();

  // each structure at rest, nearest to the play area first: what is close keeps its full height, what is far fits around it
  for (const [si, name] of STRUCTURES.entries()) {
    const surface = shownSurface(restState(name), name);
    const sheets = new SheetPoints([{ surface }], 6, REACH + 150, PLAY_CENTER);
    const order = buildings
      .map((b) => ({ b, d: surface.at(b.lot.u, b.lot.v, T).distanceTo(PLAY_CENTER) }))
      .filter((o) => o.d <= (o.b.prop ? PROP_REACH : REACH) && (!o.b.prop || treeKept(o.b.lot, o.d)))
      .sort((p, q) => p.d - q.d);
    const hash = new Hash();
    let standing = 0;
    let props = 0;
    let triangles = 0;
    for (const { b, d } of order) {
      const sink = b.model === foot ? 0.5 : seat(surface, b.lot, f);
      if (sink < 0) continue;
      if (b.prop) {
        b.alive[si] = true;
        b.sink[si] = sink;
        props++;
        triangles += MODELS[b.model].tris[0];
        continue;
      }
      const [fu, fv] = footprint(MODELS[b.model], b.lot.scale, b.lot.swap, b.lot.stretch);
      let sy = b.lot.sy;
      for (let attempt = 0; attempt < 4; attempt++, sy *= 0.78) {
        const obb = boxAt(b.lot, f, sy);
        if (overlaps(obb, PLAY_OBB) || hash.hits(obb, GAP)) continue;
        if (cutsSheet(sheets, obb, 0, b.lot.u, b.lot.v, fu, fv, 0)) continue;
        hash.insert(obb);
        b.alive[si] = true;
        b.sy[si] = sy;
        b.sink[si] = sink;
        b.lod[si] = d < NEAR_LOD ? 0 : 1;
        triangles += MODELS[b.model].tris[b.lod[si]];
        standing++;
        break;
      }
    }
    stats.standing.push(standing);
    stats.props.push(props);
    stats.triangles.push(triangles);
    yield;
  }

  // each transition: first what the bending sheet allows under each lot, then what the buildings do to each other
  const state = makeState();
  for (let ti = 0; ti + 1 < STRUCTURES.length; ti++) {
    const tr: Transition = { from: STRUCTURES[ti], to: STRUCTURES[ti + 1] };
    const live = buildings.filter((b) => b.alive[ti] || b.alive[ti + 1]);
    for (const b of buildings) b.presence.push(b.alive[ti] && b.alive[ti + 1] ? { ...STAY } : { ...NONE });
    for (const b of live) {
      if (b.alive[ti] && !b.alive[ti + 1]) b.presence[ti] = { fall: 0.92, rise: Infinity };
      if (!b.alive[ti] && b.alive[ti + 1]) b.presence[ti] = { fall: -Infinity, rise: 0.08 };
    }
    let dips = 0;
    const hide = (b: MorphBuilding, at: number) => {
      const p = b.presence[ti];
      // before its fall it goes sooner; after its rise it comes later; a building that stood all the way dips out and back
      if (p.fall === Infinity) {
        p.fall = at - 0.01;
        p.rise = at + 0.01;
        dips++;
      } else if (at < p.fall) p.fall = Math.min(p.fall, at - 0.01);
      else p.rise = Math.max(p.rise, at + 0.01);
    };
    for (const [k, at] of SAMPLES.entries()) {
      yield;
      blendState(tr, at, state);
      const surface = shownSurface(state, 'blend');
      // whether a building cuts through another part of the sheet is asked at every second sample: it costs the most
      const sheets = k % 2 === 1 ? new SheetPoints([{ surface }], 10, REACH + 80, PLAY_CENTER) : null;
      const hash = new Hash();
      const order = live
        .filter((b) => presenceAt(b.presence[ti], at) > 0.02)
        .map((b) => ({ b, d: surface.at(b.lot.u, b.lot.v, T).distanceTo(PLAY_CENTER) }))
        .sort((p, q) => p.d - q.d);
      for (const { b } of order) {
        if (b.model === foot) continue;
        if (seat(surface, b.lot, f) < 0) {
          hide(b, at);
          continue;
        }
        if (b.prop) continue;
        const w = presenceAt(b.presence[ti], at);
        const sy = (b.alive[ti] ? b.sy[ti] : b.sy[ti + 1]) * (b.alive[ti] && b.alive[ti + 1] ? 1 + (b.sy[ti + 1] / b.sy[ti] - 1) * at : 1);
        const obb = boxAt(b.lot, f, sy * w);
        const [fu, fv] = footprint(MODELS[b.model], b.lot.scale, b.lot.swap, b.lot.stretch);
        if (overlaps(obb, PLAY_OBB) || hash.hits(obb, GAP * 0.5) || (sheets && cutsSheet(sheets, obb, 0, b.lot.u, b.lot.v, fu, fv, 0))) {
          hide(b, at);
          continue;
        }
        hash.insert(obb);
      }
    }
    stats.dips.push(dips);
  }
  return { lattice, buildings, stats };
}

/** The height factor (with presence) of a building at fraction `f` of transition `ti`; 0 = not there. */
export function heightAt(b: MorphBuilding, ti: number, f: number): number {
  const w = presenceAt(b.presence[ti], f);
  if (w <= 0) return 0;
  const from = b.alive[ti];
  const to = b.alive[ti + 1];
  const sy = from && to ? b.sy[ti] + (b.sy[ti + 1] - b.sy[ti]) * f : from ? b.sy[ti] : b.sy[ti + 1];
  return sy * w;
}

export type { StructureName };

export function planMorph(seed: number, keepOut: readonly KeepOut[] = []): MorphPlan {
  const steps = planSteps(seed, keepOut);
  for (;;) {
    const step = steps.next();
    if (step.done) return step.value;
  }
}
