// Stage validator shared by CI, the stage CLI and the AI loop's proposal check.
import { CompiledStage, actionKey } from './compile.ts';
import { kitErrors } from './kit.ts';
import { CUBE_GROUP, cellKey } from './math.ts';
import { resolveSlots } from './slots.ts';
import { solveSection } from './solver.ts';
import type { Id, StageFile } from './types.ts';

export interface Issue { rule: string; level: 'error' | 'warning'; message: string }

export interface SectionMetrics {
  optimal: number | null;
  explored: number;
  deadEnds: number;
  firstMoves: { key: string; penalty: number | null }[];
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
  for (const s of stage.sections) {
    for (const g of s.groups) if (!has('group', g)) err('S2', `${s.id}: unknown group ${g}`);
    for (const c of s.consoles) if (!has('console', c)) err('S2', `${s.id}: unknown console ${c}`);
    if (!has('checkpoint', s.start)) err('S2', `${s.id}: unknown checkpoint ${s.start}`);
    for (const c of s.intent.mustUse) if (!s.consoles.includes(c)) err('S2', `${s.id}: mustUse ${c} is not a console of the section`);
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

  // L1-L5 per section, plus G3 (no motion may sweep through a console's standing space)
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
    };
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
    const used = new Set(r.plan.map((a) => a.console));
    for (const c of sec.consoles) if (!used.has(c) && !sec.intent.mustUse.includes(c)) warn('L5', `${sec.id}: console ${c} is not part of the optimal plan`);
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
