/** A small deterministic generator (the same one the old backdrop uses): the same seed gives the same city. */
export function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** Pick an index by weights. */
export function pickWeighted(weights: readonly number[], r: number): number {
  let total = 0;
  for (const w of weights) total += w;
  let k = r * total;
  for (let i = 0; i < weights.length; i++) if ((k -= weights[i]) <= 0) return i;
  return weights.length - 1;
}
