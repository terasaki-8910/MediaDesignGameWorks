"""The tiling stone materials of the kit, once: public/assets/kit/materials.glb.

    node <game3d>/scripts/blender.mjs art/blender/gen_materials.py -- --out public/assets/kit/materials.glb

Two swatches (1 m squares), swatch_paving with M_paving and swatch_stone with M_stone. They carry the tinted base
colour, the roughness and the OpenGL normal map made from the Poly Haven sources in art/textures. The other kit
files only name these materials; the game copies the maps onto them at load time (src/game/kit.ts), so each image
is downloaded and held on the GPU once.
"""
import os
import sys

import bpy
import bmesh

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import fc_kit as K  # noqa: E402

opts = K.script_args()
OUT = opts.get("out", "public/assets/kit/materials.glb")
K.reset()
paving, ashlar = dict(K.PAVING), dict(K.ASHLAR)
if "textures" in opts:  # comparison builds: --paving <id> --ashlar <id> --textures <dir>
    K.TEXTURES = opts["textures"]
    paving.update(id=opts.get("paving", paving["id"]))
    ashlar.update(id=opts.get("ashlar", ashlar["id"]))
swatches = []
for name, mat in (("swatch_paving", K.stone_material_full("M_paving", paving, K.PAVING_SATURATION)),
                  ("swatch_stone", K.stone_material_full("M_stone", ashlar, K.STONE_SATURATION))):
    bm = bmesh.new()
    bm.faces.new([bm.verts.new(p) for p in ((0, 0, 0), (1, 0, 0), (1, 1, 0), (0, 1, 0))])
    ob = K.finish(K.new_object(name, bm, mat))
    uv = ob.data.uv_layers.new(name="UV0")
    for loop in ob.data.loops:
        co = ob.data.vertices[loop.vertex_index].co
        uv.data[loop.index].uv = (co.x, co.y)
    K.check_mesh(ob, closed=False)
    swatches.append(ob)
bpy.context.view_layer.update()
K.export(OUT, swatches)
