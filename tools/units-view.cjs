// A render of the textured building units of buildings.glb, in the game's own shader, against the sky: for reviewing the
// units themselves (their forms, windows and weathering) apart from the city. Needs a running build (BASE_URL).
//   BASE_URL=http://localhost:4191/ node tools/units-view.cjs <out.png> [--lod 0|1] [--cols 6] [--from 0] [--count 24] [--pitch 62] [--query "&bgtune=..."] [name ...]
// Without names it shows `count` units of the table from `from` on. The units stand in rows at the play area's height, lit
// as the city is; the haze and the distance tone are put out of reach (everything is shown as a near building).
const path = require('node:path');
const { launch } = require(path.join(__dirname, '..', 'tests', 'e2e', 'browser.cjs'));

const args = process.argv.slice(2);
const out = args.shift();
const opt = { lod: 0, cols: 6, from: 0, count: 24, pitch: 62, query: '' };
const names = [];
while (args.length) {
  const a = args.shift();
  if (a.startsWith('--')) opt[a.slice(2)] = a === '--query' ? args.shift() : Number(args.shift());
  else names.push(a);
}
if (!out) {
  console.error('usage: units-view.cjs <out.png> [--lod 0|1] [--cols n] [--from n] [--count n] [--pitch m] [--query "&..."] [name ...]');
  process.exit(2);
}

(async () => {
  const BASE = process.env.BASE_URL ?? 'http://localhost:4173/';
  const browser = await launch();
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  page.setDefaultTimeout(180000);
  page.on('console', (m) => {
    if (m.type() === 'error') console.error(`page: ${m.text()}`);
  });
  await page.goto(`${BASE}?shots=1&debug=1&bgtune=density:0.00001,tail:100000,calmNear:90000,calmFar:99000,winNear:90000,winFar:99000${opt.query}`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__shots && window.__shots.ready(), null, { timeout: 90000 });
  await page.evaluate(() => window.__shots.show('s1-overview'));
  const shown = await page.evaluate(({ names, opt }) => {
    const game = window.__fold.game;
    const city = game.city;
    const mesh = city.mesh;
    // which geometry is which unit: from the buildings that show them
    const geo = new Map();
    for (const it of city.items) (it.units ?? []).forEach((u, si) => u && geo.set(u.name, it.geometry[si]));
    for (const it of city.items) mesh.setVisibleAt(it.id, false);
    for (const s of city.sky) mesh.setVisibleAt(s.id, false);
    for (const o of game.engine.scene.children) if (o !== city.group) o.visible = false;
    for (const o of city.group.children) if (o !== mesh) o.visible = false;
    const list = (names.length ? names : [...geo.keys()].sort().slice(opt.from, opt.from + opt.count)).filter((n) => geo.has(n));
    const M = mesh.matrixWorld.constructor;
    const m = new M();
    const rows = Math.ceil(list.length / opt.cols);
    list.forEach((name, k) => {
      const it = city.items[k];
      const col = k % opt.cols;
      const row = Math.floor(k / opt.cols);
      mesh.setGeometryIdAt(it.id, geo.get(name)[opt.lod]);
      m.makeRotationY(-0.5).setPosition((col - (opt.cols - 1) / 2) * opt.pitch, 5, (row - (rows - 1) / 2) * opt.pitch * 0.9 - 7.5);
      mesh.setMatrixAt(it.id, m);
      mesh.setVisibleAt(it.id, true);
    });
    const cam = game.engine.camera;
    const span = Math.max(opt.cols * opt.pitch, rows * opt.pitch * 1.9);
    cam.fov = 24;
    cam.near = 5;
    cam.far = 9000;
    cam.position.set(0, 5 + span * 0.72, -7.5 + span * 1.14);
    cam.lookAt(0, 18, -7.5);
    cam.updateProjectionMatrix();
    game.engine.render(0);
    return list;
  }, { names, opt });
  await page.screenshot({ path: out });
  await browser.close();
  console.log(`${out}: ${shown.join(' ')}`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
