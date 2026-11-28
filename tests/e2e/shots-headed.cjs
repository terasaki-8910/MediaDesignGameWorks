// E2E check of the review shots in a real, visible Chrome window with the browser's default graphics backend (no
// --use-angle flag). A render scale other than 1 (quality low is 0.6, medium 0.9) turned frames white in headless Chrome
// on Windows with its default backend; here every quality is drawn at three device pixel ratios and looked at.
// `npm run e2e:headed` opens windows, so it is not part of `npm run e2e`.
// Needs a running build: `npm run build && npm run preview` (or set BASE_URL to a deployment).
// Uses Playwright's bundled Chromium (`npx playwright install chromium`); installed Google Chrome only if that is missing.
const assert = require('node:assert/strict');
const { launch } = require('./browser.cjs');
const { blankReason, decodePng, frameStats } = require('./png.cjs');

const VIEWPORT = { width: 1280, height: 720 };
const RATIOS = [1, 1.25, 1.5];
const QUALITIES = { low: 0.6, medium: 0.9, high: 1 }; // the render scale each quality starts with
const SHOTS = ['s1-play', 's2-overview'];
// Window creation sometimes fails on this machine ("Error creating WebGL context", or the game's context is lost). A run
// is started again only when the game itself never got a live WebGL context, and every retry is printed and counted.
// A frame drawn blank while the game's own context is alive is a failure, never a retry.
const ATTEMPTS = 4;

async function launchHeaded() {
  try {
    return { browser: await launch({ headless: false }), which: "Playwright's bundled Chromium" };
  } catch (e) {
    if (!/Executable doesn't exist/i.test(String(e.message))) throw e;
    return { browser: await launch({ headless: false, channel: 'chrome' }), which: 'installed Google Chrome (channel chrome)' };
  }
}

(async () => {
const BASE = process.env.BASE_URL ?? 'http://localhost:4173/';
const { browser, which } = await launchHeaded();
console.log(`shots-headed: ${which} ${browser.version()}, headed, default backend`);
const errors = [];
let described = false;
let retries = 0;

/** One window at a pixel ratio and quality: { ok: true }, or { retry: reason } when the game had no live WebGL context. */
async function runOnce(ratio, q, scale) {
  const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: ratio });
  try {
    const page = await context.newPage();
    page.setDefaultTimeout(120000);
    const pageErrors = [];
    page.on('pageerror', (e) => pageErrors.push(e.message));
    await page.goto(`${BASE}?shots=1&q=${q}&debug=1`, { waitUntil: 'load' });
    if (!(await page.evaluate(() => !!window.__shots))) {
      const why = pageErrors.join('; ') || 'the game did not start';
      if (/WebGL/.test(why)) return { retry: `the game got no WebGL context (${why})` };
      throw new Error(why);
    }
    await page.waitForFunction(() => window.__shots.ready(), null, { timeout: 60000 });
    const lost = () => page.evaluate(() => window.__fold.game.engine.renderer.getContext().isContextLost());
    if (await lost()) return { retry: "the game's WebGL context was lost before the first shot" };
    if (!described) {
      const gl = await page.evaluate(() => {
        const c = window.__fold.game.engine.renderer.getContext();
        const ext = c.getExtension('WEBGL_debug_renderer_info');
        return String(c.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : c.RENDERER));
      });
      console.log(`shots-headed: the game's WebGL: ${gl}`);
      described = true;
    }
    const hook = await page.evaluate(() => ({ dpr: window.devicePixelRatio, scale: window.__fold.game.engine.renderScale }));
    assert.equal(hook.dpr, ratio, 'the window has the requested device pixel ratio');
    assert.equal(hook.scale, scale, `quality ${q} starts at render scale ${scale}`);
    for (const id of SHOTS) {
      await page.evaluate((i) => window.__shots.show(i), id);
      const png = decodePng(await page.screenshot());
      assert.equal(png.width, Math.round(VIEWPORT.width * ratio), 'the screenshot has the full device resolution');
      const stats = frameStats(png);
      console.log(`  ${ratio}x ${q.padEnd(6)} (scale ${scale}) ${id.padEnd(12)} mean ${stats.mean.toFixed(3)}  std ${stats.std.toFixed(3)}`);
      const reason = blankReason(stats);
      if (reason && (await lost())) return { retry: `the game's WebGL context was lost while drawing ${id} (${reason} frame)` };
      assert.equal(reason, null, `${id} at ${ratio}x, quality ${q}, render scale ${scale} is a blank frame (${reason}) with a live WebGL context`);
    }
    errors.push(...pageErrors);
    return { ok: true };
  } finally {
    await context.close();
  }
}

let runs = 0;
for (const ratio of RATIOS) {
  for (const [q, scale] of Object.entries(QUALITIES)) {
    for (let attempt = 1; ; attempt++) {
      const r = await runOnce(ratio, q, scale);
      if (r.ok) break;
      if (attempt >= ATTEMPTS) throw new Error(`no live WebGL context after ${ATTEMPTS} attempts (${ratio}x, ${q}): ${r.retry}`);
      retries++;
      console.log(`  retry ${attempt}/${ATTEMPTS - 1} (${ratio}x, ${q}): ${r.retry}`);
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
    runs++;
  }
}
await browser.close();
assert.deepEqual(errors, []);
console.log(`e2e shots-headed: ok (${runs} runs, ${SHOTS.length} shots each, none blank, ${retries} retries; ${which})`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
