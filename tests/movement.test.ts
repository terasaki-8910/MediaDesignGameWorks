// What the player may do from where they stand on the prototype stage (src/stages/proto.json): which thread a Space swings
// along and which it chains into, which handle Q and E turn, and where the player may walk while a group is on the move.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import * as THREE from 'three';
import { CompiledStage } from '../src/core/compile.ts';
import type { PuzzleState, StageFile, StepAction } from '../src/core/types.ts';
import { solveSection } from '../src/core/solver.ts';
import { validateFiles } from '../tools/validate.ts';
import type { Input } from '../src/game/input.ts';
import {
  cellsApart, chainSteps, handleKeyDir, handlesInReach, landingPoint, linkSteps, pickLinkStep, railsWhileMoving, targetHandle, walkWhileMoving,
} from '../src/game/movement.ts';
import { Player } from '../src/game/player.ts';

const stage = JSON.parse(readFileSync('src/stages/proto.json', 'utf8')) as StageFile;
const cs = new CompiledStage(stage);
const s0 = cs.initialState();
const step = (handle: string, group: string, dir: 1 | -1): StepAction => ({ handle, group, kind: 'step', dir });
const faced = (state: PuzzleState, ring: number): PuzzleState => ({ ...state, g_ring: ring });

test('the prototype stage validates: two sections of 2 optimal actions each, no dead ends, each with an exit', () => {
  const r = validateFiles(['src/stages/proto.json']);
  assert.equal(r.ok, true);
  const report = r.reports[0];
  assert.deepEqual(report.issues, []);
  assert.deepEqual(Object.keys(report.sections), ['p_threads', 'p_ferry']);
  for (const sec of stage.sections) {
    const m = report.sections[sec.id];
    assert.ok(m.optimal !== null && m.optimal >= 2 && m.optimal <= 4, `${sec.id}: ${m.optimal} optimal actions`);
    assert.equal(m.deadEnds, 0, `${sec.id}: no dead ends`);
    assert.ok(sec.exit.length > 0, `${sec.id}: has an exit`);
    assert.ok(sec.intro?.ja && sec.intro.ja.length > 10, `${sec.id}: a caption`);
  }
  assert.ok(report.sections.p_ferry.rides >= 1, 'the ferry section has a ride');
  assert.ok(report.sections.p_threads.links >= 4, 'the first section crosses at least four threads');
});

test('a thread seen from either landing cell goes to the other, and the first swing of the stage needs no action', () => {
  const wm = cs.walkMap(s0);
  const west = linkSteps(wm, '-16,3,6');
  assert.equal(west.length, 1);
  assert.deepEqual([west[0].from, west[0].to, west[0].fromTether, west[0].toTether], ['-16,3,6', '-12,3,6', 's_t1', 's_t2']);
  const east = linkSteps(wm, '-12,3,6');
  assert.deepEqual([east[0].from, east[0].to, east[0].fromTether, east[0].toTether], ['-12,3,6', '-16,3,6', 's_t2', 's_t1']);
  assert.equal(cellsApart(west[0].from, west[0].to), 4);
  assert.deepEqual(linkSteps(wm, '-10,3,6'), [], 'no thread at a cell with no ring');
  assert.deepEqual(linkSteps(wm, '-9,3,6'), [], 'the ring on its post faces north: nothing to swing to yet');
});

test('turning the ring to face the gap makes a thread from the post, in either direction', () => {
  const wm = cs.walkMap(faced(s0, 3));
  const [out] = linkSteps(wm, '-9,3,6');
  assert.deepEqual([out.to, out.fromTether, out.toTether], ['-3,3,6', 's_ring', 's_t3']);
  const [back] = linkSteps(wm, '-3,3,6');
  assert.deepEqual([back.to, back.fromTether], ['-9,3,6', 's_t3']);
  assert.equal(cellsApart('-9,3,6', '-3,3,6'), 6);
});

test('a swing chains into the other thread at its landing, and never back along the one it came by', () => {
  const wm = cs.walkMap(s0);
  // the stepping stone has two rings: one to the stone before, one to the platform after
  assert.deepEqual(linkSteps(wm, '1,3,6').map((s) => s.to), ['-2,3,6', '4,3,6']);
  assert.deepEqual(chainSteps(wm, '1,3,6', '-2,3,6').map((s) => s.to), ['4,3,6'], 'from the west the chain goes on east');
  assert.deepEqual(chainSteps(wm, '1,3,6', '4,3,6').map((s) => s.to), ['-2,3,6'], 'from the east it goes on west');
  assert.deepEqual(chainSteps(wm, '4,3,6', '1,3,6'), [], 'the end of the line: it lands');
  assert.deepEqual(chainSteps(wm, '-2,3,6', '1,3,6'), [], 'one thread only, the one it came by: it lands');
});

test('where two threads leave a cell, the one the camera looks along is taken', () => {
  const steps = linkSteps(cs.walkMap(s0), '1,3,6'); // to -2 (west) and 4 (east)
  assert.equal(pickLinkStep(steps, { x: 1, z: 0 })!.to, '4,3,6', 'looking east');
  assert.equal(pickLinkStep(steps, { x: -1, z: 0.2 })!.to, '-2,3,6', 'looking west');
  assert.equal(pickLinkStep(steps, { x: 0.3, z: -1 })!.to, '4,3,6', 'looking mostly north, a little east');
  assert.equal(pickLinkStep(steps, { x: 0, z: -1 })!.to, '-2,3,6', 'looking straight across: the first, always the same');
  assert.equal(pickLinkStep([], { x: 1, z: 0 }), null);
});

test('the landing point is the middle of the cell, at the floor of its tile', () => {
  assert.deepEqual(landingPoint(cs.walkMap(s0), '-12,3,6'), [-46, 12, 26]);
});

test('a handle can be used from the cells in its reach only', () => {
  const ids = ['h_ring', 'h_bridge'];
  const at = (cell: string) => handlesInReach(cs, ids, s0, cell).map((h) => h.id);
  assert.deepEqual(at('-10,3,6'), ['h_ring']);
  assert.deepEqual(at('-9,3,6'), ['h_ring']);
  assert.deepEqual(at('-16,3,6'), [], 'out of reach on the first platform');
  assert.deepEqual(at('-3,3,6'), [], 'and across the gap');
  assert.deepEqual(at('4,3,6'), ['h_bridge']);
  assert.deepEqual(at('1,3,6'), ['h_bridge'], 'the bridge can be turned from the stepping stone');
  const [h] = handlesInReach(cs, ids, s0, '-10,3,6');
  assert.deepEqual(h.point, [-38, 14, 22], 'the point is 2 m above the floor of its cell');
});

test('of the handles in reach, the one nearest the camera\'s forward direction is the target', () => {
  const cam = { pos: [0, 5, 0] as const, forward: [1, 0, 0] as const };
  const a = { id: 'h_a', point: [10, 5, 4] as const }; // east, a little to the south
  const b = { id: 'h_b', point: [10, 5, -9] as const }; // east, well to the north
  assert.equal(targetHandle([a, b], cam), 'h_a');
  assert.equal(targetHandle([a, b], { ...cam, forward: [1, 0, -1] }), 'h_b', 'turning the camera to the north picks the other');
  assert.equal(targetHandle([a, b], { ...cam, forward: [-1, 0, 0] }), 'h_b', 'looking away from both: the one that is least behind');
  assert.equal(targetHandle([{ id: 'h_z', point: [10, 5, 0] }, { id: 'h_y', point: [10, 5, 0] }], cam), 'h_y', 'a tie goes to the first id');
  assert.equal(targetHandle([], cam), null);
  // the same on the stage: from the stepping stone one handle is in reach, and it is the target whichever way the camera looks
  const here = handlesInReach(cs, ['h_ring', 'h_bridge'], s0, '1,3,6');
  assert.equal(targetHandle(here, { pos: [6, 17, 26], forward: [-1, 0, 0] }), 'h_bridge');
});

test('walking while a group turns: its own tiles are gone, the edges to them closed, and the rest stays as it was', () => {
  const action = step('h_ferry', 'g_ferry', 1);
  const before = cs.walkMap(s0);
  const region = [...before.tiles.keys()].filter((k) => before.region.get(k) === before.region.get('11,3,7'));
  const wm = walkWhileMoving(cs, s0, action, region);
  for (const k of ['11,3,5', '11,3,4', '11,3,3']) assert.equal(wm.tiles.has(k), false, `${k}, a tile of the ferry, is not walkable`);
  assert.equal(before.tiles.get('11,3,6')!.open.N, true, 'the bank was open to the ferry');
  assert.equal(wm.tiles.get('11,3,6')!.open.N, false, 'and is closed to it while it turns');
  for (const side of ['E', 'W', 'S'] as const) assert.equal(wm.tiles.get('11,3,6')!.open[side], before.tiles.get('11,3,6')!.open[side], `${side} is as it was`);
  assert.ok(wm.tiles.has('11,3,7') && wm.tiles.has('12,3,6'), 'the rest of the bank is walkable');
  for (const k of wm.tiles.keys()) assert.ok(before.tiles.has(k) && cs.walkMap(cs.apply(s0, action)).tiles.has(k), `${k} is a tile before and after`);
});

test('walking while a group turns: a tile the turn would take away from a player standing there is not walkable either', () => {
  const flat = { ...s0, g_street: 1 }; // the street lies level over the canal
  const down = step('h_street', 'g_street', -1); // standing it up again takes the street away from whoever is on it
  const wm = walkWhileMoving(cs, flat, down);
  assert.equal(wm.tiles.has('14,3,2'), false, 'the street');
  assert.ok(wm.tiles.has('14,3,4') && wm.tiles.has('14,3,0'), 'the banks stay');
  assert.equal(wm.tiles.get('14,3,4')!.open.N, false, 'the way onto the street is closed');
});

test('walking while a group turns: a thread stays only if both maps have it and its tethers are off the group', () => {
  // the ring is on its post, a group of its own: while it turns the thread to the far ring is not there to swing along
  const faceEast = faced(s0, 3);
  const wm = walkWhileMoving(cs, faceEast, step('h_ring', 'g_ring', 1));
  assert.equal(cs.walkMap(faceEast).links.some((l) => l.a === 's_ring' || l.b === 's_ring'), true, 'the thread is there at rest');
  assert.equal(wm.links.some((l) => l.a === 's_ring' || l.b === 's_ring'), false, 'and gone while the ring turns');
  assert.ok(wm.links.some((l) => l.a === 's_t1'), 'the others are as they were');
});

test('a closed edge stops the walker: a player on the bank cannot walk onto the turning ferry, and can once it is still', () => {
  const action = step('h_ferry', 'g_ferry', 1);
  const wm = walkWhileMoving(cs, s0, action);
  const rest = cs.walkMap(s0);
  const noInput = { down: (k: string) => k === 'KeyW', hit: () => false } as unknown as Input; // W, with the camera facing north (yaw 0)
  const walk = (map: typeof rest) => {
    const p = new Player({ object: new THREE.Group(), animate: () => {} });
    p.place([11, 3, 6], 'N', map);
    for (let i = 0; i < 180; i++) p.update(1 / 60, noInput, 0, map, { locked: false, walkSpeed: 5, dash: 1.6 });
    return p;
  };
  const stopped = walk(wm);
  assert.equal(stopped.cell, '11,3,6', 'held back at the closed edge');
  assert.ok(stopped.pos.z > 24, `still in its own cell (z ${stopped.pos.z.toFixed(2)})`);
  const through = walk(rest);
  assert.notEqual(through.cell, '11,3,6', 'with the ferry at rest the same walk goes onto it');
});

test('the optimal plan of each prototype section is the one the sketch says', () => {
  const plan = (id: string) => solveSection(cs, id).moves.map((m) => `${m.key}@${m.at}${m.ride ? ' ride' : ''}`);
  assert.deepEqual(plan('p_ferry').map((x) => x.split('@')[0]), ['h_ferry:step+1', 'h_street:step+1']);
  assert.ok(plan('p_ferry')[0].endsWith('ride'), 'the first step is made standing on the ferry');
  assert.equal(solveSection(cs, 'p_threads').moves.length, 2);
});

test('the parapets while a group turns: every platform of the stage keeps its walls, in any region, and the closed edges toward the group get theirs', () => {
  const before = cs.walkMap(s0);
  const rails = railsWhileMoving(cs, s0, step('h_ferry', 'g_ferry', 1));
  // the player's walk is the safe part of the player's region; the parapets belong to everything that stays
  for (const k of ['-17,3,6', '-3,3,6', '9,3,6', '14,3,0', '13,3,4']) assert.ok(rails.tiles.has(k), `${k} still has its walls: it is in the map the world lays them on`);
  for (const k of ['11,3,5', '11,3,4', '11,3,3']) assert.equal(rails.tiles.has(k), false, `${k} is a tile of the group that turns`);
  assert.equal(before.tiles.get('11,3,6')!.open.N, true);
  assert.equal(rails.tiles.get('11,3,6')!.open.N, false, 'the edge toward the turning ferry is closed, so it gets a parapet for the turn');
  assert.equal(rails.tiles.size, before.tiles.size - 3, 'nothing else is left out');
  // a turn that takes no tile (the ring on its post) leaves the whole map as it was, threads of other rings included
  const ring = railsWhileMoving(cs, faced(s0, 3), step('h_ring', 'g_ring', 1));
  assert.equal(ring.tiles.size, cs.walkMap(faced(s0, 3)).tiles.size);
  assert.equal(ring.links.some((l) => l.a === 's_ring' || l.b === 's_ring'), false, 'but the thread of the ring that turns is gone');
  assert.ok(ring.links.some((l) => l.a === 's_t1'), 'and the others stay');
});

test('the whole stage is walkable around a turn that takes no tile: the walk map holds the tiles across a gap too', () => {
  const wm = walkWhileMoving(cs, s0, step('h_ring', 'g_ring', 1));
  assert.ok(wm.tiles.has('-3,3,6') && wm.tiles.has('9,3,6'), 'tiles across the gap are in the map');
  assert.equal(wm.tiles.size, cs.walkMap(s0).tiles.size);
});

test('Q is a step back and E a step on, but at a console E belongs to Fold Mode', () => {
  assert.equal(handleKeyDir({ q: true, e: false }, false), -1);
  assert.equal(handleKeyDir({ q: false, e: true }, false), 1);
  assert.equal(handleKeyDir({ q: false, e: true }, true), null, 'the console wins');
  assert.equal(handleKeyDir({ q: true, e: false }, true), -1, 'Q is no console key');
  assert.equal(handleKeyDir({ q: false, e: false }, false), null);
  assert.equal(handleKeyDir({ q: true, e: true }, false), -1, 'both in one frame: Q');
});
