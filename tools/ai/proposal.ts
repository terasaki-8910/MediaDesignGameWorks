// The edit-operation language the agent may use, and the deterministic checks and application of it.
// Tier 0: setTunable (numbers inside human-set ranges). Tier 1: chooseSlot (designer-approved alternatives).
import { getPath, rangeFor, setPath, tunableErrors, type Tunables } from '../../src/core/tunables.ts';
import type { StageFile } from '../../src/core/types.ts';
import { validateStage, type StageReport } from '../../src/core/validate.ts';
import type { History } from './history.ts';
import type { Metrics } from './metrics.ts';

export interface Hypothesis { id: string; section: string; problem: string; evidence: string[]; confidence: 'low' | 'medium' | 'high' }

export type Op =
  | { op: 'setTunable'; path: string; value: number; why: string }
  | { op: 'chooseSlot'; stage: string; slot: string; option: number; why: string };

export interface Proposal {
  schema: 'fold-city/proposal@1';
  summary: string;
  hypotheses: Hypothesis[];
  ops: Op[];
  expected?: { metric: string; direction: 'up' | 'down' }[];
  noChange: boolean;
}

export const LIMITS = { maxOps: 3, maxHypotheses: 5, slotMinEntered: 10, cooldownRuns: 2, maxSummary: 300 };

export interface CheckResult {
  ok: boolean;
  errors: string[];
  stages?: StageFile[];
  tunables?: Tunables;
  reports?: StageReport[];
  opLabels: string[];
}

export function opLabel(o: Op): string {
  return o.op === 'setTunable' ? `setTunable ${o.path}=${o.value}` : `chooseSlot ${o.stage}/${o.slot}=${o.option}`;
}

export function checkProposal(
  input: unknown,
  ctx: { metrics: Metrics; stages: StageFile[]; tunables: Tunables; history: History },
): CheckResult {
  const errors: string[] = [];
  const fail = (m: string) => errors.push(m);
  const p = input as Proposal;
  if (!p || typeof p !== 'object') return { ok: false, errors: ['proposal is not an object'], opLabels: [] };
  if (p.schema !== 'fold-city/proposal@1') fail('schema must be "fold-city/proposal@1"');
  if (typeof p.summary !== 'string' || !p.summary.trim() || p.summary.length > LIMITS.maxSummary)
    fail(`summary must be a non-empty string of at most ${LIMITS.maxSummary} characters`);
  if (!Array.isArray(p.hypotheses) || p.hypotheses.length > LIMITS.maxHypotheses) fail(`hypotheses must be an array of at most ${LIMITS.maxHypotheses}`);
  if (!Array.isArray(p.ops)) fail('ops must be an array');
  if (typeof p.noChange !== 'boolean') fail('noChange must be a boolean');
  if (errors.length) return { ok: false, errors, opLabels: [] };
  if (p.noChange && p.ops.length) fail('noChange is true but ops is not empty');
  if (!p.noChange && !p.ops.length) fail('ops is empty: set noChange to true instead');
  if (p.ops.length > LIMITS.maxOps) fail(`at most ${LIMITS.maxOps} ops per run`);

  const sectionIds = new Set(ctx.stages.flatMap((s) => s.sections.map((x) => x.id)));
  const hyp = new Map(p.hypotheses.map((h) => [h.id, h]));
  for (const h of p.hypotheses) {
    if (!sectionIds.has(h.section)) fail(`hypothesis ${h.id}: unknown section ${h.section}`);
    if (!['low', 'medium', 'high'].includes(h.confidence)) fail(`hypothesis ${h.id}: confidence must be low, medium or high`);
    if (!Array.isArray(h.evidence) || !h.evidence.length) fail(`hypothesis ${h.id}: cite at least one metrics path as evidence`);
    for (const ev of h.evidence ?? []) if (getPath(ctx.metrics, ev) === undefined) fail(`hypothesis ${h.id}: evidence path "${ev}" does not exist in metrics.json`);
  }

  const recent = ctx.history.entries.filter((e) => e.status === 'applied').slice(-LIMITS.cooldownRuns);
  const recentTargets = new Set(recent.flatMap((e) => e.ops.map((o) => o.split('=')[0])));
  const stages = structuredClone(ctx.stages);
  const tunables = structuredClone(ctx.tunables);
  const slotSections = new Set<string>();
  for (const o of p.ops) {
    const h = hyp.get(o.why);
    if (!h) {
      fail(`${opLabel(o)}: "why" must reference a hypothesis id`);
      continue;
    }
    if (recentTargets.has(opLabel(o).split('=')[0])) fail(`${opLabel(o)}: changed in the last ${LIMITS.cooldownRuns} applied runs; wait for its effect`);
    if (o.op === 'setTunable') {
      const r = rangeFor(o.path);
      if (!r) fail(`${o.path}: not a tunable path`);
      else if (typeof o.value !== 'number' || o.value < r[0] || o.value > r[1]) fail(`${o.path}: value must be within [${r[0]}, ${r[1]}]`);
      else if (o.path.startsWith('sections.') && !sectionIds.has(o.path.split('.')[1])) fail(`${o.path}: unknown section`);
      else setPath(tunables as unknown as Record<string, unknown>, o.path, o.value);
    } else if (o.op === 'chooseSlot') {
      const st = stages.find((s) => s.stageId === o.stage);
      const slot = st?.slots?.find((s) => s.id === o.slot);
      if (!st || !slot) {
        fail(`${opLabel(o)}: unknown stage or slot`);
        continue;
      }
      if (!Number.isInteger(o.option) || o.option < 0 || o.option >= slot.options.length) fail(`${opLabel(o)}: option out of range`);
      else if (o.option === slot.current) fail(`${opLabel(o)}: already the current option`);
      const sec = st.sections.find((x) =>
        slot.target.kind === 'console' ? x.consoles.includes(slot.target.id) : x.groups.includes(slot.target.id),
      );
      if (sec) {
        if (slotSections.has(sec.id)) fail(`${opLabel(o)}: only one slot change per section per run`);
        slotSections.add(sec.id);
        const entered = ctx.metrics.sections[sec.id]?.entered ?? 0;
        if (entered < LIMITS.slotMinEntered) fail(`${opLabel(o)}: needs at least ${LIMITS.slotMinEntered} sessions in ${sec.id} (has ${entered})`);
      }
      if (h.confidence === 'low') fail(`${opLabel(o)}: slot changes need a hypothesis with medium or high confidence`);
      slot.current = o.option;
    } else {
      fail(`unknown op ${(o as { op: string }).op}`);
    }
  }
  const reports = stages.map((s) => validateStage(s));
  for (const r of reports) for (const i of r.issues) if (i.level === 'error') fail(`stage ${r.stageId} [${i.rule}] ${i.message}`);
  for (const e of tunableErrors(tunables, [...sectionIds])) fail(`tunables: ${e}`);
  return { ok: !errors.length, errors, stages, tunables, reports, opLabels: p.ops.map(opLabel) };
}
