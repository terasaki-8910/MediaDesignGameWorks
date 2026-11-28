// Stage validator shared by CI, the stage CLI and the AI loop's proposal check.
import { CompiledStage, actionKey } from './compile.ts';
import { kitErrors } from './kit.ts';
import { CUBE_GROUP, cellKey } from './math.ts';
import { resolveSlots } from './slots.ts';
import { reachableNodes, solveSection } from './solver.ts';
import type { Id, PuzzleState, StageFile } from './types.ts';

/** Below this the clockwork leaves too little time to cross while the group rests (C5). */
export const MIN_DWELL_MS = 900;

export interface Issue { rule: string; level: 'error' | 'warning'; message: string }

export interface SectionMetrics {
  optimal: number | null;
  explored: number;
  deadEnds: number;
  firstMoves: { key: string; penalty: number | null }[];
  /** On the optimal plan: waits for the clockwork, tether links the walking must cross, rides on a turning group. */
  waits: number;
  links: number;
  rides: number;
}

export interface StageReport {
  stageId: string;
  version: string;
  issues: Issue[];
  sections: Record<Id, SectionMetrics>;
  ok: boolean;
}

export function validateStage(input: StageFile, opts: { checkSlotOptions?: boolean } = {}): StageReport {
  const stage = resolveSlots(input);
  const issues: Issue[] = [];
  const err = (rule: string, message: string) => issues.push({ rule, level: 'error', message });
  const warn = (rule: string, message: string) => issues.push({ rule, level: 'warning', message });
  const sections: Record<Id, SectionMetrics> = {};

  // S1 / S2: shape, unique ids, references
  if (stage.schema !== 'fold-city/stage@1') err('S1', `unknown schema ${String(stage.schema)}`);
  const ids = new Set<string>();
  const unique = (kind: string, list: { id: string }[]) => {
    for (const x of list) {
      if (ids.has(`${kind}:${x.id}`)) err('S2', `duplicate ${kind} id ${x.id}`);
      ids.add(`${kind}:${x.id}`);
    }
  };
  unique('module', stage.modules);
  unique('group', stage.groups);
  unique('console', stage.interactables);
  unique('handle', stage.handles ?? []);
  unique('section', stage.sections);
  unique('checkpoint', stage.checkpoints);
  unique('slot', stage.slots ?? []);
  const has = (kind: string, id: string) => ids.has(`${kind}:${id}`);
  for (const m of stage.modules) if (m.group && !has('group', m.group)) err('S2', `${m.id}: unknown group ${m.group}`);
  for (const c of stage.interactables) {
    if (!has('group', c.controls)) err('S2', `${c.id}: unknown group ${c.controls}`);
    const g = stage.groups.find((g) => g.id === c.controls);
    if (g?.kind === 'orientation' && !c.axis) err('S2', `${c.id}: consoles of orientation groups need an axis`);
  }
  for (const h of stage.handles ?? []) {
    if (has('console', h.id)) err('S2', `${h.id}: a handle and a console share this id (mustUse names either)`);
    if (!has('group', h.controls)) err('S2', `${h.id}: unknown group ${h.controls}`);
    const g = stage.groups.find((g) => g.id === h.controls);
    if (g?.kind === 'orientation' && !h.axis) err('S2', `${h.id}: handles of orientation groups need an axis`);
    if (h.reach !== undefined && !(h.reach > 0)) err('S2', `${h.id}: reach must be positive`);
  }
  for (const g of stage.groups) {
    const auto = (g as { auto?: { periodMs: number; dwellMs: number } }).auto;
    if (!auto) continue;
    if (g.kind !== 'states') err('S2', `${g.id}: only states groups can run on a clock`);
    else if (g.states.length < 2) err('S2', `${g.id}: a group on a clock needs at least two states`);
    if (!(auto.periodMs > 0)) err('S2', `${g.id}: periodMs must be positive`);
    if (!(auto.dwellMs >= 0)) err('S2', `${g.id}: dwellMs must be zero or more`);
  }
  for (const s of stage.sections) {
    for (const g of s.groups) if (!has('group', g)) err('S2', `${s.id}: unknown group ${g}`);
    for (const c of s.consoles) if (!has('console', c)) err('S2', `${s.id}: unknown console ${c}`);
    for (const h of s.handles ?? []) if (!has('handle', h)) err('S2', `${s.id}: unknown handle ${h}`);
    if (!has('checkpoint', s.start)) err('S2', `${s.id}: unknown checkpoint ${s.start}`);
    for (const c of s.intent.mustUse)
      if (!s.consoles.includes(c) && !(s.handles ?? []).includes(c)) err('S2', `${s.id}: mustUse ${c} is not a console or handle of the section`);
  }
  for (const sl of stage.slots ?? []) {
    const k = sl.target.kind === 'console' ? 'console' : 'group';
    if (!has(k, sl.target.id)) err('S2', `slot ${sl.id}: unknown ${k} ${sl.target.id}`);
    if (!(sl.current >= 0 && sl.current < sl.options.length)) err('S2', `slot ${sl.id}: current option out of range`);
  }
  // S3: module parameters
  for (const m of stage.modules) for (const e of kitErrors(m)) err('S3', e);
  if (issues.some((i) => i.level === 'error')) return { stageId: stage.stageId, version: stage.version, issues, sections, ok: false };

  const cs = new CompiledStage(stage);
  const s0 = cs.initialState();
  const wm = cs.walkMap(s0);

  // G1: one walkable tile per cell, no overlapping solids
  for (const c of wm.conflicts) err('G1', `two walkable tiles share cell ${c}`);
  const boxes = cs.worldBoxes(s0);
  for (let i = 0; i < boxes.length; i++)
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i];
      const b = boxes[j];
      if (a.module === b.module) continue;
      const overlap = [0, 1, 2].every((k) => Math.min(a.max[k], b.max[k]) - Math.max(a.min[k], b.min[k]) > 0.05);
      if (overlap) err('G1', `solids of ${a.module} and ${b.module} overlap in the initial state`);
    }

  // G2: consoles and checkpoints stand on static walkable tiles
  const groupOf = new Map(stage.modules.map((m) => [m.id, m.group]));
  for (const c of stage.interactables) {
    const t = wm.tiles.get(cellKey(c.at));
    if (!t) err('G2', `${c.id} is not on a walkable tile`);
    else if (groupOf.get(t.module)) err('G2', `${c.id} stands on moving module ${t.module}`);
  }
  for (const cp of stage.checkpoints) if (!wm.tiles.get(cellKey(cp.at))) err('G2', `checkpoint ${cp.id} is not walkable`);

  // T2: a tether hangs on a walkable landing cell from the start (another module's tile makes the cell walkable)
  for (const m of cs.tethers) {
    const end = cs.tetherEnd(m, s0);
    if (!wm.tiles.has(end.key)) err('T2', `tether ${m.id}: its landing cell ${end.key} is not walkable in the initial state`);
  }

  // C4 / C5: the clock of a section is one clock, and it rests long enough to cross
  for (const sec of stage.sections) {
    const auto = cs.autoGroups(sec.id);
    if (new Set(auto.map((g) => g.auto!.periodMs)).size > 1)
      err('C4', `${sec.id}: auto groups ${auto.map((g) => `${g.id} (${g.auto!.periodMs} ms)`).join(', ')} have different periodMs`);
    for (const g of auto)
      if (g.auto!.dwellMs < MIN_DWELL_MS) warn('C5', `${sec.id}: ${g.id} rests only ${g.auto!.dwellMs} ms (under ${MIN_DWELL_MS} ms) before it moves`);
  }

  // L1-L5 per section, plus G3 (no motion may sweep through a console's standing space)
  const reached: Record<Id, { state: PuzzleState; cell: string; region: number }[]> = {};
  const wantsReach = cs.tethers.length > 0 || cs.handles.size > 0 || stage.groups.some((g) => g.kind === 'states' && g.auto);
  for (const sec of stage.sections) {
    let r;
    try {
      r = solveSection(cs, sec.id, { withFirstMoves: true });
    } catch (e) {
      err('L1', `${sec.id}: ${(e as Error).message}`);
      continue;
    }
    sections[sec.id] = {
      optimal: r.optimal,
      explored: r.explored,
      deadEnds: r.deadEnds,
      firstMoves: r.firstMoves.map((f) => ({ key: f.key, penalty: f.penalty })),
      waits: r.waits,
      links: r.links,
      rides: r.rides,
    };
    if (wantsReach) reached[sec.id] = reachableNodes(cs, sec.id);
    if (r.optimal === null) {
      err('L1', `${sec.id}: the exit cannot be reached`);
      continue;
    }
    const band = sec.intent.optimalActions;
    if (r.optimal < band.min || r.optimal > band.max)
      err('L2', `${sec.id}: optimal ${r.optimal} actions is outside the intended ${band.min}-${band.max}`);
    if (r.deadEnds > sec.intent.maxDeadEndStates) err('L3', `${sec.id}: ${r.deadEnds} dead-end state(s) without reset`);
    for (const c of sec.intent.mustUse) {
      const without = solveSection(cs, sec.id, { disabledConsoles: new Set([c]) });
      if (without.optimal !== null && without.optimal <= r.optimal)
        err('L4', `${sec.id}: can be solved optimally without ${c}`);
    }
    const used = new Set(r.moves.flatMap((m) => ('console' in m.action ? [m.action.console] : 'handle' in m.action ? [m.action.handle] : [])));
    for (const c of sec.consoles) if (!used.has(c) && !sec.intent.mustUse.includes(c)) warn('L5', `${sec.id}: console ${c} is not part of the optimal plan`);
    for (const h of sec.handles ?? []) if (!used.has(h) && !sec.intent.mustUse.includes(h)) warn('L5', `${sec.id}: handle ${h} is not part of the optimal plan`);
  }
  // T1 / H1 / C1-C3: what the reachable states of the sections hold (the solver's nodes: a state and a region of it)
  const statesOf = (secs: readonly { id: Id }[]) => {
    const byKey = new Map<string, PuzzleState>([[cs.stateKey(s0), s0]]);
    for (const sec of secs) for (const n of reached[sec.id] ?? []) byKey.set(cs.stateKey(n.state), n.state);
    return [...byKey.values()];
  };
  if (cs.tethers.length) {
    const linked = new Set<Id>();
    for (const st of statesOf(stage.sections)) for (const l of cs.walkMap(st).links) linked.add(l.a).add(l.b);
    for (const m of cs.tethers) if (!linked.has(m.id)) warn('T1', `tether ${m.id} never links in any reachable state`);
  }
  for (const h of stage.handles ?? []) {
    const listing = stage.sections.filter((sec) => (sec.handles ?? []).includes(h.id));
    if (!statesOf(listing).some((st) => cs.handleReach(h.id, st).length > 0))
      err('H1', `handle ${h.id}: no walkable cell is within reach with a clear line in any reachable state`);
  }
  for (const sec of stage.sections) {
    const auto = new Set(cs.autoGroups(sec.id).map((g) => g.id));
    if (!auto.size) continue;
    const wait = { kind: 'wait', section: sec.id } as const;
    const seen = new Set<string>();
    const once = (rule: string, id: string, add: () => void) => {
      if (seen.has(`${rule}|${id}`)) return;
      seen.add(`${rule}|${id}`);
      add();
    };
    for (const n of reached[sec.id] ?? []) {
      const wmN = cs.walkMap(n.state);
      const at = cs.stateKey(n.state);
      const blockers = cs.sweepBlockers(n.state, wait);
      if (blockers.length) once('C2', blockers.join(','), () => err('C2', `${sec.id}: an auto step is blocked by ${blockers.join(', ')}, so the clock jams (state ${at})`));
      const cells = [...wmN.region].filter(([, r]) => r === n.region).map(([k]) => k);
      for (const [cell, o] of cs.motionOutcomes(n.state, wait, cells)) {
        if (o.ok || !o.blockedBy.includes('player')) continue;
        const tile = wmN.tiles.get(cell)!;
        const group = stage.modules.find((m) => m.id === tile.module)?.group;
        if (group && auto.has(group))
          once('C3', cell, () => warn('C3', `${sec.id}: an auto step would tip a rider off ${group} at ${cell} (state ${at}); the runtime sends them back to their last cell on a static module`));
        else once('C1', cell, () => err('C1', `${sec.id}: an auto step sweeps through the player at ${cell} (state ${at}), and the clock cannot stop for them`));
      }
    }
  }

  // G3: no motion, from any state of its group, may sweep through a console's standing space.
  const g3 = new Set<string>();
  for (const g of stage.groups) {
    const froms = g.kind === 'states' ? g.states.map((_, i) => i) : CUBE_GROUP.map((_, i) => i);
    for (const idx of froms)
      for (const c of stage.interactables.filter((c) => c.controls === g.id))
        for (const { action, blockedBy } of cs.consoleActions(c.id, { ...s0, [g.id]: idx }))
          for (const b of blockedBy)
            if (b.startsWith('anchor:')) g3.add(`${c.id} (${actionKey(action)} from state ${idx}) sweeps through ${b.slice(7)}'s standing space`);
  }
  for (const m of g3) err('G3', m);

  // Every alternative of every slot must also be valid, so the improvement loop can only pick safe options.
  if (opts.checkSlotOptions !== false)
    for (const slot of input.slots ?? [])
      slot.options.forEach((_, k) => {
        if (k === slot.current) return;
        const variant = structuredClone(input);
        variant.slots!.find((x) => x.id === slot.id)!.current = k;
        const r = validateStage(variant, { checkSlotOptions: false });
        for (const i of r.issues) if (i.level === 'error') err(i.rule, `[slot ${slot.id} option ${k}] ${i.message}`);
      });
  return { stageId: stage.stageId, version: stage.version, issues, sections, ok: !issues.some((i) => i.level === 'error') };
}
