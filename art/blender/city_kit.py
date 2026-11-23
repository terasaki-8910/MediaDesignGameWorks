"""Shared by the background city's scripts (gen_city.py, gen_cityprops.py): the palette, the facade atlas, the
face-by-face mesh builder with a colour per face in COLOR_0, and the one material everything shares, so that the game
can draw buildings and props from both files as one batch.

The atlas (512 px, made here) is a stack of horizontal strips. Each strip tiles along U over the whole width (four
window bays of 2.9 m), so a storey of a facade is one quad with U running over its bays and V over the strip: ground
floor arcade, plain floor, balcony floor, mansard with dormers, ashlar courses, slate, the pier-and-slot bay of the Art
Deco fronts, and a white strip for faces that are a plain colour. Windows are drawn recessed (a shaded reveal, a stone
surround, a sill with its rain streak); the limestone and the blue-grey slate are in the atlas, COLOR_0 only tints.
"""
import math

import bpy
import bmesh
import numpy as np

import fc_kit as K

WHITE = (1.0, 1.0, 1.0)
# tints of the atlas's limestone (linear factors): two shades of a front, the plinth, the Art Deco stone
WALL = (1.0, 1.0, 1.0)
WALL_B = (0.9, 0.9, 0.9)
BASE = (0.78, 0.78, 0.78)
DECO = (0.92, 0.93, 0.95)
DECO_B = (0.74, 0.75, 0.77)
# plain colours (on the white strip)
TRIM = K.srgb("#BDB4A3")
GLASS = K.srgb("#2B333C")
SLATE = (1.0, 1.0, 1.0)  # the slate strip as painted
ZINC = K.srgb("#8E9AA3")
LEAD = K.srgb("#6F7F86")
RAIL = K.srgb("#2A2927")
BRICK = K.srgb("#7C6659")
GILT = K.srgb("#A08D52")
LEAF = K.srgb("#6F8257")
LEAF_B = K.srgb("#4C5C3C")
LEAF_C = K.srgb("#7F8B5C")
BARK = K.srgb("#6B6457")
WATER = K.srgb("#6E8A90")
TANK = K.srgb("#6B5A4B")
SKYLIGHT = K.srgb("#56696F")

SIZE = 512
BAY = 2.9  # metres one window bay takes
TILE = 4 * BAY  # metres the atlas covers along U
# the strips: name -> (first row, rows), rows counted from the bottom of the image (v = 0)
STRIPS = {"flat": (0, 16), "ashlar": (16, 64), "slot": (80, 16), "ground": (96, 112), "floor": (208, 80), "balcony": (288, 80),
          "mansard": (368, 88), "slate": (456, 56)}
FLAT_UV = (0.5, 8.0 / SIZE)
STOREY = 3.1  # metres a floor strip stands for; the ground floor is taller
GROUND_FLOOR = 4.6


def strip_v(name):
    """The V range of a strip, a little inside its rows so the neighbours do not bleed in."""
    v0, h = STRIPS[name]
    return (v0 + 0.75) / SIZE, (v0 + h - 0.75) / SIZE


# outward normal and the direction that runs to the right when the wall is seen from outside
FACES = {"S": ((0, -1), (1, 0)), "N": ((0, 1), (-1, 0)), "E": ((1, 0), (0, 1)), "W": ((-1, 0), (0, -1))}


class Shell:
    """Faces with a colour each, wound counter-clockwise seen from outside. Nothing is merged or smoothed."""

    def __init__(self):
        self.bm = bmesh.new()
        self.col = self.bm.loops.layers.color.new("Color")
        self.uv = self.bm.loops.layers.uv.new("UV0")
        self.o = (0.0, 0.0)

    def face(self, pts, colour, colours=None, uvs=None):
        """`colours` gives one colour per corner instead (the streak under the eaves); without `uvs` the face is a plain colour."""
        f = self.bm.faces.new([self.bm.verts.new((p[0] + self.o[0], p[1] + self.o[1], p[2])) for p in pts])
        f.normal_update()
        for k, loop in enumerate(f.loops):
            loop[self.col] = (*(colours[k] if colours else colour), 1.0)
            loop[self.uv].uv = uvs[k] if uvs else FLAT_UV

    def wall(self, p0, p1, z0, z1, strip, tint=WALL, bays=None, foot=None, u0=0.0):
        """An upright quad from p0 to p1 (left to right seen from outside) showing one strip: `bays` window bays, or the
        strip at its own scale. `foot` darkens the lower edge."""
        length = math.hypot(p1[0] - p0[0], p1[1] - p0[1])
        u1 = u0 + (bays / 4.0 if bays else length / TILE)
        v0, v1 = strip_v(strip)
        low = tint if foot is None else tuple(c * foot for c in tint)
        self.face([(p0[0], p0[1], z0), (p1[0], p1[1], z0), (p1[0], p1[1], z1), (p0[0], p0[1], z1)], tint, [low, low, tint, tint],
                  [(u0, v0), (u1, v0), (u1, v1), (u0, v1)])

    def storeys(self, hx, hy, z0, plan, tint=WALL, sides="SNEW", foot=None):
        """The walls of a box as storeys: `plan` is a list of (strip, height); every storey is one quad a side, its bays
        fitted to the side's length. Returns the height reached."""
        corners = {"S": ((-hx, -hy), (hx, -hy)), "E": ((hx, -hy), (hx, hy)), "N": ((hx, hy), (-hx, hy)), "W": ((-hx, hy), (-hx, -hy))}
        z = z0
        for k, (strip, h) in enumerate(plan):
            for side in sides:
                p0, p1 = corners[side]
                bays = max(1, round(math.hypot(p1[0] - p0[0], p1[1] - p0[1]) / BAY))
                self.wall(p0, p1, z, z + h, strip, tint, bays if strip not in ("ashlar", "slate") else None, foot if k == 0 else None)
            z += h
        return z

    def box(self, lo, hi, colour, top=None, bottom=False, foot=None, strip=None):
        """`strip` shows that strip on the walls in bands (ashlar courses on a tower); `foot` darkens the walls towards their
        lower edge (the street's shade at the foot of a building)."""
        (x0, y0, z0), (x1, y1, z1) = lo, hi
        if strip:
            n = max(1, round((z1 - z0) / STOREY))
            for k in range(n):
                a, b = z0 + (z1 - z0) * k / n, z0 + (z1 - z0) * (k + 1) / n
                f = foot if k == 0 else None
                self.wall((x0, y0), (x1, y0), a, b, strip, colour, foot=f)
                self.wall((x1, y1), (x0, y1), a, b, strip, colour, foot=f)
                self.wall((x1, y0), (x1, y1), a, b, strip, colour, foot=f)
                self.wall((x0, y1), (x0, y0), a, b, strip, colour, foot=f)
        else:
            cs = None if foot is None else [tuple(v * foot for v in colour)] * 2 + [colour] * 2
            self.face([(x0, y0, z0), (x1, y0, z0), (x1, y0, z1), (x0, y0, z1)], colour, cs)
            self.face([(x1, y1, z0), (x0, y1, z0), (x0, y1, z1), (x1, y1, z1)], colour, cs)
            self.face([(x1, y0, z0), (x1, y1, z0), (x1, y1, z1), (x1, y0, z1)], colour, cs)
            self.face([(x0, y1, z0), (x0, y0, z0), (x0, y0, z1), (x0, y1, z1)], colour, cs)
        self.face([(x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1)], top or (TRIM if strip else colour))
        if bottom:
            self.face([(x0, y1, z0), (x1, y1, z0), (x1, y0, z0), (x0, y0, z0)], colour)

    def slope(self, pts, colour, strip="slate"):
        """A roof plane: its first edge is the eaves. U runs along the eaves at the atlas's scale, V up the slope."""
        if strip is None:
            self.face(pts, colour)
            return
        ax, ay = pts[1][0] - pts[0][0], pts[1][1] - pts[0][1]
        al = math.hypot(ax, ay) or 1.0
        v0, v1 = strip_v(strip)
        us = [((p[0] - pts[0][0]) * ax + (p[1] - pts[0][1]) * ay) / al / TILE for p in pts]
        hs = [math.hypot(p[2] - pts[0][2], ((p[0] - pts[0][0]) * -ay + (p[1] - pts[0][1]) * ax) / al) for p in pts]
        top = max(hs) or 1.0
        self.face(pts, colour, None, [(u, v0 + (v1 - v0) * h / top) for u, h in zip(us, hs)])

    def frustum(self, hx0, hy0, z0, hx1, hy1, z1, colour, top=None, c=(0.0, 0.0), strip=None):
        a = [(c[0] + sx * hx0, c[1] + sy * hy0, z0) for sx, sy in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
        b = [(c[0] + sx * hx1, c[1] + sy * hy1, z1) for sx, sy in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
        for i in range(4):
            j = (i + 1) % 4
            if hx1 < 1e-6 and hy1 < 1e-6:
                self.slope([a[i], a[j], b[i]], colour, strip)
            else:
                self.slope([a[i], a[j], b[j], b[i]], colour, strip)
        if hx1 > 1e-6 or hy1 > 1e-6:
            self.face(b, top or colour)

    def mansard(self, hx, hy, z0, inset, h, colour=SLATE, top=ZINC, drawn=False):
        """A mansard slope round a box: the slate strip, or (far model) the strip with its dormers drawn, a bay each."""
        a = [(sx * hx, sy * hy, z0) for sx, sy in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
        b = [(sx * (hx - inset), sy * (hy - inset), z0 + h) for sx, sy in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
        v0, v1 = strip_v("mansard" if drawn else "slate")
        for i in range(4):
            j = (i + 1) % 4
            length = math.hypot(a[j][0] - a[i][0], a[j][1] - a[i][1])
            n = max(1, round(length / BAY)) / 4.0 if drawn else length / TILE
            k = inset / length * n
            self.face([a[i], a[j], b[j], b[i]], colour, None, [(0.0, v0), (n, v0), (n - k, v1), (k, v1)])
        self.face(b, top)

    def hip(self, hx, hy, z0, z1, colour, c=(0.0, 0.0), strip=None):
        """A hipped roof over a rectangle: two long slopes and two hips rising to a ridge along the longer side."""
        a = [(c[0] - hx, c[1] - hy, z0), (c[0] + hx, c[1] - hy, z0), (c[0] + hx, c[1] + hy, z0), (c[0] - hx, c[1] + hy, z0)]
        if hx >= hy:
            r = hx - hy
            r0, r1 = (c[0] - r, c[1], z1), (c[0] + r, c[1], z1)
            if r < 1e-6:
                for i in range(4):
                    self.slope([a[i], a[(i + 1) % 4], r0], colour, strip)
                return
            self.slope([a[0], a[1], r1, r0], colour, strip)
            self.slope([a[1], a[2], r1], colour, strip)
            self.slope([a[2], a[3], r0, r1], colour, strip)
            self.slope([a[3], a[0], r0], colour, strip)
        else:
            r = hy - hx
            r0, r1 = (c[0], c[1] - r, z1), (c[0], c[1] + r, z1)
            self.slope([a[0], a[1], r0], colour, strip)
            self.slope([a[1], a[2], r1, r0], colour, strip)
            self.slope([a[2], a[3], r1], colour, strip)
            self.slope([a[3], a[0], r0, r1], colour, strip)

    def crown(self, c, r, z0, h, colour, under, seg=6, lean=(0.0, 0.0)):
        """One mass of a tree's canopy: a squat faceted lump, lighter above than below."""
        zs = [(0.0, 0.5), (0.34, 1.0), (0.72, 0.8), (1.0, 0.0)]
        for k in range(3):
            (t0, s0), (t1, s1) = zs[k], zs[k + 1]
            c0 = (c[0] + lean[0] * t0, c[1] + lean[1] * t0)
            c1 = (c[0] + lean[0] * t1, c[1] + lean[1] * t1)
            self.cylinder(c0, r * s0, z0 + h * t0, z0 + h * t1, under if k == 0 else colour, seg, r1=r * s1, c1=c1)

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
        self.box((x0, y0, z0), (x1, y1, z0 + wall), TRIM, top=K.srgb("#8C8474"))
        mx = (x0 + x1) / 2
        for a, b in ((x0 + 0.8, mx - 0.7), (mx + 0.7, x1 - 0.8)):
            self.box((a, y0 + 0.8, z0 + wall), (b, y1 - 0.8, z0 + wall + 0.9), LEAF_B, top=LEAF)

    def cylinder(self, c, r, z0, z1, colour, seg=12, top=None, r1=None, alt=None, strip=None, c1=None):
        r1 = r if r1 is None else r1
        c1 = c if c1 is None else c1
        v0, v1 = strip_v(strip) if strip else (0.0, 0.0)
        for i in range(seg):
            a0, a1 = 2 * math.pi * i / seg, 2 * math.pi * (i + 1) / seg
            p0 = (c[0] + r * math.cos(a0), c[1] + r * math.sin(a0), z0)
            p1 = (c[0] + r * math.cos(a1), c[1] + r * math.sin(a1), z0)
            q0 = (c1[0] + r1 * math.cos(a0), c1[1] + r1 * math.sin(a0), z1)
            q1 = (c1[0] + r1 * math.cos(a1), c1[1] + r1 * math.sin(a1), z1)
            shade = alt if (alt and i % 2) else colour
            ua, ub = r * a0 / TILE, r * a1 / TILE
            if r1 < 1e-6:
                self.face([p0, p1, q0], shade, None, [(ua, v0), (ub, v0), ((ua + ub) / 2, v1)] if strip else None)
            else:
                self.face([p0, p1, q1, q0], shade, None, [(ua, v0), (ub, v0), (ub, v1), (ua, v1)] if strip else None)
        if r1 > 1e-6:
            self.face([(c1[0] + r1 * math.cos(2 * math.pi * i / seg), c1[1] + r1 * math.sin(2 * math.pi * i / seg), z1) for i in range(seg)], top or colour)

    def dome(self, c, r, z0, h, colour, seg=14, rings=5, alt=None, strip=None):
        for k in range(rings):
            t0, t1 = (math.pi / 2) * k / rings, (math.pi / 2) * (k + 1) / rings
            self.cylinder(c, r * math.cos(t0), z0 + h * math.sin(t0), z0 + h * math.sin(t1), colour, seg, r1=r * math.cos(t1) if k < rings - 1 else 0.0, alt=alt,
                          strip=strip)

    def panel(self, side, hx, hy, u0, u1, z0, z1, colour, proud=0.08):
        """A flat face on a wall of a box with half-sizes hx, hy: from u0 to u1 along the wall (0 = its middle)."""
        (nx, ny), (rx, ry) = FACES[side]
        d = (hx if nx else hy) + proud
        p = lambda u, z: (nx * d + rx * u, ny * d + ry * u, z)  # noqa: E731
        self.face([p(u0, z0), p(u1, z0), p(u1, z1), p(u0, z1)], colour)

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


def slots(s, hx, hy, z0, z1, tint=DECO, sides="SN", margin=1.0, proud=0.12):
    """Tall window slots between piers (the Art Deco fronts): the slot strip on a panel just proud of the wall."""
    v0, v1 = strip_v("slot")
    for side in sides:
        (nx, ny), (rx, ry) = FACES[side]
        half = (hx if side in "SN" else hy) - margin
        d = (hx if nx else hy) + proud
        n = max(1, round(2 * half / 3.4))
        p = lambda u, z: (nx * d + rx * u, ny * d + ry * u, z)  # noqa: E731
        s.face([p(-half, z0), p(half, z0), p(half, z1), p(-half, z1)], tint, None, [(0.0, v0), (n / 4.0, v0), (n / 4.0, v1), (0.0, v1)])


def atlas():
    """The facade atlas as an sRGB array [row from the bottom, column, rgb]."""
    rng = np.random.default_rng(1207)
    img = np.zeros((SIZE, SIZE, 3))
    stone = np.array([0.665, 0.628, 0.560])
    slate = np.array([0.285, 0.335, 0.405])
    glass = np.array([0.215, 0.245, 0.285])  # pale: a window is a soft dark, never a hole, so the fronts stay quiet behind the play area
    iron = np.array([0.130, 0.130, 0.140])
    bay = SIZE // 4
    grain = lambda h: 1.0 + 0.035 * (rng.random((h, SIZE, 1)) - 0.5)  # noqa: E731

    def tile_noise(h, scale):
        """Soft tiling value noise over a strip: weathering, in +-1."""
        n = rng.random((-(-h // scale), SIZE // scale))
        n = np.kron(n, np.ones((scale, scale)))[:h]
        k = np.ones(scale) / scale
        n = np.apply_along_axis(lambda r: np.convolve(np.concatenate([r, r, r]), k, mode="same")[SIZE:2 * SIZE], 1, n)
        return (n - n.mean())[:, :, None] * 2.0

    def courses(a, rows, blocks, depth=0.8):
        """Ashlar in a strip: staggered blocks, each its own shade, joints a little darker."""
        h = a.shape[0]
        rh = h / rows
        bw = SIZE // blocks
        for r in range(rows):
            y0, y1 = int(round(r * rh)), int(round((r + 1) * rh))
            shift = (bw // 2) * (r % 2) + int(rng.integers(0, bw // 5))
            for b in range(blocks):
                cols = np.arange(b * bw + shift, (b + 1) * bw + shift) % SIZE
                a[y0:y1, cols] *= 0.955 + 0.09 * rng.random()
                a[y0:y1, cols[:1]] *= depth
            a[y0:y0 + 1] *= depth

    def window(a, x0, x1, y0, y1, arch=False, shutters=False):
        """A recessed window: stone surround, shaded reveal at the top and left, glass that lightens upwards, glazing bars."""
        a[max(y0 - 3, 0):y1 + 3, x0 - 3:x1 + 3] = stone * 1.07
        ys, xs = np.mgrid[y0:y1, x0:x1]
        t = ((ys - y0) / max(y1 - y0, 1))[:, :, None]
        pane = glass * (0.85 + 0.5 * t) + np.array([0.0, 0.01, 0.03]) * t
        if shutters:
            pane = np.array([0.52, 0.55, 0.56]) * (0.9 + 0.1 * ((xs // 2) % 2))[:, :, None]
        inside = np.ones((y1 - y0, x1 - x0), bool)
        if arch:
            r = (x1 - x0) / 2
            cy = y1 - r
            inside = (ys < cy) | ((xs - (x0 + x1 - 1) / 2) ** 2 + (ys - cy) ** 2 < r * r)
        region = a[y0:y1, x0:x1]
        region[inside] = pane[inside]
        if not shutters:
            mid = (x0 + x1) // 2
            a[y0:y1, mid:mid + 1] = np.where(inside[:, mid - x0:mid - x0 + 1, None], 0.56, a[y0:y1, mid:mid + 1])
            a[y0 + (y1 - y0) * 2 // 3:y0 + (y1 - y0) * 2 // 3 + 1, x0:x1] = np.where(inside[(y1 - y0) * 2 // 3:(y1 - y0) * 2 // 3 + 1, :, None], 0.5,
                                                                                     a[y0 + (y1 - y0) * 2 // 3:y0 + (y1 - y0) * 2 // 3 + 1, x0:x1])
        # the reveal's shade: the top four rows and the left three columns of the opening
        shade = np.ones((y1 - y0, x1 - x0, 1))
        shade[-4:] = 0.5
        shade[:, :3] = np.minimum(shade[:, :3], 0.62)
        region[inside] = (region * shade)[inside]

    def streak(a, x0, x1, y1, depth, strength=0.16):
        """Rain under a sill or a cornice: darker just below it, fading downwards."""
        y0 = max(0, y1 - depth)
        t = np.linspace(0.0, 1.0, y1 - y0)[:, None, None]
        cols = (0.6 + 0.4 * rng.random(x1 - x0))[None, :, None]
        a[y0:y1, x0:x1] *= 1.0 - strength * t * cols

    def strip(name):
        v0, h = STRIPS[name]
        return img[v0:v0 + h], h

    a, h = strip("flat")
    a[:] = 1.0

    a, h = strip("ashlar")
    a[:] = stone * (1.0 + 0.05 * tile_noise(h, 32)) * grain(h)
    courses(a, 5, 8)
    streak(a, 0, SIZE, h, 14, 0.08)

    a, h = strip("slot")
    a[:] = stone
    for b in range(4):
        x = b * bay
        a[:, x + 38:x + 90] = glass * 1.15
        a[:, x + 38:x + 42] = glass * 0.6
        a[:, x + 63:x + 65] = stone * 0.7
        a[:, x + 30:x + 38] = stone * 1.08
        a[:, x + 90:x + 98] = stone * 0.86

    a, h = strip("ground")
    a[:] = stone * 0.9 * (1.0 + 0.05 * tile_noise(h, 32)) * grain(h)
    for y in range(0, h - 12, 14):  # rusticated courses
        a[y:y + 2] *= 0.74
    a[:10] *= 0.86  # the plinth
    for b in range(4):
        x = b * bay
        window(a, x + 24, x + 104, 4 if b % 2 else 12, 88, arch=True)
        if b == 1:
            a[4:60, x + 30:x + 98] = np.array([0.21, 0.19, 0.17])  # a door of dark wood
            a[4:60, x + 63:x + 65] = 0.1
    a[h - 10:] = stone * 1.08  # the string course over the ground floor
    a[h - 12:h - 10] = stone * 0.55

    a, h = strip("floor")
    a[:] = stone * (1.0 + 0.05 * tile_noise(h, 32)) * grain(h)
    courses(a, 5, 8, depth=0.88)
    for b in range(4):
        x = b * bay
        a[12:16, x + 30:x + 98] = stone * 1.1  # the sill
        streak(a, x + 34, x + 94, 12, 12)
        window(a, x + 36, x + 92, 16, 70, shutters=b == 2)
    a[:2] *= 0.8

    a, h = strip("balcony")
    a[:] = stone * (1.0 + 0.05 * tile_noise(h, 32)) * grain(h)
    courses(a, 5, 8, depth=0.88)
    for b in range(4):
        x = b * bay
        window(a, x + 36, x + 92, 6, 72)
    a[:5] = stone * 1.1  # the balcony's slab, the shade under it on the storey below
    a[:1] = stone * 0.5
    rail = a[5:27]
    bars = ((np.arange(SIZE) // 2) % 2 == 0)[None, :, None]
    rail[:] = np.where(bars, iron, rail * 0.8)
    a[26:28] = iron
    a[15:16] = iron

    a, h = strip("mansard")
    slates = np.ones((h, SIZE, 1))
    for r in range(0, h, 4):
        shift = int(rng.integers(0, 8))
        for cx in range(0, SIZE, 8):
            cols = np.arange(cx + shift, cx + shift + 8) % SIZE
            slates[r:r + 4, cols] = 0.93 + 0.14 * rng.random()
        slates[r:r + 1] *= 0.84
    a[:] = slate * slates * (1.0 + 0.06 * tile_noise(h, 32))
    for b in range(4):
        x = b * bay
        a[8:72, x + 38:x + 90] = stone * 1.04  # the dormer's stone front
        a[72:76, x + 34:x + 94] = np.array([0.50, 0.55, 0.58])  # its zinc cap
        a[8:76, x + 90:x + 94] = slate * 0.62  # its shade on the slates
        window(a, x + 46, x + 82, 18, 62)
    a[:7] = stone * 1.08  # the cornice and gutter
    a[7:9] = stone * 0.55
    a[h - 5:] = np.array([0.50, 0.55, 0.58])  # the zinc flashing at the break of the roof

    a, h = strip("slate")
    slates = np.ones((h, SIZE, 1))
    for r in range(0, h, 4):
        shift = int(rng.integers(0, 8))
        for cx in range(0, SIZE, 8):
            cols = np.arange(cx + shift, cx + shift + 8) % SIZE
            slates[r:r + 4, cols] = 0.93 + 0.14 * rng.random()
        slates[r:r + 1] *= 0.84
    a[:] = slate * slates * (1.0 + 0.07 * tile_noise(h, 32))
    return np.clip(img, 0.0, 1.0)


def atlas_image():
    img = atlas()
    rgba = np.concatenate([img, np.ones((SIZE, SIZE, 1))], axis=2).astype(np.float32)
    im = bpy.data.images.new("city_atlas", SIZE, SIZE, alpha=False)
    im.colorspace_settings.name = "sRGB"
    im.pixels.foreach_set(rgba.ravel())
    im.pack()
    return im


def city_material(textured=True):
    """The one material of the city: COLOR_0 times the atlas. `textured=False` leaves the map out of the file (the
    props are drawn with the buildings' material, so their file carries no second copy of it); the UVs are the same."""
    CITY = bpy.data.materials.new("M_city")
    CITY.use_nodes = True
    CITY.use_backface_culling = True
    bsdf = CITY.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Roughness"].default_value = 0.85
    bsdf.inputs["Metallic"].default_value = 0.0
    # base colour = COLOR_0 x the atlas (the exporter writes the texture and COLOR_0; glTF multiplies them)
    tex = CITY.node_tree.nodes.new("ShaderNodeTexImage")
    tex.image = atlas_image() if textured else None
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
    xs = [[v.co[i] for v in ob.data.vertices] for i in range(3)]
    size = [max(x) - min(x) for x in xs]
    centre = [(max(x) + min(x)) / 2 for x in xs]
    print(f"MODEL {ob.name}: tris {tris}, size {size[0]:.1f} x {size[1]:.1f} x {size[2]:.1f} m, centre {centre[0]:.2f} {centre[1]:.2f}")
    return ob
