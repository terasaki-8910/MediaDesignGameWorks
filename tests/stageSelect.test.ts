// Which stage ?stage= picks, and what a stage with no entry in tunables.json uses (src/game/stageSelect.ts).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import type { Tunables } from '../src/core/tunables.ts';
import type { StageFile } from '../src/core/types.ts';
import { DEFAULT_SECTION_TUNABLES, DEFAULT_STAGE_ID, pickStage, sectionTunables, stageIdOf } from '../src/game/stageSelect.ts';
import { validateAll } from '../tools/validate.ts';

const load = (name: string) => JSON.parse(readFileSync(`src/stages/${name}.json`, 'utf8')) as StageFile;
const files = { './stages/area1.json': load('area1'), './stages/proto.json': load('proto') };
const tunables = JSON.parse(readFileSync('src/stages/tunables.json', 'utf8')) as Tunables;

test('no ?stage= (or area1) plays area1', () => {
  for (const wanted of [null, '', 'area1']) {
    const p = pickStage(files, wanted);
    assert.equal(p.id, DEFAULT_STAGE_ID);
    assert.equal(p.stage.stageId, 'area1');
    assert.equal(p.warning, undefined);
  }
});

test('?stage=proto plays the prototype, by the name of its file', () => {
  const p = pickStage(files, 'proto');
  assert.equal(p.id, 'proto');
  assert.equal(p.stage.stageId, 'proto');
  assert.equal(p.warning, undefined);
});

test('an unknown stage falls back to area1 with a warning that names the ones there are', () => {
  const p = pickStage(files, 'nowhere');
  assert.equal(p.stage.stageId, 'area1');
  assert.match(p.warning ?? '', /nowhere/);
  assert.match(p.warning ?? '', /area1, proto/);
});

test('a stage is found by its stageId too, and the file name is the id', () => {
  assert.equal(stageIdOf('./stages/proto.json'), 'proto');
  assert.equal(pickStage({ './stages/a.json': { ...load('proto'), stageId: 'named' }, './stages/area1.json': load('area1') }, 'named').id, 'a');
});

test('a section with no entry in tunables.json takes the defaults; one with an entry keeps it', () => {
  assert.equal(sectionTunables(tunables.sections, 'p_threads'), DEFAULT_SECTION_TUNABLES);
  assert.equal(sectionTunables(tunables.sections, 's1_first_fold'), tunables.sections.s1_first_fold);
  assert.ok(DEFAULT_SECTION_TUNABLES.secondHintSec > DEFAULT_SECTION_TUNABLES.firstHintSec);
});

test('npm run validate checks every stage of src/stages, and asks for tunables only of the stage the loop tunes', () => {
  const r = validateAll();
  assert.equal(r.ok, true);
  assert.deepEqual(r.reports.map((x) => x.stageId).sort(), ['area1', 'proto']);
  assert.deepEqual(r.tunableIssues, []);
});
