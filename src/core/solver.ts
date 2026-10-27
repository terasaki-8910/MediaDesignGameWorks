// Shortest console-action plans over (puzzle state, walkable region). Walking is free; each console use costs 1.
import { actionKey, type CompiledStage } from './compile.ts';
import { cellKey } from './math.ts';
import type { Action, Id, PuzzleState } from './types.ts';

export interface SolveOptions {
  state?: PuzzleState;
  cell?: string; // cell key the player stands on
  disabledConsoles?: Set<Id>;
  maxNodes?: number;
  withFirstMoves?: boolean;
}

export interface SolveResult {
  optimal: number | null;
  plan: Action[];
  explored: number;
  deadEnds: number;
  /** For each action available at the start: extra actions it costs compared with the optimum. */
  firstMoves: { action: Action; key: string; penalty: number | null }[];
}

interface Node { state: PuzzleState; cell: string; key: string }

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
  const expand = (n: Node): { action: Action; next: Node }[] => {
    const wm = cs.walkMap(n.state);
    const r = wm.region.get(n.cell);
    const out: { action: Action; next: Node }[] = [];
    for (const c of consoles) {
      const ck = cellKey(c.at);
      if (wm.region.get(ck) !== r) continue;
      for (const { action, blockedBy } of cs.consoleActions(c.id, n.state)) {
        if (blockedBy.length) continue;
        const next = nodeOf(cs.apply(n.state, action), ck);
        if (next) out.push({ action, next });
      }
    }
    return out;
  };

  const first = nodeOf(state0, cell0);
  if (!first) throw new Error(`start cell ${cell0} is not walkable in section ${sectionId}`);
  const dist = new Map<string, number>([[first.key, 0]]);
  const nodes = new Map<string, Node>([[first.key, first]]);
  const parent = new Map<string, { prev: string; action: Action } | null>([[first.key, null]]);
  const edges = new Map<string, string[]>();
  const queue: Node[] = [first];
  const max = opts.maxNodes ?? 20000;
  while (queue.length && nodes.size <= max) {
    const n = queue.shift()!;
    const d = dist.get(n.key)!;
    const succ: string[] = [];
    for (const { action, next } of expand(n)) {
      succ.push(next.key);
      if (!dist.has(next.key)) {
        dist.set(next.key, d + 1);
        nodes.set(next.key, next);
        parent.set(next.key, { prev: n.key, action });
        queue.push(next);
      }
    }
    edges.set(n.key, succ);
  }
  return { first, dist, nodes, parent, edges, isGoal, expand };
}

export function solveSection(cs: CompiledStage, sectionId: Id, opts: SolveOptions = {}): SolveResult {
  const { first, dist, nodes, parent, edges, isGoal, expand } = search(cs, sectionId, opts);
  const goals = [...nodes.values()].filter(isGoal);
  let best: Node | null = null;
  for (const g of goals) if (!best || dist.get(g.key)! < dist.get(best.key)!) best = g;

  const plan: Action[] = [];
  if (best) {
    let k = best.key;
    while (parent.get(k)) {
      const p = parent.get(k)!;
      plan.unshift(p.action);
      k = p.prev;
    }
  }

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
  const firstMoves = !opts.withFirstMoves ? [] : expand(first).map(({ action, next }) => {
    const sub = optimal === null ? null : solveFrom(cs, sectionId, next.state, next.cell, opts);
    return { action, key: actionKey(action), penalty: sub === null || optimal === null ? null : 1 + sub - optimal };
  });
  return { optimal, plan, explored: nodes.size, deadEnds, firstMoves };
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

/** Remaining optimal actions from a position, or null when the goal cannot be reached (soft-lock). */
export function remainingActions(cs: CompiledStage, sectionId: Id, state: PuzzleState, cell: string): number | null {
  return solveFrom(cs, sectionId, state, cell, {});
}
