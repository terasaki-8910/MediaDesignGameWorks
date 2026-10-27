// Telemetry batch schema shared by the game client, the Vercel function and the metrics aggregator.
// Only coarse, anonymous data: a random per-session id, cell keys, timings and console actions.

export type TelemetryEvent =
  | { t: number; type: 'session_start'; build: string; revision: number; stage: string; quality: string; client: ClientInfo }
  | { t: number; type: 'section_enter'; section: string }
  | { t: number; type: 'action'; section: string; console: string; action: string; ok: boolean; blockedBy?: string[]; cell: string }
  | { t: number; type: 'preview'; section: string; console: string; browsed: number; committed: boolean }
  | { t: number; type: 'reset'; section: string; reason: 'manual' | 'softlock' }
  | { t: number; type: 'hint'; section: string; tier: 1 | 2 }
  | { t: number; type: 'pos'; samples: [number, string][] }
  | { t: number; type: 'section_clear'; section: string; ms: number; actions: number; optimal: number; hints: number; resets: number }
  | { t: number; type: 'game_clear'; ms: number }
  | { t: number; type: 'feedback'; fun?: number; difficulty?: number; clarity?: number; text?: string }
  | { t: number; type: 'perf'; p50: number; p95: number; scale: number; quality: string }
  | { t: number; type: 'session_end'; reason: string; section: string; cell: string };

export interface ClientInfo { browser: string; os: string; lang: string; screen: string; gpuTier: string }

export interface TelemetryBatch {
  v: 1;
  session: string;
  seq: number;
  playtest: boolean;
  events: TelemetryEvent[];
}

const TYPES = new Set([
  'session_start', 'section_enter', 'action', 'preview', 'reset', 'hint', 'pos', 'section_clear', 'game_clear', 'feedback',
  'perf', 'session_end',
]);
const SHORT = /^[\w.,:\- ]{0,64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Returns a cleaned batch, or a list of reasons it was rejected. */
export function validateBatch(input: unknown): { batch?: TelemetryBatch; errors: string[] } {
  const errors: string[] = [];
  if (!input || typeof input !== 'object') return { errors: ['not an object'] };
  const b = input as Record<string, unknown>;
  if (b.v !== 1) errors.push('v must be 1');
  if (typeof b.session !== 'string' || !UUID.test(b.session)) errors.push('session must be a uuid');
  if (!Number.isInteger(b.seq) || (b.seq as number) < 0 || (b.seq as number) > 500) errors.push('seq out of range');
  if (!Array.isArray(b.events) || b.events.length > 400) errors.push('events must be an array of at most 400');
  if (errors.length) return { errors };
  const events: TelemetryEvent[] = [];
  for (const raw of b.events as unknown[]) {
    if (!raw || typeof raw !== 'object') continue;
    const e = raw as Record<string, unknown>;
    if (typeof e.type !== 'string' || !TYPES.has(e.type)) continue;
    if (typeof e.t !== 'number' || e.t < 0 || e.t > 6 * 3600 * 1000) continue;
    const bad = Object.entries(e).some(([k, v]) => {
      if (k === 'text') return typeof v !== 'string' || v.length > 200;
      if (typeof v === 'string') return !SHORT.test(v);
      if (typeof v === 'number') return !Number.isFinite(v);
      return false;
    });
    if (bad) continue;
    if (e.type === 'pos' && (!Array.isArray(e.samples) || e.samples.length > 600)) continue;
    for (const k of ['fun', 'difficulty', 'clarity'])
      if (k in e && !(Number.isInteger(e[k]) && (e[k] as number) >= 1 && (e[k] as number) <= 5)) delete e[k];
    events.push(e as unknown as TelemetryEvent);
  }
  return { batch: { v: 1, session: b.session as string, seq: b.seq as number, playtest: b.playtest === true, events }, errors };
}
