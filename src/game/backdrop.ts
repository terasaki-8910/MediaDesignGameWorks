// Sky, lights and haze, and the background city: one sheet of streets and buildings folded around the play area
// (foldcity/), in a different structure for each puzzle section.
import * as THREE from 'three';
import type { VisualTheme } from '../core/types.ts';
import { FoldCity, type Background } from './foldcity/foldcity.ts';
import { MorphCity } from './foldcity/morphcity.ts';
import { parseFreeze } from './foldcity/progression.ts';
import type { KeepOut } from './foldcity/morphplan.ts';
import { STRUCTURES, type StructureName } from './foldcity/sheet.ts';
import { VARIANTS as FOLD_VARIANTS } from './foldcity/variants.ts';
import { LOOK, createSun, hazeFloor, installHaze, loadSky } from './look.ts';

/**
 * Lights, haze and the haze floor now; the HDRI sky arrives later through the returned promise (the scene shows the
 * haze colour until then). The numbers are in look.ts.
 */
export function setupEnvironment(scene: THREE.Scene, renderer: THREE.WebGLRenderer, quality: 'low' | 'medium' | 'high') {
  installHaze();
  scene.background = LOOK.hazeColor.clone();
  scene.fog = new THREE.FogExp2(LOOK.hazeColor, LOOK.hazeDistance);
  scene.add(hazeFloor());
  const sun = createSun(scene, quality);
  // `?sky=a1`: the sky variant after reference A1 (look.ts, SKY_A1)
  const variant = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('sky') : null;
  return { sun, sky: loadSky(scene, renderer, LOOK.hdri, LOOK.hdriSunU, LOOK.hdriGain, variant) };
}

export interface BackgroundOptions {
  /** `?city=<name>`: show one structure in every section (horizon, fold90, ring), or one of the earlier studies (corner, ringx, warp). */
  variant?: string | null;
  /** `?morph=s1-s2:0.5`: hold the fold from one section's structure to the next at a fraction, for review; `?morph=loop`: fold on and on. */
  morph?: string | null;
  /** Squares of sheet under the play area's piers: nothing is built there. */
  keepOut?: readonly KeepOut[];
  /** `?bgdebug=facing`: the background painted by class (ground seen roof-on, other ground, roofs, walls), for measuring; `?bgdebug=range`: by distance (beyond 200 m red, nearer green). */
  debug?: string | null;
}

/**
 * The game's background: the city that folds from section to section. The debug parameters pin it to one structure, hold a
 * fold part-way, or bring back one of the studies it grew from.
 */
export function createBackground(theme: VisualTheme, opts: BackgroundOptions = {}): Background {
  const { variant } = opts;
  if (variant && variant !== 'default' && !(STRUCTURES as readonly string[]).includes(variant)) {
    const def = FOLD_VARIANTS[variant];
    if (def) return new FoldCity(def, theme);
    console.warn(`unknown ?city=${variant} (known: ${Object.keys(FOLD_VARIANTS).join(', ')})`);
  }
  const loop = opts.morph === 'loop';
  const freeze = loop ? null : parseFreeze(opts.morph ?? null);
  if (opts.morph && !freeze && !loop) console.warn(`cannot read ?morph=${opts.morph} (for example s1-s2:0.5: neighbouring sections, a fraction from 0 to 1)`);
  const pin = variant && (STRUCTURES as readonly string[]).includes(variant) ? (variant as StructureName) : undefined;
  return new MorphCity(theme, { keepOut: opts.keepOut, pin, freeze, loop, debug: opts.debug === 'facing' ? 1 : opts.debug === 'range' ? 2 : 0 });
}
