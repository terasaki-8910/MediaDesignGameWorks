import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MAX_BACKLOG, MAX_OWED, MIN_STEP, STEP, Stepper } from '../src/game/stepper.ts';

/** Feed `frames` frames of `ms` milliseconds each; returns every step that ran and how many ran in each frame. */
function drive(frames: number, ms: number | ((i: number) => number), stepper = new Stepper()) {
  const steps: number[] = [];
  const perFrame: number[] = [];
  const perFrameTime: number[] = [];
  let real = 0;
  for (let i = 0; i < frames; i++) {
    const len = typeof ms === 'number' ? ms : ms(i);
    real += len / 1000;
    const before = steps.length;
    perFrame.push(stepper.run(len / 1000, (dt) => steps.push(dt)));
    perFrameTime.push(steps.slice(before).reduce((a, b) => a + b, 0));
  }
  return { steps, perFrame, perFrameTime, stepper, real, simulated: steps.reduce((a, b) => a + b, 0) };
}

for (const [ms, label] of [[16.7, '60 fps'], [100, '10 fps'], [250, '4 fps']] as const) {
  test(`game time equals real time at ${label} (${ms} ms frames)`, () => {
    const { simulated, stepper, real } = drive(600, ms);
    // (what is not simulated yet is what the stepper still owes: a crumb shorter than the shortest step)
    assert.ok(Math.abs(simulated + stepper.pending - real) < 1e-9, `simulated ${simulated} + owed ${stepper.pending} = real ${real}`);
    assert.ok(stepper.pending < MIN_STEP, `${stepper.pending} owed`);
    assert.ok(real - simulated < MIN_STEP + 1e-9, 'game time is behind the clock by less than one short step');
    assert.equal(stepper.dropped, 0, 'nothing is given up up to 4 fps');
  });
}

test('a slow frame is cut into steps of exactly 1/60 s, a frame at 60 fps is one step', () => {
  const slow = drive(1, 100);
  assert.equal(slow.steps.filter((s) => s === STEP).length, 6);
  assert.ok(slow.steps.every((s) => s <= STEP));
  const fast = drive(1, 16.7);
  assert.equal(fast.steps.length, 1);
  assert.equal(fast.steps[0], STEP);
});

test('no step is longer than 1/60 s, none is a crumb, and no frame simulates more than the backlog cap', () => {
  const stepper = new Stepper();
  let seed = 7;
  const rand = () => (seed = (seed * 48271) % 2147483647) / 2147483647;
  for (let i = 0; i < 5000; i++) {
    const real = rand() < 0.1 ? rand() * 2 : rand() * 0.08; // mostly 0 to 80 ms, now and then up to 2 s
    let frame = 0;
    stepper.run(real, (dt) => {
      assert.ok(dt <= STEP, `step ${dt} is longer than 1/60 s`);
      assert.ok(dt >= MIN_STEP - 1e-12, `step ${dt} is a crumb`);
      frame += dt;
    });
    assert.ok(frame <= MAX_BACKLOG + 1e-9, `a frame simulated ${frame} s`);
    assert.ok(stepper.pending <= MAX_OWED + 1e-12);
  }
});

test('the backlog is capped at 0.25 s of game time per frame; a little of the rest is owed to the next frames, the rest is given up', () => {
  const stepper = new Stepper();
  const steps: number[] = [];
  assert.equal(stepper.run(1, (dt) => steps.push(dt)), 15, 'a one second frame runs 15 steps');
  assert.ok(Math.abs(steps.reduce((a, b) => a + b, 0) - MAX_BACKLOG) < 1e-9);
  assert.ok(Math.abs(stepper.pending - MAX_OWED) < 1e-9);
  assert.ok(Math.abs(stepper.dropped - 0.25) < 1e-9);
  // the next frames, however short, pay what is owed (the cap holds for each of them), then the clock is even again
  const frames: number[] = [];
  for (let i = 0; i < 6; i++) {
    let sum = 0;
    stepper.run(0.017, (dt) => (sum += dt));
    frames.push(sum);
  }
  assert.ok(frames.every((f) => f <= MAX_BACKLOG + 1e-9), `${frames}`);
  assert.ok(Math.abs(frames[0] - MAX_BACKLOG) < 1e-9 && frames[5] < 0.04, `${frames}`);
  assert.ok(Math.abs(frames.reduce((a, b) => a + b, 0) + stepper.pending - (MAX_OWED + 6 * 0.017)) < 1e-9);
  // a stall of a minute (a hidden tab) gives up all but what the cap and the debt allow
  const hidden = new Stepper();
  hidden.run(60, () => {});
  assert.ok(Math.abs(hidden.pending - MAX_OWED) < 1e-9);
  assert.ok(Math.abs(hidden.dropped - (60 - MAX_BACKLOG - MAX_OWED)) < 1e-9);
});

test('below 4 fps on average game time slows to the cap, and Stepper owes nothing it cannot pay', () => {
  const { simulated, real, stepper } = drive(300, 1000 / 3); // 3 fps
  assert.ok(Math.abs(simulated / real - 0.75) < 0.01, `${(simulated / real).toFixed(3)} of real time`);
  assert.ok(stepper.pending <= MAX_OWED + 1e-12);
  assert.ok(Math.abs(simulated + stepper.pending + stepper.dropped - real) < 1e-9, 'simulated + owed + given up is the real time');
});

test('uneven frames from a weak machine keep the pace of the clock when they average under 0.25 s', () => {
  // what a software renderer delivers (measured: 17, 17, 430, 183, 217 ms ...), 188 ms on average
  const pattern = [165, 17, 183, 17, 167, 183, 317, 217, 17, 17, 183, 50, 433, 433, 217, 200];
  const { simulated, real, stepper } = drive(pattern.length * 40, (i) => pattern[i % pattern.length]);
  assert.ok(simulated / real > 0.97, `${(simulated / real).toFixed(3)} of real time`);
  // a cap that gave up everything beyond 0.25 s per frame would have run at under 90 %
  const lost = pattern.reduce((a, ms) => a + Math.max(0, ms / 1000 - MAX_BACKLOG), 0) / (pattern.reduce((a, b) => a + b, 0) / 1000);
  assert.ok(lost > 0.1, `${lost.toFixed(2)} of the time is in frames over the cap`);
  assert.ok(stepper.dropped / real < 0.03);
});

test('a display faster than 60 Hz still moves the game every frame', () => {
  const { perFrame, simulated, stepper } = drive(144, 1000 / 144);
  assert.ok(perFrame.every((n) => n === 1), 'one short step per frame, not a step every second or third frame');
  assert.ok(Math.abs(simulated + stepper.pending - 1) < 1e-9);
  // a display so fast that a frame is shorter than the shortest step carries the time over
  const fast = drive(1000, 1);
  assert.ok(fast.perFrame.filter((n) => n === 0).length > 400);
  assert.ok(Math.abs(fast.simulated + fast.stepper.pending - 1) < 1e-9);
});

test('a frame that jitters around 60 fps never gives a zero-step frame or a long one', () => {
  const stepper = new Stepper();
  let steps = 0;
  for (let i = 0; i < 1000; i++) {
    const n = stepper.run(i % 2 ? 0.0166 : 0.0168, () => steps++);
    assert.ok(n >= 1 && n <= 2, `${n} steps in one frame`);
  }
  assert.ok(steps < 1200);
});

test('a stalled or invalid frame time never breaks the clock', () => {
  const stepper = new Stepper();
  assert.equal(stepper.run(-1, () => assert.fail('no step for a negative time')), 0);
  assert.equal(stepper.run(Number.NaN, () => assert.fail('no step for NaN')), 0);
  assert.equal(stepper.run(Infinity, () => {}), 15, 'an infinite stall is the cap');
  assert.ok(Number.isFinite(stepper.dropped));
  assert.equal(stepper.pending, MAX_OWED);
  stepper.reset();
  assert.equal(stepper.pending, 0);
  assert.equal(stepper.run(0, () => assert.fail('no step for zero time')), 0);
});
