// The feel of a fold, as pure functions (no DOM, no three.js scene): the curve of the turn (a pull-back, the swing, a slight
// overshoot and the settle), how far the pull-back and the overshoot may reach, which seams a fold meets and how many paths
// it joined, the camera shake of the stop, and the notes of a joined path. world.ts drives them; tests/foldFeel.test.ts
// checks them against the stage.
import type { CompiledStage, WalkMap } from '../core/compile.ts';
import { DIRS, OPPOSITE, SIDES, cellFloor, type Side, type Vec3 } from '../core/math.ts';
import type { Action, Id, PuzzleState, StepAction } from '../core/types.ts';

/**
 * A fold takes this much longer than the turn alone did: the pull-back and the settle are added to the swing. (The brief:
 * within about 15 % of the old time, so the tests that wait for a fold and the pacing hold.)
 */
export const FOLD_TIME_GAIN = 1.08;
/** Where, in 0..1 of a fold, the pull-back ends and the swing ends (at the stop, the overshoot's peak); the rest is the settle. */
export const PULL_END = 0.09;
export const STOP_AT = 0.8;

/** The pull-back and the overshoot, as fractions of the turn (both 0 = a plain turn). */
export interface Feel { ant: number; over: number }
export const NO_FEEL: Feel = { ant: 0, over: 0 };

/** How far the far end of the moving group may travel in the pull-back and in the overshoot, in metres, and the angles that cap them. */
export const PULL_TIP = 0.42;
export const PULL_MAX = 0.07;
export const OVER_TIP = 0.3;
export const OVER_MAX = 0.05;

const easeInOutCubic = (u: number) => (u < 0.5 ? 4 * u * u * u : 1 - (-2 * u + 2) ** 3 / 2);
const smootherstep = (u: number) => u * u * u * (u * (u * 6 - 15) + 10);

/**
 * How far through its turn a group is, as a fraction of the turn (0 = where it was, 1 = where it ends), at `k` of the fold's
 * time. The pull-back eases to a stop in the opposite direction, the swing runs from there to just past the end, and the
 * settle eases back to the end exactly: each joint has no speed, so the curve has no kinks. With `reduce` it is one gentle
 * ease with no pull-back and no overshoot.
 */
export function foldCurve(k: number, feel: Feel, reduce = false): number {
  const x = Math.min(1, Math.max(0, k));
  if (reduce) return smootherstep(x);
  if (x < PULL_END) return 0 - feel.ant * Math.sin(((x / PULL_END) * Math.PI) / 2); // (0 - : not -0 at the start)
  if (x < STOP_AT) return -feel.ant + (1 + feel.over + feel.ant) * easeInOutCubic((x - PULL_END) / (STOP_AT - PULL_END));
  return 1 + feel.over * (0.5 + 0.5 * Math.cos(((x - STOP_AT) / (1 - STOP_AT)) * Math.PI));
}

/**
 * How far a group has come, as a fraction of the way from where the pointer let go of it (0) to the stop it is snapping to (1),
 * at `k` of the settle. It is already in motion, so there is no pull-back: it eases out to the stop's overshoot (`over`, a
 * fraction of that way) at STOP_AT, the same instant as a fold's, and settles back onto 1 as a fold does. With `reduce` it is one
 * ease-out with no overshoot. Starts at 0, ends exactly on 1, and has no speed at its peak or at its end.
 */
export function settleCurve(k: number, over: number, reduce = false): number {
  const x = Math.min(1, Math.max(0, k));
  if (reduce) return 1 - (1 - x) ** 3;
  if (x < STOP_AT) return (1 + over) * (1 - (1 - x / STOP_AT) ** 3);
  return 1 + over * (0.5 + 0.5 * Math.cos(((x - STOP_AT) / (1 - STOP_AT)) * Math.PI));
}

/**
 * The seconds a settle takes: the turn's own time (`plain`, as `foldSeconds` takes it) for the share of the way still to go,
 * never less than `floor` (a stop a hand's width away still has to be seen to arrive).
 */
export function settleSeconds(plain: number, share: number, reduce: boolean, floor = 0.32): number {
  return Math.max(Math.min(plain, floor), foldSeconds(plain, reduce) * Math.min(1, Math.max(0, share)));
}

/** The seconds a fold takes, from the seconds the plain turn took (`reduce`: the gentle ease takes no longer than the turn). */
export function foldSeconds(plain: number, reduce: boolean): number {
  return reduce ? plain : plain * FOLD_TIME_GAIN;
}

/**
 * The pull-back and the overshoot of a turn of `angle` radians about an axis, of a group whose farthest part is `radius`
 * metres from the axis: small angles, so the far end moves by at most PULL_TIP / OVER_TIP metres (the street is 16 m long, the
 * cube 8.5 m from its middle to a corner). Anything beyond the turn itself is not checked by the solver's sweep; see
 * CompiledStage.sweepBlockers' margin.
 */
export function feelFor(radius: number, angle: number): Feel {
  const turn = Math.abs(angle);
  if (turn < 1e-6 || radius < 0.5) return NO_FEEL;
  return { ant: Math.min(PULL_MAX, PULL_TIP / radius) / turn, over: Math.min(OVER_MAX, OVER_TIP / radius) / turn };
}

/** The largest angle the turn goes beyond its two ends (pull-back and overshoot), in radians: the margin to sweep. */
export function feelReach(feel: Feel, angle: number): number {
  return Math.max(feel.ant, feel.over) * Math.abs(angle);
}

/** The farthest any corner of the boxes is from the axis through `pivot`, in metres. */
export function sweepRadius(boxes: readonly { min: Vec3; max: Vec3 }[], pivot: Vec3, axis: 'x' | 'y' | 'z'): number {
  const [a, b] = axis === 'x' ? [1, 2] : axis === 'y' ? [0, 2] : [0, 1];
  let r = 0;
  for (const box of boxes)
    for (const i of [box.min, box.max])
      for (const j of [box.min, box.max]) r = Math.max(r, Math.hypot(i[a] - pivot[a], j[b] - pivot[b]));
  return r;
}

/**
 * The feel of an action in a state: the pull-back and the overshoot of its group's turn, each dropped when its extra sweep
 * would pass through another module or a console's stand (the solver only checked the turn itself), and the numbers it
 * came from (the radius about the axis and the signed angle of the turn).
 */
export function feelOf(cs: CompiledStage, state: PuzzleState, a: Action | StepAction): { feel: Feel; radius: number; angle: number } {
  const motion = cs.motionOf(state, a);
  const moving = new Set(cs.modules.filter((m) => m.group === a.group).map((m) => m.id));
  const radius = sweepRadius(cs.worldBoxes(state).filter((b) => moving.has(b.module)), motion.pivot, motion.axis);
  const angle = (motion.quarters * Math.PI) / 2;
  let feel = feelFor(radius, angle);
  if (feel.ant && cs.sweepBlockers(state, a, [feelReach({ ant: feel.ant, over: 0 }, angle), 0]).length) feel = { ...feel, ant: 0 };
  if (feel.over && cs.sweepBlockers(state, a, [0, feelReach({ ant: 0, over: feel.over }, angle)]).length) feel = { ...feel, over: 0 };
  return { feel, radius, angle };
}

const step = (c: readonly number[], s: Side) => `${c[0] + DIRS[s][0]},${c[1]},${c[2] + DIRS[s][2]}`;

/** A seam where a moving group meets another module: the middle of the shared cell edge, on the floor. */
export interface Seam { x: number; y: number; z: number; side: Side }
export interface Joints {
  /** Paths the fold joined: seams between two modules that were not open before and are now. A plate counts once, not once per end. */
  joined: number;
  /** Where the moving group's tiles touch another module's after the fold (open or not), for the dust. */
  seams: Seam[];
}

/** The open edges between two modules, by id: the pair of cells, or the plate's own cell when one side is a plate. */
function openSeams(wm: WalkMap): Set<string> {
  const out = new Set<string>();
  for (const t of wm.tiles.values())
    for (const s of SIDES) {
      if (!t.open[s]) continue;
      const n = wm.tiles.get(step(t.cell, s));
      if (!n || n.module === t.module || !n.open[OPPOSITE[s]]) continue;
      out.add(t.plate ? `plate:${t.key}` : n.plate ? `plate:${n.key}` : [t.key, n.key].sort().join('|'));
    }
  return out;
}

/** What a fold from `before` to `after` joins, and where its group meets the rest (`moving`: the group's module ids). */
export function jointsOf(before: WalkMap, after: WalkMap, moving: ReadonlySet<Id>): Joints {
  const was = openSeams(before);
  let joined = 0;
  for (const id of openSeams(after)) if (!was.has(id)) joined++;
  const seams: Seam[] = [];
  const seen = new Set<string>();
  for (const t of after.tiles.values()) {
    if (!moving.has(t.module)) continue;
    for (const s of SIDES) {
      const n = after.tiles.get(step(t.cell, s));
      if (!n || n.module === t.module || Math.abs(n.floorY - t.floorY) > 0.01) continue;
      const id = [t.key, n.key].sort().join('|');
      if (seen.has(id)) continue;
      seen.add(id);
      const f = cellFloor(t.cell);
      seams.push({ x: f[0] + DIRS[s][0] * 2, y: t.floorY, z: f[2] + DIRS[s][2] * 2, side: s });
    }
  }
  return { joined, seams };
}

/** The notes of a joined path: the major pentatonic, one step higher for each path. Semitones above the first note. */
export const NOTE_LADDER: readonly number[] = [0, 2, 4, 7, 9, 12, 14, 16];
export const NOTE_BASE = 523.25; // C5

/** The frequencies played for `n` joined paths, in order: the first is the lowest, each next is one step higher. */
export function joinNotes(n: number): number[] {
  return NOTE_LADDER.slice(0, Math.max(0, Math.floor(n))).map((semitones) => NOTE_BASE * 2 ** (semitones / 12));
}

/**
 * The camera's shake after a stop, in radians about its own x and y: a few small swings that die away. Deterministic (it
 * depends on the time since the kick alone), so the review shots and the tests see the same thing every time.
 */
export class Shake {
  static readonly SECONDS = 0.7;
  private t = Shake.SECONDS;
  private amp = 0;

  kick(amplitude: number) {
    this.t = 0;
    this.amp = amplitude;
  }

  clear() {
    this.t = Shake.SECONDS;
    this.amp = 0;
  }

  update(dt: number) {
    this.t = Math.min(Shake.SECONDS, this.t + dt);
  }

  get active() {
    return this.t < Shake.SECONDS && this.amp > 0;
  }

  /** Turn about the camera's own y (left and right), radians. */
  get yaw() {
    return this.active ? this.amp * Math.exp(-this.t / 0.12) * Math.sin(this.t * 2 * Math.PI * 19) : 0;
  }

  /** Turn about the camera's own x (up and down), radians. */
  get pitch() {
    return this.active ? this.amp * 0.8 * Math.exp(-this.t / 0.12) * Math.sin(this.t * 2 * Math.PI * 26 + 1.1) : 0;
  }
}
