import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { CompiledStage } from '../src/core/compile.ts';
import { cellKey } from '../src/core/math.ts';
import { resolveSlots } from '../src/core/slots.ts';
import { remainingActions, solveSection } from '../src/core/solver.ts';
import { tunableErrors, type Tunables } from '../src/core/tunables.ts';
import type { StageFile } from '../src/core/types.ts';
import { validateStage } from '../src/core/validate.ts';

const load = (): StageFile => JSON.parse(readFileSync('src/stages/area1.json', 'utf8'));

test('area 1 validates and matches the design verification', () => {
  const r = validateStage(load());
  assert.deepEqual(r.issues.filter((i) => i.level === 'error'), []);
  assert.equal(r.sections.s1_first_fold.optimal, 1);
  assert.equal(r.sections.s2_path_cube.optimal, 2);
  assert.equal(r.sections.s3_fold_gate.optimal, 3);
  for (const m of Object.values(r.sections)) assert.equal(m.deadEnds, 0);
  const penalties = Object.fromEntries(r.sections.s2_path_cube.firstMoves.map((f) => [f.key, f.penalty]));
  assert.deepEqual(penalties, { 'c_roll:x90': 0, 'c_roll:x180': 1, 'c_roll:x270': 1 });
});

test('rolling the cube once opens the west-north corner', () => {
  const cs = new CompiledStage(load());
  const s0 = cs.initialState();
  const w = cellKey([0, 3, 0]);
  const north = cellKey([3, 3, -3]);
  assert.notEqual(cs.walkMap(s0).region.get(w), cs.walkMap(s0).region.get(north));
  const s1 = cs.apply(s0, { console: 'c_roll', group: 'g_cube', kind: 'turn', axis: 'x', quarters: 1 });
  assert.equal(cs.walkMap(s1).region.get(w), cs.walkMap(s1).region.get(north));
  // the plate between the road end and the cube only exists while the cube shows a west arm
  assert.equal(cs.walkMap(s0).tiles.has(cellKey([1, 3, 0])), false);
  assert.equal(cs.walkMap(s1).tiles.get(cellKey([1, 3, 0]))?.plate, true);
});

test('the tower arm blocks the street fold only where it intrudes into the lane', () => {
  const cs = new CompiledStage(load());
  const fold = { console: 'c_h', group: 'g_street', kind: 'set', to: 1 } as const;
  for (const [tower, blocked] of [[0, true], [1, false], [2, false], [3, true]] as const) {
    const s = { ...cs.initialState(), g_tower: tower };
    assert.equal(cs.sweepBlockers(s, fold).includes('m_tower'), blocked, `tower state ${tower}`);
  }
});

test('stranding yourself on the ledge is not a dead end', () => {
  const cs = new CompiledStage(load());
  const s = { ...cs.initialState(), g_tower: 1 };
  assert.equal(remainingActions(cs, 's3_fold_gate', s, cellKey([10, 3, -2])), 1);
});

test('the validator rejects a cube that can be crossed without turning it', () => {
  const stage = load();
  const cube = stage.modules.find((m) => m.id === 'm_cube')!;
  if (cube.type !== 'cube3') throw new Error('unexpected module type');
  cube.params.faces.top = ['W', 'E'];
  const r = validateStage(stage);
  assert.ok(r.issues.some((i) => i.rule === 'L2' && i.message.includes('s2_path_cube')));
  assert.ok(r.issues.some((i) => i.rule === 'L4'));
});

test('the validator rejects a console placed on a moving module', () => {
  const stage = load();
  stage.slots = stage.slots!.filter((s) => s.target.id !== 'c_yaw'); // the slot would override the position
  stage.interactables.find((c) => c.id === 'c_yaw')!.at = [3, 3, 0];
  const r = validateStage(stage);
  assert.ok(r.issues.some((i) => i.rule === 'G2' && i.message.includes('c_yaw')));
});

test('slot options are applied and every option is validated', () => {
  const stage = load();
  stage.slots!.find((s) => s.id === 'slot_yaw_console')!.current = 1;
  const resolved = resolveSlots(stage);
  assert.deepEqual(resolved.interactables.find((c) => c.id === 'c_yaw')!.at, [2, 3, -3]);
  const cs = new CompiledStage(resolved);
  assert.equal(solveSection(cs, 's2_path_cube').optimal, 2);
});

test('tunables outside their ranges are reported', () => {
  const t = JSON.parse(readFileSync('src/stages/tunables.json', 'utf8')) as Tunables;
  assert.deepEqual(tunableErrors(t, Object.keys(t.sections)), []);
  t.player.walkSpeed = 20;
  t.sections.s1_first_fold.secondHintSec = 5;
  const errs = tunableErrors(t, Object.keys(t.sections));
  assert.ok(errs.some((e) => e.startsWith('player.walkSpeed')));
  assert.ok(errs.some((e) => e.includes('secondHintSec')));
});
