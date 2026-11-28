// Walking in the e2e scripts that drive the game through its debug hooks (?debug=1): the shortest route over the walk map to a
// cell, steered like the demo does it (the game's `steer`, stepped without drawing), so no script teleports through a puzzle that
// is not solved: a cell that cannot be walked to makes it throw. (playthrough.cjs plays with the real keys and the mouse instead.)

/** Defines `window.__walkTo(cell)` in the page; it returns the seconds it took (game time), or throws when the cell is out of reach. */
async function installWalker(page) {
  await page.evaluate(() => {
    const SIDES = [['N', 0, -1], ['E', 1, 0], ['S', 0, 1], ['W', -1, 0]];
    window.__walkTo = (target, maxSec = 60) => {
      const f = window.__fold;
      const g = f.game;
      const next = (from) => {
        const wm = g.cs.walkMap(g.state);
        const prev = new Map([[from, null]]);
        const queue = [from];
        for (let i = 0; i < queue.length; i++) {
          const t = wm.tiles.get(queue[i]);
          if (!t) continue;
          for (const [side, dx, dz] of SIDES) {
            const k = [t.cell[0] + dx, t.cell[1], t.cell[2] + dz].join(',');
            if (!t.open[side] || !wm.tiles.has(k) || prev.has(k)) continue;
            prev.set(k, queue[i]);
            if (k === target) {
              let at = k;
              while (prev.get(at) !== from) at = prev.get(at);
              return at;
            }
            queue.push(k);
          }
        }
        return null;
      };
      const t0 = g.time;
      for (let i = 0; i < maxSec * 20 && g.player.cell !== target; i++) {
        const step = next(g.player.cell);
        if (step === null) {
          g.steer = null;
          throw new Error(`no way to ${target} from ${g.player.cell}`);
        }
        const [cx, , cz] = step.split(',').map(Number);
        const dx = cx * 4 + 2 - g.player.pos.x;
        const dz = cz * 4 + 2 - g.player.pos.z;
        const d = Math.max(Math.hypot(dx, dz), 1e-6);
        g.steer = { x: dx / d, z: dz / d };
        f.simulate(0.05);
      }
      g.steer = null;
      return g.time - t0;
    };
  });
}

/** Walk the player to the cell (a key like '-4,3,-2'); resolves with the game seconds it took. */
async function walkTo(page, cell) {
  return page.evaluate((c) => window.__walkTo(c), cell);
}

module.exports = { installWalker, walkTo };
