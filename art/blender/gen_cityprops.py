"""What stands in the background city besides its ten buildings: public/assets/cityprops.glb.

    node <game3d>/scripts/blender.mjs art/blender/gen_cityprops.py -- --out public/assets/cityprops.glb

The streets' furniture, the plazas' centrepieces, one more landmark and the feet of the play area's piers, built face by
face like the buildings (city_kit.py) so the game draws them in the buildings' batch with the buildings' material; this
file carries no texture of its own.
  tree_row        five plane trees in a row with two street lamps between them: one side of an avenue along a block
  grove           eight trees close together: a park
  fountain        an octagonal basin with a tiered centre: the middle of a plaza
  monument        a column on a stepped plinth with a gilt figure: the middle of a plaza
  pier_foot       a stepped mass of masonry with four buttresses: where a pier of the play area meets the city's ground
  cathedral_lod0  a Gothic church: nave and transept under steep slate roofs, two west towers with spires, a fleche,
  cathedral_lod1  buttresses along the nave (near model only)
Origin: ground centre of the footprint, +X the long side. The street furniture is modelled from BURIED below the ground
up, so a piece on bent ground still stands in it.
"""
import math
import os
import random
import sys

import bpy

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import fc_kit as K  # noqa: E402
from city_kit import *  # noqa: E402,F401,F403

opts = K.script_args()
OUT = opts.get("out", "public/assets/cityprops.glb")
K.reset()

BURIED = 1.5
LAMP = K.srgb("#C8B27C")


def tree(s, rnd, x, y, z0=BURIED):
    h = 8.5 + 3.0 * rnd.random()
    r = 3.0 + 0.9 * rnd.random()
    s.box((x - 0.28, y - 0.28, 0.0), (x + 0.28, y + 0.28, z0 + h * 0.42), BARK)
    s.blob((x, y), r, z0 + h * 0.3, h * 0.7, LEAF, LEAF_B)


def lamp(s, x, y, z0=BURIED):
    s.box((x - 0.16, y - 0.16, 0.0), (x + 0.16, y + 0.16, z0 + 7.6), RAIL)
    s.box((x - 0.45, y - 0.45, z0 + 7.6), (x + 0.45, y + 0.45, z0 + 8.5), LAMP, top=RAIL)


def tree_row():
    s = Shell()
    rnd = random.Random(11)
    for i in range(5):
        tree(s, rnd, -22.0 + 11.0 * i + (rnd.random() - 0.5) * 1.6, (rnd.random() - 0.5) * 0.8)
    for x in (-16.5, 16.5):
        lamp(s, x, -2.4)
    return s


def grove():
    s = Shell()
    rnd = random.Random(23)
    for x, y in ((-11, -6), (-3, -7.5), (6, -5.5), (12.5, -1), (-12, 3), (-4.5, 1.5), (4, 5.5), (-9, 8.5)):
        tree(s, rnd, x + (rnd.random() - 0.5) * 2.0, y + (rnd.random() - 0.5) * 2.0)
    return s


def fountain():
    s = Shell()
    z = BURIED
    s.cylinder((0, 0), 9.6, 0.0, z + 0.25, DECO_B, 8, top=TRIM)  # the step round the basin
    s.cylinder((0, 0), 8.0, z + 0.25, z + 1.15, TRIM, 8)
    s.cylinder((0, 0), 7.3, z + 1.15, z + 1.16, WATER, 8, r1=7.2)
    s.cylinder((0, 0), 1.7, z + 0.9, z + 3.4, DECO, 8, r1=1.1)
    s.cylinder((0, 0), 1.1, z + 3.4, z + 4.1, TRIM, 8, r1=3.3, top=WATER)
    s.cylinder((0, 0), 0.6, z + 4.1, z + 6.2, DECO, 6, r1=0.4)
    s.cylinder((0, 0), 0.4, z + 6.2, z + 6.7, TRIM, 6, r1=1.5, top=WATER)
    s.cylinder((0, 0), 0.35, z + 6.7, z + 8.3, GILT, 6, r1=0.0)
    return s


def monument():
    s = Shell()
    z = BURIED
    s.box((-7.5, -7.5, 0.0), (7.5, 7.5, z + 0.5), DECO_B, top=TRIM)
    s.box((-6.0, -6.0, z + 0.5), (6.0, 6.0, z + 1.0), DECO_B, top=TRIM)
    s.box((-3.6, -3.6, z + 1.0), (3.6, 3.6, z + 6.0), DECO, foot=0.75)
    s.box((-4.0, -4.0, z + 6.0), (4.0, 4.0, z + 6.8), TRIM, bottom=True)
    s.cylinder((0, 0), 1.7, z + 6.8, z + 26.0, WALL, 10, r1=1.45, alt=WALL_B)
    s.box((-2.3, -2.3, z + 26.0), (2.3, 2.3, z + 27.2), TRIM, bottom=True)
    s.cylinder((0, 0), 1.0, z + 27.2, z + 28.4, GILT, 6, r1=0.7)
    s.cylinder((0, 0), 0.9, z + 28.4, z + 32.5, GILT, 6, r1=0.0)
    return s


def pier_foot():
    """For a pier 2.8 m square (the game scales it for the thicker ones): the shaft comes down into the top of this."""
    s = Shell()
    s.box((-6.2, -6.2, 0.0), (6.2, 6.2, 5.0), BASE, top=TRIM, foot=0.6)
    s.frustum(5.4, 5.4, 5.0, 3.9, 3.9, 8.5, WALL, TRIM)
    s.box((-3.9, -3.9, 8.5), (3.9, 3.9, 13.0), WALL)
    s.box((-4.3, -4.3, 13.0), (4.3, 4.3, 13.8), TRIM, bottom=True)
    s.frustum(3.9, 3.9, 13.8, 2.3, 2.3, 17.5, WALL_B, TRIM)
    for side, (nx, ny) in (("E", (1, 0)), ("W", (-1, 0)), ("N", (0, 1)), ("S", (0, -1))):
        # a buttress on each side: a fin that steps in twice
        for d0, d1, z1 in ((6.2, 8.4, 4.0), (5.2, 7.2, 8.0), (3.9, 5.6, 12.0)):
            lo = (min(nx * d0, nx * d1) - (0.0 if nx else 1.1), min(ny * d0, ny * d1) - (0.0 if ny else 1.1), 0.0)
            hi = (max(nx * d0, nx * d1) + (0.0 if nx else 1.1), max(ny * d0, ny * d1) + (0.0 if ny else 1.1), z1)
            s.box(lo, hi, BASE if z1 < 5 else WALL_B, top=TRIM)
    return s


def cathedral(lod):
    s = Shell()
    nave_x0, nave_x1, hw, wall = -14.0, 27.0, 7.5, 22.0
    s.box((nave_x0, -hw, 0.0), (nave_x1, hw, wall), WALL, foot=0.72)
    s.box((nave_x0, -hw - 0.5, wall - 0.6), (nave_x1, hw + 0.5, wall), TRIM, bottom=True)
    s.hip((nave_x1 - nave_x0) / 2 + 0.4, hw + 0.4, wall, wall + 11.0, SLATE, c=((nave_x0 + nave_x1) / 2, 0.0))
    # the transept, and the apse beyond the choir
    s.box((6.0, -15.0, 0.0), (17.0, 15.0, wall), WALL, foot=0.72)
    s.hip(5.9, 15.4, wall, wall + 10.0, SLATE, c=(11.5, 0.0))
    s.cylinder((27.0, 0.0), hw, 0.0, wall - 3.0, WALL_B, 10 if lod == 0 else 6)
    s.cylinder((27.0, 0.0), hw + 0.3, wall - 3.0, wall + 5.0, LEAD, 10 if lod == 0 else 6, r1=0.0)
    # the fleche over the crossing
    s.cylinder((11.5, 0.0), 1.5, wall + 9.0, wall + 14.0, LEAD, 6)
    s.cylinder((11.5, 0.0), 1.7, wall + 14.0, wall + 31.0, LEAD, 6, r1=0.0)
    # the west front: two towers with spires, the gable between them
    for sy in (-1, 1):
        s.o = (-19.0, sy * 9.0)
        s.box((-5.0, -5.0, 0.0), (5.0, 5.0, 40.0), WALL, foot=0.72)
        s.box((-5.4, -5.4, 26.0), (5.4, 5.4, 26.8), TRIM, bottom=True)
        s.box((-5.5, -5.5, 40.0), (5.5, 5.5, 41.0), TRIM, bottom=True)
        s.frustum(4.6, 4.6, 41.0, 0.0, 0.0, 62.0, SLATE)
        for side in "SNEW":
            s.panel(side, 5.0, 5.0, -1.3, 1.3, 29.0, 38.0, GLASS, 0.1 if lod == 0 else 0.3)
            if lod == 0:
                s.panel(side, 5.0, 5.0, -1.0, 1.0, 12.0, 22.0, GLASS, 0.1)
        s.o = (0.0, 0.0)
    s.box((-22.0, -4.0, 0.0), (-14.0, 4.0, 27.0), WALL_B)
    s.face([(-22.1, -4.0, 27.0), (-22.1, 4.0, 27.0), (-22.1, 0.0, 34.0)][::-1], WALL)
    s.panel("W", 22.1, 4.0, -2.6, 2.6, 13.0, 23.0, GLASS, 0.1)  # the rose window's place
    s.panel("W", 22.1, 4.0, -1.8, 1.8, 0.4, 8.0, RAIL, 0.1)  # the portal
    slots(s, 0.0, hw, 6.0, 18.5, 5.2 if lod == 0 else 10.0, 1.5 if lod == 0 else 3.0, sides="S", proud=0.12 if lod == 0 else 0.3, margin=-13.5)
    slots(s, 0.0, hw, 6.0, 18.5, 5.2 if lod == 0 else 10.0, 1.5 if lod == 0 else 3.0, sides="N", proud=0.12 if lod == 0 else 0.3, margin=-13.5)
    if lod == 0:
        for i in range(4):  # buttresses along the nave, each with its pinnacle
            x = -11.0 + 5.2 * i
            if 5.0 < x < 18.0:
                continue
            for sy in (-1, 1):
                y0, y1 = sorted((sy * hw, sy * (hw + 3.2)))
                s.box((x - 0.6, y0, 0.0), (x + 0.6, y1, 15.0), WALL_B, top=TRIM)
                s.frustum(0.6, 0.6, 15.0, 0.0, 0.0, 19.0, TRIM, c=(x, sy * (hw + 2.4)))
    return s


CITY = city_material(textured=False)
objects = [
    finished(tree_row(), "tree_row", CITY, 300),
    finished(grove(), "grove", CITY, 400),
    finished(fountain(), "fountain", CITY, 260),
    finished(monument(), "monument", CITY, 200),
    finished(pier_foot(), "pier_foot", CITY, 260),
    finished(cathedral(0), "cathedral_lod0", CITY, 900),
    finished(cathedral(1), "cathedral_lod1", CITY, 420),
]
bpy.context.view_layer.update()
K.export(OUT, objects)
