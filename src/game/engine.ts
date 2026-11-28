// Renderer, post-processing and adaptive resolution.
import * as THREE from 'three';
import {
  BloomEffect, EffectComposer, EffectPass, RenderPass, SMAAEffect, ToneMappingEffect, VignetteEffect,
} from 'postprocessing';

import { AdaptiveScale } from './adaptiveScale.ts';
import { breathe } from './frames.ts';
import { LOOK } from './look.ts';
import { PLANS, gpuName, gpuTier, guessQuality, resolveQuality, type GpuTier, type Quality, type QualitySetting } from './quality.ts';

export type { Quality } from './quality.ts';

export class Engine {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(62, 1, 0.1, 2000);
  readonly composer: EffectComposer;
  readonly bloom: BloomEffect;
  /** The tier in use now (never 'auto': that is resolved here, and Engine.setQuality lowers it). */
  quality: Quality;
  /** The renderer string of the GPU (empty when the browser hides it), its class, and the tier auto starts at for it. */
  readonly gpu: string;
  readonly tier: GpuTier;
  readonly guess: Quality;
  /** Off in review shots: the render scale stays where the quality setting put it. */
  adaptive = true;
  /** Runs right before each frame is drawn (the sun's shadow map follows the camera). */
  beforeRender: (() => void) | null = null;
  private readonly adaptiveScale: AdaptiveScale;
  private readonly exactPixelRatio: boolean;
  private effectPass: EffectPass;
  private smaa: SMAAEffect | null;
  private readonly tone: ToneMappingEffect;
  private readonly vignette: VignetteEffect;
  private frameTimes: number[] = [];

  /**
   * `setting` is the tier, or 'auto': the one the GPU's renderer string suggests (quality.ts). `exactPixelRatio` renders at the
   * full device pixel ratio (the capture asks for exact output sizes). `gpuOverride` stands in for the renderer string (`?gpu=`:
   * to try what auto does on another machine).
   */
  constructor(canvas: HTMLCanvasElement, setting: QualitySetting, exactPixelRatio = false, gpuOverride?: string | null) {
    this.exactPixelRatio = exactPixelRatio;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, stencil: false, powerPreference: 'high-performance' });
    this.gpu = gpuOverride || gpuName(this.renderer.getContext());
    this.tier = gpuTier(this.gpu);
    this.guess = guessQuality(this.tier);
    this.quality = resolveQuality(setting, this.tier);
    const plan = PLANS[this.quality];
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NoToneMapping; // done in post
    this.renderer.shadowMap.enabled = plan.shadows;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.info.autoReset = false; // counted per frame over all passes: see render()
    this.composer = new EffectComposer(this.renderer, { frameBufferType: THREE.HalfFloatType });
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new BloomEffect({
      intensity: LOOK.bloom.intensity, luminanceThreshold: LOOK.bloom.threshold, luminanceSmoothing: LOOK.bloom.smoothing, mipmapBlur: true, radius: 0.72,
    });
    this.tone = new ToneMappingEffect({ mode: LOOK.toneMapping });
    this.vignette = new VignetteEffect({ darkness: 0.2, offset: 0.4 }); // light: the walkway in the lower corners must stay the brightest area
    this.smaa = plan.smaa ? new SMAAEffect() : null;
    this.effectPass = new EffectPass(this.camera, ...[this.bloom, this.tone, this.vignette, this.smaa].filter((e) => e !== null));
    this.composer.addPass(this.effectPass);
    this.adaptiveScale = new AdaptiveScale(plan.scale);
    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  /**
   * Lower the quality while the game runs (auto's step down on the title; it never raises). What is live: the render scale
   * limits, the shadow pass (the shaders keep their shadow code and Sun.setQuality sends every surface out of the shadow
   * frustum, so nothing is recompiled), and the SMAA pass (the one merged post pass is rebuilt without it: one small program
   * is compiled). The caller lowers the sun's map and the city's detail with it (Game.applyQuality).
   */
  setQuality(next: Quality) {
    if (next === this.quality) return;
    const plan = PLANS[next];
    this.quality = next;
    this.renderer.shadowMap.enabled = plan.shadows;
    if (this.smaa && !plan.smaa) {
      const old = this.effectPass;
      this.composer.removePass(old);
      old.fullscreenMaterial.dispose(); // (not old.dispose(): that would dispose the effects the new pass shares)
      this.effectPass = new EffectPass(this.camera, this.bloom, this.tone, this.vignette);
      this.composer.addPass(this.effectPass);
      this.smaa.dispose();
      this.smaa = null;
    }
    this.adaptiveScale.setLimits(plan.scale);
    this.resize();
  }

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const dpr = (this.exactPixelRatio ? window.devicePixelRatio : Math.min(window.devicePixelRatio, 2)) * this.adaptiveScale.scale;
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.fov = w < h ? 72 : 62; // keep enough width in a vertical (shorts) frame
    this.camera.updateProjectionMatrix();
  }

  render(dt: number) {
    this.beforeRender?.();
    this.renderer.info.reset();
    this.composer.render(dt);
  }

  /**
   * Compiles the shaders `object` draws with, off the frame (`compileAsync`: the graphics driver links them on its own
   * threads), and settles once they are ready; the object itself need not be in the scene yet. The scene is drawn into the
   * composer's buffer, not to the screen, and three picks a program by what it draws into (the output colour space): a
   * compile against the screen builds programs that are never used, and the real ones are then built one after another,
   * inside the first frame that draws the object (2.3 s at load, on the machine this was measured on).
   */
  async precompile(object: THREE.Object3D, scene: THREE.Scene = this.scene): Promise<void> {
    const before = this.renderer.getRenderTarget();
    this.renderer.setRenderTarget(this.composer.inputBuffer); // (compileAsync reads it while it starts: the wait below does not)
    let compiling: Promise<unknown>;
    try {
      compiling = this.renderer.compileAsync(object, this.camera, scene);
    } finally {
      this.renderer.setRenderTarget(before);
    }
    await compiling.catch(() => {});
    await this.finishPrograms();
    await this.uploadTextures(object);
  }

  /**
   * A compiled program still has to be looked at once before it is used (its link status, its uniforms: the graphics driver
   * finishes the shader there, 20 to 80 ms each). Taken in the frame that first draws, a dozen of them make a frame of
   * 0.4 s; here they are taken a few at a time, between frames.
   */
  private async finishPrograms() {
    let t0 = performance.now();
    for (const program of [...(this.renderer.info.programs ?? [])]) {
      program.getUniforms();
      program.getAttributes();
      if (performance.now() - t0 > 20) {
        await breathe();
        t0 = performance.now();
      }
    }
  }

  /** The textures of `object`'s materials go to the GPU a few at a time too (decoding and uploading them in the first frame that draws them took 0.26 s for the kit). */
  private async uploadTextures(object: THREE.Object3D) {
    const textures = new Set<THREE.Texture>();
    const take = (value: unknown) => {
      if ((value as THREE.Texture | null)?.isTexture) textures.add(value as THREE.Texture);
    };
    object.traverse((o) => {
      for (const m of [(o as THREE.Mesh).material].flat()) {
        if (!m) continue;
        for (const value of Object.values(m)) take(value);
        // (a patched shader's own uniforms: what the material reads that it has no property for)
        const compiled = (this.renderer.properties.get(m) as { uniforms?: Record<string, THREE.IUniform> }).uniforms;
        for (const u of Object.values(compiled ?? (m as THREE.ShaderMaterial).uniforms ?? {})) take(u.value);
      }
    });
    let t0 = performance.now();
    for (const texture of textures) {
      this.renderer.initTexture(texture);
      if (performance.now() - t0 > 20) {
        await breathe();
        t0 = performance.now();
      }
    }
  }

  /** Draw calls and triangles of the last frame, summed over every pass (shadow map, scene, post), and what the GPU holds. */
  frameInfo() {
    const { render, memory } = this.renderer.info;
    return { calls: render.calls, triangles: render.triangles, geometries: memory.geometries, textures: memory.textures };
  }

  /** Record a frame interval (ms); AdaptiveScale decides when the render scale goes down or up, and the change is applied here. */
  sample(ms: number) {
    if (!this.adaptive) return;
    this.frameTimes.push(ms);
    if (this.frameTimes.length > 240) this.frameTimes.shift();
    if (this.adaptiveScale.sample(ms)) this.resize();
  }

  /** No render scale change for `seconds` (a fold of the background must not get a resize hitch); a no-op in the review shots. */
  hold(seconds: number) {
    if (this.adaptive) this.adaptiveScale.hold(seconds);
  }

  percentile(p: number): number {
    if (!this.frameTimes.length) return 0;
    const s = [...this.frameTimes].sort((a, b) => a - b);
    return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
  }

  get renderScale() {
    return this.adaptiveScale.scale;
  }
}
