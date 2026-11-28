// Quality: what each of the three tiers draws, which one the game starts at when the player leaves the choice to it
// ('auto'), and when it steps down. Pure (no three.js, no DOM): tests/quality.test.ts runs it.
//
// Auto picks the tier twice. Before anything heavy is built, from the GPU's renderer string (guessQuality): the shadow maps,
// the antialiasing pass and the background city's models are made for one tier, and some of that cannot be redone while
// the game runs. Then, on the title after `ready`, from the frame intervals it really gets (FrameProbe, stepDownFor): a
// machine that is slower than its name said steps down by what can be changed live (Game.applyQuality).
import { LOW_SCALE_FLOOR, SCALE_FLOOR } from './adaptiveScale.ts';

export type Quality = 'low' | 'medium' | 'high';
/** What the settings hold: a tier the player chose, or 'auto'. */
export type QualitySetting = 'auto' | Quality;

export const QUALITIES: readonly Quality[] = ['low', 'medium', 'high'];

export const isQuality = (v: unknown): v is Quality => v === 'low' || v === 'medium' || v === 'high';
export const isQualitySetting = (v: unknown): v is QualitySetting => v === 'auto' || isQuality(v);

/** What a tier switches on. The adaptive resolution moves between `floor` and `max`, from `initial`. */
export interface QualityPlan {
  /** The sun's shadow map (and with it the shadow pass). */
  shadows: boolean;
  /** Side of the shadow map in texels, and the share of the full shadow frustum it covers. */
  shadowMap: number;
  shadowReach: number;
  /** The SMAA pass of the post-processing. */
  smaa: boolean;
  scale: { initial: number; max: number; floor: number };
  /** The background city: `low` draws its far models only, to a shorter distance, with fewer instances (foldcity/detail.ts). */
  city: 'full' | 'low';
}

export const PLANS: Readonly<Record<Quality, QualityPlan>> = {
  low: { shadows: false, shadowMap: 0, shadowReach: 0, smaa: false, scale: { initial: 0.6, max: 0.8, floor: LOW_SCALE_FLOOR }, city: 'low' },
  medium: { shadows: true, shadowMap: 2048, shadowReach: 0.7, smaa: true, scale: { initial: 0.9, max: 0.9, floor: SCALE_FLOOR }, city: 'full' },
  high: { shadows: true, shadowMap: 4096, shadowReach: 1, smaa: true, scale: { initial: 1, max: 1, floor: SCALE_FLOOR }, city: 'full' },
};

export type GpuTier = 'high' | 'mid' | 'low' | 'unknown';

/**
 * A coarse class of the GPU from its renderer string (also what the play log records). The integrated GPUs and the software
 * renderers are `low`: this game's scene (about 1.3 M triangles, shadow maps, post-processing) is too much for them.
 */
export function gpuTier(name: string): GpuTier {
  if (!name) return 'unknown';
  if (/Apple M\d|RTX|Radeon RX|Arc A/.test(name)) return 'high';
  if (/Intel|Iris|UHD|SwiftShader|llvmpipe|softpipe|Basic Render|WARP/.test(name)) return 'low';
  return 'mid';
}

/** The renderer string of a WebGL context (the unmasked one when the browser allows it), or '' when it says none. */
export function gpuName(gl: { getExtension(name: string): unknown; getParameter(p: number): unknown }): string {
  try {
    const ext = gl.getExtension('WEBGL_debug_renderer_info') as { UNMASKED_RENDERER_WEBGL: number } | null;
    return ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : '';
  } catch {
    return '';
  }
}

/** The tier auto starts at for a GPU class: a machine of unknown strength gets the middle one. */
export function guessQuality(tier: GpuTier): Quality {
  return tier === 'low' ? 'low' : tier === 'high' ? 'high' : 'medium';
}

/** The tier a setting means for this GPU. */
export function resolveQuality(setting: QualitySetting, tier: GpuTier): Quality {
  return setting === 'auto' ? guessQuality(tier) : setting;
}

/** A median frame interval over this many ms means low / medium. */
export const LOW_P50_MS = 33;
export const MEDIUM_P50_MS = 20;
/** The measuring window on the title: this much frame time, and at least this many frames. */
export const PROBE_MS = 2000;
export const PROBE_FRAMES = 4;
/** In the time-weighted median a frame counts for at most this long (quality.ts, FrameProbe.typical). */
export const TYPICAL_CAP_MS = 250;

/** The tier auto steps down to, given the median frame interval it measured at `current`. It never steps up. */
export function stepDownFor(current: Quality, p50: number): Quality {
  if (current !== 'low' && p50 > LOW_P50_MS) return 'low';
  if (current === 'high' && p50 > MEDIUM_P50_MS) return 'medium';
  return current;
}

/** Collects real frame intervals (ms) until about two seconds of them are in. */
export class FrameProbe {
  private readonly frames: number[] = [];
  private spanMs = 0;

  /** Record one interval; returns true once the window is full. */
  add(ms: number): boolean {
    if (ms > 0 && Number.isFinite(ms)) {
      this.frames.push(ms);
      this.spanMs += ms;
    }
    return this.done;
  }

  get done() {
    return this.spanMs >= PROBE_MS && this.frames.length >= PROBE_FRAMES;
  }

  get count() {
    return this.frames.length;
  }

  /** The median interval, ms (0 before the first frame). */
  get p50(): number {
    if (!this.frames.length) return 0;
    const s = [...this.frames].sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)];
  }

  /**
   * The median of the time, not of the frames: the interval at which half of the measured time had been spent in frames of
   * that length or shorter. It is the p50 for steady frames and for a hitch or two, but a machine that delivers short and
   * long frames by turns (17, 17, 430, 180 ms: a software renderer, or a GPU behind a deep queue) has a median of its short
   * frames and spends most of its time in the long ones, which is what a player sees. A frame counts for at most
   * TYPICAL_CAP_MS: one freeze (a pause of the browser, a virus scan) is not a slow machine.
   */
  get typical(): number {
    if (!this.frames.length) return 0;
    const s = this.frames.map((f) => Math.min(f, TYPICAL_CAP_MS)).sort((a, b) => a - b);
    const total = s.reduce((a, b) => a + b, 0);
    let acc = 0;
    for (const f of s) {
      acc += f;
      if (acc >= total / 2) return f;
    }
    return s[s.length - 1];
  }

  /** Start over (the page was hidden: its frames say nothing about the machine). */
  reset() {
    this.frames.length = 0;
    this.spanMs = 0;
  }
}
