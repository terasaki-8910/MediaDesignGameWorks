// `npm run ai:gate` — decides whether this run should call the agent at all (enough new data, monthly cap).
import { readFileSync, writeFileSync } from 'node:fs';
import { readHistory, runsThisMonth } from './history.ts';
import type { Metrics } from './metrics.ts';

// unset GitHub variables arrive as empty strings, so fall back on anything that is not a number
const num = (v: string | undefined, d: number) => (v && Number.isFinite(Number(v)) ? Number(v) : d);
const MIN_NEW = num(process.env.AI_MIN_NEW_SESSIONS, 1);
const MAX_RUNS = num(process.env.AI_MAX_RUNS_PER_MONTH, 20);
const force = process.argv.includes('--force');
const file = process.argv.slice(2).find((a) => !a.startsWith('--')) ?? 'ai/work/metrics.json';
const m = JSON.parse(readFileSync(file, 'utf8')) as Metrics;
const h = readHistory();
const runs = runsThisMonth(h);
let run = true;
let reason = 'ok';
if (runs >= MAX_RUNS) [run, reason] = [false, `monthly cap reached (${runs}/${MAX_RUNS})`];
else if (!force && m.window.newSessions < MIN_NEW) [run, reason] = [false, `only ${m.window.newSessions} new sessions (< ${MIN_NEW})`];
const line = `run=${run}\nreason=${reason}\n`;
if (process.env.GITHUB_OUTPUT) writeFileSync(process.env.GITHUB_OUTPUT, line, { flag: 'a' });
console.log(line.trim());
