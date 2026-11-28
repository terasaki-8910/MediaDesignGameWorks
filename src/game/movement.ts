// What the player may do from where they stand, as pure functions of the compiled stage: which thread a Space swings along (and
// which one it chains into), which handle Q and E turn, and where the player may walk while a group is on the move. No DOM and no
// three.js scene, so tests/movement.test.ts runs them on the prototype stage; game.ts and the demo use the same ones.
import { step, type CompiledStage, type TetherLink, type WalkMap, type WalkTile } from '../core/compile.ts';
import { SIDES, cellFloor, cellKey, parseCell, type Vec3 } from '../core/math.ts';
import type { Id, PlayerAction, PuzzleState } from '../core/types.ts';

// --- threads -----------------------------------------------------------------------------------------------------------------

/** A thread seen from one of its landing cells: where it goes, and the two tethers (module ids) it joins, this end's first. */
export interface LinkStep { link: TetherLink; from: string; to: string; fromTether: Id; toTether: Id }

/** The threads that have a landing cell at `cell`, each turned to start there, ordered by where they go. */
export function linkSteps(wm: WalkMap, cell: string): LinkStep[] {
  const out: LinkStep[] = [];
  for (const l of wm.links) {
    if (l.from === cell) out.push({ link: l, from: l.from, to: l.to, fromTether: l.a, toTether: l.b });
    else if (l.to === cell) out.push({ link: l, from: l.to, to: l.from, fromTether: l.b, toTether: l.a });
  }
  return out.sort((x, y) => (x.to < y.to ? -1 : x.to > y.to ? 1 : 0));
}

/** How many cells apart two cells of a thread are (the cells in a line: the one distance that is not 0). */
export function cellsApart(from: string, to: string): number {
  const a = parseCell(from);
  const b = parseCell(to);
  return Math.abs(a[0] - b[0]) + Math.abs(a[2] - b[2]);
}

/**
 * The thread a Space swings along from `steps` (what `linkSteps` found): the one that goes most nearly the way the camera
 * looks (`forward`, a direction on the ground), the first of them when none is better. Null for no thread.
 */
export function pickLinkStep(steps: readonly LinkStep[], forward: { x: number; z: number }): LinkStep | null {
  let best: LinkStep | null = null;
  let bestDot = -Infinity;
  const len = Math.hypot(forward.x, forward.z) || 1;
  for (const s of steps) {
    const a = parseCell(s.from);
    const b = parseCell(s.to);
    const dx = b[0] - a[0];
    const dz = b[2] - a[2];
    const dot = (dx * forward.x + dz * forward.z) / ((Math.hypot(dx, dz) || 1) * len);
    if (dot > bestDot + 1e-9) {
      best = s;
      bestDot = dot;
    }
  }
  return best;
}

/**
 * The threads a swing that has just reached `landing` (having come from `cameFrom`) could go on along without landing: the
 * threads at the landing cell other than the one it came by. Empty: Space does nothing special, the swing lands.
 */
export function chainSteps(wm: WalkMap, landing: string, cameFrom: string): LinkStep[] {
  return linkSteps(wm, landing).filter((s) => s.to !== cameFrom);
}

// --- handles -----------------------------------------------------------------------------------------------------------------

/** A handle the player could turn from where they stand: its id and its point in the world. */
export interface HandleCandidate { id: Id; point: Vec3 }

/**
 * The handle Q and E turn: of those in reach, the one that is nearest the camera's forward direction (the smallest angle between
 * `forward` and the line from the camera to the handle). The first id when two are the same angle; null for none.
 */
export function targetHandle(candidates: readonly HandleCandidate[], cam: { pos: Vec3; forward: Vec3 }): Id | null {
  const fl = Math.hypot(cam.forward[0], cam.forward[1], cam.forward[2]) || 1;
  let best: Id | null = null;
  let bestCos = -Infinity;
  for (const c of [...candidates].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) {
    const d: Vec3 = [c.point[0] - cam.pos[0], c.point[1] - cam.pos[1], c.point[2] - cam.pos[2]];
    const dl = Math.hypot(d[0], d[1], d[2]) || 1;
    const cos = (d[0] * cam.forward[0] + d[1] * cam.forward[1] + d[2] * cam.forward[2]) / (dl * fl);
    if (cos > bestCos + 1e-9) {
      best = c.id;
      bestCos = cos;
    }
  }
  return best;
}

/**
 * Which way the keys turn the targeted handle: Q is a step back (-1), E a step on (+1), except where the player stands at a
 * console, where E belongs to Fold Mode (the console wins). Null when neither key counts. Q first, if both were pressed.
 */
export function handleKeyDir(keys: { q: boolean; e: boolean }, atConsole: boolean): 1 | -1 | null {
  if (keys.q) return -1;
  if (keys.e && !atConsole) return 1;
  return null;
}

/** The handles of a section that can be used from `cell` in a state (their reach holds the cell). */
export function handlesInReach(cs: CompiledStage, handleIds: readonly Id[], state: PuzzleState, cell: string): HandleCandidate[] {
  const out: HandleCandidate[] = [];
  for (const id of handleIds) {
    const h = cs.handles.get(id);
    if (h && cs.handleReach(id, state).includes(cell)) out.push({ id, point: cs.handlePoint(h) });
  }
  return out;
}

// --- walking while a group is on the move --------------------------------------------------------------------------------------

/**
 * Where the player may walk while `action` plays out in real time, as a walk map that is a part of both the map before and the
 * map after. A tile stays only when the action leaves a player standing on it alone (`motionOutcomes`: no ride, nothing in the
 * body's way, the tile still there afterwards, so neither a tile of the moving group nor one its sweep reaches); an edge stays
 * only when it is open in both maps and both its tiles stay; a thread stays only when both maps have it and neither of its
 * tethers is on the moving group. The player then stands, whenever the turn is over, on a tile the solver counted on, in the
 * region it counted on. `cells` limits the work to those tiles (the player's region); the rest are dropped.
 */
export function walkWhileMoving(cs: CompiledStage, state: PuzzleState, action: PlayerAction, cells?: Iterable<string>): WalkMap {
  const before = cs.walkMap(state);
  const after = cs.walkMap(cs.apply(state, action));
  const moving = new Set(cs.motionsOf(state, action).map((m) => m.group));
  const mine = [...(cells ?? before.tiles.keys())].filter((k) => before.tiles.has(k));
  const outcomes = cs.motionOutcomes(state, action, mine);
  const keep = new Set<string>();
  for (const k of mine) {
    const o = outcomes.get(k);
    if (o?.ok && !o.ride && after.tiles.has(k)) keep.add(k);
  }
  const tiles = new Map<string, WalkTile>();
  for (const k of keep) {
    const t = before.tiles.get(k)!;
    const t2 = after.tiles.get(k)!;
    const open = { ...t.open };
    for (const side of SIDES) open[side] = t.open[side] && t2.open[side] && keep.has(cellKey(step(t.cell, side)));
    tiles.set(k, { ...t, open });
  }
  const tetherGroup = (id: Id) => cs.modules.find((m) => m.id === id)?.group;
  const sameLink = (a: TetherLink, b: TetherLink) => a.a === b.a && a.b === b.b && a.from === b.from && a.to === b.to;
  const links = before.links.filter(
    (l) =>
      keep.has(l.from) && keep.has(l.to) && after.links.some((x) => sameLink(x, l)) &&
      ![l.a, l.b].some((id) => moving.has(tetherGroup(id) ?? '')),
  );
  const region = new Map<string, number>();
  for (const k of keep) region.set(k, before.region.get(k)!);
  return { tiles, region, conflicts: [], links };
}

/**
 * The map the parapets are laid on while `action` plays out (world.ts): the whole map before the action, less the tiles of the
 * groups that move, with the edges that led to them closed. Unlike `walkWhileMoving` it keeps every other tile of the stage, in
 * whatever region (the player's walk is a safe part of it; the parapets belong to everything that stays), so that no platform
 * goes bare for the turn and pops its walls back at the stop.
 */
export function railsWhileMoving(cs: CompiledStage, state: PuzzleState, action: PlayerAction): WalkMap {
  const before = cs.walkMap(state);
  const moving = new Set(cs.motionsOf(state, action).map((m) => m.group));
  const keep = new Set([...before.tiles.values()].filter((t) => !moving.has(cs.modules.find((m) => m.id === t.module)?.group ?? '')).map((t) => t.key));
  const tiles = new Map<string, WalkTile>();
  for (const k of keep) {
    const t = before.tiles.get(k)!;
    const open = { ...t.open };
    for (const side of SIDES) open[side] = t.open[side] && keep.has(cellKey(step(t.cell, side)));
    tiles.set(k, { ...t, open });
  }
  const tetherMoves = (id: Id) => moving.has(cs.modules.find((m) => m.id === id)?.group ?? '');
  const links = before.links.filter((l) => keep.has(l.from) && keep.has(l.to) && !tetherMoves(l.a) && !tetherMoves(l.b));
  const region = new Map<string, number>();
  for (const k of keep) region.set(k, before.region.get(k)!);
  return { tiles, region, conflicts: [], links };
}

/** The point on a landing cell where the player stands: the middle of its floor. */
export function landingPoint(wm: WalkMap, cell: string): [number, number, number] {
  const t = wm.tiles.get(cell);
  const f = cellFloor(parseCell(cell));
  return [f[0], t?.floorY ?? f[1], f[2]];
}
