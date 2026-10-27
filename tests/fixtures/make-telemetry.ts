// Generates synthetic telemetry batches for testing the improvement loop end to end.
// These are NOT play data; they only exercise the aggregation, gate, check and apply steps.
import { mkdirSync, writeFileSync } from 'node:fs';
import type { StoredBatch } from '../../tools/ai/store.ts';

export function syntheticBatches(n = 14, seed = 7): StoredBatch[] {
  let s = seed;
  const r = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
  const uuid = () => 'xxxxxxxx-xxxx-4xxx-axxx-xxxxxxxxxxxx'.replace(/x/g, () => Math.floor(r() * 16).toString(16));
  const out: StoredBatch[] = [];
  for (let i = 0; i < n; i++) {
    const session = uuid();
    let t = 0;
    const ev: Record<string, unknown>[] = [];
    const push = (e: Record<string, unknown>) => ev.push({ t: (t += 1000 + Math.floor(r() * 4000)), ...e });
    push({ type: 'session_start', build: 'test', revision: 1, stage: 'area1@1.0.0', quality: 'medium',
      client: { browser: 'chrome', os: 'mac', lang: 'ja', screen: 'l', gpuTier: 'high' } });
    push({ type: 'section_enter', section: 's1_first_fold' });
    push({ type: 'action', section: 's1_first_fold', console: 'c1', action: 'c1:set1', ok: true, cell: '-6,3,0' });
    push({ type: 'section_clear', section: 's1_first_fold', ms: 25000 + Math.floor(r() * 20000), actions: 1, optimal: 1, hints: 0, resets: 0 });
    push({ type: 'section_enter', section: 's2_path_cube' });
    const wrong = r() < 0.55;
    push({ type: 'action', section: 's2_path_cube', console: 'c_roll', action: wrong ? 'c_roll:x180' : 'c_roll:x90', ok: true, cell: '0,3,0' });
    const samples: [number, string][] = [];
    for (let k = 0; k < 20; k++) samples.push([t + k * 2000, wrong ? '0,3,0' : '2,3,-3']);
    t += 40000;
    push({ type: 'pos', samples });
    if (wrong) push({ type: 'hint', section: 's2_path_cube', tier: 1 });
    const quits = wrong && r() < 0.35;
    if (quits) {
      push({ type: 'session_end', reason: 'pagehide', section: 's2_path_cube', cell: '0,3,0' });
    } else {
      push({ type: 'section_clear', section: 's2_path_cube', ms: (wrong ? 150000 : 60000) + Math.floor(r() * 30000), actions: wrong ? 4 : 2, optimal: 2, hints: wrong ? 1 : 0, resets: 0 });
      push({ type: 'section_enter', section: 's3_fold_gate' });
      push({ type: 'action', section: 's3_fold_gate', console: 'c_t1', action: 'c_t1:set0', ok: true, cell: '10,3,0' });
      push({ type: 'section_clear', section: 's3_fold_gate', ms: 70000 + Math.floor(r() * 40000), actions: 3, optimal: 3, hints: 0, resets: 0 });
      push({ type: 'game_clear', ms: t });
      push({ type: 'feedback', fun: 4, difficulty: wrong ? 4 : 3, clarity: wrong ? 2 : 4, text: wrong ? 'キューブで何をすればいいか分からなかった' : '折りたたまれる街がきれい' });
    }
    out.push({ v: 1, session, seq: 0, playtest: false, events: ev as unknown as StoredBatch['events'], receivedAt: new Date(Date.UTC(2026, 10, 1, 0, i)).toISOString() });
  }
  return out;
}

if (import.meta.main) {
  const dir = process.argv[2] ?? 'ai/work/fixture-telemetry';
  mkdirSync(dir, { recursive: true });
  syntheticBatches().forEach((b, i) => writeFileSync(`${dir}/batch-${i}.json`, JSON.stringify(b)));
  console.log(`wrote synthetic batches to ${dir}`);
}
