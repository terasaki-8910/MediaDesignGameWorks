// Reads telemetry batches: in GitHub Actions from the game's export endpoint (api/telemetry-export.ts), which
// checks the workflow's OIDC token, or from a local folder (dry runs and tests).
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { AUDIENCE } from '../../api/telemetry-export.ts';
import type { TelemetryBatch } from '../../src/core/telemetry.ts';

export type StoredBatch = TelemetryBatch & { receivedAt?: string };

export async function loadBatches(opts: { dir?: string; exportUrl?: string; sinceDays?: number }): Promise<StoredBatch[]> {
  if (opts.dir) return dedupe(loadDir(opts.dir));
  if (!opts.exportUrl) throw new Error('TELEMETRY_EXPORT_URL is not set (or pass --dir for local data)');
  const since = opts.sinceDays ? new Date(Date.now() - opts.sinceDays * 86400_000).toISOString().slice(0, 10) : '';
  const { files = [] } = await callExport(opts.exportUrl, { since });
  const out: StoredBatch[] = [];
  for (const file of files) {
    try {
      out.push(...((await callExport(opts.exportUrl, { file })).batches ?? []));
    } catch (e) {
      console.warn(`skipping ${file}: ${(e as Error).message}`);
    }
  }
  return dedupe(out);
}

async function callExport(base: string, params: Record<string, string>) {
  const url = new URL(base);
  for (const [k, v] of Object.entries(params)) if (v) url.searchParams.set(k, v);
  const res = await fetch(url, { headers: { authorization: `Bearer ${await githubOidcToken()}` } });
  const body = (await res.json().catch(() => ({}))) as { files?: string[]; batches?: StoredBatch[]; error?: string };
  if (!res.ok) throw new Error(`telemetry export answered ${res.status}: ${body.error ?? res.statusText}`);
  return body;
}

let token: { value: string; at: number } | null = null;

/** A GitHub Actions OIDC token for the export endpoint; needs `permissions: id-token: write` on the job. */
async function githubOidcToken(): Promise<string> {
  if (token && Date.now() - token.at < 120_000) return token.value;
  const url = process.env.ACTIONS_ID_TOKEN_REQUEST_URL;
  const bearer = process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
  if (!url || !bearer) throw new Error('no GitHub OIDC token: run in GitHub Actions with `permissions: id-token: write`');
  const u = new URL(url);
  u.searchParams.set('audience', AUDIENCE);
  const res = await fetch(u, { headers: { authorization: `bearer ${bearer}` } });
  if (!res.ok) throw new Error(`GitHub OIDC token request failed: ${res.status}`);
  token = { value: ((await res.json()) as { value: string }).value, at: Date.now() };
  return token.value;
}

/** A batch can arrive twice (a resent beacon, or a crash between packing and deleting): keep the first copy. */
function dedupe(batches: StoredBatch[]): StoredBatch[] {
  const seen = new Set<string>();
  return batches.filter((b) => {
    const key = `${b.session}:${b.seq}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function loadDir(dir: string): StoredBatch[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .flatMap((f) => {
      const data = JSON.parse(readFileSync(join(dir, f), 'utf8'));
      return Array.isArray(data) ? data : [data];
    });
}
