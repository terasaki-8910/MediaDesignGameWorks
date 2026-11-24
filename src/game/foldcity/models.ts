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
 * The textured building units of citytex.glb (art/blender/gen_citytex.py), a look test shown with `?bldg=tex`: footprint,
 * height and centre as measured from the near meshes. They are not part of the layout: a unit stands in for the near
 * model of a lot and is scaled to that model's footprint and height (morphcity.ts), so the city is the same with and
 * without them.
 */
export interface TexUnit {
  name: string;
  w: number;
  d: number;
  /** The height that is fitted to the model's: its roofs and the stacks on them, not the tallest pot (`top`, the mesh's own height). */
  h: number;
  top: number;
  cx: number;
  cz: number;
  tris: [number, number];
}
export const TEX_UNITS: readonly TexUnit[] = [
  { name: 'tx_corner', w: 47.5, d: 21.2, h: 29.5, top: 32.4, cx: -0.05, cz: 0, tris: [1070, 606] },
  { name: 'tx_mid', w: 46, d: 21, h: 34, top: 37.8, cx: 0, cz: 0, tris: [818, 532] },
  { name: 'tx_end', w: 32, d: 20, h: 27.5, top: 30.6, cx: 0, cz: 0, tris: [514, 330] },
  { name: 'tx_deco', w: 26.8, d: 18.8, h: 46.2, top: 46.2, cx: 0, cz: 0, tris: [420, 324] },
];
/** Which units may stand in for a model's near level (one is picked per lot); models not listed keep their own. */
export const TEX_FOR: Readonly<Record<string, readonly string[]>> = {
  haussmann_a: ['tx_corner', 'tx_mid'],
  haussmann_corner: ['tx_corner'],
  haussmann_step: ['tx_mid'],
  haussmann_tall: ['tx_mid'],
  haussmann_low: ['tx_end'],
  haussmann_short: ['tx_end'],
  tower_house: ['tx_deco'],
  deco_block: ['tx_deco'],
};
