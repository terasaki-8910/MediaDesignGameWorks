// Vercel Function: hands the stored telemetry to the improvement workflow (GitHub Actions).
// The workflow proves who it is with a GitHub Actions OIDC token, so neither a Blob token nor a shared secret
// has to be copied into GitHub; this function reads the store with the project's own credentials.
// Before answering, finished days are packed into a few files, so the daily run reads a handful of files instead
// of every batch (the Hobby plan allows 2,000 writes and lists and 10,000 reads a month).
import { del, get, list, put } from '@vercel/blob';

export const AUDIENCE = 'fold-city-telemetry';
const ISSUER = 'https://token.actions.githubusercontent.com';
// workflows of this repository may read the data (set TELEMETRY_EXPORT_REPOSITORY if the repository moves)
const REPOSITORY = process.env.TELEMETRY_EXPORT_REPOSITORY || 'terasaki-8910/MediaDesignGameWorks';
const CHUNK_CHARS = 2_000_000; // packed files stay well under the 4.5 MB response limit
const FILE = /^(telemetry|compact)\/\d{4}-\d{2}-\d{2}\/[\w.-]+\.json$/;

/** The few Blob operations this function needs; tests swap in an in-memory version. */
export interface Store {
  list(prefix: string): Promise<string[]>;
  read(pathname: string): Promise<unknown>;
  write(pathname: string, body: string): Promise<void>;
  remove(pathnames: string[]): Promise<void>;
}

export async function GET(request: Request): Promise<Response> {
  try {
    await verifyGithubOidc((request.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, ''), {
      audience: AUDIENCE,
      repository: REPOSITORY,
    });
  } catch (e) {
    return json(401, { ok: false, error: (e as Error).message });
  }
  if (!process.env.BLOB_STORE_ID && !process.env.BLOB_READ_WRITE_TOKEN)
    return json(503, { ok: false, error: 'no Blob store is connected to this project' });
  const url = new URL(request.url);
  const file = url.searchParams.get('file');
  if (file) {
    if (!FILE.test(file) || file.includes('..')) return json(400, { ok: false, error: 'bad file name' });
    const data = await blobStore.read(file).catch(() => undefined);
    if (data === undefined) return json(404, { ok: false, error: 'file not found or unreadable' });
    return json(200, { ok: true, batches: Array.isArray(data) ? data : [data] });
  }
  const today = new Date().toISOString().slice(0, 10);
  return json(200, { ok: true, files: await packAndIndex(blobStore, today, url.searchParams.get('since') ?? '') });
}

/**
 * Packs the raw batches of days before `today` into `compact/<day>/` files and deletes the raw ones, then lists
 * every file from `since` (a YYYY-MM-DD day) on. A crash between writing and deleting leaves duplicates, which
 * the reader drops by (session, seq).
 */
export async function packAndIndex(store: Store, today: string, since: string): Promise<string[]> {
  const raw = await store.list('telemetry/');
  const byDay = new Map<string, string[]>();
  for (const p of raw) {
    const day = p.split('/')[1];
    if (day < today) byDay.set(day, [...(byDay.get(day) ?? []), p]);
  }
  const removed = new Set<string>();
  for (const [day, paths] of byDay) {
    const read = await mapLimit(paths, 8, async (p) => ({ p, data: await store.read(p).catch(() => undefined) }));
    const ok = read.filter((r) => r.data !== undefined); // unreadable files stay where they are
    if (!ok.length) continue;
    let chunk: unknown[] = [];
    let size = 0;
    const chunks = [chunk];
    for (const { data } of ok) {
      const n = JSON.stringify(data).length;
      if (chunk.length && size + n > CHUNK_CHARS) {
        chunk = [];
        chunks.push(chunk);
        size = 0;
      }
      chunk.push(data);
      size += n;
    }
    for (const [i, c] of chunks.entries()) await store.write(`compact/${day}/${i}.json`, JSON.stringify(c));
    await store.remove(ok.map((r) => r.p));
    for (const r of ok) removed.add(r.p);
  }
  const packed = await store.list('compact/');
  return [...packed, ...raw.filter((p) => !removed.has(p))].filter((p) => p.split('/')[1] >= since);
}

const access = () => (process.env.TELEMETRY_BLOB_ACCESS === 'public' ? 'public' : 'private');

const blobStore: Store = {
  async list(prefix) {
    const out: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await list({ prefix, cursor, limit: 1000 });
      out.push(...page.blobs.map((b) => b.pathname));
      cursor = page.hasMore ? page.cursor : undefined;
    } while (cursor);
    return out;
  },
  async read(pathname) {
    // a store created as public holds public blobs, so try both
    for (const a of [access(), access() === 'private' ? 'public' : 'private'] as const) {
      const r = await get(pathname, { access: a }).catch(() => null);
      if (r?.stream) return JSON.parse(await new Response(r.stream).text());
    }
    throw new Error(`cannot read ${pathname}`);
  },
  async write(pathname, body) {
    try {
      await put(pathname, body, { access: access(), contentType: 'application/json', addRandomSuffix: true });
    } catch (e) {
      if (access() === 'public') throw e;
      await put(pathname, body, { access: 'public', contentType: 'application/json', addRandomSuffix: true });
    }
  },
  async remove(pathnames) {
    if (pathnames.length) await del(pathnames);
  },
};

type Jwk = JsonWebKey & { kid?: string };
let jwksCache: { keys: Jwk[]; at: number } | null = null;

async function githubKeys(kid: string): Promise<Jwk[]> {
  const age = jwksCache ? Date.now() - jwksCache.at : Infinity;
  if (jwksCache && age < 600_000 && jwksCache.keys.some((k) => k.kid === kid)) return jwksCache.keys;
  if (jwksCache && age < 60_000) return jwksCache.keys; // unknown key id: refetch at most once a minute
  const res = await fetch(`${ISSUER}/.well-known/jwks`);
  if (!res.ok) throw new Error(`cannot fetch GitHub signing keys (${res.status})`);
  jwksCache = { keys: ((await res.json()) as { keys: Jwk[] }).keys, at: Date.now() };
  return jwksCache.keys;
}

/** Verifies a GitHub Actions OIDC token (RS256) and returns its claims, or throws with the reason. */
export async function verifyGithubOidc(
  jwt: string,
  opts: { audience: string; repository: string; keys?: (kid: string) => Promise<Jwk[]>; now?: number },
): Promise<Record<string, unknown>> {
  const parts = jwt.split('.');
  if (parts.length !== 3) throw new Error('missing or malformed token');
  const [h, p, s] = parts;
  const header = JSON.parse(text(h)) as { alg?: string; kid?: string };
  if (header.alg !== 'RS256' || !header.kid) throw new Error('unsupported token');
  const jwk = (await (opts.keys ?? githubKeys)(header.kid)).find((k) => k.kid === header.kid);
  if (!jwk) throw new Error('unknown signing key');
  const alg = { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' };
  const key = await crypto.subtle.importKey('jwk', { kty: jwk.kty, n: jwk.n, e: jwk.e }, alg, false, ['verify']);
  if (!(await crypto.subtle.verify(alg, key, bytes(s), new TextEncoder().encode(`${h}.${p}`))))
    throw new Error('bad signature');
  const c = JSON.parse(text(p)) as Record<string, unknown>;
  const now = (opts.now ?? Date.now()) / 1000;
  if (c.iss !== ISSUER) throw new Error('wrong issuer');
  if (!(Array.isArray(c.aud) ? c.aud : [c.aud]).includes(opts.audience)) throw new Error('wrong audience');
  if (typeof c.exp !== 'number' || c.exp < now - 30) throw new Error('token expired');
  if (typeof c.nbf === 'number' && c.nbf > now + 30) throw new Error('token not yet valid');
  if (String(c.repository ?? '').toLowerCase() !== opts.repository.toLowerCase()) throw new Error('repository not allowed');
  return c;
}

const bytes = (b64url: string) => new Uint8Array(Buffer.from(b64url, 'base64url'));
const text = (b64url: string) => Buffer.from(b64url, 'base64url').toString('utf8');

async function mapLimit<T, R>(items: T[], n: number, f: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await f(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
  return out;
}

function json(status: number, data: unknown): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
}
