// Which structure of the folded city each puzzle section shows, and the review parameter that holds a fold part-way.
import type { StructureName } from './sheet.ts';

/** The structure each puzzle section shows, in section order; later sections keep the last one. */
export const SECTION_STRUCTURE: readonly StructureName[] = ['horizon', 'fold90', 'ring'];
/** A transition held at a fraction, for review: `?morph=s1-s2:0.5`. */
export interface Freeze { from: number; to: number; f: number }

/** Parse `s1-s2:0.5` (sections count from 1). Null when it is not that. */
export function parseFreeze(text: string | null): Freeze | null {
  const m = /^s(\d)-s(\d):([0-9.]+)$/.exec(text ?? '');
  if (!m) return null;
  const from = Number(m[1]) - 1;
  const to = Number(m[2]) - 1;
  const f = Number(m[3]);
  const ok = (i: number) => i >= 0 && i < SECTION_STRUCTURE.length;
  if (!ok(from) || !ok(to) || Math.abs(from - to) !== 1 || !(f >= 0 && f <= 1)) return null;
  return { from, to, f };
}
