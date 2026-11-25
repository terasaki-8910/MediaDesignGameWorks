// Where the play area's piers come down onto the city: the plan keeps those squares free and stands a foot there.
import type { KeepOut } from './morphplan.ts';
import { Z0 } from './sheet.ts';

/** How large the masonry foot of each kind of pier is (pier_foot of cityprops.glb is made for the 2.8 m pier). */
const FOOT_SCALE: Record<string, number> = { pier_a: 1, pier_b: 1.7, pier_pivot: 1.15 };

/** The squares of sheet under the play area's piers: sheet (a, b) is world (x, z) there in every structure. */
export function pierKeepOut(piers: readonly { piece: string; x: number; z: number }[]): KeepOut[] {
  return piers.map((p) => {
    const foot = FOOT_SCALE[p.piece] ?? 1;
    return { a: p.x, b: p.z - Z0, r: 8.4 * foot + 3, foot };
  });
}
