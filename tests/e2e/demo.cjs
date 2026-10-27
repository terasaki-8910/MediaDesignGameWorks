// E2E check of the demo playback: it must solve every puzzle by itself, reach the finale, and never send play data.
// Needs a running build: `npm run build && npm run preview` (or set BASE_URL to a deployment).
// CI does not run this; install the browser once with `npx playwright install chromium`.
const assert = require('node:assert/strict');
const { chromium } = require('playwright');

(async () => {
const BASE = process.env.BASE_URL ?? 'http://localhost:4173/';
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
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
const r = await page.evaluate(() => {
  let x = { done: false, t: 0 };
  for (let i = 0; i < 30 * 240 && !x.done; i++) x = window.__capture.advance(1 / 30, false);
  return x;
});
const cues = await page.evaluate(() => window.__capture.cues());
await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
await page.waitForTimeout(500);
await browser.close();

assert.ok(r.done, `the demo ends by itself (stopped at ${r.t.toFixed(1)} s)`);
const count = (type) => cues.filter((c) => c.type === type).length;
assert.equal(count('section'), 3, 'all three puzzles are played');
assert.equal(count('fold'), 6, 'each puzzle with its optimal number of folds (1 + 2 + 3)');
assert.equal(count('finale'), 1);
assert.equal(sent, 0, 'the demo never sends telemetry');
assert.deepEqual(errors, []);
console.log(`demo ok: ${r.t.toFixed(1)} s, ${cues.length} cues, no telemetry`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
