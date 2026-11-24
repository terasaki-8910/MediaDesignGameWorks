"""How many different building units a view shows (FOLD / CITY's background).

Usage: python -I tools/units-count.py <dir with unit0/ unit1/ unit2/ captures> [--min 150] [shot ...]
  The three folders hold the same shots captured with &bgdebug=unit0, unit1 and unit2: every building is painted by three
  bits of its code, (number of its unit in src/game/foldcity/units.ts + 1) * 2 + (1 if it stands a half turn round), and
  everything else is black (the play area is white). A unit counts as visible in a shot when it covers at least --min
  pixels (150 by default: a patch of about 12 x 12 pixels at 1600 x 900), edges between buildings left out.
Prints per shot: the building pixels, the units visible, the variants visible (a unit and the same unit turned count
as two), the share of the largest one, and the families.
"""
import os
import re
import sys

import numpy as np
from PIL import Image

args = sys.argv[1:]
least = 150
if "--min" in args:
    i = args.index("--min")
    least = int(args[i + 1])
    del args[i:i + 2]
root = args[0]
only = args[1:]
here = os.path.dirname(os.path.abspath(__file__))
table = open(os.path.join(here, "..", "src", "game", "foldcity", "units.ts"), encoding="utf-8").read()
units = re.findall(r"name: '([^']+)', family: '([^']+)'", table)

names = sorted(f for f in os.listdir(os.path.join(root, "unit0")) if f[:2].isdigit() and f.endswith(".png"))
for name in names:
    if only and not any(o in name for o in only):
        continue
    code = None
    white = None
    for k in range(3):
        a = np.asarray(Image.open(os.path.join(root, f"unit{k}", name)).convert("RGB")).astype(np.int32)
        if code is None:
            code = np.zeros(a.shape[:2], np.int32)
            white = np.ones(a.shape[:2], bool)
        hi = a.max(axis=-1)
        # the play area is flat white in every capture; a building's bits are 0 or about 0.6
        white &= (a.min(axis=-1) > 200)
        bits = a > 90
        for c in range(3):
            code |= bits[..., c].astype(np.int32) << (3 * k + c)
    code[white] = 0
    # only pixels whose eight neighbours show the same code: an antialiased edge between two buildings mixes their bits
    same = np.ones(code.shape, bool)
    for dy in (-1, 0, 1):
        for dx in (-1, 0, 1):
            same &= np.roll(np.roll(code, dy, axis=0), dx, axis=1) == code
    code[~same] = 0
    values, counts = np.unique(code[code > 0], return_counts=True)
    total = int(counts.sum())
    seen = {}
    for v, n in zip(values.tolist(), counts.tolist()):
        idx = v // 2 - 1
        if 0 <= idx < len(units) and n >= least:
            seen[(units[idx][0], v % 2)] = n
    by_unit = {}
    for (u, _t), n in seen.items():
        by_unit[u] = by_unit.get(u, 0) + n
    fam = {}
    for u in by_unit:
        f = dict(units)[u]
        fam[f] = fam.get(f, 0) + 1
    top = max(by_unit.items(), key=lambda kv: kv[1]) if by_unit else ("-", 0)
    print(f"{name[:-4]:18} building px {total:7d}  units {len(by_unit):3d}  variants (with half turns) {len(seen):3d}  largest {top[0]} {100 * top[1] / max(total, 1):.1f}%  families {dict(sorted(fam.items()))}")
