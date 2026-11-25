// E2E check of the demo playback: it must solve every puzzle by itself, reach the finale, never send play data,
// and draw something at five fixed points (the start of each puzzle, the finale and the end), not a blank frame.
// Needs a running build: `npm run build && npm run preview` (or set BASE_URL to a deployment).
// The e2e job of .github/workflows/ci.yml runs this (Linux, software WebGL); locally, install the browser once with `npx playwright install chromium`.
const assert = require('node:assert/strict');
const { describeBackend, launch } = require('./browser.cjs');
const { blankReason, decodePng, frameStats } = require('./png.cjs');

// Where in the demo the frame is rendered and looked at: the nth cue of a type.
const POINTS = [
  { name: 'start of puzzle 1', type: 'section', n: 1 },
  { name: 'start of puzzle 2', type: 'section', n: 2 },
  { name: 'start of puzzle 3', type: 'section', n: 3 },
  { name: 'finale', type: 'finale', n: 1 },
  { name: 'end', type: 'end', n: 1 },
];

(async () => {
const BASE = process.env.BASE_URL ?? 'http://localhost:4173/';
const browser = await launch();
const page = await browser.newPage({ viewport: { width: 360, height: 640 } });
page.setDefaultTimeout(180000);
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
let sent = 0;
await page.route('**/api/telemetry', (route) => {
  sent++;
  return route.fulfill({ status: 202, body: '{"ok":true}' });
});
// telemetry=1 would switch play data on for localhost: the demo must still keep it off
await page.goto(`${BASE}?demo=1&capture=1&telemetry=1&q=low&hud=0`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__capture && window.__capture.ready(), null, { timeout: 60000 });
console.log(`demo: ${await describeBackend(browser, page)}`);

// Step without rendering (fast) until the nth cue of a type has been reached, or the demo is over.
const runTo = (type, n) =>
  page.evaluate(([t, k]) => {
    let x = { done: false, t: 0 };
    for (let i = 0; i < 30 * 240 && !x.done && window.__capture.cues().filter((c) => c.type === t).length < k; i++)
      x = window.__capture.advance(1 / 30, false);
    return x;
  }, [type, n]);
const frames = [];
for (const p of POINTS) {
  await runTo(p.type, p.n);
  const at = await page.evaluate(() => window.__capture.advance(1 / 30, true)); // one rendered frame, then look at it
  const stats = frameStats(decodePng(await page.screenshot()));
  frames.push({ ...p, t: at.t, stats });
}
const r = await page.evaluate(() => window.__capture.advance(1 / 30, false));
const cues = await page.evaluate(() => window.__capture.cues());
await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
await page.waitForTimeout(500);
await browser.close();

for (const f of frames) {
  console.log(`  ${f.name.padEnd(18)} t ${f.t.toFixed(1).padStart(6)} s  mean ${f.stats.mean.toFixed(3)}  std ${f.stats.std.toFixed(3)}`);
  assert.equal(blankReason(f.stats), null, `the frame at the ${f.name} is not blank (${blankReason(f.stats)})`);
}
assert.ok(r.done, `the demo ends by itself (stopped at ${r.t.toFixed(1)} s)`);
const count = (type) => cues.filter((c) => c.type === type).length;
assert.equal(count('section'), 3, 'all three puzzles are played');
assert.equal(count('fold'), 6, 'each puzzle with its optimal number of folds (1 + 2 + 3)');
assert.equal(count('finale'), 1);
assert.equal(sent, 0, 'the demo never sends telemetry');
assert.deepEqual(errors, []);
console.log(`demo ok: ${r.t.toFixed(1)} s, ${cues.length} cues, ${frames.length} frames checked, no telemetry`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
