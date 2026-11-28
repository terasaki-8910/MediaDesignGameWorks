// Shortest plans over (puzzle state, walkable region). Walking is free. A console action or a handle step costs 1; a
// wait (the clockwork ticks) costs 0, so `optimal` is the least number of actions the player takes.
import { actionKey, walkLinks, type CompiledStage, type WalkMap } from './compile.ts';
import { cellKey } from './math.ts';
import type { Action, Id, PlayerAction, PuzzleState } from './types.ts';

export interface SolveOptions {
  state?: PuzzleState;
  cell?: string; // cell key the player stands on
  disabledConsoles?: Set<Id>; // consoles or handles that may not be used
  maxNodes?: number;
  withFirstMoves?: boolean;
}

/** One move of a plan: what the player does, where they stand to do it, and where they stand afterwards. */
export interface PlanMove {
  action: PlayerAction;
  key: string;
  at: string; // cell key the player stands on (a console action: the console's cell)
  to: string; // cell key after it (the same as `at`, unless the player rode a turning group)
  ride: boolean;
  cost: 0 | 1;
}

export interface SolveResult {
  optimal: number | null;
  /** The console actions of one optimal plan, in order. With handles or clockwork in the section, `moves` is the whole plan. */
  plan: Action[];
  /** One optimal plan in full: console actions, handle steps and waits, each with the cell to stand on. */
  moves: PlanMove[];
  /** On that plan: how many waits, how many tether links the walking between moves must cross (at least), how many rides. */
  waits: number;
  links: number;
  rides: number;
  explored: number;
  deadEnds: number;
  /** For each action available at the start: extra actions it costs compared with the optimum. */
  firstMoves: { action: PlayerAction; key: string; penalty: number | null }[];
}

interface Node { state: PuzzleState; cell: string; key: string }
interface Edge { action: PlayerAction; next: Node; cost: 0 | 1; at: string; to: string; ride: boolean }

export function sectionStart(cs: CompiledStage, sectionId: Id): { state: PuzzleState; cell: string } {
  const sec = cs.stage.sections.find((s) => s.id === sectionId)!;
  const cp = cs.stage.checkpoints.find((c) => c.id === sec.start)!;
  return { state: cs.initialState(), cell: cellKey(cp.at) };
}

function search(cs: CompiledStage, sectionId: Id, opts: SolveOptions) {
  const sec = cs.stage.sections.find((s) => s.id === sectionId);
  if (!sec) throw new Error(`unknown section ${sectionId}`);
  const start = sectionStart(cs, sectionId);
  const state0 = opts.state ?? start.state;
  const cell0 = opts.cell ?? start.cell;
  const exits = sec.exit.map((c) => cellKey(c));
  const consoles = sec.consoles
    .filter((id) => !opts.disabledConsoles?.has(id))
    .map((id) => cs.consoles.get(id)!)
    .filter(Boolean);
  const handles = (sec.handles ?? [])
    .filter((id) => !opts.disabledConsoles?.has(id))
    .map((id) => cs.handles.get(id)!)
    .filter(Boolean);
  const clockwork = cs.autoGroups(sectionId).length > 0;

  const nodeOf = (state: PuzzleState, cell: string): Node | null => {
    const wm = cs.walkMap(state);
    const r = wm.region.get(cell);
    if (r === undefined) return null;
    return { state, cell, key: `${cs.stateKey(state)}#${r}` };
  };
  const isGoal = (n: Node) => {
    const wm = cs.walkMap(n.state);
    const r = wm.region.get(n.cell);
    return exits.some((e) => wm.region.get(e) === r);
  };

  // the cells of each region of a walk map, in tile order
  const regionCells = new WeakMap<WalkMap, Map<number, string[]>>();
  const cellsOf = (wm: WalkMap, r: number): string[] => {
    let byRegion = regionCells.get(wm);
    if (!byRegion) {
      byRegion = new Map();
      for (const [k, id] of wm.region) {
        const list = byRegion.get(id);
        if (list) list.push(k);
        else byRegion.set(id, [k]);
      }
      regionCells.set(wm, byRegion);
    }
    return byRegion.get(r) ?? [];
  };

  /** The edges of one action done from several standing cells: one per distinct next node, standing still before riding. */
  const fromCells = (n: Node, action: PlayerAction, stand: string[]): Edge[] => {
    const outcomes = cs.motionOutcomes(n.state, action, stand);
    const target = cs.apply(n.state, action);
    const ok: { at: string; to: string; ride: boolean }[] = [];
    for (const at of stand) {
      const o = outcomes.get(at)!;
      if (o.ok) ok.push({ at, to: o.cell, ride: o.ride });
    }
    ok.sort((a, b) => Number(a.ride) - Number(b.ride));
    const seen = new Set<string>();
    const edges: Edge[] = [];
    for (const { at, to, ride } of ok) {
      const next = nodeOf(target, to);
      if (!next || seen.has(next.key)) continue;
      seen.add(next.key);
      edges.push({ action, next, cost: action.kind === 'wait' ? 0 : 1, at, to, ride });
    }
    return edges;
  };

  const expand = (n: Node): Edge[] => {
    const wm = cs.walkMap(n.state);
    const r = wm.region.get(n.cell);
    const out: Edge[] = [];
    // a console action: the player stands at the console, and is there afterwards
    for (const c of consoles) {
      const ck = cellKey(c.at);
      if (wm.region.get(ck) !== r) continue;
      for (const { action, blockedBy } of cs.consoleActions(c.id, n.state)) {
        if (blockedBy.length) continue;
        const next = nodeOf(cs.apply(n.state, action), ck);
        if (next) out.push({ action, next, cost: 1, at: ck, to: ck, ride: false });
      }
    }
    if (r === undefined) return out;
    // a handle step: from any cell of the region within the handle's reach
    for (const h of handles) {
      const stand = cs.handleReach(h.id, n.state).filter((c) => wm.region.get(c) === r);
      if (!stand.length) continue;
      for (const { action } of cs.handleActions(h.id, n.state)) out.push(...fromCells(n, action, stand));
    }
    // a wait: from any cell of the region
    if (clockwork) out.push(...fromCells(n, { kind: 'wait', section: sectionId }, cellsOf(wm, r)));
    return out;
  };

  const first = nodeOf(state0, cell0);
  if (!first) throw new Error(`start cell ${cell0} is not walkable in section ${sectionId}`);
  const dist = new Map<string, number>([[first.key, 0]]);
  const nodes = new Map<string, Node>([[first.key, first]]);
  const parent = new Map<string, { prev: string; edge: Edge } | null>([[first.key, null]]);
  const edges = new Map<string, string[]>();
  // 0-1 breadth-first search: a level holds the nodes at one cost, and a wait stays in its level
  const done = new Set<string>();
  const max = opts.maxNodes ?? 20000;
  let level: Node[] = [first];
  for (let d = 0; level.length && nodes.size <= max; d++) {
    const later: Node[] = [];
    for (let i = 0; i < level.length && nodes.size <= max; i++) {
      const n = level[i];
      if (done.has(n.key) || dist.get(n.key) !== d) continue;
      done.add(n.key);
      const succ: string[] = [];
      for (const edge of expand(n)) {
        const next = edge.next;
        succ.push(next.key);
        const old = dist.get(next.key);
        const nd = d + edge.cost;
        if (old !== undefined && old <= nd) continue;
        dist.set(next.key, nd);
        nodes.set(next.key, next);
        parent.set(next.key, { prev: n.key, edge });
        (edge.cost === 0 ? level : later).push(next);
      }
      edges.set(n.key, succ);
    }
    level = later;
  }
  return { first, state0, cell0, exits, dist, nodes, parent, edges, isGoal, expand };
}

export function solveSection(cs: CompiledStage, sectionId: Id, opts: SolveOptions = {}): SolveResult {
  const { first, state0, cell0, exits, dist, nodes, parent, edges, isGoal, expand } = search(cs, sectionId, opts);
  const goals = [...nodes.values()].filter(isGoal);
  let best: Node | null = null;
  for (const g of goals) if (!best || dist.get(g.key)! < dist.get(best.key)!) best = g;

  const moves: PlanMove[] = [];
  if (best) {
    let k = best.key;
    while (parent.get(k)) {
      const p = parent.get(k)!;
      const e = p.edge;
      moves.unshift({ action: e.action, key: actionKey(e.action), at: e.at, to: e.to, ride: e.ride, cost: e.cost });
      k = p.prev;
    }
  }
  const plan = moves.map((m) => m.action).filter((a): a is Action => 'console' in a);

  // Dead ends: explored nodes from which no goal is reachable.
  const canReach = new Set(goals.map((g) => g.key));
  let changed = true;
  while (changed) {
    changed = false;
    for (const [k, succ] of edges)
      if (!canReach.has(k) && succ.some((s) => canReach.has(s))) {
        canReach.add(k);
        changed = true;
      }
  }
  const deadEnds = [...nodes.keys()].filter((k) => !canReach.has(k)).length;

  const optimal = best ? dist.get(best.key)! : null;
  // the tether links the walking on this plan must cross: from the start to each stand cell, and from the last cell to an exit
  let links = 0;
  if (best) {
    let state = state0;
    let cell = cell0;
    for (const m of moves) {
      links += walkLinks(cs.walkMap(state), cell, [m.at]) ?? 0;
      state = cs.apply(state, m.action);
      cell = m.to;
    }
    links += walkLinks(cs.walkMap(state), cell, exits) ?? 0;
  }

  const firstMoves: SolveResult['firstMoves'] = [];
  if (opts.withFirstMoves) {
    const byKey = new Map<string, SolveResult['firstMoves'][number]>();
    for (const e of expand(first)) {
      const key = actionKey(e.action);
      const sub = optimal === null ? null : solveFrom(cs, sectionId, e.next.state, e.next.cell, opts);
      const penalty = sub === null || optimal === null ? null : e.cost + sub - optimal;
      const old = byKey.get(key);
      if (!old) byKey.set(key, { action: e.action, key, penalty });
      else if (penalty !== null && (old.penalty === null || penalty < old.penalty)) old.penalty = penalty;
    }
    firstMoves.push(...byKey.values());
  }
  return {
    optimal,
    plan,
    moves,
    waits: moves.filter((m) => m.action.kind === 'wait').length,
    links,
    rides: moves.filter((m) => m.ride).length,
    explored: nodes.size,
    deadEnds,
    firstMoves,
  };
}

/** The states the player can bring about in a section, with a cell in each region they can be in (what the validator checks over). */
export function reachableNodes(cs: CompiledStage, sectionId: Id, opts: SolveOptions = {}): { state: PuzzleState; cell: string; region: number }[] {
  const { nodes } = search(cs, sectionId, opts);
  return [...nodes.values()].map((n) => ({ state: n.state, cell: n.cell, region: cs.walkMap(n.state).region.get(n.cell)! }));
}

function solveFrom(cs: CompiledStage, sectionId: Id, state: PuzzleState, cell: string, opts: SolveOptions): number | null {
  const { dist, nodes, isGoal } = search(cs, sectionId, { ...opts, state, cell });
  let best: number | null = null;
  for (const n of nodes.values()) if (isGoal(n)) best = best === null ? dist.get(n.key)! : Math.min(best, dist.get(n.key)!);
  return best;
}

/** The next console action of an optimal plan from where the player is now (null if solved or stuck). */
export function nextAction(cs: CompiledStage, sectionId: Id, state: PuzzleState, cell: string): Action | null {
  const r = solveSection(cs, sectionId, { state, cell });
  return r.plan[0] ?? null;
}

/** The next move of an optimal plan from where the player is now, of any kind and with the cell to stand on (null if solved or stuck). */
export function nextMove(cs: CompiledStage, sectionId: Id, state: PuzzleState, cell: string): PlanMove | null {
  const r = solveSection(cs, sectionId, { state, cell });
  return r.moves[0] ?? null;
}

/** Remaining optimal actions (console actions and handle steps; waits are free) from a position, or null when the goal cannot be reached (soft-lock). */
export function remainingActions(cs: CompiledStage, sectionId: Id, state: PuzzleState, cell: string): number | null {
  return solveFrom(cs, sectionId, state, cell, {});
}
