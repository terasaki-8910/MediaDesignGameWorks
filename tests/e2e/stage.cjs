// The stage as the game compiles it, for the e2e scripts: what a player who solves each puzzle has, from the solver itself, so a
// script never repeats the cells and keys of a solution (a changed puzzle changes what it does, not whether it still passes).
// The core is TypeScript run by Node's own type stripping (as `npm test` does), so it is loaded with import().
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const root = path.resolve(__dirname, '..', '..');
const core = (name) => import(pathToFileURL(path.join(root, 'src', 'core', `${name}.ts`)).href);

/**
 * `cs` is the compiled stage; `tunables` the tunables; `sections[i]` has `id`, `start` (the puzzle state a player brings to
 * section i after solving those before it), `startCell` (the key of its checkpoint), `exit` (the key of its first exit cell),
 * `plan` (the optimal console actions in order, each `{ console, key, cell }`) and `firstMoves` (what each fold open at the start
 * costs beyond the optimum: `{ key, penalty }`); `solved` is the state after every section; `apply(state, action)`, `path(state,
 * from, to)` (the cells to walk through, from excluded), `regionOf(state, cell)`, `cellOf(console)` and `fold(state, console, key)` are the core's own.
 */
async function loadStage() {
  const { CompiledStage, actionKey, walkPath } = await core('compile');
  const { solveSection } = await core('solver');
  const { cellKey } = await core('math');
  const { validateStage } = await core('validate');
  const stage = JSON.parse(fs.readFileSync(path.join(root, 'src/stages/area1.json'), 'utf8'));
  const tunables = JSON.parse(fs.readFileSync(path.join(root, 'src/stages/tunables.json'), 'utf8'));
  const cs = new CompiledStage(stage);
  const report = validateStage(stage);
  const sections = [];
  let state = cs.initialState();
  for (const sec of stage.sections) {
    const startCell = cellKey(stage.checkpoints.find((c) => c.id === sec.start).at);
    const r = solveSection(cs, sec.id, { state, cell: startCell });
    sections.push({
      id: sec.id,
      groups: sec.groups,
      consoles: sec.consoles,
      start: state,
      startCell,
      exit: cellKey(sec.exit[0]),
      optimal: r.optimal,
      plan: r.plan.map((a) => ({ console: a.console, key: actionKey(a), cell: cellKey(cs.consoles.get(a.console).at), action: a })),
      firstMoves: report.sections[sec.id].firstMoves,
    });
    for (const a of r.plan) state = cs.apply(state, a);
  }
  return {
    cs,
    stage,
    tunables,
    sections,
    solved: state,
    apply: (s, a) => cs.apply(s, a),
    path: (s, from, to) => walkPath(cs.walkMap(s), from, [to]),
    regionOf: (s, cell) => cs.walkMap(s).region.get(cell),
    /** The key of the cell a console stands on. */
    cellOf: (id) => cellKey(cs.consoles.get(id).at),
    /** The state after the fold `key` (like 'c1:set1') at a console, from a state; throws when the console does not offer it or it is blocked. */
    fold(s, consoleId, key) {
      const o = cs.consoleActions(consoleId, s).find((x) => actionKey(x.action) === key);
      if (!o || o.blockedBy.length) throw new Error(`${key} is not a free fold of ${consoleId}`);
      return cs.apply(s, o.action);
    },
    /** The patch of group states that a section's own groups have once it is solved (the state the next section starts from, for those groups). */
    solvedGroups(i) {
      const next = i + 1 < sections.length ? sections[i + 1].start : state;
      return Object.fromEntries(sections[i].groups.map((g) => [g, next[g]]));
    },
  };
}

/** `x,y,z` for a cell. */
const cellArray = (key) => key.split(',').map(Number);

module.exports = { loadStage, cellArray };
