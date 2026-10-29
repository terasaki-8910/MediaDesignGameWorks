// Aggregates raw telemetry into ai/work/metrics.json: the only play data the improvement agent sees.
// Free-text feedback is reduced to fixed labels here, so the agent never reads player-written text.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { CompiledStage, actionKey } from '../../src/core/compile.ts';
import { CUBE_GROUP, cellKey } from '../../src/core/math.ts';
import { resolveSlots } from '../../src/core/slots.ts';
import { solveSection } from '../../src/core/solver.ts';
import type { TelemetryEvent } from '../../src/core/telemetry.ts';
import type { PuzzleState, StageFile } from '../../src/core/types.ts';
import { readHistory } from './history.ts';
import { loadBatches, type StoredBatch } from './store.ts';

export interface SectionMetrics {
  entered: number;
  cleared: number;
  clearRate: { value: number | null; ci95: [number, number] | null };
  timeSec: { median: number | null; p75: number | null };
  actions: { median: number | null; optimal: number | null };
  blockedAttempts: number;
  /** Folds tried while something stood in their sweep, with what (module ids); most frequent first. */
  blocked: { action: string; by: string[]; n: number }[];
  firstMoves: { label: string; share: number; n: number }[];
  /** Where players stood longest, and what is there. One stay counts at most DWELL_CAP_SEC. */
  stuckCells: { cell: string; what: string; dwellSec: number; sessions: number }[];
  hints: { tier1: number; tier2: number };
  resets: number;
  quitHere: number;
}

/** The headline numbers of the sessions that played one revision of the city, to compare before and after a change. */
export interface RevisionSummary {
  revision: number;
  sessions: number;
  sections: Record<
    string,
    { entered: number; cleared: number; quitHere: number; timeSecMedian: number | null; actionsMedian: number | null; hints: number }
  >;
  feedback: { n: number; fun: number | null; difficulty: number | null; clarity: number | null };
}

export interface Metrics {
  generatedAt: string;
  window: { from: string | null; to: string | null; sessions: number; newSessions: number; playtestSessions: number };
  revision: number;
  sections: Record<string, SectionMetrics>;
  byRevision: RevisionSummary[];
  feedback: { n: number; fun: number | null; difficulty: number | null; clarity: number | null; labels: Record<string, number> };
  perf: { sessions: number; medianP95FrameMs: number | null; lowTierShare: number | null };
  solver: Record<string, { optimal: number | null; states: number; deadEnds: number }>;
  history: { date: string; revision: number; ops: string[] }[];
}

// Free text never reaches the agent: it only sees how many answers mention each topic.
const LABELS: [string, RegExp][] = [
  ['camera_confusing', /カメラ|視点|見づら|見にく|camera/i],
  ['unclear_next_step', /分から|わから|迷|どこ|何をす|unclear|confus|lost/i],
  ['console_unnoticed', /操作盤.{0,8}(分から|わから|見つから|気づ|気付)|console/i],
  ['controls_confusing', /操作(?!盤)|キーボード|ボタン|マウス|\bcontrols?\b/i],
  ['hint_mention', /ヒント|hint/i],
  ['too_hard', /難し|むずかし|詰ま|hard|difficult|stuck/i],
  ['too_easy', /簡単|易し|物足りな|easy/i],
  ['walk_slow', /(歩|移動|足|動き).{0,6}(遅|のろ|もっさり)|もっと速|walk.{0,10}slow/i],
  ['walk_fast', /(歩|移動|動き).{0,6}(速すぎ|早すぎ)|too fast/i],
  ['fold_slow', /(変形|回転|折|アニメ|演出).{0,8}(遅|長|待)|待たさ|待ち時間/i],
  ['motion_sickness', /酔|気持ち悪|sick/i],
  ['performance', /重い|重た|カクカク|カクつ|ラグ|フレーム|fps|\blag\b|stutter/i],
  ['bug', /バグ|おかし|動かな|不具合|固ま|bug|broken|glitch/i],
  ['positive', /すご|きれい|綺麗|美し|面白|おもしろ|楽し|好き|よかった|良かった|beautiful|\bfun\b|love/i],
];

export function classifyText(text: string): string[] {
  const hits = LABELS.filter(([, re]) => re.test(text)).map(([l]) => l);
  return hits.length ? hits : ['other'];
}

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function quantile(xs: number[], q: number): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))];
}

/** Wilson score interval for a proportion. */
export function wilson(k: number, n: number, z = 1.96): [number, number] | null {
  if (!n) return null;
  const p = k / n;
  const d = 1 + (z * z) / n;
  const c = (p + (z * z) / (2 * n)) / d;
  const h = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return [round(Math.max(0, c - h)), round(Math.min(1, c + h))];
}

const round = (x: number, k = 3) => Math.round(x * 10 ** k) / 10 ** k;
const round1 = (x: number | null) => (x === null ? null : round(x, 1));

type Session = { playtest: boolean; events: TelemetryEvent[]; firstSeen: string | null };

/** A stay in one cell counts at most this long, so a player who walks away from the keyboard does not dominate. */
export const DWELL_CAP_SEC = 30;
const CELL = /^-?\d{1,4},-?\d{1,4},-?\d{1,4}$/;

/**
 * What the stages define. Strings from the players' browsers reach the agent only when they are one of these ids,
 * so telemetry cannot smuggle text into metrics.json.
 */
interface StageIndex {
  actions: Map<string, Set<string>>; // section id -> action keys its consoles offer
  things: Set<string>; // module ids and anchor:<console>, what can block a fold
  places: Map<string, string>; // cell key -> what is there
}

function indexStages(stages: StageFile[]): StageIndex {
  const actions = new Map<string, Set<string>>();
  const things = new Set<string>();
  const places = new Map<string, string>();
  for (const st of stages) {
    const stage = resolveSlots(st);
    const cs = new CompiledStage(stage);
    for (const sec of stage.sections) {
      const keys = new Set<string>();
      for (const id of sec.consoles) {
        const c = cs.consoles.get(id)!;
        const g = cs.groups.get(c.controls)!;
        if (g.kind === 'states') g.states.forEach((_, to) => keys.add(actionKey({ console: id, group: g.id, kind: 'set', to })));
        else for (const quarters of [1, 2, 3] as const) keys.add(actionKey({ console: id, group: g.id, kind: 'turn', axis: c.axis ?? 'y', quarters }));
      }
      actions.set(sec.id, keys);
    }
    for (const m of stage.modules) things.add(m.id);
    for (const c of stage.interactables) things.add(`anchor:${c.id}`);
    // name every cell a walkway can occupy: the initial state, then each group in each of its states
    const groupOf = new Map(stage.modules.map((m) => [m.id, m]));
    const name = (id: string) => (groupOf.get(id)?.label ? `${id}（${groupOf.get(id)!.label!.ja}）` : id);
    const s0 = cs.initialState();
    const visit = (s: PuzzleState, group?: string) => {
      for (const t of cs.walkMap(s).tiles.values())
        if ((!group || groupOf.get(t.module)?.group === group) && !places.has(t.key)) places.set(t.key, name(t.module));
    };
    visit(s0);
    for (const g of stage.groups)
      for (let i = 0; i < (g.kind === 'states' ? g.states.length : CUBE_GROUP.length); i++) visit({ ...s0, [g.id]: i }, g.id);
    for (const sec of stage.sections) {
      const cp = stage.checkpoints.find((c) => c.id === sec.start);
      if (cp) places.set(cellKey(cp.at), `${sec.id} の開始地点（${places.get(cellKey(cp.at)) ?? ''}）`);
      for (const e of sec.exit) places.set(cellKey(e), `${sec.id} の出口`);
    }
    for (const c of stage.interactables) places.set(cellKey(c.at), `操作盤 ${c.id}（${c.label?.ja ?? ''}）`);
  }
  return { actions, things, places };
}

function sectionMetrics(id: string, sessions: Map<string, Session>, optimal: number | null, idx: StageIndex): SectionMetrics {
  const known = idx.actions.get(id) ?? new Set<string>();
  const entered = new Set<string>();
  const cleared = new Set<string>();
  const times: number[] = [];
  const actions: number[] = [];
  const first = new Map<string, number>();
  const blockedBy = new Map<string, { action: string; by: string[]; n: number }>();
  const dwell = new Map<string, { sec: number; sessions: Set<string> }>();
  let blocked = 0;
  let tier1 = 0;
  let tier2 = 0;
  let resets = 0;
  let quit = 0;
  for (const [sid, s] of sessions) {
    let sawFirst = false;
    let lastSection: string | null = null;
    let enterT = 0;
    let clearT = Number.POSITIVE_INFINITY;
    for (const e of s.events) {
      if (e.type === 'section_enter') {
        lastSection = e.section;
        if (e.section === id) {
          entered.add(sid);
          enterT = e.t;
        }
      }
      if (!('section' in e) || e.section !== id) continue;
      if (e.type === 'action' && known.has(e.action)) {
        if (!e.ok) {
          blocked++;
          const by = (Array.isArray(e.blockedBy) ? e.blockedBy : []).filter((b) => idx.things.has(b)).sort();
          const k = `${e.action}|${by.join(',')}`;
          const b = blockedBy.get(k) ?? { action: e.action, by, n: 0 };
          b.n++;
          blockedBy.set(k, b);
        } else if (!sawFirst) {
          sawFirst = true;
          first.set(e.action, (first.get(e.action) ?? 0) + 1);
        }
      }
      if (e.type === 'hint') e.tier === 2 ? tier2++ : tier1++;
      if (e.type === 'reset') resets++;
      if (e.type === 'section_clear') {
        cleared.add(sid);
        entered.add(sid);
        times.push(e.ms / 1000);
        actions.push(e.actions);
        clearT = e.t;
      }
    }
    if (entered.has(sid) && !cleared.has(sid) && lastSection === id) quit++;
    // dwell per cell inside this section's time window
    const samples = s.events.flatMap((e) => (e.type === 'pos' && Array.isArray(e.samples) ? e.samples : []));
    for (let i = 0; i < samples.length - 1; i++) {
      const [t, cell] = samples[i];
      if (t < enterT || t > clearT || !entered.has(sid) || typeof cell !== 'string' || !CELL.test(cell)) continue;
      const dt = Math.min(DWELL_CAP_SEC, (samples[i + 1][0] - t) / 1000);
      const d = dwell.get(cell) ?? { sec: 0, sessions: new Set() };
      d.sec += dt;
      d.sessions.add(sid);
      dwell.set(cell, d);
    }
  }
  const firstTotal = [...first.values()].reduce((a, b) => a + b, 0);
  return {
    entered: entered.size,
    cleared: cleared.size,
    clearRate: { value: entered.size ? round(cleared.size / entered.size) : null, ci95: wilson(cleared.size, entered.size) },
    timeSec: { median: round1(median(times)), p75: round1(quantile(times, 0.75)) },
    actions: { median: median(actions), optimal },
    blockedAttempts: blocked,
    blocked: [...blockedBy.values()].sort((a, b) => b.n - a.n).slice(0, 5),
    firstMoves: [...first.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([label, n]) => ({ label, n, share: round(n / Math.max(1, firstTotal)) })),
    stuckCells: [...dwell.entries()]
      .sort((a, b) => b[1].sec - a[1].sec)
      .slice(0, 5)
      .map(([cell, d]) => ({ cell, what: idx.places.get(cell) ?? '不明', dwellSec: Math.round(d.sec), sessions: d.sessions.size })),
    hints: { tier1, tier2 },
    resets,
    quitHere: quit,
  };
}

function feedbackOf(sessions: Iterable<Session>) {
  const list = [...sessions].flatMap((s) => s.events.filter((e) => e.type === 'feedback'));
  const avg = (k: 'fun' | 'difficulty' | 'clarity') => {
    const xs = list.map((e) => (e.type === 'feedback' ? e[k] : undefined)).filter((x): x is number => typeof x === 'number');
    return xs.length ? round(xs.reduce((a, b) => a + b, 0) / xs.length, 2) : null;
  };
  return { list, n: list.length, fun: avg('fun'), difficulty: avg('difficulty'), clarity: avg('clarity') };
}

export function computeMetrics(batches: StoredBatch[], stages: StageFile[], revision: number, lastRunAt: string | null): Metrics {
  const sessions = new Map<string, Session>();
  for (const b of batches) {
    const s = sessions.get(b.session) ?? { playtest: b.playtest, events: [], firstSeen: b.receivedAt ?? null };
    s.events.push(...b.events);
    if (b.receivedAt && (!s.firstSeen || b.receivedAt < s.firstSeen)) s.firstSeen = b.receivedAt;
    sessions.set(b.session, s);
  }
  for (const s of sessions.values()) s.events.sort((a, b) => a.t - b.t);

  const sectionIds = stages.flatMap((st) => st.sections.map((x) => x.id));
  const solver: Metrics['solver'] = {};
  for (const st of stages) {
    const cs = new CompiledStage(resolveSlots(st));
    for (const sec of st.sections) {
      const r = solveSection(cs, sec.id);
      solver[sec.id] = { optimal: r.optimal, states: r.explored, deadEnds: r.deadEnds };
    }
  }
  const idx = indexStages(stages);
  const sectionsOf = (ss: Map<string, Session>) =>
    Object.fromEntries(sectionIds.map((id) => [id, sectionMetrics(id, ss, solver[id]?.optimal ?? null, idx)])) as Record<string, SectionMetrics>;

  // the same numbers per revision of the city, so the effect of each change can be read off
  const byRev = new Map<number, Map<string, Session>>();
  for (const [sid, s] of sessions) {
    const start = s.events.find((e) => e.type === 'session_start');
    if (start?.type !== 'session_start' || !Number.isInteger(start.revision)) continue;
    const group = byRev.get(start.revision) ?? new Map<string, Session>();
    group.set(sid, s);
    byRev.set(start.revision, group);
  }
  const byRevision: RevisionSummary[] = [...byRev.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([rev, ss]) => {
      const secs = sectionsOf(ss);
      const fb = feedbackOf(ss.values());
      return {
        revision: rev,
        sessions: ss.size,
        sections: Object.fromEntries(
          Object.entries(secs).map(([id, m]) => [
            id,
            {
              entered: m.entered, cleared: m.cleared, quitHere: m.quitHere, timeSecMedian: m.timeSec.median,
              actionsMedian: m.actions.median, hints: m.hints.tier1 + m.hints.tier2,
            },
          ]),
        ),
        feedback: { n: fb.n, fun: fb.fun, difficulty: fb.difficulty, clarity: fb.clarity },
      };
    });

  const fb = feedbackOf(sessions.values());
  const labels: Record<string, number> = {};
  for (const e of fb.list) if (e.type === 'feedback' && e.text) for (const l of classifyText(e.text)) labels[l] = (labels[l] ?? 0) + 1;

  const perfSessions = [...sessions.values()].filter((s) => s.events.some((e) => e.type === 'perf')).length;
  const perf = [...sessions.values()].flatMap((s) => s.events.filter((e) => e.type === 'perf'));
  const starts = [...sessions.values()].flatMap((s) => s.events.filter((e) => e.type === 'session_start'));
  const seen = [...sessions.values()].map((s) => s.firstSeen).filter((x): x is string => !!x).sort();
  return {
    generatedAt: new Date().toISOString(),
    window: {
      from: seen[0] ?? null,
      to: seen[seen.length - 1] ?? null,
      sessions: sessions.size,
      newSessions: [...sessions.values()].filter((s) => !lastRunAt || (s.firstSeen ?? '') > lastRunAt).length,
      playtestSessions: [...sessions.values()].filter((s) => s.playtest).length,
    },
    revision,
    sections: sectionsOf(sessions),
    byRevision,
    feedback: { n: fb.n, fun: fb.fun, difficulty: fb.difficulty, clarity: fb.clarity, labels },
    perf: {
      sessions: perfSessions,
      medianP95FrameMs: median(perf.map((e) => (e.type === 'perf' ? e.p95 : 0))),
      lowTierShare: starts.length
        ? round(starts.filter((e) => e.type === 'session_start' && e.client.gpuTier === 'low').length / starts.length)
        : null,
    },
    solver,
    history: [],
  };
}

export function loadStages(root = '.'): StageFile[] {
  const dir = `${root}/src/stages`;
  return ['area1.json'].map((f) => JSON.parse(readFileSync(`${dir}/${f}`, 'utf8')) as StageFile);
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const opt = (k: string) => {
    const i = args.indexOf(k);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const out = opt('--out') ?? 'ai/work/metrics.json';
  const history = readHistory();
  const revision = JSON.parse(readFileSync('src/revision.json', 'utf8')).revision as number;
  const batches = await loadBatches({ dir: opt('--dir'), exportUrl: process.env.TELEMETRY_EXPORT_URL, sinceDays: Number(opt('--days') ?? 60) });
  const m = computeMetrics(batches, loadStages(), revision, history.lastRunAt);
  m.history = history.entries.slice(-5).map((e) => ({ date: e.date, revision: e.revision, ops: e.ops }));
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify(m, null, 2)}\n`);
  console.log(`metrics: ${m.window.sessions} sessions (${m.window.newSessions} new) -> ${out}`);
}
