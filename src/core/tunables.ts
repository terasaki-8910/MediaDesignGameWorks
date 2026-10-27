// Numeric knobs the improvement loop may change, with the ranges a human allows (Tier 0).
export interface SectionTunables {
  firstHintSec: number; // seconds without progress before the next console starts pulsing
  secondHintSec: number; // seconds before the ghost path to that console is shown
  beacon: number; // 0..1 brightness of guidance lights around the section's consoles
}

export interface Tunables {
  player: { walkSpeed: number; dashMultiplier: number };
  camera: { distance: number };
  fold: { durationScale: number };
  sections: Record<string, SectionTunables>;
}

export const RANGES: Record<string, [number, number]> = {
  'player.walkSpeed': [3.5, 6.5],
  'player.dashMultiplier': [1.2, 2.0],
  'camera.distance': [5, 12],
  'fold.durationScale': [0.6, 1.4],
  'sections.*.firstHintSec': [15, 240],
  'sections.*.secondHintSec': [30, 360],
  'sections.*.beacon': [0, 1],
};

export function rangeFor(path: string): [number, number] | null {
  if (RANGES[path]) return RANGES[path];
  const parts = path.split('.');
  if (parts[0] === 'sections' && parts.length === 3) return RANGES[`sections.*.${parts[2]}`] ?? null;
  return null;
}

export function getPath(obj: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((o, k) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined), obj);
}

export function setPath(obj: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split('.');
  let o: Record<string, unknown> = obj;
  for (const k of parts.slice(0, -1)) {
    if (!o[k] || typeof o[k] !== 'object') o[k] = {};
    o = o[k] as Record<string, unknown>;
  }
  o[parts[parts.length - 1]] = value;
}

export function tunableErrors(t: Tunables, sectionIds: string[]): string[] {
  const errs: string[] = [];
  const check = (path: string) => {
    const v = getPath(t, path);
    const r = rangeFor(path);
    if (typeof v !== 'number' || !Number.isFinite(v)) errs.push(`${path} must be a number`);
    else if (r && (v < r[0] || v > r[1])) errs.push(`${path}=${v} is outside [${r[0]}, ${r[1]}]`);
  };
  for (const p of ['player.walkSpeed', 'player.dashMultiplier', 'camera.distance', 'fold.durationScale']) check(p);
  for (const id of sectionIds) {
    for (const k of ['firstHintSec', 'secondHintSec', 'beacon']) check(`sections.${id}.${k}`);
    const s = t.sections[id];
    if (s && s.secondHintSec <= s.firstHintSec) errs.push(`sections.${id}.secondHintSec must be greater than firstHintSec`);
  }
  return errs;
}
