// The skyline at the far end of the open canyon (section 1's structure, and the title's). Where the canyon's walls have
// leaned back to nothing the sheet lies flat, 110 m below the walkways, and the haze takes its houses from about 600 m on:
// from the play cameras the far end was a stretch of empty horizon. Here stand the great masses of a city seen across
// that distance, upright on the flat sheet (from 700 m along the axis), in rows one behind the other: long roofs, stepped Art Deco blocks, and above
// them towers, domes and a cathedral (the far models of city.glb and cityprops.glb, several times their size, as a city's
// monuments are). Each row stands in more haze than the one before it (atmosphere.ts, bgSkyline), so the rows part by tone,
// and all of them lose their feet in the haze. Pure: no GLB, no DOM (the tests read it).
import { MODEL_INDEX, MODELS } from './models.ts';
import { PLAY } from './plan.ts';
import { rng } from './rng.ts';

export interface SkyMass {
  model: number;
  /** Where it stands on the sheet (a along the play axis, b across it), and its quarter turns about its own up. */
  a: number;
  b: number;
  turn: 0 | 1 | 2 | 3;
  /** Scale of the model, and a factor on its height on top of that. */
  scale: number;
  sy: number;
  /** 0 = the nearest row, 1 = the furthest: the haze it stands in. */
  layer: number;
}

/**
 * The rows: how far along the play axis each stands (metres of sheet), and how far to either side it reaches. The first
 * stands beyond 700 m, where the canyon's walls have finished leaning back and the whole sheet lies within 4 degrees of flat.
 */
export const SKYLINE_ROWS: readonly { a: number; half: number }[] = [
  { a: 735, half: 680 },
  { a: 850, half: 770 },
  { a: 975, half: 880 },
  { a: 1120, half: 1000 },
  // the last row is the palest: fewer, taller masses, mostly towers and domes, far enough to be outlines in the haze
  { a: 1300, half: 1130 },
];
/** Nothing of the skyline stands nearer to the play volume than this (it is scenery beyond the far end, never among the walkways). */
export const SKYLINE_CLEAR = 480;

/** What a row is made of: [model, weight, least scale, most scale]. The first group is the body of the row, the second what rises out of it. */
const BODY: readonly [string, number, number, number][] = [
  ['haussmann_tall', 3, 2.6, 3.3],
  ['haussmann_step', 2.5, 2.7, 3.4],
  ['haussmann_a', 2, 2.9, 3.6],
  ['deco_block', 3, 2.5, 3.3],
  ['deco_hall', 2, 2.5, 3.2],
  ['tower_house', 1.5, 2.4, 3.2],
];
const PEAKS: readonly [string, number, number, number][] = [
  ['deco_tower', 3, 2.3, 3.0],
  ['dome', 3, 2.8, 3.6],
  ['cathedral', 0.6, 2.3, 2.9],
  ['belfry', 0.8, 2.6, 3.3],
  ['tower_house', 1, 3.0, 3.8],
];

/**
 * The masses of the skyline, the same for the same seed. Along each row a mass stands every 70 to 150 m (its own width
 * and a gap); about one in four is a peak, never two peaks side by side, and the rows' peaks do not line up.
 */
export function skyline(seed: number): SkyMass[] {
  const r = rng(seed * 211 + 37);
  const out: SkyMass[] = [];
  const pick = (pool: readonly [string, number, number, number][]) => {
    let total = 0;
    for (const p of pool) total += p[1];
    let k = r() * total;
    for (const p of pool) if ((k -= p[1]) <= 0) return p;
    return pool[pool.length - 1];
  };
  SKYLINE_ROWS.forEach((row, ri) => {
    const layer = ri / (SKYLINE_ROWS.length - 1);
    const last = ri === SKYLINE_ROWS.length - 1;
    let b = -row.half + r() * 40;
    let lastPeak = true; // (a row begins with a body)
    let sincePeak = Math.floor(r() * 3);
    while (b < row.half) {
      const peak: boolean = !lastPeak && (sincePeak >= (last ? 1 : 3) || r() < (last ? 0.5 : 0.22));
      const [name, , s0, s1] = pick(peak ? PEAKS : BODY);
      const model = MODEL_INDEX.get(name)!;
      const m = MODELS[model];
      const scale = (s0 + (s1 - s0) * r()) * (last ? 1.5 : 1.1);
      // a long building lies across the view (its long side to the play area) more often than end on
      const turn = (r() < 0.75 ? 0 : 1) + (r() < 0.5 ? 0 : 2);
      const width = (turn % 2 === 0 ? m.w : m.d) * scale;
      const a = row.a + (r() - 0.5) * 70;
      out.push({ model, a, b: b + width / 2, turn: turn as 0 | 1 | 2 | 3, scale, sy: peak ? 0.95 + r() * 0.25 : 0.9 + r() * 0.45, layer });
      b += width + (peak ? 6 + r() * 24 : -14 + r() * 40) + (last ? 30 + r() * 60 : 0);
      lastPeak = peak;
      sincePeak = peak ? 0 : sincePeak + 1;
    }
  });
  return out.filter((m) => m.a - PLAY.max.x >= SKYLINE_CLEAR);
}
