// buildings.glb is Draco-compressed (art/blender/gen_buildings.py; the game decodes it through src/game/gltf.ts). The
// file must really be compressed and under its size target, and the layer code must have come through exactly.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

test('buildings.glb is Draco-compressed, keeps its colours as shorts and stays under 2.5 MB', () => {
  const file = fs.readFileSync(path.join(import.meta.dirname, '..', 'public', 'assets', 'buildings.glb'));
  assert.ok(file.length <= 2_500_000, `${file.length} bytes`);
  const doc = JSON.parse(file.subarray(20, 20 + file.readUInt32LE(12)).toString('utf8'));
  assert.ok(doc.extensionsRequired?.includes('KHR_draco_mesh_compression'));
  for (const mesh of doc.meshes)
    for (const p of mesh.primitives) {
      assert.ok(p.extensions?.KHR_draco_mesh_compression, `${mesh.name} is compressed`);
      // the layer and the weathering are in COLOR_0's alpha: Draco keeps integers exactly, floats it would quantize
      const colour = p.attributes.COLOR_0;
      if (colour !== undefined) assert.equal(doc.accessors[colour].componentType, 5123, `${mesh.name}: COLOR_0 is unsigned shorts`);
    }
});
