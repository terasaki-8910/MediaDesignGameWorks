// The arc of a swing on a thread, how long it takes, and when Space may chain it into the next one (src/game/swing.ts).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Vec3 } from '../src/core/math.ts';
import { Flight, SWING, arcDip, arcPoint, chainEase, chainOpen, easeAt, easeSlope, startEase, swingSeconds } from '../src/game/swing.ts';

const near = (a: number, b: number, eps: number, what: string) => assert.ok(Math.abs(a - b) <= eps, `${what}: ${a} is not within ${eps} of ${b}`);

/** Cell middles 4 cells apart (16 m) on level floors at y 12, and one 8 m (two levels) up, one 4 m down. */
const A: Vec3 = [2, 12, 26];
const LEVEL: Vec3 = [18, 12, 26];
const UP: Vec3 = [18, 20, 26];
const DOWN: Vec3 = [18, 8, 26];

test('a swing takes 0.45 s and 0.06 s for each cell between its ends; reduceMotion makes it shorter', () => {
  near(swingSeconds(2), 0.57, 1e-9, '2 cells');
  near(swingSeconds(4), 0.69, 1e-9, '4 cells');
  near(swingSeconds(8), 0.93, 1e-9, '8 cells');
  for (const cells of [2, 4, 8]) assert.ok(swingSeconds(cells, true) < swingSeconds(cells), `${cells} cells: shorter with reduceMotion`);
});

test('the arc starts on the feet and ends exactly on the middle of the far cell, whatever the heights', () => {
  for (const b of [LEVEL, UP, DOWN]) {
    for (const opts of [{}, { reduce: true }, { ease: startEase(1.2) }, { ease: startEase(1.2), reduce: true }]) {
      assert.deepEqual(arcPoint(A, b, 0, opts), [...A], 'k = 0');
      assert.deepEqual(arcPoint(A, b, 1, opts), [...b], `k = 1 (x ${b[0]}, y ${b[1]}, ${JSON.stringify(opts)})`);
    }
    // a swing chained on in its window still ends exactly on the cell
    for (const at of [0.6, 0.8, 0.99]) assert.deepEqual(arcPoint(A, b, 1, { ease: chainEase(startEase(), at) }), [...b], `chained at ${at}`);
  }
});

test('a level swing dips below its chord by about a third of the chord, in the middle', () => {
  const dip = arcDip(A, LEVEL);
  near(dip, 16 / 3, 0.1, 'the dip over a 16 m chord');
  const mid = arcPoint(A, LEVEL, 0.5);
  near(mid[1], 12 - 16 / 3, 0.05, 'the middle of the arc');
  near(mid[0], 10, 0.05, 'in the middle of the way across');
  // a falling swing also dips (its chord is the straight line down)
  const chord = Math.hypot(16, 4);
  near(arcDip(A, DOWN), chord / 3, 0.15, 'the dip of a falling swing');
});

test('a swing that goes up is a rising arc: it never sinks below the floor it started from, and lifts over its chord', () => {
  let low = Infinity;
  for (let i = 0; i <= 400; i++) low = Math.min(low, arcPoint(A, UP, i / 400)[1]);
  assert.equal(low, A[1], 'no dip: the lowest point is the start');
  const mid = arcPoint(A, UP, 0.5);
  assert.ok(mid[1] > 16, `the middle is above the chord's middle (${mid[1]})`);
  let top = 0;
  for (let i = 0; i <= 200; i++) top = Math.max(top, arcPoint(A, UP, i / 200)[1]);
  assert.ok(top < 20 + 0.2 * Math.hypot(16, 8), 'and not by much');
});

test('the arc stays level inside the two landing cells, so it never goes down through the floor it starts on or lands on', () => {
  for (const b of [LEVEL, UP, DOWN]) {
    const run = Math.hypot(b[0] - A[0], b[2] - A[2]);
    for (let i = 0; i <= 400; i++) {
      const p = arcPoint(A, b, i / 400);
      const along = Math.hypot(p[0] - A[0], p[2] - A[2]);
      if (along <= SWING.cellHalf + 1e-9) assert.ok(p[1] >= A[1] - 1e-9, `inside the first cell, y ${p[1]} at ${along.toFixed(2)} m`);
      if (run - along <= SWING.cellHalf + 1e-9) assert.ok(p[1] >= b[1] - 1e-9, `inside the last cell, y ${p[1]} at ${along.toFixed(2)} m`);
    }
  }
});

test('the arc has no kink at the rings: the height changes smoothly where it leaves and enters the floor', () => {
  for (const b of [LEVEL, UP, DOWN]) {
    let last = arcPoint(A, b, 0);
    let worst = 0;
    let lastSlope: number | null = null;
    const n = 4000;
    for (let i = 1; i <= n; i++) {
      const p = arcPoint(A, b, i / n);
      const slope = (p[1] - last[1]) / Math.max(1e-9, p[0] - last[0]);
      if (lastSlope !== null && Number.isFinite(slope) && Number.isFinite(lastSlope)) worst = Math.max(worst, Math.abs(slope - lastSlope));
      lastSlope = slope;
      last = p;
    }
    assert.ok(worst < 0.2, `no jump in the slope along the way (${worst.toFixed(3)})`);
  }
});

test('reduceMotion flattens the arc', () => {
  assert.ok(arcDip(A, LEVEL, { reduce: true }) < arcDip(A, LEVEL) / 2.5, 'a much shallower dip');
  near(arcDip(A, LEVEL, { reduce: true }), 16 / 12, 0.05, 'a twelfth of the chord');
});

test('a swing that joins the next one keeps its speed at the join, and one that lands comes to rest', () => {
  const speed = (opts: Parameters<typeof arcPoint>[3], k: number) => {
    const e = 1e-5;
    const a = arcPoint(A, LEVEL, k - e / 2, opts);
    const b = arcPoint(A, LEVEL, k + e / 2, opts);
    return Math.hypot(b[0] - a[0], b[2] - a[2]) / e / 16; // the share of the way covered per unit of k
  };
  near(speed({}, 0.0005), 0, 0.01, 'at rest at the start');
  near(speed({}, 0.9995), 0, 0.01, 'at rest at the landing');
  near(speed({ ease: startEase(SWING.joinSpeed) }, 0.0005), SWING.joinSpeed, 0.02, 'at speed after a chain');
  near(speed({ ease: chainEase(startEase(), 0.65) }, 0.9995), SWING.joinSpeed, 0.05, 'at speed into a chain');
});

test('chaining part-way through a swing changes neither where the player is nor how fast they go, and never runs them past the landing', () => {
  const base = startEase();
  for (const at of [0.6, 0.7, 0.85, 0.97, 0.999]) {
    const e = chainEase(base, at);
    near(easeAt(e, at), easeAt(base, at), 1e-9, `where they are at ${at}`);
    near(easeSlope(e, at), easeSlope(base, at), 1e-6, `how fast at ${at}`);
    assert.equal(easeAt(e, 1), 1, 'arrives exactly');
    let last = easeAt(e, at);
    for (let i = 0; i <= 500; i++) {
      const u = easeAt(e, at + ((1 - at) * i) / 500);
      assert.ok(u >= last - 1e-12 && u <= 1 + 1e-12, `${at}: monotone and never past the landing (${u})`);
      last = u;
    }
  }
  // and the earlier it is chained, the more of the join speed it arrives with
  assert.ok(easeSlope(chainEase(base, 0.62), 1) > easeSlope(chainEase(base, 0.97), 1));
});

test('a swing in flight: it follows the arc in time, lands on the far cell, and hands its speed to the next swing when chained', () => {
  const f = new Flight(A, LEVEL, swingSeconds(4), {});
  assert.equal(f.open, false);
  f.advance(swingSeconds(4) * 0.5);
  assert.equal(f.chain(), false, 'Space before the window does nothing');
  f.advance(swingSeconds(4) * 0.2);
  assert.equal(f.open, true);
  const where = f.point();
  assert.equal(f.chain(), true, 'Space in the window chains it');
  assert.deepEqual(f.point(), where, 'without moving the player');
  assert.equal(f.chain(), false, 'once');
  assert.ok(f.carry > 0, 'it arrives at speed');
  f.advance(10);
  assert.equal(f.done, true);
  assert.deepEqual(f.point(), [...LEVEL], 'on the middle of the far cell');
  // the next swing leaves at that speed
  const next = new Flight(LEVEL, [34, 12, 26], swingSeconds(4), { speed: f.carry });
  near(easeSlope(next.ease, 0) * 16 / swingSeconds(4), f.carry, 0.01, 'the speed carried over, in metres per second');
  // a swing that was not chained comes to rest
  const plain = new Flight(A, LEVEL, swingSeconds(4), {});
  plain.advance(10);
  assert.equal(plain.carry, 0);
});

test('a swing that starts partway across its cell leaves the floor at the cell\'s edge', () => {
  // the player stands 1 m from the middle towards the far cell: 1 m to the edge, not 2
  const from: Vec3 = [3, 12, 26];
  const early = arcPoint(from, LEVEL, 0.3, { leave: 1 });
  const normal = arcPoint(from, LEVEL, 0.3);
  assert.ok(early[1] < normal[1], 'it has begun to dip sooner');
  assert.deepEqual(arcPoint(from, LEVEL, 0, { leave: 1 }), [...from]);
  assert.deepEqual(arcPoint(from, LEVEL, 1, { leave: 1 }), [...LEVEL]);
});

test('Space continues a swing only in its last 40 %', () => {
  assert.equal(chainOpen(0), false);
  assert.equal(chainOpen(0.59), false);
  assert.equal(chainOpen(0.6), true);
  assert.equal(chainOpen(0.99), true);
});
