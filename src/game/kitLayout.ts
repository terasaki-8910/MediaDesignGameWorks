// Which kit pieces make up the floor slabs of a stage: tops, undersides, moulded or plain edges, corner pieces,
// lamps, the street's dressing and the piers underneath. Visual only; the puzzle's boxes and walk map stay in src/core.
import * as THREE from 'three';
import type { CompiledStage } from '../core/compile.ts';
import { SLAB } from '../core/kit.ts';
import { CELL, DIRS, SIDES, apply, cellFloor, type Side, type Vec3 } from '../core/math.ts';
import type { Id, ModuleInstance, PuzzleState } from '../core/types.ts';
import { place, type Placement, type WalkLine } from './kit.ts';

const H = CELL / 2;
/** Centre line of the parapets, from the cell centre (the kit's parapet pieces are modelled there). */
export const RAIL_LINE = 1.84;
/** Top of the pier that carries a lamp (parapet.glb, post_lamp). */
const LAMP_BASE = 1.18;
/** The piers go down this far below the floor they carry: into the ground of the city below (see foldcity/sheet.ts). */
export const PIER_DEPTH = 132;
/** A pylon stands beside the slabs: its centre this far out from both edges of an inside corner, its top this high. */
/** The pylon of the kit is 8.5 m tall; a little smaller its gilt finial stays inside the play camera's frame. */
const PYLON_SCALE = 0.88;
const PYLON_HALF = 1.05 * PYLON_SCALE;
const PYLON_OUT = 0.17 + 0.87 * PYLON_SCALE + 0.02;
const PYLON_TOP = 9 * PYLON_SCALE;
/** It hangs on a corbel that ends this far below the deck. */
const PYLON_DEPTH = 3.6;

type EdgeKind = 'none' | 'flush' | 'cornice';
interface Cell { gx: number; gz: number; y: number; x0: number; x1: number; z0: number; z1: number; module: ModuleInstance }

/** A walkway one cell wide (a road, a bridge, the arm tower's deck), as against a plaza. */
const isRoad = (m: ModuleInstance) => m.type === 'bridge' || m.type === 'tower' || (m.type === 'tile' && Math.min(...(m.params.size ?? [1, 1])) === 1);
/**
 * A lamped bridge of four cells or more is a piece of street: kerbs, pavements and bollards on its deck, an archway at its
 * far end, a coffered soffit and consoles under its cornices.
 */
export const isStreet = (m: ModuleInstance) => m.type === 'bridge' && !!m.params.lamps && m.params.length >= 4;
/**
 * The edge piece where another slab can stand against this one. The kit's `edge_flush` is a plain face that is hidden by
 * its neighbour (and baked so: it is black where it shows). The arm tower's deck and the street show theirs for most of
 * the game (the tower turns, the street hangs), so they have their own: the cornice cut into the slab.
 */
const flushEdge = (m: ModuleInstance) => (m.type === 'tower' ? 'tower_edge' : isStreet(m) ? 'street_edge' : 'edge_flush');
/** The archway stands this far beyond the middle of the street's last cell. */
const ARCH_AT = 1.2;
interface AABB { min: Vec3; max: Vec3 }

export interface SlabPlan {
  /** Slabs of the modules that never move and are not turned, with their piers, in world space. */
  world: Placement[];
  /** Slabs of the other modules, each in its module's own frame. */
  modules: Map<Id, Placement[]>;
  /** `x,y,z:side` (floor centre of a cell) of fixed slab edges another slab can stand against: they get a plain wall. */
  flushEdges: Set<string>;
  /** Where feet have worn the paving lighter: along the roads and from each road into its plaza (world, and per module). */
  walkWorld: WalkLine[];
  walkModules: Map<Id, WalkLine[]>;
}

const TURNS: Record<Side, number> = { N: 0, E: 1, S: 2, W: 3 };
const key = (x: number, y: number, z: number) => `${Math.round(x * 10) / 10},${Math.round(y * 10) / 10},${Math.round(z * 10) / 10}`;
export const edgeKey = (x: number, y: number, z: number, s: Side) => `${key(x, y, z)}:${s}`;

/** Every combination of group states: the pieces must be right whatever the player has folded. */
function allStates(cs: CompiledStage): PuzzleState[] {
  let out: Record<Id, number>[] = [{}];
  for (const g of cs.stage.groups) {
    const n = g.kind === 'states' ? g.states.length : 24;
    out = out.flatMap((s) => Array.from({ length: n }, (_, i) => ({ ...s, [g.id]: i })));
  }
  return out;
}

const overlaps = (a: AABB, b: AABB, eps = 0.02) =>
  a.min[0] < b.max[0] - eps && a.max[0] > b.min[0] + eps && a.min[1] < b.max[1] - eps && a.max[1] > b.min[1] + eps &&
  a.min[2] < b.max[2] - eps && a.max[2] > b.min[2] + eps;

function cellsOf(cs: CompiledStage, m: ModuleInstance, world: boolean): Cell[] {
  const f = world ? cellFloor(m.at) : [0, 0, 0];
  const inset = m.type === 'bridge' ? (m.params.inset ?? 0) : 0;
  const tiles = cs.kits.get(m.id)!.tiles;
  if (m.type === 'tower') {
    // the hub, and arms that stop short of the cell's far edge (src/core/kit.ts)
    const short = m.params.inset ?? 0.4;
    return tiles.map((t) => {
      const d = t.key.startsWith('arm_') ? DIRS[t.key.slice(4) as Side] : [0, 0, 0];
      return {
        gx: f[0] + t.p[0], gz: f[2] + t.p[2], y: f[1] + t.p[1],
        x0: f[0] + t.p[0] - H + (d[0] < 0 ? short : 0), x1: f[0] + t.p[0] + H - (d[0] > 0 ? short : 0),
        z0: f[2] + t.p[2] - H + (d[2] < 0 ? short : 0), z1: f[2] + t.p[2] + H - (d[2] > 0 ? short : 0), module: m,
      };
    });
  }
  return tiles.map((t, i) => ({
    gx: f[0] + t.p[0], gz: f[2] + t.p[2], y: f[1] + t.p[1],
    x0: f[0] + t.p[0] - H + (i === 0 ? inset : 0), x1: f[0] + t.p[0] + H - (i === tiles.length - 1 ? inset : 0),
    z0: f[2] + t.p[2] - H, z1: f[2] + t.p[2] + H, module: m,
  }));
}

export function planSlabs(cs: CompiledStage): SlabPlan {
  const kitModules = cs.modules.filter((m) => m.type === 'tile' || m.type === 'bridge' || m.type === 'tower');
  const fixed = kitModules.filter((m) => !m.group && !m.yaw);
  const states = allStates(cs);
  // plates have no box in the core (they are thin), but an edge next to one must stay plain
  const plates: AABB[] = cs.modules.filter((m) => m.type === 'plate' && !m.group).map((m) => {
    const f = cellFloor(m.at);
    return { min: [f[0] - H, f[1] - SLAB, f[2] - H], max: [f[0] + H, f[1], f[2] + H] };
  });
  const boxesByState = states.map((s) => cs.worldBoxes(s));

  /** Does `box` (in the frame of `m`, or the world when `m` is null) meet another module's box in any state? */
  const blocked = (box: AABB, m: ModuleInstance | null, own: Set<Id>): boolean => {
    for (let k = 0; k < states.length; k++) {
      let b = box;
      if (m) {
        const T = cs.moduleTransform(m, states[k]);
        const p = apply(T.R, box.min);
        const q = apply(T.R, box.max);
        b = {
          min: [Math.min(p[0], q[0]) + T.t[0], Math.min(p[1], q[1]) + T.t[1], Math.min(p[2], q[2]) + T.t[2]],
          max: [Math.max(p[0], q[0]) + T.t[0], Math.max(p[1], q[1]) + T.t[1], Math.max(p[2], q[2]) + T.t[2]],
        };
      }
      for (const w of boxesByState[k]) if (!own.has(w.module) && overlaps(b, w)) return true;
      for (const w of plates) if (overlaps(b, w)) return true;
    }
    return false;
  };

  const flushEdges = new Set<string>();
  const pylon = (x: number, y: number, z: number, turns: number): Placement => {
    const p = place('pylon', x, y, z, turns);
    p.matrix.multiply(new THREE.Matrix4().makeScale(PYLON_SCALE, PYLON_SCALE, PYLON_SCALE));
    return p;
  };
  const pylonFits = (x: number, y: number, z: number) =>
    !blocked({ min: [x - PYLON_HALF, y - PYLON_DEPTH, z - PYLON_HALF], max: [x + PYLON_HALF, y + PYLON_TOP, z + PYLON_HALF] }, null, new Set());

  /** The pieces of one set of cells that form slabs together (all fixed modules, or one moving module). */
  const slabs = (cells: Cell[], frame: ModuleInstance | null, walk: WalkLine[]): Placement[] => {
    const out: Placement[] = [];
    const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
    const at = new Map(cells.map((c) => [key(c.gx, c.y, c.gz), c]));
    const own = new Set(frame ? [frame.id] : []);
    const kinds = new Map<Cell, Record<Side, EdgeKind>>();
    const neighbour = (c: Cell, ...sides: Side[]) => {
      let x = c.gx;
      let z = c.gz;
      for (const s of sides) {
        x += DIRS[s][0] * CELL;
        z += DIRS[s][2] * CELL;
      }
      return at.get(key(x, c.y, z));
    };
    for (const c of cells) {
      const kind = {} as Record<Side, EdgeKind>;
      for (const s of SIDES) {
        if (neighbour(c, s)) {
          kind[s] = 'none';
          continue;
        }
        const d = DIRS[s];
        const px = c.gx + d[0] * (H + 0.3);
        const pz = c.gz + d[2] * (H + 0.3);
        const hx = d[0] ? 0.2 : 1.6;
        const hz = d[2] ? 0.2 : 1.6;
        const probe: AABB = { min: [px - hx, c.y - 0.5, pz - hz], max: [px + hx, c.y - 0.1, pz + hz] };
        kind[s] = blocked(probe, frame, frame ? own : new Set([c.module.id])) ? 'flush' : 'cornice';
        if (!frame && kind[s] === 'flush') flushEdges.add(edgeKey(c.gx, c.y, c.gz, s));
      }
      kinds.set(c, kind);
    }
    for (const c of cells) {
      const kind = kinds.get(c)!;
      const cx = (c.x0 + c.x1) / 2;
      const cz = (c.z0 + c.z1) / 2;
      const sx = (c.x1 - c.x0) / CELL;
      const sz = (c.z1 - c.z0) / CELL;
      const put = (piece: string, turns = 0) => out.push(place(piece, cx, c.y, cz, turns, sx, sz));
      // the paving's texture is turned from cell to cell (by the cell's place), so its stains do not repeat in rows
      const turn = Math.abs(Math.round(Math.sin(c.gx * 12.9898 + c.gz * 78.233) * 43758.5453)) % 4;
      out.push({ ...place('slab_top', cx, c.y, cz, 0, sx, sz), uvTurn: turn });
      // the street hangs for most of the game with its underside upright before the player: its own coffered soffit, and
      // consoles under its cornices
      const street = isStreet(c.module);
      put(street ? 'street_soffit' : 'slab_bottom');
      SIDES.forEach((s, k) => {
        if (kind[s] !== 'none') put(kind[s] === 'cornice' ? 'edge_cornice' : flushEdge(c.module), TURNS[s]);
        if (street && kind[s] === 'cornice') put('street_brackets', TURNS[s]);
        // the walking line: along roads, on to the edge where another slab joins, and from a road to the plaza's middle
        const n = neighbour(c, s);
        if (n && (s === 'E' || s === 'S') && (isRoad(c.module) || isRoad(n.module))) walk.push({ a: v(c.gx, c.y, c.gz), b: v(n.gx, n.y, n.gz) });
        if (kind[s] === 'flush' && isRoad(c.module)) walk.push({ a: v(c.gx, c.y, c.gz), b: v(c.gx + DIRS[s][0] * H, c.y, c.gz + DIRS[s][2] * H) });
        if (n && !isRoad(c.module) && isRoad(n.module) && c.module.type === 'tile' && !frame) {
          const [w, d] = c.module.params.size ?? [1, 1];
          const f = cellFloor(c.module.at);
          walk.push({ a: v(c.gx, c.y, c.gz), b: v(f[0] + ((w - 1) * CELL) / 2, c.y, f[2] + ((d - 1) * CELL) / 2) });
        }
        const next = SIDES[(k + 1) % 4]; // the corner between s and the side clockwise from it
        if (kind[s] === 'cornice' && kind[next] === 'cornice') put('corner_outer', k);
        const a = neighbour(c, s);
        const b = neighbour(c, next);
        if (a && b && !neighbour(c, s, next) && kinds.get(a)![next] === 'cornice' && kinds.get(b)![s] === 'cornice') {
          put('corner_inner', k);
          // a gilt-crowned pylon beside the slab where a road leaves a large plaza (brief: at the start and the end)
          const road = [a, b].find((n) => isRoad(n.module));
          const size = c.module.type === 'tile' ? (c.module.params.size ?? [1, 1]) : [1, 1];
          if (!frame && road && Math.min(...size) >= 3) {
            const px = c.gx + (DIRS[s][0] + DIRS[next][0]) * (H + PYLON_OUT);
            const pz = c.gz + (DIRS[s][2] + DIRS[next][2]) * (H + PYLON_OUT);
            // wings across the road it flanks
            if (pylonFits(px, c.y, pz)) out.push(pylon(px, c.y, pz, road.gx !== c.gx ? 1 : 0));
          }
        }
      });
    }
    return out;
  };

  const lamps = (m: ModuleInstance, f: Vec3): Placement[] => {
    if (m.type !== 'bridge' || !m.params.lamps) return [];
    const open = new Set((m.params.sidePorts ?? []).map((p) => `${p.i}${p.side}`));
    const out: Placement[] = [];
    for (let i = 0; i < m.params.length; i++)
      for (const side of ['N', 'S'] as const) {
        if (open.has(`${i}${side}`)) continue;
        const z = f[2] + (side === 'N' ? -RAIL_LINE : RAIL_LINE);
        out.push(place('post_lamp', f[0] + i * CELL, f[1], z), place('lamp', f[0] + i * CELL, f[1] + LAMP_BASE, z));
      }
    return out;
  };

  const street = (m: ModuleInstance, f: Vec3): Placement[] => {
    if (m.type !== 'bridge' || !isStreet(m)) return [];
    const open = new Set((m.params.sidePorts ?? []).map((p) => `${p.i}${p.side}`));
    const out: Placement[] = [];
    for (let i = 0; i < m.params.length; i++)
      for (const side of ['N', 'S'] as const) if (!open.has(`${i}${side}`)) out.push(place('street_side', f[0] + i * CELL, f[1], f[2], TURNS[side]));
    out.push(place('street_arch', f[0] + (m.params.length - 1) * CELL + ARCH_AT, f[1], f[2], 1));
    return out;
  };

  const walkWorld: WalkLine[] = [];
  const world = slabs(fixed.flatMap((m) => cellsOf(cs, m, true)), null, walkWorld);
  for (const m of fixed) world.push(...lamps(m, cellFloor(m.at)), ...street(m, cellFloor(m.at)));

  // pylons before the gate too: beside the two corners of the goal's plaza that are nearest to the last checkpoint
  const goal = cellFloor(cs.stage.goal.at);
  const plaza = fixed.find((m) => {
    if (m.type !== 'tile') return false;
    const [w, d] = m.params.size ?? [1, 1];
    const f = cellFloor(m.at);
    return goal[1] === f[1] && goal[0] >= f[0] - H && goal[0] <= f[0] + (w - 1) * CELL + H && goal[2] >= f[2] - H && goal[2] <= f[2] + (d - 1) * CELL + H;
  });
  const last = cs.stage.checkpoints[cs.stage.checkpoints.length - 1];
  if (plaza && plaza.type === 'tile' && last) {
    const [w, d] = plaza.params.size ?? [1, 1];
    const f = cellFloor(plaza.at);
    const from = cellFloor(last.at);
    const corners = [-1, 1].flatMap((sx) => [-1, 1].map((sz) => ({
      x: f[0] + ((w - 1) * CELL) / 2 + sx * ((w * CELL) / 2 + PYLON_OUT),
      z: f[2] + ((d - 1) * CELL) / 2 + sz * ((d * CELL) / 2 + PYLON_OUT),
    })));
    corners.sort((a, b) => Math.hypot(a.x - from[0], a.z - from[2]) - Math.hypot(b.x - from[0], b.z - from[2]));
    // wings along the side the two share, so the pair reads as a gateway from the approach
    const fits = corners.filter((c) => pylonFits(c.x, f[1], c.z)).slice(0, 2);
    const turn = fits.length === 2 && Math.abs(fits[0].x - fits[1].x) < 0.01 ? 1 : 0;
    for (const c of fits) world.push(pylon(c.x, f[1], c.z, turn));
  }

  // piers: one thick pier under each fixed walkway, moved or left out where something folds through its place
  const taken: AABB[] = [];
  for (const m of fixed) {
    if (m.type !== 'tile') continue;
    const [w, d] = m.params.size ?? [1, 1];
    const f = cellFloor(m.at);
    const centre: [number, number] = [f[0] + ((w - 1) * CELL) / 2, f[2] + ((d - 1) * CELL) / 2];
    const cellCentres: [number, number][] = [];
    for (let i = 0; i < w; i++) for (let j = 0; j < d; j++) cellCentres.push([f[0] + i * CELL, f[2] + j * CELL]);
    cellCentres.sort((a, b) => Math.hypot(a[0] - centre[0], a[1] - centre[1]) - Math.hypot(b[0] - centre[0], b[1] - centre[1]));
    const tries: { piece: string; half: number; at: [number, number] }[] = [];
    if (Math.min(w, d) >= 2) tries.push({ piece: 'pier_b', half: 3.4, at: centre });
    tries.push({ piece: 'pier_a', half: 1.7, at: centre }, ...cellCentres.map((c) => ({ piece: 'pier_a', half: 1.7, at: c })));
    for (const t of tries) {
      // within the module's own footprint, and clear of everything else by half a metre in every state
      if (t.at[0] - t.half < f[0] - H - 0.01 || t.at[0] + t.half > f[0] + (w - 1) * CELL + H + 0.01) continue;
      if (t.at[1] - t.half < f[2] - H - 0.01 || t.at[1] + t.half > f[2] + (d - 1) * CELL + H + 0.01) continue;
      const box: AABB = {
        min: [t.at[0] - t.half - 0.5, f[1] - PIER_DEPTH, t.at[1] - t.half - 0.5],
        max: [t.at[0] + t.half + 0.5, f[1] - SLAB, t.at[1] + t.half + 0.5],
      };
      if (blocked(box, null, new Set([m.id])) || taken.some((o) => overlaps(box, o))) continue;
      taken.push(box);
      world.push(place(t.piece, t.at[0], f[1], t.at[1]));
      break;
    }
  }

  const modules = new Map<Id, Placement[]>();
  const walkModules = new Map<Id, WalkLine[]>();
  for (const m of kitModules) {
    if (fixed.includes(m)) continue;
    const walk: WalkLine[] = [];
    modules.set(m.id, [...slabs(cellsOf(cs, m, false), m, walk), ...lamps(m, [0, 0, 0]), ...street(m, [0, 0, 0])]);
    walkModules.set(m.id, walk);
  }

  // a round pier under the middle of every bridge that turns about a vertical axis: the bridge rests on it
  for (const g of cs.stage.groups) {
    if (g.kind !== 'states' || g.axis !== 'y') continue;
    const members = cs.modules.filter((m) => m.group === g.id);
    const bridge = members.find((m) => m.type === 'bridge');
    if (!bridge) continue;
    const y = cellFloor(bridge.at)[1];
    const box: AABB = { min: [g.pivot[0] - 1.95, y - PIER_DEPTH, g.pivot[2] - 1.95], max: [g.pivot[0] + 1.95, y - SLAB, g.pivot[2] + 1.95] };
    if (!blocked(box, null, new Set(members.map((m) => m.id))) && !taken.some((o) => overlaps(box, o))) world.push(place('pier_pivot', g.pivot[0], y, g.pivot[2]));
  }
  return { world, modules, flushEdges, walkWorld, walkModules };
}

/** Where the piers of a slab plan stand, and which piece each is (the background keeps their feet free and builds a foot round each). */
export function pierFeet(plan: SlabPlan): { piece: string; x: number; z: number }[] {
  return plan.world.filter((p) => p.piece.startsWith('pier_')).map((p) => ({ piece: p.piece, x: p.matrix.elements[12], z: p.matrix.elements[14] }));
}

/** Where a piece that turns with a side stands: the rotation that takes the kit's north edge to side `s`. */
export function sideMatrix(x: number, y: number, z: number, s: Side): THREE.Matrix4 {
  return place('', x, y, z, TURNS[s]).matrix;
}
