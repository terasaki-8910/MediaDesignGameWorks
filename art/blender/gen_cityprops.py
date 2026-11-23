"""What stands in the background city besides its ten buildings: public/assets/cityprops.glb.

    node <game3d>/scripts/blender.mjs art/blender/gen_cityprops.py -- --out public/assets/cityprops.glb

The streets' trees, the plazas' centrepieces, one more landmark and the feet of the play area's piers, built face by
face like the buildings (city_kit.py) so the game draws them in the buildings' batch with the buildings' material; this
file carries no texture of its own (its UVs point into the buildings' atlas).
  tree_a          a plane tree: a pale trunk that forks, five rounded masses of canopy running into each other
  tree_b          a broad plane tree: a leaning trunk, six masses of canopy to one side
  tree_c          a young plane tree: four masses of canopy
                  (the masses are shaded smoothly: a normal per corner, dark underneath, lighter towards the top)
  fountain        an octagonal basin with a tiered centre: the middle of a plaza
  monument        a column on a stepped plinth with a gilt figure: the middle of a plaza
  pier_foot       a stepped mass of masonry with four buttresses: where a pier of the play area meets the city's ground
  cathedral_lod0  a Gothic church: nave and transept under steep slate roofs, two west towers with spires, a fleche,
  cathedral_lod1  buttresses along the nave (near model only)
Origin: ground centre of the footprint, +X the long side. The trees and the plazas' pieces are modelled from BURIED below
the ground up, so a piece on bent ground still stands in it. The game stands each tree on its own, turned, scaled and
moved a little, along the boulevards and in the parks.
"""
import math
import os
import sys

import bpy

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import fc_kit as K  # noqa: E402
from city_kit import *  # noqa: E402,F401,F403

opts = K.script_args()
OUT = opts.get("out", "public/assets/cityprops.glb")
K.reset()

BURIED = 1.5


def plane_tree(trunk, crowns, lean=(0.0, 0.0)):
    """A plane tree: `trunk` = (height of the clear stem, radius); `crowns` = (x, y, z, radius, height, colour) of each mass
    of the canopy, z from the ground. The stem leans towards `lean` and forks into two limbs under the canopy."""
    s = Shell()
    stem, r = trunk
    z = BURIED
    top = (lean[0], lean[1])
    s.cylinder((0.0, 0.0), r, 0.0, z + stem, BARK, 5, r1=r * 0.72, c1=top, alt=K.srgb("#7A7364"))
    for k, (x, y, cz, cr, ch, colour) in enumerate(crowns):
        if k < 2:  # a limb from the fork up into this mass
            s.cylinder(top, r * 0.6, z + stem, z + cz + ch * 0.3, BARK, 4, r1=r * 0.3, c1=(x, y))
        s.crown((x, y), cr, z + cz, ch, colour, LEAF_B, 7, lean=(x * 0.12, y * 0.12), turn=0.9 * k, lump=0.07 if k % 2 else 0.04)
    return s


# The canopies are several small masses that run into each other (a cloud of leaves, never one ball on a stick), a little
# darker and greyer than a lawn: seen from the play area a tree is a soft dark mass with a lit side.
LEAF_D = K.srgb("#5C6E4A")
LEAF_E = K.srgb("#66754F")
LEAF_F = K.srgb("#55664A")


def tree_a():
    return plane_tree((5.0, 0.36), [(-1.5, 0.3, 5.4, 2.5, 3.6, LEAF_D), (1.6, -0.6, 5.9, 2.4, 3.4, LEAF_E), (0.2, 1.7, 6.6, 2.3, 3.4, LEAF_F),
                                    (-0.5, -1.5, 7.2, 2.2, 3.2, LEAF_E), (0.1, 0.0, 8.6, 2.4, 3.6, LEAF_D)], lean=(0.3, 0.1))


def tree_b():
    return plane_tree((4.2, 0.4), [(-2.3, -0.5, 4.6, 2.5, 3.2, LEAF_E), (1.2, 1.2, 5.0, 2.7, 3.4, LEAF_D), (3.0, -1.0, 5.6, 2.2, 3.0, LEAF_F),
                                   (-0.6, 2.1, 6.0, 2.2, 3.0, LEAF_E), (0.6, -0.4, 7.0, 2.5, 3.4, LEAF_D), (-1.6, 0.6, 7.4, 1.9, 2.8, LEAF_F)], lean=(0.6, 0.2))


def tree_c():
    return plane_tree((3.6, 0.26), [(-0.8, 0.3, 4.0, 2.0, 3.0, LEAF_D), (1.0, -0.5, 4.5, 1.9, 2.8, LEAF_F), (0.1, 0.5, 5.6, 1.8, 2.8, LEAF_E),
                                    (-0.2, -0.9, 5.0, 1.6, 2.4, LEAF_E)], lean=(-0.2, 0.2))


def fountain():
    s = Shell()
    z = BURIED
    s.cylinder((0, 0), 9.6, 0.0, z + 0.25, TRIM, 8, top=TRIM)  # the step round the basin
    s.cylinder((0, 0), 8.0, z + 0.25, z + 1.15, TRIM, 8)
    s.cylinder((0, 0), 7.3, z + 1.15, z + 1.16, WATER, 8, r1=7.2)
    s.cylinder((0, 0), 1.7, z + 0.9, z + 3.4, TRIM, 8, r1=1.1)
    s.cylinder((0, 0), 1.1, z + 3.4, z + 4.1, TRIM, 8, r1=3.3, top=WATER)
    s.cylinder((0, 0), 0.6, z + 4.1, z + 6.2, TRIM, 6, r1=0.4)
    s.cylinder((0, 0), 0.4, z + 6.2, z + 6.7, TRIM, 6, r1=1.5, top=WATER)
    s.cylinder((0, 0), 0.35, z + 6.7, z + 8.3, GILT, 6, r1=0.0)
    return s


def monument():
    s = Shell()
    z = BURIED
    s.box((-7.5, -7.5, 0.0), (7.5, 7.5, z + 0.5), DECO_B, top=TRIM, strip="ashlar")
    s.box((-6.0, -6.0, z + 0.5), (6.0, 6.0, z + 1.0), DECO_B, top=TRIM, strip="ashlar")
    s.box((-3.6, -3.6, z + 1.0), (3.6, 3.6, z + 6.0), DECO, foot=0.75, strip="ashlar")
    s.box((-4.0, -4.0, z + 6.0), (4.0, 4.0, z + 6.8), TRIM, bottom=True)
    s.cylinder((0, 0), 1.7, z + 6.8, z + 26.0, TRIM, 10, r1=1.45, alt=K.srgb("#A9A090"))
    s.box((-2.3, -2.3, z + 26.0), (2.3, 2.3, z + 27.2), TRIM, bottom=True)
    s.cylinder((0, 0), 1.0, z + 27.2, z + 28.4, GILT, 6, r1=0.7)
    s.cylinder((0, 0), 0.9, z + 28.4, z + 32.5, GILT, 6, r1=0.0)
    return s


def pier_foot():
    """For a pier 2.8 m square (the game scales it for the thicker ones): the shaft comes down into the top of this."""
    s = Shell()
    stone = K.srgb("#A39A8B")
    stone_b = K.srgb("#99907F")
    base = K.srgb("#857D71")
    s.box((-6.2, -6.2, 0.0), (6.2, 6.2, 5.0), base, top=TRIM, foot=0.6)
    s.frustum(5.4, 5.4, 5.0, 3.9, 3.9, 8.5, stone, TRIM)
    s.box((-3.9, -3.9, 8.5), (3.9, 3.9, 13.0), stone)
    s.box((-4.3, -4.3, 13.0), (4.3, 4.3, 13.8), TRIM, bottom=True)
    s.frustum(3.9, 3.9, 13.8, 2.3, 2.3, 17.5, stone_b, TRIM)
    for side, (nx, ny) in (("E", (1, 0)), ("W", (-1, 0)), ("N", (0, 1)), ("S", (0, -1))):
        # a buttress on each side: a fin that steps in twice
        for d0, d1, z1 in ((6.2, 8.4, 4.0), (5.2, 7.2, 8.0), (3.9, 5.6, 12.0)):
            lo = (min(nx * d0, nx * d1) - (0.0 if nx else 1.1), min(ny * d0, ny * d1) - (0.0 if ny else 1.1), 0.0)
            hi = (max(nx * d0, nx * d1) + (0.0 if nx else 1.1), max(ny * d0, ny * d1) + (0.0 if ny else 1.1), z1)
            s.box(lo, hi, base if z1 < 5 else stone_b, top=TRIM)
    return s


def lancets(s, lod, x0, x1, hw, z0, z1):
    """Tall windows along both sides of the nave between x0 and x1."""
    step = 5.2 if lod == 0 else 10.0
    n = max(1, int((x1 - x0) / step))
    for i in range(n):
        x = x0 + (x1 - x0) * (i + 0.5) / n
        w = 0.75 if lod == 0 else 1.5
        d = 0.12 if lod == 0 else 0.3
        s.face([(x - w, -hw - d, z0), (x + w, -hw - d, z0), (x + w, -hw - d, z1), (x - w, -hw - d, z1)], GLASS)
        s.face([(x + w, hw + d, z0), (x - w, hw + d, z0), (x - w, hw + d, z1), (x + w, hw + d, z1)], GLASS)


def cathedral(lod):
    s = Shell()
    nave_x0, nave_x1, hw, wall = -14.0, 27.0, 7.5, 22.0
    s.box((nave_x0, -hw, 0.0), (nave_x1, hw, wall), WALL, foot=0.72, strip="ashlar")
    s.box((nave_x0, -hw - 0.5, wall - 0.6), (nave_x1, hw + 0.5, wall), TRIM, bottom=True)
    s.hip((nave_x1 - nave_x0) / 2 + 0.4, hw + 0.4, wall, wall + 11.0, SLATE, c=((nave_x0 + nave_x1) / 2, 0.0), strip="slate")
    # the transept, and the apse beyond the choir
    s.box((6.0, -15.0, 0.0), (17.0, 15.0, wall), WALL, foot=0.72, strip="ashlar")
    s.hip(5.9, 15.4, wall, wall + 10.0, SLATE, c=(11.5, 0.0), strip="slate")
    s.cylinder((27.0, 0.0), hw, 0.0, wall - 3.0, WALL_B, 10 if lod == 0 else 6, strip="ashlar")
    s.cylinder((27.0, 0.0), hw + 0.3, wall - 3.0, wall + 5.0, LEAD, 10 if lod == 0 else 6, r1=0.0)
    # the fleche over the crossing
    s.cylinder((11.5, 0.0), 1.5, wall + 9.0, wall + 14.0, LEAD, 6)
    s.cylinder((11.5, 0.0), 1.7, wall + 14.0, wall + 31.0, LEAD, 6, r1=0.0)
    # the west front: two towers with spires, the gable between them
    for sy in (-1, 1):
        s.o = (-19.0, sy * 9.0)
        s.box((-5.0, -5.0, 0.0), (5.0, 5.0, 40.0), WALL, foot=0.72, strip="ashlar")
        s.box((-5.4, -5.4, 26.0), (5.4, 5.4, 26.8), TRIM, bottom=True)
        s.box((-5.5, -5.5, 40.0), (5.5, 5.5, 41.0), TRIM, bottom=True)
        s.frustum(4.6, 4.6, 41.0, 0.0, 0.0, 62.0, SLATE, strip="slate")
        for side in "SNEW":
            s.panel(side, 5.0, 5.0, -1.3, 1.3, 29.0, 38.0, GLASS, 0.1 if lod == 0 else 0.3)
            if lod == 0:
                s.panel(side, 5.0, 5.0, -1.0, 1.0, 12.0, 22.0, GLASS, 0.1)
        s.o = (0.0, 0.0)
    s.box((-22.0, -4.0, 0.0), (-14.0, 4.0, 27.0), WALL_B, strip="ashlar")
    s.face([(-22.1, -4.0, 27.0), (-22.1, 4.0, 27.0), (-22.1, 0.0, 34.0)][::-1], TRIM)
    s.panel("W", 22.1, 4.0, -2.6, 2.6, 13.0, 23.0, GLASS, 0.1)  # the rose window's place
    s.panel("W", 22.1, 4.0, -1.8, 1.8, 0.4, 8.0, RAIL, 0.1)  # the portal
    lancets(s, lod, nave_x0 + 1.0, 5.0, hw, 6.0, 18.5)
    lancets(s, lod, 18.0, nave_x1 - 1.0, hw, 6.0, 18.5)
    if lod == 0:
        for i in range(4):  # buttresses along the nave, each with its pinnacle
            x = -11.0 + 5.2 * i
            if 5.0 < x < 18.0:
                continue
            for sy in (-1, 1):
                y0, y1 = sorted((sy * hw, sy * (hw + 3.2)))
                s.box((x - 0.6, y0, 0.0), (x + 0.6, y1, 15.0), TRIM, top=TRIM)
                s.frustum(0.6, 0.6, 15.0, 0.0, 0.0, 19.0, TRIM, c=(x, sy * (hw + 2.4)))
    return s


CITY = city_material(textured=False)
objects = [
    finished(tree_a(), "tree_a", CITY, 260),
    finished(tree_b(), "tree_b", CITY, 300),
    finished(tree_c(), "tree_c", CITY, 210),
    finished(fountain(), "fountain", CITY, 260),
    finished(monument(), "monument", CITY, 260),
    finished(pier_foot(), "pier_foot", CITY, 260),
    finished(cathedral(0), "cathedral_lod0", CITY, 1000),
    finished(cathedral(1), "cathedral_lod1", CITY, 600),
]
bpy.context.view_layer.update()
K.export(OUT, objects)
