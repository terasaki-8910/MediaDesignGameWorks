import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';
import { GET as status } from '../api/telemetry.ts';
import { AUDIENCE, GET as exportGET, packAndIndex, verifyGithubOidc, type Store } from '../api/telemetry-export.ts';
import { loadBatches } from '../tools/ai/store.ts';

const REPO = 'terasaki-8910/MediaDesignGameWorks';
const enc = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');

async function signer() {
  const alg = { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' };
  const pair = (await crypto.subtle.generateKey(alg, true, ['sign', 'verify'])) as CryptoKeyPair;
  const jwk = { ...(await crypto.subtle.exportKey('jwk', pair.publicKey)), kid: 'k1' };
  const sign = async (claims: Record<string, unknown>, header: Record<string, unknown> = { alg: 'RS256', kid: 'k1' }) => {
    const input = `${enc(header)}.${enc(claims)}`;
    const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', pair.privateKey, new TextEncoder().encode(input));
    return `${input}.${Buffer.from(sig).toString('base64url')}`;
  };
  return { sign, keys: async () => [jwk] };
}

test('GitHub OIDC tokens are checked for signature, issuer, audience, time and repository', async () => {
  const { sign, keys } = await signer();
  const now = Date.now();
  const claims = { iss: 'https://token.actions.githubusercontent.com', aud: AUDIENCE, repository: REPO, exp: now / 1000 + 300 };
  const opts = { audience: AUDIENCE, repository: REPO, keys, now };
  assert.equal((await verifyGithubOidc(await sign(claims), opts)).repository, REPO);
  const lower = { ...claims, repository: REPO.toLowerCase() };
  assert.ok(await verifyGithubOidc(await sign(lower), opts), 'repository names compare case-insensitively');
  const reject = async (jwt: string, reason: RegExp) => assert.rejects(verifyGithubOidc(jwt, opts), reason);
  await reject(await sign({ ...claims, aud: 'someone-else' }), /audience/);
  await reject(await sign({ ...claims, repository: 'evil/fork' }), /repository/);
  await reject(await sign({ ...claims, iss: 'https://example.com' }), /issuer/);
  await reject(await sign({ ...claims, exp: now / 1000 - 120 }), /expired/);
  await reject(await sign(claims, { alg: 'none', kid: 'k1' }), /unsupported/);
  await reject(await sign(claims, { alg: 'RS256', kid: 'k2' }), /unknown signing key/);
  const good = await sign(claims);
  const [h, , s] = good.split('.');
  await reject(`${h}.${enc({ ...claims, repository: 'x/y' })}.${s}`, /signature/);
  await reject('', /malformed/);
});

test('the export endpoint refuses callers without a valid token', async () => {
  const res = await exportGET(new Request('https://x/api/telemetry-export'));
  assert.equal(res.status, 401);
  const forged = await exportGET(new Request('https://x/api/telemetry-export', { headers: { authorization: 'Bearer a.b.c' } }));
  assert.equal(forged.status, 401);
});

test('the status endpoint reports which Blob credentials the project has', async () => {
  const saved = { id: process.env.BLOB_STORE_ID, token: process.env.BLOB_READ_WRITE_TOKEN };
  delete process.env.BLOB_STORE_ID;
  delete process.env.BLOB_READ_WRITE_TOKEN;
  assert.equal((await status().json()).storage, 'none');
  process.env.BLOB_STORE_ID = 'store_test';
  assert.equal((await status().json()).storage, 'oidc');
  if (saved.id === undefined) delete process.env.BLOB_STORE_ID;
  else process.env.BLOB_STORE_ID = saved.id;
  if (saved.token !== undefined) process.env.BLOB_READ_WRITE_TOKEN = saved.token;
});

function memoryStore(files: Record<string, unknown>) {
  const writes: string[] = [];
  const store: Store = {
    list: async (prefix) => Object.keys(files).filter((p) => p.startsWith(prefix)).sort(),
    read: async (p) => {
      if (files[p] === 'corrupt') throw new Error('corrupt');
      return files[p];
    },
    write: async (p, body) => {
      writes.push(p);
      files[p] = JSON.parse(body);
    },
    remove: async (ps) => ps.forEach((p) => delete files[p]),
  };
  return { store, files, writes };
}

test('finished days are packed once, today and unreadable files are left in place', async () => {
  const batch = (session: string, seq: number) => ({ v: 1, session, seq, playtest: false, events: [] });
  const m = memoryStore({
    'telemetry/2026-10-25/a-000.json': batch('a', 0),
    'telemetry/2026-10-26/a-001.json': batch('a', 1),
    'telemetry/2026-10-26/b-000.json': batch('b', 0),
    'telemetry/2026-10-26/bad.json': 'corrupt',
    'telemetry/2026-10-27/c-000.json': batch('c', 0),
  });
  const files = await packAndIndex(m.store, '2026-10-27', '');
  assert.deepEqual(files, [
    'compact/2026-10-25/0.json',
    'compact/2026-10-26/0.json',
    'telemetry/2026-10-26/bad.json',
    'telemetry/2026-10-27/c-000.json',
  ]);
  assert.equal((m.files['compact/2026-10-26/0.json'] as unknown[]).length, 2);
  assert.ok(!('telemetry/2026-10-26/a-001.json' in m.files), 'packed raw files are deleted');
  assert.deepEqual(await packAndIndex(m.store, '2026-10-27', ''), files, 'a second run changes nothing');
  assert.equal(m.writes.length, 2);
  assert.deepEqual(await packAndIndex(m.store, '2026-10-27', '2026-10-26'), files.slice(1), 'since drops older days');
});

test('a large day is split into files under the response limit', async () => {
  const big = (seq: number) => ({ v: 1, session: 's', seq, playtest: false, events: [{ pad: 'x'.repeat(900_000) }] });
  const m = memoryStore({ 'telemetry/2026-10-26/1.json': big(1), 'telemetry/2026-10-26/2.json': big(2), 'telemetry/2026-10-26/3.json': big(3) });
  const files = await packAndIndex(m.store, '2026-10-27', '');
  assert.deepEqual(files, ['compact/2026-10-26/0.json', 'compact/2026-10-26/1.json']);
  assert.deepEqual(
    files.map((f) => (m.files[f] as unknown[]).length),
    [2, 1],
  );
});

test('the workflow side pages through the export endpoint with its OIDC token and drops duplicates', async () => {
  const batch = (session: string, seq: number) => ({ v: 1, session, seq, playtest: false, events: [] });
  const seen: string[] = [];
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const send = (code: number, body: unknown) => res.writeHead(code, { 'content-type': 'application/json' }).end(JSON.stringify(body));
    if (url.pathname === '/token') {
      assert.equal(req.headers.authorization, 'bearer request-token');
      return send(200, { value: `jwt-for-${url.searchParams.get('audience')}` });
    }
    seen.push(req.headers.authorization ?? '');
    const file = url.searchParams.get('file');
    if (!file) return send(200, { ok: true, files: ['compact/2026-10-26/0.json', 'telemetry/2026-10-27/x.json', 'telemetry/2026-10-27/broken.json'] });
    if (file.includes('broken')) return send(500, { ok: false, error: 'boom' });
    return send(200, { ok: true, batches: file.startsWith('compact') ? [batch('a', 0), batch('a', 1)] : [batch('a', 1), batch('b', 0)] });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  process.env.ACTIONS_ID_TOKEN_REQUEST_URL = `${base}/token?api-version=2.0`;
  process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN = 'request-token';
  const warn = console.warn;
  console.warn = () => {};
  try {
    const batches = await loadBatches({ exportUrl: `${base}/export`, sinceDays: 60 });
    assert.deepEqual(
      batches.map((b) => `${b.session}:${b.seq}`),
      ['a:0', 'a:1', 'b:0'],
    );
    assert.ok(seen.every((h) => h === `Bearer jwt-for-${AUDIENCE}`));
  } finally {
    console.warn = warn;
    server.close();
    delete process.env.ACTIONS_ID_TOKEN_REQUEST_URL;
    delete process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
  }
});
