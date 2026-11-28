// How much of the background city is drawn. `full` is the city as designed. `low` is for machines that cannot afford it (the
// integrated GPUs): every building shows its far model, nothing stands further from the play volume than LOW.reach, the trees
// stand only near it, and the skyline keeps every other row. The play area is not part of the city and never changes.
// The plan (morphplan.ts) and the shadows it casts on the ground are the same in both: a detail only decides what is shown.
// Pure: no GLB, no DOM (the tests read it).
import type { ModelInfo } from './models.ts';
import type { SkyMass } from './skyline.ts';
import { SKYLINE_ROWS } from './skyline.ts';

export type CityDetail = 'full' | 'low';

export const LOW = {
  /** Metres from the play volume: a building further off is not drawn (the haze has taken 17 % of it at 400 m, 76 % at 600 m). */
  reach: 420,
  /** Metres from the play volume: the trees of the avenues stand only this near. */
  treeReach: 150,
  /** Every this many rows of the skyline are drawn (the nearest first): the rows part by haze, so fewer still read as layers. */
  rowStep: 2,
} as const;

/** Is a building or prop of `model`, `distance` metres from the play volume, drawn at this detail? */
export function keepBuilding(detail: CityDetail, model: ModelInfo, distance: number): boolean {
  if (detail === 'full') return true;
  if (model.name === 'pier_foot') return true; // the masonry feet of the play area's piers
  if (model.name.startsWith('tree_')) return distance <= LOW.treeReach;
  return distance <= LOW.reach;
}

/** The level of detail a building is drawn at: `low` shows the far model whatever the plan says. */
export function lodShown(detail: CityDetail, lod: 0 | 1): 0 | 1 {
  return detail === 'low' ? 1 : lod;
}

/** Is a mass of the far skyline drawn at this detail? */
export function keepMass(detail: CityDetail, mass: SkyMass): boolean {
  if (detail === 'full') return true;
  const row = Math.round(mass.layer * (SKYLINE_ROWS.length - 1));
  return row % LOW.rowStep === 0;
}
