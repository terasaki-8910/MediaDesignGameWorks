"""Textured, weathered building units for the background city (a look test, `?bldg=tex`): public/assets/citytex.glb.

    node <game3d>/scripts/blender.mjs art/blender/gen_citytex.py -- --out public/assets/citytex.glb

Four units, each as <name>_lod0 (near) and <name>_lod1 (far), drawn by the game in the city's one batch:
  tx_corner  a Haussmann corner: two houses and a corner rotunda under a slate dome
  tx_mid     a Haussmann mid-block: three houses of different heights between party walls
  tx_end     the end of a row: two houses, the outer one with its blank gable wall (mur pignon) and its flues
  tx_deco    an Art Deco mass: plinth, piers before bands of glazing, two setbacks, a stepped crown with corner pylons
A unit is a row of houses, not one house: each house has its own eaves height, storey height, stone tint, dormer rhythm
and chimney stacks, so neighbours differ inside one unit and from unit to unit.

Materials: five tiled layers of 512 x 256 px, shared by every building (the game puts them into one array texture and
draws the units with the city's one material, one draw call). They are made here from Poly Haven photographs (CC0, see
docs/asset-manifest.json) and carried in this file as plain images on a small mesh, `tx_set`:
  0 limestone   sandstone_blocks_08, less saturated, at the city's stone colour                  6.0 x 6.0 m a tile
  1 facade      the same stone (two repeats) with a ground floor arcade and two storeys of windows painted in:
                surrounds, shaded reveals, glass, curtains, shutters, sills                     11.6 x 10.8 m, four bays
  2 slate       grey_roof_tiles_02 at the city's slate colour, with broad patches               8.0 x 8.0 m
  3 zinc        blue_metal_plate, nearly grey, at the city's zinc colour (its seams are the sheet's) 4.6 x 4.6 m
  4 glazing     the Art Deco glazing: panes in bronze frames, each pane its own tone, painted here 5.8 x 7.4 m
Each layer has a weathering mask in its alpha (where dirt gathers first: from large_sandstone_blocks' own staining for
the stone, rain streaks under the sills for the facade, blotches and runs for the roofs). The images hold the colours as
JPEG; the five masks are packed into the channels of two more images (tx_mask_a: layers 0, 1, 2; tx_mask_b: 3, 4).

Per vertex: COLOR_0's rgb tints the layer (a house's stone, a darker ground floor), its alpha says which layer and how
weathered: alpha = (layer + 0.05 + 0.9 * weather) / 8, weather 0 to 1 rising under cornices, balconies and sills, at the
foot of the ground floor, along the eaves and at the top of chimney stacks (baked from the geometry, a value a corner).
Alpha 1 is the city's own atlas (city_kit.py): its plain colours (glass, rails, pots, gilt). The game multiplies the weather by the
layer's mask, so the same stone streaks differently on every wall (atmosphere.ts).

No normal map: the walls are seen from 120 m and more, where a texel of it is a fraction of a pixel, and the city's
light has no specular term to show it. Origin: ground centre of the footprint; +X is the long side.
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
OUT = opts.get("out", "public/assets/citytex.glb")
K.reset()

TW, TH = 512, 256
LIME, FACADE, SLATE, ZINC, GLAZING = 0, 1, 2, 3, 4
# metres one tile covers (u, v)
TILE_M = {LIME: (6.0, 6.0), SLATE: (8.0, 8.0), ZINC: (4.6, 4.6), GLAZING: (5.8, 7.4)}
GROUND_H, STOREY_H = 4.64, 3.08  # the facade tile's bands, in metres: 110 + 73 + 73 rows of 256
BANDS = {"ground": (0, 110), "a": (110, 183), "b": (183, 256)}

POT = K.srgb("#8A7E73")
SOOT = (0.8, 0.77, 0.73)
IRON = K.srgb("#777269")  # a rail seen from afar: iron bars and the stone behind them, as one tone


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


def noise(rng, sx, sy):
    """Soft tiling noise in 0..1 at a scale of sx, sy pixels."""
    return stretch(blur(rng.random((TH, TW)), sx, sy), 1.0, 99.0)


def layers():
    """The five layers as linear RGB [5, TH, TW, 3] and their masks [5, TH, TW] (rows from the bottom)."""
    rng = np.random.default_rng(2411)
    rgb = np.zeros((5, TH, TW, 3))
    mask = np.zeros((5, TH, TW))

    # 0 limestone: the photo's ashlar at the city's stone colour; block by block a little apart in tone (soft patches)
    src = photo("sandstone_blocks_08")
    stone_full = toned(src, STONE_RGB, 0.55, 1.15)
    stone = pool(stone_full, TW, TH)
    stone *= (0.955 + 0.09 * noise(rng, 22, 9))[..., None]
    rgb[LIME] = stone
    # where dirt gathers on stone: the staining of a weathered wall (large_sandstone_blocks), dark = dirty
    stain = 1.0 - stretch(blur(luma(pool(photo("large_sandstone_blocks"), TW, TH)), 1.2, 1.2))
    runs = noise(rng, 2.0, 40.0)  # rain runs down a wall
    mask[LIME] = stretch(0.6 * stain + 0.4 * runs)

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

    # 1 facade: two repeats of the stone each way, then the openings painted in
    f = np.tile(pool(stone_full, TW // 2, TH // 2), (2, 2, 1))
    f *= (0.96 + 0.08 * noise(rng, 30, 12))[..., None]
    m = 0.45 * np.tile(pool(stain[..., None], TW // 2, TH // 2)[..., 0], (2, 2)) + 0.25 * noise(rng, 2.0, 30.0)
    stone_c = K._to_linear(np.array(STONE_RGB))
    glass = K._to_linear(np.array([0.37, 0.375, 0.385]))  # (nearly neutral: a front of windows stays stone-coloured from afar)
    px, py = TW / (4 * BAY), TH / (GROUND_H + 2 * STOREY_H)  # pixels a metre, across and up
    bay = TW // 4

    def rect(x0, x1, y0, y1):
        return slice(max(int(round(y0)), 0), min(int(round(y1)), TH)), slice(int(round(x0)), int(round(x1)))

    def opening(b, base, x0m, x1m, z0m, z1m, arch=False, kind="window"):
        """One opening of bay `b` in the band that starts at row `base`: surround, reveal, glass or shutters or a door."""
        x0, x1 = b * bay + x0m * px, b * bay + x1m * px
        y0, y1 = base + z0m * py, base + z1m * py
        f[rect(x0 - 0.17 * px, x1 + 0.17 * px, y0 - (0.0 if kind != "window" else 0.14 * py), y1 + 0.2 * py)] = stone_c * 1.1  # the surround
        f[rect(x0 - 0.3 * px, x1 + 0.3 * px, y1 + 0.2 * py, y1 + 0.34 * py)] = stone_c * 1.14  # its head moulding
        f[rect(x0 - 0.3 * px, x1 + 0.3 * px, y1 + 0.13 * py, y1 + 0.2 * py)] = stone_c * 0.62  # and the line of shade under it
        ys, xs = np.mgrid[int(round(y0)):int(round(y1)), int(round(x0)):int(round(x1))]
        t = ((ys - y0) / max(y1 - y0, 1.0))[..., None]
        tone = 0.86 + 0.28 * rng.random()
        if kind == "door":
            pane = np.broadcast_to(K._to_linear(np.array([0.27, 0.23, 0.2])) * tone, t.shape[:2] + (3,)).copy()
        elif kind == "shutters":
            pane = K._to_linear(np.array([0.5, 0.53, 0.54])) * tone * (0.88 + 0.12 * ((ys // 2) % 2))[..., None]
        else:
            pane = glass * tone * (0.75 + 0.7 * t)  # the glass takes the sky: lighter towards its head
            if kind == "curtain":
                drawn = (t[..., 0] < 0.55 + 0.3 * rng.random()) & (np.abs((xs - (x0 + x1) / 2) / (x1 - x0)) > 0.08)
                pane[drawn] = pane[drawn] * 0.45 + K._to_linear(np.array([0.66, 0.63, 0.57])) * 0.55
            if kind == "shop":
                pane = pane * 0.8 + K._to_linear(np.array([0.5, 0.42, 0.3])) * 0.2 * (1.0 - t)  # a lit interior, faintly
        inside = np.ones(t.shape[:2], bool)
        if arch:
            r = (x1 - x0) / 2
            cy = y1 - r * py / px
            inside = (ys < cy) | (((xs - (x0 + x1 - 1) / 2) / r) ** 2 + ((ys - cy) / (r * py / px)) ** 2 < 1.0)
        if kind in ("window", "curtain", "shop"):
            mid = (xs == int(round((x0 + x1) / 2)))
            bar = (ys == int(round(y0 + (y1 - y0) * 0.68)))
            pane[mid | bar] = K._to_linear(np.array([0.5, 0.5, 0.5])) if kind != "shop" else pane[mid | bar] * 0.6
        shade = np.ones(t.shape[:2])
        shade[ys > y1 - 0.24 * py] = 0.62  # the reveal's shade: under the head, and down one jamb
        shade[xs < x0 + 0.1 * px] = np.minimum(shade[xs < x0 + 0.1 * px], 0.74)
        region = f[int(round(y0)):int(round(y1)), int(round(x0)):int(round(x1))]
        region[inside] = (pane * shade[..., None])[inside]
        m[int(round(y0)):int(round(y1)), int(round(x0)):int(round(x1))][inside] = 0.0  # glass does not streak
        return x0, x1, y0, y1

    def streaks(x0, x1, y1, depth, strength):
        """Rain under a sill: runs of different length, strongest just under it (into the colour and into the mask)."""
        ya, yb = int(round(y1 - depth * py)), int(round(y1))
        xa, xb = int(round(x0)), int(round(x1))
        col = (0.35 + 0.65 * rng.random(xb - xa))[None, :]
        t = np.linspace(0.0, 1.0, yb - ya)[:, None] ** 1.6
        run = np.clip(t * col * 1.4 - (1.0 - col) * 0.5, 0.0, 1.0)
        f[ya:yb, xa:xb] *= (1.0 - 0.1 * strength * run)[..., None]
        m[ya:yb, xa:xb] = np.maximum(m[ya:yb, xa:xb], 0.45 + 0.55 * run * strength)

    # the ground floor: rusticated courses, a plinth, an arcade (one bay a door of dark wood, one a shop), a string course
    g0, g1 = BANDS["ground"]
    for z in np.arange(0.52, GROUND_H - 0.5, 0.52):
        f[rect(0, TW, g0 + z * py - 1, g0 + z * py + 1)] *= 0.72
    f[rect(0, TW, g0, g0 + 0.55 * py)] *= 0.86
    m[rect(0, TW, g0, g0 + 0.9 * py)] += 0.3
    for b, kind in enumerate(("window", "door", "shop", "window")):
        opening(b, g0, 0.42, 2.48, 0.0 if kind != "window" else 0.75, 3.55, arch=True, kind=kind)
    f[rect(0, TW, g1 - 0.32 * py, g1)] = stone_c * 1.1
    f[rect(0, TW, g1 - 0.42 * py, g1 - 0.32 * py)] = stone_c * 0.58
    streaks(0, TW, g1 - 0.42 * py, 0.9, 0.7)
    # storey a: tall windows down to the floor (they open on a balcony); storey b: windows over a sill, one bay shuttered
    a0, _ = BANDS["a"]
    for b, kind in enumerate(("curtain", "window", "window", "curtain")):
        opening(b, a0, 0.82, 2.08, 0.12, 2.6, kind=kind)
    b0, _ = BANDS["b"]
    for b, kind in enumerate(("window", "curtain", "shutters", "window")):
        x0, x1, y0, _y1 = opening(b, b0, 0.85, 2.05, 0.85, 2.55, kind=kind)
        f[rect(x0 - 0.22 * px, x1 + 0.22 * px, y0 - 0.26 * py, y0 - 0.12 * py)] = stone_c * 1.14  # the sill
        streaks(x0 - 0.15 * px, x1 + 0.15 * px, y0 - 0.26 * py, 1.0, 1.0)
    rgb[FACADE] = f
    mask[FACADE] = np.clip(m, 0.0, 1.0)

    # 4 glazing (Art Deco): panes 0.725 x 0.925 m in bronze frames, each taking the sky a little differently; every
    # fourth row a spandrel panel of dark bronze (the floors behind the glass)
    g = np.zeros((TH, TW, 3))
    cw, rh = TW // 8, TH // 8
    bronze = K._to_linear(np.array([0.36, 0.35, 0.32]))
    for r in range(8):
        for c in range(8):
            t = np.linspace(0.0, 1.0, rh)[:, None, None]
            if r % 4 == 0:
                cell = np.broadcast_to(bronze * (1.05 + 0.2 * rng.random()), (rh, cw, 3)).copy()
            else:
                cell = np.broadcast_to(glass * (1.1 + 0.35 * rng.random()) * (0.85 + 0.4 * t), (rh, cw, 3)).copy()
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
    """`tx_set`: seven small quads below the ground, one for each image (five layers, two of masks)."""
    rgb, mask = layers()
    for k, n in enumerate(("limestone", "facade", "slate", "zinc", "glazing")):
        lum = luma(rgb[k].reshape(-1, 3)).mean()
        print(f"LAYER {k} {n}: mean linear {rgb[k].reshape(-1, 3).mean(axis=0).round(4).tolist()}, luminance {lum:.4f}, mask mean {mask[k].mean():.3f}")
    images = [image(f"tx_{n}", K._to_srgb(rgb[k])) for k, n in enumerate(("limestone", "facade", "slate", "zinc", "glazing"))]
    images.append(image("tx_mask_a", np.stack([mask[0], mask[1], mask[2]], axis=2)))
    images.append(image("tx_mask_b", np.stack([mask[3], mask[4], np.zeros((TH, TW))], axis=2)))
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
    return (layer + 0.05 + 0.9 * min(1.0, max(0.0, weather))) / 8.0


class TShell(Shell):
    """Shell with faces that show a tiled layer: `tface` and what is built from it. Shell's own faces (alpha 1) stay the
    city's atlas: plain colours."""

    def tface(self, pts, layer, tint=(1.0, 1.0, 1.0), w=0.0, uvs=None, ws=None, tints=None):
        """A face showing `layer`, tinted; `w` its weathering (or `ws` one a corner). Without `uvs` the layer lies on it
        at its own scale, by the face's own plane: U along the horizontal, V up the wall or up the slope."""
        f = self.bm.faces.new([self.bm.verts.new((p[0] + self.o[0], p[1] + self.o[1], p[2])) for p in pts])
        f.normal_update()
        n = f.normal
        if uvs is None:
            tw, th = TILE_M[layer]
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

    def tbox(self, lo, hi, layer, tint=(1.0, 1.0, 1.0), top=None, top_tint=None, w0=0.0, w1=0.0, wt=0.0, bottom=False, walls="SNEW", foot=None):
        """A box showing `layer` on its walls (weathering from w0 at the foot to w1 at the head) and `top` (a layer) above."""
        (x0, y0, z0), (x1, y1, z1) = lo, hi
        for side, a, b in (("S", (x0, y0), (x1, y0)), ("E", (x1, y0), (x1, y1)), ("N", (x1, y1), (x0, y1)), ("W", (x0, y1), (x0, y0))):
            if side in walls:
                self.twall(a, b, z0, z1, layer, tint, w0, w1, foot)
        self.tface([(x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1)], layer if top is None else top, top_tint or tint, wt)
        if bottom:
            self.tface([(x0, y1, z0), (x1, y1, z0), (x1, y0, z0), (x0, y0, z0)], layer, mul(tint, 0.76), 0.8)

    def front(self, p0, p1, z0, plan, tint, u0=0, top_w=1.0):
        """A front of the facade tile from p0 to p1: `plan` is its storeys from the ground up, (band, height) each, a quad
        a storey. The bays are fitted to its length; `u0` says which of the tile's four bays comes first. The storey under
        the cornice is streaked from its head (`top_w`), the ground floor from its foot. Returns the height reached."""
        length = math.hypot(p1[0] - p0[0], p1[1] - p0[1])
        bays = max(1, round(length / BAY))
        ua, ub = u0 / 4.0, (u0 + bays) / 4.0
        z = z0
        for k, (band, h) in enumerate(plan):
            r0, r1 = BANDS[band]
            va, vb = (r0 + 0.6) / TH, (r1 - 0.6) / TH
            last = k == len(plan) - 1
            if band == "ground":
                ws, low = [0.6, 0.6, 0.3, 0.3], mul(tint, 0.94)  # (the street's dirt at its foot; a tone under the storeys above)
                tints = [low] * 4
            else:
                under = top_w if last else (0.55 if plan[k + 1][0] == "a" else 0.22)  # (a balcony stands over this storey)
                ws = [0.1, 0.1, under, under]
                tints = [tint] * 4
            self.tface([(p0[0], p0[1], z), (p1[0], p1[1], z), (p1[0], p1[1], z + h), (p0[0], p0[1], z + h)], FACADE, tint, uvs=[(ua, va), (ub, va), (ub, vb), (ua, vb)],
                       ws=ws, tints=tints)
            z += h
        return z

    def tslope(self, pts, layer, tint, w_eaves=0.7, w_top=0.15):
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
            self.tslope(f, layer, tint, 0.55, 0.1)

    def rail_run(self, p0, p1, z0, h=1.0):
        """An iron balcony rail from p0 to p1 (left to right seen from outside): a band of one tone, the iron and what
        shows through it (bars would be finer than a pixel from where the walls are seen)."""
        self.face([(p0[0], p0[1], z0), (p1[0], p1[1], z0), (p1[0], p1[1], z0 + h), (p0[0], p0[1], z0 + h)], IRON)


def house(s, lod, x0, x1, hy, floors, seed, tint, storey=3.08, ground=4.64, roof=4.8, inset=1.5, dormer="each", chimneys=2, sides="SN", gable=None, balcony=(2, -1)):
    """One house of a row, from x0 to x1 and `hy` deep either way: fronts on its `sides` (the others are party walls of
    plain stone), balcony slabs with rails, a cornice over a frieze, a slate mansard with dormers (`dormer`: "each" bay,
    every "other" one, in "pairs", or "none"), a zinc roof and chimney stacks. `gable` ("W" or "E") makes that end a
    blank gable wall with its flues, weathered from the top. Returns the height of the roof's flat."""
    near = lod == 0
    rnd = random.Random(seed)
    n = floors - 1
    plan = [("ground", ground)] + [("a" if (f in (balcony[0], n + 1 + balcony[1] if balcony[1] < 0 else balcony[1])) else "b", storey) for f in range(1, floors)]
    eaves = ground + n * storey
    corners = {"S": ((x0, -hy), (x1, -hy)), "E": ((x1, -hy), (x1, hy)), "N": ((x1, hy), (x0, hy)), "W": ((x0, hy), (x0, -hy))}
    for side in "SENW":
        p0, p1 = corners[side]
        if side in sides:
            s.front(p0, p1, 0.0, plan, tint, u0=rnd.randrange(4))
        else:
            # a party wall, or a gable: plain stone, darker, run with rain from its head
            g = side == gable
            s.twall(p0, p1, 0.0, eaves, LIME, mul(tint, 0.92 if g else 0.88), 0.5 if g else 0.35, 1.0 if g else 0.7, foot=0.9)
    # balcony slabs (a line of shade under each), their rails
    for f, (band, _) in enumerate(plan):
        if band != "a":
            continue
        z = ground + (f - 1) * storey
        for side in sides:
            (nx, ny), (rx, ry) = FACES[side]
            p0, p1 = corners[side]
            out = 0.8
            lo = (min(p0[0], p1[0]) + min(0, nx) * out, min(p0[1], p1[1]) + min(0, ny) * out, z - 0.22)
            hi = (max(p0[0], p1[0]) + max(0, nx) * out, max(p0[1], p1[1]) + max(0, ny) * out, z + 0.05)
            s.tbox(lo, hi, LIME, mul(tint, 1.1), w0=0.5, w1=0.2, wt=0.25, bottom=True, walls="SNEW".replace({"S": "N", "N": "S", "E": "W", "W": "E"}[side], ""))
            if near:
                q0 = (p0[0] + nx * (out - 0.08), p0[1] + ny * (out - 0.08))
                q1 = (p1[0] + nx * (out - 0.08), p1[1] + ny * (out - 0.08))
                s.rail_run(q0, q1, z + 0.05)
    # the cornice over its frieze
    out = 1.0 if near else 0.6
    s.tbox((x0 - (out if "W" in sides or gable == "W" else 0.0), -hy - out, eaves - 0.12), (x1 + (out if "E" in sides or gable == "E" else 0.0), hy + out, eaves + 0.5), LIME, mul(tint, 1.12),
           w0=0.75, w1=0.15, wt=0.3, bottom=True)
    top = eaves + 0.5
    # the mansard: a steep slope of slate (stained along the eaves), a zinc ledge at its break, a low zinc roof hipped to a ridge
    slate = (0.92 + 0.16 * rnd.random(),) * 3
    slate = (slate[0] * (1.0 + 0.03 * (rnd.random() - 0.5)), slate[1], slate[2] * (1.0 + 0.05 * (rnd.random() - 0.5)))
    zinc = (0.94 + 0.12 * rnd.random(),) * 3
    a = [(x0, -hy - 0.1, top), (x1, -hy - 0.1, top), (x1, hy + 0.1, top), (x0, hy + 0.1, top)]
    ix0 = x0 + (inset if "W" in sides else 0.0)
    ix1 = x1 - (inset if "E" in sides else 0.0)
    b = [(ix0, -hy + inset, top + roof), (ix1, -hy + inset, top + roof), (ix1, hy - inset, top + roof), (ix0, hy - inset, top + roof)]
    for i, side in enumerate("SENW"):
        j = (i + 1) % 4
        if side in "SN" or side in sides:
            s.tslope([a[i], a[j], b[j], b[i]], SLATE, slate)
        else:
            # the party wall carried up to the roof's flat (a gable of stone and render, the flues inside it)
            g = side == gable
            s.tface([a[i], a[j], b[j], b[i]], LIME, mul(tint, 0.82 if g else 0.78), ws=[0.7, 0.7, 1.0, 1.0])
    rz = top + roof
    if near:
        s.tbox((ix0 - 0.25, -hy + inset - 0.25, rz - 0.1), (ix1 + 0.25, hy - inset + 0.25, rz + 0.12), ZINC, mul(zinc, 1.15), w0=0.5, w1=0.2, wt=0.2)
        rz += 0.12
    ridge = 0.3 * (hy - inset)
    s.thip(ix0, ix1, -hy + inset, hy - inset, rz, rz + ridge, ZINC, zinc)
    # dormers: a stone front under a zinc cap, standing out of the slates; their rhythm is the house's own
    if dormer != "none":
        bays = max(1, round((x1 - x0) / BAY))
        bw = (x1 - x0) / bays
        dw, dh = 0.62 + 0.14 * rnd.random(), 2.2 + 0.5 * rnd.random()
        back = inset * (0.6 + dh) / roof + 0.15
        for i in range(bays):
            if (dormer == "other" and i % 2 == seed % 2) or (dormer == "pairs" and i % 3 == 2):
                continue
            x = x0 + (i + 0.5) * bw
            for sy in (-1, 1):
                y0, y1 = sorted((sy * (hy - 0.3), sy * (hy - back)))
                if near:
                    s.tbox((x - dw, y0, top + 0.6), (x + dw, y1, top + 0.6 + dh), LIME, mul(tint, 1.04), top=ZINC, top_tint=mul(zinc, 1.12), w0=0.15, w1=0.6, wt=0.3,
                           walls="SEW" if sy < 0 else "NEW")
                    u0, u1 = sorted(((x - dw + 0.2) * -sy, (x + dw - 0.2) * -sy))
                    s.panel("S" if sy < 0 else "N", 0.0, 0.0, u0, u1, top + 0.95, top + 0.35 + dh, GLASS, hy - 0.26)
                else:
                    s.tbox((x - dw, y0, top + 0.6), (x + dw, y1, top + 0.6 + dh), LIME, mul(tint, 0.95), top=ZINC, top_tint=zinc, w0=0.15, w1=0.6, wt=0.3, walls="S" if sy < 0 else "N")
    # chimney stacks: rendered stone under soot, each where its flues come up, with their pots (near)
    for i in range(chimneys):
        x = ix0 + 1.0 + (ix1 - ix0 - 2.0) * (i + 0.2 + 0.6 * rnd.random()) / chimneys
        side = -1 if rnd.random() < 0.5 else 1
        y = side * min(hy - inset - 1.0, 0.6 + 1.8 * rnd.random())
        w, l, h = 0.5 + 0.3 * rnd.random(), 0.9 + 0.9 * rnd.random(), ridge + 1.4 + 1.5 * rnd.random()
        s.tbox((x - w, y - l, rz - 0.3), (x + w, y + l, rz + h), LIME, mul(SOOT, 0.9 + 0.2 * rnd.random()), w0=0.35, w1=1.0, wt=0.9)
        if near:  # its row of pots, as one block
            s.box((x - 0.2, y - l * 0.75, rz + h), (x + 0.2, y + l * 0.75, rz + h + 0.6), POT)
    if gable:
        # the gable wall's flues: a stepped stack rising through the end of the roof (the Paris mur pignon)
        sx = -1 if gable == "W" else 1
        xe = x0 if gable == "W" else x1
        xa, xb = sorted((xe, xe - sx * 1.0))
        s.tbox((xa, -hy * 0.42, top), (xb, hy * 0.42, rz + ridge + 1.6), LIME, mul(SOOT, 0.95), w0=0.5, w1=1.0, wt=0.9)
        if near:
            s.box(((xa + xb) / 2 - 0.2, -hy * 0.34, rz + ridge + 1.6), ((xa + xb) / 2 + 0.2, hy * 0.34, rz + ridge + 2.2), POT)
    return rz


def stone_tint(rnd, value=0.08, warm=0.035):
    """A house's own stone: its value within +-`value`, a little warmer or cooler."""
    v = 1.0 + value * (2.0 * rnd.random() - 1.0)
    h = warm * (2.0 * rnd.random() - 1.0)
    return (v * (1.0 + h), v, v * (1.0 - h))


def tx_mid(lod):
    """Mid-block: three houses between party walls, 44 m of front, each its own height, stone and roof."""
    s = TShell()
    rnd = random.Random(101)
    hy = 9.5
    house(s, lod, -22.0, -4.6, hy, 7, 11, stone_tint(rnd), storey=3.02, dormer="each", chimneys=3, sides="SNW")
    house(s, lod, -4.6, 7.0, hy - 0.5, 8, 12, stone_tint(rnd), storey=3.1, ground=4.9, roof=5.3, dormer="other", chimneys=2, sides="SN", balcony=(2, -2))
    house(s, lod, 7.0, 22.0, hy, 6, 13, stone_tint(rnd), storey=3.3, ground=5.0, roof=4.6, dormer="pairs", chimneys=3, sides="SNE")
    return s


def tx_end(lod):
    """The end of a row: a house of six storeys and a lower one whose outer end is a blank gable wall with its flues."""
    s = TShell()
    rnd = random.Random(202)
    hy = 9.0
    house(s, lod, -15.0, 2.4, hy, 6, 21, stone_tint(rnd), storey=3.0, dormer="other", chimneys=3, sides="SNW")
    house(s, lod, 2.4, 15.0, hy - 0.6, 5, 22, stone_tint(rnd), storey=3.2, ground=4.4, roof=4.4, dormer="each", chimneys=2, sides="SN", gable="E", balcony=(1, -1))
    return s


def tx_corner(lod):
    """A corner: two houses and, on the corner, a rotunda of the same storeys under a slate dome and a zinc lantern."""
    s = TShell()
    rnd = random.Random(303)
    hy = 9.6
    t0, t1 = stone_tint(rnd), stone_tint(rnd)
    house(s, lod, -22.8, -6.0, hy, 6, 31, t0, storey=3.12, dormer="pairs", chimneys=3, sides="SNW")
    house(s, lod, -6.0, 13.0, hy, 6, 32, t1, storey=3.0, ground=4.9, roof=5.0, dormer="each", chimneys=3, sides="SNE", balcony=(2, -1))
    # the rotunda: a facade bay to every segment, its string courses and cornice running round, a dome of slate
    c = (16.4, 0.0)
    r = 6.4
    seg = 12 if lod == 0 else 8
    tint = mul(t1, 1.04)
    plan = [("ground", 4.9)] + [("a" if f in (2, 5) else "b", 3.0) for f in range(1, 7)]
    z = 0.0
    ring = lambda rr, zz: [(c[0] + rr * math.cos(2 * math.pi * i / seg), c[1] + rr * math.sin(2 * math.pi * i / seg), zz) for i in range(seg)]  # noqa: E731
    for k, (band, h) in enumerate(plan):
        r0, r1 = BANDS[band]
        va, vb = (r0 + 0.6) / TH, (r1 - 0.6) / TH
        lo, hi = ring(r, z), ring(r, z + h)
        last = k == len(plan) - 1
        for i in range(seg):
            j = (i + 1) % seg
            ws = [0.6, 0.6, 0.3, 0.3] if band == "ground" else [0.1, 0.1, 1.0 if last else 0.3, 1.0 if last else 0.3]
            tt = mul(tint, 0.94) if band == "ground" else tint
            s.tface([lo[i], lo[j], hi[j], hi[i]], FACADE, tt, uvs=[(i / 4.0, va), ((i + 1) / 4.0, va), ((i + 1) / 4.0, vb), (i / 4.0, vb)], ws=ws)
        if lod == 0 and band == "a":
            a, b = ring(r + 0.6, z - 0.2), ring(r + 0.6, z + 0.05)
            for i in range(seg):
                j = (i + 1) % seg
                s.tface([a[i], a[j], b[j], b[i]], LIME, mul(tint, 1.1), 0.4)
            s.tface(b, LIME, mul(tint, 1.1), 0.25)
            s.tface(a[::-1], LIME, mul(tint, 0.76), 0.8)
        z += h

    def drum(r0, r1, z0, z1, layer, tt, w0, w1, cap=None):
        a, b = ring(r0, z0), ring(r1, z1)
        for i in range(seg):
            j = (i + 1) % seg
            if r1 < 1e-6:
                s.tface([a[i], a[j], (c[0], c[1], z1)], layer, tt, ws=[w0, w0, w1])
            else:
                s.tface([a[i], a[j], b[j], b[i]], layer, tt, ws=[w0, w0, w1, w1])
        if cap is not None and r1 > 1e-6:
            s.tface(b, cap, tt, 0.3)

    drum(r + 0.9, r + 0.9, z - 0.12, z + 0.5, LIME, mul(tint, 1.12), 0.75, 0.15, cap=LIME)
    s.tface(ring(r + 0.9, z - 0.12)[::-1], LIME, mul(tint, 0.76), 0.8)
    z += 0.5
    rings = 4 if lod == 0 else 2
    slate = (0.98, 0.98, 1.0)
    for k in range(rings):
        a0, a1 = (math.pi / 2) * k / rings, (math.pi / 2) * (k + 1) / rings
        drum(6.2 * math.cos(a0), 6.2 * math.cos(a1) if k < rings - 1 else 1.1, z + 6.0 * math.sin(a0), z + 6.0 * math.sin(a1) if k < rings - 1 else z + 5.8, SLATE, slate,
             0.75 if k == 0 else 0.3, 0.3 if k == 0 else 0.15, cap=ZINC if k == rings - 1 else None)
    s.cylinder(c, 0.95, z + 5.8, z + 7.6, mul(K._to_linear(np.array(ZINC_RGB)).tolist(), 1.0), 6)
    s.cylinder(c, 0.95, z + 7.6, z + 9.0, GILT, 6, r1=0.45)
    return s


def tx_deco(lod):
    """An Art Deco mass: a plinth, giant piers of ashlar before bands of glazing, two setbacks with parapets, a stepped
    crown of stone with a pylon on each corner (A2: the Palais de Chaillot's order, as an apartment tower)."""
    s = TShell()
    rnd = random.Random(404)
    near = lod == 0
    tint = (0.95, 0.96, 0.98)
    hx, hy = 13.0, 9.0
    s.tbox((-hx - 0.4, -hy - 0.4, 0.0), (hx + 0.4, hy + 0.4, 4.2), LIME, mul(tint, 0.78), w0=0.9, w1=0.35, wt=0.3, foot=0.85)

    def mass(x, y, z0, z1, pitch, width, fin):
        """One tier: the glazing wall `fin` behind the piers' faces, the piers as fins, each its own tone, run with rain from its head."""
        corners = {"S": ((-x, -y), (x, -y)), "E": ((x, -y), (x, y)), "N": ((x, y), (-x, y)), "W": ((-x, y), (-x, -y))}
        for side in "SENW":
            p0, p1 = corners[side]
            length = math.hypot(p1[0] - p0[0], p1[1] - p0[1])
            t = ((p1[0] - p0[0]) / length, (p1[1] - p0[1]) / length)
            nrm = (t[1], -t[0])
            at = lambda u, d, zz: (p0[0] + t[0] * u - nrm[0] * d, p0[1] + t[1] * u - nrm[1] * d, zz)  # noqa: E731
            tw, th = TILE_M[GLAZING]
            off = rnd.random()
            s.tface([at(0, fin, z0), at(length, fin, z0), at(length, fin, z1), at(0, fin, z1)], GLAZING, (0.9, 0.9, 0.9),
                    uvs=[(off, z0 / th), (off + length / tw, z0 / th), (off + length / tw, z1 / th), (off, z1 / th)], ws=[0.1, 0.1, 0.6, 0.6])
            count = max(2, round((length - width) / pitch) + 1)
            gap = (length - width) / (count - 1)
            for i in range(count):
                xa, xb = i * gap, i * gap + width
                c = mul(tint, 0.95 + 0.1 * rnd.random())
                low = 0.8 if z0 < 5.0 else 0.94
                s.tface([at(xa, 0, z0), at(xb, 0, z0), at(xb, 0, z1), at(xa, 0, z1)], LIME, c, ws=[0.2, 0.2, 0.95, 0.95], tints=[mul(c, low)] * 2 + [c] * 2)
                if near or i in (0, count - 1):
                    if i > 0:
                        s.tface([at(xa, fin, z0), at(xa, 0, z0), at(xa, 0, z1), at(xa, fin, z1)], LIME, mul(c, 0.9), ws=[0.3, 0.3, 0.9, 0.9])
                    if i < count - 1:
                        s.tface([at(xb, 0, z0), at(xb, fin, z0), at(xb, fin, z1), at(xb, 0, z1)], LIME, mul(c, 0.9), ws=[0.3, 0.3, 0.9, 0.9])

    # (the piers are the wider part: a mass of stone with tall slots of glazing in it, not a grille)
    steps = [(hx, hy, 4.2, 25.0, 5.2, 3.3, 0.6), (hx - 2.8, hy - 1.8, 25.0, 34.0, 4.8, 3.0, 0.5), (hx - 6.0, hy - 3.6, 34.0, 40.5, 4.4, 2.7, 0.45)]
    for k, (x, y, z0, z1, pitch, width, fin) in enumerate(steps):
        mass(x, y, z0, z1 - 0.9, pitch, width, fin)
        # the parapet of the tier: a coping that takes the light, the terrace behind it of zinc
        s.tbox((-x - 0.35, -y - 0.35, z1 - 0.9), (x + 0.35, y + 0.35, z1 + 0.45), LIME, mul(tint, 1.1), top=ZINC, top_tint=(0.95, 0.95, 0.95), w0=0.7, w1=0.2, wt=0.45, bottom=True)
        if k < 2:
            for sx in (-1, 1):
                for sy in (-1, 1):  # a stone pylon on each corner of the terrace
                    px, py = sx * (x - 0.9), sy * (y - 0.9)
                    s.tbox((px - 0.75, py - 0.75, z1 + 0.45), (px + 0.75, py + 0.75, z1 + 2.5), LIME, mul(tint, 1.06), top=ZINC, w0=0.2, w1=0.8, wt=0.4)
    # the crown: three steps of stone, each narrower, the last a blunt lantern block under zinc (no point)
    z = 40.95
    for k, (x, y, h) in enumerate(((5.6, 4.0, 2.2), (4.0, 2.9, 1.8), (2.3, 1.7, 1.25))):
        s.tbox((-x, -y, z), (x, y, z + h), LIME, mul(tint, 1.0 - 0.05 * k), top=ZINC if k == 2 else LIME, top_tint=(0.95, 0.95, 0.95) if k == 2 else mul(tint, 0.9), w0=0.3, w1=0.9, wt=0.5)
        z += h
    return s


MAT = bpy.data.materials.new("M_citytex")  # (only for the checks of `finished`)
objects = []
for make in (tx_corner, tx_mid, tx_end, tx_deco):
    for lod in (0, 1):
        ob = finished(make(lod), f"{make.__name__}_lod{lod}", MAT, 1900 if lod == 0 else 760)
        # the units go into the file without a material: the exporter then writes the colour attribute as COLOR_0 with
        # its alpha (VEC4), which it leaves out for an opaque material; the game draws them with the city's material
        ob.data.materials.clear()
        ob.data.color_attributes.render_color_index = ob.data.color_attributes.find("Color")
        objects.append(ob)
objects.append(texture_set())
bpy.context.view_layer.update()
K.export(OUT, objects)
