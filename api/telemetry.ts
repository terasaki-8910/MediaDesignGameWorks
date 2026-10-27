// Vercel Function: receives telemetry batches from the game and stores each batch as one JSON blob.
// Storage: Vercel Blob. Connecting a store to the project sets BLOB_STORE_ID (OIDC) or BLOB_READ_WRITE_TOKEN,
// and the SDK uses whichever is there. Without either, batches are validated and acknowledged but not stored,
// so local and preview builds work. GET reports which of the two this deployment has.
// The validator below is a copy of src/core/telemetry.ts (Vercel bundles api/ separately); a unit test keeps them equal.
import { put } from '@vercel/blob';

const MAX_BYTES = 64 * 1024;

export async function POST(request: Request): Promise<Response> {
  const text = await request.text();
  if (text.length > MAX_BYTES) return json(413, { ok: false, error: 'too large' });
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return json(400, { ok: false, error: 'invalid json' });
  }
  const { batch, errors } = validateBatch(parsed);
  if (!batch) return json(400, { ok: false, errors });
  if (storageMode() === 'none') return json(202, { ok: true, stored: false });
  const day = new Date().toISOString().slice(0, 10);
  const body = JSON.stringify({ ...batch, receivedAt: new Date().toISOString() });
  await putJson(`telemetry/${day}/${batch.session}-${String(batch.seq).padStart(3, '0')}.json`, body);
  return json(200, { ok: true, stored: true, events: batch.events.length });
}

export function GET(): Response {
  return json(200, { ok: true, service: 'fold-city telemetry', storage: storageMode() });
}

/** Which Blob credentials the project has; the SDK resolves the actual token itself. */
export function storageMode(): 'oidc' | 'token' | 'none' {
  return process.env.BLOB_STORE_ID ? 'oidc' : process.env.BLOB_READ_WRITE_TOKEN ? 'token' : 'none';
}

async function putJson(pathname: string, body: string) {
  const access = process.env.TELEMETRY_BLOB_ACCESS === 'public' ? 'public' : 'private';
  try {
    await put(pathname, body, { access, contentType: 'application/json', addRandomSuffix: true });
  } catch (e) {
    if (access === 'public') throw e;
    // a store created as public rejects private blobs: fall back so data is not lost
    await put(pathname, body, { access: 'public', contentType: 'application/json', addRandomSuffix: true });
  }
}

function json(status: number, data: unknown): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
}

// ---- copy of src/core/telemetry.ts validateBatch ----
interface TelemetryBatch { v: 1; session: string; seq: number; playtest: boolean; events: Record<string, unknown>[] }

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
  const events: Record<string, unknown>[] = [];
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
    events.push(e);
  }
  return { batch: { v: 1, session: b.session as string, seq: b.seq as number, playtest: b.playtest === true, events }, errors };
}
