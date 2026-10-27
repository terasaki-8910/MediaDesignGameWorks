// `npm run ai:check` — the only command the agent may run. Checks ai/work/proposal.json without writing anything.
import { existsSync, readFileSync } from 'node:fs';
import type { Tunables } from '../../src/core/tunables.ts';
import { readHistory } from './history.ts';
import { loadStages, type Metrics } from './metrics.ts';
import { checkProposal } from './proposal.ts';

const file = process.argv[2] ?? 'ai/work/proposal.json';
const fail = (m: string) => {
  console.log(JSON.stringify({ ok: false, errors: [m] }, null, 2));
  process.exit(1);
};
if (!existsSync(file)) fail(`${file} does not exist`);
if (!existsSync('ai/work/metrics.json')) fail('ai/work/metrics.json does not exist (run npm run ai:metrics first)');
let proposal: unknown;
try {
  proposal = JSON.parse(readFileSync(file, 'utf8'));
} catch (e) {
  fail(`${file} is not valid JSON: ${(e as Error).message}`);
}
const r = checkProposal(proposal, {
  metrics: JSON.parse(readFileSync('ai/work/metrics.json', 'utf8')) as Metrics,
  stages: loadStages(),
  tunables: JSON.parse(readFileSync('src/stages/tunables.json', 'utf8')) as Tunables,
  history: readHistory(),
});
const sections = Object.fromEntries(
  (r.reports ?? []).flatMap((rep) => Object.entries(rep.sections).map(([id, m]) => [id, { optimal: m.optimal, deadEnds: m.deadEnds }])),
);
console.log(JSON.stringify({ ok: r.ok, errors: r.errors, ops: r.opLabels, solverAfterChange: sections }, null, 2));
process.exit(r.ok ? 0 : 1);
