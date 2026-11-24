import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import * as THREE from 'three';
import { CompiledStage } from '../src/core/compile.ts';
import type { StageFile } from '../src/core/types.ts';
import { isStreet, planSlabs } from '../src/game/kitLayout.ts';
import { faceArmsUV } from '../src/game/kitMeshes.ts';
import { MURAL_FACES, cubePlacements, muralPlacements, towerPlacements } from '../src/game/setPieces.ts';

const cs = new CompiledStage(JSON.parse(readFileSync('src/stages/area1.json', 'utf8')) as StageFile);
const position = (m: THREE.Matrix4) => new THREE.Vector3().setFromMatrixPosition(m);
/** Where a direction of the piece's own frame points once it is placed. */
const axis = (m: THREE.Matrix4, x: number, y: number, z: number) => new THREE.Vector3(x, y, z).transformDirection(m);
const near = (a: THREE.Vector3, b: readonly number[]) => a.distanceTo(new THREE.Vector3(b[0], b[1], b[2])) < 1e-6;

test('the path cube shows a paved cell exactly where the solver has a tile, and a coffer everywhere else', () => {
  const cube = cs.modules.find((m) => m.type === 'cube3')!;
  assert.equal(cube.type, 'cube3');
  if (cube.type !== 'cube3') return;
  const placed = cubePlacements(cube);
  const paved = placed.filter((p) => p.piece === 'cube_cell_path');
  const tiles = cs.kits.get(cube.id)!.tiles;
  assert.equal(paved.length, tiles.length);
  assert.equal(placed.filter((p) => p.piece === 'cube_cell_blank').length, 6 * 9 - tiles.length);
  for (const t of tiles) {
    // the tile's middle is the cell's middle on the face, and the cell looks along the tile's normal
    const hit = paved.filter((p) => near(position(p.matrix), t.p) && near(axis(p.matrix, 0, 1, 0), t.n));
    assert.equal(hit.length, 1, `tile ${t.key}`);
  }
  // one hub per face; one arm of the path line per arm of the stage data, pointing along it from the middle of its face
  assert.equal(placed.filter((p) => p.piece === 'cube_inlay_hub').length, 6);
  const arms = placed.filter((p) => p.piece === 'cube_inlay_arm');
  const armTiles = tiles.filter((t) => !t.key.endsWith('_c'));
  assert.equal(arms.length, armTiles.length);
  for (const t of armTiles) {
    const middle = tiles.find((c) => c.key === `${t.key.split('_')[0]}_c`)!;
    const along = new THREE.Vector3(t.p[0] - middle.p[0], t.p[1] - middle.p[1], t.p[2] - middle.p[2]).normalize();
    const hit = arms.filter((p) => near(position(p.matrix), middle.p) && axis(p.matrix, 0, 0, -1).distanceTo(along) < 1e-6);
    assert.equal(hit.length, 1, `arm ${t.key}`);
  }
  // every piece is turned, never mirrored: a mirrored piece would show its back
  for (const p of placed) assert.ok(Math.abs(p.matrix.determinant() - 1) < 1e-6, p.piece);
  assert.equal(placed.filter((p) => p.piece === 'cube_frame').length, 1);
});

test('the mural shows each face of the cube on its own tablet, as the face is seen from outside', () => {
  const cube = cs.modules.find((m) => m.type === 'cube3')!;
  if (cube.type !== 'cube3') return;
  const tablets = MURAL_FACES.map((_, k) => new THREE.Vector3(k * 1.42, 2.2, 2.62));
  const arms = MURAL_FACES.map((f) => faceArmsUV(f.face, cube.params.faces[f.face] ?? []));
  const placed = muralPlacements(tablets, arms);
  assert.equal(placed.filter((p) => p.piece === 'mural').length, 1);
  assert.equal(placed.filter((p) => p.piece === 'mural_hub').length, 6);
  MURAL_FACES.forEach((f, k) => {
    const here = placed.filter((p) => p.piece === 'mural_arm' && position(p.matrix).distanceTo(tablets[k]) < 1e-6);
    assert.equal(here.length, (cube.params.faces[f.face] ?? []).length, f.face);
    for (const a of arms[k]) {
      // u to the right (east, seen from the south), v down
      assert.ok(here.some((p) => axis(p.matrix, 0, 0, -1).distanceTo(new THREE.Vector3(a.u, -a.v, 0)) < 1e-6), `${f.face} ${a.u},${a.v}`);
    }
    for (const p of here) assert.ok(near(axis(p.matrix, 0, 1, 0), [0, 0, 1]), 'the inlay looks south, out of the tablet');
  });
});

test('the arm tower has a console under each arm, a crown on its blind corner, and its deck comes from the slab plan', () => {
  const tower = cs.modules.find((m) => m.type === 'tower')!;
  if (tower.type !== 'tower') return;
  const placed = towerPlacements(tower);
  assert.equal(placed.filter((p) => p.piece === 'tower_shaft').length, 1);
  assert.equal(placed.filter((p) => p.piece === 'tower_ring').length, 1);
  const brackets = placed.filter((p) => p.piece === 'tower_bracket');
  assert.equal(brackets.length, tower.params.arms.length);
  // arms west and south: the consoles point west and south (the piece is modelled under a north arm, -Z)
  const points = brackets.map((p) => axis(p.matrix, 0, 0, -1));
  assert.ok(points.some((d) => near(d, [-1, 0, 0])) && points.some((d) => near(d, [0, 0, 1])));
  // the crown is modelled on the north-east corner (+X, -Z) and stands there: the one corner with no arm on either side
  const crowns = placed.filter((p) => p.piece === 'tower_crown');
  assert.equal(crowns.length, 1);
  assert.ok(near(new THREE.Vector3(1, 0, -1).applyMatrix4(crowns[0].matrix), [1, 0, -1]));
  // the shaft is modelled for the stage's depth: not stretched
  assert.ok(placed[0].matrix.equals(new THREE.Matrix4()));

  const deck = planSlabs(cs).modules.get(tower.id)!;
  const count = (piece: string) => deck.filter((p) => p.piece === piece).length;
  assert.equal(count('slab_top'), 3);
  assert.equal(count('slab_bottom'), 3);
  // an arm is 3.6 m long: its paving stops 0.4 m short of the cell's far edge, as the solver's box does
  const west = deck.find((p) => p.piece === 'slab_top' && position(p.matrix).x < -1)!;
  assert.ok(Math.abs(position(west.matrix).x - -3.8) < 1e-6);
  assert.ok(Math.abs(new THREE.Vector3().setFromMatrixScale(west.matrix).x - 0.9) < 1e-6);
});

test('a lamped bridge of four cells is dressed as a street: kerbs on every side but its side port, an archway at its far end', () => {
  const street = cs.modules.find((m) => m.id === 'm_street')!;
  const bridge = cs.modules.find((m) => m.id === 'm_bridge1')!;
  assert.ok(isStreet(street));
  assert.ok(!isStreet(bridge), 'the turning bridge of the first puzzle is three cells: a bridge, not a street');
  const plan = planSlabs(cs);
  const own = plan.modules.get('m_street')!;
  assert.equal(own.filter((p) => p.piece === 'street_side').length, 4 * 2 - 1);
  const arch = own.filter((p) => p.piece === 'street_arch');
  assert.equal(arch.length, 1);
  assert.ok(near(position(arch[0].matrix), [13.2, 0, 0]));
  // the side port is on the north of cell 1: no kerb there
  assert.ok(!own.some((p) => p.piece === 'street_side' && Math.abs(position(p.matrix).x - 4) < 1e-6 && near(axis(p.matrix, 0, 0, -1), [0, 0, -1])));
  assert.equal((plan.modules.get('m_bridge1') ?? []).filter((p) => p.piece.startsWith('street_')).length, 0);
});
