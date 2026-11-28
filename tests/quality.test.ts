import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AdaptiveScale, LOW_SCALE_FLOOR, SCALE_FLOOR } from '../src/game/adaptiveScale.ts';
import {
  FrameProbe, LOW_P50_MS, MEDIUM_P50_MS, PLANS, PROBE_FRAMES, PROBE_MS, gpuName, gpuTier, guessQuality, isQualitySetting, resolveQuality, stepDownFor,
} from '../src/game/quality.ts';

const NAMES = {
  rx6400: 'ANGLE (AMD, AMD Radeon RX 6400 (0x00007422) Direct3D11 vs_5_0 ps_5_0, D3D11)',
  rtx: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Laptop GPU Direct3D11 vs_5_0 ps_5_0, D3D11)',
  gtx: 'ANGLE (NVIDIA, NVIDIA GeForce GTX 1650 Direct3D11 vs_5_0 ps_5_0, D3D11)',
  uhd: 'ANGLE (Intel, Intel(R) UHD Graphics 620 (0x00005917) Direct3D11 vs_5_0 ps_5_0, D3D11)',
  iris: 'ANGLE (Intel, Intel(R) Iris(R) Xe Graphics (0x000046A6) Direct3D11 vs_5_0 ps_5_0, D3D11)',
  vega: 'ANGLE (AMD, AMD Radeon(TM) Graphics (0x00001638) Direct3D11 vs_5_0 ps_5_0, D3D11)',
  m1: 'ANGLE (Apple, ANGLE Metal Renderer: Apple M1, Unspecified Version)',
  swift: 'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)',
  llvm: 'ANGLE (Mesa, llvmpipe (LLVM 15.0.7, 256 bits), OpenGL 4.5)',
  warp: 'ANGLE (Microsoft, Microsoft Basic Render Driver (0x0000008C) Direct3D11 vs_5_0 ps_5_0, D3D11)',
};

test('the GPU string says which tier auto starts at', () => {
  for (const name of [NAMES.uhd, NAMES.iris, NAMES.swift, NAMES.llvm, NAMES.warp]) assert.equal(guessQuality(gpuTier(name)), 'low', name);
  for (const name of [NAMES.rx6400, NAMES.rtx, NAMES.m1]) assert.equal(guessQuality(gpuTier(name)), 'high', name);
  for (const name of [NAMES.gtx, NAMES.vega]) assert.equal(guessQuality(gpuTier(name)), 'medium', name);
  assert.equal(guessQuality(gpuTier('')), 'medium', 'a browser that hides the name gets the middle tier');
  assert.equal(gpuTier(''), 'unknown');
});

test('a chosen tier overrides auto, and auto is what the GPU suggests', () => {
  for (const q of ['low', 'medium', 'high'] as const) assert.equal(resolveQuality(q, 'low'), q);
  assert.equal(resolveQuality('auto', gpuTier(NAMES.uhd)), 'low');
  assert.equal(resolveQuality('auto', gpuTier(NAMES.rtx)), 'high');
  assert.ok(isQualitySetting('auto') && isQualitySetting('low') && !isQualitySetting('ultra') && !isQualitySetting(null));
});

test('gpuName reads the unmasked renderer, and says nothing when the browser hides it', () => {
  const gl = (ext: unknown) => ({ getExtension: () => ext, getParameter: (p: number) => (p === 37446 ? NAMES.uhd : 'masked') });
  assert.equal(gpuName(gl({ UNMASKED_RENDERER_WEBGL: 37446 })), NAMES.uhd);
  assert.equal(gpuName(gl(null)), '');
  assert.equal(gpuName({ getExtension: () => { throw new Error('lost'); }, getParameter: () => '' }), '');
});

test('the median frame interval steps auto down: over 33 ms to low, over 20 ms to medium, never up', () => {
  assert.equal(stepDownFor('high', 16.7), 'high');
  assert.equal(stepDownFor('high', 20), 'high');
  assert.equal(stepDownFor('high', 22), 'medium');
  assert.equal(stepDownFor('high', 34), 'low');
  assert.equal(stepDownFor('medium', 22), 'medium', 'medium has nowhere to go for 20 to 33 ms: the adaptive resolution takes it from there');
  assert.equal(stepDownFor('medium', 40), 'low');
  assert.equal(stepDownFor('low', 80), 'low');
  assert.equal(stepDownFor('low', 10), 'low', 'it never steps up');
  assert.ok(LOW_P50_MS === 33 && MEDIUM_P50_MS === 20);
});

test('the probe takes about two seconds of frames and reads their median, which a few hitches do not move', () => {
  const p = new FrameProbe();
  let n = 0;
  let span = 0;
  for (;;) {
    const ms = n++ % 10 === 0 ? 300 : 16.7; // (one frame in ten is a hitch)
    span += ms;
    if (p.add(ms)) break;
  }
  assert.ok(span >= PROBE_MS && span < PROBE_MS + 300 && n >= PROBE_FRAMES, `${n} frames, ${span} ms`);
  assert.ok(Math.abs(p.p50 - 16.7) < 0.01, `p50 ${p.p50}`);
  // short and long frames by turns: the median is the short ones, the time is spent in the long ones
  const mixed = new FrameProbe();
  for (let i = 0; !mixed.done; i++) mixed.add(i % 2 ? 17 : 430);
  assert.ok(mixed.p50 === 17 || mixed.p50 === 430);
  assert.equal(mixed.typical, 250, 'a long frame counts as 250 ms at most');
  const hitch = new FrameProbe();
  hitch.add(600);
  while (!hitch.done) hitch.add(16.7);
  assert.equal(hitch.typical, 16.7, 'one hitch is not a slow machine');
  const freeze = new FrameProbe();
  freeze.add(1000);
  for (let i = 0; i < 70; i++) freeze.add(16.7);
  assert.equal(freeze.typical, 16.7, 'nor is one freeze of a second');
  // a slideshow still gets a verdict from a few frames
  const slow = new FrameProbe();
  let frames = 0;
  while (!slow.add(900)) frames++;
  assert.equal(frames + 1, PROBE_FRAMES);
  assert.equal(slow.p50, 900);
  // frames from a hidden page are thrown away
  const hidden = new FrameProbe();
  hidden.add(1000);
  hidden.reset();
  assert.equal(hidden.count, 0);
  assert.equal(hidden.add(Number.NaN), false);
  assert.equal(hidden.add(-5), false);
  assert.equal(hidden.p50, 0);
});

test('low really is the light tier: no shadows, no SMAA, a render scale that goes down to 0.5, a lighter city', () => {
  const { low, medium, high } = PLANS;
  assert.equal(low.shadows, false);
  assert.equal(low.smaa, false);
  assert.equal(low.city, 'low');
  assert.ok(low.scale.floor <= 0.5 && low.scale.floor === LOW_SCALE_FLOOR);
  assert.ok(low.scale.initial < medium.scale.initial && low.scale.max <= medium.scale.max);
  // medium and high are what they were
  assert.deepEqual([medium.shadows, medium.smaa, medium.shadowMap, medium.scale.initial, medium.scale.max, medium.scale.floor], [true, true, 2048, 0.9, 0.9, SCALE_FLOOR]);
  assert.deepEqual([high.shadows, high.smaa, high.shadowMap, high.scale.initial, high.scale.max, high.scale.floor], [true, true, 4096, 1, 1, SCALE_FLOOR]);
  assert.ok(medium.city === 'full' && high.city === 'full');
});

test('the adaptive resolution of low goes below the other tiers floor, and a step down lowers its limits live', () => {
  const ctl = new AdaptiveScale(PLANS.low.scale);
  assert.equal(ctl.scale, 0.6);
  // every frame dropped: 0.6 -> 0.5, and no lower
  for (let i = 0; i < 400; i++) ctl.sample(100);
  assert.equal(ctl.scale, LOW_SCALE_FLOOR);
  // medium stops at its own floor
  const med = new AdaptiveScale(PLANS.medium.scale);
  for (let i = 0; i < 400; i++) med.sample(100);
  assert.equal(med.scale, SCALE_FLOOR);
  // a game that steps down from high to low while it runs
  const live = new AdaptiveScale(PLANS.high.scale);
  assert.equal(live.setLimits(PLANS.low.scale), true);
  assert.equal(live.scale, PLANS.low.scale.initial, 'comes down to where low starts');
  assert.equal(live.setLimits(PLANS.low.scale), false);
  // one already below the new initial stays where it is
  const lower = new AdaptiveScale({ initial: 0.55, max: 0.9 });
  lower.setLimits(PLANS.low.scale);
  assert.equal(lower.scale, 0.55);
});
