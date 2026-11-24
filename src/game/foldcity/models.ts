// The buildings of city.glb and the props of cityprops.glb as the layout sees them: footprint, height and kind, measured
// from the meshes (art/blender/gen_city.py, gen_cityprops.py). The city checks the loaded files against this table, so a
// rebuilt GLB cannot silently disagree with the layout (and the layout stays pure: tests need no GLB). glTF axes: +X along
// the building, +Y up, +Z towards its (portico) front.

export interface ModelInfo {
  name: string;
  /** Footprint along the model's X and Z (metres) and its height. */
  w: number;
  d: number;
  h: number;
  /** Centre of the footprint in the model's own frame. */
  cx: number;
  cz: number;
  /** How often it stands in a block, and in which role. A prop is placed by its own rule (morphplan.ts), not in a lot. */
  weight: number;
  kind: 'row' | 'landmark' | 'prop';
  /** Triangles of the near and the far model (a prop has one model: both the same). */
  tris: [number, number];
  /** In cityprops.glb instead of city.glb. */
  props?: boolean;
  /** One mesh, named without `_lod0`/`_lod1`. */
  single?: boolean;
}

export const MODELS: readonly ModelInfo[] = [
  { name: 'haussmann_a', w: 46.2, d: 19.2, h: 31.5, cx: 0, cz: 0, weight: 4, kind: 'row', tris: [1276, 394] },
  { name: 'haussmann_corner', w: 45.6, d: 19.2, h: 31.2, cx: -0.28, cz: 0, weight: 2, kind: 'row', tris: [1242, 414] },
  { name: 'haussmann_step', w: 44.2, d: 18.2, h: 36.4, cx: 0, cz: 0, weight: 2.5, kind: 'row', tris: [1108, 372] },
  { name: 'haussmann_low', w: 36.2, d: 17.2, h: 22.5, cx: 0, cz: 0, weight: 1.6, kind: 'row', tris: [414, 78] },
  { name: 'haussmann_tall', w: 42.2, d: 20.2, h: 42.3, cx: 0, cz: 0, weight: 2, kind: 'row', tris: [906, 182] },
  { name: 'haussmann_short', w: 22.6, d: 18.2, h: 29.3, cx: 0, cz: 0, weight: 1, kind: 'row', tris: [392, 88] },
  { name: 'tower_house', w: 20.2, d: 18.6, h: 48.7, cx: 0, cz: 0, weight: 1.4, kind: 'row', tris: [434, 186] },
  { name: 'deco_block', w: 30.8, d: 17.8, h: 43.2, cx: 0, cz: 0, weight: 1, kind: 'row', tris: [664, 320] },
  { name: 'belfry', w: 39.4, d: 20.2, h: 50.5, cx: 1.4, cz: 0, weight: 0.9, kind: 'landmark', tris: [982, 366] },
  { name: 'deco_hall', w: 65.2, d: 25, h: 38.3, cx: 0, cz: 0, weight: 0.5, kind: 'landmark', tris: [938, 296] },
  { name: 'deco_tower', w: 30.8, d: 30.8, h: 71, cx: 0, cz: 0, weight: 0.3, kind: 'landmark', tris: [1026, 556] },
  { name: 'dome', w: 35, d: 37.7, h: 50.6, cx: 0, cz: 1.35, weight: 0.35, kind: 'landmark', tris: [947, 320] },
  { name: 'cathedral', w: 59.3, d: 30.8, h: 62, cx: 5.15, cz: 0, weight: 0.4, kind: 'landmark', tris: [739, 555], props: true },
  { name: 'tree_a', w: 7.7, d: 7.4, h: 13.7, cx: 0, cz: -0.18, weight: 0, kind: 'prop', tris: [233, 233], props: true, single: true },
  { name: 'tree_b', w: 10, d: 7.4, h: 11.9, cx: 0.34, cz: -0.45, weight: 0, kind: 'prop', tris: [273, 273], props: true, single: true },
  { name: 'tree_c', w: 5.4, d: 4.5, h: 9.9, cx: 0.05, cz: 0.09, weight: 0, kind: 'prop', tris: [193, 193], props: true, single: true },
  { name: 'fountain', w: 19.2, d: 19.2, h: 9.8, cx: 0, cz: 0, weight: 0, kind: 'prop', tris: [148, 148], props: true, single: true },
  { name: 'monument', w: 15, d: 15, h: 34, cx: 0, cz: 0, weight: 0, kind: 'prop', tris: [112, 112], props: true, single: true },
  { name: 'pier_foot', w: 16.8, d: 16.8, h: 17.5, cx: 0, cz: 0, weight: 0, kind: 'prop', tris: [172, 172], props: true, single: true },
];

export const MODEL_INDEX = new Map(MODELS.map((m, i) => [m.name, i]));
/** The mesh of a model at a level of detail, by its name in the GLB. */
export const meshName = (m: ModelInfo, lod: 0 | 1) => (m.single ? m.name : `${m.name}_lod${lod}`);

/**
 * A textured building of buildings.glb (art/blender/gen_buildings.py; the table is units.ts, written by that script):
 * footprint, height and centre as measured from its near mesh. The layout and the plan know only MODELS: a lot is a
 * model's box (its length stretched, its height scaled). What stands in the box is the unit of the model's family whose
 * own proportions come nearest (pickUnit), fitted to it, so a house keeps the proportions of its windows and storeys
 * whatever the lot asks for; the city's plan, shadows and tests are the same with these and with the old models
 * (`?bldg=old`).
 */
export interface UnitInfo {
  name: string;
  /** 'H' a row of Haussmann houses, 'T' a tower house, 'D' an Art Deco mass; a landmark's own name; 'prop'. */
  family: string;
  w: number;
  d: number;
  /** The height that is fitted to the box: its roofs, not the stacks and pots on them (`top`, the mesh's own height). */
  h: number;
  top: number;
  cx: number;
  cz: number;
  tris: [number, number];
}

/**
 * The family of units that stands in for each model (a prop of buildings.glb stands in for the one of its own name).
 * The plan fits the Art Deco block and the tower house into many lots by their length alone; `unitFamily` gives part of
 * those lots to rows of houses instead, so a wall of the city is not a third Art Deco slabs.
 */
export const UNIT_FAMILY: Readonly<Record<string, string>> = {
  haussmann_a: 'H', haussmann_corner: 'H', haussmann_step: 'H', haussmann_low: 'H', haussmann_tall: 'H', haussmann_short: 'H',
  tower_house: 'T', deco_block: 'D',
  belfry: 'belfry', deco_hall: 'deco_hall', deco_tower: 'deco_tower', dome: 'dome', cathedral: 'cathedral',
  monument: 'prop', fountain: 'prop', pier_foot: 'prop',
};

/** The family for a lot of `model`; `pick` (0 to 1) is the lot's own. */
export function unitFamily(model: ModelInfo, pick: number): string | undefined {
  const family = UNIT_FAMILY[model.name];
  if (model.name === 'deco_block' && pick < 0.45) return 'H';
  if (model.name === 'tower_house' && pick < 0.3) return 'H';
  return family;
}

/** How a unit fits a box `w` long, `h` high and `d` deep: its factors along the three, and how far its proportions are from the box's (0 = alike). */
export function unitFit(u: UnitInfo, w: number, h: number, d: number): { kx: number; ky: number; kz: number; err: number } {
  const kx = w / u.w;
  const ky = h / u.h;
  const kz = d / u.d;
  return { kx, ky, kz, err: Math.abs(Math.log(kx / kz)) + Math.abs(Math.log(ky / kz)) };
}

/** Units within this much of the best fit are as good as it: one of them is taken, by `pick` (0 to 1), never `avoid` if another will do. */
export const UNIT_SLACK = 0.07;

/**
 * The unit for a box of a model: of the model's family, among those whose proportions fit about as well as the best
 * (`UNIT_SLACK`), the one `pick` chooses; `avoid` (the neighbour's unit) is left out when there is another. `keep` (the
 * unit this lot shows in another structure) stays if it fits within the slack. `family` is the lot's (unitFamily); null
 * for a model with no family (a tree).
 */
export function pickUnit(
  units: readonly UnitInfo[], model: ModelInfo, w: number, h: number, pick: number, avoid?: UnitInfo | null, keep?: UnitInfo | null, family: string | undefined = UNIT_FAMILY[model.name],
): UnitInfo | null {
  if (!family) return null;
  if (family === 'prop') return units.find((u) => u.name === model.name) ?? null;
  const pool = units.filter((u) => u.family === family).map((u) => ({ u, err: unitFit(u, w, h, model.d).err })).sort((a, b) => a.err - b.err);
  if (!pool.length) return null;
  const good = pool.filter((c) => c.err <= pool[0].err + UNIT_SLACK);
  if (keep && good.some((c) => c.u === keep)) return keep;
  const free = good.filter((c) => c.u !== avoid);
  const from = free.length ? free : good;
  return from[Math.min(from.length - 1, Math.floor(pick * from.length))].u;
}
