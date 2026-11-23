"""Shared by the background city's scripts (gen_city.py, gen_cityprops.py): the palette, the face-by-face mesh builder
with a colour per face in COLOR_0, the small tiling courses map, and the one material everything shares, so that the game
can draw buildings and props from both files as one batch.
"""
import math

import bpy
import bmesh
import numpy as np

import fc_kit as K

WALL = K.srgb("#A39A8B")
WALL_B = K.srgb("#99907F")
BASE = K.srgb("#857D71")
TRIM = K.srgb("#B3AA9B")
GLASS = K.srgb("#2E363D")
SLATE = K.srgb("#48525C")
ZINC = K.srgb("#8D969B")
RAIL = K.srgb("#2F2D2A")
BRICK = K.srgb("#75675F")
LEAD = K.srgb("#73807A")
STONE_TILE = 10.0  # metres one repeat of the courses map covers on walls: courses of 1.25 m, large enough to read far off
SLATE_TILE = 5.0  # and on roofs
GILT = K.srgb("#9A8850")
DECO = K.srgb("#9D9383")
DECO_B = K.srgb("#80786C")
LEAF = K.srgb("#7E9160")
LEAF_B = K.srgb("#55653F")
BARK = K.srgb("#4A4037")
WATER = K.srgb("#6E8A90")
TANK = K.srgb("#6B5A4B")
SKYLIGHT = K.srgb("#5D7078")

# outward normal and the direction that runs to the right when the wall is seen from outside
FACES = {"S": ((0, -1), (1, 0)), "N": ((0, 1), (-1, 0)), "E": ((1, 0), (0, 1)), "W": ((-1, 0), (0, -1))}


class Shell:
    """Faces with a colour each, wound counter-clockwise seen from outside. Nothing is merged or smoothed."""

    def __init__(self):
        self.bm = bmesh.new()
        self.col = self.bm.loops.layers.color.new("Color")
        self.uv = self.bm.loops.layers.uv.new("UV0")
        self.o = (0.0, 0.0)

    def face(self, pts, colour, colours=None):
        """`colours` gives one colour per corner instead (the streak under the eaves)."""
        f = self.bm.faces.new([self.bm.verts.new((p[0] + self.o[0], p[1] + self.o[1], p[2])) for p in pts])
        f.normal_update()
        n = f.normal
        axis = max(range(3), key=lambda i: abs(n[i]))
        flat = colour in (GLASS, RAIL, GILT, LEAF, LEAF_B, BARK, WATER, SKYLIGHT) and colours is None  # no courses on glass and metal: one texel
        size = SLATE_TILE if colour in (SLATE, LEAD, ZINC) else STONE_TILE
        for k, loop in enumerate(f.loops):
            loop[self.col] = (*(colours[k] if colours else colour), 1.0)
            p = loop.vert.co
            if flat:
                loop[self.uv].uv = (0.031, 0.031)
            elif axis == 2:
                loop[self.uv].uv = (p.x / size, p.y / size)
            elif axis == 1:
                loop[self.uv].uv = (p.x / size, p.z / size)
            else:
                loop[self.uv].uv = (p.y / size, p.z / size)

    def box(self, lo, hi, colour, top=None, bottom=False, foot=None):
        """`foot` darkens the walls towards their lower edge (the street's shade at the foot of a building)."""
        (x0, y0, z0), (x1, y1, z1) = lo, hi
        cs = None if foot is None else [tuple(v * foot for v in colour)] * 2 + [colour] * 2
        self.face([(x0, y0, z0), (x1, y0, z0), (x1, y0, z1), (x0, y0, z1)], colour, cs)
        self.face([(x1, y1, z0), (x0, y1, z0), (x0, y1, z1), (x1, y1, z1)], colour, cs)
        self.face([(x1, y0, z0), (x1, y1, z0), (x1, y1, z1), (x1, y0, z1)], colour, cs)
        self.face([(x0, y1, z0), (x0, y0, z0), (x0, y0, z1), (x0, y1, z1)], colour, cs)
        self.face([(x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1)], top or colour)
        if bottom:
            self.face([(x0, y1, z0), (x1, y1, z0), (x1, y0, z0), (x0, y0, z0)], colour)

    def frustum(self, hx0, hy0, z0, hx1, hy1, z1, colour, top=None, c=(0.0, 0.0)):
        a = [(c[0] + sx * hx0, c[1] + sy * hy0, z0) for sx, sy in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
        b = [(c[0] + sx * hx1, c[1] + sy * hy1, z1) for sx, sy in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
        for i in range(4):
            j = (i + 1) % 4
            if hx1 < 1e-6 and hy1 < 1e-6:
                self.face([a[i], a[j], b[i]], colour)
            else:
                self.face([a[i], a[j], b[j], b[i]], colour)
        if hx1 > 1e-6 or hy1 > 1e-6:
            self.face(b, top or colour)

    def hip(self, hx, hy, z0, z1, colour, c=(0.0, 0.0)):
        """A hipped roof over a rectangle: two long slopes and two hips rising to a ridge along the longer side."""
        if hx >= hy:
            r = hx - hy
            a = [(c[0] - hx, c[1] - hy, z0), (c[0] + hx, c[1] - hy, z0), (c[0] + hx, c[1] + hy, z0), (c[0] - hx, c[1] + hy, z0)]
            r0, r1 = (c[0] - r, c[1], z1), (c[0] + r, c[1], z1)
            if r < 1e-6:
                for i in range(4):
                    self.face([a[i], a[(i + 1) % 4], r0], colour)
                return
            self.face([a[0], a[1], r1, r0], colour)
            self.face([a[1], a[2], r1], colour)
            self.face([a[2], a[3], r0, r1], colour)
            self.face([a[3], a[0], r0], colour)
        else:
            r = hy - hx
            a = [(c[0] - hx, c[1] - hy, z0), (c[0] + hx, c[1] - hy, z0), (c[0] + hx, c[1] + hy, z0), (c[0] - hx, c[1] + hy, z0)]
            r0, r1 = (c[0], c[1] - r, z1), (c[0], c[1] + r, z1)
            self.face([a[0], a[1], r0], colour)
            self.face([a[1], a[2], r1, r0], colour)
            self.face([a[2], a[3], r1], colour)
            self.face([a[3], a[0], r0, r1], colour)

    def blob(self, c, r, z0, h, colour, under, seg=6):
        """A tree's crown: a squat lump, lighter above than below."""
        zs = [(0.0, 0.55), (0.3, 1.0), (0.68, 0.82), (1.0, 0.0)]
        for k in range(3):
            (t0, s0), (t1, s1) = zs[k], zs[k + 1]
            self.cylinder(c, r * s0, z0 + h * t0, z0 + h * t1, under if k == 0 else colour, seg, r1=r * s1)

    def water_tower(self, c, z0, r=1.9, h=3.4, legs=2.6):
        """A rooftop water tank: a wooden drum on a frame under a low cone."""
        for sx, sy in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
            x, y = c[0] + sx * r * 0.62, c[1] + sy * r * 0.62
            self.box((x - 0.14, y - 0.14, z0), (x + 0.14, y + 0.14, z0 + legs), RAIL)
        self.cylinder(c, r, z0 + legs, z0 + legs + h, TANK, 8, alt=BRICK)
        self.cylinder(c, r + 0.2, z0 + legs + h, z0 + legs + h + 1.2, ZINC, 8, r1=0.0)

    def garden(self, lo, hi, z0, wall=0.9):
        """A roof garden: a low parapet round beds of green, a path between them."""
        (x0, y0), (x1, y1) = lo, hi
        self.box((x0, y0, z0), (x1, y1, z0 + wall), TRIM, top=DECO_B)
        mx = (x0 + x1) / 2
        for a, b in ((x0 + 0.8, mx - 0.7), (mx + 0.7, x1 - 0.8)):
            self.box((a, y0 + 0.8, z0 + wall), (b, y1 - 0.8, z0 + wall + 0.9), LEAF_B, top=LEAF)

    def cylinder(self, c, r, z0, z1, colour, seg=12, top=None, r1=None, alt=None):
        r1 = r if r1 is None else r1
        for i in range(seg):
            a0, a1 = 2 * math.pi * i / seg, 2 * math.pi * (i + 1) / seg
            p0 = (c[0] + r * math.cos(a0), c[1] + r * math.sin(a0), z0)
            p1 = (c[0] + r * math.cos(a1), c[1] + r * math.sin(a1), z0)
            q0 = (c[0] + r1 * math.cos(a0), c[1] + r1 * math.sin(a0), z1)
            q1 = (c[0] + r1 * math.cos(a1), c[1] + r1 * math.sin(a1), z1)
            shade = alt if (alt and i % 2) else colour
            if r1 < 1e-6:
                self.face([p0, p1, q0], shade)
            else:
                self.face([p0, p1, q1, q0], shade)
        if r1 > 1e-6:
            self.face([(c[0] + r1 * math.cos(2 * math.pi * i / seg), c[1] + r1 * math.sin(2 * math.pi * i / seg), z1) for i in range(seg)], top or colour)

    def dome(self, c, r, z0, h, colour, seg=14, rings=5, alt=None):
        for k in range(rings):
            t0, t1 = (math.pi / 2) * k / rings, (math.pi / 2) * (k + 1) / rings
            self.cylinder(c, r * math.cos(t0), z0 + h * math.sin(t0), z0 + h * math.sin(t1), colour, seg, r1=r * math.cos(t1) if k < rings - 1 else 0.0, alt=alt)

    def panel(self, side, hx, hy, u0, u1, z0, z1, colour, proud=0.08):
        """A flat face on a wall of a box with half-sizes hx, hy: from u0 to u1 along the wall (0 = its middle)."""
        (nx, ny), (rx, ry) = FACES[side]
        d = (hx if nx else hy) + proud
        p = lambda u, z: (nx * d + rx * u, ny * d + ry * u, z)  # noqa: E731
        self.face([p(u0, z0), p(u1, z0), p(u1, z1), p(u0, z1)], colour)

    def streak(self, hx, hy, z_top, colour, depth=1.5, sides="SNEW"):
        """Rain under the eaves: a strip that is darker at the top and the wall's own colour at its lower edge."""
        dark = tuple(v * 0.5 for v in colour)
        for side in sides:
            (nx, ny), (rx, ry) = FACES[side]
            d = (hx if nx else hy) + 0.05 + (0.3 if depth > 2.5 else 0.0)  # in front of the far model's window bands
            half = (hx if side in "SN" else hy) - 0.3
            p = lambda u, z: (nx * d + rx * u, ny * d + ry * u, z)  # noqa: E731
            self.face([p(-half, z_top - depth), p(half, z_top - depth), p(half, z_top), p(-half, z_top)], colour, [colour, colour, dark, dark])

    def windows(self, hx, hy, z, bays_per_metre, win_w, win_h, colour=GLASS, sides="SNEW", proud=0.08, margin=1.2):
        for side in sides:
            length = 2 * (hx if side in "SN" else hy) - 2 * margin
            n = max(1, int(length * bays_per_metre))
            step = length / n
            for i in range(n):
                u = -length / 2 + step * (i + 0.5)
                self.panel(side, hx, hy, u - win_w / 2, u + win_w / 2, z, z + win_h, colour, proud)

    def band(self, hx, hy, z0, z1, colour, proud, sides="SNEW", margin=0.8):
        for side in sides:
            half = (hx if side in "SN" else hy) - margin
            self.panel(side, hx, hy, -half, half, z0, z1, colour, proud)

    def object(self, name, material):
        me = bpy.data.meshes.new(name)
        self.bm.to_mesh(me)
        self.bm.free()
        ob = bpy.data.objects.new(name, me)
        bpy.context.collection.objects.link(ob)
        me.materials.append(material)
        me.color_attributes.active_color = me.color_attributes["Color"]
        return ob




def slots(s, hx, hy, z0, z1, pitch, width, sides="SN", proud=0.1, margin=2.0, colour=GLASS):
    for side in sides:
        length = 2 * (hx if side in "SN" else hy) - 2 * margin
        n = max(1, int(length / pitch))
        step = length / n
        for i in range(n):
            u = -length / 2 + step * (i + 0.5)
            s.panel(side, hx, hy, u - width / 2, u + width / 2, z0, z1, colour, proud)


def courses_texture(size=512, rows=8):
    """A grey tiling map: staggered blocks in courses, darker joints, a little grain and vertical rain streaks."""
    rng = np.random.default_rng(1207)
    img = np.ones((size, size))
    rh = size // rows
    bw = size // 4
    for r in range(rows):
        shift = (bw // 2) * (r % 2) + int(rng.integers(0, bw // 4))
        for b in range(4):
            x0 = (b * bw + shift) % size
            tone = 0.88 + 0.12 * rng.random()
            cols = np.arange(x0, x0 + bw) % size
            img[r * rh:(r + 1) * rh, cols] = tone
            img[r * rh:(r + 1) * rh, cols[:3]] = 0.55
        img[r * rh:r * rh + 3, :] = 0.55
    streaks = 0.86 + 0.14 * np.clip(np.convolve(np.tile(rng.random(size), 3), np.ones(9) / 9, mode="same")[size:2 * size] * 1.6, 0, 1)
    img = img * streaks[None, :] * (0.98 + 0.04 * rng.random((size, size)))
    rgba = np.stack([img, img, img, np.ones_like(img)], axis=2).astype(np.float32)
    im = bpy.data.images.new("city_courses", size, size, alpha=False)
    im.colorspace_settings.name = "sRGB"
    im.pixels.foreach_set(rgba.ravel())
    im.pack()
    return im


def city_material(textured=True):
    """The one material of the city: COLOR_0 times the courses map. `textured=False` leaves the map out of the file (the
    props are drawn with the buildings' material, so their file carries no second copy of it); the UVs are the same."""
    CITY = bpy.data.materials.new("M_city")
    CITY.use_nodes = True
    CITY.use_backface_culling = True
    bsdf = CITY.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Roughness"].default_value = 0.85
    bsdf.inputs["Metallic"].default_value = 0.0
    # base colour = COLOR_0 x the courses map (the exporter writes the texture and COLOR_0; glTF multiplies them)
    tex = CITY.node_tree.nodes.new("ShaderNodeTexImage")
    tex.image = courses_texture() if textured else None
    uvn = CITY.node_tree.nodes.new("ShaderNodeUVMap")
    uvn.uv_map = "UV0"
    CITY.node_tree.links.new(uvn.outputs["UV"], tex.inputs["Vector"])
    attr = CITY.node_tree.nodes.new("ShaderNodeVertexColor")
    attr.layer_name = "Color"
    mix = CITY.node_tree.nodes.new("ShaderNodeMix")
    mix.data_type = "RGBA"
    mix.blend_type = "MULTIPLY"
    mix.inputs["Factor"].default_value = 1.0
    CITY.node_tree.links.new(tex.outputs["Color"], mix.inputs["A"])
    CITY.node_tree.links.new(attr.outputs["Color"], mix.inputs["B"])
    CITY.node_tree.links.new(mix.outputs["Result"], bsdf.inputs["Base Color"])
    return CITY


def finished(shell, name, material, limit):
    """The shell as an object, checked: no zero-area face, standing on the ground, within its triangle limit."""
    ob = shell.object(name, material)
    tris = K.triangles(ob)
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    if any(f.calc_area() < 1e-9 for f in bm.faces):
        raise RuntimeError(f"{ob.name}: zero-area faces")
    low = min(v.co.z for v in bm.verts)
    bm.free()
    if abs(low) > 1e-6:
        raise RuntimeError(f"{ob.name}: does not stand on the ground ({low:.3f})")
    if tris > limit:
        raise RuntimeError(f"{ob.name}: {tris} triangles is over the limit of {limit}")
    size = [max(v.co[i] for v in ob.data.vertices) - min(v.co[i] for v in ob.data.vertices) for i in range(3)]
    print(f"{ob.name}: {tris} triangles, {size[0]:.1f} x {size[1]:.1f} x {size[2]:.1f} m")
    return ob
