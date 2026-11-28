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
  handles?: Handle[]; // v0.5: turn a group from anywhere within reach, without a console
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
  | ModuleBase<'deco', { kind: 'gate' | 'arch' | 'mural' | 'obelisk'; size?: number }>
  // v0.5: a ring at the `facing` edge of its cell, 1.6 m above that cell's floor. It has no walk tile of its own: its
  // landing cell is its own cell, which another module must make walkable. Two facing rings in line link (a thread).
  | ModuleBase<'tether', { facing: Side; span?: number }>;

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
      /** v0.5 clockwork: at every tick the group advances one step through `states`, wrapping from the last to the first. */
      auto?: { periodMs: number; dwellMs: number };
      durationMs?: number;
      label?: L10n;
      stateLabels?: L10n[]; // shown in Fold Mode; describe the pose, not whether it is correct
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

/**
 * v0.5: a point in the world (it does not move with its group) from which the player turns a group without a console.
 * The player may stand on any walkable cell within `reach` (and in line of sight) and step the group.
 */
export interface Handle {
  id: Id;
  at: Vec3; // cell the handle is in
  height?: number; // metres above that cell's floor (default 2)
  controls: Id;
  reach?: number; // cells, horizontal Euclidean distance (default 3)
  axis?: 'x' | 'y' | 'z'; // for orientation groups
  label?: L10n;
}

export interface PuzzleSection {
  id: Id;
  name: L10n;
  groups: Id[];
  consoles: Id[];
  handles?: Id[];
  start: Id; // checkpoint id
  exit: Vec3[]; // reaching any of these cells clears the section
  intent: IntentContract;
  intro?: L10n; // caption shown when the section starts
}

export interface IntentContract {
  teaches: string[];
  optimalActions: { min: number; max: number };
  mustUse: Id[]; // consoles or handles every optimal solution must use
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

/** What a console offers. (Kept as it was, so the game keeps compiling; handle steps and waits are PlayerAction.) */
export type Action =
  | { console: Id; group: Id; kind: 'set'; to: number }
  | { console: Id; group: Id; kind: 'turn'; axis: 'x' | 'y' | 'z'; quarters: 1 | 2 | 3 };

/** One step of a handle's group: to the neighbouring index of `states` (it wraps only for four distinct quarters), or one quarter turn of an orientation group. */
export interface StepAction { handle: Id; group: Id; kind: 'step'; dir: 1 | -1 }

/** Time passes: every auto group of the section (all auto groups when `section` is left out) advances one step. */
export interface WaitAction { kind: 'wait'; section?: Id }

/** Every action of the player: console actions, handle steps and waits. */
export type PlayerAction = Action | StepAction | WaitAction;
