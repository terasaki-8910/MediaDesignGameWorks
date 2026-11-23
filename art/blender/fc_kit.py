"""Shared code of the FOLD / CITY kit scripts (Blender 4.4.3, run headless through the game3d harness's blender.mjs).

Units and frame: 1 unit = 1 m. Blender is Z-up; a piece is modelled in the game's module-local frame with
Blender +X = east, +Y = north (three.js -Z), +Z = up, origin at the floor centre of a 4 m cell. The exporter converts
to Y-up. Pieces that belong to a cell edge are modelled on the north edge; the game turns them for the other sides.

Each script builds its pieces from scratch, bakes ambient occlusion (never directional light: pieces rotate at
runtime), runs the checks below and exports one GLB whose nodes are named after the pieces. Nothing is random.
"""
import math
import os
import sys

import bpy
import bmesh
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree

CELL = 4.0
SLAB = 0.6
ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
TEXTURES = os.path.join(ROOT, "art", "textures")

# Poly Haven sources (CC0), fetched by art/fetch-textures.mjs. `size` is the side one repeat covers, in metres
# (Poly Haven's "dimensions"); `target` is the mean base colour the brief asks for (sRGB hex), except for the paving.
# The paving is 1K too: at the play camera its nearest texels are about one screen pixel, and 2K maps would put the
# game over the brief's 96 MB texture budget (measured: 2K base + normal cost 43 MB against 11 MB).
# The paving's base is a near-neutral light grey (#CED1D2, a shade cooler than the brief's #C9C1B3-#D8D0C2): the 3700 K sun
# supplies the warmth, so it renders as reference A3's limestone (lit C* about 15, L* 80) and its shade stays neutral
# (C* 2-5) like A3's and A1's. With the brief's warm base the lit paving rendered at C* 29 and the shade at C* 8.
PAVING = {"id": "floor_tiles_02", "res": "1k", "size": 4.0, "target": "#CED1D2", "rough": (0.55, 0.75), "nor_res": "1k",
          "joints": True, "normal_strength": 0.55}
ASHLAR = {"id": "sandstone_blocks_04", "res": "1k", "size": 3.0, "target": "#B9AF9F", "rough": (0.7, 0.9), "nor_res": "1k"}
STONE_SATURATION = 0.55  # the photo is yellower than the brief's warm grey limestone
PAVING_SATURATION = 0.8


def script_args():
    """Options after "--": --out <file.glb> and any --key value pairs."""
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    opts = {}
    i = 0
    while i < len(argv):
        if argv[i].startswith("--") and i + 1 < len(argv):
            opts[argv[i][2:]] = argv[i + 1]
            i += 2
        else:
            raise SystemExit(f"unexpected argument {argv[i]}")
    return opts


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.unit_settings.system = "METRIC"
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = 96
    scene.cycles.use_denoising = False
    scene.cycles.seed = 7
    return scene


def srgb(hexstr):
    """Hex sRGB to a linear RGB tuple."""
    c = [int(hexstr[i:i + 2], 16) / 255 for i in (1, 3, 5)]
    return tuple(x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c)


def _to_linear(a):
    return np.where(a <= 0.04045, a / 12.92, ((a + 0.055) / 1.055) ** 2.4)


def _to_srgb(a):
    a = np.clip(a, 0.0, 1.0)
    return np.where(a <= 0.0031308, a * 12.92, 1.055 * a ** (1 / 2.4) - 0.055)


def _pixels(image):
    a = np.empty(image.size[0] * image.size[1] * 4, dtype=np.float32)
    image.pixels.foreach_get(a)
    return a.reshape(-1, 4)


def _new_image(name, size, pixels, colorspace):
    img = bpy.data.images.new(name, size[0], size[1], alpha=False)
    img.colorspace_settings.name = colorspace
    img.pixels.foreach_set(pixels.astype(np.float32).ravel())
    img.pack()
    return img


def texture_path(spec, kind, res=None):
    return os.path.join(TEXTURES, spec["id"], f"{spec['id']}_{kind}_{res or spec['res']}.jpg")


def tinted_base_colour(spec, name, saturation=1.0):
    """The Poly Haven diffuse map with its mean moved to the brief's colour (per-channel gain in linear light)."""
    src = bpy.data.images.load(texture_path(spec, "diff"))
    rgb = _to_linear(_pixels(src)[:, :3].astype(np.float64))  # 8-bit images hand out their stored (sRGB) values
    mean = rgb.mean(axis=0)
    grey = rgb @ np.array([0.2126, 0.7152, 0.0722])
    rgb = grey[:, None] + (rgb - grey[:, None]) * saturation
    target = np.array(srgb(spec["target"]))
    rgb = rgb * (target / mean)
    if spec.get("joints"):
        # Joints: the photo's grout is lighter than the slabs; reference A3 has dark joints with grey-green dirt in
        # them. The AO map marks the joints. A joint is also drawn along the edge of the tile, so the game can turn
        # the texture from cell to cell without slabs running into each other.
        ao_img = bpy.data.images.load(texture_path(spec, "ao", "1k"))
        ao_img.colorspace_settings.name = "Non-Color"
        w, h = src.size
        ao = _pixels(ao_img)[:, 0].astype(np.float64).reshape(ao_img.size[1], ao_img.size[0])
        if ao.shape != (h, w):
            raise RuntimeError("the AO map and the diffuse map differ in size")
        mask = np.clip((np.median(ao) - 0.06 - ao) / 0.1, 0.0, 1.0)
        edge = 3
        mask[:edge, :] = mask[-edge:, :] = 1.0
        mask[:, :edge] = mask[:, -edge:] = 1.0
        # soften by one pixel so the joint does not alias
        mask = (mask + np.roll(mask, 1, 0) + np.roll(mask, -1, 0) + np.roll(mask, 1, 1) + np.roll(mask, -1, 1)) / 5.0
        m = mask.reshape(-1, 1)
        dirt = np.array(srgb("#5C6650"))
        rgb = rgb * (1.0 - 0.55 * m) + dirt[None, :] * 0.5 * m
        bpy.data.images.remove(ao_img)
    out = np.concatenate([_to_srgb(rgb), np.ones((len(rgb), 1))], axis=1)
    img = _new_image(name, src.size, out, "sRGB")
    bpy.data.images.remove(src)
    return img


def roughness_orm(spec, name):
    """glTF metallic-roughness image (G roughness, B metallic = 0) with the roughness map fitted to the brief's range."""
    src = bpy.data.images.load(texture_path(spec, "rough", "1k"))
    src.colorspace_settings.name = "Non-Color"
    r = _pixels(src)[:, 0].astype(np.float64)
    lo, hi = np.percentile(r, 2), np.percentile(r, 98)
    r = spec["rough"][0] + (np.clip((r - lo) / max(hi - lo, 1e-6), 0, 1)) * (spec["rough"][1] - spec["rough"][0])
    out = np.stack([np.ones_like(r), r, np.zeros_like(r), np.ones_like(r)], axis=1)
    img = _new_image(name, src.size, out, "Non-Color")
    bpy.data.images.remove(src)
    return img


def _occlusion_group():
    """The node group the glTF exporter reads the occlusion texture from."""
    g = bpy.data.node_groups.get("glTF Material Output")
    if g is None:
        g = bpy.data.node_groups.new("glTF Material Output", "ShaderNodeTree")
        g.interface.new_socket(name="Occlusion", in_out="INPUT", socket_type="NodeSocketFloat")
        g.nodes.new("NodeGroupInput")
    return g


def _base_material(name):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    m.use_backface_culling = True  # single-sided in glTF
    return m, m.node_tree, m.node_tree.nodes["Principled BSDF"]


def stone_material(name, spec, saturation=1.0):
    """A stone material of the kit, by name only: the tiling maps live once in materials.glb (gen_materials.py) and the
    game gives them to every kit material of this name. Here it carries the mean colour (for the bakes), the UV scale
    and, after bake_ao, the piece family's own occlusion map."""
    m, nt, bsdf = _base_material(name)
    bsdf.inputs["Base Color"].default_value = (*srgb(spec["target"]), 1.0)
    bsdf.inputs["Roughness"].default_value = sum(spec["rough"]) / 2
    bsdf.inputs["Metallic"].default_value = 0.0
    m["uv_size"] = spec["size"]
    return m


def stone_material_full(name, spec, saturation=1.0):
    """Tiling stone on UV0 (world scale): tinted base colour, roughness, OpenGL normal map (materials.glb only)."""
    m, nt, bsdf = _base_material(name)
    uv = nt.nodes.new("ShaderNodeUVMap")
    uv.uv_map = "UV0"
    col = nt.nodes.new("ShaderNodeTexImage")
    col.image = tinted_base_colour(spec, f"{name}_base", saturation)
    nt.links.new(uv.outputs["UV"], col.inputs["Vector"])
    nt.links.new(col.outputs["Color"], bsdf.inputs["Base Color"])
    orm = nt.nodes.new("ShaderNodeTexImage")
    orm.image = roughness_orm(spec, f"{name}_orm")
    nt.links.new(uv.outputs["UV"], orm.inputs["Vector"])
    sep = nt.nodes.new("ShaderNodeSeparateColor")
    nt.links.new(orm.outputs["Color"], sep.inputs["Color"])
    nt.links.new(sep.outputs["Green"], bsdf.inputs["Roughness"])
    nor = nt.nodes.new("ShaderNodeTexImage")
    nor.image = bpy.data.images.load(texture_path(spec, "nor_gl", spec["nor_res"]))
    nor.image.colorspace_settings.name = "Non-Color"
    nt.links.new(uv.outputs["UV"], nor.inputs["Vector"])
    nm = nt.nodes.new("ShaderNodeNormalMap")
    nm.uv_map = "UV0"
    nm.inputs["Strength"].default_value = spec.get("normal_strength", 1.0)
    nt.links.new(nor.outputs["Color"], nm.inputs["Color"])
    nt.links.new(nm.outputs["Normal"], bsdf.inputs["Normal"])
    bsdf.inputs["Metallic"].default_value = 0.0
    m["uv_size"] = spec["size"]
    return m


def plain_material(name, colour, metallic=0.0, roughness=0.5, emission=None, strength=0.0):
    """A material without tiling textures (metal, glass, bulb). `colour` and `emission` are sRGB hex."""
    m, nt, bsdf = _base_material(name)
    bsdf.inputs["Base Color"].default_value = (*srgb(colour), 1.0)
    bsdf.inputs["Metallic"].default_value = metallic
    bsdf.inputs["Roughness"].default_value = roughness
    if emission:
        bsdf.inputs["Emission Color"].default_value = (*srgb(emission), 1.0)
        bsdf.inputs["Emission Strength"].default_value = strength
    return m


# ---------------------------------------------------------------------------------------------------------------
# Geometry


def new_object(name, bm, material=None, materials=None):
    me = bpy.data.meshes.new(name)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(ob)
    for mat in materials or ([material] if material else []):
        me.materials.append(mat)
    return ob


def prism(bm, profile, x0, x1, material_index=0):
    """Extrude a closed profile [(y, z), ...] along X from x0 to x1, with end caps."""
    a = [bm.verts.new((x0, y, z)) for y, z in profile]
    b = [bm.verts.new((x1, y, z)) for y, z in profile]
    n = len(profile)
    faces = [bm.faces.new((a[i], a[(i + 1) % n], b[(i + 1) % n], b[i])) for i in range(n)]
    faces.append(bm.faces.new(a))
    faces.append(bm.faces.new(list(reversed(b))))
    for f in faces:
        f.material_index = material_index
    return faces


def box(bm, lo, hi, material_index=0):
    v = [bm.verts.new((x, y, z)) for z in (lo[2], hi[2]) for y in (lo[1], hi[1]) for x in (lo[0], hi[0])]
    quads = [(0, 2, 3, 1), (4, 5, 7, 6), (0, 1, 5, 4), (2, 6, 7, 3), (0, 4, 6, 2), (1, 3, 7, 5)]
    faces = [bm.faces.new([v[i] for i in q]) for q in quads]
    for f in faces:
        f.material_index = material_index
    return faces


def ring(half, z, chamfer, centre=(0.0, 0.0)):
    """A square of half-width `half` with its corners cut by `chamfer` (0 gives a square; counter-clockwise)."""
    c = min(chamfer, half * 0.999)
    pts = []
    for sx, sy in ((1, -1), (1, 1), (-1, 1), (-1, -1)):
        if c <= 1e-6:
            pts.append((sx * half, sy * half))
        elif sx * sy < 0:
            pts += [(sx * (half - c), sy * half), (sx * half, sy * (half - c))]
        else:
            pts += [(sx * half, sy * (half - c)), (sx * (half - c), sy * half)]
    return [(centre[0] + x, centre[1] + y, z) for x, y in pts]


def loft(bm, sections, material_index=0, cap_bottom=True, cap_top=True, centre=(0.0, 0.0)):
    """Skin a list of (half, z, chamfer) square sections from bottom to top; all rings have the same vertex count."""
    rings = []
    for half, z, chamfer in sections:
        rings.append([bm.verts.new(p) for p in ring(half, z, max(chamfer, 1e-4), centre)])
    n = len(rings[0])
    faces = []
    for k in range(len(rings) - 1):
        for i in range(n):
            faces.append(bm.faces.new((rings[k][i], rings[k][(i + 1) % n], rings[k + 1][(i + 1) % n], rings[k + 1][i])))
    if cap_bottom:
        faces.append(bm.faces.new(list(reversed(rings[0]))))
    if cap_top:
        faces.append(bm.faces.new(rings[-1]))
    for f in faces:
        f.material_index = material_index
    return faces


def lathe(bm, profile, segments, material_index=0, centre=(0.0, 0.0)):
    """Revolve [(radius, z), ...] about the vertical through `centre`; ends with radius 0 close the shape."""
    rings = []
    for r, z in profile:
        if r <= 1e-6:
            rings.append([bm.verts.new((centre[0], centre[1], z))])
        else:
            rings.append([bm.verts.new((centre[0] + r * math.cos(2 * math.pi * i / segments),
                                        centre[1] + r * math.sin(2 * math.pi * i / segments), z)) for i in range(segments)])
    faces = []
    for k in range(len(rings) - 1):
        a, b = rings[k], rings[k + 1]
        for i in range(segments):
            j = (i + 1) % segments
            if len(a) == 1 and len(b) == 1:
                continue
            if len(a) == 1:
                faces.append(bm.faces.new((a[0], b[j], b[i])))
            elif len(b) == 1:
                faces.append(bm.faces.new((a[i], a[j], b[0])))
            else:
                faces.append(bm.faces.new((a[i], a[j], b[j], b[i])))
    if len(rings[0]) > 1:
        faces.append(bm.faces.new(list(reversed(rings[0]))))
    if len(rings[-1]) > 1:
        faces.append(bm.faces.new(rings[-1]))
    for f in faces:
        f.material_index = material_index
    return faces


def tube(bm, path, radius, segments=6, material_index=0, side=(0, 1, 0)):
    """A round tube along a polyline that lies in a plane whose normal is `side` (default: the XZ plane), with caps."""
    rings = []
    for i, p in enumerate(path):
        a = Vector(path[max(i - 1, 0)])
        b = Vector(path[min(i + 1, len(path) - 1)])
        t = (b - a).normalized()
        side_v = Vector(side)
        up = t.cross(side_v).normalized()
        rings.append([bm.verts.new(Vector(p) + radius * (math.cos(2 * math.pi * k / segments) * side_v + math.sin(2 * math.pi * k / segments) * up))
                      for k in range(segments)])
    faces = []
    for k in range(len(rings) - 1):
        for i in range(segments):
            j = (i + 1) % segments
            faces.append(bm.faces.new((rings[k][i], rings[k][j], rings[k + 1][j], rings[k + 1][i])))
    faces.append(bm.faces.new(list(reversed(rings[0]))))
    faces.append(bm.faces.new(rings[-1]))
    for f in faces:
        f.material_index = material_index
    return faces


def keyed_faces(bm, polygons, material_index=0):
    """Faces from coordinate lists; equal points share a vertex and polygons that collapse are dropped."""
    verts = {}
    for poly in polygons:
        ids = []
        for p in poly:
            key = tuple(round(c, 6) for c in p)
            if key not in verts:
                verts[key] = bm.verts.new(p)
            if not ids or ids[-1] is not verts[key]:
                ids.append(verts[key])
        if len(ids) > 1 and ids[0] is ids[-1]:
            ids.pop()
        if len(ids) >= 3:
            try:
                bm.faces.new(ids).material_index = material_index
            except ValueError:
                pass  # the same face twice


def arc(cx, cy, rx, ry, a0, a1, steps):
    """Points on an ellipse arc, angles in degrees, both ends included."""
    return [(cx + rx * math.cos(math.radians(a0 + (a1 - a0) * i / steps)),
             cy + ry * math.sin(math.radians(a0 + (a1 - a0) * i / steps))) for i in range(steps + 1)]


def finish(ob, bevel=0.0, segments=2, smooth_angle=38.0):
    """Bevel the hard edges, apply, and shade smooth with sharp edges above `smooth_angle` degrees."""
    bpy.context.view_layer.objects.active = ob
    if bevel > 0:
        mod = ob.modifiers.new("Bevel", "BEVEL")
        mod.width = bevel
        mod.segments = segments
        mod.limit_method = "ANGLE"
        mod.angle_limit = math.radians(40)
        mod.harden_normals = False
        dg = bpy.context.evaluated_depsgraph_get()
        me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
        old = ob.data
        ob.modifiers.clear()
        ob.data = me
        me.name = old.name
        bpy.data.meshes.remove(old)
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    limit = math.radians(smooth_angle)
    for f in bm.faces:
        f.smooth = True
    for e in bm.edges:
        e.smooth = not (len(e.link_faces) == 2 and e.calc_face_angle(0.0) > limit)
    bm.to_mesh(ob.data)
    bm.free()
    return ob


def world_uv(ob, offset=(0.0, 0.0, 0.0)):
    """UV0: box projection at world scale, one repeat per the material's `uv_size` metres (constant texel density)."""
    me = ob.data
    uv = me.uv_layers.get("UV0") or me.uv_layers.new(name="UV0")
    for poly in me.polygons:
        mat = me.materials[poly.material_index] if me.materials else None
        size = (mat.get("uv_size") if mat else None) or 1.0
        n = poly.normal
        ax = max(range(3), key=lambda i: abs(n[i]))
        for li in poly.loop_indices:
            p = me.vertices[me.loops[li].vertex_index].co + Vector(offset)
            if ax == 2:
                u, v = p.x, p.y
            elif ax == 1:
                u, v = (p.x if n.y < 0 else -p.x), p.z
            else:
                u, v = (p.y if n.x > 0 else -p.y), p.z
            uv.data[li].uv = (u / size, v / size)


# ---------------------------------------------------------------------------------------------------------------
# Ambient occlusion


def copy_uv(src, dst, layer):
    """Copy a UV layer between two objects with the same topology."""
    a = np.empty(len(src.data.loops) * 2, dtype=np.float32)
    src.data.uv_layers[layer].data.foreach_get("uv", a)
    if layer not in dst.data.uv_layers:
        dst.data.uv_layers.new(name=layer)
    dst.data.uv_layers[layer].data.foreach_set("uv", a)


def unwrap_atlas(objects, layer, margin=0.004):
    """Give every object a non-overlapping island set in one shared 0..1 square (`layer`)."""
    for ob in bpy.context.view_layer.objects:
        ob.select_set(False)
    for ob in objects:
        if layer not in ob.data.uv_layers:
            ob.data.uv_layers.new(name=layer)
        ob.data.uv_layers.active = ob.data.uv_layers[layer]
        ob.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=margin, area_weight=0.0, scale_to_bounds=False)
    bpy.ops.uv.select_all(action="SELECT")
    bpy.ops.uv.pack_islands(rotate=True, margin=margin)
    bpy.ops.object.mode_set(mode="OBJECT")


def bake_ao(objects, name, size, layer="UV1", occluders=(), distance=1.2, strength=1.0):
    """Bake ambient occlusion of `objects` into one image on `layer` and wire it into their materials for glTF.

    `occluders` only cast (ground planes, neighbours): they are hidden from the export by the caller. The bake uses
    Cycles' AO pass, which has no light direction in it.
    """
    scene = bpy.context.scene
    world = scene.world or bpy.data.worlds.new("World")
    scene.world = world
    world.light_settings.distance = distance
    img = bpy.data.images.new(name, size, size, alpha=False)
    img.colorspace_settings.name = "Non-Color"
    materials = []
    for ob in objects:
        ob.data.uv_layers.active = ob.data.uv_layers[layer]
        for mat in ob.data.materials:
            if mat not in materials:
                materials.append(mat)
    nodes = {}
    for mat in materials:
        nt = mat.node_tree
        node = nt.nodes.new("ShaderNodeTexImage")
        node.image = img
        uv = nt.nodes.new("ShaderNodeUVMap")
        uv.uv_map = layer
        nt.links.new(uv.outputs["UV"], node.inputs["Vector"])
        for n in nt.nodes:
            n.select = False
        node.select = True
        nt.nodes.active = node
        nodes[mat.name] = node
    for ob in bpy.context.view_layer.objects:
        ob.select_set(False)
    for ob in objects:
        ob.select_set(True)
    for ob in occluders:
        ob.hide_render = False
    bpy.context.view_layer.objects.active = objects[0]
    scene.render.bake.margin = 8
    scene.render.bake.use_clear = True
    scene.render.bake.target = "IMAGE_TEXTURES"
    bpy.ops.object.bake(type="AO", uv_layer=layer)
    px = _pixels(img)
    ao = px[:, 0].astype(np.float64)
    ao = 1.0 - (1.0 - np.clip(ao, 0, 1)) * strength
    px[:, 0] = px[:, 1] = px[:, 2] = ao
    img.pixels.foreach_set(px.ravel())
    img.pack()
    group = _occlusion_group()
    for mat in materials:
        nt = mat.node_tree
        out = nt.nodes.new("ShaderNodeGroup")
        out.node_tree = group
        nt.links.new(nodes[mat.name].outputs["Color"], out.inputs["Occlusion"])
    return img


def sample_image(img, uvs):
    """Nearest-texel red channel of `img` at an array of UVs."""
    w, h = img.size
    px = _pixels(img).reshape(h, w, 4)
    x = np.clip((uvs[:, 0] * w).astype(int), 0, w - 1)
    y = np.clip((uvs[:, 1] * h).astype(int), 0, h - 1)
    return px[y, x, 0]


def grime_vertex_colours(objects, ao_img, layer="UV1", tint="#7F8672", amount=0.8, power=1.3, skip=()):
    """COLOR_0: where the baked AO is dark (recesses, the feet of plinths) the surface is multiplied towards `tint`:
    grey-green on stone, as rain leaves it; verdigris on bronze. Materials named in `skip` stay white."""
    t = np.array(srgb(tint))
    for ob in objects:
        me = ob.data
        keep = np.ones(len(me.loops))
        for poly in me.polygons:
            if me.materials and me.materials[poly.material_index].name in skip:
                keep[poly.loop_start:poly.loop_start + poly.loop_total] = 0.0
        uv = np.empty(len(me.loops) * 2, dtype=np.float32)
        me.uv_layers[layer].data.foreach_get("uv", uv)
        ao = sample_image(ao_img, uv.reshape(-1, 2)).astype(np.float64)
        k = np.clip((1.0 - ao) * 1.4, 0, 1) ** power * amount * keep
        col = 1.0 + (t[None, :] - 1.0) * k[:, None]
        attr = me.color_attributes.new(name="Color", type="BYTE_COLOR", domain="CORNER")
        rgba = np.concatenate([col, np.ones((len(col), 1))], axis=1).astype(np.float32)
        attr.data.foreach_set("color", rgba.ravel())
        me.color_attributes.active_color = attr
        me.color_attributes.render_color_index = 0


def neutral_uv_offset(spec, width, height, step=0.07):
    """Where on the stone texture a small part (a baluster) should take its colour from: the offset (u, v) of the
    width x height metre window whose mean is nearest to the mean of the whole map, so that small parts are not all
    one ochre or one grey patch of it."""
    src = bpy.data.images.load(texture_path(spec, "diff"))
    w, h = src.size
    rgb = _to_linear(_pixels(src)[:, :3].astype(np.float64)).reshape(h, w, 3)
    bpy.data.images.remove(src)
    mean = rgb.reshape(-1, 3).mean(axis=0)
    pw, ph = max(2, int(w * width / spec["size"])), max(2, int(h * height / spec["size"]))
    best, best_d = (0.0, 0.0), 1e9
    u = 0.0
    while u < 1.0:
        v = 0.0
        while v < 1.0:
            x0, y0 = int(u * w), int(v * h)
            patch = rgb[np.arange(y0, y0 + ph) % h][:, np.arange(x0, x0 + pw) % w].reshape(-1, 3).mean(axis=0)
            d = float(np.abs(patch / mean - 1.0).sum())
            if d < best_d:
                best, best_d = (u, v), d
            v += step
        u += step
    return best


def course_tint(objects, height=0.6, amount=0.07, skip=()):
    """Multiply COLOR_0 per course of stone: faces whose middle lies in the same `height` band get the same tone,
    up to `amount` lighter or darker, in a fixed sequence (stone from different beds of the quarry)."""
    for ob in objects:
        me = ob.data
        attr = me.color_attributes["Color"]
        col = np.empty(len(me.loops) * 4, dtype=np.float32)
        attr.data.foreach_get("color", col)
        col = col.reshape(-1, 4)
        for poly in me.polygons:
            if me.materials and me.materials[poly.material_index].name in skip:
                continue
            band = int(math.floor((ob.matrix_world @ poly.center).z / height))
            tone = 1.0 + amount * math.sin(band * 12.9898 + 1.7) * math.cos(band * 4.1414)
            col[poly.loop_start:poly.loop_start + poly.loop_total, :3] *= tone
        attr.data.foreach_set("color", np.clip(col, 0, 1).ravel())


def face_weathering(objects, vertical=0.55, top=1.0, low=0.3, high=0.8, skip=()):
    """Multiply COLOR_0 by a tone that depends on which way a face looks (in the piece's own frame, +Z up): faces that
    look up keep `top`, upright and downward faces get `vertical`, with a smooth step between normal.z = `low` and `high`.
    The brief's stone: rain leaves upright faces darker and stained, sun bleaches the tops. It also keeps the stone from
    outshining the paving: a sun 12 degrees up gives an upright face about 4.7 times the light of a flat one."""
    for ob in objects:
        me = ob.data
        attr = me.color_attributes["Color"]
        col = np.empty(len(me.loops) * 4, dtype=np.float32)
        attr.data.foreach_get("color", col)
        col = col.reshape(-1, 4)
        nrm = np.empty(len(me.loops) * 3, dtype=np.float32)
        me.corner_normals.foreach_get("vector", nrm)
        t = np.clip((nrm.reshape(-1, 3)[:, 2] - low) / (high - low), 0.0, 1.0)
        tone = vertical + (top - vertical) * (t * t * (3.0 - 2.0 * t))
        for poly in me.polygons:
            if me.materials and me.materials[poly.material_index].name in skip:
                tone[poly.loop_start:poly.loop_start + poly.loop_total] = 1.0
        col[:, :3] *= tone[:, None]
        attr.data.foreach_set("color", col.ravel())


def depth_weathering(objects, z0, z1, tint="#9A9C96"):
    """Multiply COLOR_0 towards `tint` from height z0 down to z1: stone that stands below the walkways is darker and
    greyer (damp, never in the sun), so the piers do not outshine the paving."""
    t = np.array(srgb(tint))
    for ob in objects:
        me = ob.data
        attr = me.color_attributes["Color"]
        col = np.empty(len(me.loops) * 4, dtype=np.float32)
        attr.data.foreach_get("color", col)
        col = col.reshape(-1, 4)
        z = np.array([(ob.matrix_world @ me.vertices[l.vertex_index].co).z for l in me.loops])
        k_ = np.clip((z0 - z) / (z0 - z1), 0, 1)
        k_ = k_ * k_ * (3 - 2 * k_)
        col[:, :3] *= 1.0 + (t[None, :] - 1.0) * k_[:, None]
        attr.data.foreach_set("color", col.ravel())


# ---------------------------------------------------------------------------------------------------------------
# Checks and export


def check_mesh(ob, closed=True, standing=None):
    """Raise on missing UVs, zero-area faces, open or non-manifold edges (closed parts) and floating parts."""
    me = ob.data
    if "UV0" not in me.uv_layers:
        raise RuntimeError(f"{ob.name}: no UV0")
    bm = bmesh.new()
    bm.from_mesh(me)
    bad = [f for f in bm.faces if f.calc_area() < 1e-9]
    if bad:
        raise RuntimeError(f"{ob.name}: {len(bad)} zero-area faces")
    if closed:
        open_edges = [e for e in bm.edges if len(e.link_faces) != 2]
        if open_edges:
            raise RuntimeError(f"{ob.name}: {len(open_edges)} open or non-manifold edges")
    bm.free()
    if standing is not None:
        low = min((ob.matrix_world @ v.co).z for v in me.vertices)
        if abs(low - standing) > 0.01:
            raise RuntimeError(f"{ob.name}: lowest point {low:.3f} m, expected {standing:.3f} m (floating or sunk)")


def bvh(ob):
    dg = bpy.context.evaluated_depsgraph_get()
    return BVHTree.FromObject(ob, dg)


def check_no_overlap(a, b):
    """Raise when the surfaces of two objects cross (BVH triangle overlap). Parts that only touch must not be passed."""
    ma, mb = a.matrix_world, b.matrix_world
    bm_a, bm_b = bmesh.new(), bmesh.new()
    bm_a.from_mesh(a.data)
    bm_b.from_mesh(b.data)
    bm_a.transform(ma)
    bm_b.transform(mb)
    hits = BVHTree.FromBMesh(bm_a).overlap(BVHTree.FromBMesh(bm_b))
    bm_a.free()
    bm_b.free()
    if hits:
        raise RuntimeError(f"{a.name} and {b.name} intersect ({len(hits)} triangle pairs)")


def triangles(ob):
    return sum(len(p.vertices) - 2 for p in ob.data.polygons)


def export(path, objects, jpeg_quality=88):
    """Export the given objects (and their parents) as one GLB. Options were listed on Blender 4.4.3."""
    for ob in bpy.context.view_layer.objects:
        ob.select_set(False)
    for ob in objects:
        ob.hide_render = False
        ob.select_set(True)
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=path, export_format="GLB", use_selection=True, export_apply=True, export_yup=True,
        export_image_format="JPEG", export_jpeg_quality=jpeg_quality, export_texcoords=True, export_normals=True,
        export_tangents=False, export_materials="EXPORT", export_vertex_color="ACTIVE", export_all_vertex_colors=False,
        export_cameras=False, export_lights=False, export_animations=False, export_extras=False,
        export_gpu_instances=False,
    )
    tris = sum(triangles(o) for o in objects if o.type == "MESH")
    print(f"exported {path}: {len(objects)} nodes, {tris} triangles, {os.path.getsize(path)} bytes")
