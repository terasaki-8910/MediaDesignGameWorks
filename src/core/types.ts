// Stage data model. Stage JSON files under src/stages/ follow these types.
// Walkable connections are never written by hand: they are derived from module ports.
import type { DirName, Side, Vec3 } from './math.ts';

export type Id = string;
export interface L10n { ja: string; en: string }

export interface StageFile {
  schema: 'fold-city/stage@1';
  stageId: Id;
  version: string;
  title: L10n;
  seed: number;
  modules: ModuleInstance[];
  groups: TransformGroup[];
  interactables: Interactable[];
  sections: PuzzleSection[];
  checkpoints: Checkpoint[];
  goal: Goal;
  slots?: VariationSlot[];
  visualTheme: VisualTheme;
}

export type ModuleInstance =
  | ModuleBase<'tile', { size?: [number, number]; closed?: Side[] }>
  | ModuleBase<'bridge', { length: number; sidePorts?: { i: number; side: 'N' | 'S' }[]; inset?: number; lamps?: boolean }>
  | ModuleBase<'cube3', { faces: Record<CubeFace, DirName[]> }>
  | ModuleBase<'tower', { arms: Side[]; depth?: number; inset?: number }>
  | ModuleBase<'plate', { dir: Side }>
  | ModuleBase<'deco', { kind: 'gate' | 'arch' | 'mural' | 'obelisk'; size?: number }>;

export type CubeFace = 'top' | 'bottom' | 'north' | 'south' | 'east' | 'west';

interface ModuleBase<T extends string, P> {
  id: Id;
  type: T;
  at: Vec3; // origin cell
  yaw?: 0 | 1 | 2 | 3;
  group?: Id;
  params: P;
  label?: L10n;
}

export type TransformGroup =
  | {
      id: Id;
      kind: 'states';
      pivot: Vec3; // metres, world space
      axis: 'x' | 'y' | 'z';
      states: number[]; // quarter turns about the axis for each state
      initial: number; // index into states
      durationMs?: number;
      label?: L10n;
    }
  | {
      id: Id;
      kind: 'orientation'; // a cube that can be turned about world X and Y (24 orientations)
      pivot: Vec3;
      initial: 0; // identity
      durationMs?: number;
      label?: L10n;
    };

export interface Interactable {
  id: Id;
  kind: 'console';
  at: Vec3; // cell the player stands on
  facing: Side; // edge of the cell where the pedestal stands
  controls: Id;
  axis?: 'x' | 'y' | 'z'; // for orientation groups
  label?: L10n;
}

export interface PuzzleSection {
  id: Id;
  name: L10n;
  groups: Id[];
  consoles: Id[];
  start: Id; // checkpoint id
  exit: Vec3[]; // reaching any of these cells clears the section
  intent: IntentContract;
  hintDelaySec?: number;
}

export interface IntentContract {
  teaches: string[];
  optimalActions: { min: number; max: number };
  mustUse: Id[]; // consoles every optimal solution must use
  maxDeadEndStates: 0;
}

export interface Checkpoint { id: Id; at: Vec3; facing: Side }
export interface Goal { at: Vec3 }

export interface VariationSlot {
  id: Id;
  description: string;
  target: { kind: 'console'; id: Id } | { kind: 'groupInitial'; id: Id };
  options: { at?: Vec3; facing?: Side; initial?: number }[];
  current: number;
}

export interface VisualTheme {
  sky: [string, string, string]; // zenith, horizon, ground haze
  fog: { color: string; density: number };
  accent: string;
  city: { seed: number; count: number; radius: [number, number] };
}

/** Puzzle state: one index per group (state index, or CUBE_GROUP index for orientation groups). */
export type PuzzleState = Readonly<Record<Id, number>>;

export type Action =
  | { console: Id; group: Id; kind: 'set'; to: number }
  | { console: Id; group: Id; kind: 'turn'; axis: 'x' | 'y' | 'z'; quarters: 1 | 2 | 3 };
