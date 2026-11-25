// E2E check of the keyboard and dialog behaviour of the HUD with real key events (the other e2e tests drive the game
// through its debug hooks, which never touch the DOM focus): the title's initial focus and Tab order, the focus ring,
// Space to start, the controls panel and the settings dialog from the title, the pause dialog closed by Escape and by a
// click on the backdrop, focus return, and the extra UI shots of `?shots=1&ui=1`.
// Needs a running build: `npm run build && npm run preview` (or set BASE_URL to a deployment).
// The e2e job of .github/workflows/ci.yml runs this (Linux, software WebGL); locally, install the browser once with `npx playwright install chromium`.
const assert = require('node:assert/strict');
const { describeBackend, launch } = require('./browser.cjs');
const { blankReason, decodePng, frameStats } = require('./png.cjs');

const UI_IDS = ['ui-fold', 'ui-fold-blocked', 'ui-hint', 'ui-pause', 'ui-controls', 'ui-clear'];

(async () => {
const BASE = process.env.BASE_URL ?? 'http://localhost:4173/';
const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.setDefaultTimeout(180000);
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(`${BASE}?debug=1&q=low`, { waitUntil: 'load' });
await page.waitForFunction(() => !!window.__fold, null, { timeout: 60000 });
// Start is disabled and reads 読み込み中… until the scene has loaded, then takes the focus
await page.waitForFunction(() => { const b = document.querySelector('.btn.primary'); return !!b && !b.disabled; }, null, { timeout: 60000 });
console.log(`ui: ${await describeBackend(browser, page)}`);
const F = (fn, ...a) => page.evaluate(fn, ...a);
const focused = () => F(() => {
  const e = document.activeElement;
  const cs = e ? getComputedStyle(e) : null;
  return {
    text: e?.textContent?.trim() ?? '',
    type: e?.getAttribute?.('type') ?? '',
    tag: e?.tagName ?? '',
    cls: e?.className ?? '',
    ring: cs ? `${cs.outlineStyle} ${cs.outlineWidth} ${cs.outlineColor}` : '',
  };
});
const RING = 'solid 2px rgb(95, 242, 255)';
const shown = (sel) => F((s) => !!document.querySelector(`${s}.show`), sel);

// title: the start button has the focus, Tab goes start -> 操作方法 -> 設定 -> consent, every stop shows the ring
let f = await focused();
assert.equal(f.text, '歩きはじめる', 'the start button has the initial focus');
assert.ok(/primary/.test(f.cls));
const order = [];
for (let i = 0; i < 3; i++) {
  await page.keyboard.press('Tab');
  f = await focused();
  order.push(f.type === 'checkbox' ? 'consent' : f.text);
  assert.equal(f.ring, RING, `a focus ring on ${order.at(-1)}`);
}
assert.deepEqual(order, ['操作方法', '設定', 'consent'], 'Tab order after the start button');
await page.keyboard.press('Shift+Tab');
await page.keyboard.press('Shift+Tab');
assert.equal((await focused()).text, '操作方法', 'Shift+Tab goes back');

// controls panel: Enter opens it, focus moves in and stays in, Escape closes it and focus returns
await page.keyboard.press('Enter');
assert.ok(await shown('.modal'), 'Enter on 操作方法 opens the key list');
assert.equal((await focused()).text, '閉じる', 'focus moves into the dialog');
await page.keyboard.press('Tab');
await page.keyboard.press('Tab');
assert.equal((await focused()).text, '閉じる', 'Tab stays inside the dialog');
await page.keyboard.press('Escape');
assert.ok(!(await shown('.modal')), 'Escape closes the key list');
assert.equal((await focused()).text, '操作方法', 'focus returns to the button that opened it');
assert.equal(await F(() => window.__fold.mode()), 'title', 'the game is still on the title');
// ... and a click on the backdrop closes it too
await page.keyboard.press('Enter');
assert.ok(await shown('.modal'));
await page.mouse.click(8, 8);
assert.ok(!(await shown('.modal')), 'a click on the backdrop closes the key list');

// settings from the title: two changes in a row both stick, the consent box follows, Escape closes
await page.keyboard.press('Tab');
assert.equal((await focused()).text, '設定');
await page.keyboard.press('Enter');
assert.ok(await shown('.modal'), 'Enter on 設定 opens the settings');
assert.equal(await F(() => document.querySelector('.modal.show h2').textContent), '設定');
const consentBefore = await F(() => document.querySelector('.consent input').checked);
await F(() => {
  const rows = [...document.querySelectorAll('.modal.show .row')];
  const click = (label) => rows.find((r) => r.textContent.includes(label)).querySelector('input').click();
  click('上下反転');
  click('ミュート');
  click('プレイデータを送信する');
});
const saved = await F(() => JSON.parse(localStorage.getItem('fold-city:settings')));
assert.equal(saved.invertY, true, 'the first change is kept after the second');
assert.equal(saved.muted, true);
assert.equal(saved.telemetry, !consentBefore);
assert.equal(await F(() => document.querySelector('.consent input').checked), !consentBefore, 'the title consent box shows the setting');
await page.keyboard.press('Escape');
assert.ok(!(await shown('.modal')));
assert.equal((await focused()).text, '設定', 'focus returns to 設定');
await F(() => localStorage.removeItem('fold-city:settings'));

// Space on the start button starts the game and hands the keys back to the game
await page.keyboard.press('Shift+Tab');
assert.equal((await focused()).text, '操作方法');
await page.keyboard.press('Shift+Tab');
assert.equal((await focused()).text, '歩きはじめる');
await page.keyboard.press('Space');
await page.waitForFunction(() => window.__fold.mode() === 'play');
assert.equal((await focused()).tag, 'BODY', 'nothing keeps the focus once the game runs');
assert.equal(await F(() => document.querySelector('.title').inert), true, 'the fading title takes no focus');

// pause: opened through the game (the Escape that leaves pointer lock is not delivered to the page), closed by Escape in
// the dialog and by a click on the backdrop; it must stay closed, not fall back into pause on the next frame
for (const how of ['key', 'backdrop']) {
  await F(() => window.__fold.press('Escape'));
  await page.waitForFunction(() => window.__fold.mode() === 'pause');
  assert.ok(await shown('.modal'), 'the pause dialog is up');
  assert.equal((await focused()).text, '再開', 'focus is in the pause dialog');
  if (how === 'key') await page.keyboard.press('Escape');
  else await page.mouse.click(8, 8);
  await page.waitForTimeout(600);
  assert.equal(await F(() => window.__fold.mode()), 'play', `${how}: the game resumed and did not fall back into pause`);
  assert.ok(!(await shown('.modal')));
}
assert.deepEqual(errors, []);

// the UI shots
const shots = await browser.newPage({ viewport: { width: 1280, height: 720 } });
shots.setDefaultTimeout(180000);
shots.on('pageerror', (e) => errors.push(e.message));
await shots.goto(`${BASE}?shots=1&ui=1`, { waitUntil: 'load' });
await shots.waitForFunction(() => window.__shots && window.__shots.ready(), null, { timeout: 60000 });
const list = await shots.evaluate(() => window.__shots.list());
assert.deepEqual(list.slice(8).map((s) => s.id), UI_IDS, 'the UI shots follow the eight art shots');
assert.equal(list.length, 8 + UI_IDS.length);
for (const id of UI_IDS) {
  await shots.evaluate((i) => window.__shots.show(i), id);
  const stats = frameStats(decodePng(await shots.screenshot()));
  assert.equal(blankReason(stats), null, `${id} is not a blank frame`);
}
// the art shots keep the HUD hidden, also right after a UI shot
await shots.evaluate(() => window.__shots.show('s1-play'));
assert.equal(await shots.evaluate(() => getComputedStyle(document.getElementById('hud')).display), 'none', 'no HUD in an art shot');
await browser.close();
assert.deepEqual(errors, []);
console.log(`e2e ui: ok (title focus and Tab order, dialogs, pause by Escape and backdrop, ${UI_IDS.length} UI shots)`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
