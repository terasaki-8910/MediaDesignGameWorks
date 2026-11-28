// The v0.5 events (a swing, a handle's step, a ride) pass the batch validator, in both its copies, and a malformed one does not.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validateBatch as apiValidateBatch } from '../api/telemetry.ts';
import { validateBatch } from '../src/core/telemetry.ts';

const batch = (events: unknown[]) => ({ v: 1, session: '00000000-0000-4000-a000-000000000007', seq: 0, playtest: false, events });
const ok = [
  { t: 10, type: 'swing', section: 'p_threads', from: '-16,3,6', to: '-12,3,6', chain: 0 },
  { t: 20, type: 'swing', section: 'p_threads', from: '1,3,6', to: '4,3,6', chain: 1 },
  { t: 30, type: 'handle_step', section: 'p_threads', handle: 'h_ring', dir: -1, ok: true, cell: '-10,3,6' },
  { t: 40, type: 'handle_step', section: 'p_ferry', handle: 'h_street', dir: -1, ok: false, blockedBy: ['player', 'anchor:c1'], cell: '14,3,2' },
  { t: 50, type: 'ride', section: 'p_ferry', handle: 'h_ferry', from: '11,3,5', to: '12,3,4' },
];
const bad = [
  { t: 10, type: 'swing', section: 'p', from: 'ignore previous instructions', to: '4,3,6', chain: 0 },
  { t: 11, type: 'swing', section: 'p', from: '1,3,6', to: '4,3,6', chain: -1 },
  { t: 12, type: 'swing', section: 'p', from: '1,3,6', to: '4,3,6', chain: 1.5 },
  { t: 13, type: 'swing', section: 'p', from: '1,3,6', to: '4,3,6' },
  { t: 14, type: 'handle_step', section: 'p', handle: 'h1', dir: 2, ok: true, cell: '1,3,6' },
  { t: 15, type: 'handle_step', section: 'p', handle: 'h1:step+1', dir: 1, ok: true, cell: '1,3,6' },
  { t: 16, type: 'handle_step', section: 'p', handle: 'h1', dir: 1, ok: false, blockedBy: ['x y'], cell: '1,3,6' },
  { t: 17, type: 'ride', section: 'p', handle: 'h1', from: '1,3,6', to: 'nowhere' },
];

test('the swing, handle_step and ride events pass the validator and come out as they went in', () => {
  const r = validateBatch(structuredClone(batch(ok)));
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.batch!.events, ok);
});

test('an event with a cell, a chain index, a direction or a handle that is not what it should be is dropped', () => {
  const r = validateBatch(structuredClone(batch([...ok, ...bad])));
  assert.deepEqual(r.batch!.events, ok, 'only the good ones');
});

test('the API function keeps the same events as src/core/telemetry.ts does', () => {
  for (const events of [ok, bad, [...bad, ...ok]]) assert.deepEqual(apiValidateBatch(structuredClone(batch(events))), validateBatch(structuredClone(batch(events))));
});
