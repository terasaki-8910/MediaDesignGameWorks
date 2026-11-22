// Sky, lights, haze, and the background city: modelled buildings (art/blender/gen_city.py) laid out in districts of
// streets as a sea of rooftops below the walkways, and the same buildings hanging upside down as the mirrored city
// above. Fold events send a wave through both that tilts each building.
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

/** The buildings of city.glb: how often each stands in the streets, and the half-diagonal of its lot in metres. */
const VARIANTS = [
  { name: 'haussmann_a', weight: 4, lot: 24, scale: 1 },
  { name: 'haussmann_corner', weight: 2.5, lot: 24, scale: 1 },
  { name: 'haussmann_step', weight: 2.5, lot: 24, scale: 1 },
  { name: 'haussmann_low', weight: 3.2, lot: 19, scale: 1 },
  { name: 'haussmann_tall', weight: 2, lot: 23, scale: 1 },
  { name: 'haussmann_court', weight: 2, lot: 26, scale: 1 },
  { name: 'belfry', weight: 0.9, lot: 23, scale: 1 },
  { name: 'deco_hall', weight: 0.5, lot: 28, scale: 0.78 },
  { name: 'deco_tower', weight: 0.3, lot: 24, scale: 1 },
  { name: 'dome', weight: 0.35, lot: 27, scale: 1 },
] as const;

/** A street block (building plus street) in a district is about this wide and deep; each district varies it. */
const BLOCK: [number, number] = [47, 25];
/** Districts: each has its own street direction, so the city is not one grid. */
const DISTRICTS = 9;
/**
 * Lower city: the ground lies this far below y = 0. The walkways are at 12, so even from the play camera one looks
 * down onto the roofs (20 to 30 m up from the ground), which sink into the haze; only towers and domes come near.
 */
const GROUND = -54;
/**
 * Mirrored city: the buildings hang from about this height in a ring 200 to 500 m out. From the play camera (top of
 * the frame 13 degrees up) the far half of the ring hangs into the picture as a skyline; the near half is overhead.
 */
const SKY = 106;
/** Buildings nearer than this to the middle of the stage get the detailed model. */
const NEAR = 215;

interface Building { x: number; z: number; y: number; yaw: number; scale: number; axis: THREE.Vector3; angle: number; sky: boolean; id: number }
interface Wave { origin: THREE.Vector3; start: number; strength: number; speed: number; dur: number }

export class BackgroundCity {
  readonly group = new THREE.Group();
  private items: Building[] = [];
  private mesh: THREE.BatchedMesh | null = null;
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
    const placed: { b: Building; key: string; lot: number }[] = [];
    const total = VARIANTS.reduce((s, v) => s + v.weight, 0);
    const pick = () => {
      let k = r() * total;
      for (const v of VARIANTS) if ((k -= v.weight) <= 0) return v;
      return VARIANTS[0];
    };
    /**
     * One layer of city between two radii. Districts are the cells of a Voronoi diagram; each lays its blocks on its
     * own turned grid with its own block size and ground level. Lots that would touch one already built are left
     * empty, as are those on the avenue (an arc through the city) and, in the lower city, under the play space.
     */
    const lay = (sky: boolean, inner: number, outer: number, keep: number) => {
      const first = placed.length;
      const seeds = Array.from({ length: DISTRICTS }, () => {
        const a = r() * Math.PI * 2;
        const d = inner + (outer - inner) * Math.sqrt(r());
        return {
          x: this.center.x + Math.cos(a) * d, z: this.center.z + Math.sin(a) * d, turn: r() * Math.PI,
          bx: BLOCK[0] * (0.92 + r() * 0.3) * (sky ? 1.15 : 1), bz: BLOCK[1] * (0.9 + r() * 0.5) * (sky ? 1.3 : 1), level: (r() - 0.5) * 12,
        };
      });
      const avenue = { x: this.center.x + (r() - 0.5) * 200, z: this.center.z + 320 + r() * 120, radius: 330 + r() * 80 };
      seeds.forEach((s, k) => {
        const cos = Math.cos(s.turn);
        const sin = Math.sin(s.turn);
        const n = Math.ceil((outer * 2) / Math.min(s.bx, s.bz));
        for (let i = -n; i <= n; i++)
          for (let j = -n; j <= n; j++) {
            const v = pick();
            const jit = [r(), r(), r(), r(), r(), r()];
            const gx = i * s.bx + (j % 2 ? s.bx * 0.37 : 0) + (jit[0] - 0.5) * 5;
            const gz = j * s.bz + (jit[1] - 0.5) * 4;
            const x = s.x + gx * cos - gz * sin;
            const z = s.z + gx * sin + gz * cos;
            const rad = Math.hypot(x - this.center.x, z - this.center.z);
            if (jit[3] > keep || rad < inner || rad > outer) continue;
            // this lot belongs to the nearest district
            let near = k;
            let best = Math.hypot(x - s.x, z - s.z);
            seeds.forEach((o, m) => {
              const d = Math.hypot(x - o.x, z - o.z);
              if (d < best) [near, best] = [m, d];
            });
            if (near !== k) continue;
            if (Math.abs(Math.hypot(x - avenue.x, z - avenue.z) - avenue.radius) < 20) continue;
            if (!sky && this.exclude.containsPoint(new THREE.Vector3(x, 0, z))) continue;
            const scale = v.scale * (0.9 + jit[4] * 0.22);
            const lot = v.lot * scale;
            let free = true;
            for (let m = first; m < placed.length && free; m++) free = Math.hypot(x - placed[m].b.x, z - placed[m].b.z) > (lot + placed[m].lot) * 0.66;
            if (!free) continue;
            const radial = new THREE.Vector3(x - this.center.x, 0, z - this.center.z).normalize();
            const b: Building = {
              x, z,
              // the ground steps from district to district and a little from lot to lot: no two rooflines level
              y: sky ? SKY - s.level + jit[5] * 8 : GROUND + s.level + (jit[5] - 0.5) * 5 - ((rad - inner) / (outer - inner)) * 6,
              yaw: -s.turn + (jit[2] < 0.5 ? 0 : Math.PI) + (jit[2] - 0.5) * 0.1,
              scale,
              axis: new THREE.Vector3(-radial.z, 0, radial.x), // tilt away from the centre
              angle: 0,
              sky,
              id: -1,
            };
            placed.push({ b, key: `${v.name}_lod${!sky && rad < NEAR ? 0 : 1}`, lot });
          }
      });
    };
    lay(false, r0 - 12, r1, 0.95);
    lay(true, r0 + 120, r1 + 140, 0.62);

    // one batch for the whole city: every building is an instance of one of the twenty models, drawn in one call
    const models = new Map<string, THREE.Mesh>();
    let vertices = 0;
    let indices = 0;
    for (const key of new Set(placed.map((p) => p.key))) {
      const src = gltf.scene.getObjectByName(key) as THREE.Mesh | undefined;
      if (!src?.isMesh) throw new Error(`city.glb has no mesh "${key}"`);
      models.set(key, src);
      vertices += src.geometry.getAttribute('position').count;
      indices += src.geometry.index!.count;
    }
    const material = [...models.values()][0].material as THREE.MeshStandardMaterial;
    if (material.map) material.map.anisotropy = 4;
    const mesh = new THREE.BatchedMesh(placed.length, vertices, indices, material);
    mesh.sortObjects = false;
    mesh.name = 'city';
    const geometryIds = new Map<string, number>();
    for (const [key, src] of models) geometryIds.set(key, mesh.addGeometry(src.geometry));
    const tint = new THREE.Color();
    for (const p of placed) {
      p.b.id = mesh.addInstance(geometryIds.get(p.key)!);
      // about 6 % lighter or darker from house to house, a little warmer or cooler; all below the play area's values
      const v = 0.7 * (0.94 + r() * 0.12);
      const warm = (r() - 0.5) * 0.06;
      mesh.setColorAt(p.b.id, tint.setRGB(v * (1 + warm), v, v * (1 - warm)));
      this.items.push(p.b);
    }
    this.mesh = mesh;
    for (const b of this.items) this.writeMatrix(b);
    this.group.add(mesh);
  }

  private writeMatrix(b: Building) {
    this.q.setFromAxisAngle(b.axis, b.angle);
    if (b.sky) this.q.multiply(this.flip);
    this.q.multiply(this.qYaw.setFromAxisAngle(this.up, b.yaw));
    this.m4.compose(new THREE.Vector3(b.x, b.y, b.z), this.q, new THREE.Vector3(b.scale, b.scale, b.scale));
    this.mesh!.setMatrixAt(b.id, this.m4);
  }

  /** Send a folding wave through the city from a point. */
  wave(origin: THREE.Vector3, strength = 0.35, speed = 90, dur = 1.6) {
    this.waves.push({ origin: origin.clone(), start: this.time, strength, speed, dur });
  }

  /** Back to time zero with every building upright (review shots). */
  reset() {
    this.time = 0;
    this.waves = [];
    for (const b of this.items) {
      if (b.angle === 0) continue;
      b.angle = 0;
      this.writeMatrix(b);
    }
  }

  update(dt: number) {
    this.time += dt;
    if (!this.waves.length || !this.mesh) return;
    this.waves = this.waves.filter((w) => this.time - w.start < 500 / w.speed + w.dur + 0.5);
    for (const b of this.items) {
      let a = 0;
      for (const w of this.waves) {
        const dist = Math.hypot(b.x - w.origin.x, b.z - w.origin.z);
        const k = (this.time - w.start - dist / w.speed) / w.dur;
        if (k > 0 && k < 1) a += w.strength * Math.sin(Math.PI * k) * (b.sky ? -1 : 1);
      }
      if (Math.abs(a - b.angle) > 1e-4) {
        b.angle = a;
        this.writeMatrix(b);
      }
    }
  }
}
