import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AdaptiveScale, SCALE_FLOOR } from '../src/game/adaptiveScale.ts';

const HZ60 = 1000 / 60;
const HZ120 = 1000 / 120;
const HZ144 = 1000 / 144;
const SLOW = 100 / 3; // 30 fps: a missed frame at 60 Hz

interface Change { at: number; scale: number }

/** Feeds frame intervals to the controller and keeps the clock and the changes it asked for. */
class Rig {
  readonly ctl: AdaptiveScale;
  readonly changes: Change[] = [];
  now = 0; // ms of frame time fed so far
  private seed = 12345;

  constructor(initial = 1, max = 1) {
    this.ctl = new AdaptiveScale({ initial, max });
  }

  get last(): Change | undefined {
    return this.changes[this.changes.length - 1];
  }

  frame(ms: number) {
    this.now += ms;
    if (this.ctl.sample(ms)) this.changes.push({ at: this.now / 1000, scale: this.ctl.scale });
  }

  /** `seconds` of frames of `ms`; every `slowEvery`th one takes `slowMs` instead; `jitter` is the +-ms noise of a real timer. */
  run(seconds: number, ms = HZ60, { slowEvery = 0, slowMs = SLOW, jitter = 0 } = {}) {
    const end = this.now + seconds * 1000;
    for (let i = 1; this.now < end; i++) {
      this.seed = (this.seed * 1103515245 + 12345) % 2147483648;
      const noise = (this.seed / 2147483648 - 0.5) * 2 * jitter;
      this.frame((slowEvery && i % slowEvery === 0 ? slowMs : ms) + noise);
    }
  }

  /** Frames until the scale changes, at most `limit` seconds; returns that change. */
  until(limit: number, ms = HZ60, opts: { slowEvery?: number; slowMs?: number } = {}): Change {
    const before = this.changes.length;
    const end = this.now + limit * 1000;
    for (let i = 1; this.now < end && this.changes.length === before; i++) this.frame(opts.slowEvery && i % opts.slowEvery === 0 ? (opts.slowMs ?? SLOW) : ms);
    assert.equal(this.changes.length, before + 1, `no change within ${limit} s`);
    return this.last!;
  }
}

test('steady 60 Hz at the top scale changes nothing, and the display interval is learned', () => {
  const rig = new Rig(1, 1);
  rig.run(60, HZ60, { jitter: 0.3 });
  assert.deepEqual([...rig.changes], []);
  assert.equal(rig.ctl.scale, 1);
  assert.ok(Math.abs(rig.ctl.interval - HZ60) < 0.5, `interval ${rig.ctl.interval}`);
});

test('a lone hitch is not a drop streak', () => {
  const rig = new Rig(1, 1);
  rig.run(10, HZ60, { jitter: 0.3 });
  for (let k = 0; k < 5; k++) {
    rig.frame(60);
    rig.run(10, HZ60, { jitter: 0.3 });
  }
  assert.deepEqual([...rig.changes], []);
});

test('a slow stretch steps the scale down by 0.1 and never below the floor', () => {
  const rig = new Rig(1, 1);
  rig.run(10, HZ60);
  rig.run(40, SLOW);
  assert.deepEqual(rig.changes.map((c) => c.scale), [0.9, 0.8, 0.7, 0.6, SCALE_FLOOR]);
  for (let i = 1; i < rig.changes.length; i++) assert.ok(rig.changes[i].at - rig.changes[i - 1].at >= 2.4, 'a settle and a full window between steps');
  rig.run(30, SLOW);
  assert.equal(rig.ctl.scale, SCALE_FLOOR);
  assert.equal(rig.changes.length, 5);
});

test('the floor clamps a step that would pass it', () => {
  const rig = new Rig(0.7, 0.9);
  rig.run(4, HZ60); // two calm windows: the display is known, no raise is due yet
  rig.run(20, SLOW);
  assert.deepEqual(rig.changes.map((c) => c.scale), [0.6, SCALE_FLOOR]);
});

test('a start that is slow from the first frame still lowers (the estimate is clamped, not the machine)', () => {
  const rig = new Rig(1, 1);
  const first = rig.until(10, SLOW);
  assert.equal(first.scale, 0.9);
  assert.ok(first.at < 2.5);
});

test('after the stretch it climbs back one 0.05 step per calm period, up to the top', () => {
  const rig = new Rig(1, 1);
  rig.run(10, HZ60);
  rig.run(30, SLOW);
  assert.equal(rig.ctl.scale, SCALE_FLOOR);
  const from = rig.changes.length;
  rig.run(100, HZ60, { jitter: 0.3 });
  const up = rig.changes.slice(from);
  assert.deepEqual(up.map((c) => c.scale), [0.6, 0.65, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95, 1]);
  for (let i = 1; i < up.length; i++) {
    const gap = up[i].at - up[i - 1].at;
    assert.ok(gap >= 6 && gap <= 7, `step ${i} came after ${gap} s`);
  }
  rig.run(30, HZ60);
  assert.equal(rig.ctl.scale, 1);
});

test('below the top quality the climb stops at 0.9', () => {
  const rig = new Rig(0.7, 0.9);
  rig.run(80, HZ60);
  assert.deepEqual(rig.changes.map((c) => c.scale), [0.75, 0.8, 0.85, 0.9]);
});

test('a raise followed by drops is undone, and the next try waits twice as long', () => {
  const rig = new Rig(0.8, 1);
  const raise = rig.until(20);
  assert.equal(raise.scale, 0.85);
  const undo = rig.until(10, HZ60, { slowEvery: 10 }); // 10 % of the frames dropped
  assert.equal(undo.scale, 0.8);
  const again = rig.until(40);
  assert.equal(again.scale, 0.85);
  const wait = again.at - undo.at;
  assert.ok(wait >= 12 && wait <= 13.5, `waited ${wait} s`);
  // this one holds: the calm period is back to 6 s
  const next = rig.until(20);
  assert.equal(next.scale, 0.9);
  assert.ok(next.at - again.at >= 6 && next.at - again.at <= 7, `waited ${next.at - again.at} s`);
});

test('a few drops in the first window are enough to undo a raise', () => {
  const rig = new Rig(0.8, 1);
  rig.until(20);
  assert.equal(rig.until(10, HZ60, { slowEvery: 40 }).scale, 0.8); // 2.5 %: not enough to lower, enough to undo
});

test('the wait doubles on each failed raise, up to 60 s, and a raise that holds resets it', () => {
  const rig = new Rig(0.8, 1);
  const waits: number[] = [];
  rig.until(20);
  for (let k = 0; k < 6; k++) {
    const undo = rig.until(10, HZ60, { slowEvery: 10 });
    const raise = rig.until(80);
    assert.equal(raise.scale, 0.85);
    waits.push(raise.at - undo.at);
  }
  const needed = [12, 24, 48, 60, 60, 60];
  waits.forEach((w, i) => assert.ok(w >= needed[i] && w <= needed[i] + 1.5, `wait ${i}: ${w} s, wanted ${needed[i]}`));
  const next = rig.until(20); // the last raise held
  assert.equal(next.scale, 0.9);
  assert.ok(next.at - rig.changes[rig.changes.length - 2].at <= 7);
});

test('the resize hitch right after a change does not count against it', () => {
  const rig = new Rig(0.8, 1);
  const raise = rig.until(20);
  rig.frame(50);
  rig.frame(50);
  rig.frame(50);
  rig.run(20, HZ60);
  assert.equal(rig.changes[1].scale, 0.9, 'the raise held and the next one followed');
  assert.ok(rig.changes.every((c) => c.scale >= raise.scale));
  // and the same after a lowering
  const low = new Rig(1, 1);
  low.run(10, HZ60);
  low.until(10, SLOW);
  low.frame(50);
  low.frame(50);
  low.run(4, HZ60);
  assert.equal(low.changes.length, 1);
});

test('144 Hz and 120 Hz are not mistaken for drops, and a raise is still earned', () => {
  for (const hz of [HZ144, HZ120]) {
    const rig = new Rig(0.8, 1);
    rig.run(5.5, hz, { jitter: 0.15 });
    assert.deepEqual([...rig.changes], []);
    assert.ok(Math.abs(rig.ctl.interval - hz) < 0.5, `interval ${rig.ctl.interval}`);
    rig.run(20, hz, { jitter: 0.15 });
    assert.ok(rig.changes.length >= 2);
    assert.ok(rig.changes.every((c, i) => c.scale === Math.round((0.8 + 0.05 * (i + 1)) * 100) / 100), 'only raises, one step each');
    assert.ok(rig.changes[0].at >= 5.9 && rig.changes[0].at <= 6.6, `first raise at ${rig.changes[0].at} s`);
  }
});

test('at 144 Hz, doubling the frame time lowers the scale', () => {
  const rig = new Rig(1, 1);
  rig.run(10, HZ144);
  assert.deepEqual([...rig.changes], []);
  rig.run(6, 2 * HZ144); // 13.9 ms: fine at 60 Hz, a missed frame at 144 Hz
  assert.deepEqual(rig.changes.map((c) => c.scale), [0.9, 0.8]);
  assert.ok(rig.ctl.interval < 8, 'the slow stretch did not become the display interval');
});

test('during a hold nothing changes, and the held frames are ignored afterwards', () => {
  const held = new Rig(1, 1);
  held.run(10, HZ60);
  held.ctl.hold(5);
  held.run(5, SLOW);
  held.run(30, HZ60);
  assert.deepEqual([...held.changes], []);
  assert.ok(Math.abs(held.ctl.interval - HZ60) < 0.5);
  // the same frames without the hold do lower the scale
  const free = new Rig(1, 1);
  free.run(10, HZ60);
  free.run(5, SLOW);
  assert.ok(free.changes.length >= 2);
});

test('calm time only builds after a hold expires', () => {
  const rig = new Rig(0.8, 1);
  rig.ctl.hold(8);
  const raise = rig.until(30);
  assert.equal(raise.scale, 0.85);
  assert.ok(raise.at >= 13.9 && raise.at <= 15, `raised at ${raise.at} s`);
});

test('a hold does not erase the trial of a raise made just before it', () => {
  const rig = new Rig(0.8, 1);
  rig.until(20);
  rig.ctl.hold(5);
  rig.run(5, SLOW);
  assert.equal(rig.changes.length, 1, 'nothing changed during the hold');
  assert.equal(rig.until(10, HZ60, { slowEvery: 10 }).scale, 0.8, 'the first full window after the hold judged the raise');
});

test('a hold after a raise that then holds lets the climb go on', () => {
  const rig = new Rig(0.8, 1);
  const raise = rig.until(20);
  rig.ctl.hold(5);
  rig.run(5, SLOW);
  const next = rig.until(20);
  assert.equal(next.scale, 0.9);
  assert.ok(next.at - raise.at >= 10.9 && next.at - raise.at <= 12.5, `${next.at - raise.at} s after the first raise`);
});

test('overlapping holds take the longer one and do not add up', () => {
  const rig = new Rig(1, 1);
  rig.run(10, HZ60);
  const t0 = rig.now / 1000;
  rig.ctl.hold(3);
  rig.run(1, SLOW);
  rig.ctl.hold(3); // 2 s were left: the hold now runs 3 s more, to t0 + 4
  const lower = rig.until(20, SLOW);
  assert.equal(lower.scale, 0.9);
  assert.ok(lower.at - t0 >= 5.9 && lower.at - t0 <= 6.6, `lowered ${lower.at - t0} s after the first hold`);
});

test('a hold of nothing or less is ignored', () => {
  const rig = new Rig(1, 1);
  rig.run(10, HZ60);
  rig.ctl.hold(0);
  rig.ctl.hold(-3);
  rig.ctl.hold(Number.NaN);
  assert.equal(rig.until(10, SLOW).scale, 0.9);
});
