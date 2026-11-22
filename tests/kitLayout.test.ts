import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import * as THREE from 'three';
import { CompiledStage } from '../src/core/compile.ts';
import { cellFloor } from '../src/core/math.ts';
import type { StageFile } from '../src/core/types.ts';
import { edgeKey, planSlabs } from '../src/game/kitLayout.ts';

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
  // the turning bridge: plain ends (the roads meet them), moulded sides, no cornice turning round its corners
  const bridge = plan.modules.get('m_bridge1')!;
  assert.equal(count(bridge, 'edge_flush'), 2);
  assert.equal(count(bridge, 'edge_cornice'), 6);
  assert.equal(count(bridge, 'corner_outer'), 0);
  // the road ends that face the bridge in its other state are plain too, and get a wall instead of a balustrade
  const west = cellFloor([-6, 3, 0]);
  const east = cellFloor([-2, 3, 0]);
  assert.ok(plan.flushEdges.has(edgeKey(west[0], west[1], west[2], 'E')));
  assert.ok(plan.flushEdges.has(edgeKey(east[0], east[1], east[2], 'W')));
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
          b.min[1] >= c.y - 0.6 - 1e-6 || b.max[1] <= c.y - 46.6;
        assert.ok(apart, `${p.piece} at ${c.x},${c.z} meets ${b.module}`);
      }
  }
});
