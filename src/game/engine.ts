// Renderer, post-processing and adaptive resolution.
import * as THREE from 'three';
import {
  BloomEffect, EffectComposer, EffectPass, RenderPass, SMAAEffect, ToneMappingEffect, VignetteEffect,
} from 'postprocessing';

import { AdaptiveScale } from './adaptiveScale.ts';
import { LOOK } from './look.ts';

export type Quality = 'low' | 'medium' | 'high';

export class Engine {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(62, 1, 0.1, 2000);
  readonly composer: EffectComposer;
  readonly bloom: BloomEffect;
  quality: Quality;
  /** Off in review shots: the render scale stays where the quality setting put it. */
  adaptive = true;
  /** Runs right before each frame is drawn (the sun's shadow map follows the camera). */
  beforeRender: (() => void) | null = null;
  private readonly adaptiveScale: AdaptiveScale;
  private readonly exactPixelRatio: boolean;
  private frameTimes: number[] = [];

  /** `exactPixelRatio` renders at the full device pixel ratio (the capture asks for exact output sizes). */
  constructor(canvas: HTMLCanvasElement, quality: Quality, exactPixelRatio = false) {
    this.quality = quality;
    this.exactPixelRatio = exactPixelRatio;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, stencil: false, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NoToneMapping; // done in post
    this.renderer.shadowMap.enabled = quality !== 'low';
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.info.autoReset = false; // counted per frame over all passes: see render()
    this.composer = new EffectComposer(this.renderer, { frameBufferType: THREE.HalfFloatType });
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new BloomEffect({
      intensity: LOOK.bloom.intensity, luminanceThreshold: LOOK.bloom.threshold, luminanceSmoothing: LOOK.bloom.smoothing, mipmapBlur: true, radius: 0.72,
    });
    const tone = new ToneMappingEffect({ mode: LOOK.toneMapping });
    const vignette = new VignetteEffect({ darkness: 0.2, offset: 0.4 }) // light: the walkway in the lower corners must stay the brightest area;
    const effects = quality === 'low' ? [this.bloom, tone, vignette] : [this.bloom, tone, vignette, new SMAAEffect()];
    this.composer.addPass(new EffectPass(this.camera, ...effects));
    this.adaptiveScale = new AdaptiveScale({ initial: quality === 'high' ? 1 : quality === 'medium' ? 0.9 : 0.7, max: quality === 'high' ? 1 : 0.9 });
    window.addEventListener('resize', () => this.resize());
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
  precompile(object: THREE.Object3D, scene: THREE.Scene = this.scene): Promise<unknown> {
    const before = this.renderer.getRenderTarget();
    this.renderer.setRenderTarget(this.composer.inputBuffer); // (compileAsync reads it while it starts: the wait below does not)
    try {
      return this.renderer.compileAsync(object, this.camera, scene).catch(() => {});
    } finally {
      this.renderer.setRenderTarget(before);
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
