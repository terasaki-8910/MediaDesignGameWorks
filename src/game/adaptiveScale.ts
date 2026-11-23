// Adaptive resolution: decides when the render scale goes down or up from frame intervals.
// Pure (no three.js, no DOM) so it can be unit tested; Engine applies the scale it decides.

/** The lowest scale a lowering may reach. */
export const SCALE_FLOOR = 0.55;

export interface AdaptiveScaleOptions {
  /** The scale to start at. */
  initial: number;
  /** The highest scale a raise may reach. */
  max: number;
}

const WINDOW_MS = 2000; // a decision is made on every window of this much frame time
const LOWER_STEP = 0.1;
const RAISE_STEP = 0.05;
const DROP_FACTOR = 1.5; // a frame is dropped when its interval exceeds this many display frames
const LOWER_DROPS = 0.05; // lower when more than this share of a window dropped
const CALM_DROPS = 0.01; // a window is calm when at most this share dropped
const CALM_MS = 6000; // calm time before a raise
const CALM_MAX_MS = 60000; // the wait doubles after a raise that did not hold, up to this
const SETTLE_MS = 400; // frame time ignored after every change: the resize hitch (and a late frame) is not the new scale's cost
const MEMORY = 10; // windows the display interval is remembered over
const LOW_PERCENTILE = 0.1;
// The estimate is clamped so a machine that is constantly slow is not mistaken for a slow display:
// 18 ms keeps 60 Hz and anything faster exact and counts a steady 28 ms (36 fps) as dropped frames.
const MIN_INTERVAL_MS = 2;
const MAX_INTERVAL_MS = 18;

const round2 = (v: number) => Math.round(v * 100) / 100;

export class AdaptiveScale {
  private current: number;
  private readonly max: number;
  private frames: number[] = [];
  private frameMs = 0;
  private lows: number[] = [];
  private estimate = 0;
  /** Frame time still to ignore: a hold or a settle after a change. */
  private holdMs = 0;
  private calmMs = 0;
  private calmNeededMs = CALM_MS;
  /** A raise is on trial until the first full window after it has been judged. */
  private onTrial = false;
  private beforeRaise = 0;

  constructor(opts: AdaptiveScaleOptions) {
    this.current = opts.initial;
    this.max = opts.max;
  }

  get scale() {
    return this.current;
  }

  /** The display's frame interval as estimated from the samples, in ms (0 before the first window). */
  get interval() {
    return this.estimate;
  }

  /** No change of any kind for `seconds` of frame time; the frames meanwhile do not count toward the next decision. */
  hold(seconds: number) {
    if (!(seconds > 0)) return;
    this.holdMs = Math.max(this.holdMs, seconds * 1000); // overlapping holds do not add up
    this.frames = [];
    this.frameMs = 0;
  }

  /** Record a frame interval (ms). Returns true when the scale changed and the caller must apply `scale`. */
  sample(ms: number): boolean {
    if (!(ms > 0)) return false;
    if (this.holdMs > 0) {
      this.holdMs -= ms;
      return false;
    }
    this.frames.push(ms);
    this.frameMs += ms;
    return this.frameMs >= WINDOW_MS ? this.decide() : false;
  }

  private decide(): boolean {
    const frames = this.frames;
    const span = this.frameMs;
    this.frames = [];
    this.frameMs = 0;
    // the display interval: the lowest 10th percentile of any recent window, so a slow stretch does not become the norm
    const sorted = [...frames].sort((a, b) => a - b);
    this.lows.push(sorted[Math.floor(LOW_PERCENTILE * sorted.length)]);
    if (this.lows.length > MEMORY) this.lows.shift();
    this.estimate = Math.min(MAX_INTERVAL_MS, Math.max(MIN_INTERVAL_MS, Math.min(...this.lows)));
    const limit = DROP_FACTOR * this.estimate;
    const dropped = frames.filter((v) => v > limit).length / frames.length;

    if (this.onTrial) {
      this.onTrial = false;
      if (dropped > CALM_DROPS) {
        // the raise did not hold: go back, and wait twice as long before the next try
        this.calmNeededMs = Math.min(this.calmNeededMs * 2, CALM_MAX_MS);
        this.calmMs = 0;
        return this.change(this.beforeRaise);
      }
      this.calmNeededMs = CALM_MS;
    }
    if (dropped > LOWER_DROPS) {
      this.calmMs = 0;
      return this.change(Math.max(SCALE_FLOOR, round2(this.current - LOWER_STEP)));
    }
    if (dropped > CALM_DROPS) {
      this.calmMs = 0;
      return false;
    }
    this.calmMs += span;
    if (this.calmMs < this.calmNeededMs || this.current >= this.max) return false;
    this.calmMs = 0;
    this.beforeRaise = this.current;
    this.onTrial = true;
    return this.change(Math.min(this.max, round2(this.current + RAISE_STEP)));
  }

  private change(next: number): boolean {
    if (next === this.current) return false;
    this.current = next;
    this.holdMs = Math.max(this.holdMs, SETTLE_MS);
    return true;
  }
}
