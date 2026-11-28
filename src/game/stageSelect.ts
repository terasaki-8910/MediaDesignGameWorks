// Which stage the game plays: `?stage=<id>` names a file of src/stages (area1 by default), and what a stage that is not the
// default one lacks (it has no entry in tunables.json) is filled in with the defaults here. Pure (no DOM): tests/stageSelect.test.ts
// and tools/validate.ts use it.
import type { SectionTunables } from '../core/tunables.ts';
import type { StageFile } from '../core/types.ts';

/** The stage the game plays when the URL names none (or names one that does not exist): the one the improvement loop tunes. */
export const DEFAULT_STAGE_ID = 'area1';

/** What a section without an entry in tunables.json uses (a prototype stage has none): the middle of the ranges. */
export const DEFAULT_SECTION_TUNABLES: SectionTunables = { firstHintSec: 40, secondHintSec: 100, beacon: 0.5 };

/** The tunables of a section, or the defaults when tunables.json has no entry for it. */
export function sectionTunables(sections: Readonly<Record<string, SectionTunables>>, id: string): SectionTunables {
  return sections[id] ?? DEFAULT_SECTION_TUNABLES;
}

export interface StagePick {
  stage: StageFile;
  /** The id the stage was found under (the file's name without `.json`). */
  id: string;
  /** Set when the id asked for is not a stage and the default was taken instead: for the console. */
  warning?: string;
}

/** The id of a stage file from its module path (`./stages/proto.json` is `proto`). */
export function stageIdOf(path: string): string {
  return path.replace(/^.*\//, '').replace(/\.json$/, '');
}

/**
 * Pick the stage named by `?stage=`. `files` maps a module path to its stage (tunables.json is not one: leave it out). A name
 * matches a file's name, or failing that a stage's own `stageId`. No name gives the default; an unknown one falls back to it
 * with a warning.
 */
export function pickStage(files: Readonly<Record<string, StageFile>>, wanted: string | null): StagePick {
  const byId = new Map<string, StageFile>(Object.entries(files).map(([path, stage]) => [stageIdOf(path), stage]));
  const fallback = byId.get(DEFAULT_STAGE_ID);
  if (!fallback) throw new Error(`the default stage "${DEFAULT_STAGE_ID}" is missing from src/stages`);
  if (wanted === null || wanted === '' || wanted === DEFAULT_STAGE_ID) return { stage: fallback, id: DEFAULT_STAGE_ID };
  const hit = byId.get(wanted);
  if (hit) return { stage: hit, id: wanted };
  const named = [...byId].find(([, stage]) => stage.stageId === wanted);
  if (named) return { stage: named[1], id: named[0] };
  return {
    stage: fallback,
    id: DEFAULT_STAGE_ID,
    warning: `unknown ?stage=${wanted} (known: ${[...byId.keys()].sort().join(', ')}); playing ${DEFAULT_STAGE_ID}`,
  };
}
