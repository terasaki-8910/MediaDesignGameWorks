// Renderer, post-processing and adaptive resolution.
import * as THREE from 'three';
import {
  BloomEffect, EffectComposer, EffectPass, RenderPass, SMAAEffect, ToneMappingEffect, ToneMappingMode, VignetteEffect,
} from 'postprocessing';

export type Quality = 'low' | 'medium' | 'high';

export class Engine {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(62, 1, 0.1, 2000);
  readonly composer: EffectComposer;
  readonly bloom: BloomEffect;
  quality: Quality;
  private scale = 1;
  private frameTimes: number[] = [];
  private sinceAdapt = 0;

  constructor(canvas: HTMLCanvasElement, quality: Quality) {
    this.quality = quality;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, stencil: false, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NoToneMapping; // done in post
    this.renderer.shadowMap.enabled = quality !== 'low';
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.composer = new EffectComposer(this.renderer, { frameBufferType: THREE.HalfFloatType });
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new BloomEffect({ intensity: 1.15, luminanceThreshold: 0.92, luminanceSmoothing: 0.18, mipmapBlur: true, radius: 0.72 });
    const tone = new ToneMappingEffect({ mode: ToneMappingMode.AGX });
    const vignette = new VignetteEffect({ darkness: 0.45, offset: 0.32 });
    const effects = quality === 'low' ? [this.bloom, tone, vignette] : [this.bloom, tone, vignette, new SMAAEffect()];
    this.composer.addPass(new EffectPass(this.camera, ...effects));
    this.scale = quality === 'high' ? 1 : quality === 'medium' ? 0.9 : 0.7;
    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const dpr = Math.min(window.devicePixelRatio, 2) * this.scale;
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  render(dt: number) {
    this.composer.render(dt);
  }

  /** Record a frame time and nudge the render scale to hold ~60 fps (adaptive resolution). */
  sample(ms: number) {
    this.frameTimes.push(ms);
    if (this.frameTimes.length > 240) this.frameTimes.shift();
    this.sinceAdapt += ms;
    if (this.sinceAdapt < 2000 || this.frameTimes.length < 60) return;
    this.sinceAdapt = 0;
    const p95 = this.percentile(95);
    const max = this.quality === 'high' ? 1 : 0.9;
    const next = p95 > 22 ? Math.max(0.55, this.scale - 0.1) : p95 < 14 ? Math.min(max, this.scale + 0.05) : this.scale;
    if (Math.abs(next - this.scale) > 1e-3) {
      this.scale = next;
      this.resize();
    }
  }

  percentile(p: number): number {
    if (!this.frameTimes.length) return 0;
    const s = [...this.frameTimes].sort((a, b) => a - b);
    return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
  }

  get renderScale() {
    return this.scale;
  }
}
