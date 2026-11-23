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
  { name: 'haussmann_a', w: 45.2, d: 17.2, h: 28.9, cx: 0, cz: 0, weight: 4, kind: 'row', tris: [418, 106] },
  { name: 'haussmann_corner', w: 45.3, d: 18.2, h: 30.8, cx: 0.05, cz: 0, weight: 2, kind: 'row', tris: [732, 276] },
  { name: 'haussmann_step', w: 43.2, d: 17.2, h: 35.1, cx: 0, cz: 0, weight: 2.5, kind: 'row', tris: [576, 200] },
  { name: 'haussmann_low', w: 35.2, d: 16.2, h: 22.5, cx: 0, cz: 0, weight: 1.6, kind: 'row', tris: [194, 194], single: true },
  { name: 'haussmann_tall', w: 41.2, d: 19.2, h: 40.3, cx: 0, cz: 0, weight: 2, kind: 'row', tris: [602, 150] },
  { name: 'haussmann_short', w: 21.6, d: 17.2, h: 28.6, cx: 0, cz: 0, weight: 1, kind: 'row', tris: [184, 184], single: true },
  { name: 'tower_house', w: 19.1, d: 17.5, h: 49.5, cx: 0, cz: 0, weight: 3.5, kind: 'row', tris: [142, 142], single: true },
  { name: 'deco_block', w: 30.8, d: 17.8, h: 43.2, cx: 0, cz: 0, weight: 1, kind: 'row', tris: [256, 256], single: true },
  { name: 'belfry', w: 38.9, d: 19.2, h: 50.5, cx: 1.15, cz: 0, weight: 0.9, kind: 'landmark', tris: [506, 250] },
  { name: 'deco_hall', w: 65.2, d: 25, h: 38.3, cx: 0, cz: 0, weight: 0.5, kind: 'landmark', tris: [474, 234] },
  { name: 'deco_tower', w: 30.8, d: 30.8, h: 71, cx: 0, cz: 0, weight: 0.3, kind: 'landmark', tris: [544, 414] },
  { name: 'dome', w: 35, d: 37.7, h: 58, cx: 0, cz: 1.35, weight: 0.35, kind: 'landmark', tris: [511, 218] },
  { name: 'cathedral', w: 59.3, d: 30.8, h: 62, cx: 5.15, cz: 0, weight: 0.4, kind: 'landmark', tris: [707, 555], props: true },
  { name: 'tree_a', w: 7.7, d: 7.4, h: 13.7, cx: 0, cz: -0.18, weight: 0, kind: 'prop', tris: [233, 233], props: true, single: true },
  { name: 'tree_b', w: 10.0, d: 7.4, h: 11.9, cx: 0.34, cz: -0.45, weight: 0, kind: 'prop', tris: [273, 273], props: true, single: true },
  { name: 'tree_c', w: 5.4, d: 4.5, h: 9.9, cx: 0.05, cz: 0.09, weight: 0, kind: 'prop', tris: [193, 193], props: true, single: true },
  { name: 'fountain', w: 19.2, d: 19.2, h: 9.8, cx: 0, cz: 0, weight: 0, kind: 'prop', tris: [148, 148], props: true, single: true },
  { name: 'monument', w: 15, d: 15, h: 34, cx: 0, cz: 0, weight: 0, kind: 'prop', tris: [112, 112], props: true, single: true },
  { name: 'pier_foot', w: 16.8, d: 16.8, h: 17.5, cx: 0, cz: 0, weight: 0, kind: 'prop', tris: [172, 172], props: true, single: true },
];

export const MODEL_INDEX = new Map(MODELS.map((m, i) => [m.name, i]));
/** The mesh of a model at a level of detail, by its name in the GLB. */
export const meshName = (m: ModelInfo, lod: 0 | 1) => (m.single ? m.name : `${m.name}_lod${lod}`);
