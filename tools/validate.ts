// Validates every stage and the tunables, or the stage files named on the command line (then the tunables are not
// checked: they belong to the stages in src/stages). Exit code 1 on any error. `--json` prints the full report.
//   npm run validate
//   npm run validate -- tests/fixtures/proto-core.json
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tunableErrors, type Tunables } from '../src/core/tunables.ts';
import type { StageFile } from '../src/core/types.ts';
import { validateStage, type StageReport } from '../src/core/validate.ts';
import { DEFAULT_STAGE_ID } from '../src/game/stageSelect.ts';

export function validateAll(root = '.'): { reports: StageReport[]; tunableIssues: string[]; ok: boolean } {
  const dir = join(root, 'src/stages');
  const stages = readdirSync(dir)
    .filter((f) => f.endsWith('.json') && f !== 'tunables.json')
    .map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')) as StageFile);
  const reports = stages.map((s) => validateStage(s));
  const tunables = JSON.parse(readFileSync(join(dir, 'tunables.json'), 'utf8')) as Tunables;
  // The tunables belong to the stage the improvement loop tunes (the default one). A section of another stage, a prototype,
  // plays with the defaults (src/game/stageSelect.ts) unless it has an entry, and an entry it has is checked all the same.
  const tuned = (s: StageFile) => s.stageId === DEFAULT_STAGE_ID;
  const tunableIssues = tunableErrors(
    tunables,
    stages.flatMap((s) => s.sections.map((x) => x.id).filter((id) => tuned(s) || id in tunables.sections)),
  );
  return { reports, tunableIssues, ok: reports.every((r) => r.ok) && tunableIssues.length === 0 };
}

/** The given stage files only (no tunables). */
export function validateFiles(paths: string[]): { reports: StageReport[]; tunableIssues: string[]; ok: boolean } {
  const reports = paths.map((p) => validateStage(JSON.parse(readFileSync(p, 'utf8')) as StageFile));
  return { reports, tunableIssues: [], ok: reports.every((r) => r.ok) };
}

if (import.meta.main) {
  const paths = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const { reports, tunableIssues, ok } = paths.length ? validateFiles(paths) : validateAll();
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify({ ok, reports, tunableIssues }, null, 2));
  } else {
    for (const r of reports) {
      console.log(`${r.stageId}@${r.version}: ${r.ok ? 'OK' : 'FAILED'}`);
      for (const [id, m] of Object.entries(r.sections)) {
        const fm = m.firstMoves.map((f) => `${f.key}${f.penalty === null ? '(x)' : f.penalty ? `(+${f.penalty})` : '(best)'}`).join(' ');
        // the v0.5 counts are shown only when the plan has any, so stages without the new mechanics print as they always did
        const v05 = m.waits || m.links || m.rides ? ` waits=${m.waits} links=${m.links} rides=${m.rides}` : '';
        console.log(`  ${id}: optimal=${m.optimal} states=${m.explored} deadEnds=${m.deadEnds}${v05} firstMoves: ${fm}`);
      }
      for (const i of r.issues) console.log(`  [${i.level} ${i.rule}] ${i.message}`);
    }
    for (const t of tunableIssues) console.log(`  [error tunables] ${t}`);
  }
  process.exit(ok ? 0 : 1);
}
