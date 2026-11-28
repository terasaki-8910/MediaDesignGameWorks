// Telemetry batch schema shared by the game client, the Vercel function and the metrics aggregator.
// Only coarse, anonymous data: a random per-session id, cell keys, timings and console actions.

export type TelemetryEvent =
  | { t: number; type: 'session_start'; build: string; revision: number; stage: string; quality: string; client: ClientInfo }
  | { t: number; type: 'section_enter'; section: string }
  | { t: number; type: 'action'; section: string; console: string; action: string; ok: boolean; blockedBy?: string[]; cell: string }
  | { t: number; type: 'preview'; section: string; console: string; browsed: number; committed: boolean }
  // v0.5: moves without a console. `chain` counts the swings joined without a landing in between (0 for the first of a chain).
  | { t: number; type: 'swing'; section: string; from: string; to: string; chain: number }
  | { t: number; type: 'handle_step'; section: string; handle: string; dir: 1 | -1; ok: boolean; blockedBy?: string[]; cell: string }
  | { t: number; type: 'ride'; section: string; handle: string; from: string; to: string }
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
  'perf', 'session_end', 'swing', 'handle_step', 'ride',
]);
const SHORT = /^[\w.,:\- ]{0,64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// fields the aggregator reads have exact shapes, so nothing else can ride along to the improvement agent
const CELL = /^-?\d{1,4},-?\d{1,4},-?\d{1,4}$/;
const ACTION = /^[\w-]{1,32}:(set\d{1,2}|[xyz]\d{2,3})$/;
const ID = /^[\w:.-]{1,48}$/;

const isSample = (s: unknown) =>
  Array.isArray(s) && s.length === 2 && typeof s[0] === 'number' && Number.isFinite(s[0]) && typeof s[1] === 'string' && CELL.test(s[1]);

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
    if (e.type === 'pos' && !(Array.isArray(e.samples) && e.samples.length <= 600 && e.samples.every(isSample))) continue;
    if ('cell' in e && !(typeof e.cell === 'string' && CELL.test(e.cell))) continue;
    if (e.type === 'action' && !(typeof e.action === 'string' && ACTION.test(e.action))) continue;
    if ((e.type === 'swing' || e.type === 'ride') && !['from', 'to'].every((k) => typeof e[k] === 'string' && CELL.test(e[k] as string))) continue;
    if (e.type === 'swing' && !(Number.isInteger(e.chain) && (e.chain as number) >= 0 && (e.chain as number) <= 32)) continue;
    if ((e.type === 'handle_step' || e.type === 'ride') && !(typeof e.handle === 'string' && ID.test(e.handle))) continue;
    if (e.type === 'handle_step' && !(e.dir === 1 || e.dir === -1)) continue;
    if ('blockedBy' in e && !(Array.isArray(e.blockedBy) && e.blockedBy.length <= 8 && e.blockedBy.every((x) => typeof x === 'string' && ID.test(x))))
      continue;
    for (const k of ['fun', 'difficulty', 'clarity'])
      if (k in e && !(Number.isInteger(e[k]) && (e[k] as number) >= 1 && (e[k] as number) <= 5)) delete e[k];
    events.push(e as unknown as TelemetryEvent);
  }
  return { batch: { v: 1, session: b.session as string, seq: b.seq as number, playtest: b.playtest === true, events }, errors };
}
