// Variation slots: designer-approved alternatives the improvement loop may switch between (Tier 1).
import type { StageFile } from './types.ts';

/** Returns a copy of the stage with every slot's current option applied. */
export function resolveSlots(stage: StageFile): StageFile {
  const s: StageFile = structuredClone(stage);
  for (const slot of s.slots ?? []) {
    const opt = slot.options[slot.current];
    if (!opt) continue;
    if (slot.target.kind === 'console') {
      const c = s.interactables.find((c) => c.id === slot.target.id);
      if (c && opt.at) c.at = opt.at;
      if (c && opt.facing) c.facing = opt.facing;
    } else {
      const g = s.groups.find((g) => g.id === slot.target.id);
      if (g && g.kind === 'states' && typeof opt.initial === 'number') g.initial = opt.initial;
    }
  }
  return s;
}
