// E2E check of the review shots (?shots=1): the eight shots exist in order, none is a blank frame, the same shot looks
// the same whatever was shown before, and nothing reaches the telemetry endpoint.
// Needs a running build: `npm run build && npm run preview` (or set BASE_URL to a deployment).
// The e2e job of .github/workflows/ci.yml runs this (Linux, software WebGL); locally, install the browser once with `npx playwright install chromium`.
// SHOTS_OUT=<dir> also saves the eight PNGs there, for looking at.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { describeBackend, launch } = require('./browser.cjs');
const { blankReason, decodePng, diffFraction, frameStats } = require('./png.cjs');

const IDS = ['title', 's1-overview', 's2-overview', 's3-overview', 's1-play', 's2-play', 's3-play', 'gate'];

(async () => {
const BASE = process.env.BASE_URL ?? 'http://localhost:4173/';
const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.setDefaultTimeout(180000);
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
let sent = 0;
await page.route('**/api/telemetry', (route) => {
  sent++;
  return route.fulfill({ status: 202, body: '{"ok":true}' });
});
// telemetry=1 would switch play data on for localhost, debug=1 exposes the hooks: the shots must still keep it off
await page.goto(`${BASE}?shots=1&telemetry=1&debug=1`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__shots && window.__shots.ready(), null, { timeout: 60000 });
console.log(`shots: ${await describeBackend(browser, page)}`);

const list = await page.evaluate(() => window.__shots.list());
assert.deepEqual(list.map((s) => s.id), IDS, 'the eight shots, in review order');
for (const s of list) assert.ok(typeof s.label === 'string' && s.label.length > 0, `${s.id} has a label`);
await assert.rejects(page.evaluate(() => window.__shots.show('no-such-shot')), /unknown shot/, 'an unknown id is rejected');

const take = async (id) => {
  await page.evaluate((i) => window.__shots.show(i), id);
  const buf = await page.screenshot();
  if (process.env.SHOTS_OUT) {
    fs.mkdirSync(process.env.SHOTS_OUT, { recursive: true });
    fs.writeFileSync(path.join(process.env.SHOTS_OUT, `${id}.png`), buf);
  }
  return decodePng(buf);
};

const first = {};
for (const id of IDS) {
  first[id] = await take(id);
  const stats = frameStats(first[id]);
  console.log(`  ${id.padEnd(12)} mean ${stats.mean.toFixed(3)}  std ${stats.std.toFixed(3)}`);
  assert.equal(blankReason(stats), null, `${id} is not a blank frame (${blankReason(stats)})`);
}

// The same shot must look the same whatever came before it. Compared at 2/255 per channel over every 4th pixel.
const same = (a, b, what) => {
  const d = diffFraction(a, b, 2);
  assert.ok(d < 0.001, `${what} differs in ${(d * 100).toFixed(3)} % of the pixels`);
};
const play1 = await take('s2-play');
await take('title');
const play2 = await take('s2-play');
same(play1, play2, 's2-play after the title');
same(first['s2-play'], play2, 's2-play after the first run through all shots');
same(first.title, await take('title'), 'title shown again');
same(first.gate, await take('gate'), 'gate shown again');

// The flag itself, since telemetry=1 would have enabled it on localhost: no shot may turn play data on.
assert.equal(await page.evaluate(() => window.__fold.game.telemetry.enabled), false, 'telemetry is off in shots mode');
await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
await page.waitForTimeout(500);
await browser.close();
assert.equal(sent, 0, 'the shots never send telemetry');
assert.deepEqual(errors, []);
console.log(`e2e shots: ok (${IDS.length} shots, none blank, repeatable, no telemetry)`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
