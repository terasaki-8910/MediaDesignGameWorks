// Aggregates raw telemetry into ai/work/metrics.json: the only play data the improvement agent sees.
// Free-text feedback is reduced to fixed labels here, so the agent never reads player-written text.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { CompiledStage } from '../../src/core/compile.ts';
import { resolveSlots } from '../../src/core/slots.ts';
import { solveSection } from '../../src/core/solver.ts';
import type { TelemetryEvent } from '../../src/core/telemetry.ts';
import type { StageFile } from '../../src/core/types.ts';
import { readHistory } from './history.ts';
import { loadBatches, type StoredBatch } from './store.ts';

export interface SectionMetrics {
  entered: number;
  cleared: number;
  clearRate: { value: number | null; ci95: [number, number] | null };
  timeSec: { median: number | null; p75: number | null };
  actions: { median: number | null; optimal: number | null };
  blockedAttempts: number;
  firstMoves: { label: string; share: number; n: number }[];
  stuckCells: { cell: string; dwellSec: number; sessions: number }[];
  hints: { tier1: number; tier2: number };
  resets: number;
  quitHere: number;
}

export interface Metrics {
  generatedAt: string;
  window: { from: string | null; to: string | null; sessions: number; newSessions: number; playtestSessions: number };
  revision: number;
  sections: Record<string, SectionMetrics>;
  feedback: { n: number; fun: number | null; difficulty: number | null; clarity: number | null; labels: Record<string, number> };
  perf: { sessions: number; medianP95FrameMs: number | null; lowTierShare: number | null };
  solver: Record<string, { optimal: number | null; states: number; deadEnds: number }>;
  history: { date: string; revision: number; ops: string[] }[];
}

const LABELS: [string, RegExp][] = [
  ['camera_confusing', /カメラ|視点|見づら|見にく|camera/i],
  ['unclear_next_step', /分から|わから|迷|どこ|何をす|unclear|confus|lost/i],
  ['too_hard', /難し|むずかし|詰ま|hard|difficult|stuck/i],
  ['too_easy', /簡単|易し|すぐ|easy/i],
  ['loved_fold', /折|変形|回転|すご|きれい|綺麗|美し|面白|おもしろ|楽し|fold|beautiful|fun/i],
  ['motion_sickness', /酔|気持ち悪|sick/i],
  ['performance', /重|カク|遅|ラグ|lag|slow|fps/i],
  ['bug', /バグ|おかし|動かな|bug|broken/i],
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

export function computeMetrics(batches: StoredBatch[], stages: StageFile[], revision: number, lastRunAt: string | null): Metrics {
  const sessions = new Map<string, { playtest: boolean; events: TelemetryEvent[]; firstSeen: string | null }>();
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

  const sections: Record<string, SectionMetrics> = {};
  for (const id of sectionIds) {
    const entered = new Set<string>();
    const cleared = new Set<string>();
    const times: number[] = [];
    const actions: number[] = [];
    const first = new Map<string, number>();
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
        if (e.type === 'action') {
          if (!e.ok) blocked++;
          else if (!sawFirst) {
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
      const samples = s.events.flatMap((e) => (e.type === 'pos' ? e.samples : []));
      for (let i = 0; i < samples.length - 1; i++) {
        const [t, cell] = samples[i];
        if (t < enterT || t > clearT || !entered.has(sid)) continue;
        const dt = Math.min(30, (samples[i + 1][0] - t) / 1000);
        const d = dwell.get(cell) ?? { sec: 0, sessions: new Set() };
        d.sec += dt;
        d.sessions.add(sid);
        dwell.set(cell, d);
      }
    }
    const firstTotal = [...first.values()].reduce((a, b) => a + b, 0);
    sections[id] = {
      entered: entered.size,
      cleared: cleared.size,
      clearRate: { value: entered.size ? round(cleared.size / entered.size) : null, ci95: wilson(cleared.size, entered.size) },
      timeSec: { median: median(times), p75: quantile(times, 0.75) },
      actions: { median: median(actions), optimal: solver[id]?.optimal ?? null },
      blockedAttempts: blocked,
      firstMoves: [...first.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([label, n]) => ({ label, n, share: round(n / Math.max(1, firstTotal)) })),
      stuckCells: [...dwell.entries()]
        .sort((a, b) => b[1].sec - a[1].sec)
        .slice(0, 5)
        .map(([cell, d]) => ({ cell, dwellSec: Math.round(d.sec), sessions: d.sessions.size })),
      hints: { tier1, tier2 },
      resets,
      quitHere: quit,
    };
  }

  const fb = [...sessions.values()].flatMap((s) => s.events.filter((e) => e.type === 'feedback'));
  const avg = (k: 'fun' | 'difficulty' | 'clarity') => {
    const xs = fb.map((e) => (e.type === 'feedback' ? e[k] : undefined)).filter((x): x is number => typeof x === 'number');
    return xs.length ? round(xs.reduce((a, b) => a + b, 0) / xs.length, 2) : null;
  };
  const labels: Record<string, number> = {};
  for (const e of fb) if (e.type === 'feedback' && e.text) for (const l of classifyText(e.text)) labels[l] = (labels[l] ?? 0) + 1;

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
    sections,
    feedback: { n: fb.length, fun: avg('fun'), difficulty: avg('difficulty'), clarity: avg('clarity'), labels },
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
  const batches = await loadBatches({ dir: opt('--dir'), token: process.env.BLOB_READ_WRITE_TOKEN, sinceDays: Number(opt('--days') ?? 60) });
  const m = computeMetrics(batches, loadStages(), revision, history.lastRunAt);
  m.history = history.entries.slice(-5).map((e) => ({ date: e.date, revision: e.revision, ops: e.ops }));
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify(m, null, 2)}\n`);
  console.log(`metrics: ${m.window.sessions} sessions (${m.window.newSessions} new) -> ${out}`);
}
