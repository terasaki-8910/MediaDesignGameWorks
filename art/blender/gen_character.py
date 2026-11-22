"""The player character, a travelling sorcerer: public/assets/character/wanderer.glb.

    node <game3d>/scripts/blender.mjs art/blender/gen_character.py -- --out public/assets/character/wanderer.glb
    options: --fast 1 (no AO bake, for block-outs)   --turntable <dir> (also render review views there)

Frame: 1 unit = 1 m, Z up. Unlike the kit pieces the figure follows the glTF convention for models: it faces
Blender -Y (glTF +Z), its left hand is at +X. The game's loader (src/game/wandererAvatar.ts) turns any model to
the game's forward axis, scales its bounding box to 1.8 m and lifts it into its hover, so the lowest point of this
model (the cloak hem) is at z = 0 and the crown at z = 1.8; the origin is under the head, between the feet.

Everything is one mesh with one material. The garments are grids over (height, angle) built outwards in layers
(tunic, coat, cloak, mantle, collar), each a shell with its own thickness, so a layer can only cross another one by
a mistake in the numbers: the checks at the end fail the script when it does. Every panel has a hand-assigned
rectangle in one atlas; numpy paints base colour, roughness / metal and height (the gilt embroidery of folded
squares) there, Cycles adds the ambient occlusion. Nothing directional is baked and nothing is random.

The float attribute `_sway` (glTF `_SWAY`) is 0 where cloth is held (shoulders, waist) and rises to 1 at the cloak
hem: the game's vertex shader trails and ripples the cloth by it.
"""
import math
import os
import sys

import bpy
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import fc_kit as K  # noqa: E402

opts = K.script_args()
OUT = opts.get("out", "public/assets/character/wanderer.glb")
FAST = opts.get("fast") == "1"
TURNTABLE = opts.get("turntable")
K.reset()

HEIGHT = 1.8
MAX_TRIANGLES = 20000
ATLAS = 2048  # base colour; the data maps are half of it
PAD = 5  # texels kept free around each panel

# Palette (sRGB), from docs/art-brief.md: deep grey-teal, light stone grey, dark bronze, gold. No purple, no cyan.
# The game's light splits any dark cloth into a warm lit side and a deep blue shaded side: the sky is the only fill
# light, and away from the sun it has about a fifth as much red as blue (measured in player-front with the texture
# replaced by a flat colour: the same blue). So the base colour hardly moves the shaded side. Compared in the game's
# shots: a bluer teal (#2B424C) read blue all over, a neutral grey-green (#424A46) khaki in the sun.
TEAL = "#3A4848"
TEAL_DEEP = "#2F3C3D"
TEAL_LIGHT = "#455656"
STONE = "#CBC4B6"
STONE_SHADE = "#B4AC9D"
BRONZE = "#3A2E22"
BRONZE_WARM = "#5A4630"
LEATHER = "#1F1A16"
GILT = "#D8B24A"
SKIN = "#A98466"
HAIR = "#33281F"

# ---------------------------------------------------------------------------------------------------------------
# Small maths


def smoothstep(e0, e1, x):
    t = np.clip((np.asarray(x, dtype=np.float64) - e0) / (e1 - e0), 0.0, 1.0)
    return t * t * (3 - 2 * t)


def profile(keys):
    """A smooth function through [(x, value), ...] (linear between the keys, then rounded)."""
    keys = sorted(keys)
    xs = np.array([k[0] for k in keys], dtype=np.float64)
    vs = np.array([k[1] for k in keys], dtype=np.float64)
    dx = np.linspace(xs[0], xs[-1], 600)
    dv = np.interp(dx, xs, vs)
    ker = np.ones(31) / 31
    raw = dv
    for _ in range(2):
        dv = np.convolve(np.pad(dv, 15, mode="edge"), ker, mode="valid")
    u = np.linspace(0, 1, 600)
    w = np.maximum(1 - smoothstep(0.0, 0.08, u), smoothstep(0.92, 1.0, u))  # the end values hold exactly
    dv = raw * w + dv * (1 - w)
    return lambda x: np.interp(x, dx, dv)


def ring_xy(phi, a, b, c, n=2.5):
    """A superellipse in plan. phi = 0 is the front (-Y), pi/2 the figure's left (+X), pi the back."""
    s, co = np.sin(phi), np.cos(phi)
    e = 2.0 / n
    return a * np.sign(s) * np.abs(s) ** e, c - b * np.sign(co) * np.abs(co) ** e


# ---------------------------------------------------------------------------------------------------------------
# Parts: vertex, face and UV lists, joined into one mesh at the end


class Part:
    def __init__(self, name):
        self.name = name
        self.v = []
        self.sway = []
        self.f = []
        self.uv = []  # per face: (rect, [(u, v), ...])

    def verts(self, pts, sway=0.0):
        """Add points (..., 3); returns their indices in the same shape."""
        pts = np.asarray(pts, dtype=np.float64)
        flat = pts.reshape(-1, 3)
        sw = np.broadcast_to(np.asarray(sway, dtype=np.float64), pts.shape[:-1]).reshape(-1)
        start = len(self.v)
        self.v.extend(map(tuple, flat))
        self.sway.extend(sw.tolist())
        return np.arange(start, start + len(flat)).reshape(pts.shape[:-1])

    def face(self, idx, rect, uv):
        self.f.append(tuple(int(i) for i in idx))
        self.uv.append((rect, [tuple(p) for p in uv]))

    def mirrored(self, name):
        """The same part on the other side (x -> -x); it shares the texels."""
        m = Part(name)
        m.v = [(-x, y, z) for x, y, z in self.v]
        m.sway = list(self.sway)
        m.f = [tuple(reversed(f)) for f in self.f]
        m.uv = [(r, list(reversed(uv))) for r, uv in self.uv]
        return m

    def triangles(self):
        return sum(len(f) - 2 for f in self.f)

    def polygons(self):
        return [Vector(p) for p in self.v], list(self.f)


def _wrap(idx, closed):
    return np.concatenate([idx, idx[:, :1]], axis=1) if closed else idx


def grid_faces(part, idx, rect, closed, u0=0.0, u1=1.0, v0=1.0, v1=0.0, inner=False):
    """Quads over an index grid (rows go down the garment, columns go round it counter-clockwise seen from above).
    `inner` turns the faces to the inside and mirrors u, so the texture is not mirrored on the lining."""
    idx = _wrap(idx, closed)
    rows, cols = idx.shape
    for k in range(rows - 1):
        for j in range(cols - 1):
            ua, ub = u0 + (u1 - u0) * j / (cols - 1), u0 + (u1 - u0) * (j + 1) / (cols - 1)
            va, vb = v0 + (v1 - v0) * k / (rows - 1), v0 + (v1 - v0) * (k + 1) / (rows - 1)
            if inner:
                part.face((idx[k, j], idx[k, j + 1], idx[k + 1, j + 1], idx[k + 1, j]), rect,
                          ((1 - ua, va), (1 - ub, va), (1 - ub, vb), (1 - ua, vb)))
            else:
                part.face((idx[k, j], idx[k + 1, j], idx[k + 1, j + 1], idx[k, j + 1]), rect,
                          ((ua, va), (ua, vb), (ub, vb), (ub, va)))


def grid_normals(P, closed):
    """Outward unit normals of a point grid (down x round)."""
    dk = np.gradient(P, axis=0)
    if closed:
        dj = (np.roll(P, -1, axis=1) - np.roll(P, 1, axis=1)) * 0.5
    else:
        dj = np.gradient(P, axis=1)
    n = np.cross(dk, dj)
    return n / np.maximum(np.linalg.norm(n, axis=-1, keepdims=True), 1e-9)


def shell(part, P, closed, rect_out, rect_in, sway, thickness, rim_rect="rim"):
    """Cloth with thickness: the outer grid, the lining `thickness` inside it and a rim round every open edge."""
    P = np.asarray(P, dtype=np.float64)
    sway = np.broadcast_to(np.asarray(sway, dtype=np.float64), P.shape[:-1])
    N = grid_normals(P, closed)
    out = part.verts(P, sway)
    inn = part.verts(P - N * thickness, sway)
    grid_faces(part, out, rect_out, closed)
    grid_faces(part, inn, rect_in, closed, inner=True)
    o, i = _wrap(out, closed), _wrap(inn, closed)
    rows, cols = o.shape
    quad = ((0.1, 0.1), (0.9, 0.1), (0.9, 0.9), (0.1, 0.9))
    for j in range(cols - 1):
        part.face((o[0, j], o[0, j + 1], i[0, j + 1], i[0, j]), rim_rect, quad)
        part.face((o[-1, j + 1], o[-1, j], i[-1, j], i[-1, j + 1]), rim_rect, quad)
    if not closed:
        for k in range(rows - 1):
            part.face((o[k + 1, 0], o[k, 0], i[k, 0], i[k + 1, 0]), rim_rect, quad)
            part.face((o[k, -1], o[k + 1, -1], i[k + 1, -1], i[k, -1]), rim_rect, quad)
    return out


def tube(part, centres, radii, ref, n, rect, cap_start=True, cap_end=True, sway=0.0, twist=0.0, tangents=None):
    """A tube of elliptical rings round a path. `radii` are (a along `ref`, b across it) for each centre."""
    C = np.asarray(centres, dtype=np.float64)
    T = np.gradient(C, axis=0) if tangents is None else np.asarray(tangents, dtype=np.float64)
    T = T / np.linalg.norm(T, axis=1, keepdims=True)
    ref = np.asarray(ref, dtype=np.float64)
    U = ref[None, :] - (T @ ref)[:, None] * T
    U /= np.linalg.norm(U, axis=1, keepdims=True)
    V = np.cross(T, U)
    al = np.linspace(0, 2 * np.pi, n, endpoint=False) + twist
    R = np.asarray(radii, dtype=np.float64)
    P = (C[:, None, :] + R[:, 0, None, None] * np.cos(al)[None, :, None] * U[:, None, :]
         + R[:, 1, None, None] * np.sin(al)[None, :, None] * V[:, None, :])
    # the faces of grid_faces look along (down the rows) x (round the columns): turn the columns if that is inwards
    nrm = np.cross(P[1, 0] - P[0, 0], P[0, 1] - P[0, 0])
    if np.dot(nrm, P[0, 0] - C[0]) < 0:
        P = P[:, ::-1]
    idx = part.verts(P, sway)
    grid_faces(part, idx, rect, True, v0=0.94, v1=0.06)
    w = _wrap(idx, True)
    if cap_start:
        pole = part.verts(C[0][None, :], sway)[0]
        for j in range(n):
            part.face((pole, w[0, j], w[0, j + 1]), rect, (((j + 0.5) / n, 1.0), (j / n, 0.94), ((j + 1) / n, 0.94)))
    if cap_end:
        pole = part.verts(C[-1][None, :], sway)[0]
        for j in range(n):
            part.face((pole, w[-1, j + 1], w[-1, j]), rect, (((j + 0.5) / n, 0.0), ((j + 1) / n, 0.06), (j / n, 0.06)))
    return idx


# ---------------------------------------------------------------------------------------------------------------
# The figure, from the inside out. Heights are above the lowest point of the cloak; the toes hang at about 0.05 m.

Z_NECK = 1.525
Z_WAIST = 1.08
Z_COAT_HEM = 0.15
Z_TUNIC_HEM = 0.30
Z_CLOAK_TOP = 1.41
TH = 0.008  # cloth thickness

# coat above the waist (the tunic is 14 mm inside it)
COAT_A = profile([(1.08, 0.190), (1.10, 0.190), (1.20, 0.190), (1.32, 0.197), (1.42, 0.200), (1.47, 0.185), (1.50, 0.130), (Z_NECK, 0.070)])
COAT_B = profile([(1.08, 0.138), (1.10, 0.138), (1.20, 0.136), (1.32, 0.137), (1.42, 0.128), (1.47, 0.115), (1.50, 0.092), (Z_NECK, 0.070)])
COAT_PLEATS = 9
COAT_PLEAT = 0.05


def coat_abc(z):
    """Half width, half depth and centre of the coat at a height (the skirt without its pleats)."""
    z = np.asarray(z, dtype=np.float64)
    d = np.clip((Z_WAIST - z) / (Z_WAIST - Z_COAT_HEM), 0.0, 1.0)
    a = np.where(z >= Z_WAIST, COAT_A(np.maximum(z, Z_WAIST)), 0.190 + 0.120 * d ** 0.85)
    b = np.where(z >= Z_WAIST, COAT_B(np.maximum(z, Z_WAIST)), 0.138 + 0.132 * d ** 0.85)
    c = 0.045 * d ** 1.5
    return a, b, c, d


def coat_back(x, z):
    """The furthest back the coat reaches at (x, z), pleats included: the cloak hangs outside this."""
    a, b, c, d = coat_abc(z)
    m = 1 + COAT_PLEAT * d ** 1.3
    t = np.clip(np.abs(x) / (a * m), 0.0, 1.0)
    return np.where(np.abs(x) < a * m, c + b * m * (1 - t ** 2.5) ** (1 / 2.5), -1.0)


def build_tunic():
    """The long inner tunic (light stone): seen in the coat's neck opening and in its front split."""
    p = Part("tunic")
    n = 32
    phi = np.linspace(0, 2 * np.pi, n, endpoint=False)
    zs = [1.548, 1.53, 1.515, 1.50, 1.47, 1.42, 1.32, 1.20, 1.08, 0.95, 0.82, 0.69, 0.56, 0.43, Z_TUNIC_HEM, Z_TUNIC_HEM + 0.012]
    rows = []
    for k, z in enumerate(zs):
        if z >= Z_WAIST:
            a, b = COAT_A(z) - 0.024, COAT_B(z) - 0.024
            if z > 1.51:  # a standing neck band
                a, b = (0.053, 0.054) if z > 1.52 else (0.057, 0.056)
            c = 0.002
        else:
            d = (Z_WAIST - z) / (Z_WAIST - Z_TUNIC_HEM)
            a, b, c = 0.166 + 0.030 * d, 0.114 + 0.042 * d, 0.004 + 0.008 * d
        if k == len(zs) - 1:  # the hem turned in
            a, b = a - 0.012, b - 0.012
        x, y = ring_xy(phi, a, b, c)
        rows.append(np.stack([x, y, np.full(n, z)], axis=1))
    idx = p.verts(np.array(rows))
    grid_faces(p, idx, "tunic", True)
    return p


def build_overtunic():
    """A second, shorter layer over the tunic, to the knee, with a gilt edge."""
    p = Part("overtunic")
    n = 32
    phi = np.linspace(0, 2 * np.pi, n, endpoint=False)
    top, hem = 1.07, 0.57
    P = []
    for d in np.linspace(0, 1, 8):
        z = top + (hem - top) * d + 0.012 * d * np.cos(2 * phi)  # a little longer at the front and back
        a, b, c = 0.176 + 0.042 * d ** 0.9, 0.124 + 0.044 * d ** 0.9, 0.004 + 0.006 * d
        x, y = ring_xy(phi, a, b, c)
        P.append(np.stack([x, y, z], axis=1))
    shell(p, np.array(P), True, "overtunic", "lining_stone", 0.0, 0.006)
    return p


def coat_gap(z):
    """Half the angle of the coat's front opening: a V at the neck, closed under the belt, split below it."""
    return np.radians(profile([(0.15, 26), (0.6, 17), (0.98, 3), (1.03, 0.4), (1.24, 0.4), (1.34, 9), (1.42, 17), (1.47, 23), (Z_NECK, 30)])(z))


def build_coat():
    """The long outer coat (deep grey-teal wool), fitted to the waist, split at the front below it, to the ankles."""
    p = Part("coat")
    n = 44
    t = np.linspace(0, 1, n + 1)
    torso = [Z_NECK, 1.50, 1.47, 1.42, 1.34, 1.26, 1.18, 1.12]
    skirt = np.linspace(0, 1, 15)
    P, S = [], []
    for z in torso:
        a, b, c, _ = coat_abc(z)
        g = coat_gap(z)
        phi = g + t * (2 * np.pi - 2 * g)
        x, y = ring_xy(phi, a, b, c)
        P.append(np.stack([x, y, np.full(n + 1, z)], axis=1))
        S.append(np.zeros(n + 1))
    edge = smoothstep(0.0, 0.07, t) * smoothstep(1.0, 0.93, t)  # the front edges hang straight
    for d in skirt:
        z0 = Z_WAIST + (Z_COAT_HEM - Z_WAIST) * d
        g = coat_gap(z0)
        phi = g + t * (2 * np.pi - 2 * g)
        zh = Z_COAT_HEM + 0.03 * np.cos(phi)  # the hem is a little higher at the front
        z = Z_WAIST + (zh - Z_WAIST) * d
        a, b, c, _ = coat_abc(z0)
        m = 1 + COAT_PLEAT * d ** 1.3 * 0.5 * (1 + np.cos(COAT_PLEATS * (phi - np.pi))) * edge
        x, y = ring_xy(phi, a, b, 0.0)
        P.append(np.stack([x * m, c + y * m, z], axis=1))
        S.append(np.full(n + 1, 0.55 * d ** 1.4))
    shell(p, np.array(P), False, "coat", "lining_teal", np.array(S), TH)
    return p


def build_belt():
    """The dark bronze leather belt over the coat, and its gilt buckle."""
    p = Part("belt")
    n = 40
    phi = np.linspace(0, 2 * np.pi, n, endpoint=False)
    rows = []
    for z, off in ((1.118, 0.0015), (1.116, 0.010), (1.062, 0.010), (1.060, 0.0015)):
        a, b, c, _ = coat_abc(max(z, Z_WAIST))
        x, y = ring_xy(phi, a + off, b + off, c)
        rows.append(np.stack([x, y, np.full(n, z)], axis=1))
    idx = p.verts(np.array(rows))
    grid_faces(p, idx, "belt", True)
    # buckle: a plate standing proud of the belt at the front, with a smaller raised field
    a, b, c, _ = coat_abc(1.09)
    y0 = c - b - 0.010
    for (hw, hh, depth, rect) in ((0.036, 0.040, 0.008, "gilt"), (0.022, 0.026, 0.013, "buckle")):
        zc = 1.089
        back = p.verts([(-hw, y0 + 0.004, zc - hh), (hw, y0 + 0.004, zc - hh), (hw, y0 + 0.004, zc + hh), (-hw, y0 + 0.004, zc + hh)])
        k = 0.75
        front = p.verts([(-hw * k, y0 - depth, zc - hh * k), (hw * k, y0 - depth, zc - hh * k), (hw * k, y0 - depth, zc + hh * k), (-hw * k, y0 - depth, zc + hh * k)])
        sq = ((0.05, 0.05), (0.95, 0.05), (0.95, 0.95), (0.05, 0.95))
        p.face((front[0], front[1], front[2], front[3]), rect, sq)
        for i in range(4):
            j = (i + 1) % 4
            p.face((back[j], front[j], front[i], back[i]), "gilt", sq)
    return p


def mantle_gap(z):
    return np.radians(profile([(1.18, 34), (1.30, 30), (1.40, 16), (1.455, 1.0), (1.535, 1.0)])(z))


MANTLE_ROWS = [(1.535, 0.100, 0.096), (1.515, 0.130, 0.106), (1.49, 0.196, 0.132), (1.46, 0.242, 0.155), (1.42, 0.272, 0.176),
               (1.37, 0.290, 0.190), (1.33, 0.302, 0.199), (1.30, 0.312, 0.207)]


def build_mantle():
    """The short shoulder mantle: closed by the emblem at the collarbone, open below it, with a point at the back."""
    p = Part("mantle")
    n = 44
    t = np.linspace(0, 1, n + 1)
    P, S = [], []
    for k, (z0, a, b) in enumerate(MANTLE_ROWS):
        g = mantle_gap(z0)
        phi = g + t * (2 * np.pi - 2 * g)
        d = max(0.0, (1.46 - z0) / 0.16)
        back = np.clip(-np.cos(phi), 0, 1) ** 6
        z = z0 - (0.10 * back + 0.025 * np.clip(np.cos(phi), 0, 1) ** 2) * d ** 1.2
        grow = 1 + 0.035 * back * d  # the point hangs a little further out
        x, y = ring_xy(phi, a * grow, b * grow, 0.008, n=2.1)  # rounder than the coat: no corners on the shoulders
        P.append(np.stack([x, y, z], axis=1))
        S.append(np.full(n + 1, 0.10 * d ** 1.5))
    shell(p, np.array(P), False, "mantle", "lining_bronze", np.array(S), TH)
    return p


def build_collar():
    """The tall standing collar: it flares out and frames the head up to ear height, open at the front."""
    p = Part("collar")
    n = 30
    t = np.linspace(0, 1, n + 1)
    P = []
    rows = 6
    for k in range(rows + 1):
        f = k / rows
        g = np.radians(36 + 16 * f)
        phi = g + t * (2 * np.pi - 2 * g)
        top = 1.585 + 0.125 * np.sin(np.pi * t) ** 0.55  # highest behind the head, falling to the two front points
        z = 1.52 + (top - 1.52) * f
        fl = np.clip((z - 1.52) / 0.2, 0, 1) ** 1.5  # by height: the low front points flare less
        a, b, c = 0.082 + 0.096 * fl, 0.081 + 0.090 * fl, 0.010 + 0.024 * fl
        x, y = ring_xy(phi, a, b, c, n=2.2)
        P.append(np.stack([x, y, z], axis=1))
    P = np.array(P)[::-1]  # top row first, as every garment
    shell(p, P, False, "collar", "collar_in", 0.0, 0.007)
    return p


def build_cloak():
    """The long cloak from the shoulder blades to below the feet, its hem lifted and swept back."""
    p = Part("cloak")
    n, rows = 30, 22
    s = np.linspace(1, -1, n + 1)  # from the figure's left to its right: counter-clockwise round the back
    v = np.linspace(0, 1, rows + 1)
    zh = 0.07 * (0.5 + 0.5 * np.sin(2.2 * s + 0.9)) + 0.13 * np.clip(s, 0, 1) ** 2.5  # lifted on the figure's left
    zh -= zh.min()
    P, S = [], []
    for vk in v:
        w = 0.165 + 0.275 * vk ** 0.9
        x = s * w
        z = Z_CLOAK_TOP + (zh - Z_CLOAK_TOP) * vk
        free = 0.13 + 0.30 * vk ** 1.7 - 0.07 * s ** 2 * (1 - 0.5 * vk)
        free = free + 0.062 * vk ** 1.1 * np.cos(np.pi * 3.4 * s + 0.4) + 0.024 * vk ** 2 * np.cos(np.pi * 7.1 * s + 1.3)
        y = np.maximum(free, coat_back(x, z) + 0.014 + TH)
        P.append(np.stack([x, y, z], axis=1))
        S.append(np.full(n + 1, vk ** 1.5))
    shell(p, np.array(P), False, "cloak", "cloak_in", np.array(S), TH)
    return p


ARM = [(0.190, 0.000, 1.455), (0.222, 0.010, 1.31), (0.254, 0.012, 1.17), (0.280, -0.012, 1.04), (0.295, -0.040, 0.935)]


def _arm_path(samples):
    pts = np.array(ARM)
    tt = np.linspace(0, 1, len(pts))
    fx, fy, fz = (profile(list(zip(tt, pts[:, i]))) for i in range(3))
    u = np.linspace(0, 1, samples)
    return np.stack([fx(u), fy(u), fz(u)], axis=1)


def build_sleeve():
    """The coat's left sleeve: a bell cuff with a gilt band, the rim turned in."""
    p = Part("sleeve_L")
    C = _arm_path(11)
    r = np.interp(np.linspace(0, 1, 11), [0, 0.3, 0.7, 1.0], [0.062, 0.054, 0.055, 0.068])
    T = np.gradient(C, axis=0)
    # the rim turned in: two more rings inside the cuff, on the same axis
    C = np.concatenate([C, C[-1:] + (C[-1] - C[-2]) * 0.02, C[-1:] - (C[-1] - C[-2]) * 0.6])
    T = np.concatenate([T, T[-1:], T[-1:]])
    r = np.concatenate([r, [0.061, 0.050]])
    tube(p, C, np.stack([r, r * 0.94], axis=1), (1, 0, 0), 14, "sleeve", cap_start=False, cap_end=False, tangents=T)
    return p


def build_hand():
    """The left hand in a dark leather glove: a mitten with a thumb; the fingers are drawn in the normal map."""
    p = Part("hand_L")
    a0 = np.array(ARM[-2])
    w0 = np.array(ARM[-1])
    ax = (w0 - a0) / np.linalg.norm(w0 - a0)
    fwd = np.array([0.0, -1.0, 0.0])
    fwd = fwd - ax * (fwd @ ax)
    fwd /= np.linalg.norm(fwd)
    side = np.cross(ax, fwd)  # across the palm's thickness
    if side[0] < 0:
        side = -side
    spec = [(-0.05, 0.030, 0.027), (0.0, 0.031, 0.025), (0.03, 0.037, 0.021), (0.07, 0.045, 0.018), (0.105, 0.042, 0.015),
            (0.14, 0.036, 0.013), (0.17, 0.027, 0.011), (0.188, 0.014, 0.007)]
    C, R = [], []
    for s, hw, ht in spec:
        curl = 0.022 * max(0.0, (s - 0.08) / 0.1) ** 2
        C.append(w0 + ax * s - side * curl + fwd * curl * 0.3)
        R.append((ht, hw))
    tube(p, C, R, side, 10, "hand")
    base = w0 + ax * 0.035 + fwd * 0.03
    tip = base + ax * 0.055 + fwd * 0.028 - side * 0.012
    Ct = [base + (tip - base) * q for q in (0.0, 0.4, 0.8, 1.0)]
    tube(p, Ct, [(0.012, 0.013), (0.012, 0.013), (0.010, 0.011), (0.005, 0.006)], side, 6, "hand")
    return p


def build_boot(x, lift, fwd):
    """A dark leather boot, the foot hanging with its toe down as it does when nothing stands on it."""
    p = Part("boot_L" if x > 0 else "boot_R")
    C = [(x, fwd, 0.46 + lift), (x, fwd, 0.33 + lift), (x, fwd + 0.006, 0.225 + lift), (x, fwd - 0.022, 0.165 + lift),
         (x, fwd - 0.066, 0.115 + lift), (x, fwd - 0.108, 0.078 + lift), (x, fwd - 0.132, 0.058 + lift)]
    R = [(0.060, 0.062), (0.050, 0.053), (0.041, 0.047), (0.043, 0.052), (0.041, 0.036), (0.034, 0.022), (0.018, 0.011)]
    tube(p, C, R, (1, 0, 0), 12, "boot")
    return p


HEAD_C = np.array([0.0, -0.012, 1.658])
HEAD_R = (0.074, 0.094, 0.118)


def _head_phi(n):
    t = np.linspace(-np.pi, np.pi, n, endpoint=False)
    return t - 0.42 * np.sin(t)  # more columns across the face


def head_radius(theta, phi):
    """Distance of the head's surface from its centre, for a polar angle from the crown and an angle round from the front."""
    dz = np.cos(theta)
    st = np.sin(theta)
    front = np.cos(phi)
    low = np.clip(-dz, 0, 1)
    a = HEAD_R[0] * (1 - 0.27 * low ** 1.3 * (0.35 + 0.65 * np.clip(front, 0, 1)))
    b = np.where(front > 0, 0.089 * (1 - 0.08 * low ** 2), 0.099)
    dx, dy = st * np.sin(phi), st * front
    r = 1 / np.sqrt((dx / a) ** 2 + (dy / b) ** 2 + (dz / HEAD_R[2]) ** 2)
    ph = np.abs(phi)
    g = lambda x, m, s: np.exp(-((x - m) / s) ** 2)  # noqa: E731
    r = r + 0.017 * g(ph, 0, 0.17) * g(dz, -0.20, 0.13)  # nose
    r = r + 0.006 * g(ph, 0, 0.13) * g(dz, -0.02, 0.2)  # its ridge
    r = r - 0.007 * g(ph, 0.40, 0.2) * g(dz, 0.05, 0.1)  # eye sockets
    r = r + 0.004 * g(ph, 0, 0.75) * g(dz, 0.2, 0.07)  # brow
    r = r + 0.003 * g(ph, 0.8, 0.3) * g(dz, -0.15, 0.15)  # cheekbones
    r = r + 0.004 * g(ph, 0, 0.28) * g(dz, -0.46, 0.06)  # mouth
    r = r + 0.007 * g(ph, 0, 0.32) * g(dz, -0.8, 0.16)  # chin
    return r


def _head_points(theta, phi, extra=0.0):
    r = head_radius(theta, phi) + extra
    st = np.sin(theta)
    return np.stack([HEAD_C[0] + r * st * np.sin(phi), HEAD_C[1] - r * st * np.cos(phi), HEAD_C[2] + r * np.cos(theta)], axis=-1)


def build_head():
    p = Part("head")
    n, rows = 32, 20
    phi = _head_phi(n)
    th = np.linspace(0, np.pi, rows + 1)[1:-1]
    TH_, PH = np.meshgrid(th, phi, indexing="ij")
    idx = p.verts(_head_points(TH_, PH))
    grid_faces(p, idx, "head", True, v0=0.95, v1=0.05)
    w = _wrap(idx, True)
    top = p.verts(_head_points(np.array([0.0]), np.array([0.0])))[0]
    bot = p.verts(_head_points(np.array([np.pi]), np.array([0.0])))[0]
    for j in range(n):
        um = (j + 0.5) / n
        p.face((top, w[0, j], w[0, j + 1]), "head", ((um, 1.0), (j / n, 0.95), ((j + 1) / n, 0.95)))
        p.face((bot, w[-1, j + 1], w[-1, j]), "head", ((um, 0.0), ((j + 1) / n, 0.05), (j / n, 0.05)))
    # neck
    C = [(0, 0.012, 1.585), (0, 0.010, 1.49)]
    tube(p, C, [(0.044, 0.047), (0.048, 0.050)], (1, 0, 0), 12, "neck", cap_start=False, cap_end=False)
    return p


def build_hair():
    """Hair swept back from the forehead to the nape, a shell over the skull."""
    p = Part("hair")
    n, rows = 32, 9
    phi = _head_phi(n)
    ph = np.abs(phi)
    line = np.radians(50 + 78 * smoothstep(0.35, 2.5, ph) + 8 * np.exp(-((ph - 1.15) / 0.3) ** 2))  # the hairline, from the crown
    P = []
    for k in range(1, rows + 2):
        f = min(k / rows, 1.0)
        theta = line * f
        thick = 0.012 + 0.016 * np.sin(np.pi * min(f, 1.0) ** 0.8) * (0.6 + 0.4 * smoothstep(0.8, 2.6, ph)) + 0.010 * (1 - f)
        if k == rows + 1:  # the edge turned in to the skin
            thick = np.full(n, 0.0012)
        else:
            thick = thick * (1 - 0.55 * f ** 3)
        P.append(_head_points(theta, phi, thick))
    idx = p.verts(np.array(P))
    grid_faces(p, idx, "hair", True, v0=0.95, v1=0.0)
    w = _wrap(idx, True)
    top = p.verts(_head_points(np.array([0.0]), np.array([0.0]), 0.024))[0]
    for j in range(n):
        p.face((top, w[0, j], w[0, j + 1]), "hair", (((j + 0.5) / n, 1.0), (j / n, 0.95), ((j + 1) / n, 0.95)))
    return p


def build_sash():
    """The end of the sash: a strip of bronze cloth hanging from the belt on the left hip, over the coat."""
    p = Part("sash")
    cols, rows = 5, 9
    top, end = 1.075, 0.60
    P, S = [], []
    for k in range(rows + 1):
        d = k / rows
        z = top + (end - top) * d
        a, b, c, cd = coat_abc(z)
        m = 1 + COAT_PLEAT * cd ** 1.3
        narrow = 1.0 if k < rows else 0.35  # a pointed end
        phi = np.radians(41 + 13 * narrow * np.linspace(-1, 1, cols + 1))
        x, y = ring_xy(phi, a * m + 0.020, b * m + 0.020, 0.0)
        P.append(np.stack([x, c + y, np.full(cols + 1, z - (0.03 if k == rows else 0.0))], axis=1))
        S.append(np.full(cols + 1, 0.3 * d ** 1.3))
    shell(p, np.array(P), False, "sash", "lining_bronze", np.array(S), 0.006)
    return p


def build_emblem():
    """The gilt chest emblem that closes the mantle: a square standing on its corner with one corner folded over."""
    p = Part("emblem")
    z0 = 1.447
    g = mantle_gap(z0)
    a = np.interp(z0, [1.42, 1.46], [0.272, 0.242])
    b = np.interp(z0, [1.42, 1.46], [0.176, 0.155])
    _, y = ring_xy(np.array([float(g)]), a, b, 0.008)
    y0 = float(y[0]) - 0.004
    h = 0.036
    tilt = 0.5  # the mantle slopes back here: lean the plate with it
    def at(u, w, d):  # noqa: E306
        return (u, y0 - d + w * tilt, z0 + w)
    back = p.verts([at(0, -h, -0.006), at(h, 0, -0.006), at(0, h, -0.006), at(-h, 0, -0.006)])
    front = p.verts([at(0, -h * 0.86, 0.007), at(h * 0.86, 0, 0.007), at(0, h * 0.86, 0.007), at(-h * 0.86, 0, 0.007)])
    sq = ((0.5, 0.04), (0.96, 0.5), (0.5, 0.96), (0.04, 0.5))
    p.face((front[0], front[1], front[2], front[3]), "emblem", sq)
    flat = ((0.1, 0.1), (0.9, 0.1), (0.9, 0.9), (0.1, 0.9))
    for i in range(4):
        j = (i + 1) % 4
        p.face((back[i], back[j], front[j], front[i]), "gilt", flat)
    return p


# ---------------------------------------------------------------------------------------------------------------
# Atlas: every panel has its rectangle (texels at ATLAS = 2048)

PANELS = [
    ("cloak", 700, 880), ("coat", 940, 660), ("cloak_in", 360, 470), ("lining_teal", 400, 300), ("tunic", 500, 540),
    ("overtunic", 520, 240), ("mantle", 800, 170), ("lining_bronze", 300, 100), ("lining_stone", 200, 100),
    ("collar", 430, 130), ("collar_in", 430, 130), ("sleeve", 280, 360), ("hand", 150, 190), ("boot", 190, 300),
    ("head", 420, 330), ("hair", 400, 240), ("neck", 100, 60), ("belt", 760, 44), ("rim", 48, 48), ("gilt", 64, 64),
    ("buckle", 96, 96), ("emblem", 128, 128), ("sash", 90, 330),
]


def pack(panels):
    """Shelf packing, tallest first. Returns {name: (x, y from the top, w, h)}."""
    rects = {}
    x = y = shelf = 0
    for name, w, h in sorted(panels, key=lambda r: (-r[2], r[0])):
        w2, h2 = w + 2 * PAD, h + 2 * PAD
        if x + w2 > ATLAS:
            x, y, shelf = 0, y + shelf, 0
        if y + h2 > ATLAS:
            raise RuntimeError(f"the atlas is full at panel {name}")
        rects[name] = (x + PAD, y + PAD, w, h)
        x += w2
        shelf = max(shelf, h2)
    return rects


RECTS = pack(PANELS)


def atlas_uv(rect, u, v):
    x, y, w, h = RECTS[rect]
    return (x + u * w) / ATLAS, 1.0 - (y + (1.0 - v) * h) / ATLAS


# ---------------------------------------------------------------------------------------------------------------
# Painting. A canvas holds linear base colour, roughness, metal and height; a panel is painted in its own (u, v).


class Canvas:
    def __init__(self):
        self.rgb = np.zeros((ATLAS, ATLAS, 3))
        self.rgb[:] = K.srgb(TEAL)
        self.rough = np.full((ATLAS, ATLAS), 0.85)
        self.metal = np.zeros((ATLAS, ATLAS))
        self.height = np.zeros((ATLAS, ATLAS))  # in texels

    def panel(self, name):
        x, y, w, h = RECTS[name]
        sl = (slice(y - PAD, y + h + PAD), slice(x - PAD, x + w + PAD))
        uu = (np.arange(-PAD, w + PAD) + 0.5) / w
        vv = 1.0 - (np.arange(-PAD, h + PAD) + 0.5) / h
        uu, vv = np.clip(uu, 0.0, 1.0), np.clip(vv, 0.0, 1.0)  # the margin repeats the panel's edge
        U, V = np.meshgrid(uu, vv)
        return sl, U, V

    def fill(self, sl, colour, rough, metal=0.0, mask=None):
        col = np.array(K.srgb(colour)) if isinstance(colour, str) else colour
        if mask is None:
            self.rgb[sl] = col
            self.rough[sl] = rough
            self.metal[sl] = metal
        else:
            m = mask[..., None]
            self.rgb[sl] = self.rgb[sl] * (1 - m) + col * m
            self.rough[sl] = self.rough[sl] * (1 - mask) + rough * mask
            self.metal[sl] = self.metal[sl] * (1 - mask) + metal * mask


def lattice(shape, cell, seed):
    """Smooth value noise in -1..1 from a hash (no random state)."""
    h, w = shape
    gy, gx = np.mgrid[0:h, 0:w]
    fy, fx = gy / cell, gx / cell
    iy, ix = np.floor(fy).astype(np.int64), np.floor(fx).astype(np.int64)
    ty, tx = fy - iy, fx - ix
    ty, tx = ty * ty * (3 - 2 * ty), tx * tx * (3 - 2 * tx)

    def hv(a, b):
        n = (a * 374761393 + b * 668265263 + seed * 1442695041) & 0x7FFFFFFF
        n = ((n ^ (n >> 13)) * 1274126177) & 0x7FFFFFFF
        return (n & 0xFFFF) / 32767.5 - 1.0

    return (hv(iy, ix) * (1 - ty) * (1 - tx) + hv(iy, ix + 1) * (1 - ty) * tx + hv(iy + 1, ix) * ty * (1 - tx) + hv(iy + 1, ix + 1) * ty * tx)


def seg_dist(a, c, p0, p1):
    px, py = p1[0] - p0[0], p1[1] - p0[1]
    t = np.clip(((a - p0[0]) * px + (c - p0[1]) * py) / (px * px + py * py), 0, 1)
    return np.hypot(a - p0[0] - t * px, c - p0[1] - t * py)


def fold_band(along, across):
    """The embroidery: a chain of squares standing on their corners, each folded along its upright diagonal with one
    half filled. `along` and `across` are in units of the band's height; the band is across = 0..1. Returns 0..1."""
    a = along % 1.0
    c = across
    dia = np.abs(a - 0.5) + np.abs(c - 0.5)
    d = np.abs(dia - 0.34)  # the square's outline
    d = np.minimum(d, np.where(dia < 0.34, np.abs(a - 0.5), 1.0))  # the fold
    d = np.minimum(d, np.where(np.abs(a - 0.5) > 0.34, np.abs(c - 0.5), 1.0))  # the thread to the next square
    line = 1 - smoothstep(0.028, 0.06, d)
    flap = (1 - smoothstep(0.30, 0.34, dia)) * smoothstep(0.5, 0.53, a)  # the folded half
    rails = 1 - smoothstep(0.03, 0.06, np.minimum(np.abs(c - 0.06), np.abs(c - 0.94)))
    inside = smoothstep(-0.02, 0.02, c) * smoothstep(1.02, 0.98, c)
    return np.clip(np.maximum(np.maximum(line, flap * 0.85), rails), 0, 1) * inside


def wool(cv, name, colour, seed, weave=1.0):
    sl, U, V = cv.panel(name)
    shape = U.shape
    col = np.array(K.srgb(colour))
    mott = 1 + 0.07 * lattice(shape, 46, seed) + 0.04 * lattice(shape, 9, seed + 1)
    cv.rgb[sl] = col[None, None, :] * mott[..., None]
    cv.rough[sl] = 0.86 + 0.04 * lattice(shape, 14, seed + 2)
    cv.metal[sl] = 0
    gy, gx = np.mgrid[0:shape[0], 0:shape[1]]
    cv.height[sl] = weave * (0.25 * np.sin((gx + gy) * 2 * np.pi / 5.0) + 0.3 * lattice(shape, 3, seed + 3))
    return sl, U, V


def gild(cv, sl, mask, seed=0):
    """Lay gilt thread where `mask` is set: metal, raised, a fine diagonal lay."""
    shape = mask.shape
    gy, gx = np.mgrid[0:shape[0], 0:shape[1]]
    lay = 0.9 + 0.1 * np.sin((gx - gy) * 2 * np.pi / 3.0)
    col = np.array(K.srgb(GILT))[None, None, :] * lay[..., None]
    m = mask[..., None]
    cv.rgb[sl] = cv.rgb[sl] * (1 - m) + col * m
    cv.rough[sl] = cv.rough[sl] * (1 - mask) + 0.32 * mask
    cv.metal[sl] = np.maximum(cv.metal[sl], mask)
    cv.height[sl] = cv.height[sl] * (1 - mask) + 2.2 * mask


def leather(cv, name, colour, seed):
    sl, U, V = cv.panel(name)
    shape = U.shape
    col = np.array(K.srgb(colour))
    cv.rgb[sl] = col[None, None, :] * (1 + 0.10 * lattice(shape, 30, seed) + 0.05 * lattice(shape, 5, seed + 1))[..., None]
    cv.rough[sl] = 0.55 + 0.05 * lattice(shape, 11, seed + 2)
    cv.metal[sl] = 0
    cv.height[sl] = 0.5 * lattice(shape, 4, seed + 3)
    return sl, U, V


def paint():
    cv = Canvas()
    # cloak: border along the hem and both edges, and a large folded square between the shoulder blades
    sl, U, V = wool(cv, "cloak", TEAL_DEEP, 11)
    length = 1.52
    width = 2 * (0.165 + 0.275 * (1 - V) ** 0.9)
    band = 0.062
    xw = (U - 0.5) * width
    hem = fold_band(xw / band, (V * length - 0.012) / band)
    sband = 0.044
    side = fold_band((1 - V) * length / sband, ((0.5 - np.abs(U - 0.5)) * width - 0.012) / sband) * smoothstep(0.02, 0.10, 1 - V)
    corner = smoothstep(0.0, 0.02, (0.5 - np.abs(U - 0.5)) * width - 0.012 - sband)  # the hem band stops inside the side bands
    mask = np.maximum(hem * corner, side)
    cx, cy = xw, (1 - V) * length - 0.52
    dia = np.abs(cx) + np.abs(cy)
    big = np.abs(dia - 0.17)
    big = np.minimum(big, np.abs(dia - 0.125))
    big = np.minimum(big, np.where(dia < 0.125, np.abs(cx), 1.0))
    big = np.minimum(big, np.where((dia < 0.125) & (cx > 0), np.abs(cy), 1.0))
    mask = np.maximum(mask, 1 - smoothstep(0.004, 0.007, big))
    gild(cv, sl, mask)
    sl, U, V = wool(cv, "cloak_in", BRONZE_WARM, 21, weave=0.6)
    # coat: border along the hem and up both front edges to the waist
    sl, U, V = wool(cv, "coat", TEAL, 31)
    length = 1.45
    circ = 1.15 + 0.75 * np.clip(1 - V / 0.67, 0, 1) ** 0.85
    band = 0.05
    edge_d = (0.5 - np.abs(U - 0.5)) * circ
    hem = fold_band(U * 1.9 / band, (V * length - 0.010) / band)
    side = fold_band((1 - V) * length / band, (edge_d - 0.010) / band) * smoothstep(0.0, 0.04, 0.66 - V) * 1.0
    lapel = (1 - smoothstep(0.006, 0.010, np.abs(edge_d - 0.016))) * smoothstep(0.0, 0.03, V - 0.70)  # a single gilt line up the chest
    corner = smoothstep(0.0, 0.02, edge_d - 0.010 - band)
    gild(cv, sl, np.maximum(np.maximum(hem * corner, side), lapel))
    wool(cv, "lining_teal", TEAL_DEEP, 41, weave=0.5)
    # tunic and its second layer
    sl, U, V = wool(cv, "tunic", STONE, 51, weave=0.7)
    ribs = 0.5 + 0.5 * np.cos(U * 2 * np.pi * 36)
    cv.rgb[sl] *= (1 - 0.05 * ribs * smoothstep(0.75, 0.55, V))[..., None]  # soft vertical folds in the skirt
    neck = fold_band(U * 0.38 / 0.02, ((1 - V) * 1.25 - 0.004) / 0.02)
    hem = fold_band(U * 1.15 / 0.03, (V * 1.25 - 0.016) / 0.03)
    gild(cv, sl, np.maximum(neck, hem))
    sl, U, V = wool(cv, "overtunic", STONE_SHADE, 61, weave=0.7)
    gild(cv, sl, fold_band(U * 1.3 / 0.034, (V * 0.5 - 0.008) / 0.034))
    wool(cv, "lining_stone", STONE_SHADE, 62, weave=0.4)
    # mantle: border along the hem and the two front edges
    sl, U, V = wool(cv, "mantle", TEAL_LIGHT, 71)
    band = 0.036
    hem = fold_band(U * 1.75 / band, (V * 0.34 - 0.008) / band)
    edge_d = (0.5 - np.abs(U - 0.5)) * 1.75
    side = fold_band((1 - V) * 0.34 / band, (edge_d - 0.008) / band) * smoothstep(0.0, 0.06, 0.62 - V)
    corner = smoothstep(0.0, 0.01, edge_d - 0.008 - band)
    gild(cv, sl, np.maximum(hem * corner, side))
    wool(cv, "lining_bronze", BRONZE_WARM, 72, weave=0.5)
    sl, U, V = wool(cv, "sash", BRONZE_WARM, 73)
    gild(cv, sl, fold_band(U * 0.09 / 0.03, (V * 0.5 - 0.045) / 0.03) * smoothstep(0.02, 0.06, 0.5 - np.abs(U - 0.5)))
    # collar: gilt along the top edge, outside and inside
    for name, colour, seed in (("collar", TEAL, 81), ("collar_in", TEAL_LIGHT, 82)):
        sl, U, V = wool(cv, name, colour, seed)
        gild(cv, sl, fold_band(U * 0.75 / 0.026, ((1 - V) * 0.19 - 0.006) / 0.026))
    # sleeve: the cuff band; the last tenth of the panel is the rim turned inside
    sl, U, V = wool(cv, "sleeve", TEAL, 91)
    gild(cv, sl, fold_band(U * 0.46 / 0.034, ((V - 0.215) * 0.68) / 0.034))
    inside = smoothstep(0.17, 0.15, V)[..., None]
    cv.rgb[sl] = cv.rgb[sl] * (1 - inside) + np.array(K.srgb(TEAL_DEEP)) * inside
    # leather
    sl, U, V = leather(cv, "hand", LEATHER, 101)
    fingers = 1 - smoothstep(0.012, 0.03, np.abs(((U * 10 + 0.5) % 1.0) - 0.5))  # grooves between the fingers
    cv.height[sl] -= 1.5 * fingers * smoothstep(0.42, 0.34, V) * smoothstep(0.02, 0.08, V)
    sl, U, V = leather(cv, "boot", LEATHER, 111)
    sl, U, V = leather(cv, "belt", BRONZE, 121)
    stitch = (1 - smoothstep(0.03, 0.07, np.minimum(np.abs(V - 0.25), np.abs(V - 0.75)))) * (((U * 240) % 1.0) < 0.6)
    cv.rgb[sl] *= (1 + 0.5 * stitch)[..., None]
    # metal
    for name in ("gilt", "rim"):
        sl, U, V = cv.panel(name)
        cv.fill(sl, GILT, 0.32, 1.0)
        cv.height[sl] = 0
    sl, U, V = cv.panel("buckle")
    cv.fill(sl, BRONZE, 0.4, 1.0)
    cv.height[sl] = 0
    d = np.abs(np.abs(U - 0.5) + np.abs(V - 0.5) - 0.3)
    gild(cv, sl, 1 - smoothstep(0.03, 0.05, np.minimum(d, np.where(np.abs(U - 0.5) + np.abs(V - 0.5) < 0.3, np.abs(U - 0.5), 1.0))))
    sl, U, V = cv.panel("emblem")
    cv.fill(sl, GILT, 0.3, 1.0)
    dia = np.abs(U - 0.5) + np.abs(V - 0.5)
    fold = (1 - smoothstep(0.008, 0.016, np.abs(U - 0.5))) * (dia < 0.44)
    flap = smoothstep(0.5, 0.515, U) * (dia < 0.44)
    cv.rgb[sl] *= (1 - 0.45 * fold - 0.22 * flap * (1 - fold))[..., None]
    cv.rough[sl] = 0.3 + 0.14 * flap
    cv.height[sl] = 3.0 * flap - 2.0 * fold
    # skin and hair
    sl, U, V = cv.panel("head")
    shape = U.shape
    skin = np.array(K.srgb(SKIN))
    cv.rgb[sl] = skin[None, None, :] * (1 + 0.03 * lattice(shape, 25, 131))[..., None]
    cv.rough[sl] = 0.72
    cv.metal[sl] = 0
    cv.height[sl] = 0
    # the face is where the columns are dense: u -> angle from the front, v -> polar angle (see build_head)
    t = (U - 0.5) * 2 * np.pi
    ph = t - 0.42 * np.sin(t)
    th = ((0.95 - V) / 0.9 * 18 + 1) * np.pi / 20
    dz = np.cos(th)
    aph = np.abs(ph)
    dark = np.array(K.srgb(HAIR))
    brow = np.exp(-((dz - 0.19 + 0.06 * (aph - 0.42)) / 0.032) ** 2) * smoothstep(0.14, 0.22, aph) * smoothstep(0.74, 0.60, aph)
    eye = np.exp(-((dz - 0.055) / 0.05) ** 2) * np.exp(-((aph - 0.42) / 0.17) ** 2)
    lash = np.exp(-((dz - 0.10) / 0.014) ** 2) * smoothstep(0.22, 0.30, aph) * smoothstep(0.64, 0.54, aph)
    socket = np.exp(-((dz - 0.09) / 0.10) ** 2) * np.exp(-((aph - 0.40) / 0.26) ** 2)
    cv.rgb[sl] *= (1 - 0.28 * socket)[..., None]
    lips = np.exp(-((dz + 0.46) / 0.022) ** 2) * smoothstep(0.30, 0.20, aph)
    m = np.clip(0.9 * brow + 1.2 * eye + 0.8 * lash, 0, 1)[..., None]
    cv.rgb[sl] = cv.rgb[sl] * (1 - m) + dark * m
    cv.rgb[sl] = cv.rgb[sl] * (1 - 0.3 * lips[..., None]) + np.array(K.srgb("#8E5F52")) * 0.3 * lips[..., None]
    sl, U, V = cv.panel("neck")
    cv.fill(sl, SKIN, 0.72)
    cv.height[sl] = 0
    sl, U, V = cv.panel("hair")
    shape = U.shape
    strands = lattice((shape[0], shape[1]), 2, 141)
    gy, gx = np.mgrid[0:shape[0], 0:shape[1]]
    comb = np.sin(gx * 2 * np.pi / 9.0 + 7 * lattice(shape, 55, 142)) * (0.6 + 0.4 * lattice(shape, 18, 143))
    cv.rgb[sl] = np.array(K.srgb(HAIR))[None, None, :] * (1 + 0.14 * comb + 0.08 * strands)[..., None]
    cv.rough[sl] = 0.62
    cv.metal[sl] = 0
    cv.height[sl] = 0.8 * comb
    return cv


# ---------------------------------------------------------------------------------------------------------------
# Build

left_sleeve, left_hand = build_sleeve(), build_hand()
parts = [
    build_tunic(), build_overtunic(), build_coat(), build_belt(), build_mantle(), build_collar(), build_cloak(),
    left_sleeve, left_sleeve.mirrored("sleeve_R"), left_hand, left_hand.mirrored("hand_R"),
    build_boot(0.082, 0.0, 0.0), build_boot(-0.082, 0.055, -0.035), build_head(), build_hair(), build_emblem(), build_sash(),
]
by_name = {p.name: p for p in parts}


def bvh_of(part):
    v, f = part.polygons()
    return BVHTree.FromPolygons(v, f, all_triangles=False, epsilon=0.0)


# Cloth must not pass through what it hangs over, nor the head through the collar. (Where a sleeve leaves the coat and
# where the boots enter the tunic the join is inside another garment and is not checked.)
PAIRS = [
    ("cloak", "coat"), ("cloak", "mantle"), ("cloak", "sleeve_L"), ("cloak", "sleeve_R"), ("cloak", "hand_L"),
    ("cloak", "hand_R"), ("cloak", "boot_L"), ("cloak", "boot_R"), ("cloak", "tunic"), ("cloak", "overtunic"),
    ("coat", "tunic"), ("coat", "overtunic"), ("coat", "hand_L"), ("coat", "hand_R"), ("coat", "boot_L"), ("coat", "boot_R"),
    ("coat", "mantle"), ("overtunic", "tunic"), ("overtunic", "boot_L"), ("overtunic", "boot_R"),
    ("mantle", "collar"), ("mantle", "head"), ("mantle", "hand_L"), ("mantle", "hand_R"), ("collar", "head"), ("collar", "hair"),
    ("emblem", "coat"), ("emblem", "tunic"), ("belt", "hand_L"), ("belt", "hand_R"), ("belt", "overtunic"),
    ("sleeve_L", "coat_skirt"), ("sleeve_R", "coat_skirt"), ("sash", "coat"), ("sash", "hand_L"), ("sash", "sleeve_L"),
]
trees = {p.name: bvh_of(p) for p in parts}
# the coat below the belt, for the sleeves (above it they join the coat under the mantle)
skirt = Part("coat_skirt")
coat = by_name["coat"]
skirt.v = coat.v
skirt.f = [f for f in coat.f if max(coat.v[i][2] for i in f) < Z_WAIST - 0.02]
trees["coat_skirt"] = bvh_of(skirt)
problems = []
for a, b in PAIRS:
    hits = trees[a].overlap(trees[b])
    if hits:
        fa = by_name[a].f[hits[0][0]] if a in by_name else skirt.f[hits[0][0]]
        at = np.mean([by_name.get(a, skirt).v[i] for i in fa], axis=0).round(3).tolist()
        problems.append(f"{a} and {b} intersect ({len(hits)} face pairs, first near {at})")
if problems:
    raise RuntimeError("self-intersections: " + "; ".join(problems))

# one mesh
verts, sway, faces, uvs = [], [], [], []
for p in parts:
    base = len(verts)
    verts.extend(p.v)
    sway.extend(p.sway)
    for f, (rect, uv) in zip(p.f, p.uv):
        faces.append(tuple(base + i for i in f))
        uvs.append([atlas_uv(rect, u, v) for u, v in uv])
    print(f"  {p.name:<10} {p.triangles():>6} triangles")
low = min(v[2] for v in verts)
verts = [(x, y, z - low) for x, y, z in verts]  # the lowest point of the cloak is the model's floor
zs = [v[2] for v in verts]
if abs(low) > 0.01 or abs(max(zs) - HEIGHT) > 0.004:
    raise RuntimeError(f"the figure spans z = {min(zs):.3f} .. {max(zs):.3f} m, expected 0 .. {HEIGHT} m")
me = bpy.data.meshes.new("wanderer")
me.from_pydata(verts, [], faces)
me.validate()
if len(me.polygons) != len(faces):
    raise RuntimeError("the mesh lost faces in validation")
uv_layer = me.uv_layers.new(name="UV0")
flat = np.array([c for poly in uvs for c in poly], dtype=np.float32)
if len(flat) != len(me.loops):
    raise RuntimeError("missing UVs: the UV list does not cover every face corner")
if flat.min() < 0.0 or flat.max() > 1.0:
    raise RuntimeError("UVs outside the atlas")
uv_layer.data.foreach_set("uv", flat.ravel())
attr = me.attributes.new("_sway", "FLOAT", "POINT")
attr.data.foreach_set("value", np.array(sway, dtype=np.float32))
ob = bpy.data.objects.new("wanderer", me)
bpy.context.collection.objects.link(ob)
tris = sum(len(f) - 2 for f in faces)
print(f"  total      {tris:>6} triangles")
if tris > MAX_TRIANGLES:
    raise RuntimeError(f"{tris} triangles, budget {MAX_TRIANGLES}")

# ---------------------------------------------------------------------------------------------------------------
# Textures and material

cv = paint()


def half(a):
    return a.reshape(a.shape[0] // 2, 2, a.shape[1] // 2, 2, *a.shape[2:]).mean(axis=(1, 3))


def bake_occlusion(size):
    """Ambient occlusion of the figure on its own (it floats: no ground), on UV0."""
    scene = bpy.context.scene
    world = scene.world or bpy.data.worlds.new("World")
    scene.world = world
    world.light_settings.distance = 0.35
    scene.cycles.samples = 64
    img = bpy.data.images.new("wanderer_ao_bake", size, size, alpha=False)
    img.colorspace_settings.name = "Non-Color"
    tmp = bpy.data.materials.new("bake")
    tmp.use_nodes = True
    node = tmp.node_tree.nodes.new("ShaderNodeTexImage")
    node.image = img
    tmp.node_tree.nodes.active = node
    me.materials.append(tmp)
    for o in bpy.context.view_layer.objects:
        o.select_set(False)
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob
    scene.render.bake.margin = 6
    scene.render.bake.use_clear = True
    scene.render.bake.target = "IMAGE_TEXTURES"
    bpy.ops.object.bake(type="AO", uv_layer="UV0")
    px = np.empty(size * size * 4, dtype=np.float32)
    img.pixels.foreach_get(px)
    ao = px.reshape(size, size, 4)[::-1, :, 0].astype(np.float64)  # top row first, like the canvas
    me.materials.clear()
    bpy.data.materials.remove(tmp)
    bpy.data.images.remove(img)
    return ao


ob = K.finish(ob, smooth_angle=50)
me = ob.data
DATA = ATLAS // 2
if FAST:
    ao = np.ones((DATA, DATA))
else:
    ao = bake_occlusion(DATA)
    # soften the sampling noise, keep the result in a range that never crushes the cloth
    for axis in (0, 1):
        ao = (np.roll(ao, 1, axis) + 2 * ao + np.roll(ao, -1, axis)) / 4
    ao = np.clip(1 - (1 - ao) * 0.95, 0.22, 1.0)
    for name in ("rim", "gilt"):  # shared by many faces: no occlusion of any one of them
        x, y, w, h = (v // 2 for v in RECTS[name])
        ao[y - 2:y + h + 2, x - 2:x + w + 2] = 1.0

ao_full = np.repeat(np.repeat(ao, 2, axis=0), 2, axis=1)
base = cv.rgb * (1 - 0.4 * (1 - ao_full))[..., None]  # a part of the occlusion in the colour too: the sun does not see aoMap
gy, gx = np.gradient(cv.height)
nrm = np.stack([-gx * 0.6, gy * 0.6, np.ones_like(gx)], axis=-1)  # rows run downwards here, v upwards
nrm /= np.linalg.norm(nrm, axis=-1, keepdims=True)
nrm = half(nrm)
nrm /= np.linalg.norm(nrm, axis=-1, keepdims=True)
orm = np.stack([ao, half(cv.rough), half(cv.metal)], axis=-1)


def to_image(name, a, colorspace):
    h, w = a.shape[:2]
    rgba = np.concatenate([a[::-1], np.ones((h, w, 1))], axis=-1)
    return K._new_image(name, (w, h), rgba, colorspace)


img_base = to_image("wanderer_base", K._to_srgb(base), "sRGB")
img_orm = to_image("wanderer_orm", np.clip(orm, 0, 1), "Non-Color")
img_nrm = to_image("wanderer_normal", nrm * 0.5 + 0.5, "Non-Color")

mat, nt, bsdf = K._base_material("M_wanderer")
uvn = nt.nodes.new("ShaderNodeUVMap")
uvn.uv_map = "UV0"


def tex(img):
    n = nt.nodes.new("ShaderNodeTexImage")
    n.image = img
    nt.links.new(uvn.outputs["UV"], n.inputs["Vector"])
    return n


nt.links.new(tex(img_base).outputs["Color"], bsdf.inputs["Base Color"])
orm_node = tex(img_orm)
sep = nt.nodes.new("ShaderNodeSeparateColor")
nt.links.new(orm_node.outputs["Color"], sep.inputs["Color"])
nt.links.new(sep.outputs["Green"], bsdf.inputs["Roughness"])
nt.links.new(sep.outputs["Blue"], bsdf.inputs["Metallic"])
occ = nt.nodes.new("ShaderNodeGroup")
occ.node_tree = K._occlusion_group()
nt.links.new(sep.outputs["Red"], occ.inputs["Occlusion"])
nm = nt.nodes.new("ShaderNodeNormalMap")
nm.uv_map = "UV0"
nt.links.new(tex(img_nrm).outputs["Color"], nm.inputs["Color"])
nt.links.new(nm.outputs["Normal"], bsdf.inputs["Normal"])
me.materials.append(mat)

# ---------------------------------------------------------------------------------------------------------------
# Checks and export

K.check_mesh(ob, closed=False)
for o in bpy.context.view_layer.objects:
    o.select_set(False)
ob.select_set(True)
os.makedirs(os.path.dirname(os.path.abspath(OUT)), exist_ok=True)
bpy.ops.export_scene.gltf(
    filepath=OUT, export_format="GLB", use_selection=True, export_apply=True, export_yup=True,
    export_image_format="JPEG", export_jpeg_quality=90, export_texcoords=True, export_normals=True,
    export_tangents=False, export_materials="EXPORT", export_vertex_color="NONE", export_attributes=True,
    export_cameras=False, export_lights=False, export_animations=False, export_extras=False,
)
print(f"exported {OUT}: {tris} triangles, {os.path.getsize(OUT)} bytes")

# ---------------------------------------------------------------------------------------------------------------
# Review views (not shipped): the figure alone under a low warm sun and a dusk sky, like the game's light

if TURNTABLE:
    scene = bpy.context.scene
    TURNTABLE = os.path.abspath(TURNTABLE)  # Blender resolves a relative render path against the drive, not the cwd
    os.makedirs(TURNTABLE, exist_ok=True)
    world = scene.world or bpy.data.worlds.new("World")
    scene.world = world
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.42, 0.45, 0.55, 1)
    world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.9
    sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN"))
    sun.data.energy = 4.0
    sun.data.color = (1.0, 0.73, 0.42)
    sun.data.angle = math.radians(3)
    bpy.context.collection.objects.link(sun)
    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
    cam.data.lens = 60
    bpy.context.collection.objects.link(cam)
    scene.camera = cam
    scene.cycles.samples = 48
    scene.cycles.use_denoising = True
    scene.render.resolution_x, scene.render.resolution_y = 560, 900
    scene.render.image_settings.file_format = "PNG"
    scene.view_settings.view_transform = "Standard"
    target = Vector((0, 0.05, 0.92))
    # azimuth of the camera round the figure (0 = in front of it), its height and distance
    views = [("1-front", 0, 1.3, 3.6, 0.92), ("2-three-quarter", 40, 1.3, 3.6, 0.92), ("3-side", 90, 1.3, 3.6, 0.92),
             ("4-back", 180, 1.3, 3.6, 0.92), ("5-game-camera", 180, 3.0, 4.6, 0.92), ("6-head", 25, 1.62, 1.15, 1.5)]
    for name, az, hgt, dist, look in views:
        target = Vector((0, 0.05, look))
        a = math.radians(az)
        cam.location = (math.sin(a) * dist, -math.cos(a) * dist, hgt)
        cam.rotation_euler = (target - cam.location).to_track_quat("-Z", "Y").to_euler()
        s = math.radians(az + 125)  # the sun stays behind the viewer's right shoulder ... a quarter round
        sd = Vector((math.sin(s), -math.cos(s), 0.32))
        sun.rotation_euler = sd.to_track_quat("Z", "Y").to_euler()
        scene.render.filepath = os.path.join(TURNTABLE, f"turntable-{name}.png")
        bpy.ops.render.render(write_still=True)
    print(f"turntable in {TURNTABLE}")
