// Real-time simulation clock: turns the wall-clock time between two rendered frames into simulation steps, so the game
// runs at the speed of the clock whatever the frame rate. Pure (no three.js, no DOM): tests/stepper.test.ts runs it.
//
// The game used to take one step per frame, capped at 0.05 s: at 5 frames a second, game time ran at a quarter of real
// time and a player seemed unable to move. Now a frame runs as many steps as the time since the last frame needs.

/** The longest simulation step, in seconds. A slow frame is cut into steps of exactly this length. */
export const STEP = 1 / 60;
/** The most game time one frame simulates. Below 1 / MAX_BACKLOG (4) frames a second on average, game time runs slow again. */
export const MAX_BACKLOG = 0.25;
/**
 * What a frame could not simulate (the cap held it back) is owed to the next frames, up to this much, and the rest is given
 * up. Frames from a weak machine arrive unevenly (a software renderer delivers 17 ms, 17 ms, 430 ms, 180 ms ...): with the
 * long ones paid back by the short ones that follow, game time keeps the pace of the clock at 4 frames a second on average,
 * not only when every frame is shorter than the cap. A stall (a hidden tab, a debugger) gives up all but this much.
 */
export const MAX_OWED = 0.5;
/**
 * What is left of a frame after its whole steps is run as one shorter step when it is at least this long (a display faster
 * than 60 Hz then moves the game every frame, not every second or third one), and otherwise carried to the next frame.
 */
export const MIN_STEP = 0.002;

const EPS = 1e-9; // (a frame of exactly n steps must not leave a rounding crumb behind)

export class Stepper {
  private owed = 0;
  /** Real time given up, in seconds: the game ran that much slower than the clock. */
  dropped = 0;

  /**
   * Run the simulation for `real` seconds of wall-clock time since the last frame: `step(dt)` is called once for every step,
   * none longer than STEP, and together at most MAX_BACKLOG. Returns how many steps were run. Simulated time + owed time +
   * dropped time is always the real time.
   */
  run(real: number, step: (dt: number) => void): number {
    const backlog = this.owed + (real > 0 ? Math.min(real, 3600) : 0); // (negative and NaN count as no time, and an hour is as good as for ever)
    const budget = Math.min(backlog, MAX_BACKLOG);
    let left = budget;
    let n = 0;
    while (left >= STEP - EPS) {
      step(STEP);
      left -= STEP;
      n++;
    }
    if (left >= MIN_STEP) {
      step(left);
      left = 0;
      n++;
    }
    let owed = backlog - budget + (left > EPS ? left : 0);
    if (owed > MAX_OWED) {
      this.dropped += owed - MAX_OWED;
      owed = MAX_OWED;
    }
    this.owed = owed;
    return n;
  }

  /** Real time waiting for the next frames' steps, in seconds. */
  get pending() {
    return this.owed;
  }

  /** Forget what is owed. */
  reset() {
    this.owed = 0;
  }
}
