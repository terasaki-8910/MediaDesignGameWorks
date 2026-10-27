"""Generates the Core Gate hero asset for FOLD / CITY and exports public/assets/gate.glb.

Run with Blender's Python module (pip install bpy==5.2.3, Python 3.13):
    python art/blender/gen_gate.py [output.glb]
or inside Blender:
    blender --background --python art/blender/gen_gate.py -- [output.glb]

Everything is built procedurally (bmesh + modifiers), so the asset can be regenerated and tweaked from code.
Blender is Z-up; the glTF exporter converts to Y-up, so the ring ends up facing +/-Z in three.js.
"""
import math
import sys

import bpy  # must come first: the bpy module sets up Blender's environment
import bmesh  # noqa: E402

args = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:]
OUT = args[0] if args else "public/assets/gate.glb"

bpy.ops.wm.read_factory_settings(use_empty=True)


def material(name, color, metallic=0.0, roughness=0.6, emission=None, strength=0.0):
    m = bpy.data.materials.new(name)
    try:
        m.use_nodes = True  # always on (and deprecated) in newer Blender versions
    except Exception:
        pass
    bsdf = m.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (*color, 1.0)
    bsdf.inputs["Metallic"].default_value = metallic
    bsdf.inputs["Roughness"].default_value = roughness
    if emission:
        bsdf.inputs["Emission Color"].default_value = (*emission, 1.0)
        bsdf.inputs["Emission Strength"].default_value = strength
    return m


def srgb(hexstr):
    """Hex sRGB to linear RGB tuple, as Blender colour sockets expect."""
    c = [int(hexstr[i:i + 2], 16) / 255 for i in (1, 3, 5)]
    return tuple(x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c)


STONE = material("Stone", srgb("#d9d0c3"), roughness=0.72)
DARK = material("DarkStone", srgb("#5d5a6a"), roughness=0.8)
BRASS = material("Brass", srgb("#caa15a"), metallic=1.0, roughness=0.3)
CORE = material("Core", srgb("#5ff2ff"), roughness=0.2, emission=srgb("#5ff2ff"), strength=4.0)


def finish(obj, mat, bevel=0.0, smooth=False):
    obj.data.materials.append(mat)
    if bevel:
        mod = obj.modifiers.new("Bevel", "BEVEL")
        mod.width = bevel
        mod.segments = 2
        mod.limit_method = "ANGLE"
    if smooth:
        for p in obj.data.polygons:
            p.use_smooth = True
    return obj


def active():
    return bpy.context.view_layer.objects.active


def twisted_column(name, radius, height, sides=12, levels=30, twist=math.pi * 0.9, flute=0.12):
    """A fluted column whose flutes spiral upwards, built vertex by vertex with bmesh."""
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    rings = []
    for k in range(levels + 1):
        z = height * k / levels
        a0 = twist * k / levels
        ring = []
        for i in range(sides * 2):
            a = a0 + math.pi * i / sides
            r = radius * (1.0 - flute * (i % 2))
            ring.append(bm.verts.new((r * math.cos(a), r * math.sin(a), z)))
        rings.append(ring)
    n = sides * 2
    for k in range(levels):
        for i in range(n):
            bm.faces.new((rings[k][i], rings[k][(i + 1) % n], rings[k + 1][(i + 1) % n], rings[k + 1][i]))
    bm.faces.new(list(reversed(rings[0])))
    bm.faces.new(rings[-1])
    bm.to_mesh(me)
    bm.free()
    obj = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(obj)
    return obj


RING_Z = 5.6

# stepped octagonal base
for i, (r, z) in enumerate([(4.9, 0.0), (4.3, 0.24), (3.7, 0.48)]):
    bpy.ops.mesh.primitive_cylinder_add(vertices=8, radius=r, depth=0.24, location=(0, 0, z + 0.12), rotation=(0, 0, math.pi / 8))
    finish(active(), STONE if i < 2 else DARK, bevel=0.04).name = f"Step{i}"

# twisted columns with base and capital
for sx in (-1, 1):
    x = sx * 3.75
    col = twisted_column(f"Column{sx}", 0.42, 5.4, twist=sx * math.pi * 0.9)
    col.location = (x, 0, 0.9)
    finish(col, STONE, smooth=True)
    for z, s in ((0.78, 1.25), (6.36, 1.4)):
        bpy.ops.mesh.primitive_cube_add(size=1, location=(x, 0, z))
        o = active()
        o.scale = (s, s, 0.28)
        finish(o, BRASS if z > 1 else DARK, bevel=0.05).name = f"Capital{sx}_{z:.1f}"
    bpy.ops.mesh.primitive_cone_add(vertices=8, radius1=0.32, radius2=0.0, depth=0.9, location=(x, 0, 6.95))
    finish(active(), BRASS, bevel=0.02).name = f"Finial{sx}"

# outer ring, inner ring and spokes (in the XZ plane)
bpy.ops.mesh.primitive_torus_add(major_radius=4.2, minor_radius=0.36, major_segments=96, minor_segments=16,
                                 location=(0, 0, RING_Z), rotation=(math.pi / 2, 0, 0))
finish(active(), BRASS, smooth=True).name = "OuterRing"
bpy.ops.mesh.primitive_torus_add(major_radius=3.15, minor_radius=0.11, major_segments=96, minor_segments=8,
                                 location=(0, 0, RING_Z), rotation=(math.pi / 2, 0, 0))
finish(active(), BRASS, smooth=True).name = "InnerRing"
for i in range(16):
    a = 2 * math.pi * i / 16
    r = 3.6
    bpy.ops.mesh.primitive_cube_add(size=1, location=(r * math.cos(a), 0, RING_Z + r * math.sin(a)), rotation=(0, -a, 0))
    o = active()
    o.scale = (0.8 if i % 4 else 1.15, 0.14, 0.12)
    finish(o, BRASS, bevel=0.02).name = f"Spoke{i}"

# glowing core and keystone
bpy.ops.mesh.primitive_circle_add(vertices=64, radius=3.02, fill_type="NGON", location=(0, 0, RING_Z), rotation=(math.pi / 2, 0, 0))
finish(active(), CORE).name = "CoreDisc"
bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0, RING_Z + 4.62))
o = active()
o.scale = (0.9, 0.7, 0.7)
finish(o, STONE, bevel=0.06).name = "Keystone"
bpy.ops.mesh.primitive_uv_sphere_add(segments=16, ring_count=8, radius=0.28, location=(0, 0, RING_Z + 5.2))
finish(active(), CORE, smooth=True).name = "Crown"

bpy.ops.export_scene.gltf(filepath=OUT, export_format="GLB", export_apply=True, export_yup=True)
tris = sum(len(p.vertices) - 2 for ob in bpy.data.objects if ob.type == "MESH" for p in ob.data.polygons)
print(f"exported {OUT} ({len(bpy.data.objects)} objects, ~{tris} triangles before modifiers)")
