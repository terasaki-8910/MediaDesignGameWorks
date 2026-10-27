// `npm run ai:apply` — deterministic application of a checked proposal. Never run by the agent.
// Writes the stage/tunable changes, bumps src/revision.json and records the run in ai/history/.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import type { Tunables } from '../../src/core/tunables.ts';
import { appendHistory, readHistory, type HistoryEntry } from './history.ts';
import { loadStages, type Metrics } from './metrics.ts';
import { checkProposal, type Proposal } from './proposal.ts';

const file = process.argv[2] ?? 'ai/work/proposal.json';
const runFile = 'ai/work/run.json';
const now = new Date();
const today = now.toISOString().slice(0, 10);
const revisionFile = 'src/revision.json';
const revision = JSON.parse(readFileSync(revisionFile, 'utf8')) as { revision: number; updated: string; recent: { date: string; summary: string }[] };
const cost = existsSync(runFile) ? safeCost(readFileSync(runFile, 'utf8')) : undefined;

function safeCost(text: string): number | undefined {
  try {
    const v = JSON.parse(text).total_cost_usd;
    return typeof v === 'number' ? v : undefined;
  } catch {
    return undefined;
  }
}

function record(e: Omit<HistoryEntry, 'runAt' | 'date' | 'revision' | 'costUsd'>, rev: number) {
  appendHistory({ runAt: now.toISOString(), date: today, revision: rev, costUsd: cost, ...e });
}

function commitMessage(title: string, body: string) {
  const run = process.env.GITHUB_RUN_ID ? `\n\nAI-Improvement-Run: ${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}` : '';
  writeFileSync('ai/work/commit-msg.txt', `${title}\n\n${body}${run}\n`);
}

function output(kv: Record<string, string>) {
  const out = process.env.GITHUB_OUTPUT;
  const text = Object.entries(kv).map(([k, v]) => `${k}=${v}`).join('\n');
  if (out) writeFileSync(out, `${text}\n`, { flag: 'a' });
  console.log(text);
}

if (!existsSync(file)) {
  record({ status: 'rejected', summary: 'no proposal was produced', ops: [], hypotheses: [], reason: 'missing proposal.json' }, revision.revision);
  commitMessage('ai: improvement run produced no proposal', 'The agent did not write ai/work/proposal.json. Nothing was changed.');
  output({ changed: 'false', status: 'rejected' });
  process.exit(0);
}
const proposal = JSON.parse(readFileSync(file, 'utf8')) as Proposal;
const r = checkProposal(proposal, {
  metrics: JSON.parse(readFileSync('ai/work/metrics.json', 'utf8')) as Metrics,
  stages: loadStages(),
  tunables: JSON.parse(readFileSync('src/stages/tunables.json', 'utf8')) as Tunables,
  history: readHistory(),
});
const hypotheses = (proposal.hypotheses ?? []).map((h) => ({ id: h.id, section: h.section, problem: h.problem, confidence: h.confidence }));
if (!r.ok) {
  record({ status: 'rejected', summary: proposal.summary ?? '', ops: r.opLabels, hypotheses, reason: r.errors.join('; ').slice(0, 1000) }, revision.revision);
  commitMessage('ai: proposal rejected by the validator', r.errors.map((e) => `- ${e}`).join('\n'));
  output({ changed: 'false', status: 'rejected' });
  process.exit(0);
}
if (proposal.noChange) {
  record({ status: 'nochange', summary: proposal.summary, ops: [], hypotheses }, revision.revision);
  commitMessage('ai: no change this run', proposal.summary);
  output({ changed: 'false', status: 'nochange' });
  process.exit(0);
}
for (const st of r.stages!) {
  const bumped = st.version.split('.').map(Number);
  bumped[2] += 1;
  st.version = bumped.join('.');
  writeFileSync(`src/stages/${st.stageId}.json`, `${JSON.stringify(st, null, 2)}\n`);
}
writeFileSync('src/stages/tunables.json', `${JSON.stringify(r.tunables, null, 2)}\n`);
const next = {
  revision: revision.revision + 1,
  updated: today,
  recent: [{ date: today, summary: proposal.summary }, ...revision.recent].slice(0, 5),
};
writeFileSync(revisionFile, `${JSON.stringify(next, null, 2)}\n`);
record({ status: 'applied', summary: proposal.summary, ops: r.opLabels, hypotheses }, next.revision);
commitMessage(
  `ai: 都市改訂 第${next.revision}版`,
  [proposal.summary, '', 'Hypotheses:', ...hypotheses.map((h) => `- ${h.id} (${h.section}, ${h.confidence}): ${h.problem}`), '', 'Ops:', ...r.opLabels.map((o) => `- ${o}`)].join('\n'),
);
output({ changed: 'true', status: 'applied', revision: String(next.revision) });
