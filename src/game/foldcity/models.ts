// The buildings of city.glb as the layout sees them: footprint, height and kind, measured from the *_lod0 meshes
// (art/blender/gen_city.py). FoldCity checks the loaded file against this table, so a rebuilt city.glb cannot silently
// disagree with the layout (and the layout stays pure: tests need no GLB). glTF axes: +X along the building, +Y up,
// +Z towards its (portico) front.

export interface ModelInfo {
  name: string;
  /** Footprint along the model's X and Z (metres) and its height. */
  w: number;
  d: number;
  h: number;
  /** Centre of the footprint in the model's own frame. */
  cx: number;
  cz: number;
  /** How often it stands in a block, and in which role. */
  weight: number;
  kind: 'row' | 'court' | 'landmark';
}

export const MODELS: readonly ModelInfo[] = [
  { name: 'haussmann_a', w: 45.2, d: 17.2, h: 26.9, cx: 0, cz: 0, weight: 4, kind: 'row' },
  { name: 'haussmann_corner', w: 45.3, d: 18.2, h: 30.9, cx: 0.05, cz: 0, weight: 2.5, kind: 'row' },
  { name: 'haussmann_step', w: 43.2, d: 17.2, h: 33.1, cx: 0, cz: 0, weight: 2.5, kind: 'row' },
  { name: 'haussmann_low', w: 35.2, d: 16.2, h: 20.7, cx: 0, cz: 0, weight: 3.2, kind: 'row' },
  { name: 'haussmann_tall', w: 41.2, d: 19.2, h: 32.6, cx: 0, cz: 0, weight: 2, kind: 'row' },
  { name: 'haussmann_court', w: 43.2, d: 32.2, h: 26.9, cx: 0, cz: 0, weight: 2, kind: 'court' },
  { name: 'belfry', w: 38.9, d: 19.2, h: 50.5, cx: 1.15, cz: 0, weight: 0.9, kind: 'landmark' },
  { name: 'deco_hall', w: 65.2, d: 25, h: 36.5, cx: 0, cz: 0, weight: 0.5, kind: 'landmark' },
  { name: 'deco_tower', w: 30.8, d: 30.8, h: 71, cx: 0, cz: 0, weight: 0.3, kind: 'landmark' },
  { name: 'dome', w: 35, d: 37.7, h: 58, cx: 0, cz: 1.35, weight: 0.35, kind: 'landmark' },
];

export const MODEL_INDEX = new Map(MODELS.map((m, i) => [m.name, i]));
