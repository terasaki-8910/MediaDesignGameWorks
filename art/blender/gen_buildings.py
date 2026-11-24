"""The background city's buildings, textured and weathered: public/assets/buildings.glb.

    node <game3d>/scripts/blender.mjs art/blender/gen_buildings.py -- --out public/assets/buildings.glb --table src/game/foldcity/units.ts

Every building of the folded city is one of these units, each as <name>_lod0 (near) and <name>_lod1 (far), drawn by the
game in the city's one batch. A lot of the city's plan asks for a box (a length, a depth, a height); the game picks the
unit of the lot's family whose own proportions come nearest and fits it to the box (morphcity.ts), so a unit is made in
many sizes rather than stretched: `--table` writes their measures for the game (units.ts).
  h<w>_<h><seed>  a row of two to four Haussmann houses between party walls, each house with its own storeys, eaves,
                  stone, front (one of two), roof (mansard, tall pavilion roof, two-tier mansard, an attic storey behind
                  a terrace, a flat roof behind a parapet), dormer rhythm and chimney stacks; some end in a blank gable
                  wall with its flues, some in a corner rotunda under a slate dome. Lengths 26 to 53 m, heights 11 to 46 m.
  t<h>            a tower house: a slender house under a stepped stone crown between two lower wings
  d<w>_<h>        an Art Deco mass: plinth, giant piers before bands of glazing, setbacks with parapets, a stepped crown
  deco_hall, deco_tower, belfry, dome, cathedral   the landmarks, each also as <name>_low (a lower building of the
                  same kind, for the lots where the plan allows only about half the height)
  monument, fountain, pier_foot   the plazas' centrepieces and the feet of the play area's piers (one model each)

Materials: eight tiled layers of 512 x 256 px, shared by every building (the game puts them into one array texture and
draws everything with the city's one material, one draw call). They are made here from Poly Haven photographs (CC0, see
docs/asset-manifest.json) and carried in this file as plain images on a small mesh, `tx_set`:
  0 limestone   sandstone_blocks_08, less saturated, at the city's stone colour                  6.0 x 6.0 m a tile
  1 facade      the same stone with a rusticated ground floor arcade and two storeys of windows painted in: surrounds,
                head mouldings, shaded reveals, glass, curtains, shutters, sills                 11.6 x 10.8 m, four bays
  2 slate       grey_roof_tiles_02 at the city's slate colour, with broad patches               8.0 x 8.0 m
  3 zinc        blue_metal_plate, nearly grey, at the city's zinc colour, standing seams        4.6 x 4.6 m
  4 glazing     the Art Deco glazing: panes in bronze frames, each pane its own tone           5.8 x 7.4 m
  5 facade_b    a second front: shop fronts under a fascia, a carriage door, windows between open shutters, windows
                under keystones                                                                 11.6 x 10.8 m, four bays
  6 render      grey_plaster_03 at a render's colour: party walls, gables, chimney stacks, courts 7.0 x 7.0 m
  7 grand       a monumental order: a tall arched window between pilasters to a bay, an attic of square windows under
                its cornice (the landmarks' fronts, a cathedral's lancets)                     11.6 x 11.6 m, four bays
Each layer has a weathering mask in its alpha: where dirt gathers first (the staining of large_sandstone_blocks and the
mould of concrete_wall_003 for stone and render, rain streaks under sills and mouldings for the fronts, blotches and
runs for the roofs). The images hold the colours as JPEG; the masks are packed into the channels of three more images.

Per vertex: COLOR_0's rgb tints the layer (a house's own stone, a darker ground floor), its alpha says which layer and
how weathered: alpha = (layer + 0.05 + 0.9 * weather) / 16, weather 0 to 1 rising under cornices, balconies and sills,
at the foot of the ground floor, along the eaves, down a gable wall and at the top of chimney stacks (set from the
geometry, a value a corner). Alpha 1 is a plain colour (glass, rails, pots, gilt). The game multiplies the weather by
the layer's mask, so the same stone streaks differently on every wall (atmosphere.ts).

No normal map: the walls are seen from 120 m and more, where a texel of it is a fraction of a pixel, and the city's
light has no specular term to show it. Origin: ground centre of the footprint; +X is the long side. Deterministic:
every random number comes from a seed written here.
"""
import math
import os
import random
import sys

import bpy
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import fc_kit as K  # noqa: E402
from city_kit import BAY, FACES, GILT, GLASS, STONE_RGB, SLATE_RGB, ZINC_RGB, Shell, finished, mul  # noqa: E402

opts = K.script_args()
OUT = opts.get("out", "public/assets/buildings.glb")
TABLE = opts.get("table")
K.reset()

TW, TH = 512, 256
NAMES = ("limestone", "facade", "slate", "zinc", "glazing", "facade_b", "render", "grand")
LIME, FACADE, SLATE, ZINC, GLAZING, FACADE_B, RENDER, GRAND = range(8)
# metres one tile covers (u, v)
TILE_M = {LIME: (6.0, 6.0), SLATE: (8.0, 8.0), ZINC: (4.6, 4.6), GLAZING: (5.8, 7.4), RENDER: (7.0, 7.0)}
GROUND_H, STOREY_H = 4.64, 3.08  # the facade tiles' bands, in metres: 110 + 73 + 73 rows of 256
BANDS = {"ground": (0, 110), "a": (110, 183), "b": (183, 256)}
TALL_H, ATTIC_H = 8.0, 3.64  # the grand tile's bands: 176 + 80 rows
GBANDS = {"tall": (0, 176), "attic": (176, 256)}
RENDER_RGB = (0.60, 0.575, 0.53)

POT = K.srgb("#8A7E73")
SOOT = (0.84, 0.81, 0.78)
IRON = K.srgb("#6E6961")  # a rail seen from afar: iron bars and the stone behind them, as one tone
LEAD = (0.84, 0.86, 0.9)  # the zinc layer as lead sheet (a dome)
WOOD = K.srgb("#4F463D")
WATER = K.srgb("#6E8A90")


# ---------------------------------------------------------------------------------------------------------------------
# the texture layers
# ---------------------------------------------------------------------------------------------------------------------
def photo(name):
    """A Poly Haven diffuse map as linear RGB [row from the bottom, column, 3]."""
    img = bpy.data.images.load(os.path.join(K.TEXTURES, name, f"{name}_diff_1k.jpg"))
    w, h = img.size
    a = K._to_linear(K._pixels(img)[:, :3].astype(np.float64)).reshape(h, w, 3)
    bpy.data.images.remove(img)
    return a


def pool(a, w, h):
    """Mean over whole blocks: [H, W, ...] to [h, w, ...]."""
    H, W = a.shape[:2]
    return a.reshape(h, H // h, w, W // w, -1).mean(axis=(1, 3))


def blur(a, sx, sy):
    """A Gaussian blur that wraps (the result still tiles); sx, sy in pixels."""
    h, w = a.shape[:2]
    fy = np.fft.fftfreq(h)[:, None]
    fx = np.fft.fftfreq(w)[None, :]
    g = np.exp(-2.0 * math.pi ** 2 * ((sx * fx) ** 2 + (sy * fy) ** 2))
    if a.ndim == 3:
        g = g[:, :, None]
    return np.real(np.fft.ifft2(np.fft.fft2(a, axes=(0, 1)) * g, axes=(0, 1)))


def stretch(a, lo=2.0, hi=98.0):
    p0, p1 = np.percentile(a, [lo, hi])
    return np.clip((a - p0) / max(p1 - p0, 1e-9), 0.0, 1.0)


def luma(a):
    return a @ np.array([0.2126, 0.7152, 0.0722])


def toned(a, target_srgb, saturation, contrast=1.0):
    """The photo with its mean moved to a colour (linear gains), less saturated, its contrast about the mean scaled."""
    grey = luma(a)[..., None]
    a = grey + (a - grey) * saturation
    target = K._to_linear(np.array(target_srgb))
    a = a * (target / a.reshape(-1, 3).mean(axis=0))
    return np.clip(target + (a - target) * contrast, 0.0, 1.0)


def lin(*rgb):
    return K._to_linear(np.array(rgb, dtype=np.float64))


class Front:
    """A front being painted: `f` its colours (linear), `m` its weathering mask, both [TH, TW]; a bay is a quarter of
    the width, `py` pixels a metre up."""

    def __init__(self, f, m, rng, height_m):
        self.f, self.m, self.rng = f, m, rng
        self.px, self.py = TW / (4 * BAY), TH / height_m
        self.bay = TW // 4
        self.stone = lin(*STONE_RGB)
        self.glass = lin(0.36, 0.368, 0.38)  # (nearly neutral: a front of windows stays stone-coloured from afar)

    @staticmethod
    def rect(x0, x1, y0, y1):
        return slice(max(int(round(y0)), 0), min(int(round(y1)), TH)), slice(max(int(round(x0)), 0), min(int(round(x1)), TW))

    def fill(self, x0, x1, y0, y1, colour):
        self.f[self.rect(x0, x1, y0, y1)] = colour

    def shade(self, x0, x1, y0, y1, k):
        self.f[self.rect(x0, x1, y0, y1)] *= k

    def opening(self, b, base, x0m, x1m, z0m, z1m, arch=False, kind="window", surround=True, bars=(0.68,)):
        """One opening of bay `b` in the band that starts at row `base`: surround, head moulding, reveal, glass or
        shutters or a door. Returns its pixel box."""
        px, py, f, m, rng = self.px, self.py, self.f, self.m, self.rng
        x0, x1 = b * self.bay + x0m * px, b * self.bay + x1m * px
        y0, y1 = base + z0m * py, base + z1m * py
        if surround:
            self.fill(x0 - 0.17 * px, x1 + 0.17 * px, y0 - (0.0 if kind in ("door", "shop") else 0.14 * py), y1 + 0.2 * py, self.stone * 1.1)
            self.fill(x0 - 0.3 * px, x1 + 0.3 * px, y1 + 0.2 * py, y1 + 0.36 * py, self.stone * 1.15)  # its head moulding
            self.fill(x0 - 0.3 * px, x1 + 0.3 * px, y1 + 0.12 * py, y1 + 0.2 * py, self.stone * 0.6)  # and the line of shade under it
        ya, yb, xa, xb = int(round(y0)), min(int(round(y1)), TH), int(round(x0)), int(round(x1))
        ys, xs = np.mgrid[ya:yb, xa:xb]
        t = ((ys - y0) / max(y1 - y0, 1.0))[..., None]
        tone = 0.84 + 0.3 * rng.random()
        if kind == "door":
            pane = np.broadcast_to(lin(0.29, 0.25, 0.215) * tone, t.shape[:2] + (3,)).copy()
            pane[(xs - xa) % max(int(0.45 * px), 2) == 0] *= 0.8  # its panels
        elif kind == "shutters":
            pane = lin(0.5, 0.52, 0.52) * tone * (0.86 + 0.14 * ((ys // 2) % 2))[..., None]
        else:
            pane = self.glass * tone * (0.72 + 0.72 * t)  # the glass takes the sky: lighter towards its head
            if kind == "curtain":
                drawn = (t[..., 0] < 0.5 + 0.35 * rng.random()) & (np.abs((xs - (x0 + x1) / 2) / (x1 - x0)) > 0.08)
                pane[drawn] = pane[drawn] * 0.4 + lin(0.67, 0.64, 0.58) * 0.6
            if kind == "blind":
                down = t[..., 0] > 0.35 + 0.4 * rng.random()
                pane[down] = lin(0.62, 0.6, 0.55) * tone
            if kind == "shop":
                pane = pane * 0.82 + lin(0.5, 0.42, 0.3) * 0.18 * (1.0 - t)  # a lit interior, faintly
        inside = np.ones(t.shape[:2], bool)
        if arch:
            r = (x1 - x0) / 2
            cy = y1 - r * py / px
            inside = (ys < cy) | (((xs - (x0 + x1 - 1) / 2) / r) ** 2 + ((ys - cy) / (r * py / px)) ** 2 < 1.0)
        if kind in ("window", "curtain", "shop", "blind"):
            frame = xs == int(round((x0 + x1) / 2))
            for bar in bars:
                frame |= ys == int(round(y0 + (y1 - y0) * bar))
            pane[frame] = lin(0.52, 0.52, 0.52) if kind != "shop" else pane[frame] * 0.6
        shade = np.ones(t.shape[:2])
        shade[ys > y1 - 0.26 * py] = 0.6  # the reveal's shade: under the head, and down one jamb
        jamb = xs < x0 + 0.11 * px
        shade[jamb] = np.minimum(shade[jamb], 0.72)
        f[ya:yb, xa:xb][inside] = (pane * shade[..., None])[inside]
        m[ya:yb, xa:xb][inside] = 0.0  # glass does not streak
        return x0, x1, y0, y1

    def streaks(self, x0, x1, y1, depth, strength):
        """Rain under a sill or a moulding: runs of different length, strongest just under it (colour and mask)."""
        ya, yb = max(int(round(y1 - depth * self.py)), 0), int(round(y1))
        xa, xb = max(int(round(x0)), 0), min(int(round(x1)), TW)
        if yb <= ya or xb <= xa:
            return
        col = (0.3 + 0.7 * self.rng.random(xb - xa))[None, :]
        t = np.linspace(0.0, 1.0, yb - ya)[:, None] ** 1.6
        run = np.clip(t * col * 1.4 - (1.0 - col) * 0.5, 0.0, 1.0)
        self.f[ya:yb, xa:xb] *= (1.0 - 0.13 * strength * run)[..., None]
        self.m[ya:yb, xa:xb] = np.maximum(self.m[ya:yb, xa:xb], 0.45 + 0.55 * run * strength)

    def sill(self, x0, x1, y0, depth=1.0, strength=1.0):
        px, py = self.px, self.py
        self.fill(x0 - 0.22 * px, x1 + 0.22 * px, y0 - 0.26 * py, y0 - 0.1 * py, self.stone * 1.15)
        self.fill(x0 - 0.22 * px, x1 + 0.22 * px, y0 - 0.33 * py, y0 - 0.26 * py, self.stone * 0.66)
        self.streaks(x0 - 0.15 * px, x1 + 0.15 * px, y0 - 0.33 * py, depth, strength)

    def course(self, y0, y1, streak=0.9, strength=0.7):
        """A string course across the whole front: a light band over a line of shade, the wall under it streaked."""
        self.fill(0, TW, y0, y1, self.stone * 1.1)
        self.fill(0, TW, y0 - 0.1 * self.py, y0, self.stone * 0.58)
        self.streaks(0, TW, y0 - 0.1 * self.py, streak, strength)


def noise(rng, sx, sy):
    """Soft tiling noise in 0..1 at a scale of sx, sy pixels."""
    return stretch(blur(rng.random((TH, TW)), sx, sy), 1.0, 99.0)


def layers():
    """The layers as linear RGB [8, TH, TW, 3] and their masks [8, TH, TW] (rows from the bottom)."""
    rng = np.random.default_rng(2411)
    n = len(NAMES)
    rgb = np.zeros((n, TH, TW, 3))
    mask = np.zeros((n, TH, TW))

    # 0 limestone: the photo's ashlar at the city's stone colour; block by block a little apart in tone (soft patches)
    stone_full = toned(photo("sandstone_blocks_08"), STONE_RGB, 0.55, 1.15)
    stone = pool(stone_full, TW, TH)
    stone *= (0.955 + 0.09 * noise(rng, 22, 9))[..., None]
    rgb[LIME] = stone
    # where dirt gathers: the staining of a weathered wall (large_sandstone_blocks) and the mould of an old one
    # (concrete_wall_003), dark = dirty; and the runs rain leaves down a wall
    stain = 1.0 - stretch(blur(luma(pool(photo("large_sandstone_blocks"), TW, TH)), 1.2, 1.2))
    mould = 1.0 - stretch(blur(luma(pool(photo("concrete_wall_003"), TW, TH)), 1.0, 2.5))
    runs = noise(rng, 2.0, 40.0)
    mask[LIME] = stretch(0.42 * stain + 0.28 * mould + 0.3 * runs)

    # 2 slate: the photo's slates at the city's slate colour, broad patches of weathering over them
    slate = pool(toned(photo("grey_roof_tiles_02"), SLATE_RGB, 0.6, 1.0), TW, TH)
    slate *= (0.93 + 0.14 * noise(rng, 40, 20))[..., None]
    rgb[SLATE] = slate
    mask[SLATE] = stretch(0.5 * noise(rng, 26, 14) + 0.5 * noise(rng, 3.0, 30.0))

    # 3 zinc: a painted steel plate with its seams and scuffs, taken nearly grey at the city's zinc colour
    zinc = pool(toned(photo("blue_metal_plate"), ZINC_RGB, 0.22, 0.55), TW, TH)
    zinc *= (0.96 + 0.08 * noise(rng, 50, 24))[..., None]
    for x in range(0, TW, TW // 8):  # standing seams every 0.58 m: a line of shade and the roll's light beside it
        zinc[:, x:x + 2] *= 0.88
        zinc[:, x + 2:x + 4] *= 1.04
    rgb[ZINC] = zinc
    mask[ZINC] = stretch(0.4 * noise(rng, 30, 16) + 0.6 * noise(rng, 2.5, 36.0))

    # 6 render: a lime render gone grey, patched and mouldy (party walls, gables, stacks)
    render = pool(toned(photo("grey_plaster_03"), RENDER_RGB, 0.5, 1.5), TW, TH)
    render *= (0.9 + 0.2 * noise(rng, 34, 22))[..., None]
    render *= (1.0 - 0.16 * mould ** 1.5)[..., None]
    rgb[RENDER] = render
    mask[RENDER] = stretch(0.5 * mould + 0.2 * stain + 0.3 * noise(rng, 2.0, 46.0))

    def base(height_m):
        """Two repeats of the stone each way and the start of its mask."""
        f = np.tile(pool(stone_full, TW // 2, TH // 2), (2, 2, 1))
        f *= (0.96 + 0.08 * noise(rng, 30, 12))[..., None]
        m = 0.4 * np.tile(pool(stain[..., None], TW // 2, TH // 2)[..., 0], (2, 2)) + 0.12 * mould + 0.22 * noise(rng, 2.0, 30.0)
        return Front(f, m, rng, height_m)

    # 1 facade: a rusticated ground floor arcade (one bay a door of dark wood, one a shop) under a string course; a
    # storey of tall windows down to the floor (they open on a balcony); a storey of windows over sills, one shuttered
    p = base(GROUND_H + 2 * STOREY_H)
    py = p.py
    g0, g1 = BANDS["ground"]
    for z in np.arange(0.52, GROUND_H - 0.5, 0.52):
        p.shade(0, TW, g0 + z * py - 1, g0 + z * py + 1, 0.7)
    p.shade(0, TW, g0, g0 + 0.55 * py, 0.84)
    p.m[p.rect(0, TW, g0, g0 + 1.0 * py)] += 0.35
    for b, kind in enumerate(("window", "door", "shop", "window")):
        p.opening(b, g0, 0.42, 2.48, 0.0 if kind != "window" else 0.75, 3.55, arch=True, kind=kind)
    p.course(g1 - 0.32 * py, g1)
    a0, _ = BANDS["a"]
    for b, kind in enumerate(("curtain", "window", "window", "curtain")):
        p.opening(b, a0, 0.82, 2.08, 0.12, 2.6, kind=kind)
    b0, _ = BANDS["b"]
    for b, kind in enumerate(("window", "curtain", "shutters", "window")):
        x0, x1, y0, _y1 = p.opening(b, b0, 0.85, 2.05, 0.85, 2.55, kind=kind)
        p.sill(x0, x1, y0)
    rgb[FACADE], mask[FACADE] = p.f, np.clip(p.m, 0.0, 1.0)

    # 5 facade_b: shop fronts under a dark fascia, one bay a carriage door; a storey of narrower windows between open
    # shutters; a storey of windows under keystones, one with its blind down
    p = base(GROUND_H + 2 * STOREY_H)
    p.shade(0, TW, g0, g0 + 0.7 * py, 0.8)
    p.m[p.rect(0, TW, g0, g0 + 1.0 * py)] += 0.35
    fascia = lin(0.33, 0.325, 0.31)
    for b, kind in enumerate(("shop", "shop", "door", "shop")):
        if kind == "door":
            p.opening(b, g0, 0.55, 2.35, 0.0, 3.5, arch=True, kind="door")
            continue
        x0, x1, y0, y1 = p.opening(b, g0, 0.3, 2.6, 0.55, 3.2, kind="shop", surround=False, bars=(0.78,))
        p.fill(x0 - 0.1 * p.px, x1 + 0.1 * p.px, y1, y1 + 0.5 * py, fascia * (0.9 + 0.3 * rng.random()))
        p.fill(x0, x1, y0 - 0.5 * py, y0, p.stone * 0.8)  # the stall riser
        if b == 1:  # an awning let down over one shop: pale cloth, its shade under it
            p.fill(x0 - 0.1 * p.px, x1 + 0.1 * p.px, y1 - 0.75 * py, y1 + 0.1 * py, lin(0.69, 0.67, 0.62))
            p.shade(x0, x1, y1 - 1.2 * py, y1 - 0.75 * py, 0.7)
    p.course(g1 - 0.3 * py, g1)
    for b, kind in enumerate(("window", "curtain", "window", "window")):
        x0, x1, y0, y1 = p.opening(b, a0, 0.95, 1.95, 0.12, 2.55, kind=kind)
        for xa, xb in ((x0 - 0.52 * p.px, x0 - 0.2 * p.px), (x1 + 0.2 * p.px, x1 + 0.52 * p.px)):  # the shutters, folded back
            sl = p.rect(xa, xb, y0, y1)
            rows = np.arange(sl[0].start, sl[0].stop)[:, None]
            p.f[sl] = lin(0.55, 0.555, 0.54) * (0.84 + 0.16 * ((rows // 2) % 2))[..., None]
    for b, kind in enumerate(("curtain", "blind", "window", "curtain")):
        x0, x1, y0, y1 = p.opening(b, b0, 0.9, 2.0, 0.82, 2.45, kind=kind)
        p.fill((x0 + x1) / 2 - 0.16 * p.px, (x0 + x1) / 2 + 0.16 * p.px, y1 + 0.2 * py, y1 + 0.55 * py, p.stone * 1.15)  # the keystone
        p.sill(x0, x1, y0, 0.9, 0.9)
    rgb[FACADE_B], mask[FACADE_B] = p.f, np.clip(p.m, 0.0, 1.0)

    # 7 grand: a pilaster at every bay line, a tall arched window with stone transoms between; over the entablature an
    # attic of square windows; the cornice's shade and the rain under it
    p = base(TALL_H + ATTIC_H)
    py = p.py
    t0, t1 = GBANDS["tall"]
    p.shade(0, TW, t0, t0 + 0.9 * py, 0.82)
    p.m[p.rect(0, TW, t0, t0 + 1.2 * py)] += 0.35
    for b in range(4):
        p.opening(b, t0, 0.78, 2.12, 1.25, 6.7, arch=True, kind="window" if b != 2 else "curtain", bars=(0.3, 0.62))
        xl = b * p.bay
        p.fill(xl - 0.26 * p.px, xl + 0.26 * p.px, t0 + 0.9 * py, t1 - 0.6 * py, p.stone * 1.09)  # the pilaster (half on each side of the bay line)
        p.fill(xl + 0.26 * p.px, xl + 0.34 * p.px, t0 + 0.9 * py, t1 - 0.6 * py, p.stone * 0.7)
        p.fill(TW - 0.26 * p.px if b == 0 else 0, TW if b == 0 else 0, t0 + 0.9 * py, t1 - 0.6 * py, p.stone * 1.09)
    p.course(t1 - 0.55 * py, t1, 1.4, 0.9)
    a0g, a1g = GBANDS["attic"]
    for b in range(4):
        x0, x1, y0, _y1 = p.opening(b, a0g, 0.9, 2.0, 0.9, 2.25, kind="window" if b % 2 else "curtain")
        p.sill(x0, x1, y0, 0.7, 0.8)
    p.fill(0, TW, a1g - 0.42 * py, a1g, p.stone * 1.12)
    p.fill(0, TW, a1g - 0.52 * py, a1g - 0.42 * py, p.stone * 0.58)
    rgb[GRAND], mask[GRAND] = p.f, np.clip(p.m, 0.0, 1.0)

    # 4 glazing (Art Deco): panes 0.725 x 0.925 m in bronze frames, each taking the sky a little differently; every
    # fourth row a spandrel panel of dark bronze (the floors behind the glass)
    g = np.zeros((TH, TW, 3))
    cw, rh = TW // 8, TH // 8
    bronze = lin(0.36, 0.35, 0.32)
    glass = lin(0.36, 0.368, 0.38)
    for r in range(8):
        for c in range(8):
            t = np.linspace(0.0, 1.0, rh)[:, None, None]
            if r % 4 == 0:
                cell = np.broadcast_to(bronze * (1.05 + 0.2 * rng.random()), (rh, cw, 3)).copy()
            else:
                cell = np.broadcast_to(glass * (1.1 + 0.4 * rng.random()) * (0.85 + 0.4 * t), (rh, cw, 3)).copy()
            cell[:2] = bronze
            cell[:, :3] = bronze
            g[r * rh:(r + 1) * rh, c * cw:(c + 1) * cw] = cell
    rgb[GLAZING] = g
    mask[GLAZING] = 0.5 * noise(rng, 3.0, 26.0)
    return np.clip(rgb, 0.0, 1.0), np.clip(mask, 0.0, 1.0)


def image(name, rgb_srgb):
    """An sRGB image [TH, TW, 3] (rows from the bottom) packed into the file."""
    rgba = np.concatenate([rgb_srgb, np.ones((TH, TW, 1))], axis=2).astype(np.float32)
    im = bpy.data.images.new(name, TW, TH, alpha=False)
    im.colorspace_settings.name = "sRGB"
    im.pixels.foreach_set(rgba.ravel())
    im.pack()
    return im


def carrier(name, im):
    """A material that only carries an image into the file."""
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Roughness"].default_value = 0.85
    tex = mat.node_tree.nodes.new("ShaderNodeTexImage")
    tex.image = im
    mat.node_tree.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    return mat


def texture_set():
    """`tx_set`: eleven small quads below the ground, one for each image (eight layers, three of masks)."""
    rgb, mask = layers()
    for k, n in enumerate(NAMES):
        lum = luma(rgb[k].reshape(-1, 3)).mean()
        print(f"LAYER {k} {n}: mean linear {rgb[k].reshape(-1, 3).mean(axis=0).round(4).tolist()}, luminance {lum:.4f}, mask mean {mask[k].mean():.3f}")
    images = [image(f"tx_{n}", K._to_srgb(rgb[k])) for k, n in enumerate(NAMES)]
    zero = np.zeros((TH, TW))
    for j, tag in enumerate("abc"):
        ch = [mask[3 * j + c] if 3 * j + c < len(NAMES) else zero for c in range(3)]
        images.append(image(f"tx_mask_{tag}", np.stack(ch, axis=2)))
    import bmesh
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new("UV0")
    for k in range(len(images)):
        f = bm.faces.new([bm.verts.new((k * 0.3 + dx, dy, -1.0)) for dx, dy in ((0, 0), (0.2, 0), (0.2, 0.1), (0, 0.1))])
        f.material_index = k
        for loop, st in zip(f.loops, ((0, 0), (1, 0), (1, 1), (0, 1))):
            loop[uv].uv = st
    me = bpy.data.meshes.new("tx_set")
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new("tx_set", me)
    bpy.context.collection.objects.link(ob)
    for im in images:
        me.materials.append(carrier("M_" + im.name, im))
    return ob


# ---------------------------------------------------------------------------------------------------------------------
# the geometry
# ---------------------------------------------------------------------------------------------------------------------
def code(layer, weather):
    return (layer + 0.05 + 0.9 * min(1.0, max(0.0, weather))) / 16.0


class TShell(Shell):
    """Shell with faces that show a tiled layer: `tface` and what is built from it. Shell's own faces (alpha 1) are
    plain colours."""

    def tface(self, pts, layer, tint=(1.0, 1.0, 1.0), w=0.0, uvs=None, ws=None, tints=None):
        """A face showing `layer`, tinted; `w` its weathering (or `ws` one a corner). Without `uvs` the layer lies on it
        at its own scale, by the face's own plane: U along the horizontal, V up the wall or up the slope."""
        f = self.bm.faces.new([self.bm.verts.new((p[0] + self.o[0], p[1] + self.o[1], p[2])) for p in pts])
        f.normal_update()
        n = f.normal
        if uvs is None:
            tw, th = TILE_M.get(layer, (6.0, 6.0))
            if abs(n.z) > 0.999:
                t, b = (1.0, 0.0, 0.0), (0.0, 1.0, 0.0)
            else:
                l = math.hypot(n.x, n.y)
                t = (-n.y / l, n.x / l, 0.0)
                b = (n.y * t[2] - n.z * t[1], n.z * t[0] - n.x * t[2], n.x * t[1] - n.y * t[0])
            uvs = [((p[0] * t[0] + p[1] * t[1]) / tw, (p[0] * b[0] + p[1] * b[1] + p[2] * b[2]) / th) for p in pts]
        for k, loop in enumerate(f.loops):
            c = tints[k] if tints else tint
            loop[self.col] = (*c, code(layer, ws[k] if ws else w))
            loop[self.uv].uv = uvs[k]
            loop[self.nrm] = (0.0, 0.0, 0.0)

    def twall(self, p0, p1, z0, z1, layer, tint=(1.0, 1.0, 1.0), w0=0.0, w1=0.0, foot=None):
        """An upright quad from p0 to p1 (left to right seen from outside); weathering w0 at its foot, w1 at its head."""
        low = tint if foot is None else mul(tint, foot)
        self.tface([(p0[0], p0[1], z0), (p1[0], p1[1], z0), (p1[0], p1[1], z1), (p0[0], p0[1], z1)], layer, tint, ws=[w0, w0, w1, w1], tints=[low, low, tint, tint])

    def tbox(self, lo, hi, layer, tint=(1.0, 1.0, 1.0), top=None, top_tint=None, w0=0.0, w1=0.0, wt=0.0, bottom=False, walls="SNEW", foot=None, lid=True):
        """A box showing `layer` on its walls (weathering from w0 at the foot to w1 at the head) and `top` (a layer) above."""
        (x0, y0, z0), (x1, y1, z1) = lo, hi
        for side, a, b in (("S", (x0, y0), (x1, y0)), ("E", (x1, y0), (x1, y1)), ("N", (x1, y1), (x0, y1)), ("W", (x0, y1), (x0, y0))):
            if side in walls:
                self.twall(a, b, z0, z1, layer, tint, w0, w1, foot)
        if lid:
            self.tface([(x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1)], layer if top is None else top, top_tint or tint, wt)
        if bottom:
            self.tface([(x0, y1, z0), (x1, y1, z0), (x1, y0, z0), (x0, y0, z0)], layer, mul(tint, 0.72), 0.85)

    def front(self, p0, p1, z0, plan, tint, layer=FACADE, u0=0, top_w=1.0):
        """A front of a facade tile from p0 to p1: `plan` is its storeys from the ground up, (band, height) each, a quad
        a storey. The bays are fitted to its length; `u0` says which of the tile's four bays comes first. The storey
        under the cornice is streaked from its head (`top_w`), the ground floor from its foot and darker (the street's
        dirt). Returns the height reached."""
        length = math.hypot(p1[0] - p0[0], p1[1] - p0[1])
        bays = max(1, round(length / BAY))
        ua, ub = u0 / 4.0, (u0 + bays) / 4.0
        z = z0
        for k, (band, h) in enumerate(plan):
            r0, r1 = BANDS[band]
            va, vb = (r0 + 0.6) / TH, (r1 - 0.6) / TH
            last = k == len(plan) - 1
            if band == "ground":
                ws = [0.8, 0.8, 0.35, 0.35]
                tints = [mul(tint, 0.8)] * 2 + [mul(tint, 0.9)] * 2
            else:
                under = top_w if last else (0.6 if plan[k + 1][0] == "a" else 0.25)  # (a balcony stands over this storey)
                ws = [0.1, 0.1, under, under]
                tints = [tint] * 4
            self.tface([(p0[0], p0[1], z), (p1[0], p1[1], z), (p1[0], p1[1], z + h), (p0[0], p0[1], z + h)], layer, tint, uvs=[(ua, va), (ub, va), (ub, vb), (ua, vb)],
                       ws=ws, tints=tints)
            z += h
        return z

    def grand(self, p0, p1, z0, z1, tint, band="tall", pitch=BAY, u0=0, foot=False, w1=0.9):
        """A front of the grand tile's `band` from p0 to p1, one band high whatever the height (a tall window is as tall
        as its wall), a bay to every `pitch` metres."""
        length = math.hypot(p1[0] - p0[0], p1[1] - p0[1])
        bays = max(1, round(length / pitch))
        r0, r1 = GBANDS[band]
        va, vb = (r0 + 0.6) / TH, (r1 - 0.6) / TH
        low = mul(tint, 0.82) if foot else tint
        self.tface([(p0[0], p0[1], z0), (p1[0], p1[1], z0), (p1[0], p1[1], z1), (p0[0], p0[1], z1)], GRAND, tint,
                   uvs=[(u0 / 4.0, va), ((u0 + bays) / 4.0, va), ((u0 + bays) / 4.0, vb), (u0 / 4.0, vb)], ws=[0.75 if foot else 0.15, 0.75 if foot else 0.15, w1, w1], tints=[low, low, tint, tint])

    def grand_box(self, lo, hi, tint, band="tall", pitch=BAY, foot=False, walls="SNEW"):
        (x0, y0, z0), (x1, y1, z1) = lo, hi
        for k, (side, a, b) in enumerate((("S", (x0, y0), (x1, y0)), ("E", (x1, y0), (x1, y1)), ("N", (x1, y1), (x0, y1)), ("W", (x0, y1), (x0, y0)))):
            if side in walls:
                self.grand(a, b, z0, z1, tint, band, pitch, u0=k, foot=foot)

    def tslope(self, pts, layer, tint, w_eaves=0.8, w_top=0.15):
        """A roof plane (its first edge the eaves), stained along the eaves."""
        z0 = min(p[2] for p in pts)
        z1 = max(p[2] for p in pts)
        ws = [w_eaves + (w_top - w_eaves) * ((p[2] - z0) / max(z1 - z0, 1e-6)) for p in pts]
        self.tface(pts, layer, tint, ws=ws)

    def thip(self, x0, x1, y0, y1, z0, z1, layer, tint):
        """A hipped roof over a rectangle, its ridge along the longer side."""
        a = [(x0, y0, z0), (x1, y0, z0), (x1, y1, z0), (x0, y1, z0)]
        cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
        if x1 - x0 >= y1 - y0:
            r = (x1 - x0 - (y1 - y0)) / 2
            r0, r1 = (cx - r, cy, z1), (cx + r, cy, z1)
            faces = [[a[0], a[1], r1, r0], [a[1], a[2], r1], [a[2], a[3], r0, r1], [a[3], a[0], r0]]
        else:
            r = (y1 - y0 - (x1 - x0)) / 2
            r0, r1 = (cx, cy - r, z1), (cx, cy + r, z1)
            faces = [[a[0], a[1], r0], [a[1], a[2], r1, r0], [a[2], a[3], r1], [a[3], a[0], r0, r1]]
        for f in faces:
            if len(f) == 4 and math.dist(f[2], f[3]) < 1e-6:
                f = f[:3]
            self.tslope(f, layer, tint, 0.6, 0.1)

    def tfrustum(self, lo0, hi0, z0, lo1, hi1, z1, layer, tint, sides="SENW", gable_layer=RENDER, gable_tint=None, top=None, top_tint=None, w_eaves=0.8):
        """Slopes from one rectangle up to another (a mansard); a side not in `sides` is a party wall carried up."""
        a = [(lo0[0], lo0[1], z0), (hi0[0], lo0[1], z0), (hi0[0], hi0[1], z0), (lo0[0], hi0[1], z0)]
        b = [(lo1[0], lo1[1], z1), (hi1[0], lo1[1], z1), (hi1[0], hi1[1], z1), (lo1[0], hi1[1], z1)]
        for i, side in enumerate("SENW"):
            j = (i + 1) % 4
            if side in sides:
                self.tslope([a[i], a[j], b[j], b[i]], layer, tint, w_eaves)
            else:
                self.tface([a[i], a[j], b[j], b[i]], gable_layer, gable_tint or tint, ws=[0.7, 0.7, 1.0, 1.0])
        if top is not None:
            self.tface(b, top, top_tint or tint, 0.25)

    def tring(self, c, r0, z0, r1, z1, seg, layer, tint, w0=0.0, w1=0.0, cap=None, cap_tint=None, under=False, band=None, bands=BANDS, turn=0.0):
        """A ring of `seg` faces from radius r0 at z0 to r1 at z1 (a drum, a cone, a ring of a dome); `band` lays a band of
        a facade tile round it, a bay a face."""
        ring = lambda rr, zz: [(c[0] + rr * math.cos(turn + 2 * math.pi * i / seg), c[1] + rr * math.sin(turn + 2 * math.pi * i / seg), zz) for i in range(seg)]  # noqa: E731
        a, b = ring(r0, z0), ring(r1, z1)
        for i in range(seg):
            j = (i + 1) % seg
            uvs = None
            if band:
                q0, q1 = bands[band]
                va, vb = (q0 + 0.6) / TH, (q1 - 0.6) / TH
                uvs = [(i / 4.0, va), ((i + 1) / 4.0, va), ((i + 1) / 4.0, vb), (i / 4.0, vb)]
            if r1 < 1e-6:
                self.tface([a[i], a[j], (c[0], c[1], z1)], layer, tint, ws=[w0, w0, w1], uvs=uvs[:3] if uvs else None)
            else:
                self.tface([a[i], a[j], b[j], b[i]], layer, tint, ws=[w0, w0, w1, w1], uvs=uvs)
        if cap is not None and r1 > 1e-6:
            self.tface(b, cap, cap_tint or tint, 0.3)
        if under:
            self.tface(a[::-1], layer, mul(tint, 0.72), 0.85)

    def tdome(self, c, r, z0, h, seg, rings, layer, tint, top_r=0.0):
        for k in range(rings):
            a0, a1 = (math.pi / 2) * k / rings, (math.pi / 2) * (k + 1) / rings
            last = k == rings - 1
            self.tring(c, r * math.cos(a0), z0 + h * math.sin(a0), top_r if last else r * math.cos(a1), z0 + h * (math.sin(a1) if not last else (1.0 if top_r < 1e-6 else 0.97)), seg, layer, tint,
                       0.8 if k == 0 else 0.3, 0.3 if k == 0 else 0.15, cap=ZINC if last and top_r > 1e-6 else None)

    def rail_run(self, p0, p1, z0, h=1.0):
        """An iron balcony rail from p0 to p1 (left to right seen from outside): a band of one tone, the iron and what
        shows through it (bars would be finer than a pixel from where the walls are seen)."""
        self.face([(p0[0], p0[1], z0), (p1[0], p1[1], z0), (p1[0], p1[1], z0 + h), (p0[0], p0[1], z0 + h)], IRON)


CORNERS = lambda x0, x1, y0, y1: {"S": ((x0, y0), (x1, y0)), "E": ((x1, y0), (x1, y1)), "N": ((x1, y1), (x0, y1)), "W": ((x0, y1), (x0, y0))}  # noqa: E731


def stone_tint(rnd, value=0.09, warm=0.04):
    """A house's own stone: its value within +-`value`, a little warmer or cooler."""
    v = 1.0 + value * (2.0 * rnd.random() - 1.0)
    h = warm * (2.0 * rnd.random() - 1.0)
    return (v * (1.0 + h), v, v * (1.0 - h))


def stacks(s, near, rnd, x0, x1, y_half, rz, ridge, count, tall=0.0):
    """Chimney stacks: render under soot, each where its flues come up, with its row of pots as one block (near)."""
    for i in range(count):
        x = x0 + 1.0 + (x1 - x0 - 2.0) * (i + 0.2 + 0.6 * rnd.random()) / count
        side = -1 if rnd.random() < 0.5 else 1
        y = side * min(max(y_half - 1.0, 0.3), 0.6 + 1.8 * rnd.random())
        w, l, h = 0.5 + 0.3 * rnd.random(), 0.9 + 0.9 * rnd.random(), ridge + 1.4 + 1.5 * rnd.random() + tall
        s.tbox((x - w, y - l, rz - 0.3), (x + w, y + l, rz + h), RENDER, mul(SOOT, 0.9 + 0.2 * rnd.random()), w0=0.35, w1=1.0, wt=0.95)
        if near:
            s.box((x - 0.2, y - l * 0.75, rz + h), (x + 0.2, y + l * 0.75, rz + h + 0.6), POT)


def dormers(s, near, rnd, x0, x1, hy, top, roof, inset, tint, zinc, rhythm, seed, sides="SN", h=None):
    """Dormers on the long slopes: a stone front under a zinc cap, standing out of the slates; their rhythm is the
    house's own. Far: none (at its distance a dormer is under a pixel)."""
    if not near or rhythm == "none":
        return
    bays = max(1, round((x1 - x0) / BAY))
    bw = (x1 - x0) / bays
    dw, dh = 0.62 + 0.14 * rnd.random(), h or (2.2 + 0.5 * rnd.random())
    back = inset * (0.6 + dh) / roof + 0.15
    for i in range(bays):
        if (rhythm == "other" and i % 2 == seed % 2) or (rhythm == "pairs" and i % 3 == 2):
            continue
        x = x0 + (i + 0.5) * bw
        for sy, side in ((-1, "S"), (1, "N")):
            if side not in sides:
                continue
            y0, y1 = sorted((sy * (hy - 0.3), sy * (hy - back)))
            s.tbox((x - dw, y0, top + 0.6), (x + dw, y1, top + 0.6 + dh), LIME, mul(tint, 1.04), top=ZINC, top_tint=mul(zinc, 1.12), w0=0.15, w1=0.7, wt=0.3, walls="SEW" if sy < 0 else "NEW")
            u0, u1 = sorted(((x - dw + 0.2) * -sy, (x + dw - 0.2) * -sy))
            s.panel(side, 0.0, 0.0, u0, u1, top + 0.95, top + 0.35 + dh, GLASS, hy - 0.26)


def house(s, lod, x0, x1, hy, floors, seed, tint, layer=FACADE, storey=3.08, ground=4.64, roof="mansard", roof_h=4.8, inset=1.5, dormer="each", chimneys=2, sides="SN", gable=None, balcony=(2, -1)):
    """One house of a row, from x0 to x1 and `hy` deep either way: fronts on its `sides` (the others are party walls of
    render), balcony slabs with rails, a cornice, its roof (`roof`: "mansard", "pavilion" a tall steep one, "double" a
    mansard in two tiers, "attic" a storey set back behind a terrace under a low mansard, "terrace" a flat roof behind a
    parapet, "crown" a stepped crown of stone), dormers (`dormer`: "each" bay, every "other" one, in "pairs", "none") and
    chimney stacks. `gable` ("W" or "E") makes that end a blank gable wall with its flues, weathered from the top.
    Returns the height of its roof (not of its stacks)."""
    near = lod == 0
    rnd = random.Random(seed)
    n = floors - 1
    if n >= 3:
        marked = (balcony[0], n + 1 + balcony[1] if balcony[1] < 0 else balcony[1])
    else:
        marked = (1,) if n == 2 else ()
    plan = [("ground", ground)] + [("a" if f in marked else "b", storey) for f in range(1, floors)]
    eaves = ground + n * storey
    corners = CORNERS(x0, x1, -hy, hy)
    for side in "SENW":
        p0, p1 = corners[side]
        if side in sides:
            s.front(p0, p1, 0.0, plan, tint, layer, u0=rnd.randrange(4))
        else:
            # a party wall, or a gable: render, darker, run with rain from its head
            g = side == gable
            s.twall(p0, p1, 0.0, eaves, RENDER, mul(tint, 1.0 if g else 0.94), 0.55 if g else 0.4, 1.0 if g else 0.75, foot=0.82)
    # balcony slabs (a line of shade under each), their rails
    for f, (band, _) in enumerate(plan):
        if band != "a":
            continue
        z = ground + (f - 1) * storey
        for side in sides:
            (nx, ny), _r = FACES[side]
            p0, p1 = corners[side]
            out = 0.8
            lo = (min(p0[0], p1[0]) + min(0, nx) * out, min(p0[1], p1[1]) + min(0, ny) * out, z - 0.22)
            hi = (max(p0[0], p1[0]) + max(0, nx) * out, max(p0[1], p1[1]) + max(0, ny) * out, z + 0.05)
            if near:
                s.tbox(lo, hi, LIME, mul(tint, 1.1), w0=0.5, w1=0.2, wt=0.25, bottom=True, walls="SNEW".replace({"S": "N", "N": "S", "E": "W", "W": "E"}[side], ""))
                q0 = (p0[0] + nx * (out - 0.08), p0[1] + ny * (out - 0.08))
                q1 = (p1[0] + nx * (out - 0.08), p1[1] + ny * (out - 0.08))
                s.rail_run(q0, q1, z + 0.05)
            else:  # far: the slab's front and the shade under it, as the rail's band
                q0, q1 = (p0[0] + nx * 0.3, p0[1] + ny * 0.3), (p1[0] + nx * 0.3, p1[1] + ny * 0.3)
                s.face([(q0[0], q0[1], z - 0.3), (q1[0], q1[1], z - 0.3), (q1[0], q1[1], z + 0.9), (q0[0], q0[1], z + 0.9)], IRON)
    # the cornice over its frieze
    out = 1.0 if near else 0.6
    wx = out if "W" in sides or gable == "W" else 0.0
    ex = out if "E" in sides or gable == "E" else 0.0
    s.tbox((x0 - wx, -hy - out, eaves - 0.12), (x1 + ex, hy + out, eaves + 0.5), LIME, mul(tint, 1.12), w0=0.8, w1=0.15, wt=0.3, bottom=True)
    top = eaves + 0.5
    slate = (0.9 + 0.2 * rnd.random(),) * 3
    slate = (slate[0] * (1.0 + 0.03 * (rnd.random() - 0.5)), slate[1], slate[2] * (1.0 + 0.05 * (rnd.random() - 0.5)))
    zinc = (0.92 + 0.14 * rnd.random(),) * 3
    slopes = "".join(side for side in "SENW" if side in "SN" or side in sides)
    gt = mul(tint, 0.9)

    if roof == "terrace":
        # a flat roof of zinc behind a parapet; the stair's lantern, a tank or two stacks on it
        s.tbox((x0 - 0.1, -hy - 0.15, top), (x1 + 0.1, hy + 0.15, top + 0.9), LIME, mul(tint, 1.06), top=ZINC, top_tint=mul(zinc, 0.92), w0=0.7, w1=0.25, wt=0.5)
        deck = top + 0.9
        lx = x0 + 1.5 + (x1 - x0 - 6.5) * rnd.random()
        s.tbox((lx, -2.0, deck), (lx + 3.5, 2.0, deck + 2.5), RENDER, mul(tint, 0.98), top=ZINC, top_tint=zinc, w0=0.4, w1=0.9, wt=0.4)
        stacks(s, near, rnd, x0, x1, hy - 2.0, deck, 0.6, max(1, chimneys - 1))
        return deck + 1.2
    if roof == "crown":
        # a stepped crown of stone: an attic behind the cornice, two more steps, a blunt lantern block (no point)
        a = top
        cx, hw = (x0 + x1) / 2, (x1 - x0) / 2
        for k, (dx, dy, h) in enumerate(((1.2, 1.2, 3.4), (2.9, 2.6, 2.9), (4.5, 4.1, 2.5))):
            if hw - dx < 1.0 or hy - dy < 1.0:
                break
            s.tbox((cx - hw + dx, -hy + dy, a), (cx + hw - dx, hy - dy, a + h), LIME, mul(tint, 1.0 - 0.04 * k), top=ZINC, top_tint=zinc, w0=0.3, w1=0.9, wt=0.5)
            s.tbox((cx - hw + dx - 0.3, -hy + dy - 0.3, a + h - 0.4), (cx + hw - dx + 0.3, hy - dy + 0.3, a + h), LIME, mul(tint, 1.1), top=ZINC, top_tint=zinc, w0=0.7, w1=0.2, wt=0.4, bottom=True)
            if near and k < 2:
                for sx in (-1, 1):
                    for sy in (-1, 1):  # a pylon of stone on each corner of the step below
                        px, py = cx + sx * (hw - dx + 0.75), sy * (hy - dy + 0.75)
                        s.tbox((px - 0.45, py - 0.45, a), (px + 0.45, py + 0.45, a + 1.8), LIME, mul(tint, 1.08), top=ZINC, w0=0.2, w1=0.8, wt=0.4)
            a += h
        return a
    if roof == "attic":
        # the top storey stands back behind a terrace: the cornice line, then a narrower storey under a low mansard
        s.tbox((x0 - 0.05, -hy - 0.1, top), (x1 + 0.05, hy + 0.1, top + 0.5), LIME, mul(tint, 1.06), top=ZINC, top_tint=mul(zinc, 0.92), w0=0.6, w1=0.2, wt=0.5)
        top += 0.5
        hy = hy - 1.6
        corners = CORNERS(x0, x1, -hy, hy)
        for side in "SN":
            p0, p1 = corners[side]
            s.front(p0, p1, top, [("b", storey)], mul(tint, 0.96), layer, u0=rnd.randrange(4))
        for side in "EW":
            p0, p1 = corners[side]
            s.twall(p0, p1, top, top + storey, RENDER if side not in sides else LIME, gt, 0.3, 0.8)
        top += storey
        s.tbox((x0, -hy - 0.5, top - 0.1), (x1, hy + 0.5, top + 0.3), LIME, mul(tint, 1.1), w0=0.7, w1=0.15, wt=0.3, bottom=True)
        top += 0.3
        roof_h, inset = 3.2, 1.2
        slopes = "SN"
    if roof == "pavilion":
        roof_h, inset = 7.0, 3.0
    # the mansard: a steep slope of slate (stained along the eaves), a zinc ledge at its break, a low roof hipped to a ridge
    ix0 = x0 + (inset if "W" in slopes else 0.0)
    ix1 = x1 - (inset if "E" in slopes else 0.0)
    s.tfrustum((x0, -hy - 0.1), (x1, hy + 0.1), top, (ix0, -hy + inset), (ix1, hy - inset), top + roof_h, SLATE, slate, slopes, gable_tint=gt)
    rz = top + roof_h
    iy = hy - inset
    dormers(s, near, rnd, x0 + (inset * 0.5 if "W" in slopes else 0.0), x1 - (inset * 0.5 if "E" in slopes else 0.0), hy, top, roof_h, inset, tint, zinc, dormer, seed,
            h=3.0 if roof == "pavilion" else None)
    if near:
        s.tbox((ix0 - 0.25, -iy - 0.25, rz - 0.1), (ix1 + 0.25, iy + 0.25, rz + 0.12), ZINC, mul(zinc, 1.15), w0=0.5, w1=0.2, wt=0.2)
        rz += 0.12
    if roof == "double":
        # a second, flatter tier of slate with its own small dormers
        j0, j1, jy = ix0 + (2.3 if "W" in slopes else 0.0), ix1 - (2.3 if "E" in slopes else 0.0), iy - 2.3
        s.tfrustum((ix0, -iy), (ix1, iy), rz, (j0, -jy), (j1, jy), rz + 2.6, SLATE, mul(slate, 0.96), slopes, gable_tint=gt, w_eaves=0.5)
        if near:
            m = max(2, int((x1 - x0) / 5.5))
            for i in range(m):
                x = x0 + 3.0 + (x1 - x0 - 6.0) * i / (m - 1)
                for sy in (-1, 1):
                    s.tbox((x - 0.55, sy * (iy - 1.25) - 0.55, rz + 0.3), (x + 0.55, sy * (iy - 1.25) + 0.55, rz + 1.7), LIME, mul(tint, 1.02), top=ZINC, top_tint=mul(zinc, 1.1), w1=0.6, wt=0.3)
        ix0, ix1, iy = j0, j1, jy
        rz += 2.6
    ridge = (0.2 if roof_h < 4.0 else 0.3) * iy
    s.thip(ix0, ix1, -iy, iy, rz, rz + ridge, SLATE if roof == "pavilion" else ZINC, slate if roof == "pavilion" else zinc)
    stacks(s, near, rnd, ix0, ix1, iy, rz, ridge, chimneys, 1.2 if roof == "pavilion" else 0.0)
    if gable:
        # the gable wall's flues: a stepped stack rising through the end of the roof (the Paris mur pignon)
        sx = -1 if gable == "W" else 1
        xe = x0 if gable == "W" else x1
        xa, xb = sorted((xe, xe - sx * 1.0))
        s.tbox((xa, -hy * 0.42, top), (xb, hy * 0.42, rz + ridge + 1.6), RENDER, mul(SOOT, 0.95), w0=0.5, w1=1.0, wt=0.95)
        if near:
            s.tbox((xa, -hy * 0.78, top), (xb, hy * 0.78, top + roof_h * 0.6), RENDER, mul(SOOT, 1.0), w0=0.5, w1=0.9, wt=0.8)
            s.box(((xa + xb) / 2 - 0.2, -hy * 0.34, rz + ridge + 1.6), ((xa + xb) / 2 + 0.2, hy * 0.34, rz + ridge + 2.2), POT)
    return rz + ridge


ROOF_OVER = {"mansard": lambda hy: 0.62 + 4.8 + 0.3 * (hy - 1.5), "low": lambda hy: 0.62 + 3.4 + 0.2 * (hy - 1.5), "pavilion": lambda hy: 0.62 + 7.0 + 0.3 * (hy - 3.0),
             "double": lambda hy: 0.62 + 4.2 + 2.6 + 0.3 * (hy - 3.7), "attic": lambda hy: 1.3 + 3.08 + 3.32 + 0.2 * (hy - 2.8), "terrace": lambda hy: 0.5 + 0.9 + 1.2,
             "crown": lambda hy: 0.5 + 8.8}


def floors_for(target, roof, hy, storey, ground):
    """The storeys (the ground floor counted) that bring a house with this roof nearest to `target` metres."""
    over = ROOF_OVER[roof](hy)
    return max(1, round((target - over - ground) / storey) + 1)


def rotunda(s, lod, c, r, floors, tint, storey=3.0, ground=4.9):
    """A corner rotunda: a facade bay to every segment, its string courses and cornice running round, a dome of slate
    under a zinc lantern and a short gilt point. Returns the height of the dome."""
    seg = 12 if lod == 0 else 8
    n = floors - 1
    plan = [("ground", ground)] + [("a" if (f in (2, n) and n >= 3) else "b", storey) for f in range(1, floors)]
    z = 0.0
    for k, (band, h) in enumerate(plan):
        last = k == len(plan) - 1
        if band == "ground":
            s.tring(c, r, z, r, z + h, seg, FACADE, mul(tint, 0.86), 0.8, 0.35, band=band)
        else:
            s.tring(c, r, z, r, z + h, seg, FACADE, tint, 0.1, 1.0 if last else 0.3, band=band)
        if lod == 0 and band == "a":
            s.tring(c, r + 0.6, z - 0.2, r + 0.6, z + 0.05, seg, LIME, mul(tint, 1.1), 0.4, 0.4, cap=LIME, under=True)
        z += h
    s.tring(c, r + 0.9, z - 0.12, r + 0.9, z + 0.5, seg, LIME, mul(tint, 1.12), 0.8, 0.15, cap=LIME, under=True)
    z += 0.5
    s.tdome(c, r - 0.2, z, r * 0.92, seg, 4 if lod == 0 else 2, SLATE, (0.98, 0.98, 1.0), top_r=1.1)
    zl = z + r * 0.92 * 0.97
    s.cylinder(c, 0.95, zl, zl + 1.6, K._to_linear(np.array(ZINC_RGB)).tolist(), 6)
    s.cylinder(c, 0.95, zl + 1.6, zl + 2.8, GILT, 6, r1=0.45)
    return zl


def h_row(lod, width, height, seed):
    """A row of Haussmann houses `width` metres long, its tallest roof about `height`: see the file's head. Returns the
    shell and the height its roofs reach."""
    s = TShell()
    rnd = random.Random(seed)
    bays = max(6, round(width / BAY))
    corner = width >= 36 and rnd.random() < 0.3 and height >= 19
    if corner:
        bays -= 4
    if bays <= 11:
        n = 2
    elif bays <= 14:
        n = 2 if rnd.random() < 0.3 else 3
    elif bays <= 17:
        n = 3
    else:
        n = 3 if rnd.random() < 0.35 else 4
    parts = [3] * n
    for _ in range(bays - 3 * n):
        k = rnd.randrange(n)
        parts[k if parts[k] < 8 else parts.index(min(parts))] += 1
    x = -width / 2
    lead = rnd.randrange(n)
    gable = None
    if not corner and rnd.random() < 0.3:
        gable = "W" if rnd.random() < 0.5 else "E"
    reach = 0.0
    last_roof = None
    for i, b in enumerate(parts):
        hrnd = random.Random(seed * 131 + i * 17 + 5)
        x1 = x + b * BAY
        hy = 9.4 - (0.0 if i == lead else 0.5 * hrnd.randrange(3))
        storey = 2.98 + 0.34 * hrnd.random()
        ground = 4.4 + 0.6 * hrnd.random()
        target = height * (1.0 if i == lead else 0.78 + 0.2 * hrnd.random())
        choices = ["mansard", "mansard", "double", "attic", "terrace"]
        if b <= 5:
            choices.append("pavilion")
        if target < 19:
            choices = ["low", "low", "terrace"]
        elif target < 23:
            choices = ["mansard", "low", "terrace", "attic"]
        roof = hrnd.choice([c for c in choices if c != last_roof] or choices)
        last_roof = roof
        floors = floors_for(target, roof, hy, storey, ground)
        first, last = i == 0, i == n - 1
        sides = "SN" + ("W" if first and gable != "W" else "") + ("E" if last and gable != "E" and not corner else "")
        g = gable if (first and gable == "W") or (last and gable == "E") else None
        if g and roof in ("terrace", "attic"):
            roof = "mansard" if target >= 19 else "low"
            floors = floors_for(target, roof, hy, storey, ground)
        top = house(s, lod, x, x1, hy, floors, seed * 977 + i * 31 + 3, stone_tint(hrnd), layer=FACADE if hrnd.random() < 0.55 else FACADE_B, storey=storey, ground=ground,
                    roof="mansard" if roof == "low" else roof, roof_h=3.4 if roof == "low" else 4.4 + 0.9 * hrnd.random(), dormer=hrnd.choice(["each", "each", "other", "pairs"]),
                    chimneys=max(1, min(4, round(b / 2.2 + hrnd.random() - 0.5))), sides=sides, gable=g, balcony=(hrnd.choice([1, 2, 2]), hrnd.choice([-1, -1, -2])))
        reach = max(reach, top)
        x = x1
    if corner:
        hrnd = random.Random(seed * 131 + 991)
        floors = floors_for(height * 0.9, "mansard", 9.4, 3.0, 4.9)
        reach = max(reach, rotunda(s, lod, (x + 3.0, 0.0), 6.4, max(2, floors), mul(stone_tint(hrnd), 1.03)))
    return s, reach


def t_house(lod, height, seed):
    """A tower house: a slender house under a stepped crown of stone, a head above the two-bay wings beside it."""
    s = TShell()
    rnd = random.Random(seed)
    tint = stone_tint(rnd)
    storey, ground = 3.05 + 0.2 * rnd.random(), 4.7
    left = rnd.choice([2, 3])
    xs = [-13.05, -13.05 + left * BAY, -13.05 + (left + 5 if left == 2 else left + 4) * BAY, 13.05]
    floors = floors_for(height, "crown", 9.2, storey, ground)
    for i, (a, b) in enumerate(((xs[0], xs[1]), (xs[2], xs[3]))):
        wing = "low" if height * 0.6 < 19 else "mansard"
        f = floors_for(height * (0.55 + 0.12 * rnd.random()), wing, 8.6, storey, ground)
        house(s, lod, a, b, 8.6, f, seed * 53 + i, stone_tint(rnd), layer=FACADE_B if rnd.random() < 0.5 else FACADE, storey=storey, ground=ground, roof="mansard",
              roof_h=3.4 if wing == "low" else 4.6, dormer="each", chimneys=1, sides="SNW" if i == 0 else "SNE")
    reach = house(s, lod, xs[1], xs[2], 9.2, floors, seed * 53 + 7, tint, layer=FACADE, storey=storey, ground=ground, roof="crown", sides="SNEW", balcony=(2, -1))
    return s, reach


def deco_fins(s, near, rnd, x, y, z0, z1, pitch, width, fin, tint, c=(0.0, 0.0), sides="SENW"):
    """One tier of an Art Deco mass: the glazing wall `fin` behind the piers' faces, the piers as fins, each its own
    tone, run with rain from its head (the piers are the wider part: a mass of stone with tall slots of glazing)."""
    corners = CORNERS(c[0] - x, c[0] + x, c[1] - y, c[1] + y)
    for side in sides:
        p0, p1 = corners[side]
        length = math.hypot(p1[0] - p0[0], p1[1] - p0[1])
        t = ((p1[0] - p0[0]) / length, (p1[1] - p0[1]) / length)
        nrm = (t[1], -t[0])
        at = lambda u, d, zz: (p0[0] + t[0] * u - nrm[0] * d, p0[1] + t[1] * u - nrm[1] * d, zz)  # noqa: E731
        tw, th = TILE_M[GLAZING]
        off = rnd.random()
        s.tface([at(0, fin, z0), at(length, fin, z0), at(length, fin, z1), at(0, fin, z1)], GLAZING, (0.9, 0.9, 0.9),
                uvs=[(off, z0 / th), (off + length / tw, z0 / th), (off + length / tw, z1 / th), (off, z1 / th)], ws=[0.1, 0.1, 0.7, 0.7])
        count = max(2, round((length - width) / pitch) + 1)
        gap = (length - width) / (count - 1)
        for i in range(count):
            xa, xb = i * gap, i * gap + width
            col = mul(tint, 0.94 + 0.12 * rnd.random())
            low = 0.78 if z0 < 5.0 else 0.94
            s.tface([at(xa, 0, z0), at(xb, 0, z0), at(xb, 0, z1), at(xa, 0, z1)], LIME, col, ws=[0.25, 0.25, 1.0, 1.0], tints=[mul(col, low)] * 2 + [col] * 2)
            if near or i in (0, count - 1):
                if i > 0:
                    s.tface([at(xa, fin, z0), at(xa, 0, z0), at(xa, 0, z1), at(xa, fin, z1)], LIME, mul(col, 0.88), ws=[0.3, 0.3, 0.9, 0.9])
                if i < count - 1:
                    s.tface([at(xb, 0, z0), at(xb, fin, z0), at(xb, fin, z1), at(xb, 0, z1)], LIME, mul(col, 0.88), ws=[0.3, 0.3, 0.9, 0.9])


def deco_stone(s, near, rnd, x, y, z0, z1, tint, c=(0.0, 0.0)):
    """One tier of an Art Deco mass in stone: storeys of windows (the second front's upper band) between plain piers at
    the corners and, on a long side, one between: a 1930s apartment block rather than a hall of glass."""
    corners = CORNERS(c[0] - x, c[0] + x, c[1] - y, c[1] + y)
    n = max(1, round((z1 - z0) / STOREY_H))
    h = (z1 - z0) / n
    r0, r1 = BANDS["b"]
    va, vb = (r0 + 0.6) / TH, (r1 - 0.6) / TH
    for side in "SENW":
        p0, p1 = corners[side]
        length = math.hypot(p1[0] - p0[0], p1[1] - p0[1])
        bays = max(1, round(length / BAY))
        u0 = rnd.randrange(4)
        for k in range(n):
            last = k == n - 1
            s.tface([(p0[0], p0[1], z0 + k * h), (p1[0], p1[1], z0 + k * h), (p1[0], p1[1], z0 + (k + 1) * h), (p0[0], p0[1], z0 + (k + 1) * h)], FACADE_B, tint,
                    uvs=[(u0 / 4.0, va), ((u0 + bays) / 4.0, va), ((u0 + bays) / 4.0, vb), (u0 / 4.0, vb)], ws=[0.1, 0.1, 0.95 if last else 0.2, 0.95 if last else 0.2])
        t = ((p1[0] - p0[0]) / length, (p1[1] - p0[1]) / length)
        nrm = (t[1], -t[0])
        piers = [0.0, length - 1.3] + ([length / 2 - 0.65] if length > 20 and near else [])
        for u in piers:
            col = mul(tint, 1.02 + 0.08 * rnd.random())
            a0 = (p0[0] + t[0] * u + nrm[0] * 0.4, p0[1] + t[1] * u + nrm[1] * 0.4)
            a1 = (p0[0] + t[0] * (u + 1.3) + nrm[0] * 0.4, p0[1] + t[1] * (u + 1.3) + nrm[1] * 0.4)
            b0 = (p0[0] + t[0] * u, p0[1] + t[1] * u)
            b1 = (p0[0] + t[0] * (u + 1.3), p0[1] + t[1] * (u + 1.3))
            s.twall(a0, a1, z0, z1, LIME, col, 0.25, 1.0, foot=0.8 if z0 < 5.0 else None)
            s.twall(b0, a0, z0, z1, LIME, mul(col, 0.88), 0.3, 0.9)
            s.twall(a1, b1, z0, z1, LIME, mul(col, 0.88), 0.3, 0.9)


def parapet(s, x, y, z, tint, c=(0.0, 0.0), out=0.35, h=1.35, top=ZINC):
    s.tbox((c[0] - x - out, c[1] - y - out, z), (c[0] + x + out, c[1] + y + out, z + h), LIME, mul(tint, 1.1), top=top, top_tint=(0.94, 0.94, 0.95), w0=0.75, w1=0.2, wt=0.5, bottom=True)


def d_block(lod, width, height, seed, stone=False):
    """An Art Deco mass: a plinth, giant piers of ashlar before bands of glazing (or, `stone`, storeys of windows
    between plain piers), setbacks with parapets and corner pylons, a stepped crown of stone (A2: the Palais de
    Chaillot's order, as an apartment tower)."""
    s = TShell()
    rnd = random.Random(seed)
    near = lod == 0
    tint = (0.95 + 0.04 * rnd.random(), 0.96 + 0.03 * rnd.random(), 0.98)
    hx, hy = width / 2 - 0.4, 9.0
    plinth = 4.2 if height > 20 else 3.4
    s.tbox((-hx - 0.4, -hy - 0.4, 0.0), (hx + 0.4, hy + 0.4, plinth), LIME, mul(tint, 0.76), w0=0.95, w1=0.4, wt=0.3, foot=0.82)
    crown = 5.25 if height >= 30 else 3.4
    body = height - crown - 0.45
    shares = [1.0] if height < 24 else [0.7, 1.0] if height < 37 else [0.58, 0.82, 1.0]
    pitch, width_p = 4.6 + 1.2 * rnd.random(), 2.8 + 0.8 * rnd.random()
    z0 = plinth
    x, y = hx, hy
    for k, share in enumerate(shares):
        z1 = plinth + (body - plinth) * share
        if stone:
            deco_stone(s, near, rnd, x, y, z0, z1 - 0.9, mul(tint, 1.0 - 0.03 * k))
        else:
            deco_fins(s, near, rnd, x, y, z0, z1 - 0.9, pitch - 0.4 * k, width_p - 0.3 * k, 0.6 - 0.07 * k, tint)
        parapet(s, x, y, z1 - 0.9, tint)
        if near and k == len(shares) - 1 and x > 6.0:  # on the top terrace: the lift's house
            lx = (rnd.random() - 0.5) * (x - 4.0)
            s.tbox((lx - 1.6, y - 3.6, z1 + 0.45), (lx + 1.6, y - 1.2, z1 + 2.2), RENDER, mul(tint, 0.95), top=ZINC, w0=0.4, w1=0.9, wt=0.4)
        if k < len(shares) - 1 and near:
            for sx in (-1, 1):
                for sy in (-1, 1):  # a stone pylon on each corner of the terrace
                    px, py = sx * (x - 0.9), sy * (y - 0.9)
                    s.tbox((px - 0.75, py - 0.75, z1 + 0.45), (px + 0.75, py + 0.75, z1 + 2.5), LIME, mul(tint, 1.06), top=ZINC, w0=0.2, w1=0.8, wt=0.4)
        z0 = z1
        x, y = x - (2.8 if k == 0 else 3.2), y - 1.8
    # the crown: steps of stone, each narrower, the last a blunt lantern block under zinc (no point)
    z = body + 0.45
    x, y = x + 0.4, y + 0.8
    steps = ((0.0, 0.0, 2.2), (1.6, 1.1, 1.8), (3.3, 2.3, 1.25)) if crown > 5 else ((0.0, 0.0, 1.9), (1.7, 1.2, 1.5))
    for k, (dx, dy, h) in enumerate(steps):
        if x - dx < 1.2 or y - dy < 1.0:
            dx, dy = max(0.0, x - 1.2), max(0.0, y - 1.0)
        lastk = k == len(steps) - 1
        s.tbox((-x + dx, -y + dy, z), (x - dx, y - dy, z + h), LIME, mul(tint, 1.0 - 0.05 * k), top=ZINC if lastk else LIME, top_tint=(0.95, 0.95, 0.95) if lastk else mul(tint, 0.9), w0=0.3, w1=0.9, wt=0.5)
        z += h
    return s, z


def deco_hall(lod, k=1.0):
    """A long Art Deco hall: plinth, tall glazing between piers, a stepped attic, a taller pavilion in the middle
    stepped twice (A2). `k` scales the heights above the plinth."""
    s = TShell()
    rnd = random.Random(19)
    near = lod == 0
    tint = (0.96, 0.97, 0.98)
    hx, hy = 32.0, 10.0
    Z = lambda z: 3.2 + (z - 3.2) * k  # noqa: E731
    s.tbox((-hx - 0.6, -hy - 0.6, 0.0), (hx + 0.6, hy + 0.6, 3.2), LIME, mul(tint, 0.76), w0=0.95, w1=0.4, wt=0.3, foot=0.82)
    for sx in (-1, 1):  # the wings (their inner ends are inside the pavilion)
        deco_fins(s, near, rnd, 11.0, hy, 3.2, Z(21.0), 5.6, 3.2, 0.7, tint, c=(sx * 21.0, 0.0), sides="SN" + ("E" if sx > 0 else "W"))
        s.tbox((sx * 21.0 - 11.4, -hy - 0.5, Z(21.0)), (sx * 21.0 + 11.4, hy + 0.5, Z(21.0) + 0.9), LIME, mul(tint, 1.1), top=ZINC, top_tint=(0.94, 0.94, 0.95), w0=0.75, w1=0.2, wt=0.5, bottom=True)
        s.tbox((sx * 21.0 - 9.5, -hy + 2.0, Z(21.0) + 0.9), (sx * 21.0 + 9.5, hy - 2.0, Z(25.2)), LIME, mul(tint, 0.97), top=ZINC, w0=0.3, w1=0.9, wt=0.5)
        s.thip(sx * 20.0 - 8.0, sx * 20.0 + 8.0, -3.2, 3.2, Z(25.2), Z(25.2) + 2.4, GLAZING, (0.82, 0.84, 0.86))  # a glazed gallery roof
        if near:
            # a gilt figure on a pedestal at each end of the plinth (A2)
            s.tbox((sx * 30.0 - 0.6, -hy - 2.2, 0.0), (sx * 30.0 + 0.6, -hy - 1.0, 4.2), LIME, mul(tint, 0.8), w0=0.8, w1=0.4, wt=0.3)
            s.box((sx * 30.0 - 0.3, -hy - 1.9, 4.2), (sx * 30.0 + 0.3, -hy - 1.3, 6.6), GILT)
    # the pavilion in the middle
    s.tbox((-10.4, -12.4, 0.0), (10.4, 12.4, 3.2), LIME, mul(tint, 0.76), w0=0.95, w1=0.4, wt=0.3, foot=0.82, walls="SN", lid=False)
    deco_fins(s, near, rnd, 10.0, 12.0, 3.2, Z(28.0), 3.6, 1.5, 0.9, tint)
    parapet(s, 10.0, 12.0, Z(28.0), tint, out=0.5, h=1.0)
    z = Z(28.0) + 1.0
    for i, (x, y, h) in enumerate(((8.0, 10.0, 4.5), (5.5, 7.5, 3.0), (3.4, 5.0, 1.8))):
        s.tbox((-x, -y, z), (x, y, z + h * k), LIME, mul(tint, 1.0 - 0.04 * i), top=ZINC, top_tint=(0.95, 0.95, 0.95), w0=0.3, w1=0.9, wt=0.5)
        z += h * k
    return s, z


def deco_tower(lod, k=1.0):
    """An Art Deco tower: setbacks with parapets and corner pylons, a glazed lantern between stone ribs under a stepped
    cap (it ends blunt, with a short gilt point)."""
    s = TShell()
    rnd = random.Random(20)
    near = lod == 0
    tint = (0.95, 0.96, 0.98)
    steps = [(15.0, 0.0, 22.0), (11.0, 22.0, 40.0), (7.5, 40.0, 54.0), (4.5, 54.0, 61.0)]
    if k < 0.8:
        steps = [(15.0, 0.0, 24.0), (11.0, 24.0, 42.0), (7.0, 42.0, 55.0)]
    s.tbox((-15.4, -15.4, 0.0), (15.4, 15.4, 4.0 * max(k, 0.7)), LIME, mul(tint, 0.76), w0=0.95, w1=0.4, wt=0.3, foot=0.82)
    for i, (h, z0, z1) in enumerate(steps):
        za, zb = max(z0 * k, 4.0 * max(k, 0.7)), z1 * k
        t = tint if i < 2 else mul(tint, 0.95)
        deco_fins(s, near, rnd, h, h, za, zb - 0.9, 5.0 - 0.5 * i, 3.0 - 0.4 * i, 0.65 - 0.08 * i, t)
        parapet(s, h, h, zb - 0.9, t, out=0.4, h=0.92)
        if i < len(steps) - 1:
            for sx in (-1, 1):
                for sy in (-1, 1):
                    px, py = sx * (h - 1.0), sy * (h - 1.0)
                    s.tbox((px - 0.9, py - 0.9, zb), (px + 0.9, py + 0.9, zb + 3.4 * max(k, 0.7)), LIME, mul(tint, 1.06), top=ZINC, w0=0.2, w1=0.8, wt=0.4)
    z = steps[-1][2] * k
    lh = 10.0 * max(k, 0.62)
    s.cylinder((0.0, 0.0), 2.6, z, z + lh * 0.5, mul(K._to_linear(np.array(STONE_RGB)).tolist(), 1.05), 8, alt=GLASS)
    s.tring((0.0, 0.0), 3.0, z + lh * 0.5, 3.0, z + lh * 0.57, 8, LIME, mul(tint, 1.1), 0.6, 0.2, cap=LIME, under=True)
    s.tring((0.0, 0.0), 2.3, z + lh * 0.57, 0.9, z + lh * 0.82, 8, LIME, mul(tint, 1.02), 0.5, 0.9, cap=ZINC)
    s.cylinder((0.0, 0.0), 0.9, z + lh * 0.82, z + lh, GILT, 6, r1=0.55)
    return s, z + lh


def belfry(lod, k=1.0):
    """A block with a clock tower: an open bell stage, a spire of dressed stone between four pinnacles, a gilt point."""
    s = TShell()
    near = lod == 0
    rnd = random.Random(22)
    tint = stone_tint(rnd, 0.04)
    floors = 5 if k > 0.8 else 3
    house(s, lod, -10.0, 20.0, 9.0, floors, 2203, tint, layer=FACADE, roof="mansard", roof_h=4.8 if k > 0.8 else 3.4, chimneys=3, sides="SNE", dormer="other")
    t = 4.2
    c = (-13.5, 0.0)
    s.o = c
    z1, z2, z3, z4 = 23.2 * k, 29.2 * k, 36.0 * k, 48.3 * k
    tt = mul(tint, 1.03)
    s.tbox((-t, -t, 0.0), (t, t, z1), LIME, tt, w0=0.8, w1=0.7, foot=0.8, lid=False)
    if near:
        s.box((-t + 0.9, -t + 0.9, z1), (t - 0.9, t - 0.9, z2), GLASS)  # the bell chamber, dark between its piers
        for sx in (-1, 1):
            for sy in (-1, 1):
                s.tbox((sx * (t - 0.75) - 0.75, sy * (t - 0.75) - 0.75, z1), (sx * (t - 0.75) + 0.75, sy * (t - 0.75) + 0.75, z2), LIME, tt, w0=0.2, w1=0.8, lid=False)
        for side in "SNEW":
            for z in (0.3, 0.5, 0.7, 0.86):
                s.panel(side, t, t, -0.5, 0.5, z * z1, z * z1 + 2.2 * k, GLASS, 0.08)
    else:
        s.tbox((-t, -t, z1), (t, t, z2), LIME, tt, w0=0.2, w1=0.8, lid=False)
        for side in "SNEW":
            s.panel(side, t, t, -1.0, 1.0, z1 + 0.8 * k, z2 - 0.6 * k, GLASS, 0.3)
    s.tbox((-t - 0.3, -t - 0.3, z1 - 0.5), (t + 0.3, t + 0.3, z1), LIME, mul(tint, 1.12), w0=0.7, w1=0.2, wt=0.3, bottom=True)
    s.tbox((-t, -t, z2), (t, t, z3), LIME, tt, w0=0.15, w1=0.95, lid=False)
    s.tbox((-t - 0.3, -t - 0.3, z2 - 0.2), (t + 0.3, t + 0.3, z2 + 0.3), LIME, mul(tint, 1.12), w0=0.7, w1=0.2, wt=0.3, bottom=True)
    s.tbox((-t - 0.6, -t - 0.6, z3), (t + 0.6, t + 0.6, z3 + 1.0), LIME, mul(tint, 1.12), w0=0.8, w1=0.2, wt=0.3, bottom=True)
    for side in "SNEW":
        s.panel(side, t, t, -1.5, 1.5, z2 + 1.0 * k + 0.2, z2 + 1.0 * k + 3.2, mul(K._to_linear(np.array(STONE_RGB)).tolist(), 1.2), 0.1)  # the clock face
        s.panel(side, t, t, -1.15, 1.15, z2 + 1.0 * k + 0.55, z2 + 1.0 * k + 2.85, IRON, 0.16)
    a = [(-t + 0.4, -t + 0.4), (t - 0.4, -t + 0.4), (t - 0.4, t - 0.4), (-t + 0.4, t - 0.4)]
    for i in range(4):  # the spire
        j = (i + 1) % 4
        s.tslope([(a[i][0], a[i][1], z3 + 1.0), (a[j][0], a[j][1], z3 + 1.0), (a[j][0] * 0.12, a[j][1] * 0.12, z4), (a[i][0] * 0.12, a[i][1] * 0.12, z4)], LIME, mul(tint, 1.04 if i % 2 else 0.94), 0.5, 0.8)
    if near:
        for sx in (-1, 1):
            for sy in (-1, 1):
                s.frustum(0.75, 0.75, z3 + 1.0, 0.0, 0.0, z3 + 1.0 + 4.2 * k, mul(K._to_linear(np.array(STONE_RGB)).tolist(), 0.95), c=(sx * (t - 0.2), sy * (t - 0.2)))
    s.cylinder((0.0, 0.0), 0.4, z4, z4 + 2.2 * k, GILT, 6, r1=0.0)
    s.o = (0.0, 0.0)
    return s, z4 + 2.2 * k


def dome(lod, k=1.0):
    """A domed building: a square base of the grand order, a portico, a drum of windows, a ribbed dome of lead, a
    lantern under a gilt ball (it ends blunt)."""
    s = TShell()
    near = lod == 0
    rnd = random.Random(21)
    tint = stone_tint(rnd, 0.04)
    h = 17.0
    base = 16.0 * k
    if k > 0.8:
        s.grand_box((-h, -h, 0.0), (h, h, 8.4), tint, "tall", foot=True)
        s.grand_box((-h, -h, 8.4), (h, h, base), mul(tint, 1.02), "tall")
    else:
        s.grand_box((-h, -h, 0.0), (h, h, base), tint, "tall", foot=True)
    s.tbox((-h - 0.5, -h - 0.5, base), (h + 0.5, h + 0.5, base + 1.0), LIME, mul(tint, 1.12), top=ZINC, w0=0.8, w1=0.2, wt=0.5, bottom=True)
    s.grand_box((-h + 1.5, -h + 1.5, base + 1.0), (h - 1.5, h - 1.5, base + 1.0 + 2.6 * max(k, 0.75)), mul(tint, 0.96), "attic")
    at = base + 1.0 + 2.6 * max(k, 0.75)
    s.tface([(-h + 1.5, -h + 1.5, at), (h - 1.5, -h + 1.5, at), (h - 1.5, h - 1.5, at), (-h + 1.5, h - 1.5, at)], ZINC, (0.95, 0.95, 0.96), 0.5)
    # the portico (on the model's front): columns, an entablature, a pediment
    ph = 13.5 * k
    s.tbox((-9.5, -h - 3.2, 0.0), (9.5, -h, 3.0 * k), LIME, mul(tint, 0.8), w0=0.9, w1=0.4, wt=0.4, walls="SEW")
    if near:
        for i in range(6):
            s.tring((-7.5 + 3.0 * i, -h - 2.2), 0.6, 3.0 * k, 0.6, ph, 6, LIME, mul(tint, 1.08), 0.5, 0.6)
    s.tbox((-9.5, -h - 3.2, ph), (9.5, -h, ph + 1.3), LIME, mul(tint, 1.1), w0=0.8, w1=0.2, wt=0.3, bottom=True, walls="SEW", lid=False)
    s.tface([(-9.5, -h - 3.2, ph + 1.3), (9.5, -h - 3.2, ph + 1.3), (0.0, -h - 3.2, ph + 4.9)], LIME, mul(tint, 1.06), ws=[0.3, 0.3, 0.9])
    s.tslope([(9.5, -h - 3.2, ph + 1.3), (9.5, -h, ph + 1.3), (0.0, -h, ph + 4.9), (0.0, -h - 3.2, ph + 4.9)], SLATE, (1.0, 1.0, 1.0))
    s.tslope([(-9.5, -h, ph + 1.3), (-9.5, -h - 3.2, ph + 1.3), (0.0, -h - 3.2, ph + 4.9), (0.0, -h, ph + 4.9)], SLATE, (1.0, 1.0, 1.0))
    if near:
        for sx in (-1, 1):
            for sy in (-1, 1):  # a stone lantern on each corner of the attic
                px, py = sx * (h - 2.6), sy * (h - 2.6)
                s.tbox((px - 1.0, py - 1.0, at), (px + 1.0, py + 1.0, at + 2.6), LIME, mul(tint, 1.08), top=ZINC, w0=0.2, w1=0.8, wt=0.4)
    seg = 16 if near else 10
    d0, d1 = at - 0.6, at - 0.6 + 10.0 * k
    s.tring((0.0, 0.0), 10.0, d0, 10.0, d1, seg, FACADE, mul(tint, 1.02), 0.2, 1.0, band="b")
    s.tring((0.0, 0.0), 10.6, d1, 10.6, d1 + 1.0, seg, LIME, mul(tint, 1.12), 0.8, 0.2, cap=LIME, under=True)
    dh = 12.5 * max(k, 0.7)
    s.tdome((0.0, 0.0), 10.2, d1 + 1.0, dh, seg, 5 if near else 3, ZINC, LEAD, top_r=2.4)
    zl = d1 + 1.0 + dh * 0.97
    s.cylinder((0.0, 0.0), 2.2, zl, zl + 4.9 * k, mul(K._to_linear(np.array(STONE_RGB)).tolist(), 1.08), 8, alt=GLASS)
    s.tring((0.0, 0.0), 2.5, zl + 4.9 * k, 0.9, zl + 7.4 * k, 8, ZINC, LEAD, 0.6, 0.3, cap=ZINC)
    s.cylinder((0.0, 0.0), 0.9, zl + 7.4 * k, zl + 9.0 * k, GILT, 6, r1=0.6)
    return s, zl + 9.0 * k


def cathedral(lod, k=1.0):
    """A cathedral: nave, transept and apse under slate, lancets between buttresses, a lead fleche, two west towers
    with spires of dressed stone. With `k` under 0.8 the towers end in low pyramids of lead (no spires)."""
    s = TShell()
    near = lod == 0
    rnd = random.Random(23)
    tint = stone_tint(rnd, 0.04)
    x0, x1, hw = -14.0, 27.0, 7.5
    wall = 22.0 * k
    for p0, p1, u0 in (((x0, -hw), (x1, -hw), 0), ((x1, hw), (x0, hw), 2)):
        s.grand(p0, p1, 0.0, wall, tint, "tall", pitch=5.2, u0=u0, foot=True)
    s.tbox((x0, -hw - 0.5, wall - 0.6), (x1, hw + 0.5, wall), LIME, mul(tint, 1.12), w0=0.8, w1=0.2, wt=0.3, bottom=True, walls="SN", lid=False)
    s.thip(x0 - 0.4, x1 + 0.4, -hw - 0.4, hw + 0.4, wall, wall + 11.0 * k, SLATE, (1.0, 1.0, 1.02))
    # the transept, and the apse beyond the choir
    for sy in (-1, 1):
        ya, yb = sorted((sy * hw, sy * 15.0))
        s.tbox((6.0, ya, 0.0), (17.0, yb, wall), LIME, mul(tint, 0.98), w0=0.8, w1=0.8, foot=0.8, walls="EW" + ("S" if sy < 0 else "N"), lid=False)
    s.thip(5.6, 17.4, -15.4, 15.4, wall, wall + 10.0 * k, SLATE, (0.97, 0.97, 1.0))
    seg = 10 if near else 6
    s.tring((27.0, 0.0), hw, 0.0, hw, wall - 3.0 * k, seg, LIME, mul(tint, 0.95), 0.8, 0.8)
    s.tring((27.0, 0.0), hw + 0.3, wall - 3.0 * k, 0.0, wall + 5.0 * k, seg, ZINC, LEAD, 0.8, 0.2)
    # the fleche over the crossing
    s.tring((11.5, 0.0), 1.5, wall + 9.0 * k, 1.5, wall + 14.0 * k, 6, ZINC, LEAD, 0.3, 0.6)
    s.tring((11.5, 0.0), 1.7, wall + 14.0 * k, 0.0, wall + (31.0 if k > 0.8 else 20.0) * k, 6, ZINC, mul(LEAD, 0.95), 0.6, 0.2)
    # the west front: two towers, the gable between them
    th = 40.0 * k
    reach = 0.0
    for sy in (-1, 1):
        s.o = (-19.0, sy * 9.0)
        s.tbox((-5.0, -5.0, 0.0), (5.0, 5.0, th), LIME, tint, w0=0.8, w1=0.9, foot=0.8, lid=False)
        s.tbox((-5.4, -5.4, th * 0.65), (5.4, 5.4, th * 0.65 + 0.8), LIME, mul(tint, 1.12), w0=0.7, w1=0.2, wt=0.3, bottom=True)
        s.tbox((-5.5, -5.5, th), (5.5, 5.5, th + 1.0), LIME, mul(tint, 1.12), w0=0.8, w1=0.2, wt=0.3, bottom=True)
        a = [(-4.6, -4.6), (4.6, -4.6), (4.6, 4.6), (-4.6, 4.6)]
        tip = th + 1.0 + (21.0 * k if k > 0.8 else 6.0)
        for i in range(4):
            j = (i + 1) % 4
            if k > 0.8:
                s.tslope([(a[i][0], a[i][1], th + 1.0), (a[j][0], a[j][1], th + 1.0), (0.0, 0.0, tip)], LIME, mul(tint, 1.05 if i % 2 else 0.94), 0.5, 0.8)
            else:
                s.tslope([(a[i][0], a[i][1], th + 1.0), (a[j][0], a[j][1], th + 1.0), (0.0, 0.0, tip)], ZINC, LEAD, 0.7, 0.2)
        reach = tip
        if near and k > 0.8:
            for px in (-1, 1):
                for py in (-1, 1):
                    s.frustum(0.8, 0.8, th + 1.0, 0.0, 0.0, th + 6.0, mul(K._to_linear(np.array(STONE_RGB)).tolist(), 0.95), c=(px * 4.6, py * 4.6))
        for side in "SNEW":
            s.panel(side, 5.0, 5.0, -1.3, 1.3, th * 0.725, th * 0.95, GLASS, 0.1 if near else 0.3)
            if near:
                s.panel(side, 5.0, 5.0, -1.0, 1.0, th * 0.3, th * 0.55, GLASS, 0.1)
        s.o = (0.0, 0.0)
    gz = 27.0 * k
    s.tbox((-22.0, -4.0, 0.0), (-14.0, 4.0, gz), LIME, mul(tint, 0.96), w0=0.8, w1=0.8, foot=0.8, walls="W", lid=False)
    s.tface([(-22.0, 4.0, gz), (-22.0, -4.0, gz), (-22.0, 0.0, gz + 7.0 * k)], LIME, mul(tint, 1.04), ws=[0.3, 0.3, 0.9])
    s.tslope([(-22.0, -4.0, gz), (-14.0, -4.0, gz), (-14.0, 0.0, gz + 7.0 * k), (-22.0, 0.0, gz + 7.0 * k)], SLATE, (1.0, 1.0, 1.02))
    s.tslope([(-14.0, 4.0, gz), (-22.0, 4.0, gz), (-22.0, 0.0, gz + 7.0 * k), (-14.0, 0.0, gz + 7.0 * k)], SLATE, (1.0, 1.0, 1.02))
    s.panel("W", 22.1, 4.0, -2.6, 2.6, gz * 0.48, gz * 0.85, GLASS, 0.1)  # the rose window's place
    s.panel("W", 22.1, 4.0, -1.8, 1.8, 0.4, gz * 0.3, WOOD, 0.1)  # the portal
    for sy in (-1, 1):  # the transept's great windows
        s.panel("S" if sy < 0 else "N", 0.0, 15.0, (-1.6 + 11.5 * -sy), (1.6 + 11.5 * -sy), wall * 0.3, wall * 0.85, GLASS, 0.1 if near else 0.3)
    if near:
        for i in range(4):  # buttresses along the nave, each with its pinnacle
            x = -11.4 + 5.2 * i
            if 5.0 < x < 18.0:
                continue
            for sy in (-1, 1):
                ya, yb = sorted((sy * hw, sy * (hw + 3.2)))
                s.tbox((x - 0.6, ya, 0.0), (x + 0.6, yb, 15.0 * k), LIME, mul(tint, 1.06), w0=0.7, w1=0.8, wt=0.5, foot=0.8)
                s.frustum(0.6, 0.6, 15.0 * k, 0.0, 0.0, 19.0 * k, mul(K._to_linear(np.array(STONE_RGB)).tolist(), 1.0), c=(x, sy * (hw + 2.4)))
    return s, reach


BURIED = 1.5  # the props stand this deep in the ground (the game sinks them: a plaza is not always level)


def monument(_lod):
    s = TShell()
    z = BURIED
    t = (0.97, 0.97, 0.98)
    s.tbox((-7.5, -7.5, 0.0), (7.5, 7.5, z + 0.5), LIME, mul(t, 0.82), w0=0.6, w1=0.6, wt=0.4)
    s.tbox((-6.0, -6.0, z + 0.5), (6.0, 6.0, z + 1.0), LIME, mul(t, 0.86), w0=0.6, w1=0.4, wt=0.4)
    s.tbox((-3.6, -3.6, z + 1.0), (3.6, 3.6, z + 6.0), LIME, t, w0=0.8, w1=0.9, foot=0.8, lid=False)
    s.tbox((-4.0, -4.0, z + 6.0), (4.0, 4.0, z + 6.8), LIME, mul(t, 1.1), w0=0.7, w1=0.2, wt=0.4, bottom=True)
    s.tring((0.0, 0.0), 1.7, z + 6.8, 1.45, z + 26.0, 10, LIME, mul(t, 1.04), 0.3, 1.0)
    s.tbox((-2.3, -2.3, z + 26.0), (2.3, 2.3, z + 27.2), LIME, mul(t, 1.1), w0=0.7, w1=0.2, wt=0.4, bottom=True)
    s.cylinder((0, 0), 1.0, z + 27.2, z + 28.4, GILT, 6, r1=0.7)
    s.cylinder((0, 0), 0.9, z + 28.4, z + 32.5, GILT, 6, r1=0.0)
    return s, z + 32.5


def fountain(_lod):
    s = TShell()
    z = BURIED
    t = (1.05, 1.05, 1.05)
    s.tring((0, 0), 9.6, 0.0, 9.6, z + 0.25, 8, LIME, mul(t, 0.9), 0.6, 0.5, cap=LIME)  # the step round the basin
    s.tring((0, 0), 8.0, z + 0.25, 8.0, z + 1.15, 8, LIME, t, 0.8, 0.4, cap=LIME)
    s.cylinder((0, 0), 7.3, z + 1.15, z + 1.16, WATER, 8, r1=7.2)
    s.tring((0, 0), 1.7, z + 0.9, 1.1, z + 3.4, 8, LIME, t, 0.9, 0.5)
    s.tring((0, 0), 1.1, z + 3.4, 3.3, z + 4.1, 8, LIME, t, 0.8, 0.3)
    s.cylinder((0, 0), 3.3, z + 4.1, z + 4.11, WATER, 8, r1=3.2)
    s.tring((0, 0), 0.6, z + 4.1, 0.4, z + 6.2, 6, LIME, t, 0.9, 0.5)
    s.tring((0, 0), 0.4, z + 6.2, 1.5, z + 6.7, 6, LIME, t, 0.8, 0.3, cap=LIME)
    s.cylinder((0, 0), 0.35, z + 6.7, z + 8.3, GILT, 6, r1=0.0)
    return s, z + 8.3


def pier_foot(_lod):
    """For a pier 2.8 m square (the game scales it for the thicker ones): the shaft comes down into the top of this."""
    s = TShell()
    t = (0.95, 0.94, 0.93)
    s.tbox((-6.2, -6.2, 0.0), (6.2, 6.2, 5.0), LIME, mul(t, 0.78), top=LIME, w0=0.9, w1=0.5, wt=0.4, foot=0.75)
    s.tfrustum((-5.4, -5.4), (5.4, 5.4), 5.0, (-3.9, -3.9), (3.9, 3.9), 8.5, LIME, mul(t, 0.94), w_eaves=0.7)
    s.tbox((-3.9, -3.9, 8.5), (3.9, 3.9, 13.0), LIME, mul(t, 0.94), w0=0.3, w1=0.9, lid=False)
    s.tbox((-4.3, -4.3, 13.0), (4.3, 4.3, 13.8), LIME, mul(t, 1.1), w0=0.7, w1=0.2, wt=0.4, bottom=True)
    s.tfrustum((-3.9, -3.9), (3.9, 3.9), 13.8, (-2.3, -2.3), (2.3, 2.3), 17.5, LIME, mul(t, 0.88), top=LIME, w_eaves=0.6)
    for nx, ny in ((1, 0), (-1, 0), (0, 1), (0, -1)):
        # a buttress on each side: a fin that steps in twice
        for d0, d1, z1 in ((6.2, 8.4, 4.0), (5.2, 7.2, 8.0), (3.9, 5.6, 12.0)):
            lo = (min(nx * d0, nx * d1) - (0.0 if nx else 1.1), min(ny * d0, ny * d1) - (0.0 if ny else 1.1), 0.0)
            hi = (max(nx * d0, nx * d1) + (0.0 if nx else 1.1), max(ny * d0, ny * d1) + (0.0 if ny else 1.1), z1)
            s.tbox(lo, hi, LIME, mul(t, 0.78 if z1 < 5 else 0.88), w0=0.8, w1=0.5, wt=0.5, foot=0.8)
    return s, 17.5


# ---------------------------------------------------------------------------------------------------------------------
# the set
# ---------------------------------------------------------------------------------------------------------------------
H_WIDTHS = (26.1, 31.9, 37.7, 43.5, 52.2)  # 9, 11, 13, 15, 18 bays
H_HEIGHTS = (11.5, 14.0, 17.0, 20.5, 24.5, 29.0, 34.0, 40.0, 46.5)
# which sizes are built, and how many of each (the sizes the plan's lots ask for most get two: neighbours can differ)
H_SKIP = {(26.1, 40.0), (26.1, 46.5), (26.1, 11.5), (31.9, 11.5), (31.9, 46.5), (37.7, 11.5), (52.2, 11.5), (52.2, 14.0)}
H_TWO = {(31.9, 17.0), (31.9, 20.5), (31.9, 24.5), (37.7, 20.5), (37.7, 24.5), (43.5, 17.0), (43.5, 20.5), (43.5, 24.5), (43.5, 29.0), (43.5, 34.0), (52.2, 24.5), (52.2, 34.0)}

UNITS = []  # (name, family, maker(lod) -> (shell, reach), single)
for wi, w in enumerate(H_WIDTHS):
    for hi, h in enumerate(H_HEIGHTS):
        if (w, h) in H_SKIP:
            continue
        for v in range(2 if (w, h) in H_TWO else 1):
            UNITS.append((f"h{round(w)}_{round(h)}{'ab'[v]}", "H", (lambda lod, w=w, h=h, sd=1000 + wi * 100 + hi * 10 + v: h_row(lod, w, h, sd)), False))
for hi, h in enumerate((24.0, 30.0, 36.5, 44.0, 52.0)):
    UNITS.append((f"t{round(h)}", "T", (lambda lod, h=h, sd=3000 + hi: t_house(lod, h, sd)), False))
for wi, w in enumerate((27.0, 32.5)):
    for hi, h in enumerate((16.0, 21.0, 27.0, 33.0, 39.5, 47.0, 55.0)):
        if (wi, hi) in ((0, 6), (0, 0)):
            continue
        UNITS.append((f"d{round(w)}_{round(h)}", "D", (lambda lod, w=w, h=h, sd=4000 + wi * 10 + hi, stone=(wi + hi) % 2 == 1: d_block(lod, w, h, sd, stone)), False))
for make, low in ((deco_hall, 0.56), (deco_tower, 0.45), (belfry, 0.56), (dome, 0.6), (cathedral, 0.52)):
    UNITS.append((make.__name__, make.__name__, (lambda lod, make=make: make(lod)), False))
    UNITS.append((f"{make.__name__}_low", make.__name__, (lambda lod, make=make, low=low: make(lod, low)), False))
for make in (monument, fountain, pier_foot):
    UNITS.append((make.__name__, "prop", make, True))

MAT = bpy.data.materials.new("M_buildings")  # (only for the checks of `finished`)
objects = []
rows = []
for name, family, make, single in UNITS:
    tris = []
    for lod in ((0,) if single else (0, 1)):
        shell, reach = make(lod)
        ob = finished(shell, name if single else f"{name}_lod{lod}", MAT, 2300 if lod == 0 else 760)
        # the units go into the file without a material: the exporter then writes the colour attribute as COLOR_0 with
        # its alpha (VEC4), which it leaves out for an opaque material; the game draws them with the city's material
        ob.data.materials.clear()
        ob.data.color_attributes.render_color_index = ob.data.color_attributes.find("Color")
        objects.append(ob)
        tris.append(K.triangles(ob))
        if lod == 0:
            xs = [[v.co[i] for v in ob.data.vertices] for i in range(3)]
            lo, hi = [min(x) for x in xs], [max(x) for x in xs]
            # glTF axes: Blender's -Y is +Z there
            rows.append({"name": name, "family": family, "w": hi[0] - lo[0], "d": hi[1] - lo[1], "h": reach, "top": hi[2], "cx": (hi[0] + lo[0]) / 2, "cz": -(hi[1] + lo[1]) / 2, "tris": tris})
objects.append(texture_set())
bpy.context.view_layer.update()
K.export(OUT, objects)
print(f"UNITS {len(rows)}: near {sum(r['tris'][0] for r in rows)} triangles, far {sum(r['tris'][-1] for r in rows if len(r['tris']) > 1)}")

if TABLE:
    r1 = lambda v: f"{round(v, 1):g}"  # noqa: E731
    r2 = lambda v: f"{round(v, 2) + 0.0:g}"  # noqa: E731
    lines = [
        "// Generated by art/blender/gen_buildings.py (--table): the units of buildings.glb as measured from their near meshes.",
        "// Do not edit by hand: rebuild the GLB instead.",
        "import type { UnitInfo } from './models.ts';",
        "",
        "export const UNITS: readonly UnitInfo[] = [",
    ]
    for r in rows:
        tr = r["tris"] if len(r["tris"]) > 1 else r["tris"] * 2
        lines.append(f"  {{ name: '{r['name']}', family: '{r['family']}', w: {r1(r['w'])}, d: {r1(r['d'])}, h: {r1(r['h'])}, top: {r1(r['top'])}, cx: {r2(r['cx'])}, cz: {r2(r['cz'])}, tris: [{tr[0]}, {tr[1]}] }},")
    lines += ["];", ""]
    with open(TABLE, "w", encoding="utf-8", newline="\n") as fh:
        fh.write("\n".join(lines))
    print(f"wrote {TABLE}")
