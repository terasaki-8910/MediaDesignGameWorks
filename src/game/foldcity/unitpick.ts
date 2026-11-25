// Which textured unit of buildings.glb stands in each lot's box, structure by structure. Pure: no GLB, no DOM (the tests
// read it). A lot of the plan is a model's box, its length stretched and its height scaled, and the height differs from
// structure to structure; the unit is the one of the lot's family whose own proportions fit the box best (models.ts,
// pickUnit), so the windows and storeys of a house keep their proportions. A lot keeps its unit from structure to
// structure while it fits, never shows the unit of the lot before it in its block when another fits as well, and where
// it must (one unit fits), it stands a half turn round: the same houses never stand twice in a row the same way.
import { MODELS, pickUnit, unitFamily, type UnitInfo } from './models.ts';
import type { MorphBuilding } from './morphplan.ts';
import { rng } from './rng.ts';
import { STRUCTURES } from './sheet.ts';
import { UNITS } from './units.ts';

export interface UnitChoice {
  /** Per structure (where the lot does not stand: the unit of the nearest structure where it does). */
  units: (UnitInfo | null)[];
  /** The unit stands a half turn about its own up. */
  turn: boolean;
}

/** The choice for every building of `list` that has a family (trees have none), the same for the same seed. */
export function chooseUnits(list: readonly MorphBuilding[], seed: number): Map<MorphBuilding, UnitChoice> {
  const out = new Map<MorphBuilding, UnitChoice>();
  const pick = rng(seed * 17 + 3);
  let last = null as (UnitChoice & { cell: number }) | null;
  for (const b of list) {
    const m = MODELS[b.model];
    const p = pick();
    const q = pick();
    const family = unitFamily(m, pick());
    if (!family) continue;
    const prev: (UnitChoice & { cell: number }) | null = last && last.cell === b.lot.cell && b.lot.cell >= 0 ? last : null;
    const chosen: (UnitInfo | null)[] = STRUCTURES.map(() => null);
    let keep: UnitInfo | null = null;
    for (const [si] of STRUCTURES.entries()) {
      if (!b.alive[si]) continue;
      keep = chosen[si] = pickUnit(UNITS, m, m.w * (b.lot.stretch ?? 1), m.h * b.sy[si], p, prev?.units[si] ?? prev?.units.find(Boolean), keep, family);
    }
    for (const [si] of STRUCTURES.entries())
      if (!chosen[si]) chosen[si] = chosen.slice(0, si).reverse().find(Boolean) ?? chosen.slice(si + 1).find(Boolean) ?? null;
    const same: boolean = !!prev && chosen.some((u, si) => u && u === prev.units[si]);
    // (a landmark and a prop keep the way the plan turned them: a portico has its front)
    const turn: boolean = family.length > 1 ? false : same ? !prev!.turn : q < 0.5;
    out.set(b, { units: chosen, turn });
    if (m.kind !== 'prop') last = { cell: b.lot.cell, units: chosen, turn };
  }
  return out;
}
