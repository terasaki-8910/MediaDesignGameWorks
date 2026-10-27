// Validates every stage and the tunables. Exit code 1 on any error. `--json` prints the full report.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tunableErrors, type Tunables } from '../src/core/tunables.ts';
import type { StageFile } from '../src/core/types.ts';
import { validateStage, type StageReport } from '../src/core/validate.ts';

export function validateAll(root = '.'): { reports: StageReport[]; tunableIssues: string[]; ok: boolean } {
  const dir = join(root, 'src/stages');
  const stages = readdirSync(dir)
    .filter((f) => f.endsWith('.json') && f !== 'tunables.json')
    .map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')) as StageFile);
  const reports = stages.map((s) => validateStage(s));
  const tunables = JSON.parse(readFileSync(join(dir, 'tunables.json'), 'utf8')) as Tunables;
  const tunableIssues = tunableErrors(tunables, stages.flatMap((s) => s.sections.map((x) => x.id)));
  return { reports, tunableIssues, ok: reports.every((r) => r.ok) && tunableIssues.length === 0 };
}

if (import.meta.main) {
  const { reports, tunableIssues, ok } = validateAll();
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify({ ok, reports, tunableIssues }, null, 2));
  } else {
    for (const r of reports) {
      console.log(`${r.stageId}@${r.version}: ${r.ok ? 'OK' : 'FAILED'}`);
      for (const [id, m] of Object.entries(r.sections)) {
        const fm = m.firstMoves.map((f) => `${f.key}${f.penalty === null ? '(x)' : f.penalty ? `(+${f.penalty})` : '(best)'}`).join(' ');
        console.log(`  ${id}: optimal=${m.optimal} states=${m.explored} deadEnds=${m.deadEnds} firstMoves: ${fm}`);
      }
      for (const i of r.issues) console.log(`  [${i.level} ${i.rule}] ${i.message}`);
    }
    for (const t of tunableIssues) console.log(`  [error tunables] ${t}`);
  }
  process.exit(ok ? 0 : 1);
}
