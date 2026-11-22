// Sky, lights, haze, and the background city: modelled buildings (art/blender/gen_city.py) laid out in streets as a
// sea of rooftops below the walkways, and the same buildings hanging upside down as the mirrored city far above.
// Fold events send a wave through both that tilts each building.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { VisualTheme } from '../core/types.ts';
import { LOOK, createSun, hazeFloor, installHaze, loadSky } from './look.ts';

function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

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
  return { sun, sky: loadSky(scene, renderer) };
}

/** The buildings of city.glb: how often each stands in the streets, and how many rows of a street block it takes. */
const VARIANTS = [
  { name: 'haussmann_a', weight: 5, rows: 1, scale: 1 },
  { name: 'haussmann_corner', weight: 3, rows: 1, scale: 1 },
  { name: 'haussmann_step', weight: 3, rows: 1, scale: 1 },
  { name: 'belfry', weight: 1.1, rows: 1, scale: 1 },
  { name: 'deco_hall', weight: 0.7, rows: 1, scale: 0.78 },
  { name: 'deco_tower', weight: 0.45, rows: 2, scale: 1 },
  { name: 'dome', weight: 0.4, rows: 2, scale: 1 },
] as const;

/** Street grid: one block is this wide and deep (building plus street), and the grid is turned off the walkways' axes. */
const BLOCK: [number, number] = [54, 30];
const GRID_TURN = 0.31;
/** Lower city: the ground lies this far below y = 0, so the roofs (about 28 m up) sink into the haze under the walkways. */
const GROUND = -38;
/** Mirrored city: the buildings hang from this height, their roofs 100 m and more above the walkways, their feet lost in the haze above. */
const SKY = 128;
/** Buildings nearer than this to the middle of the stage get the detailed model. */
const NEAR = 210;

interface Building { x: number; z: number; y: number; yaw: number; scale: number; axis: THREE.Vector3; angle: number; sky: boolean }
interface Wave { origin: THREE.Vector3; start: number; strength: number; speed: number; dur: number }

export class BackgroundCity {
  readonly group = new THREE.Group();
  private sets: { mesh: THREE.InstancedMesh; items: Building[] }[] = [];
  private waves: Wave[] = [];
  private time = 0;
  private readonly m4 = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly qYaw = new THREE.Quaternion();
  private readonly flip = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI);
  private readonly up = new THREE.Vector3(0, 1, 0);
  private readonly theme: VisualTheme;
  private readonly center: THREE.Vector3;
  private readonly exclude: THREE.Box3;

  /** `exclude` is the play space: nothing of the lower city stands under it. The buildings appear once `load` is done. */
  constructor(theme: VisualTheme, center: THREE.Vector3, exclude: THREE.Box3) {
    this.theme = theme;
    this.center = center;
    this.exclude = exclude.clone().expandByVector(new THREE.Vector3(26, 0, 26));
  }

  async load(url: string) {
    const gltf = await new GLTFLoader().loadAsync(url);
    const r = rng(this.theme.city.seed);
    const [r0, r1] = this.theme.city.radius;
    const lists = new Map<string, Building[]>();
    const push = (key: string, b: Building) => {
      const l = lists.get(key);
      if (l) l.push(b);
      else lists.set(key, [b]);
    };
    const total = VARIANTS.reduce((s, v) => s + v.weight, 0);
    const pick = () => {
      let k = r() * total;
      for (const v of VARIANTS) if ((k -= v.weight) <= 0) return v;
      return VARIANTS[0];
    };
    const cos = Math.cos(GRID_TURN);
    const sin = Math.sin(GRID_TURN);
    const lay = (sky: boolean, block: [number, number], inner: number, outer: number, keep: number) => {
      const nx = Math.ceil(outer / block[0]);
      const nz = Math.ceil(outer / block[1]);
      const used = new Set<string>();
      for (let i = -nx; i <= nx; i++)
        for (let j = -nz; j <= nz; j++) {
          const v = pick();
          const jitter = [(r() - 0.5) * 4, (r() - 0.5) * 3, (r() - 0.5) * 0.07, r(), r(), r()];
          if (used.has(`${i},${j}`) || jitter[3] > keep) continue;
          const gx = i * block[0] + (j % 2 ? block[0] * 0.5 : 0) + jitter[0];
          const gz = (j + (v.rows - 1) / 2) * block[1] + jitter[1];
          const x = this.center.x + gx * cos - gz * sin;
          const z = this.center.z + gx * sin + gz * cos;
          const rad = Math.hypot(x - this.center.x, z - this.center.z);
          if (rad < inner || rad > outer) continue;
          if (!sky && this.exclude.containsPoint(new THREE.Vector3(x, 0, z))) continue;
          if (v.rows > 1) {
            if (used.has(`${i},${j + 1}`)) continue;
            used.add(`${i},${j + 1}`);
          }
          const radial = new THREE.Vector3(x - this.center.x, 0, z - this.center.z).normalize();
          // the ground steps down a little from district to district, so the rooflines are not one level
          const step = Math.round((Math.sin(i * 0.9 + 1.3) + Math.cos(j * 0.7)) * 1.5) * 2.5;
          const b: Building = {
            x, z,
            y: sky ? SKY + step + jitter[4] * 14 : GROUND + step - ((rad - inner) / (outer - inner)) * 6,
            yaw: -GRID_TURN + (jitter[5] < 0.5 ? 0 : Math.PI) + jitter[2],
            scale: v.scale * (0.92 + jitter[4] * 0.2),
            axis: new THREE.Vector3(-radial.z, 0, radial.x), // tilt away from the centre
            angle: 0,
            sky,
          };
          push(`${v.name}_lod${!sky && rad < NEAR ? 0 : 1}`, b);
        }
    };
    lay(false, BLOCK, r0 - 12, r1, 0.93);
    lay(true, [BLOCK[0] * 1.25, BLOCK[1] * 1.5], r0 + 40, r1 + 60, 0.5);

    const tint = new THREE.Color();
    for (const [key, items] of lists) {
      const src = gltf.scene.getObjectByName(key) as THREE.Mesh | undefined;
      if (!src?.isMesh) throw new Error(`city.glb has no mesh "${key}"`);
      const mesh = new THREE.InstancedMesh(src.geometry, src.material, items.length);
      items.forEach((b, i) => {
        // darker and greyer than the play area, a little warmer or cooler from house to house
        const v = 0.62 + r() * 0.2;
        const warm = (r() - 0.5) * 0.06;
        mesh.setColorAt(i, tint.setRGB(v * (1 + warm), v, v * (1 - warm)));
        this.writeMatrix(mesh, i, b);
      });
      mesh.instanceMatrix.needsUpdate = true;
      mesh.frustumCulled = false;
      mesh.name = `city:${key}`;
      this.group.add(mesh);
      this.sets.push({ mesh, items });
    }
  }

  private writeMatrix(mesh: THREE.InstancedMesh, i: number, b: Building) {
    this.q.setFromAxisAngle(b.axis, b.angle);
    if (b.sky) this.q.multiply(this.flip);
    this.q.multiply(this.qYaw.setFromAxisAngle(this.up, b.yaw));
    this.m4.compose(new THREE.Vector3(b.x, b.y, b.z), this.q, new THREE.Vector3(b.scale, b.scale, b.scale));
    mesh.setMatrixAt(i, this.m4);
  }

  /** Send a folding wave through the city from a point. */
  wave(origin: THREE.Vector3, strength = 0.35, speed = 90, dur = 1.6) {
    this.waves.push({ origin: origin.clone(), start: this.time, strength, speed, dur });
  }

  /** Back to time zero with every building upright (review shots). */
  reset() {
    this.time = 0;
    this.waves = [];
    for (const set of this.sets) {
      let dirty = false;
      set.items.forEach((b, i) => {
        if (b.angle === 0) return;
        b.angle = 0;
        this.writeMatrix(set.mesh, i, b);
        dirty = true;
      });
      if (dirty) set.mesh.instanceMatrix.needsUpdate = true;
    }
  }

  update(dt: number) {
    this.time += dt;
    if (!this.waves.length) return;
    this.waves = this.waves.filter((w) => this.time - w.start < 500 / w.speed + w.dur + 0.5);
    for (const set of this.sets) {
      let dirty = false;
      set.items.forEach((b, i) => {
        let a = 0;
        for (const w of this.waves) {
          const dist = Math.hypot(b.x - w.origin.x, b.z - w.origin.z);
          const k = (this.time - w.start - dist / w.speed) / w.dur;
          if (k > 0 && k < 1) a += w.strength * Math.sin(Math.PI * k) * (b.sky ? -1 : 1);
        }
        if (Math.abs(a - b.angle) > 1e-4) {
          b.angle = a;
          this.writeMatrix(set.mesh, i, b);
          dirty = true;
        }
      });
      if (dirty) set.mesh.instanceMatrix.needsUpdate = true;
    }
  }
}
