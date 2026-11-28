// The puff of dust where a fold meets what it has been placed against: a few soft sprites at each seam that swell, drift up
// a little and fade. A fixed pool (no allocation while playing); the same fold always puffs the same way (the random
// numbers come from the seam's place), so the review shots and the tests see the same thing.
import * as THREE from 'three';
import type { Seam } from './foldFeel.ts';

const POOL = 40;
const PER_SEAM = 5;
const MAX_SEAMS = 8;
/** Dust of old stone: pale, warm, and in two tones (the lit and the shaded side of a puff), so a puff has some body against the paving. */
const DUST_COLORS = ['#f2e9d8', '#cdbfa8'];

interface Puff {
  sprite: THREE.Sprite;
  live: boolean;
  t: number;
  life: number;
  from: number;
  to: number;
  peak: number;
  base: THREE.Vector3;
  drift: THREE.Vector3;
}

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A cloud: a few soft blobs of different sizes on one square, alpha only. */
function cloudTexture(): THREE.Texture {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const rand = mulberry32(7);
  ctx.clearRect(0, 0, size, size);
  for (let i = 0; i < 7; i++) {
    const r = size * (0.17 + 0.15 * rand());
    const x = size / 2 + (rand() - 0.5) * size * 0.34;
    const y = size / 2 + (rand() - 0.5) * size * 0.34;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(255,255,255,0.85)');
    g.addColorStop(0.55, 'rgba(255,255,255,0.4)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export class Dust {
  readonly group = new THREE.Group();
  private readonly puffs: Puff[] = [];
  private cursor = 0;

  constructor() {
    this.group.name = 'dust';
    const map = cloudTexture();
    for (let i = 0; i < POOL; i++) {
      const material = new THREE.SpriteMaterial({ map, color: DUST_COLORS[i % DUST_COLORS.length], transparent: true, opacity: 0, depthWrite: false, fog: false });
      const sprite = new THREE.Sprite(material);
      sprite.visible = false;
      sprite.renderOrder = 5;
      this.group.add(sprite);
      this.puffs.push({ sprite, live: false, t: 0, life: 1, from: 1, to: 2, peak: 0.3, base: new THREE.Vector3(), drift: new THREE.Vector3() });
    }
  }

  /** A puff at each seam (at most MAX_SEAMS). `reduce`: a faint, still puff that only fades (no swelling, no rising). */
  puff(seams: readonly Seam[], reduce = false) {
    for (const seam of seams.slice(0, MAX_SEAMS)) {
      const rand = mulberry32(Math.round(seam.x * 31 + seam.z * 57 + seam.y * 13));
      const along = seam.side === 'N' || seam.side === 'S' ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 0, 1);
      const out = along.clone().cross(new THREE.Vector3(0, 1, 0));
      for (let i = 0; i < PER_SEAM; i++) {
        const p = this.puffs[this.cursor++ % POOL];
        const a = (i / (PER_SEAM - 1) - 0.5) * 3.2 + (rand() - 0.5) * 0.5;
        p.base.set(seam.x, seam.y + 0.2 + rand() * 0.25, seam.z).addScaledVector(along, a).addScaledVector(out, (rand() - 0.5) * 0.8);
        p.drift.set(0, reduce ? 0 : 0.7 + rand() * 0.6, 0).addScaledVector(out, reduce ? 0 : (rand() - 0.5) * 1.8);
        p.life = reduce ? 0.9 : 1.2 + rand() * 0.6;
        p.from = reduce ? 2.2 : 1.2 + rand() * 0.6;
        p.to = reduce ? 2.2 : 2.8 + rand() * 1.2;
        p.peak = reduce ? 0.3 : 0.7 + rand() * 0.2;
        p.t = 0;
        p.live = true;
        p.sprite.material.rotation = rand() * Math.PI * 2;
        p.sprite.visible = true;
      }
    }
  }

  update(dt: number) {
    for (const p of this.puffs) {
      if (!p.live) continue;
      p.t += dt;
      const u = p.t / p.life;
      if (u >= 1) {
        p.live = false;
        p.sprite.visible = false;
        continue;
      }
      const swell = 1 - (1 - u) ** 2;
      p.sprite.position.copy(p.base).addScaledVector(p.drift, swell);
      p.sprite.scale.setScalar(p.from + (p.to - p.from) * swell);
      p.sprite.material.opacity = p.peak * Math.min(1, p.t / 0.08) * (1 - u) ** 1.4;
    }
  }

  get active() {
    return this.puffs.some((p) => p.live);
  }

  clear() {
    for (const p of this.puffs) {
      p.live = false;
      p.sprite.visible = false;
    }
  }
}
