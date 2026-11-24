"""Shared by the background city's scripts (gen_city.py, gen_cityprops.py): the palette, the facade atlas, the
face-by-face mesh builder with a colour per face in COLOR_0, and the one material everything shares, so that the game
can draw buildings and props from both files as one batch.

The atlas (512 px, made here) is a stack of horizontal strips. Each strip tiles along U over the whole width (four
window bays of 2.9 m), so a storey of a facade is one quad with U running over its bays and V over the strip: ground
floor arcade, plain floor, balcony floor, mansard with dormers, ashlar courses, zinc with standing seams, slate, the
glazing of the Art Deco fronts, and a white strip for faces that are a plain colour. Windows are drawn recessed (a shaded
reveal, a stone surround, a sill with its rain streak) with glass that is the dark of a front but no black hole; the
limestone and the grey slate (lifted towards the haze colour) are in the atlas, COLOR_0 only tints.

The far models are those quads and nothing else: the grid of windows is only where a model is far. The near models'
fronts are modelled (order, after the brief's A2): giant piers of large ashlar blocks, each block its own tone, standing
before tall bays of glazing that lie back in their shade, a stone spandrel between one tall bay and the next; fewer and
larger features than a window to every 2.9 m, and depth that catches the sun. To that they add outline (gen_city.py:
dormers, chimney stacks, cornices and balcony slabs over a line of shade, stepped crowns). Shell.facade, which gives
every window bay its reveal as geometry, is kept for a model that is seen from nearer than any is now: at 120 m and
more it only made fine stripes.
"""
import math
import random

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
TRIM = K.srgb("#C2B7A2")
GLASS = K.srgb("#646C78")  # (glass takes the sky: the dark of a front, blue-grey, never a black hole in it)
SLATE = (1.0, 1.0, 1.0)  # the slate strip as painted
ZINC = K.srgb("#69747F")  # as a plain colour; a roof of zinc sheets is the "zinc" strip as painted (WHITE)
LEAD = K.srgb("#56626F")
# the atlas's limestone as a plain colour (the reveals of the near models: they have no texture of their own)
STONE = K.srgb("#B0A48D")
RAIL = K.srgb("#4A4742")
BRICK = K.srgb("#7C6659")
GILT = K.srgb("#A08D52")
LEAF = K.srgb("#7F8475")
LEAF_B = K.srgb("#63655E")
LEAF_C = K.srgb("#868A7A")
BARK = K.srgb("#6B6457")
WATER = K.srgb("#6E8A90")
TANK = K.srgb("#6B5A4B")
SPIRE = K.srgb("#B9B0A0")  # a spire of dressed stone: it takes the light on one side and stands in shade on the other
SPIRE_B = K.srgb("#A59C8C")
SKYLIGHT = K.srgb("#51626F")
PAVED = (0.47, 0.55, 0.68)  # a terrace: the ashlar strip as grey slabs, each its own tone, never a blank lid

# the atlas's own colours (sRGB)
STONE_RGB = (0.690, 0.642, 0.552)
SLATE_RGB = (0.292, 0.342, 0.424)
ZINC_RGB = (0.410, 0.468, 0.545)
GLASS_RGB = (0.400, 0.435, 0.490)
# how far the tone of one ashlar block lies from the next, and the slate's broad weathering (the near walls' texture)
ASHLAR_SPREAD = 0.16
SLATE_SPREAD = 0.1
SLATE_BAND = 0.97
SIZE = 512
BAY = 2.9  # metres one window bay takes
TILE = 4 * BAY  # metres the atlas covers along U
# the strips: name -> (first row, rows), rows counted from the bottom of the image (v = 0)
STRIPS = {"flat": (0, 16), "ashlar": (16, 48), "zinc": (64, 16), "slot": (80, 16), "ground": (96, 112), "floor": (208, 80), "balcony": (288, 80),
          "mansard": (368, 88), "slate": (456, 56)}
FLAT_UV = (0.5, 8.0 / SIZE)
STOREY = 3.1  # metres a floor strip stands for; the ground floor is taller
GROUND_FLOOR = 4.6


def strip_v(name):
    """The V range of a strip, a little inside its rows so the neighbours do not bleed in."""
    v0, h = STRIPS[name]
    return (v0 + 0.75) / SIZE, (v0 + h - 0.75) / SIZE


# where the opening of a bay lies across it (shares of the bay's width, its stone surround included), per strip
OPENING = {"ground": (0.164, 0.836), "floor": (0.25, 0.75), "balcony": (0.25, 0.75)}


def mul(c, k):
    return tuple(v * k for v in c)


# outward normal and the direction that runs to the right when the wall is seen from outside
FACES = {"S": ((0, -1), (1, 0)), "N": ((0, 1), (-1, 0)), "E": ((1, 0), (0, 1)), "W": ((-1, 0), (0, -1))}


class Shell:
    """Faces with a colour each, wound counter-clockwise seen from outside. Nothing is merged or smoothed."""

    def __init__(self):
        self.bm = bmesh.new()
        self.col = self.bm.loops.layers.color.new("Color")
        self.uv = self.bm.loops.layers.uv.new("UV0")
        # a normal per corner where a face is part of a rounded mass (a tree's canopy); zero = the face's own
        self.nrm = self.bm.loops.layers.float_vector.new("corner_normal")
        self.o = (0.0, 0.0)

    def face(self, pts, colour, colours=None, uvs=None, normals=None):
        """`colours` gives one colour per corner instead (the streak under the eaves); without `uvs` the face is a plain
        colour; `normals` gives a normal per corner (a rounded mass shades smoothly)."""
        f = self.bm.faces.new([self.bm.verts.new((p[0] + self.o[0], p[1] + self.o[1], p[2])) for p in pts])
        f.normal_update()
        for k, loop in enumerate(f.loops):
            loop[self.col] = (*(colours[k] if colours else colour), 1.0)
            loop[self.uv].uv = uvs[k] if uvs else FLAT_UV
            loop[self.nrm] = normals[k] if normals else (0.0, 0.0, 0.0)

    def wall(self, p0, p1, z0, z1, strip, tint=WALL, bays=None, foot=None, u0=0.0):
        """An upright quad from p0 to p1 (left to right seen from outside) showing one strip: `bays` window bays, or the
        strip at its own scale. `foot` darkens the lower edge."""
        length = math.hypot(p1[0] - p0[0], p1[1] - p0[1])
        u1 = u0 + (bays / 4.0 if bays else length / TILE)
        v0, v1 = strip_v(strip)
        low = tint if foot is None else tuple(c * foot for c in tint)
        self.face([(p0[0], p0[1], z0), (p1[0], p1[1], z0), (p1[0], p1[1], z1), (p0[0], p0[1], z1)], tint, [low, low, tint, tint],
                  [(u0, v0), (u1, v0), (u1, v1), (u0, v1)])

    def quad(self, pts, colour, toward, colours=None, uvs=None):
        """A face wound so that it looks towards `toward`."""
        a, b, c = pts[0], pts[1], pts[2]
        e, f = (b[0] - a[0], b[1] - a[1], b[2] - a[2]), (c[0] - a[0], c[1] - a[1], c[2] - a[2])
        n = (e[1] * f[2] - e[2] * f[1], e[2] * f[0] - e[0] * f[2], e[0] * f[1] - e[1] * f[0])
        if n[0] * toward[0] + n[1] * toward[1] + n[2] * toward[2] < 0:
            pts, colours, uvs = pts[::-1], colours[::-1] if colours else None, uvs[::-1] if uvs else None
        self.face(pts, colour, colours, uvs)

    def facade(self, p0, p1, z0, plan, tint=WALL, rnd=None, depth=0.38, foot=None, bays=None):
        """A wall with relief from p0 to p1 (left to right seen from outside): per storey of `plan` ((strip, height)) the
        piers stand in the wall's plane and every window bay stands `depth` back between them, with its jambs, its sill and
        its soffit. Each pier has its own tone (the stone, course by course), some a rain streak from the course above; the
        bays lie in their own shade. Returns the height reached."""
        rnd = rnd or random.Random(7)
        length = math.hypot(p1[0] - p0[0], p1[1] - p0[1])
        t = ((p1[0] - p0[0]) / length, (p1[1] - p0[1]) / length)
        n = (t[1], -t[0])
        count = bays or max(1, round(length / BAY))
        bw = length / count
        at = lambda x, d, z: (p0[0] + t[0] * x - n[0] * d, p0[1] + t[1] * x - n[1] * d, z)  # noqa: E731
        z = z0
        runs = []  # (opening, from, to): storeys above each other whose bays open alike share their jambs
        for k, (strip, h) in enumerate(plan):
            v0, v1 = strip_v(strip)
            low = foot if (foot is not None and k == 0) else 1.0
            opening = OPENING.get(strip)
            if opening is None:
                self.wall(p0, p1, z, z + h, strip, tint, None, foot if k == 0 else None)
                z += h
                continue
            f0, f1 = opening
            edges = [0.0]
            for i in range(count):
                edges += [(i + f0) * bw, (i + f1) * bw]
            edges.append(length)
            for j in range(0, len(edges), 2):  # the piers
                xa, xb = edges[j], edges[j + 1]
                c = mul(tint, 0.93 + 0.14 * rnd.random())
                top = mul(c, 0.8) if rnd.random() < 0.3 else c
                bottom = mul(c, low)
                self.face([at(xa, 0, z), at(xb, 0, z), at(xb, 0, z + h), at(xa, 0, z + h)], c, [bottom, bottom, top, top],
                          [(xa / bw / 4, v0), (xb / bw / 4, v0), (xb / bw / 4, v1), (xa / bw / 4, v1)])
            for i in range(count):  # the bays
                xa, xb = edges[2 * i + 1], edges[2 * i + 2]
                c = mul(tint, 0.84 * (0.94 + 0.12 * rnd.random()))
                bottom = mul(c, low)
                top = mul(c, 0.86)
                self.face([at(xa, depth, z), at(xb, depth, z), at(xb, depth, z + h), at(xa, depth, z + h)], c, [bottom, bottom, top, top],
                          [(xa / bw / 4, v0), (xb / bw / 4, v0), (xb / bw / 4, v1), (xa / bw / 4, v1)])
            if runs and runs[-1][0] == opening and abs(runs[-1][2] - z) < 1e-6:
                runs[-1] = (opening, runs[-1][1], z + h)
            else:
                runs.append((opening, z, z + h))
            z += h
        stone = tuple(a * b for a, b in zip(STONE, tint))
        for (f0, f1), za, zb in runs:
            grounded = za <= z0 + 1e-6 and foot is not None
            for i in range(count):
                xa, xb = (i + f0) * bw, (i + f1) * bw
                a, b = mul(stone, 0.66), mul(stone, 0.88)
                la, lb = (mul(a, foot), mul(b, foot)) if grounded else (a, b)
                self.quad([at(xa, 0, za), at(xa, depth, za), at(xa, depth, zb), at(xa, 0, zb)], a, (t[0], t[1], 0.0), [la, la, a, a])
                self.quad([at(xb, 0, za), at(xb, depth, za), at(xb, depth, zb), at(xb, 0, zb)], b, (-t[0], -t[1], 0.0), [lb, lb, b, b])
                self.quad([at(xa, 0, zb), at(xb, 0, zb), at(xb, depth, zb), at(xa, depth, zb)], mul(stone, 0.5), (0.0, 0.0, -1.0))
                if za > 1e-6:
                    self.quad([at(xa, 0, za), at(xb, 0, za), at(xb, depth, za), at(xa, depth, za)], mul(stone, 1.05), (0.0, 0.0, 1.0))
        return z

    def ring(self, hx, hy, z0, z1, colour, top=None, c=(0.0, 0.0)):
        """A band round a box with half-sizes hx, hy (a string course, a cornice's bed mould): its sides, top and underside."""
        self.box((c[0] - hx, c[1] - hy, z0), (c[0] + hx, c[1] + hy, z1), colour, top=top or colour, bottom=True)

    def rail(self, hx, hy, z0, h=1.0, thick=0.09):
        """An iron balcony rail round a box, standing on a slab's edge: four thin walls showing the atlas's rail."""
        v0, v1 = (STRIPS["balcony"][0] + 6.5) / SIZE, (STRIPS["balcony"][0] + 26.0) / SIZE
        for (ax, ay), (bx, by) in (((-hx, -hy), (hx, -hy)), ((hx, -hy), (hx, hy)), ((hx, hy), (-hx, hy)), ((-hx, hy), (-hx, -hy))):
            length = math.hypot(bx - ax, by - ay)
            t = ((bx - ax) / length, (by - ay) / length)
            n = (t[1], -t[0])
            uvs = [(0.0, v0), (length / TILE, v0), (length / TILE, v1), (0.0, v1)]
            outer = [(ax, ay, z0), (bx, by, z0), (bx, by, z0 + h), (ax, ay, z0 + h)]
            inner = [(q[0] - n[0] * thick, q[1] - n[1] * thick, q[2]) for q in outer]
            self.quad(outer, WHITE, (n[0], n[1], 0.0), None, uvs)
            self.quad(inner, mul(WHITE, 0.7), (-n[0], -n[1], 0.0), None, uvs)
            self.quad([outer[3], outer[2], inner[2], inner[3]], RAIL, (0.0, 0.0, 1.0))

    def storeys(self, hx, hy, z0, plan, tint=WALL, sides="SNEW", foot=None, relief=None):
        """The walls of a box as storeys: `plan` is a list of (strip, height); every storey is one quad a side, its bays
        fitted to the side's length. Returns the height reached."""
        corners = {"S": ((-hx, -hy), (hx, -hy)), "E": ((hx, -hy), (hx, hy)), "N": ((hx, hy), (-hx, hy)), "W": ((-hx, hy), (-hx, -hy))}
        if relief is not None:  # the near model: every side with its bays standing back (facade)
            z = z0
            for side in sides:
                z = self.facade(corners[side][0], corners[side][1], z0, plan, tint, relief, foot=foot)
            return z
        z = z0
        for k, (strip, h) in enumerate(plan):
            for side in sides:
                p0, p1 = corners[side]
                bays = max(1, round(math.hypot(p1[0] - p0[0], p1[1] - p0[1]) / BAY))
                self.wall(p0, p1, z, z + h, strip, tint, bays if strip not in ("ashlar", "slate") else None, foot if k == 0 else None)
            z += h
        return z

    def box(self, lo, hi, colour, top=None, bottom=False, foot=None, strip=None, paved=False, walls="SNEW"):
        """`strip` shows that strip on the walls in bands (ashlar courses on a tower); `foot` darkens the walls towards their
        lower edge (the street's shade at the foot of a building); `paved` lays the ashlar strip on the top as slabs (a
        terrace is never a blank lid)."""
        (x0, y0, z0), (x1, y1, z1) = lo, hi
        if strip:
            n = max(1, round((z1 - z0) / STOREY))
            for k in range(n):
                a, b = z0 + (z1 - z0) * k / n, z0 + (z1 - z0) * (k + 1) / n
                f = foot if k == 0 else None
                if "S" in walls:
                    self.wall((x0, y0), (x1, y0), a, b, strip, colour, foot=f)
                if "N" in walls:
                    self.wall((x1, y1), (x0, y1), a, b, strip, colour, foot=f)
                if "E" in walls:
                    self.wall((x1, y0), (x1, y1), a, b, strip, colour, foot=f)
                if "W" in walls:
                    self.wall((x0, y1), (x0, y0), a, b, strip, colour, foot=f)
        else:
            cs = None if foot is None else [tuple(v * foot for v in colour)] * 2 + [colour] * 2
            self.face([(x0, y0, z0), (x1, y0, z0), (x1, y0, z1), (x0, y0, z1)], colour, cs)
            self.face([(x1, y1, z0), (x0, y1, z0), (x0, y1, z1), (x1, y1, z1)], colour, cs)
            self.face([(x1, y0, z0), (x1, y1, z0), (x1, y1, z1), (x1, y0, z1)], colour, cs)
            self.face([(x0, y1, z0), (x0, y0, z0), (x0, y0, z1), (x0, y1, z1)], colour, cs)
        if paved:
            # slabs of about 0.7 m: the ashlar strip at half its scale, band after band across the depth, each band its own tone
            v0, v1 = strip_v("ashlar")
            n = max(1, round((y1 - y0) / 2.9))
            tone = top or TRIM
            for k in range(n):
                a, b = y0 + (y1 - y0) * k / n, y0 + (y1 - y0) * (k + 1) / n
                shift = 0.37 * k
                c = mul(tone, 0.9 + 0.2 * ((k * 7 + int(abs(x0) * 3)) % 5) / 4.0)
                self.face([(x0, a, z1), (x1, a, z1), (x1, b, z1), (x0, b, z1)], c, None,
                          [(shift + 2 * x0 / TILE, v0), (shift + 2 * x1 / TILE, v0), (shift + 2 * x1 / TILE, v1), (shift + 2 * x0 / TILE, v1)])
        else:
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

    def crown(self, c, r, z0, h, colour, under, seg=7, lean=(0.0, 0.0), turn=0.0, lump=0.0):
        """One mass of a tree's canopy: a rounded lump, shaded smoothly (a normal per corner, leaning upwards so the mass
        takes the light as one soft form), dark underneath and lighter towards its top. `lump` pushes every other rib in
        and out, `turn` turns the mass, so no two masses show the same outline."""
        zs = [(0.0, 0.42), (0.3, 0.98), (0.66, 0.86), (1.0, 0.0)]
        mid = z0 + h * 0.42

        def ring(t, s):
            pts = []
            for i in range(seg):
                a = turn + 2 * math.pi * i / seg
                rr = r * s * (1.0 + lump * (1 if i % 2 else -1))
                pts.append((c[0] + lean[0] * t + rr * math.cos(a), c[1] + lean[1] * t + rr * math.sin(a), z0 + h * t))
            return pts

        def normal(p):
            n = (p[0] - c[0], p[1] - c[1], (p[2] - mid) * (r / (h * 0.6)) + 0.85 * r)
            l = math.sqrt(n[0] ** 2 + n[1] ** 2 + n[2] ** 2) or 1.0
            return (n[0] / l, n[1] / l, n[2] / l)

        def shade(p):
            t = min(1.0, max(0.0, (p[2] - z0) / h))
            k = 0.74 + 0.4 * t
            base = under if t < 0.05 else colour
            return tuple(min(1.0, v * k) for v in base)

        rings = [ring(t, s) for t, s in zs[:3]]
        apex = (c[0] + lean[0], c[1] + lean[1], z0 + h)
        for k in range(2):
            a, b = rings[k], rings[k + 1]
            for i in range(seg):
                j = (i + 1) % seg
                q = [a[i], a[j], b[j], b[i]]
                self.face(q, colour, [shade(p) for p in q], None, [normal(p) for p in q])
        for i in range(seg):
            j = (i + 1) % seg
            q = [rings[2][i], rings[2][j], apex]
            self.face(q, colour, [shade(p) for p in q], None, [normal(p) for p in q])
        low = [rings[0][i] for i in range(seg)][::-1]
        self.face(low, under, [tuple(v * 0.7 for v in under)] * seg, None, [(0.0, 0.0, -1.0)] * seg)

    def water_tower(self, c, z0, r=1.9, h=3.4, legs=2.6):
        """A rooftop water tank: a wooden drum on a frame under a low cone."""
        for sx, sy in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
            x, y = c[0] + sx * r * 0.62, c[1] + sy * r * 0.62
            self.box((x - 0.14, y - 0.14, z0), (x + 0.14, y + 0.14, z0 + legs), RAIL)
        self.cylinder(c, r, z0 + legs, z0 + legs + h, TANK, 8, alt=BRICK)
        self.cylinder(c, r + 0.2, z0 + legs + h, z0 + legs + h + 1.2, ZINC, 8, r1=0.0)

    def clutter(self, rnd, lo, hi, z0, count=4):
        """What stands on a flat roof: a stair's bulkhead, ventilation shafts, a glazed skylight, placed by `rnd`."""
        (x0, y0), (x1, y1) = lo, hi
        if x1 - x0 < 3.0 or y1 - y0 < 3.0:
            return
        for k in range(count):
            x = x0 + 1.2 + (x1 - x0 - 2.4) * rnd.random()
            y = y0 + 1.2 + (y1 - y0 - 2.4) * rnd.random()
            kind = k % 3
            if kind == 0:
                self.box((x - 1.5, y - 1.1, z0), (x + 1.5, y + 1.1, z0 + 2.5), WALL_B, top=ZINC, strip="ashlar")
            elif kind == 1:
                self.box((x - 0.5, y - 0.5, z0), (x + 0.5, y + 0.5, z0 + 1.3), STONE, top=ZINC)
            else:
                self.hip(1.6, 1.0, z0, z0 + 0.9, SKYLIGHT, c=(x, y))

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
        # the corners that were given a normal keep it (custom normals); every other corner has its face's
        attr = me.attributes.get("corner_normal")
        given = [tuple(d.vector) for d in attr.data]
        if any(n != (0.0, 0.0, 0.0) for n in given):
            flat = [me.polygons[loop_poly].normal for loop_poly in _loop_polygons(me)]
            me.polygons.foreach_set("use_smooth", [True] * len(me.polygons))
            me.normals_split_custom_set([g if g != (0.0, 0.0, 0.0) else tuple(f) for g, f in zip(given, flat)])
        me.attributes.remove(me.attributes.get("corner_normal"))
        ob = bpy.data.objects.new(name, me)
        bpy.context.collection.objects.link(ob)
        me.materials.append(material)
        me.color_attributes.active_color = me.color_attributes["Color"]
        return ob


def _loop_polygons(me):
    """The polygon each loop of a mesh belongs to."""
    out = [0] * len(me.loops)
    for p in me.polygons:
        for i in p.loop_indices:
            out[i] = p.index
    return out


def slots(s, hx, hy, z0, z1, tint=DECO, sides="SN", margin=1.0, proud=0.12):
    """Tall window slots between piers (the Art Deco fronts): the slot strip on panels just proud of the wall, two storeys
    of glass at a time with a band of stone between (the spandrels), so a front is a grid of tall windows and never a grille."""
    v0, v1 = strip_v("slot")
    tiers = max(1, round((z1 - z0) / 7.4))
    step = (z1 - z0) / tiers
    for side in sides:
        (nx, ny), (rx, ry) = FACES[side]
        half = (hx if side in "SN" else hy) - margin
        d = (hx if nx else hy) + proud
        n = max(1, round(2 * half / 3.4))
        p = lambda u, z: (nx * d + rx * u, ny * d + ry * u, z)  # noqa: E731
        for k in range(tiers):
            a, b = z0 + step * k, z0 + step * (k + 1) - (1.5 if k < tiers - 1 else 0.0)
            s.face([p(-half, a), p(half, a), p(half, b), p(-half, b)], tint, None, [(0.0, v0), (n / 4.0, v0), (n / 4.0, v1), (0.0, v1)])


def deco_side(s, p0, p1, z0, z1, rnd, tint=DECO, fin=0.7, width=2.0, pitch=5.2, tier=7.4, ends=(True, True)):
    """One side of an Art Deco mass, in depth (the near model): p0 to p1 is the line its piers' faces stand on (left to
    right seen from outside). The wall lies `fin` behind it: bands of dark glazing two storeys high with a stone spandrel
    between them; the piers stand out in front as fins, each its own tone, darker towards its foot. `ends` says whether a
    pier closes each end (a corner pier belongs to both sides)."""
    length = math.hypot(p1[0] - p0[0], p1[1] - p0[1])
    t = ((p1[0] - p0[0]) / length, (p1[1] - p0[1]) / length)
    n = (t[1], -t[0])
    at = lambda x, d, z: (p0[0] + t[0] * x - n[0] * d, p0[1] + t[1] * x - n[1] * d, z)  # noqa: E731
    count = max(2, round(length / pitch) + 1)
    gap = (length - width) / (count - 1)
    tiers = max(1, round((z1 - z0) / tier))
    step = (z1 - z0) / tiers
    g0, g1 = strip_v("slot")
    a0, a1 = strip_v("ashlar")
    stone = tuple(a * b for a, b in zip(STONE, tint))
    for k in range(tiers):
        a = z0 + step * k
        b = a + step - (1.6 if k < tiers - 1 else 0.0)
        u1 = length / gap / 4.0
        lo, hi = (0.86, 0.86, 0.86), (0.66, 0.66, 0.66)
        s.face([at(0, fin, a), at(length, fin, a), at(length, fin, b), at(0, fin, b)], lo, [lo, lo, hi, hi], [(0.0, g0), (u1, g0), (u1, g1), (0.0, g1)])
        if k < tiers - 1:
            c = mul(tint, 0.8)
            s.face([at(0, fin, b), at(length, fin, b), at(length, fin, a + step), at(0, fin, a + step)], c, [c, c, mul(c, 0.8), mul(c, 0.8)],
                   [(0.0, a0), (length / TILE, a0), (length / TILE, a0 + (a1 - a0) * 0.4), (0.0, a0 + (a1 - a0) * 0.4)])
    for i in range(count):
        if (i == 0 and not ends[0]) or (i == count - 1 and not ends[1]):
            continue
        xa = i * gap
        xb = xa + width
        k = 0.96 + 0.08 * rnd.random()
        c = mul(stone, k)
        for j in range(tiers):  # the pier's face in courses of ashlar, tier by tier
            a, b = z0 + step * j, z0 + step * (j + 1)
            w = mul(tint, k * (0.96 + 0.08 * rnd.random()))
            low = mul(w, (0.62 if z0 < 1.0 else 0.86)) if j == 0 else w
            u0 = rnd.random()
            s.face([at(xa, 0, a), at(xb, 0, a), at(xb, 0, b), at(xa, 0, b)], w, [low, low, w, w],
                   [(u0, a0), (u0 + width / TILE, a0), (u0 + width / TILE, a1), (u0, a1)])
        if i > 0:
            d = mul(c, 0.8)
            s.quad([at(xa, 0, z0), at(xa, fin, z0), at(xa, fin, z1), at(xa, 0, z1)], d, (-t[0], -t[1], 0.0), [mul(d, 0.8), mul(d, 0.8), d, d])
        if i < count - 1:
            d = mul(c, 0.92)
            s.quad([at(xb, 0, z0), at(xb, fin, z0), at(xb, fin, z1), at(xb, 0, z1)], d, (t[0], t[1], 0.0), [mul(d, 0.8), mul(d, 0.8), d, d])


def order(s, p0, p1, z0, tiers, rnd, tint=WALL, depth=0.6, width=3.3, pitch=5.8, ends=(True, True), foot=None, scale=1.0, blocks=None):
    """One front of a near model in depth, after A2: p0 to p1 is the line its piers' faces stand on (left to right seen
    from outside). Giant piers `width` wide, every `pitch` metres or so, of large ashlar blocks (the ashlar strip over
    each tier: three courses to a tier, each block its own tone); between them the wall lies `depth` back, in their
    shade: per tier of `tiers` ((height, spandrel)) a tall bay of glazing and over it a spandrel of stone. `ends` says
    whether a pier closes each end; `foot` darkens the piers towards the ground; `blocks` cuts a pier's face every so many
    metres of height (three courses of ashlar each) where a tier is taller than that. Returns the height reached."""
    length = math.hypot(p1[0] - p0[0], p1[1] - p0[1])
    t = ((p1[0] - p0[0]) / length, (p1[1] - p0[1]) / length)
    n = (t[1], -t[0])
    at = lambda x, d, z: (p0[0] + t[0] * x - n[0] * d, p0[1] + t[1] * x - n[1] * d, z)  # noqa: E731
    count = max(2, round((length - width) / pitch) + 1)
    gap = (length - width) / (count - 1)
    g0, g1 = strip_v("slot")
    a0, a1 = strip_v("ashlar")
    stone = tuple(a * b for a, b in zip(STONE, tint))
    z = z0
    u1 = length / gap / 4.0
    for k, (h, spandrel) in enumerate(tiers):
        b = z + h - spandrel
        lo, hi = (0.9, 0.9, 0.9), (0.72, 0.72, 0.72)  # the bay's own shade, deeper under its head
        s.face([at(0, depth, z), at(length, depth, z), at(length, depth, b), at(0, depth, b)], lo, [lo, lo, hi, hi], [(0.0, g0), (u1, g0), (u1, g1), (0.0, g1)])
        if spandrel > 0:
            c = mul(tint, 0.78)
            s.face([at(0, depth, b), at(length, depth, b), at(length, depth, z + h), at(0, depth, z + h)], c, [c, c, mul(c, 0.82), mul(c, 0.82)],
                   [(0.0, a0), (length / TILE, a0), (length / TILE, a0 + (a1 - a0) * 0.33), (0.0, a0 + (a1 - a0) * 0.33)])
        z += h
    for i in range(count):
        if (i == 0 and not ends[0]) or (i == count - 1 and not ends[1]):
            continue
        xa = i * gap
        xb = xa + width
        k = 0.97 + 0.06 * rnd.random()
        za = z0
        for j, (h, _) in enumerate(tiers):  # the pier's face in large blocks, tier by tier
            cuts = max(1, round(h / blocks)) if blocks else 1
            for c in range(cuts):
                w = mul(tint, k * (0.97 + 0.06 * rnd.random()))
                low = mul(w, foot) if (j == 0 and c == 0 and foot is not None) else w
                u0 = rnd.random()
                du = width / TILE / scale
                zb = za + h / cuts
                s.face([at(xa, 0, za), at(xb, 0, za), at(xb, 0, zb), at(xa, 0, zb)], w, [low, low, w, w], [(u0, a0), (u0 + du, a0), (u0 + du, a1), (u0, a1)])
                za = zb
        c = mul(stone, k)
        low = 1.0 if foot is None else foot
        if i > 0 or not ends[0]:
            d = mul(c, 0.9)
            s.quad([at(xa, 0, z0), at(xa, depth, z0), at(xa, depth, z), at(xa, 0, z)], d, (-t[0], -t[1], 0.0), [mul(d, low), mul(d, low), d, d])
        if i < count - 1 or not ends[1]:
            d = mul(c, 0.9)
            s.quad([at(xb, 0, z0), at(xb, depth, z0), at(xb, depth, z), at(xb, 0, z)], d, (t[0], t[1], 0.0), [mul(d, low), mul(d, low), d, d])
    return z


def order_box(s, hx, hy, z0, tiers, rnd, tint=WALL, c=(0.0, 0.0), sides="SNEW", **kw):
    """The sides of a box with half-sizes hx, hy as fronts in depth (order each). Returns the height reached."""
    corners = {"S": ((-hx, -hy), (hx, -hy)), "E": ((hx, -hy), (hx, hy)), "N": ((hx, hy), (-hx, hy)), "W": ((-hx, hy), (-hx, -hy))}
    z = z0 + sum(h for h, _ in tiers)
    for side in sides:
        (ax, ay), (bx, by) = corners[side]
        order(s, (c[0] + ax, c[1] + ay), (c[0] + bx, c[1] + by), z0, tiers, rnd, tint, **kw)
    return z


def deco_mass(s, hx, hy, z0, z1, rnd, tint=DECO, c=(0.0, 0.0), sides="SNEW", **kw):
    """The four sides of an Art Deco mass with half-sizes hx, hy (deco_side each)."""
    corners = {"S": ((-hx, -hy), (hx, -hy)), "E": ((hx, -hy), (hx, hy)), "N": ((hx, hy), (-hx, hy)), "W": ((-hx, hy), (-hx, -hy))}
    for side in sides:
        (ax, ay), (bx, by) = corners[side]
        deco_side(s, (c[0] + ax, c[1] + ay), (c[0] + bx, c[1] + by), z0, z1, rnd, tint, **kw)


def atlas():
    """The facade atlas as an sRGB array [row from the bottom, column, rgb]."""
    rng = np.random.default_rng(1207)
    img = np.zeros((SIZE, SIZE, 3))
    # warm limestone against blue-grey slate (the brief): under the city's warm key the slate must still be the cooler of
    # the two by a clear step, so it is painted bluer than a slate looks in white light
    stone = np.array(STONE_RGB)
    slate = np.array(SLATE_RGB)
    zinc = np.array(ZINC_RGB)
    glass = np.array(GLASS_RGB)  # a window is the dark of a front, darker than its wall in any light, but no hole
    iron = np.array([0.230, 0.245, 0.270])
    bay = SIZE // 4
    grain = lambda h: 1.0 + 0.035 * (rng.random((h, SIZE, 1)) - 0.5)  # noqa: E731

    def tile_noise(h, scale):
        """Soft tiling value noise over a strip: weathering, in +-1."""
        n = rng.random((-(-h // scale), SIZE // scale))
        n = np.kron(n, np.ones((scale, scale)))[:h]
        k = np.ones(scale) / scale
        n = np.apply_along_axis(lambda r: np.convolve(np.concatenate([r, r, r]), k, mode="same")[SIZE:2 * SIZE], 1, n)
        return (n - n.mean())[:, :, None] * 2.0

    def courses(a, rows, blocks, depth=0.8, spread=0.12):
        """Ashlar in a strip: staggered blocks, each its own shade, joints a little darker."""
        h = a.shape[0]
        rh = h / rows
        bw = SIZE // blocks
        for r in range(rows):
            y0, y1 = int(round(r * rh)), int(round((r + 1) * rh))
            shift = (bw // 2) * (r % 2) + int(rng.integers(0, bw // 5))
            for b in range(blocks):
                cols = np.arange(b * bw + shift, (b + 1) * bw + shift) % SIZE
                a[y0:y1, cols] *= 1.0 - spread / 2 + spread * rng.random()
                a[y0:y1, cols[:1]] *= depth
            a[y0:y0 + 1] *= depth

    def window(a, x0, x1, y0, y1, arch=False, shutters=False):
        """A recessed window: stone surround, shaded reveal at the top and left, glass that lightens upwards, glazing bars."""
        a[max(y0 - 3, 0):y1 + 3, x0 - 3:x1 + 3] = stone * 1.07
        ys, xs = np.mgrid[y0:y1, x0:x1]
        t = ((ys - y0) / max(y1 - y0, 1))[:, :, None]
        pane = glass * (0.8 + 0.6 * t) + np.array([0.0, 0.008, 0.02]) * t
        if shutters:
            pane = np.array([0.40, 0.43, 0.44]) * (0.86 + 0.14 * ((xs // 2) % 2))[:, :, None]
        inside = np.ones((y1 - y0, x1 - x0), bool)
        if arch:
            r = (x1 - x0) / 2
            cy = y1 - r
            inside = (ys < cy) | ((xs - (x0 + x1 - 1) / 2) ** 2 + (ys - cy) ** 2 < r * r)
        region = a[y0:y1, x0:x1]
        region[inside] = pane[inside]
        if not shutters:
            mid = (x0 + x1) // 2
            a[y0:y1, mid:mid + 1] = np.where(inside[:, mid - x0:mid - x0 + 1, None], 0.42, a[y0:y1, mid:mid + 1])
            a[y0 + (y1 - y0) * 2 // 3:y0 + (y1 - y0) * 2 // 3 + 1, x0:x1] = np.where(inside[(y1 - y0) * 2 // 3:(y1 - y0) * 2 // 3 + 1, :, None], 0.38,
                                                                                     a[y0 + (y1 - y0) * 2 // 3:y0 + (y1 - y0) * 2 // 3 + 1, x0:x1])
        # the reveal's shade: the top four rows and the left three columns of the opening
        shade = np.ones((y1 - y0, x1 - x0, 1))
        shade[-4:] = 0.7
        shade[:, :3] = np.minimum(shade[:, :3], 0.78)
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

    # ashlar in large blocks (A2): three courses to the strip, six blocks to its width, each block its own tone
    a, h = strip("ashlar")
    a[:] = stone * (1.0 + 0.03 * tile_noise(h, 32))
    courses(a, 3, 6, depth=0.86, spread=ASHLAR_SPREAD)
    streak(a, 0, SIZE, h, 10, 0.06)

    # zinc: sheets between standing seams (they run up a slope), each sheet its own tone, weathered
    a, h = strip("zinc")
    a[:] = zinc * (1.0 + 0.04 * tile_noise(h, 16))
    for x in range(0, SIZE, 32):  # (sheets of 0.73 m: wide enough to be sheets and not a row of bars)
        a[:, x:x + 32] *= 0.97 + 0.06 * rng.random()
        a[:, x:x + 1] *= 0.9

    # the glazing between the piers of an Art Deco front: dark glass in metal frames, a paler stone mullion per bay
    a, h = strip("slot")
    # (a bay: the pier's stone over its first 34 px, where the near model's fin stands in front of it; then glass)
    # (glazing that takes the sky: a middle grey a step under the stone, so a front of it is a calm band and no dark stripe)
    a[:] = glass * 1.12
    for x in range(0, SIZE, 32):  # each pane takes the sky a little differently
        a[:, x:x + 32] *= 0.93 + 0.14 * rng.random()
    a[5:6] = glass * 0.95  # the floors behind the glass
    a[10:11] = glass * 0.95
    for b in range(4):
        x = b * bay
        for m in (64, 96):
            a[:, x + m:x + m + 3] = glass * 1.3
        a[:, x:x + 30] = stone * (0.96 + 0.08 * rng.random())
        a[:, x + 30:x + 34] = stone * 0.75
    a[:1] = stone * 0.7

    a, h = strip("ground")
    a[:] = stone * 0.9 * (1.0 + 0.05 * tile_noise(h, 32)) * grain(h)
    for y in range(0, h - 12, 14):  # rusticated courses
        a[y:y + 2] *= 0.74
    a[:10] *= 0.86  # the plinth
    for b in range(4):
        x = b * bay
        window(a, x + 24, x + 104, 4 if b % 2 else 12, 88, arch=True)
        if b == 1:
            a[4:60, x + 30:x + 98] = np.array([0.31, 0.28, 0.25])  # a door of dark wood
            a[4:60, x + 63:x + 65] = 0.2
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
            slates[r:r + 4, cols] = 0.96 + 0.08 * rng.random()
        slates[r:r + 1] *= 0.94
    a[:] = slate * slates * (1.0 + 0.06 * tile_noise(h, 32))
    for b in range(4):
        x = b * bay
        a[8:72, x + 38:x + 90] = stone * 1.04  # the dormer's stone front
        a[72:76, x + 34:x + 94] = zinc  # its zinc cap
        a[8:76, x + 90:x + 94] = slate * 0.78  # its shade on the slates
        window(a, x + 46, x + 82, 18, 62)
    a[:7] = stone * 1.08  # the cornice and gutter
    a[7:9] = stone * 0.55
    a[h - 5:] = zinc  # the zinc flashing at the break of the roof

    a, h = strip("slate")
    slates = np.ones((h, SIZE, 1))
    for r in range(0, h, 4):
        shift = int(rng.integers(0, 8))
        for cx in range(0, SIZE, 8):
            cols = np.arange(cx + shift, cx + shift + 8) % SIZE
            slates[r:r + 4, cols] = 0.97 + 0.06 * rng.random()
        slates[r:r + 1] *= 0.93
        if (r // 8) % 2:  # the courses in bands of two, turn about a little darker: the roof's own rhythm seen from above
            slates[r:r + 4] *= SLATE_BAND
    a[:] = slate * slates * (1.0 + SLATE_SPREAD * tile_noise(h, 32))
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
