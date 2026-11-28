// Turns a stage plus a puzzle state into world-space walkable tiles, regions and solid boxes,
// and answers which actions are physically possible (sweep interference): console actions, handle steps (v0.5),
// the clockwork's waits (v0.5), the player's ride on a turning group (v0.5) and the tether links (v0.5).
import { TETHER_SPAN, buildKit, tetherRing, type Box, type KitModule } from './kit.ts';
import {
  CUBE_GROUP, DIRS, I3, OPPOSITE, SIDES,
  apply, cellFloor, cellKey, cellOfFloorPoint, cubeIndex, mul, rot, rotAngle, round3, sideOf, sub, vecEq,
  type Mat3, type Side, type Vec3,
} from './math.ts';
import type {
  Action, Handle, Id, Interactable, ModuleInstance, PlayerAction, PuzzleState, StageFile, StepAction, TransformGroup,
} from './types.ts';

export interface WalkTile {
  key: string; // cell key
  cell: [number, number, number];
  module: Id;
  floorY: number;
  open: Record<Side, boolean>;
  plate: boolean;
  /** Which tile of the module this is (its kit tile key), so a rider can be followed through a turn. */
  part?: string;
}

/** A thread between two tethers: the player may go from cell `from` to cell `to` and back (the landing cells). */
export interface TetherLink { a: Id; b: Id; from: string; to: string }

export interface WalkMap {
  tiles: Map<string, WalkTile>;
  region: Map<string, number>;
  conflicts: string[];
  /** Tether links in this state. They merge the regions of their two landing cells. */
  links: TetherLink[];
}

/** What an action does to a player standing on a cell: carried along (ride), left where they are, or blocked. */
export type MotionOutcome =
  | { ok: true; cell: string; ride: boolean }
  | { ok: false; blockedBy: string[] };

/** One group's turn: `quarters` signed quarter turns about `axis` through `pivot`. */
export interface Motion { group: Id; axis: 'x' | 'y' | 'z'; quarters: number; pivot: Vec3 }

type StatesGroup = Extract<TransformGroup, { kind: 'states' }>;
type TetherModule = Extract<ModuleInstance, { type: 'tether' }>;

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
const LINE_STEP = 0.25; // metres between samples along a tether thread and a handle's line of sight
const EYE_HEIGHT = 1.5; // metres above the floor
const HANDLE_HEIGHT = 2; // metres above the floor of the handle's cell
const HANDLE_REACH = 3; // cells
const TETHER_RISE = 2; // levels a thread may climb or fall
const BODY_W = 0.8; // the player's body: a box this wide and deep and BODY_H tall, above the tile
const BODY_H = 1.8;
const BODY_SHRINK = 0.05; // sampled this much inside, like the 0.1 m of the module points
const BODY_STEP = 0.3; // metres between body sample points
const ARC_STEP = 0.25; // a body point moves at most this far between two sweep samples

export class CompiledStage {
  readonly stage: StageFile;
  readonly modules: ModuleInstance[];
  readonly kits = new Map<Id, KitModule>();
  readonly groups = new Map<Id, TransformGroup>();
  readonly consoles = new Map<Id, Interactable>();
  readonly handles = new Map<Id, Handle>();
  readonly tethers: TetherModule[] = [];
  private readonly byId = new Map<Id, ModuleInstance>();
  private readonly groupModules = new Map<Id, Set<Id>>();
  private walkCache = new Map<string, WalkMap>();
  private sweepCache = new Map<string, string[]>();
  private reachCache = new Map<string, string[]>();
  private bodyCache = new Map<string, boolean>();
  private hashCache = new Map<string, BoxHash>();

  constructor(stage: StageFile) {
    this.stage = stage;
    this.modules = stage.modules;
    for (const m of stage.modules) {
      this.kits.set(m.id, buildKit(m));
      this.byId.set(m.id, m);
      if (m.type === 'tether') this.tethers.push(m);
      if (m.group) {
        const set = this.groupModules.get(m.group) ?? new Set<Id>();
        set.add(m.id);
        this.groupModules.set(m.group, set);
      }
    }
    for (const g of stage.groups) this.groups.set(g.id, g);
    for (const c of stage.interactables) this.consoles.set(c.id, c);
    for (const h of stage.handles ?? []) this.handles.set(h.id, h);
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
      tiles.set(ck, { key: ck, cell: rt.cell, module: rt.module, floorY: rt.floorY, open, plate: !!rt.plate, part: rt.tileKey });
    }
    const links = this.computeLinks(s, tiles);
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
    for (const l of links) parent.set(find(l.from), find(l.to));
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
    return { tiles, region, conflicts, links };
  }

  /** A tether in a state: its landing cell, which way its ring faces in the world (null if not horizontal), and the ring. */
  tetherEnd(m: TetherModule, s: PuzzleState): { id: Id; cell: [number, number, number]; key: string; side: Side | null; ring: Vec3; span: number } {
    const T = this.moduleTransform(m, s);
    const cell = cellOfFloorPoint(round3(addT(T, [0, 0, 0])));
    return {
      id: m.id,
      cell,
      key: cellKey(cell),
      side: sideOf(apply(T.R, DIRS[m.params.facing])),
      ring: addT(T, tetherRing(m.params.facing)),
      span: m.params.span ?? TETHER_SPAN,
    };
  }

  /**
   * The threads in a state. Tethers A and B link when their world facings are horizontal and opposite, B's cell is
   * k cells along A's facing (2 <= k <= both spans) and at most 2 levels up or down, B is the first tether on A's ray,
   * both landing cells are walkable, and the segment between the rings is clear of solids other than the modules at the
   * landing cells. A link is two-way, and either tether may be the one whose ray finds the other.
   */
  private computeLinks(s: PuzzleState, tiles: Map<string, WalkTile>): TetherLink[] {
    if (this.tethers.length < 2) return [];
    const ends = this.tethers.map((m) => this.tetherEnd(m, s));
    const found = new Map<string, TetherLink>();
    let hash: BoxHash | null = null;
    for (const A of ends) {
      if (!A.side) continue;
      const f = DIRS[A.side];
      const ahead: { C: (typeof ends)[number]; k: number }[] = [];
      for (const C of ends) {
        if (C === A) continue;
        const d = sub(C.cell, A.cell);
        const k = d[0] * f[0] + d[2] * f[2];
        const aside = f[0] === 0 ? d[0] : d[2];
        if (aside !== 0 || k < 1 || Math.abs(d[1]) > TETHER_RISE) continue;
        ahead.push({ C, k });
      }
      if (!ahead.length) continue;
      const first = Math.min(...ahead.map((x) => x.k));
      for (const { C, k } of ahead) {
        if (k !== first || C.side !== OPPOSITE[A.side] || k < 2 || k > Math.min(A.span, C.span)) continue;
        const ta = tiles.get(A.key);
        const tc = tiles.get(C.key);
        if (!ta || !tc) continue;
        hash ??= new BoxHash(this.worldBoxes(s));
        if (!segmentClear(hash, A.ring, C.ring, new Set([ta.module, tc.module]))) continue;
        const [a, b] = A.id < C.id ? [A, C] : [C, A];
        found.set(`${a.id}|${b.id}`, { a: a.id, b: b.id, from: a.key, to: b.key });
      }
    }
    return [...found.values()].sort((x, y) => (x.a + x.b < y.a + y.b ? -1 : 1));
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
  motionOf(s: PuzzleState, a: Action | StepAction): { axis: 'x' | 'y' | 'z'; quarters: number; pivot: Vec3 } {
    const g = this.groups.get(a.group)!;
    if (a.kind === 'turn') return { axis: a.axis, quarters: a.quarters === 3 ? -1 : a.quarters, pivot: g.pivot };
    if (a.kind === 'step') {
      if (g.kind !== 'states') return { axis: this.handles.get(a.handle)?.axis ?? 'y', quarters: a.dir, pivot: g.pivot };
      const from = s[g.id] ?? g.initial;
      return statesMotion(g, from, this.stepTarget(g, from, a.dir) ?? from);
    }
    if (g.kind !== 'states') throw new Error(`group ${g.id} is not a states group`);
    return statesMotion(g, s[g.id] ?? g.initial, a.to);
  }

  /** The groups a wait advances: the auto groups of the section, or of the whole stage when no section is given. */
  autoGroups(sectionId?: Id): StatesGroup[] {
    const ids = sectionId === undefined ? this.stage.groups.map((g) => g.id) : (this.stage.sections.find((x) => x.id === sectionId)?.groups ?? []);
    const out: StatesGroup[] = [];
    for (const id of ids) {
      const g = this.groups.get(id);
      if (g?.kind === 'states' && g.auto) out.push(g);
    }
    return out;
  }

  /**
   * The index a step reaches in a states group: the neighbour in `states`. The list wraps only when it holds four
   * distinct quarter values (a full turn in four steps); otherwise there is no step past either end (null).
   */
  stepTarget(g: StatesGroup, cur: number, dir: 1 | -1): number | null {
    const next = cur + dir;
    if (next >= 0 && next < g.states.length) return next;
    const quarters = new Set(g.states.map((q) => ((q % 4) + 4) % 4));
    return quarters.size === 4 ? (next + g.states.length) % g.states.length : null;
  }

  /** Every group turn an action makes: one for a console action or a step, one per auto group for a wait. */
  motionsOf(s: PuzzleState, a: PlayerAction): Motion[] {
    if (a.kind === 'wait')
      return this.autoGroups(a.section).map((g) => {
        const from = s[g.id] ?? g.initial;
        return { group: g.id, ...statesMotion(g, from, (from + 1) % g.states.length) };
      });
    return [{ group: a.group, ...this.motionOf(s, a) }];
  }

  /**
   * Module ids (and anchor:<console>) that the action's motion would pass through. `margin` (radians) sweeps that much
   * further before the start and past the end, for a turn that pulls back before it starts and overshoots a little at its
   * end (visual only).
   */
  sweepBlockers(s: PuzzleState, a: PlayerAction, margin: readonly [before: number, after: number] = [0, 0]): string[] {
    const scope = a.kind === 'wait' ? `@${a.section ?? ''}` : '';
    const key = `${this.stateKey(s)}#${actionKey(a)}${scope}${margin[0] || margin[1] ? `+${margin[0].toFixed(4)}+${margin[1].toFixed(4)}` : ''}`;
    const hit = this.sweepCache.get(key);
    if (hit) return hit;
    const out = new Set<string>();
    for (const m of this.motionsOf(s, a)) for (const b of this.sweepGroup(s, m, margin)) out.add(b);
    const res = [...out].sort();
    this.sweepCache.set(key, res);
    return res;
  }

  /** What one group's turn sweeps through (module ids and anchor:<console>). */
  private sweepGroup(s: PuzzleState, motion: Motion, margin: readonly [before: number, after: number]): string[] {
    const g = this.groups.get(motion.group)!;
    const moving = new Set(this.modules.filter((m) => m.group === g.id).map((m) => m.id));
    const all = this.worldBoxes(s);
    const statics = [...all.filter((b) => !moving.has(b.module)), ...this.anchorBoxes()];
    const hash = new BoxHash(statics);
    const points = all.filter((b) => moving.has(b.module)).flatMap(surfacePoints);
    const { axis, quarters, pivot } = motion;
    const total = (quarters * Math.PI) / 2;
    const steps = Math.max(1, Math.ceil(Math.abs(total) / SWEEP_STEP));
    const blockers = new Set<string>();
    // the angles swept: each step along the turn, and the two ends of the margin (before the start, past the end)
    const angles = Array.from({ length: steps }, (_, i) => (total * (i + 1)) / steps);
    if (margin[0] > 0) angles.push(-margin[0] * Math.sign(total));
    if (margin[1] > 0) angles.push(total + margin[1] * Math.sign(total));
    for (const angle of angles) {
      const R = rotAngle(axis, angle);
      for (const p of points) {
        const q = apply(R, sub(p, pivot));
        const w: Vec3 = [q[0] + pivot[0], q[1] + pivot[1], q[2] + pivot[2]];
        for (const b of hash.query(w)) blockers.add(b.module);
      }
    }
    return [...blockers].sort();
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

  apply(s: PuzzleState, a: PlayerAction): PuzzleState {
    const next: Record<Id, number> = { ...s };
    if (a.kind === 'wait') {
      for (const g of this.autoGroups(a.section)) next[g.id] = ((s[g.id] ?? g.initial) + 1) % g.states.length;
    } else if (a.kind === 'step') {
      const g = this.groups.get(a.group)!;
      if (g.kind === 'states') next[g.id] = this.stepTarget(g, s[g.id] ?? g.initial, a.dir) ?? (s[g.id] ?? g.initial);
      else next[g.id] = cubeIndex(mul(rot(this.handles.get(a.handle)?.axis ?? 'y', a.dir), CUBE_GROUP[s[g.id] ?? 0]));
    } else if (a.kind === 'set') next[a.group] = a.to;
    else next[a.group] = cubeIndex(mul(rot(a.axis, a.quarters), CUBE_GROUP[s[a.group] ?? 0]));
    return next;
  }

  // --- handles (v0.5) ---------------------------------------------------------------------------------------------------

  /** Where a handle is in the world: the middle of its cell, `height` metres above that cell's floor. It does not move. */
  handlePoint(h: Handle): [number, number, number] {
    const f = cellFloor(h.at);
    return [f[0], f[1] + (h.height ?? HANDLE_HEIGHT), f[2]];
  }

  /**
   * The walkable cells from which a handle can be used in a state, as sorted cell keys: within `reach` cells
   * horizontally (Euclidean) and one level vertically, with a clear line from the eye (1.5 m above the floor) to the
   * handle point. The modules of the group the handle controls do not block the line.
   */
  handleReach(handleId: Id, s: PuzzleState): string[] {
    const key = `${this.stateKey(s)}#${handleId}`;
    const hit = this.reachCache.get(key);
    if (hit) return hit;
    const h = this.handles.get(handleId)!;
    const own = this.groupModules.get(h.controls) ?? new Set<Id>();
    const hash = new BoxHash(this.worldBoxes(s).filter((b) => !own.has(b.module)));
    const point = this.handlePoint(h);
    const reach = h.reach ?? HANDLE_REACH;
    const out: string[] = [];
    for (const t of this.walkMap(s).tiles.values()) {
      if (Math.hypot(t.cell[0] - h.at[0], t.cell[2] - h.at[2]) > reach + 1e-9 || Math.abs(t.cell[1] - h.at[1]) > 1) continue;
      const f = cellFloor(t.cell);
      if (segmentClear(hash, [f[0], t.floorY + EYE_HEIGHT, f[2]], point, NO_MODULES)) out.push(t.key);
    }
    out.sort();
    this.reachCache.set(key, out);
    return out;
  }

  /** The steps a handle offers in a state (to the neighbouring state each way, or a quarter turn each way), with what blocks each. */
  handleActions(handleId: Id, s: PuzzleState): { action: StepAction; blockedBy: string[] }[] {
    const h = this.handles.get(handleId)!;
    const g = this.groups.get(h.controls)!;
    const cur = s[g.id] ?? g.initial;
    const actions: StepAction[] = [];
    for (const dir of [1, -1] as const) {
      if (g.kind === 'states' && this.stepTarget(g, cur, dir) === null) continue;
      actions.push({ handle: h.id, group: g.id, kind: 'step', dir });
    }
    return actions.map((action) => ({ action, blockedBy: this.sweepBlockers(s, action) }));
  }

  // --- the player in motion (v0.5) ----------------------------------------------------------------------------------------

  /**
   * What an action does to a player standing on `playerCell`. Module sweeps block as sweepBlockers says. A player on a
   * module of a moving group rides: their body (0.8 x 1.8 x 0.8 m above the tile) turns with the group and must clear
   * the statics, and the tile they stand on must land as a walkable, up-facing tile of the same module in the target
   * state, which is their new cell. Otherwise the body is a static obstacle for the moving group ('player' blocks) and
   * the tile must still be there afterwards. Console actions leave the body to the console's anchor box.
   */
  motionOutcome(s: PuzzleState, a: PlayerAction, playerCell: string): MotionOutcome {
    return this.motionOutcomes(s, a, [playerCell]).get(playerCell)!;
  }

  /** The same for a clock tick: every auto group of the section (all of them if no section) advances one step at once. */
  waitOutcome(s: PuzzleState, playerCell: string, sectionId?: Id): MotionOutcome {
    return this.motionOutcome(s, { kind: 'wait', section: sectionId }, playerCell);
  }

  /** motionOutcome for several standing cells at once (the sweeps are shared). */
  motionOutcomes(s: PuzzleState, a: PlayerAction, cells: readonly string[]): Map<string, MotionOutcome> {
    const out = new Map<string, MotionOutcome>();
    const blockers = this.sweepBlockers(s, a);
    const motions = this.motionsOf(s, a);
    const byGroup = new Map(motions.map((m) => [m.group, m]));
    const wm = this.walkMap(s);
    const target = this.apply(s, a);
    const wm2 = this.walkMap(target);
    const consoleAction = 'console' in a;
    for (const cell of cells) {
      const tile = wm.tiles.get(cell);
      const blocked = (player: boolean): MotionOutcome => ({ ok: false, blockedBy: player ? [...blockers, 'player'] : [...blockers] });
      if (!tile) {
        out.set(cell, blocked(true));
        continue;
      }
      const motion = byGroup.get(this.byId.get(tile.module)?.group ?? '');
      if (motion) {
        const landing = this.landing(target, wm2, tile);
        if (landing === null || this.riderHitsStatics(s, motion, tile)) out.set(cell, blocked(true));
        else out.set(cell, blockers.length ? blocked(false) : { ok: true, cell: landing, ride: true });
        continue;
      }
      const after = wm2.tiles.get(cell);
      const stays = !!after && after.module === tile.module && after.part === tile.part;
      const hit = !stays || (!consoleAction && motions.some((m) => this.bodyHitsGroup(s, m, tile)));
      if (hit) out.set(cell, blocked(true));
      else out.set(cell, blockers.length ? blocked(false) : { ok: true, cell, ride: false });
    }
    return out;
  }

  /** Where the tile a rider stands on lands in the target state, when it is a walkable, up-facing tile of that module; else null. */
  private landing(target: PuzzleState, wm2: WalkMap, tile: WalkTile): string | null {
    const m = this.byId.get(tile.module);
    const kt = m && tile.part !== undefined ? this.kits.get(m.id)?.tiles.find((t) => t.key === tile.part) : undefined;
    if (!m || !kt) return null;
    const T = this.moduleTransform(m, target);
    if (!vecEq(apply(T.R, kt.n), DIRS.U)) return null;
    const cell = cellKey(cellOfFloorPoint(round3(addT(T, kt.p))));
    const t2 = wm2.tiles.get(cell);
    return t2 && t2.module === m.id && t2.part === tile.part ? cell : null;
  }

  private cachedHash(key: string, build: () => WorldBox[]): BoxHash {
    let h = this.hashCache.get(key);
    if (!h) {
      h = new BoxHash(build());
      this.hashCache.set(key, h);
    }
    return h;
  }

  /** The body of a rider, turning with the group, against everything that is not in the group. */
  private riderHitsStatics(s: PuzzleState, motion: Motion, tile: WalkTile): boolean {
    const key = `${this.stateKey(s)}#ride:${motion.group}:${motion.axis}${motion.quarters}@${tile.key}`;
    const known = this.bodyCache.get(key);
    if (known !== undefined) return known;
    const own = this.groupModules.get(motion.group) ?? new Set<Id>();
    const hash = this.cachedHash(`${this.stateKey(s)}#statics:${motion.group}`, () => this.worldBoxes(s).filter((b) => !own.has(b.module)));
    const pts = bodyPoints(tile);
    const rMax = Math.max(...pts.map((p) => axisRadius(p, motion.pivot, motion.axis)));
    let hit = false;
    for (const angle of arcAngles((motion.quarters * Math.PI) / 2, rMax)) {
      const R = rotAngle(motion.axis, angle);
      hit = pts.some((p) => {
        const q = apply(R, sub(p, motion.pivot));
        return hash.query([q[0] + motion.pivot[0], q[1] + motion.pivot[1], q[2] + motion.pivot[2]]).length > 0;
      });
      if (hit) break;
    }
    this.bodyCache.set(key, hit);
    return hit;
  }

  /** The body of a player standing still against the modules of a turning group (their solids sweep through the body). */
  private bodyHitsGroup(s: PuzzleState, motion: Motion, tile: WalkTile): boolean {
    const key = `${this.stateKey(s)}#body:${motion.group}:${motion.axis}${motion.quarters}@${tile.key}`;
    const known = this.bodyCache.get(key);
    if (known !== undefined) return known;
    const own = this.groupModules.get(motion.group) ?? new Set<Id>();
    const boxes = this.worldBoxes(s).filter((b) => own.has(b.module));
    const hash = this.cachedHash(`${this.stateKey(s)}#moving:${motion.group}`, () => boxes);
    const ax = AXIS_INDEX[motion.axis];
    let aMin = Infinity;
    let aMax = -Infinity;
    let rMaxBox = 0;
    for (const b of boxes)
      for (const x of [b.min[0], b.max[0]])
        for (const y of [b.min[1], b.max[1]])
          for (const z of [b.min[2], b.max[2]]) {
            const c: Vec3 = [x, y, z];
            aMin = Math.min(aMin, c[ax] - motion.pivot[ax]);
            aMax = Math.max(aMax, c[ax] - motion.pivot[ax]);
            rMaxBox = Math.max(rMaxBox, axisRadius(c, motion.pivot, motion.axis));
          }
    const pts = bodyPoints(tile);
    const along = pts.map((p) => p[ax] - motion.pivot[ax]);
    const radii = pts.map((p) => axisRadius(p, motion.pivot, motion.axis));
    // a body outside the cylinder the group sweeps cannot be hit
    let hit = false;
    if (!(Math.max(...along) < aMin - 0.1 || Math.min(...along) > aMax + 0.1 || Math.min(...radii) > rMaxBox + 0.1)) {
      for (const angle of arcAngles((motion.quarters * Math.PI) / 2, Math.max(...radii))) {
        // a point of the body inside a moved box is the same as its turned-back point inside the box at rest
        const R = rotAngle(motion.axis, -angle);
        hit = pts.some((p) => {
          const q = apply(R, sub(p, motion.pivot));
          return hash.query([q[0] + motion.pivot[0], q[1] + motion.pivot[1], q[2] + motion.pivot[2]]).length > 0;
        });
        if (hit) break;
      }
    }
    this.bodyCache.set(key, hit);
    return hit;
  }

  /** Transform a point given in a module's local frame to world space for a state. */
  toWorld(m: ModuleInstance, s: PuzzleState, p: Vec3): [number, number, number] {
    return addT(this.moduleTransform(m, s), p);
  }
}

export function actionKey(a: PlayerAction): string {
  if (a.kind === 'wait') return 'wait';
  if (a.kind === 'step') return `${a.handle}:step${a.dir > 0 ? '+1' : '-1'}`;
  return a.kind === 'set' ? `${a.console}:set${a.to}` : `${a.console}:${a.axis}${a.quarters * 90}`;
}

function statesMotion(g: StatesGroup, from: number, to: number): { axis: 'x' | 'y' | 'z'; quarters: number; pivot: Vec3 } {
  const dq = (((g.states[to] - g.states[from]) % 4) + 4) % 4;
  return { axis: g.axis, quarters: dq === 3 ? -1 : dq, pivot: g.pivot };
}

const AXIS_INDEX = { x: 0, y: 1, z: 2 } as const;
const NO_MODULES: ReadonlySet<Id> = new Set();

/** Distance of a point from the axis through `pivot`. */
function axisRadius(p: Vec3, pivot: Vec3, axis: 'x' | 'y' | 'z'): number {
  const d = sub(p, pivot);
  return axis === 'x' ? Math.hypot(d[1], d[2]) : axis === 'y' ? Math.hypot(d[0], d[2]) : Math.hypot(d[0], d[1]);
}

/** Sample angles along a turn, fine enough that a point `rMax` from the axis moves at most ARC_STEP between two. */
function arcAngles(total: number, rMax: number): number[] {
  const n = Math.min(4000, Math.max(1, Math.ceil(Math.abs(total) / SWEEP_STEP), Math.ceil((Math.abs(total) * rMax) / ARC_STEP)));
  return Array.from({ length: n }, (_, i) => (total * (i + 1)) / n);
}

/** Points through the volume of the player's body (0.8 x 1.8 x 0.8 m on the floor of a tile, a hair smaller), about 0.3 m apart. */
function bodyPoints(tile: WalkTile): Vec3[] {
  const f = cellFloor(tile.cell);
  const hw = BODY_W / 2 - BODY_SHRINK;
  const y0 = tile.floorY + BODY_SHRINK;
  const y1 = tile.floorY + BODY_H - BODY_SHRINK;
  const nx = Math.max(1, Math.ceil((2 * hw) / BODY_STEP));
  const ny = Math.max(1, Math.ceil((y1 - y0) / BODY_STEP));
  const pts: Vec3[] = [];
  for (let i = 0; i <= nx; i++)
    for (let j = 0; j <= ny; j++)
      for (let k = 0; k <= nx; k++) pts.push([f[0] - hw + (2 * hw * i) / nx, y0 + ((y1 - y0) * j) / ny, f[2] - hw + (2 * hw * k) / nx]);
  return pts;
}

/** True when no solid (other than the `ignore` modules) holds a sample of the segment, sampled every LINE_STEP metres. */
function segmentClear(hash: BoxHash, a: Vec3, b: Vec3, ignore: ReadonlySet<Id>): boolean {
  const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) / LINE_STEP));
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const p: Vec3 = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
    for (const box of hash.query(p)) if (!ignore.has(box.module)) return false;
  }
  return true;
}

export function step(c: Vec3, s: Side): [number, number, number] {
  const d = DIRS[s];
  return [c[0] + d[0], c[1], c[2] + d[2]];
}

/**
 * Shortest walk over the walk map from one tile to the nearest of `targets`, as the cell keys to pass through
 * (start excluded; empty when already there), or null when none is reachable. Uses the same rule as the player:
 * a tile is left through an open edge into an existing tile, or along a tether link (a hop to a cell that is not
 * next to it: `wm.links` says which).
 */
export function walkPath(wm: WalkMap, from: string, targets: Iterable<string>): string[] | null {
  const goal = new Set(targets);
  if (goal.has(from)) return [];
  const linked = linkNeighbours(wm);
  const prev = new Map<string, string>([[from, '']]);
  const queue = [from];
  for (let i = 0; i < queue.length; i++) {
    const t = wm.tiles.get(queue[i]);
    if (!t) continue;
    const around: string[] = [];
    for (const s of SIDES) {
      const n = cellKey(step(t.cell, s));
      if (t.open[s] && wm.tiles.has(n)) around.push(n);
    }
    around.push(...(linked.get(t.key) ?? []));
    for (const n of around) {
      if (prev.has(n)) continue;
      prev.set(n, t.key);
      if (goal.has(n)) {
        const path = [n];
        for (let k = t.key; k !== from; k = prev.get(k)!) path.unshift(k);
        return path;
      }
      queue.push(n);
    }
  }
  return null;
}

/** The fewest tether links a walk from `from` to the nearest of `targets` must cross (null when none is reachable). */
export function walkLinks(wm: WalkMap, from: string, targets: Iterable<string>): number | null {
  const goal = new Set(targets);
  const linked = linkNeighbours(wm);
  const dist = new Map<string, number>([[from, 0]]);
  let level = [from];
  for (let d = 0; level.length; d++) {
    const next: string[] = [];
    for (let i = 0; i < level.length; i++) {
      const k = level[i];
      if (dist.get(k) !== d) continue;
      if (goal.has(k)) return d;
      const t = wm.tiles.get(k);
      if (!t) continue;
      for (const s of SIDES) {
        const n = cellKey(step(t.cell, s));
        if (t.open[s] && wm.tiles.has(n) && (dist.get(n) ?? Infinity) > d) {
          dist.set(n, d);
          level.push(n);
        }
      }
      for (const n of linked.get(k) ?? [])
        if (!dist.has(n)) {
          dist.set(n, d + 1);
          next.push(n);
        }
    }
    level = next;
  }
  return null;
}

function linkNeighbours(wm: WalkMap): Map<string, string[]> {
  const m = new Map<string, string[]>();
  for (const l of wm.links) {
    m.set(l.from, [...(m.get(l.from) ?? []), l.to]);
    m.set(l.to, [...(m.get(l.to) ?? []), l.from]);
  }
  return m;
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
