"""Tone structure of FOLD / CITY shots against the art brief's 明暗の構造 (brightest: sunlit walkway and gilt;
middle: walls, balustrades and sky; darkest: undersides, deep recesses and the background city).

Usage: python -I tone.py <shots dir> <facing dir> [--json]
  <shots dir>  the normal captures (01-title.png ... 10-player-back.png)
  <facing dir> the same shots captured with &bgdebug=facing, where the play area is flat white and the sky black
Per shot it prints, in CIE L* (D65, sRGB):
  play p50 / p90       the play area's median and bright tier
  city p50 / p95 / C*  the background city (not play, not sky): median, bright tail, median chroma
  frame p5             the darkest 5 % of the whole frame
  sky p50              the visible sky's median
and checks, per the brief:
  T1 city p50 <= play p50 - 8      (the city sits below the middle tier)
  T2 city p95 <  play p90          (nothing in the city is as bright as the play area's bright tier)
  T3 frame p5 <= 28                (the frame has real darks)
  T4 city C* p50 < play C* p90     (the city is less saturated than the play area's colour)
  T5 city detail <= 1.10 x play detail   (the city is not much busier than the play area; detail = median |L* - 7x7 mean|;
                                          raised from 0.95 on 2026-11-24 when the owner asked for stronger windows and weathering)
  T6 pixels below L* 20 <= 2 % of the frame   (no crushed blacks)
  T7 city detail >= 0.55 x play detail   (the city is not flat boxes)
"""
import json
import os
import sys

import numpy as np
from PIL import Image


def srgb_to_lab(rgb):
    c = rgb.astype(np.float64) / 255.0
    lin = np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)
    m = np.array([[0.4124564, 0.3575761, 0.1804375], [0.2126729, 0.7151522, 0.0721750], [0.0193339, 0.1191920, 0.9503041]])
    xyz = lin @ m.T
    white = np.array([0.95047, 1.0, 1.08883])
    t = xyz / white
    f = np.where(t > (6 / 29) ** 3, np.cbrt(t), t / (3 * (6 / 29) ** 2) + 4 / 29)
    L = 116 * f[..., 1] - 16
    a = 500 * (f[..., 0] - f[..., 1])
    b = 200 * (f[..., 1] - f[..., 2])
    return L, np.hypot(a, b)


def classes(facing):
    f = facing.astype(np.int32)
    mx = f.max(axis=-1)
    sky = mx < 40
    ratio = f / np.maximum(mx, 1)[..., None]
    play = (~sky) & (ratio > 0.6).all(axis=-1)
    city = ~(sky | play)
    return play, city, sky


def pct(values, q):
    return float(np.percentile(values, q)) if values.size else float("nan")


def box_blur(x, r):
    k = 2 * r + 1
    p = np.pad(x, r, mode="edge")
    s = np.pad(p.cumsum(0).cumsum(1), ((1, 0), (1, 0)))
    return (s[k:, k:] - s[:-k, k:] - s[k:, :-k] + s[:-k, :-k]) / (k * k)


def local_contrast(L):
    """Fine detail: |L* - its 7x7 mean| per pixel (what reads as busy dots and edges)."""
    return np.abs(L - box_blur(L, 3))


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    as_json = "--json" in sys.argv
    if len(args) != 2:
        print(__doc__)
        return 2
    shots, facing_dir = args
    rows = []
    for name in sorted(f for f in os.listdir(shots) if f[:2].isdigit() and f.endswith(".png")):
        fpath = os.path.join(facing_dir, name)
        if not os.path.exists(fpath):
            continue
        img = np.asarray(Image.open(os.path.join(shots, name)).convert("RGB"))
        fac = np.asarray(Image.open(fpath).convert("RGB"))
        if img.shape != fac.shape:
            print(f"{name}: size differs from its facing capture", file=sys.stderr)
            continue
        L, C = srgb_to_lab(img)
        play, city, sky = classes(fac)
        lc = local_contrast(L)
        r = {
            "city_lc": pct(lc[city], 50), "play_lc": pct(lc[play], 50),
            "near_black": float((L < 20).mean()),
            "shot": name[:-4],
            "play_p50": pct(L[play], 50), "play_p90": pct(L[play], 90), "play_c90": pct(C[play], 90),
            "city_p50": pct(L[city], 50), "city_p95": pct(L[city], 95), "city_c50": pct(C[city], 50),
            "frame_p5": pct(L, 5), "sky_p50": pct(L[sky], 50),
            "city_share": float(city.mean()),
        }
        r["T1"] = r["city_p50"] <= r["play_p50"] - 8
        r["T2"] = r["city_p95"] < r["play_p90"]
        r["T3"] = r["frame_p5"] <= 28
        r["T4"] = r["city_c50"] < r["play_c90"]
        r["T5"] = r["city_lc"] <= 1.10 * r["play_lc"]
        r["T6"] = r["near_black"] <= 0.02
        r["T7"] = r["city_lc"] >= 0.55 * r["play_lc"]
        rows.append(r)
    if as_json:
        print(json.dumps(rows, indent=1))
        return 0
    ok = lambda v: "pass" if v else "FAIL"
    print(f"{'shot':18} play p50/p90   city p50/p95  city C*  frame p5  sky p50  detail city/play  black   T1   T2   T3   T4   T5   T6   T7")
    for r in rows:
        print(f"{r['shot']:18} {r['play_p50']:5.1f}/{r['play_p90']:5.1f}   {r['city_p50']:5.1f}/{r['city_p95']:5.1f}  {r['city_c50']:6.1f}  {r['frame_p5']:7.1f}  {r['sky_p50']:7.1f}   {r['city_lc']:5.2f}/{r['play_lc']:5.2f}  {100 * r['near_black']:5.1f}%  {ok(r['T1']):4} {ok(r['T2']):4} {ok(r['T3']):4} {ok(r['T4']):4} {ok(r['T5']):4} {ok(r['T6']):4} {ok(r['T7']):4}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
