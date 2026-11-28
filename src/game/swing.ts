// Swinging on a thread between two tethers, as pure functions (no DOM, no three.js scene): how long a swing takes, the arc it
// follows, when Space may continue it into the next swing. game.ts drives it; tests/swing.test.ts checks it.
//
// The arc lives between the two rings: inside the landing cells (2 m from their middle to their edge, where the ring hangs) the
// player runs level along the floor, so a swing never goes down through the slab it starts on or under the one it lands on.
// Between the rings the path is the chord (rising from one floor to the other) with a pendulum's dip below it (or, going up,
// a lift above it), shaped so that its slope is zero at both rings: the path has no kink where the player leaves the floor.
import type { Vec3 } from '../core/math.ts';

export const SWING = {
  /** Seconds a swing takes: this plus `perCell` for each cell between the two landing cells. */
  seconds: 0.45,
  perCell: 0.06,
  /** The same with reduceMotion: shorter. */
  secondsReduce: 0.3,
  perCellReduce: 0.04,
  /** How far below the chord the pendulum dips at its lowest, as a share of the chord's length (a level or falling swing). */
  dip: 1 / 3,
  /** The same with reduceMotion: flatter. */
  dipReduce: 1 / 12,
  /** A swing that rises arcs up over the chord instead, by this share of its length. */
  lift: 0.15,
  liftReduce: 0.04,
  /** A swing counts as rising from this much higher (metres). */
  riseFrom: 0.5,
  /** Space continues a swing into the next one from this share of it on (the last 40 %). */
  chainFrom: 0.6,
  /** How far from the middle of a landing cell to its edge, where the ring hangs (metres). */
  cellHalf: 2,
  /** Where the hand is, above the feet: the thread to the far ring starts here. */
  hand: 1.45,
  /**
   * The speed (as a multiple of the swing's average) a swing runs into the next at when it is chained, so a chain is one
   * movement and not two that stop at the landing in between. A swing that lands comes to rest.
   */
  joinSpeed: 1.5,
} as const;

/** How long a swing over `cells` cells (the distance between the landing cells) takes, in seconds. */
export function swingSeconds(cells: number, reduce = false): number {
  return reduce ? SWING.secondsReduce + SWING.perCellReduce * cells : SWING.seconds + SWING.perCell * cells;
}

/** True once a swing has run its first 60 %: from here on Space continues it into the next swing, if the landing has one. */
export function chainOpen(k: number): boolean {
  return k >= SWING.chainFrom;
}

// --- how far along the way the player is, at each moment ---------------------------------------------------------------------

/**
 * How far across a swing the player is (0 to 1 of the ground between the cells' middles), as a function of the time `k` (0 to 1
 * of the swing): a cubic Hermite curve from (`k0`, `u0`), leaving at slope `v0` (per unit of k), to (1, 1), arriving at slope
 * `m1`. A swing from rest to rest is smoothstep. Chained, it arrives at speed; the swing after it leaves at that speed.
 */
export interface Ease { k0: number; u0: number; v0: number; m1: number }

/** A swing that starts at `v0` (a slope per unit of k: 0 from rest) and lands at rest. */
export const startEase = (v0 = 0): Ease => ({ k0: 0, u0: 0, v0, m1: 0 });

/** The same swing, continued into a chain from time `k` on: it keeps where it is and how fast it goes, and arrives at speed. */
export function chainEase(e: Ease, k: number, join: number = SWING.joinSpeed): Ease {
  return { k0: Math.min(1, Math.max(0, k)), u0: easeAt(e, k), v0: easeSlope(e, k), m1: join };
}

/** The curve's four numbers on its own interval, the tangents held to 3 times the rise so that it never runs back or past 1. */
function hermite(e: Ease) {
  const span = Math.max(1e-9, 1 - e.k0);
  const rise = Math.max(0, 1 - e.u0);
  return { span, rise, t0: Math.min(e.v0 * span, 3 * rise), t1: Math.min(e.m1 * span, 3 * rise) };
}

export function easeAt(e: Ease, k: number): number {
  if (k >= 1) return 1;
  const { span, t0, t1 } = hermite(e);
  const x = Math.min(1, Math.max(0, (k - e.k0) / span));
  const x2 = x * x;
  const x3 = x2 * x;
  return (2 * x3 - 3 * x2 + 1) * e.u0 + (x3 - 2 * x2 + x) * t0 + (-2 * x3 + 3 * x2) + (x3 - x2) * t1;
}

/** How fast the player is going at time `k`, as a slope per unit of k. */
export function easeSlope(e: Ease, k: number): number {
  const { span, t0, t1 } = hermite(e);
  const x = Math.min(1, Math.max(0, (k - e.k0) / span));
  const x2 = x * x;
  return ((6 * x2 - 6 * x) * e.u0 + (3 * x2 - 4 * x + 1) * t0 + (-6 * x2 + 6 * x) + (3 * x2 - 2 * x) * t1) / span;
}

/** The slope the swing arrives at (per unit of k). */
export function arrivalSlope(e: Ease): number {
  return easeSlope(e, 1);
}

// --- where the player is ------------------------------------------------------------------------------------------------------

export interface ArcOptions {
  reduce?: boolean;
  /** How far along its swing the player is, by time (default: a swing from rest to rest). */
  ease?: Ease;
  /** How far the start is from the edge of its cell along the swing (default: from the middle of the cell). */
  leave?: number;
  /** How far the end is from the edge of its cell (default: the middle). */
  arrive?: number;
}

const smooth = (s: number) => s * s * (3 - 2 * s);

/** Where the player is when they have come `u` (0 to 1) of the ground from `a` (the feet) to `b` (the middle of the landing cell, at its floor). */
export function arcAt(a: Vec3, b: Vec3, u: number, opts: ArcOptions = {}): [number, number, number] {
  const reduce = !!opts.reduce;
  const dx = b[0] - a[0];
  const dz = b[2] - a[2];
  const dy = b[1] - a[1];
  const run = Math.hypot(dx, dz); // along the ground
  const chord = Math.hypot(run, dy);
  const h = Math.min(1, Math.max(0, u)) * run;
  const leave = opts.leave ?? SWING.cellHalf;
  const arrive = opts.arrive ?? SWING.cellHalf;
  const gap = Math.max(1e-6, run - leave - arrive);
  const s = Math.min(1, Math.max(0, (h - leave) / gap));
  const rising = dy > SWING.riseFrom;
  const bump = Math.sin(Math.PI * s) ** 2; // 0 at both rings with a zero slope, 1 in the middle of the gap
  const sag = rising ? (reduce ? SWING.liftReduce : SWING.lift) * chord : -(reduce ? SWING.dipReduce : SWING.dip) * chord;
  const f = run > 1e-9 ? h / run : 0;
  return [a[0] + dx * f, a[1] + dy * smooth(s) + sag * bump, a[2] + dz * f];
}

/** Where the player is `k` (0 to 1) of the time through a swing from `a` to `b`. */
export function arcPoint(a: Vec3, b: Vec3, k: number, opts: ArcOptions = {}): [number, number, number] {
  return arcAt(a, b, easeAt(opts.ease ?? startEase(), k), opts);
}

/** The lowest point a swing's arc reaches below the straight line between its ends (a positive number of metres), found by sampling. */
export function arcDip(a: Vec3, b: Vec3, opts: ArcOptions = {}, samples = 200): number {
  const run = Math.hypot(b[0] - a[0], b[2] - a[2]);
  let low = 0;
  for (let i = 0; i <= samples; i++) {
    const p = arcPoint(a, b, i / samples, opts);
    const along = run > 1e-9 ? Math.hypot(p[0] - a[0], p[2] - a[2]) / run : 0;
    low = Math.max(low, a[1] + (b[1] - a[1]) * along - p[1]);
  }
  return low;
}

/**
 * One swing in flight. It runs for `seconds` from `a` to `b`; `chain()` (Space, in the last 40 %) turns its landing into a
 * hand-over to the next swing; `carry` (metres per second) is how fast it arrives then, which is how fast the next one leaves.
 */
export class Flight {
  t = 0;
  ease: Ease;
  chained = false;
  readonly a: Vec3;
  readonly b: Vec3;
  readonly seconds: number;
  readonly reduce: boolean;
  readonly leave: number;
  private readonly run: number;

  constructor(a: Vec3, b: Vec3, seconds: number, opts: { reduce?: boolean; leave?: number; speed?: number } = {}) {
    this.a = a;
    this.b = b;
    this.seconds = seconds;
    this.reduce = !!opts.reduce;
    this.leave = opts.leave ?? SWING.cellHalf;
    this.run = Math.hypot(b[0] - a[0], b[2] - a[2]);
    // `speed`: metres per second the player is already going at along this swing (from the swing before it)
    this.ease = startEase(opts.speed ? (opts.speed * seconds) / Math.max(1e-6, this.run) : 0);
  }

  get k(): number {
    return Math.min(1, this.t / this.seconds);
  }

  get done(): boolean {
    return this.t >= this.seconds;
  }

  get open(): boolean {
    return chainOpen(this.k);
  }

  advance(dt: number) {
    this.t += dt;
  }

  point(): [number, number, number] {
    return arcPoint(this.a, this.b, this.k, { reduce: this.reduce, ease: this.ease, leave: this.leave });
  }

  /** Space, in the window: the swing now arrives at speed instead of at rest (a no-op when it is not open, or already chained). */
  chain(): boolean {
    if (!this.open || this.chained) return false;
    this.ease = chainEase(this.ease, this.k);
    this.chained = true;
    return true;
  }

  /** How fast it arrives, along the ground, in metres per second. */
  get carry(): number {
    return (arrivalSlope(this.ease) * this.run) / this.seconds;
  }
}
