// The first puzzle (s1_first_fold) is a real puzzle: two folds, two consoles in view from the start, the obvious fold is a wrong
// turn that can be undone, and nothing tells the player what to press (v0.5, "stage 1 as a real puzzle").
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { CompiledStage, actionKey, walkPath } from '../src/core/compile.ts';
import { cellKey } from '../src/core/math.ts';
import { reachableNodes, remainingActions, solveSection } from '../src/core/solver.ts';
import type { Tunables } from '../src/core/tunables.ts';
import type { StageFile } from '../src/core/types.ts';
import { validateStage } from '../src/core/validate.ts';

const stage = JSON.parse(readFileSync('src/stages/area1.json', 'utf8')) as StageFile;
const tunables = JSON.parse(readFileSync('src/stages/tunables.json', 'utf8')) as Tunables;
const cs = new CompiledStage(stage);
const SEC = 's1_first_fold';
const s0 = cs.initialState();
const section = stage.sections.find((s) => s.id === SEC)!;
const start = cellKey(stage.checkpoints.find((c) => c.id === section.start)!.at);
const exit = cellKey(section.exit[0]);
const here = (state: typeof s0, cell: string) => cs.walkMap(state).region.get(cell);
const cellOf = (console: string) => cellKey(cs.consoles.get(console)!.at);

test('two folds are the shortest way, and the first one a player sees at a console is not the one that leads on', () => {
  const r = validateStage(stage);
  assert.deepEqual(r.issues.filter((i) => i.level === 'error'), []);
  const m = r.sections[SEC];
  assert.equal(m.optimal, 2);
  assert.equal(m.deadEnds, 0);
  const penalties = Object.fromEntries(m.firstMoves.map((f) => [f.key, f.penalty]));
  assert.deepEqual(penalties, { 'c0:set1': 0, 'c1:set1': 2 }, 'two folds are open at the start; one leads on, the other costs a fold and its undo');
  assert.deepEqual(section.intent.optimalActions, { min: 2, max: 2 });
  assert.deepEqual([...section.intent.mustUse].sort(), ['c0', 'c1']);
  const { moves } = solveSection(cs, SEC);
  assert.deepEqual(moves.map((x) => x.key), ['c0:set1', 'c1:set1']);
  assert.deepEqual(moves.map((x) => x.at), [cellOf('c0'), cellOf('c1')], 'each from its own console');
});

test('both consoles can be walked to from the start, and no fold of this puzzle is blocked by interference', () => {
  assert.notEqual(walkPath(cs.walkMap(s0), start, [cellOf('c0')]), null, 'the near bridge\'s console is reachable');
  assert.notEqual(walkPath(cs.walkMap(s0), start, [cellOf('c1')]), null, 'and the far bridge\'s');
  assert.equal(walkPath(cs.walkMap(s0), start, [exit]), null, 'the exit is not');
  for (const { state } of reachableNodes(cs, SEC))
    for (const id of section.consoles) for (const o of cs.consoleActions(id, state)) assert.deepEqual(o.blockedBy, [], `${id} ${actionKey(o.action)}`);
});

test('the wrong fold strands the player from the other console, and the console they stand at undoes it', () => {
  const wrong = cs.consoleActions('c1', s0).find((o) => actionKey(o.action) === 'c1:set1')!.action;
  const s = cs.apply(s0, wrong);
  const c1 = cellOf('c1');
  assert.equal(here(s, c1), here(s, start), 'they stand on the road they came by');
  assert.notEqual(here(s, c1), here(s, cellOf('c0')), 'the near bridge\'s console is cut off: the far bridge was the way to it');
  assert.equal(walkPath(cs.walkMap(s), start, [exit]), null, 'and the exit is still out of reach');
  const undo = cs.consoleActions('c1', s).find((o) => o.action.kind === 'set' && o.action.to === 0)!;
  assert.deepEqual(undo.blockedBy, []);
  assert.deepEqual(cs.apply(s, undo.action), s0, 'the undo is one fold, at the console where the fold was made');
  assert.equal(remainingActions(cs, SEC, s0, start), 2);
  assert.equal(remainingActions(cs, SEC, s, c1), 3, 'undo, then the two folds');
});

test('every fold of the puzzle can be undone: from every state the player can bring about, the exit is still in reach', () => {
  const nodes = reachableNodes(cs, SEC);
  assert.ok(nodes.length >= 4);
  for (const n of nodes) assert.notEqual(remainingActions(cs, SEC, n.state, n.cell), null, cs.stateKey(n.state));
});

test('one fold of the two is not enough, and the order of the two is the near bridge first', () => {
  const [first, second] = solveSection(cs, SEC).plan;
  const after = cs.apply(s0, first);
  assert.equal(here(after, start), here(after, cellOf('c1')), 'after the near bridge the far console is still there');
  assert.notEqual(here(after, start), here(after, exit));
  assert.equal(here(cs.apply(after, second), start), here(cs.apply(after, second), exit));
  // (the other order: the far bridge first leaves nothing to walk to its next fold)
  const farFirst = cs.apply(s0, second);
  assert.notEqual(here(farFirst, start), here(farFirst, cellOf('c0')));
});

test('nothing guides the player: no light columns, and the intro names neither a key nor a console', () => {
  assert.equal(tunables.sections[SEC].beacon, 0, 'the owner asked for no light columns in the first puzzle');
  const intro = section.intro!.ja;
  assert.ok(intro.length > 0 && intro.length <= 20, `one short line (${intro})`);
  assert.ok(!/<kbd>|E\b|操作盤|折|回|向き/.test(intro), `the intro gives no solution (${intro})`);
  assert.ok(!/<kbd>|\bE\b|press|console/i.test(section.intro!.en));
});
