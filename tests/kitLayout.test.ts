import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import * as THREE from 'three';
import { CompiledStage } from '../src/core/compile.ts';
import { cellFloor } from '../src/core/math.ts';
import type { StageFile } from '../src/core/types.ts';
import { edgeKey, PIER_DEPTH, planSlabs } from '../src/game/kitLayout.ts';

const cs = new CompiledStage(JSON.parse(readFileSync('src/stages/area1.json', 'utf8')) as StageFile);
const plan = planSlabs(cs);
const count = (list: { piece: string }[], piece: string) => list.filter((p) => p.piece === piece).length;
const position = (m: THREE.Matrix4) => new THREE.Vector3().setFromMatrixPosition(m);

test('every cell of a tile or bridge module gets one paved top and one underside', () => {
  const fixed = cs.modules.filter((m) => (m.type === 'tile' || m.type === 'bridge') && !m.group && !m.yaw);
  const cells = fixed.reduce((n, m) => n + cs.kits.get(m.id)!.tiles.length, 0);
  assert.equal(count(plan.world, 'slab_top'), cells);
  assert.equal(count(plan.world, 'slab_bottom'), cells);
  for (const m of cs.modules.filter((x) => (x.type === 'tile' || x.type === 'bridge') && (x.group || x.yaw))) {
    const own = plan.modules.get(m.id)!;
    assert.equal(count(own, 'slab_top'), cs.kits.get(m.id)!.tiles.length, m.id);
  }
});

test('edges another slab can stand against are plain, open edges are moulded', () => {
  // the turning bridges: plain ends (the roads meet them), moulded sides, no cornice turning round its corners
  for (const id of ['m_bridge0', 'm_bridge1']) {
    const bridge = plan.modules.get(id)!;
    assert.equal(count(bridge, 'edge_flush'), 2, id);
    assert.equal(count(bridge, 'edge_cornice'), 6, id);
    assert.equal(count(bridge, 'corner_outer'), 0, id);
  }
  // the fixed edges that face a bridge in one of its states are plain too, and get a wall instead of a balustrade: the plaza's
  // east side (the near bridge's west end), the far bridge's north and south ends (the deck and the balcony), and the next road
  const flush = (cell: [number, number, number], side: 'N' | 'E' | 'S' | 'W') => {
    const f = cellFloor(cell);
    return plan.flushEdges.has(edgeKey(f[0], f[1], f[2], side));
  };
  assert.ok(flush([-9, 3, 0], 'E'));
  assert.ok(flush([-4, 3, -2], 'S'));
  assert.ok(flush([-4, 3, 2], 'N'));
  assert.ok(flush([-2, 3, 0], 'W'));
  assert.ok(!flush([-4, 3, -2], 'E'), 'an open edge of the deck stays moulded');
  // the start plaza is open all round: four outer corners, and two inner corners where the road leaves it
  const plaza = new THREE.Box3(new THREE.Vector3(-44.5, 0, -4.5), new THREE.Vector3(-31.5, 99, 8.5));
  const corners = plan.world.filter((p) => p.piece === 'corner_inner' && plaza.containsPoint(position(p.matrix)));
  assert.equal(corners.length, 2);
});

test('piers stand under fixed walkways and clear every box in every combination of states', () => {
  const piers = plan.world.filter((p) => p.piece === 'pier_a' || p.piece === 'pier_b');
  assert.ok(piers.length >= 5, `only ${piers.length} piers`);
  assert.ok(piers.some((p) => p.piece === 'pier_b'), 'a plaza has a thick pier');
  let states: Record<string, number>[] = [{}];
  for (const g of cs.stage.groups) {
    const n = g.kind === 'states' ? g.states.length : 24;
    states = states.flatMap((s) => Array.from({ length: n }, (_, i) => ({ ...s, [g.id]: i })));
  }
  for (const p of piers) {
    const c = position(p.matrix);
    const half = p.piece === 'pier_b' ? 3.4 : 1.7;
    for (const s of states)
      for (const b of cs.worldBoxes(s)) {
        const apart = b.min[0] >= c.x + half || b.max[0] <= c.x - half || b.min[2] >= c.z + half || b.max[2] <= c.z - half ||
          b.min[1] >= c.y - 0.6 - 1e-6 || b.max[1] <= c.y - PIER_DEPTH;
        assert.ok(apart, `${p.piece} at ${c.x},${c.z} meets ${b.module}`);
      }
  }
});

test('pylons flank the road where it leaves the start plaza, and each turning bridge rests on a pivot pier', () => {
  const pylons = plan.world.filter((p) => p.piece === 'pylon').map((p) => position(p.matrix));
  const start = pylons.filter((c) => c.x < -30);
  assert.equal(start.length, 2, 'two pylons at the start plaza');
  assert.ok(start.some((c) => c.x < -38) && start.some((c) => c.x > -38), 'one on each side of the road that leaves its north edge (x -40..-36)');
  assert.ok(start.every((c) => c.z < -4 && c.z > -6), 'at the plaza\'s north edge (z -4)');
  // and two more before the gate, beside the goal's plaza (cells 10..12, -7..-5), clear of everything that folds
  const gate = pylons.filter((c) => c.z < -12);
  assert.equal(gate.length, 2, 'two pylons at the gate plaza');
  assert.equal(pylons.length, 4);
  const pivots = plan.world.filter((p) => p.piece === 'pier_pivot').map((p) => position(p.matrix));
  assert.deepEqual(pivots.map((c) => [c.x, c.y, c.z]), [[-26, 12, 2], [-14, 12, 2]]);
});

test('the walking line runs along the roads, onto the turning bridges and into the plaza', () => {
  assert.ok(plan.walkWorld.length > 10);
  assert.ok((plan.walkModules.get('m_bridge0') ?? []).length >= 2);
  assert.ok((plan.walkModules.get('m_bridge1') ?? []).length >= 2);
  // from the plaza cell where the north road arrives to the plaza's middle
  assert.ok(plan.walkWorld.some((w) => w.a.distanceTo(new THREE.Vector3(-38, 12, -2)) < 0.01 && w.b.distanceTo(new THREE.Vector3(-38, 12, 2)) < 0.01));
});
