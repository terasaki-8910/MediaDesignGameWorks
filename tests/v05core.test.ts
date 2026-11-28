// The v0.5 core: tethers, handles, riding and clockwork, in the solver and in the validator.
// The stage is tests/fixtures/proto-core.json (one section per mechanic); the variants below change it in memory.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { CompiledStage, actionKey, walkLinks, walkPath } from '../src/core/compile.ts';
import { CUBE_GROUP, cellKey, type Side } from '../src/core/math.ts';
import { nextAction, nextMove, reachableNodes, remainingActions, solveSection } from '../src/core/solver.ts';
import type { PlayerAction, PuzzleState, StageFile, StepAction } from '../src/core/types.ts';
import { validateStage } from '../src/core/validate.ts';
import { validateFiles } from '../tools/validate.ts';

const fixture = (): StageFile => JSON.parse(readFileSync('tests/fixtures/proto-core.json', 'utf8'));
const area1 = (): StageFile => JSON.parse(readFileSync('src/stages/area1.json', 'utf8'));
/** The fixture with a change made to it. */
const variant = (change: (s: StageFile) => void): StageFile => {
  const s = fixture();
  change(s);
  return s;
};
const module = (s: StageFile, id: string) => s.modules.find((m) => m.id === id)!;
const group = (s: StageFile, id: string) => s.groups.find((g) => g.id === id)!;
const section = (s: StageFile, id: string) => s.sections.find((x) => x.id === id)!;
const step = (handle: string, group: string, dir: 1 | -1): StepAction => ({ handle, group, kind: 'step', dir });
/** The rules a stage breaks, as `level rule` (sorted, each once). */
const rules = (s: StageFile) => [...new Set(validateStage(s).issues.map((i) => `${i.level} ${i.rule}`))].sort();

const cs = new CompiledStage(fixture());
const s0 = cs.initialState();

// --- the fixture and the CLI -----------------------------------------------------------------------------------------------

test('the fixture validates with no errors, and each section has the intended plan', () => {
  const r = validateStage(fixture());
  assert.deepEqual(r.issues, []);
  const m = r.sections;
  assert.deepEqual(
    Object.fromEntries(Object.entries(m).map(([id, x]) => [id, [x.optimal, x.waits, x.links, x.rides, x.deadEnds]])),
    {
      p_tether: [0, 0, 1, 0, 0],
      p_tether_fold: [1, 0, 1, 0, 0],
      p_handle: [1, 0, 0, 0, 0],
      p_ride: [2, 0, 0, 1, 0],
      p_clock: [0, 1, 0, 0, 0],
    },
  );
});

test('the validate CLI takes stage files by path', () => {
  const r = validateFiles(['tests/fixtures/proto-core.json']);
  assert.equal(r.ok, true);
  assert.equal(r.reports.length, 1);
  assert.equal(r.reports[0].stageId, 'proto-core');
  assert.equal(r.tunableIssues.length, 0);
});

// --- console actions are what they were -------------------------------------------------------------------------------------

test('area 1: a console action is allowed exactly when nothing is swept, in every state', () => {
  const stage = area1();
  const a1 = new CompiledStage(stage);
  let checked = 0;
  for (const sec of stage.sections) {
    const gs = sec.groups.map((id) => stage.groups.find((g) => g.id === id)!);
    const ranges = gs.map((g) => (g.kind === 'states' ? g.states.map((_, i) => i) : CUBE_GROUP.map((_, i) => i)));
    const combos = ranges.reduce<number[][]>((acc, r) => acc.flatMap((a) => r.map((v) => [...a, v])), [[]]);
    for (const combo of combos) {
      const s: PuzzleState = { ...a1.initialState(), ...Object.fromEntries(gs.map((g, i) => [g.id, combo[i]])) };
      for (const id of sec.consoles) {
        const c = a1.consoles.get(id)!;
        for (const { action, blockedBy } of a1.consoleActions(id, s)) {
          const o = a1.motionOutcome(s, action, cellKey(c.at));
          assert.equal(o.ok, blockedBy.length === 0, `${sec.id} ${actionKey(action)} in ${a1.stateKey(s)}`);
          if (o.ok) assert.deepEqual([o.cell, o.ride], [cellKey(c.at), false]);
          else assert.deepEqual(o.blockedBy, blockedBy);
          checked++;
        }
      }
    }
  }
  assert.ok(checked > 100);
});

// --- tethers ----------------------------------------------------------------------------------------------------------------

test('two facing tethers 4 cells apart link their platforms into one region', () => {
  const wm = cs.walkMap(s0);
  assert.deepEqual(wm.links, [{ a: 't_ra', b: 't_rb', from: '2,3,0', to: '7,3,0' }]);
  assert.equal(wm.region.get('0,3,0'), wm.region.get('9,3,0'));
  const bare = new CompiledStage(variant((s) => (s.modules = s.modules.filter((m) => m.id !== 't_ra'))));
  assert.deepEqual(bare.walkMap(bare.initialState()).links, []);
  assert.notEqual(bare.walkMap(bare.initialState()).region.get('0,3,0'), bare.walkMap(bare.initialState()).region.get('9,3,0'));
});

test('walkPath crosses a link as one hop, both ways, and walkLinks counts the crossings', () => {
  const wm = cs.walkMap(s0);
  assert.deepEqual(walkPath(wm, '0,3,0', ['9,3,0']), ['1,3,0', '2,3,0', '7,3,0', '8,3,0', '9,3,0']);
  assert.deepEqual(walkPath(wm, '9,3,0', ['0,3,0']), ['8,3,0', '7,3,0', '2,3,0', '1,3,0', '0,3,0']);
  assert.equal(walkLinks(wm, '0,3,0', ['9,3,0']), 1);
  assert.equal(walkLinks(wm, '0,3,0', ['1,3,0']), 0);
  assert.equal(walkLinks(wm, '0,3,0', ['0,3,0']), 0);
  assert.equal(walkLinks(wm, '0,3,0', ['0,3,10']), null);
  assert.equal(walkPath(wm, '0,3,0', ['0,3,10']), null);
});

test('a thread needs facing tethers, a short enough span, at most 2 levels, a clear line and the first tether on the ray', () => {
  const links = (s: StageFile) => {
    const c = new CompiledStage(s);
    return c.walkMap(c.initialState()).links.filter((l) => l.a.startsWith('t_')).length;
  };
  assert.equal(links(fixture()), 1);
  // the same way: no thread
  assert.equal(links(variant((s) => ((module(s, 't_rb') as { params: { facing: Side } }).params.facing = 'E'))), 0);
  // across (not opposite): no thread
  assert.equal(links(variant((s) => ((module(s, 't_rb') as { params: { facing: Side } }).params.facing = 'N'))), 0);
  // 5 cells apart: a span of 4 does not reach, 5 does (of either end)
  assert.equal(links(variant((s) => ((module(s, 't_ra') as { params: { span?: number } }).params.span = 4))), 0);
  assert.equal(links(variant((s) => ((module(s, 't_rb') as { params: { span?: number } }).params.span = 4))), 0);
  assert.equal(links(variant((s) => ((module(s, 't_ra') as { params: { span?: number } }).params.span = 5))), 1);
  // adjacent cells (k = 1) do not link
  assert.equal(links(variant((s) => { module(s, 't_b').at = [3, 3, 0]; module(s, 't_rb').at = [3, 3, 0]; })), 0);
  // levels: 2 up still links, 3 up does not (the landing platform moves with it)
  const up = (n: number) => variant((s) => { module(s, 't_b').at = [7, 3 + n, 0]; module(s, 't_rb').at = [7, 3 + n, 0]; });
  assert.equal(links(up(2)), 1);
  assert.equal(links(up(3)), 0);
  assert.equal(links(up(-2)), 1);
  assert.equal(links(up(-3)), 0);
  // a landing cell that is not walkable
  assert.equal(links(variant((s) => (s.modules = s.modules.filter((m) => m.id !== 't_b')))), 0);
  assert.equal(links(variant((s) => (s.modules = s.modules.filter((m) => m.id !== 't_a')))), 0);
  // a solid in the way: a tower's shaft (here 2 levels up from the thread's level) stands in the line, a floor under it does not
  const tower = (level: number) => variant((s) => s.modules.push({ id: 'x', type: 'tower', at: [4, level, 0], params: { arms: [], depth: 30 } }));
  assert.equal(links(tower(5)), 0);
  assert.equal(links(tower(3)), 1);
  // a tether in between is the first on the ray, so the far one is not found
  assert.equal(links(variant((s) => s.modules.push({ id: 'x', type: 'tether', at: [4, 3, 0], params: { facing: 'N' } }))), 0);
  // ... but not when it is more than 2 levels off the line
  assert.equal(links(variant((s) => s.modules.push({ id: 'x', type: 'tether', at: [4, 6, 0], params: { facing: 'N' } }))), 1);
  // and not when it is off the ray to the side
  assert.equal(links(variant((s) => s.modules.push({ id: 'x', type: 'tether', at: [4, 3, 1], params: { facing: 'N' } }))), 1);
});

test('a tether on a group moves with it: its cell and its facing follow the state', () => {
  const s = fixture();
  const ferryTether = { id: 'x', type: 'tether', at: [8, 3, 31], group: 'g_ferry', params: { facing: 'W' } } as const;
  s.modules.push(ferryTether);
  const c = new CompiledStage(s);
  const end = (i: number) => c.tetherEnd(c.tethers.find((m) => m.id === 'x')!, { ...c.initialState(), g_ferry: i });
  assert.deepEqual([end(0).key, end(0).side], ['8,3,31', 'W']);
  // a quarter turn about the middle of the ferry: the end cell goes to the east of the middle, and west turns to south
  assert.deepEqual([end(1).key, end(1).side], ['9,3,30', 'S']);
  assert.equal(end(0).ring[1], 12 + 1.6);
  // rolled onto its side the ring faces up or down, and links to nothing
  const t = fixture();
  t.groups.push({ id: 'g_side', kind: 'states', pivot: [10, 12, 2], axis: 'z', states: [0, 1], initial: 1 });
  (module(t, 't_ra') as { group?: string }).group = 'g_side';
  const side = new CompiledStage(t);
  assert.equal(side.tetherEnd(side.tethers.find((m) => m.id === 't_ra')!, side.initialState()).side, null);
  assert.deepEqual(side.walkMap(side.initialState()).links, []);
});

test('a tether on a group links only after the fold', () => {
  const before = cs.walkMap(s0);
  assert.equal(before.links.some((l) => l.a === 'f_ra'), false);
  assert.notEqual(before.region.get('0,3,10'), before.region.get('10,3,10'));
  const fold = cs.consoleActions('c_ring', s0).find((o) => o.action.kind === 'set')!;
  assert.deepEqual(fold.blockedBy, []);
  const after = cs.walkMap(cs.apply(s0, fold.action));
  assert.deepEqual(after.links.filter((l) => l.a === 'f_ra'), [{ a: 'f_ra', b: 'f_rb', from: '2,3,10', to: '8,3,10' }]);
  assert.equal(after.region.get('0,3,10'), after.region.get('10,3,10'));
  const r = solveSection(cs, 'p_tether_fold');
  assert.equal(r.optimal, 1);
  assert.deepEqual(r.plan.map(actionKey), ['c_ring:set1']);
  assert.equal(r.links, 1);
});

test('the tether sections as the solver sees them', () => {
  const plain = solveSection(cs, 'p_tether');
  assert.equal(plain.optimal, 0);
  assert.deepEqual(plain.moves, []);
  assert.equal(plain.links, 1);
  assert.equal(plain.explored, 1);
});

// --- handles ----------------------------------------------------------------------------------------------------------------

test('a handle is used from the cells in reach with a clear line, and not from the ones the wall hides', () => {
  const reach = cs.handleReach('h1', s0);
  assert.deepEqual(reach, ['2,3,20', '3,3,20', '4,3,20']);
  // 0 and 1 are close enough (2.8 and 2.2 cells) and on the same level, but the tower's shaft stands in the line
  const h = cs.handles.get('h1')!;
  for (const x of [0, 1]) {
    assert.ok(Math.hypot(x - h.at[0], 20 - h.at[2]) <= 3);
    assert.ok(!reach.includes(`${x},3,20`));
  }
  // without the wall they are in reach, and the cells beyond the radius never are
  const open = new CompiledStage(variant((s) => (s.modules = s.modules.filter((m) => m.id !== 'h_wall'))));
  assert.deepEqual(open.handleReach('h1', open.initialState()), ['0,3,20', '1,3,20', '2,3,20', '3,3,20', '4,3,20']);
});

test('reach is a horizontal radius in cells and one level up or down', () => {
  const r = (change: (s: StageFile) => void) => {
    const c = new CompiledStage(variant((s) => { s.modules = s.modules.filter((m) => m.id !== 'h_wall'); change(s); }));
    return c.handleReach('h1', c.initialState());
  };
  assert.deepEqual(r((s) => (s.handles![0].reach = 2)), ['2,3,20'], 'two cells reach only the cell straight below');
  assert.deepEqual(r((s) => (s.handles![0].reach = 2.5)), ['1,3,20', '2,3,20', '3,3,20']);
  assert.deepEqual(r((s) => (s.handles![0].reach = 5)).length, 7, 'the whole row');
  // a handle 2 levels above sees nothing on the row; 1 level above it does (and the line starts at the eye, 1.5 m up)
  assert.deepEqual(r((s) => (s.handles![0].at = [2, 5, 18])), []);
  assert.ok(r((s) => { s.handles![0].at = [2, 4, 18]; s.handles![0].height = 0.5; }).includes('2,3,20'));
});

test('a handle sees through the modules of the group it controls, and not through the others', () => {
  const under = (change?: (s: StageFile) => void) => {
    const c = new CompiledStage(variant((s) => {
      s.modules = s.modules.filter((m) => m.id !== 'h_wall');
      s.handles![0].at = [8, 2, 20]; // one level below the bridge, in line behind it
      change?.(s);
    }));
    return c.handleReach('h1', { ...c.initialState(), g_hb: 1 });
  };
  const own = under();
  assert.ok(own.includes('6,3,20'));
  // the bridge is not the handle's group: its slab is in the way
  const other = under((s) => (module(s, 'h_bridge').group = undefined));
  assert.ok(!other.includes('6,3,20'));
});

test('the steps of a handle: neighbours in the list, wrapping only for a full turn', () => {
  const a1 = new CompiledStage(variant((s) => {
    const base = area1();
    s.modules = base.modules;
    s.groups = base.groups;
    s.interactables = base.interactables;
    s.handles = [
      { id: 'hb', at: [-6, 3, 1], controls: 'g_b1' },
      { id: 'ht', at: [10, 3, 1], controls: 'g_tower' },
      { id: 'hs', at: [10, 3, 1], controls: 'g_street' },
      { id: 'hc', at: [0, 3, 1], controls: 'g_cube', axis: 'x' },
    ];
  }));
  const dirs = (id: string, s: PuzzleState) => a1.handleActions(id, s).map((o) => (o.action as StepAction).dir);
  const init = a1.initialState();
  assert.deepEqual(dirs('hb', init), [1], 'two states [1, 0]: forward only at the start');
  assert.deepEqual(dirs('hb', { ...init, g_b1: 1 }), [-1], '... and back only at the end');
  assert.deepEqual(dirs('hs', init), [1]);
  for (let i = 0; i < 4; i++) assert.deepEqual(dirs('ht', { ...init, g_tower: i }), [1, -1], `tower ${i}: [0,1,2,3] wraps`);
  assert.equal(a1.apply({ ...init, g_tower: 3 }, step('ht', 'g_tower', 1)).g_tower, 0);
  assert.equal(a1.apply({ ...init, g_tower: 0 }, step('ht', 'g_tower', -1)).g_tower, 3);
  assert.equal(a1.apply(init, step('hb', 'g_b1', 1)).g_b1, 1);
  assert.equal(a1.apply(init, step('hb', 'g_b1', -1)).g_b1, 0, 'no step past the end');
  // an orientation group: one quarter turn either way about the handle's axis, the same as the console's turn
  const roll = (q: 1 | 3) => ({ console: 'c_roll', group: 'g_cube', kind: 'turn', axis: 'x', quarters: q }) as const;
  for (const i of [0, 1, 5, 17]) {
    const s = { ...init, g_cube: i };
    assert.deepEqual(dirs('hc', s), [1, -1]);
    assert.equal(a1.apply(s, step('hc', 'g_cube', 1)).g_cube, a1.apply(s, roll(1)).g_cube);
    assert.equal(a1.apply(s, step('hc', 'g_cube', -1)).g_cube, a1.apply(s, roll(3)).g_cube);
    assert.deepEqual(a1.sweepBlockers(s, step('hc', 'g_cube', 1)), a1.sweepBlockers(s, roll(1)));
    assert.deepEqual(a1.sweepBlockers(s, step('hc', 'g_cube', -1)), a1.sweepBlockers(s, roll(3)));
  }
  assert.deepEqual(a1.motionOf(init, step('hc', 'g_cube', -1)), { axis: 'x', quarters: -1, pivot: a1.groups.get('g_cube')!.pivot });
});

test('the solver stands the player on a cell in reach, never on one the wall hides', () => {
  const r = solveSection(cs, 'p_handle', { withFirstMoves: true });
  assert.equal(r.optimal, 1);
  assert.deepEqual(r.plan, [], 'no console action in it');
  assert.deepEqual(r.moves.map((m) => [m.key, m.at, m.to, m.ride, m.cost]), [['h1:step+1', '2,3,20', '2,3,20', false, 1]]);
  assert.deepEqual(r.firstMoves.map((f) => [f.key, f.penalty]), [['h1:step+1', 0]]);
  // the only cells the player can reach in this region are in reach or hidden: with the row cut to the hidden cells there is no way
  const hidden = variant((s) => ((module(s, 'h_row') as { params: { size: [number, number] } }).params.size = [2, 1]));
  assert.equal(solveSection(new CompiledStage(hidden), 'p_handle').optimal, null);
  assert.ok(rules(hidden).includes('error H1'));
  assert.ok(rules(hidden).includes('error L1'));
  // the old entry points: nextAction speaks of console actions only, nextMove of any
  assert.equal(nextAction(cs, 'p_handle', s0, '0,3,20'), null);
  assert.equal(nextMove(cs, 'p_handle', s0, '0,3,20')!.key, 'h1:step+1');
  assert.equal(remainingActions(cs, 'p_handle', s0, '0,3,20'), 1);
  assert.equal(remainingActions(cs, 'p_handle', { ...s0, g_hb: 1 }, '0,3,20'), 0);
});

// --- riding -----------------------------------------------------------------------------------------------------------------

const ferry = step('h_ferry', 'g_ferry', 1);

test('a y-axis turn carries the player who stands on the bridge, and leaves the one who does not', () => {
  const t = (cell: string) => cs.motionOutcome(s0, ferry, cell);
  // on the end tile: it swings from the south end to the east end
  assert.deepEqual(t('8,3,31'), { ok: true, cell: '9,3,30', ride: true });
  // on the middle tile, which turns about its own centre: still a ride
  assert.deepEqual(t('8,3,30'), { ok: true, cell: '8,3,30', ride: true });
  // on the platform: they stay where they are
  assert.deepEqual(t('8,3,32'), { ok: true, cell: '8,3,32', ride: false });
  // the north end too
  assert.deepEqual(t('8,3,29'), { ok: true, cell: '7,3,30', ride: true });
  // not on any tile
  assert.equal(t('99,3,99').ok, false);
  const turned = cs.apply(s0, ferry);
  const wm = cs.walkMap(turned);
  // carried, they are in the region that holds the exit's platform; left behind, they are cut off
  assert.equal(wm.region.get('9,3,30'), wm.region.get('12,3,30'));
  assert.notEqual(wm.region.get('8,3,32'), wm.region.get('12,3,30'));
});

test('the plan rides the bridge: standing on the platform strands the player', () => {
  const r = solveSection(cs, 'p_ride', { withFirstMoves: true });
  assert.equal(r.optimal, 2);
  assert.deepEqual(r.moves.map((m) => [m.key, m.ride]), [['h_ferry:step+1', true], ['h_street:step+1', false]]);
  assert.equal(r.rides, 1);
  // the cell it stands on is on the bridge, and the street's is on the plaza (the cell it lands on, for a ride)
  assert.ok(['8,3,29', '8,3,30', '8,3,31'].includes(r.moves[0].at));
  assert.ok(['11,3,30', '12,3,30'].includes(r.moves[1].at));
  // standing still is also possible at the start, it just leads nowhere good: it costs the same action, plus the way back
  const stay = reachableNodes(cs, 'p_ride').filter((n) => cs.stateKey(n.state) === cs.stateKey({ ...s0, g_ferry: 1 }));
  assert.equal(stay.length, 2, 'two regions after the ferry turns: the one carried and the one left behind');
  assert.equal(r.deadEnds, 0);
  assert.deepEqual(r.firstMoves.map((f) => [f.key, f.penalty]), [['h_ferry:step+1', 0]]);
});

test('a horizontal-axis turn that would tip the rider is blocked for them, and allowed from a cell off the group', () => {
  const flat = { ...s0, g_ferry: 1, g_street: 1 };
  const raise = step('h_street', 'g_street', -1);
  assert.deepEqual(cs.sweepBlockers(flat, raise), [], 'the street itself swings clear');
  assert.deepEqual(cs.motionOutcome(flat, raise, '11,3,29'), { ok: false, blockedBy: ['player'] });
  assert.deepEqual(cs.motionOutcome(flat, raise, '11,3,27'), { ok: false, blockedBy: ['player'] });
  assert.deepEqual(cs.motionOutcome(flat, raise, '11,3,30'), { ok: true, cell: '11,3,30', ride: false });
  assert.deepEqual(cs.motionOutcome(flat, raise, '12,3,30'), { ok: true, cell: '12,3,30', ride: false });
  // the handle offers it from the plaza and from the street itself; the solver only ever uses the cells that work
  assert.ok(cs.handleReach('h_street', flat).includes('11,3,29'));
  const out = cs.motionOutcomes(flat, raise, cs.handleReach('h_street', flat));
  assert.deepEqual([...out].filter(([, o]) => o.ok).map(([c]) => c), ['11,3,30', '12,3,30']);
});

test('the rider is swept against the statics: a low ceiling over the swing blocks the rider, not the platform', () => {
  const s = fixture();
  // a cube whose underside is at the walkway level hangs over the swing: the bridge slab (below it) is not touched
  s.modules.push({ id: 'roof', type: 'cube3', at: [9, 3, 29], params: { faces: {} as never } });
  const roof = new CompiledStage(s);
  assert.deepEqual(roof.sweepBlockers(roof.initialState(), ferry), []);
  assert.deepEqual(roof.motionOutcome(roof.initialState(), ferry, '8,3,31'), { ok: false, blockedBy: ['player'] });
  assert.deepEqual(roof.motionOutcome(roof.initialState(), ferry, '8,3,32'), { ok: true, cell: '8,3,32', ride: false });
});

test('turning the same turn back returns the rider to the cell they came from', () => {
  const back = cs.motionOutcome({ ...s0, g_ferry: 1 }, step('h_ferry', 'g_ferry', -1), '9,3,30');
  assert.deepEqual(back, { ok: true, cell: '8,3,31', ride: true });
});

test('a player standing on a plate is not left standing on nothing when the plate goes', () => {
  // area 1: the plate between the road and the cube exists only while the cube shows a west arm
  const stage = area1();
  stage.handles = [{ id: 'hc', at: [0, 3, 1], controls: 'g_cube', axis: 'x' }];
  const a1 = new CompiledStage(stage);
  const rolled = a1.apply(a1.initialState(), { console: 'c_roll', group: 'g_cube', kind: 'turn', axis: 'x', quarters: 1 });
  assert.equal(a1.walkMap(rolled).tiles.get('1,3,0')?.plate, true);
  let gone = 0;
  for (const { action } of a1.handleActions('hc', rolled)) {
    const stays = a1.walkMap(a1.apply(rolled, action)).tiles.get('1,3,0')?.plate === true;
    const o = a1.motionOutcome(rolled, action, '1,3,0');
    if (!stays) {
      gone++;
      assert.equal(o.ok, false);
      assert.ok(!o.ok && o.blockedBy.includes('player'));
    } else assert.equal(o.ok, a1.sweepBlockers(rolled, action).length === 0);
  }
  assert.ok(gone >= 1, 'a quarter turn either way takes the west arm away');
});

// --- clockwork --------------------------------------------------------------------------------------------------------------

test('a wait advances every auto group of the section one step, and wraps', () => {
  const wait = { kind: 'wait', section: 'p_clock' } as const;
  assert.equal(cs.apply(s0, wait).g_clock, 1);
  assert.equal(cs.apply(cs.apply(s0, wait), wait).g_clock, 0, 'wraps from the last state to the first');
  assert.equal(cs.apply(s0, wait).g_hb, 0, 'groups that are not on a clock stay');
  assert.deepEqual(cs.autoGroups('p_clock').map((g) => g.id), ['g_clock']);
  assert.deepEqual(cs.autoGroups('p_handle'), []);
  assert.deepEqual(cs.autoGroups().map((g) => g.id), ['g_clock'], 'no section: every auto group of the stage');
  assert.deepEqual(cs.apply(s0, { kind: 'wait', section: 'p_handle' }), s0, 'a section without a clock has nothing to advance');
  assert.equal(actionKey(wait), 'wait');
});

test('an auto group connects the exit in one phase only: no action, one wait', () => {
  const closed = cs.walkMap(s0);
  assert.notEqual(closed.region.get('0,3,40'), closed.region.get('9,3,40'));
  const open = cs.walkMap({ ...s0, g_clock: 1 });
  assert.equal(open.region.get('0,3,40'), open.region.get('9,3,40'));
  const r = solveSection(cs, 'p_clock', { withFirstMoves: true });
  assert.equal(r.optimal, 0);
  assert.deepEqual(r.moves.map((m) => [m.key, m.at, m.cost]), [['wait', '0,3,40', 0]]);
  assert.equal(r.waits, 1);
  assert.deepEqual(r.plan, []);
  assert.deepEqual(r.firstMoves.map((f) => [f.key, f.penalty]), [['wait', 0]]);
  assert.equal(r.deadEnds, 0);
  assert.equal(remainingActions(cs, 'p_clock', s0, '0,3,40'), 0);
});

test('waiting carries a rider and leaves the others, as a handle does', () => {
  const w = (s: PuzzleState, cell: string) => cs.waitOutcome(s, cell, 'p_clock');
  assert.deepEqual(w(s0, '0,3,40'), { ok: true, cell: '0,3,40', ride: false });
  const open = { ...s0, g_clock: 1 };
  assert.deepEqual(w(open, '4,3,40'), { ok: true, cell: '5,3,41', ride: true });
  assert.deepEqual(w(open, '5,3,40'), { ok: true, cell: '5,3,40', ride: true });
  assert.deepEqual(w(open, '9,3,40'), { ok: true, cell: '9,3,40', ride: false });
  assert.equal(cs.sweepBlockers(open, { kind: 'wait', section: 'p_clock' }).length, 0);
  // the same through motionOutcome
  assert.deepEqual(cs.motionOutcome(open, { kind: 'wait', section: 'p_clock' }, '4,3,40'), w(open, '4,3,40'));
});

test('waits cost nothing: `optimal` counts the player actions, and a longer wait chain does not change it', () => {
  // one group on a clock with four states that opens the exit only in the last one: three waits, still zero actions
  const long = variant((s) => {
    const g = group(s, 'g_clock');
    if (g.kind !== 'states') throw new Error('states group');
    g.states = [1, 1, 1, 0]; // N-S for three ticks, then E-W: three waits to open
  });
  const r = solveSection(new CompiledStage(long), 'p_clock');
  assert.equal(r.optimal, 0);
  assert.equal(r.waits, 3);
});

// --- the validator ----------------------------------------------------------------------------------------------------------

test('T1: a tether that never links is a warning', () => {
  const lonely = variant((s) => s.modules.push({ id: 'x', type: 'tether', at: [1, 3, 0], params: { facing: 'N' } }));
  assert.deepEqual(rules(lonely), ['warning T1']);
  const r = validateStage(lonely);
  assert.ok(r.issues.some((i) => i.rule === 'T1' && i.message.includes('x')));
  assert.equal(r.ok, true);
  // the tether on the group is fine: it links in a reachable state (after the fold)
  assert.equal(validateStage(fixture()).issues.some((i) => i.rule === 'T1'), false);
  // but not when the fold is not offered
  const noFold = variant((s) => {
    const sec = section(s, 'p_tether_fold');
    sec.consoles = [];
    sec.intent.mustUse = [];
  });
  assert.ok(validateStage(noFold).issues.some((i) => i.rule === 'T1' && i.message.includes('f_rb')));
});

test('T2: a tether whose landing cell is not walkable at the start is an error', () => {
  const floating = variant((s) => s.modules.push({ id: 'x', type: 'tether', at: [4, 3, 0], params: { facing: 'N' } }));
  const r = validateStage(floating);
  assert.ok(r.issues.some((i) => i.rule === 'T2' && i.level === 'error' && i.message.includes('4,3,0')));
  assert.equal(r.ok, false);
  assert.ok(rules(floating).includes('warning T1'), 'and it never links either');
  const odd = variant((s) => ((module(s, 't_ra') as { params: { span?: number } }).params.span = 1));
  assert.ok(validateStage(odd).issues.some((i) => i.rule === 'S3'));
});

test('H1: a handle with no cell in reach in any reachable state is an error', () => {
  const far = variant((s) => (s.handles![0].at = [30, 3, 20]));
  const r = validateStage(far);
  assert.ok(r.issues.some((i) => i.rule === 'H1' && i.level === 'error' && i.message.includes('h1')));
  assert.equal(r.ok, false);
  // hidden from every cell it could be reached from is the same
  const blind = variant((s) => { s.handles![0].reach = 1; });
  assert.ok(validateStage(blind).issues.some((i) => i.rule === 'H1'));
  // and a handle that is reachable is not reported
  assert.equal(validateStage(fixture()).issues.some((i) => i.rule === 'H1'), false);
});

test('H2: mustUse names handles, and a handle that can be done without is caught', () => {
  assert.equal(validateStage(fixture()).ok, true);
  const unknown = variant((s) => (section(s, 'p_handle').intent.mustUse = ['nope']));
  assert.ok(validateStage(unknown).issues.some((i) => i.rule === 'S2' && i.message.includes('mustUse nope')));
  // a handle of another section is not one of this section's
  const other = variant((s) => (section(s, 'p_handle').intent.mustUse = ['h_ferry']));
  assert.ok(validateStage(other).issues.some((i) => i.rule === 'S2' && i.message.includes('mustUse h_ferry')));
  // a second handle for the same group: the first is no longer a must (L4), and the unused one is noted (L5)
  const twin = variant((s) => {
    s.handles!.push({ id: 'h1b', at: [3, 3, 18], controls: 'g_hb', reach: 3 });
    section(s, 'p_handle').handles = ['h1', 'h1b'];
    s.modules = s.modules.filter((m) => m.id !== 'h_wall');
  });
  const r = validateStage(twin);
  assert.ok(r.issues.some((i) => i.rule === 'L4' && i.level === 'error' && i.message.includes('h1')));
  assert.ok(r.issues.some((i) => i.rule === 'L5' && i.level === 'warning' && i.message.includes('h1b')));
  // a handle and a console may not share an id
  const clash = variant((s) => (s.handles![0].id = 'c_ring'));
  assert.ok(validateStage(clash).issues.some((i) => i.rule === 'S2'));
  const noAxis = new Set(
    validateStage(variant((s) => { s.groups.push({ id: 'g_o', kind: 'orientation', pivot: [0, 0, 0], initial: 0 }); s.handles![0].controls = 'g_o'; }))
      .issues.map((i) => i.rule),
  );
  assert.ok(noAxis.has('S2'), 'a handle of an orientation group needs an axis');
});

test('C4: auto groups of one section must share one period', () => {
  const clash = variant((s) => {
    s.groups.push({ id: 'g_second', kind: 'states', pivot: [0, 0, 0], axis: 'y', states: [0, 1], initial: 0, auto: { periodMs: 5000, dwellMs: 1800 } });
    section(s, 'p_clock').groups.push('g_second');
  });
  const r = validateStage(clash);
  assert.ok(r.issues.some((i) => i.rule === 'C4' && i.level === 'error' && i.message.includes('p_clock')));
  // the same period is fine
  const same = variant((s) => {
    s.groups.push({ id: 'g_second', kind: 'states', pivot: [0, 0, 0], axis: 'y', states: [0, 1], initial: 0, auto: { periodMs: 4000, dwellMs: 1800 } });
    section(s, 'p_clock').groups.push('g_second');
  });
  assert.equal(validateStage(same).issues.some((i) => i.rule === 'C4'), false);
});

test('C5: a dwell under 900 ms is a warning', () => {
  const quick = variant((s) => { const g = group(s, 'g_clock'); if (g.kind === 'states') g.auto = { periodMs: 4000, dwellMs: 899 }; });
  const r = validateStage(quick);
  assert.ok(r.issues.some((i) => i.rule === 'C5' && i.level === 'warning'));
  assert.equal(r.ok, true);
  const fine = variant((s) => { const g = group(s, 'g_clock'); if (g.kind === 'states') g.auto = { periodMs: 4000, dwellMs: 900 }; });
  assert.equal(validateStage(fine).issues.some((i) => i.rule === 'C5'), false);
});

test('C2: an auto step blocked by another module is a jam', () => {
  // without the inset, the bridge's corners swing 6.3 m from the middle and hit the platforms on both sides
  const jam = variant((s) => ((module(s, 'c_bridge') as { params: { inset?: number } }).params.inset = 0));
  const r = validateStage(jam);
  const c2 = r.issues.filter((i) => i.rule === 'C2');
  assert.ok(c2.length > 0 && c2.every((i) => i.level === 'error'));
  assert.ok(c2.some((i) => i.message.includes('c_a') || i.message.includes('c_b')));
  assert.equal(r.ok, false);
  assert.equal(validateStage(fixture()).issues.some((i) => i.rule === 'C2'), false);
});

/** A platform beside a cube that spins on a clock: the cube's underside is level with the floor, so only the body is hit. */
function spinner(): StageFile {
  const s = fixture();
  s.modules = [
    { id: 'p', type: 'tile', at: [0, 2, 0], params: { size: [4, 1] } },
    { id: 'k', type: 'cube3', at: [4, 2, -1], group: 'g_k', params: { faces: {} as never } },
  ];
  s.groups = [{ id: 'g_k', kind: 'states', pivot: [22, 14, 2], axis: 'y', states: [0, 1], initial: 0, auto: { periodMs: 4000, dwellMs: 2000 } }];
  s.interactables = [];
  s.handles = [];
  s.checkpoints = [{ id: 'cp', at: [0, 2, 0], facing: 'E' }];
  s.goal = { at: [3, 2, 0] };
  s.sections = [{
    id: 'spin', name: { ja: '回る箱', en: 'Spinner' }, groups: ['g_k'], consoles: [], start: 'cp', exit: [[3, 2, 0]],
    intent: { teaches: [], optimalActions: { min: 0, max: 0 }, mustUse: [], maxDeadEndStates: 0 },
  }];
  return s;
}

test('C1: an auto step that sweeps through the player at a cell off the group is an error', () => {
  const r = validateStage(spinner());
  const c1 = r.issues.filter((i) => i.rule === 'C1');
  assert.deepEqual(c1.map((i) => i.level), ['error']);
  assert.ok(c1[0].message.includes('3,2,0'), 'the cell next to the cube; the cell two away is out of reach');
  assert.deepEqual([...new Set(r.issues.map((i) => i.rule))].sort(), ['C1']);
  assert.equal(r.ok, false);
  // the sweep itself touches no module: it is the body that is in the way
  const sp = new CompiledStage(spinner());
  const wait = { kind: 'wait', section: 'spin' } as const;
  assert.deepEqual(sp.sweepBlockers(sp.initialState(), wait), []);
  assert.deepEqual(sp.waitOutcome(sp.initialState(), '3,2,0', 'spin'), { ok: false, blockedBy: ['player'] });
  assert.deepEqual(sp.waitOutcome(sp.initialState(), '2,2,0', 'spin'), { ok: true, cell: '2,2,0', ride: false });
  // moved one cell back it is clear
  const back = spinner();
  (module(back, 'p') as { params: { size: [number, number] } }).params.size = [3, 1];
  back.sections[0].exit = [[2, 2, 0]];
  back.goal = { at: [2, 2, 0] };
  assert.equal(validateStage(back).issues.some((i) => i.rule === 'C1'), false);
});

test('C3: an auto step that would tip a rider off is a warning', () => {
  const tip = variant((s) => {
    const g = group(s, 'g_street');
    if (g.kind === 'states') g.auto = { periodMs: 4000, dwellMs: 2000 };
    const sec = section(s, 'p_ride');
    sec.handles = ['h_ferry'];
    sec.intent = { teaches: [], optimalActions: { min: 0, max: 2 }, mustUse: [], maxDeadEndStates: 0 };
  });
  const r = validateStage(tip);
  const c3 = r.issues.filter((i) => i.rule === 'C3');
  assert.ok(c3.length > 0 && c3.every((i) => i.level === 'warning'));
  assert.ok(c3.some((i) => i.message.includes('g_street')));
  assert.equal(r.issues.some((i) => i.rule === 'C1' || i.rule === 'C2'), false);
  assert.equal(r.ok, true);
});

test('the reachable nodes are the solver\'s states, with the regions they can stand in', () => {
  const nodes = reachableNodes(cs, 'p_clock');
  assert.equal(nodes.length, 4);
  assert.deepEqual([...new Set(nodes.map((n) => n.state.g_clock))].sort(), [0, 1]);
  assert.ok(nodes.every((n) => typeof n.region === 'number'));
});

test('a tether needs a facing the kit knows', () => {
  const bad = variant((s) => ((module(s, 't_ra') as { params: { facing: string } }).params.facing = 'U'));
  assert.ok(validateStage(bad).issues.some((i) => i.rule === 'S3'));
});

// a type-level check that the old and new actions mix
const _mixed: PlayerAction[] = [
  { console: 'c', group: 'g', kind: 'set', to: 1 },
  { handle: 'h', group: 'g', kind: 'step', dir: -1 },
  { kind: 'wait' },
];
void _mixed;
