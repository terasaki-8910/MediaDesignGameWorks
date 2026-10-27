// Reads telemetry batches from Vercel Blob (production) or a local folder (dry runs and tests).
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { TelemetryBatch } from '../../src/core/telemetry.ts';

export type StoredBatch = TelemetryBatch & { receivedAt?: string };

export async function loadBatches(opts: { dir?: string; token?: string; sinceDays?: number }): Promise<StoredBatch[]> {
  if (opts.dir) return loadDir(opts.dir);
  if (!opts.token) throw new Error('BLOB_READ_WRITE_TOKEN is not set (or pass --dir for local data)');
  const { list, get } = await import('@vercel/blob');
  const out: StoredBatch[] = [];
  const since = opts.sinceDays ? Date.now() - opts.sinceDays * 86400_000 : 0;
  let cursor: string | undefined;
  do {
    const page = await list({ prefix: 'telemetry/', cursor, limit: 1000, token: opts.token });
    for (const b of page.blobs) {
      if (new Date(b.uploadedAt).getTime() < since) continue;
      out.push(await readBlob(b.pathname, b.url, opts.token, get));
    }
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  return out;
}

async function readBlob(
  pathname: string,
  url: string,
  token: string,
  get: typeof import('@vercel/blob').get,
): Promise<StoredBatch> {
  try {
    const r = await get(pathname, { access: 'private', token });
    if (r?.stream) return JSON.parse(await new Response(r.stream).text());
  } catch {
    /* public store: fall through */
  }
  const res = await fetch(url);
  return (await res.json()) as StoredBatch;
}

function loadDir(dir: string): StoredBatch[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .flatMap((f) => {
      const data = JSON.parse(readFileSync(join(dir, f), 'utf8'));
      return Array.isArray(data) ? data : [data];
    });
}
