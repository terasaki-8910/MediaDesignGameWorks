// Turns a stage plus a puzzle state into world-space walkable tiles, regions and solid boxes,
// and answers which console actions are physically possible (sweep interference).
import { buildKit, type Box, type KitModule } from './kit.ts';
import {
  CUBE_GROUP, DIRS, I3, OPPOSITE, SIDES,
  apply, cellFloor, cellKey, cellOfFloorPoint, cubeIndex, mul, rot, rotAngle, round3, sideOf, sub, vecEq,
  type Mat3, type Side, type Vec3,
} from './math.ts';
import type { Action, Id, Interactable, ModuleInstance, PuzzleState, StageFile, TransformGroup } from './types.ts';

export interface WalkTile {
  key: string; // cell key
  cell: [number, number, number];
  module: Id;
  floorY: number;
  open: Record<Side, boolean>;
  plate: boolean;
}

export interface WalkMap {
  tiles: Map<string, WalkTile>;
  region: Map<string, number>;
  conflicts: string[];
}

export interface WorldBox { module: Id; min: Vec3; max: Vec3 }

export interface Transform { R: Mat3; t: Vec3 }

interface RawTile {
  module: Id;
  tileKey: string;
  cell: [number, number, number];
  floorY: number;
  edges: Record<Side, { kind: 'port' | 'link' | 'closed'; to?: string }>;
  plate?: Side;
}

const EPS = 0.02;
const SWEEP_STEP = (2.5 * Math.PI) / 180;
const ANCHOR_HEIGHT = 2.5;

export class CompiledStage {
  readonly stage: StageFile;
  readonly modules: ModuleInstance[];
  readonly kits = new Map<Id, KitModule>();
  readonly groups = new Map<Id, TransformGroup>();
  readonly consoles = new Map<Id, Interactable>();
  private walkCache = new Map<string, WalkMap>();
  private sweepCache = new Map<string, string[]>();

  constructor(stage: StageFile) {
    this.stage = stage;
    this.modules = stage.modules;
    for (const m of stage.modules) this.kits.set(m.id, buildKit(m));
    for (const g of stage.groups) this.groups.set(g.id, g);
    for (const c of stage.interactables) this.consoles.set(c.id, c);
  }

  initialState(): PuzzleState {
    const s: Record<Id, number> = {};
    for (const g of this.stage.groups) s[g.id] = g.initial;
    return s;
  }

  stateKey(s: PuzzleState): string {
    return Object.keys(s).sort().map((k) => `${k}:${s[k]}`).join('|');
  }

  groupMatrix(g: TransformGroup, index: number): Mat3 {
    return g.kind === 'states' ? rot(g.axis, g.states[index]) : CUBE_GROUP[index];
  }

  /** world = R * local + t */
  moduleTransform(m: ModuleInstance, s: PuzzleState): Transform {
    const yaw = rot('y', m.yaw ?? 0);
    const origin = cellFloor(m.at);
    if (!m.group) return { R: yaw, t: origin };
    const g = this.groups.get(m.group)!;
    const G = this.groupMatrix(g, s[g.id] ?? g.initial);
    const t = apply(G, sub(origin, g.pivot));
    return { R: mul(G, yaw), t: [t[0] + g.pivot[0], t[1] + g.pivot[1], t[2] + g.pivot[2]] };
  }

  walkMap(s: PuzzleState): WalkMap {
    const key = this.stateKey(s);
    const hit = this.walkCache.get(key);
    if (hit) return hit;
    const wm = this.computeWalkMap(s);
    this.walkCache.set(key, wm);
    return wm;
  }

  private computeWalkMap(s: PuzzleState): WalkMap {
    const raw = new Map<string, RawTile>();
    const byModuleTile = new Map<string, RawTile>();
    const plates: RawTile[] = [];
    const conflicts: string[] = [];
    for (const m of this.modules) {
      const kit = this.kits.get(m.id)!;
      if (!kit.tiles.length) continue;
      const T = this.moduleTransform(m, s);
      for (const tile of kit.tiles) {
        const n = apply(T.R, tile.n);
        if (!vecEq(n, DIRS.U)) continue;
        const p = round3(addT(T, tile.p));
        const cell = cellOfFloorPoint(p);
        const edges = {} as RawTile['edges'];
        for (const e of tile.edges) {
          const side = sideOf(apply(T.R, e.d));
          if (side) edges[side] = { kind: e.kind, to: e.to };
        }
        for (const sd of SIDES) edges[sd] ??= { kind: 'closed' };
        const plate = tile.plate ? (sideOf(apply(T.R, DIRS[tile.plate])) ?? undefined) : undefined;
        const rt: RawTile = { module: m.id, tileKey: tile.key, cell, floorY: p[1], edges, plate };
        if (plate) {
          plates.push(rt);
          continue;
        }
        const ck = cellKey(cell);
        if (raw.has(ck)) conflicts.push(ck);
        raw.set(ck, rt);
        byModuleTile.set(`${m.id}/${tile.key}`, rt);
      }
    }
    // Plates bridge a one-cell gap only while both neighbours present a port towards them.
    for (const p of plates) {
      const far = raw.get(cellKey(step(p.cell, p.plate!)));
      const near = raw.get(cellKey(step(p.cell, OPPOSITE[p.plate!])));
      const ok =
        far && near &&
        far.edges[OPPOSITE[p.plate!]].kind === 'port' && near.edges[p.plate!].kind === 'port' &&
        Math.abs(far.floorY - p.floorY) < EPS && Math.abs(near.floorY - p.floorY) < EPS;
      if (!ok) continue;
      const ck = cellKey(p.cell);
      if (raw.has(ck)) conflicts.push(ck);
      raw.set(ck, p);
    }
    const tiles = new Map<string, WalkTile>();
    for (const [ck, rt] of raw) {
      const open = { N: false, E: false, S: false, W: false } as Record<Side, boolean>;
      for (const sd of SIDES) {
        const e = rt.edges[sd];
        if (e.kind === 'link') {
          open[sd] = byModuleTile.has(`${rt.module}/${e.to}`);
        } else if (e.kind === 'port') {
          const nb = raw.get(cellKey(step(rt.cell, sd)));
          open[sd] = !!nb && nb.edges[OPPOSITE[sd]].kind === 'port' && Math.abs(nb.floorY - rt.floorY) < EPS;
        }
      }
      tiles.set(ck, { key: ck, cell: rt.cell, module: rt.module, floorY: rt.floorY, open, plate: !!rt.plate });
    }
    // Regions: union-find over open edges (an edge counts only if both sides agree).
    const parent = new Map<string, string>();
    const find = (k: string): string => {
      let r = k;
      while (parent.get(r) !== r) r = parent.get(r)!;
      parent.set(k, r);
      return r;
    };
    for (const k of tiles.keys()) parent.set(k, k);
    for (const t of tiles.values())
      for (const sd of SIDES) {
        if (!t.open[sd]) continue;
        const nk = cellKey(step(t.cell, sd));
        const nb = tiles.get(nk);
        if (nb && nb.open[OPPOSITE[sd]]) parent.set(find(t.key), find(nk));
      }
    for (const t of tiles.values())
      for (const sd of SIDES) {
        const nb = tiles.get(cellKey(step(t.cell, sd)));
        if (t.open[sd] && !(nb && nb.open[OPPOSITE[sd]])) t.open[sd] = false;
      }
    const ids = new Map<string, number>();
    const region = new Map<string, number>();
    for (const k of tiles.keys()) {
      const r = find(k);
      if (!ids.has(r)) ids.set(r, ids.size);
      region.set(k, ids.get(r)!);
    }
    return { tiles, region, conflicts };
  }

  /** Axis-aligned world boxes of all solid modules (plates and decorations excluded). */
  worldBoxes(s: PuzzleState): WorldBox[] {
    const out: WorldBox[] = [];
    for (const m of this.modules) {
      const kit = this.kits.get(m.id)!;
      if (!kit.boxes.length) continue;
      const T = this.moduleTransform(m, s);
      for (const b of kit.boxes) out.push({ module: m.id, ...transformBox(T, b) });
    }
    return out;
  }

  anchorBoxes(): WorldBox[] {
    return [...this.consoles.values()].map((c) => {
      const f = cellFloor(c.at);
      return {
        module: `anchor:${c.id}`,
        min: [f[0] - 2, f[1] + 0.05, f[2] - 2],
        max: [f[0] + 2, f[1] + ANCHOR_HEIGHT, f[2] + 2],
      };
    });
  }

  /** Rotation (axis, signed quarter turns) that an action performs on its group. */
  motionOf(s: PuzzleState, a: Action): { axis: 'x' | 'y' | 'z'; quarters: number; pivot: Vec3 } {
    const g = this.groups.get(a.group)!;
    if (a.kind === 'turn') return { axis: a.axis, quarters: a.quarters === 3 ? -1 : a.quarters, pivot: g.pivot };
    if (g.kind !== 'states') throw new Error(`group ${g.id} is not a states group`);
    const dq = (((g.states[a.to] - g.states[s[g.id] ?? g.initial]) % 4) + 4) % 4;
    return { axis: g.axis, quarters: dq === 3 ? -1 : dq, pivot: g.pivot };
  }

  /** Module ids (and anchor:<console>) that the action's motion would pass through. */
  sweepBlockers(s: PuzzleState, a: Action): string[] {
    const key = `${this.stateKey(s)}#${actionKey(a)}`;
    const hit = this.sweepCache.get(key);
    if (hit) return hit;
    const g = this.groups.get(a.group)!;
    const moving = new Set(this.modules.filter((m) => m.group === g.id).map((m) => m.id));
    const all = this.worldBoxes(s);
    const statics = [...all.filter((b) => !moving.has(b.module)), ...this.anchorBoxes()];
    const hash = new BoxHash(statics);
    const points = all.filter((b) => moving.has(b.module)).flatMap(surfacePoints);
    const { axis, quarters, pivot } = this.motionOf(s, a);
    const total = (quarters * Math.PI) / 2;
    const steps = Math.max(1, Math.ceil(Math.abs(total) / SWEEP_STEP));
    const blockers = new Set<string>();
    for (let i = 1; i <= steps; i++) {
      const R = rotAngle(axis, (total * i) / steps);
      for (const p of points) {
        const q = apply(R, sub(p, pivot));
        const w: Vec3 = [q[0] + pivot[0], q[1] + pivot[1], q[2] + pivot[2]];
        for (const b of hash.query(w)) blockers.add(b.module);
      }
    }
    const out = [...blockers].sort();
    this.sweepCache.set(key, out);
    return out;
  }

  /** Every action a console offers in a state, with what blocks it (empty = allowed). */
  consoleActions(consoleId: Id, s: PuzzleState): { action: Action; blockedBy: string[] }[] {
    const c = this.consoles.get(consoleId)!;
    const g = this.groups.get(c.controls)!;
    const actions: Action[] = [];
    if (g.kind === 'states') {
      for (let i = 0; i < g.states.length; i++)
        if (i !== (s[g.id] ?? g.initial)) actions.push({ console: c.id, group: g.id, kind: 'set', to: i });
    } else {
      const axis = c.axis ?? 'y';
      for (const q of [1, 2, 3] as const) actions.push({ console: c.id, group: g.id, kind: 'turn', axis, quarters: q });
    }
    return actions.map((action) => ({ action, blockedBy: this.sweepBlockers(s, action) }));
  }

  apply(s: PuzzleState, a: Action): PuzzleState {
    const next: Record<Id, number> = { ...s };
    if (a.kind === 'set') next[a.group] = a.to;
    else next[a.group] = cubeIndex(mul(rot(a.axis, a.quarters), CUBE_GROUP[s[a.group] ?? 0]));
    return next;
  }

  /** Transform a point given in a module's local frame to world space for a state. */
  toWorld(m: ModuleInstance, s: PuzzleState, p: Vec3): [number, number, number] {
    return addT(this.moduleTransform(m, s), p);
  }
}

export function actionKey(a: Action): string {
  return a.kind === 'set' ? `${a.console}:set${a.to}` : `${a.console}:${a.axis}${a.quarters * 90}`;
}

export function step(c: Vec3, s: Side): [number, number, number] {
  const d = DIRS[s];
  return [c[0] + d[0], c[1], c[2] + d[2]];
}

function addT(T: Transform, p: Vec3): [number, number, number] {
  const q = apply(T.R, p);
  return [q[0] + T.t[0], q[1] + T.t[1], q[2] + T.t[2]];
}

function transformBox(T: Transform, b: Box): { min: Vec3; max: Vec3 } {
  const xs: number[] = [];
  const ys: number[] = [];
  const zs: number[] = [];
  for (const x of [b.min[0], b.max[0]])
    for (const y of [b.min[1], b.max[1]])
      for (const z of [b.min[2], b.max[2]]) {
        const p = addT(T, [x, y, z]);
        xs.push(p[0]);
        ys.push(p[1]);
        zs.push(p[2]);
      }
  return {
    min: round3([Math.min(...xs), Math.min(...ys), Math.min(...zs)]),
    max: round3([Math.max(...xs), Math.max(...ys), Math.max(...zs)]),
  };
}

/**
 * Points on the surface of a box shrunk by 0.1 m, spaced at most ~1.5 m apart, used to sample a sweep.
 * Shrinking keeps boxes that merely touch from counting as a hit while identical boxes still collide.
 */
function surfacePoints(src: WorldBox): Vec3[] {
  const b = {
    min: [src.min[0] + 0.1, src.min[1] + 0.1, src.min[2] + 0.1],
    max: [src.max[0] - 0.1, src.max[1] - 0.1, src.max[2] - 0.1],
  };
  const n = [0, 1, 2].map((i) => Math.max(1, Math.ceil((b.max[i] - b.min[i]) / 1.5)));
  const pts: Vec3[] = [];
  for (let i = 0; i <= n[0]; i++)
    for (let j = 0; j <= n[1]; j++)
      for (let k = 0; k <= n[2]; k++) {
        const onSurface = i === 0 || i === n[0] || j === 0 || j === n[1] || k === 0 || k === n[2];
        if (!onSurface) continue;
        pts.push([
          b.min[0] + ((b.max[0] - b.min[0]) * i) / n[0],
          b.min[1] + ((b.max[1] - b.min[1]) * j) / n[1],
          b.min[2] + ((b.max[2] - b.min[2]) * k) / n[2],
        ]);
      }
  return pts;
}

class BoxHash {
  private cells = new Map<string, WorldBox[]>();
  constructor(boxes: WorldBox[]) {
    for (const b of boxes)
      for (let x = Math.floor(b.min[0] / 4); x <= Math.floor(b.max[0] / 4); x++)
        for (let y = Math.floor(b.min[1] / 4); y <= Math.floor(b.max[1] / 4); y++)
          for (let z = Math.floor(b.min[2] / 4); z <= Math.floor(b.max[2] / 4); z++) {
            const k = `${x},${y},${z}`;
            const list = this.cells.get(k);
            if (list) list.push(b);
            else this.cells.set(k, [b]);
          }
  }
  query(p: Vec3): WorldBox[] {
    const list = this.cells.get(`${Math.floor(p[0] / 4)},${Math.floor(p[1] / 4)},${Math.floor(p[2] / 4)}`);
    if (!list) return [];
    return list.filter(
      (b) =>
        p[0] > b.min[0] + EPS && p[0] < b.max[0] - EPS &&
        p[1] > b.min[1] + EPS && p[1] < b.max[1] - EPS &&
        p[2] > b.min[2] + EPS && p[2] < b.max[2] - EPS,
    );
  }
}

export { I3 };
