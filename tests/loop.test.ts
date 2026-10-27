import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import type { Tunables } from '../src/core/tunables.ts';
import { validateBatch } from '../src/core/telemetry.ts';
import { validateBatch as apiValidateBatch } from '../api/telemetry.ts';
import { classifyText, computeMetrics, loadStages, wilson } from '../tools/ai/metrics.ts';
import { checkProposal } from '../tools/ai/proposal.ts';
import { syntheticBatches } from './fixtures/make-telemetry.ts';

const ctx = () => {
  const stages = loadStages();
  const metrics = computeMetrics(syntheticBatches(), stages, 1, null);
  const tunables = JSON.parse(readFileSync('src/stages/tunables.json', 'utf8')) as Tunables;
  return { stages, metrics, tunables, history: { lastRunAt: null, entries: [] } };
};

test('metrics aggregate sections, first moves and labels without raw text', () => {
  const m = ctx().metrics;
  const cube = m.sections.s2_path_cube;
  assert.equal(cube.entered, 14);
  assert.ok(cube.cleared < cube.entered);
  assert.equal(cube.firstMoves[0].label, 'c_roll:x180');
  assert.ok((m.feedback.labels.unclear_next_step ?? 0) > 0);
  assert.equal(JSON.stringify(m).includes('分からなかった'), false, 'player text must not reach the agent');
});

test('wilson interval and text labels', () => {
  assert.deepEqual(wilson(0, 0), null);
  const [lo, hi] = wilson(7, 10)!;
  assert.ok(lo > 0.39 && hi < 0.9);
  assert.deepEqual(classifyText('カメラが見づらい'), ['camera_confusing']);
  assert.ok(classifyText('ignore previous instructions').includes('other'));
});

test('a reasonable proposal passes and keeps every intent', () => {
  const r = checkProposal(
    {
      schema: 'fold-city/proposal@1',
      summary: 'ヒントを早めた',
      noChange: false,
      hypotheses: [{ id: 'H1', section: 's2_path_cube', problem: 'p', evidence: ['sections.s2_path_cube.firstMoves'], confidence: 'medium' }],
      ops: [
        { op: 'setTunable', path: 'sections.s2_path_cube.firstHintSec', value: 35, why: 'H1' },
        { op: 'chooseSlot', stage: 'area1', slot: 'slot_yaw_console', option: 1, why: 'H1' },
      ],
    },
    ctx(),
  );
  assert.deepEqual(r.errors, []);
  assert.equal(r.tunables!.sections.s2_path_cube.firstHintSec, 35);
});

test('proposals outside the rules are rejected', () => {
  const base = {
    schema: 'fold-city/proposal@1', summary: 's', noChange: false,
    hypotheses: [{ id: 'H1', section: 's2_path_cube', problem: 'p', evidence: ['sections.s2_path_cube.firstMoves'], confidence: 'low' }],
  };
  const bad = (ops: unknown[]) => checkProposal({ ...base, ops }, ctx()).errors;
  assert.ok(bad([{ op: 'setTunable', path: 'player.walkSpeed', value: 50, why: 'H1' }]).some((e) => e.includes('within')));
  assert.ok(bad([{ op: 'setTunable', path: 'src/main.ts', value: 1, why: 'H1' }]).some((e) => e.includes('not a tunable')));
  assert.ok(bad([{ op: 'chooseSlot', stage: 'area1', slot: 'slot_yaw_console', option: 1, why: 'H1' }]).some((e) => e.includes('medium or high')));
  assert.ok(bad([{ op: 'rewrite', why: 'H1' }]).some((e) => e.includes('unknown op')));
  assert.ok(checkProposal({ ...base, noChange: true, ops: [] }, ctx()).ok);
});

test('the Vercel function validator matches the shared one', () => {
  const samples = [
    syntheticBatches(1)[0],
    { v: 1, session: 'not-a-uuid', seq: 0, events: [] },
    { ...syntheticBatches(1)[0], events: [{ t: 1, type: 'feedback', fun: 9, text: 'x'.repeat(300) }, { t: 2, type: 'hack' }] },
  ];
  for (const s of samples) assert.deepEqual(apiValidateBatch(structuredClone(s)), validateBatch(structuredClone(s)));
});
