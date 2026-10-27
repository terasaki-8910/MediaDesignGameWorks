// The improvement log: every loop run (applied, rejected or no change) is recorded in ai/history/log.json.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

export interface HistoryEntry {
  runAt: string;
  date: string;
  revision: number;
  status: 'applied' | 'rejected' | 'nochange' | 'skipped';
  summary: string;
  ops: string[];
  hypotheses: { id: string; section: string; problem: string; confidence: string }[];
  reason?: string;
  costUsd?: number;
}

export interface History { lastRunAt: string | null; entries: HistoryEntry[] }

const FILE = 'ai/history/log.json';

export function readHistory(file = FILE): History {
  if (!existsSync(file)) return { lastRunAt: null, entries: [] };
  return JSON.parse(readFileSync(file, 'utf8')) as History;
}

export function appendHistory(e: HistoryEntry, file = FILE) {
  const h = readHistory(file);
  h.entries.push(e);
  h.lastRunAt = e.runAt;
  mkdirSync('ai/history', { recursive: true });
  writeFileSync(file, `${JSON.stringify(h, null, 2)}\n`);
}

/** Runs recorded this calendar month (UTC), for the monthly cap. */
export function runsThisMonth(h: History, now = new Date()): number {
  const ym = now.toISOString().slice(0, 7);
  return h.entries.filter((e) => e.runAt.startsWith(ym) && e.status !== 'skipped').length;
}
