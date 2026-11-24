"""Per-wall measures for FOLD / CITY's background, next to tone.py (same masks, same detail measure).

Usage: python -I walls.py <shots dir> <facing dir> [--json]
For each named wall region below, over the city pixels inside it (play area and sky excluded by the facing capture):
  detail ratio  median |L* - 7x7 mean| in the region / the same over the shot's whole play area
  sd            standard deviation of L* (a flat murky band has a low sd)
  black         share of the region's city pixels below L* 20
  split dE      distance in (a*, b*) between the two k-means (k=2) clusters of the region's colours, lightness ignored
                (stone against slate as colours, not light against shade)
  cool b*/C*    b* and chroma of the cooler cluster (blue-grey slate: b* below 0, C* about 3-7)
Checks:
  shade walls: 0.70 <= ratio <= 1.00 and sd >= 10
  sun walls:   0.55 <= ratio <= 1.10
  (upper limits raised from 0.95 on 2026-11-24 when the owner asked for stronger windows and weathering)
  all walls:   split dE >= 8, cool b* < 0 and cool C* <= 7 (blue-grey slate, not saturated blue)
"""
import json
import os
import sys

import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from tone import classes, local_contrast, srgb_to_lab  # noqa: E402

REGIONS = [
    ("s1 shade", "05-s1-play.png", (1150, 0, 1600, 650), "shade"),
    ("back shade", "10-player-back.png", (1140, 0, 1600, 330), "shade"),
    ("s3 shade", "07-s3-play.png", (1100, 420, 1600, 900), "shade"),
    ("s2 shade", "06-s2-play.png", (1180, 350, 1600, 900), "shade"),
    ("s1 sun", "05-s1-play.png", (0, 0, 460, 650), "sun"),
    ("back sun", "10-player-back.png", (0, 0, 470, 420), "sun"),
    ("s2 sun", "06-s2-play.png", (0, 0, 420, 900), "sun"),
]


def lab_full(rgb):
    c = rgb.astype(np.float64) / 255.0
    lin = np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)
    m = np.array([[0.4124564, 0.3575761, 0.1804375], [0.2126729, 0.7151522, 0.0721750], [0.0193339, 0.1191920, 0.9503041]])
    t = (lin @ m.T) / np.array([0.95047, 1.0, 1.08883])
    f = np.where(t > (6 / 29) ** 3, np.cbrt(t), t / (3 * (6 / 29) ** 2) + 4 / 29)
    return np.stack([116 * f[..., 1] - 16, 500 * (f[..., 0] - f[..., 1]), 200 * (f[..., 1] - f[..., 2])], axis=-1)


def two_means(x, iters=20):
    lo, hi = np.percentile(x[:, 2], [20, 80])
    c = np.array([x[np.argmin(np.abs(x[:, 2] - lo))], x[np.argmin(np.abs(x[:, 2] - hi))]])
    for _ in range(iters):
        d = ((x[:, None, :] - c[None, :, :]) ** 2).sum(-1)
        k = d.argmin(1)
        for j in (0, 1):
            if (k == j).any():
                c[j] = x[k == j].mean(0)
    return c


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    if len(args) != 2:
        print(__doc__)
        return 2
    shots, facing = args
    rows = []
    for name, shot, (x0, y0, x1, y1), kind in REGIONS:
        sp, fp = os.path.join(shots, shot), os.path.join(facing, shot)
        if not (os.path.exists(sp) and os.path.exists(fp)):
            continue
        img = np.asarray(Image.open(sp).convert("RGB"))
        fac = np.asarray(Image.open(fp).convert("RGB"))
        L, _ = srgb_to_lab(img)
        play, city, _sky = classes(fac)
        lc = local_contrast(L)
        play_lc = float(np.median(lc[play]))
        box = np.zeros_like(city)
        box[y0:y1, x0:x1] = True
        m = city & box
        if m.sum() < 500:
            continue
        ab = lab_full(img)[m][:, 1:]
        c = two_means(np.concatenate([np.zeros((len(ab), 1)), ab], axis=1))
        cool = c[np.argmin(c[:, 2])]
        r = {
            "region": name, "kind": kind,
            "ratio": float(np.median(lc[m])) / play_lc,
            "sd": float(L[m].std()),
            "black": float((L[m] < 20).mean()),
            "split_dE": float(np.linalg.norm(c[0] - c[1])),
            "cool_b": float(cool[2]),
            "cool_c": float(np.hypot(cool[1], cool[2])),
        }
        if kind == "shade":
            r["ok_detail"] = 0.70 <= r["ratio"] <= 1.00 and r["sd"] >= 10
        else:
            r["ok_detail"] = 0.55 <= r["ratio"] <= 1.10
        r["ok_split"] = r["split_dE"] >= 8 and r["cool_b"] < 0 and r["cool_c"] <= 7
        rows.append(r)
    if "--json" in sys.argv:
        print(json.dumps(rows, indent=1))
        return 0
    ok = lambda v: "pass" if v else "FAIL"
    print(f"{'region':12} ratio    sd  black  split dE  cool b*  cool C*  detail  split")
    for r in rows:
        print(f"{r['region']:12} {r['ratio']:5.2f} {r['sd']:5.1f} {100 * r['black']:5.1f}%  {r['split_dE']:7.1f}  {r['cool_b']:7.1f}  {r['cool_c']:7.1f}  {ok(r['ok_detail']):6} {ok(r['ok_split'])}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
