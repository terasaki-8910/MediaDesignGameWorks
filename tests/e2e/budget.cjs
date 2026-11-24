// Draw calls and triangles of every review shot, summed over all passes of a frame (Engine.frameInfo), against the
// brief's budgets. Needs a running build (BASE_URL); QUERY adds URL parameters (`city=ring`, `morph=s1-s2:0.5`).
//   BASE_URL=http://localhost:4191/ node tests/e2e/budget.cjs
const assert = require('node:assert/strict');
const { describeBackend, launch } = require('./browser.cjs');

const MAX_CALLS = 300;
const MAX_TRIANGLES = 1_350_000;

(async () => {
  const BASE = process.env.BASE_URL ?? 'http://localhost:4173/';
  const extra = process.env.QUERY ? `&${process.env.QUERY}` : '';
  const browser = await launch();
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  page.setDefaultTimeout(180000);
  await page.goto(`${BASE}?shots=1&char=1&debug=1${extra}`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__shots && window.__shots.ready(), null, { timeout: 90000 });
  console.log(`budget: ${await describeBackend(browser, page)}`);
  const multiDraw = await page.evaluate(() => !!window.__fold.game.engine.renderer.getContext().getExtension('WEBGL_multi_draw'));
  console.log(`  WEBGL_multi_draw: ${multiDraw}`);
  const list = await page.evaluate(() => window.__shots.list());
  let worst = { calls: 0, triangles: 0 };
  for (const s of list) {
    await page.evaluate((i) => window.__shots.show(i), s.id);
    const info = await page.evaluate(() => window.__fold.game.engine.frameInfo());
    console.log(`  ${s.id.padEnd(13)} calls ${String(info.calls).padStart(4)}  triangles ${String(info.triangles).padStart(8)}  textures ${info.textures}`);
    worst = { calls: Math.max(worst.calls, info.calls), triangles: Math.max(worst.triangles, info.triangles) };
  }
  await browser.close();
  console.log(`budget: worst ${worst.calls} calls (max ${MAX_CALLS}), ${worst.triangles} triangles (max ${MAX_TRIANGLES})`);
  assert.ok(worst.calls <= MAX_CALLS, `${worst.calls} draw calls`);
  assert.ok(worst.triangles <= MAX_TRIANGLES, `${worst.triangles} triangles`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
