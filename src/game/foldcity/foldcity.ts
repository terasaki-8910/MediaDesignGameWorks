// The folded city: the street sheet on its surface (ground.ts), the buildings of city.glb standing on it as one
// BatchedMesh (plan.ts decides where), under the background's own haze (atmosphere.ts). This class shows one of the
// studies of variants.ts, fixed (?city=corner, ringx, warp); the game's own city, which folds from section to section, is
// MorphCity (morphcity.ts).
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { VisualTheme } from '../../core/types.ts';
import { atmosphereUniforms, bindSky, keyTurn, patchShader, type AtmosphereParams, type AtmosphereUniforms } from './atmosphere.ts';
import { buildGround } from './ground.ts';
import { meshName, MODELS } from './models.ts';
import { planCity, type Building, type CityPlan } from './plan.ts';
import { rng } from './rng.ts';
import type { VariantDef } from './variants.ts';

/** What the game needs of a background city. */
export interface Background {
  readonly group: THREE.Group;
  load(url: string): Promise<void>;
  /** Send a folding wave through the city from a point. */
  wave(origin: THREE.Vector3, strength?: number, speed?: number, dur?: number): void;
  /** Back to time zero with every building upright (review shots). */
  reset(): void;
  /** The game entered section `index`; `fold` asks for the fold from the section before (a short fade with `reduceMotion`). */
  setSection?(index: number, fold?: boolean, reduceMotion?: boolean): void;
  update(dt: number): void;
}

/** `sink` is slight: the city's ground is meant to be seen, and a haze that follows world height would differ between a floor, a wall and a ceiling of the same sheet. */
export const ATMOSPHERE: AtmosphereParams = { density: 0.0021, strength: 1, gain: 0.6, saturation: 0.72, lift: 0.09, sink: 0.12, base: 0.1 };

interface Item {
  b: Building;
  id: number;
  angle: number;
  axis: THREE.Vector3;
}
interface Wave { origin: THREE.Vector3; start: number; strength: number; speed: number; dur: number }

/** Largest tilt a wave gives a building (radians): it stays joined to the ground by its sunk base. */
const MAX_TILT = 0.09;
/** Every building is sunk this much deeper than its footprint needs, so a tilting wave never lifts its base off the ground. */
const EXTRA_SINK = 1.4;

export class FoldCity implements Background {
  readonly group = new THREE.Group();
  /** Filled by load(): what was built, for the budget log and the tests. */
  plan: CityPlan | null = null;
  stats = { instances: 0, triangles: 0, groundTriangles: 0 };
  private items: Item[] = [];
  private mesh: THREE.BatchedMesh | null = null;
  private waves: Wave[] = [];
  private time = 0;
  private readonly def: VariantDef;
  private atm: AtmosphereUniforms | null = null;
  private readonly theme: VisualTheme;
  private readonly m4 = new THREE.Matrix4();
  private readonly m5 = new THREE.Matrix4();
  private readonly tmp = new THREE.Vector3();
  private readonly t1 = new THREE.Vector3();
  private readonly t2 = new THREE.Vector3();
  private readonly t3 = new THREE.Vector3();

  constructor(def: VariantDef, theme: VisualTheme) {
    this.def = def;
    this.theme = theme;
  }

  async load(url: string) {
    const gltf = await new GLTFLoader().loadAsync(url);
    const plan = planCity(this.def, this.theme.city.seed);
    this.plan = plan;
    const atm = atmosphereUniforms({ ...ATMOSPHERE, ...this.def.atmosphere });
    this.atm = atm;

    // the ground first: it needs no model
    for (const face of plan.faces) {
      const ground = buildGround({ surface: face.surface, sign: face.sign, lattice: face.lattice, uniforms: atm, doubleSide: this.def.underside });
      this.stats.groundTriangles += ground.userData.triangles as number;
      ground.onBeforeRender = (_r, scene) => bindSky(atm, scene);
      this.group.add(ground);
    }

    const used = new Set(plan.buildings.map((b) => meshName(MODELS[b.model], b.lod)));
    const sources = new Map<string, THREE.Mesh>();
    let vertices = 0;
    let indices = 0;
    for (const key of used) {
      const src = gltf.scene.getObjectByName(key) as THREE.Mesh | undefined;
      if (!src?.isMesh) throw new Error(`city.glb has no mesh "${key}"`);
      sources.set(key, src);
      vertices += src.geometry.getAttribute('position').count;
      indices += src.geometry.index!.count;
    }
    // the layout's table of footprints must still match the file
    for (const m of MODELS) {
      const src = gltf.scene.getObjectByName(meshName(m, 0)) as THREE.Mesh | undefined;
      if (!src?.isMesh) continue;
      src.geometry.computeBoundingBox();
      const bb = src.geometry.boundingBox!;
      const off = Math.abs(bb.max.x - bb.min.x - m.w) + Math.abs(bb.max.z - bb.min.z - m.d) + Math.abs(bb.max.y - m.h);
      if (off > 1.5) console.warn(`foldcity/models.ts disagrees with city.glb for ${m.name} (off by ${off.toFixed(1)} m)`);
    }
    const first = [...sources.values()][0];
    const material = (first.material as THREE.MeshStandardMaterial).clone();
    material.fog = false;
    if (material.map) material.map.anisotropy = 4;
    material.onBeforeCompile = (shader) => patchShader(shader, atm);
    material.customProgramCacheKey = () => 'foldcity-buildings';

    const mesh = new THREE.BatchedMesh(plan.buildings.length, vertices, indices, material);
    mesh.sortObjects = false;
    mesh.name = 'foldcity-buildings';
    const ids = new Map<string, number>();
    for (const [key, src] of sources) ids.set(key, mesh.addGeometry(src.geometry));
    const rTint = rng(this.theme.city.seed * 13 + 5);
    const tint = new THREE.Vector4();
    let tris = 0;
    for (const b of plan.buildings) {
      const key = meshName(MODELS[b.model], b.lod);
      const id = mesh.addInstance(ids.get(key)!);
      tris += sources.get(key)!.geometry.index!.count / 3;
      const v = 0.78 * (0.94 + rTint() * 0.12);
      const warm = (rTint() - 0.5) * 0.06;
      mesh.setColorAt(id, tint.set(v * (1 + warm), v, v * (1 - warm), keyTurn(b.lot.swap, b.lot.flip)));
      this.items.push({ b, id, angle: 0, axis: new THREE.Vector3() });
    }
    this.stats.instances = plan.buildings.length;
    this.stats.triangles = tris;
    this.mesh = mesh;
    for (const it of this.items) this.write(it, 0);
    this.group.add(mesh);
  }

  /** Compose a building's matrix: its frame on the surface, sunk, and tilted by `angle` about its base. */
  private write(it: Item, angle: number) {
    const { b } = it;
    const m = MODELS[b.model];
    const s = b.scale;
    const sx = s * (b.lot.stretch ?? 1);
    this.m4.makeBasis(this.t1.copy(b.x).multiplyScalar(sx), this.t2.copy(b.n).multiplyScalar(s * b.sy), this.t3.copy(b.z).multiplyScalar(s));
    // the model's origin relative to the footprint centre, sunk into the surface
    this.tmp.set(0, 0, 0).addScaledVector(b.x, -m.cx * sx).addScaledVector(b.z, -m.cz * s).addScaledVector(b.n, -(b.sink + EXTRA_SINK));
    this.m4.setPosition(this.tmp);
    if (angle !== 0) {
      this.m5.makeRotationAxis(it.axis, angle).multiply(this.m4);
      this.m4.copy(this.m5);
    }
    const e = this.m4.elements;
    this.m4.setPosition(e[12] + b.p.x, e[13] + b.p.y, e[14] + b.p.z);
    this.mesh!.setMatrixAt(it.id, this.m4);
  }

  wave(origin: THREE.Vector3, strength = 0.35, speed = 90, dur = 1.6) {
    this.waves.push({ origin: origin.clone(), start: this.time, strength, speed, dur });
  }

  reset() {
    this.time = 0;
    this.waves = [];
    for (const it of this.items) {
      if (it.angle === 0) continue;
      it.angle = 0;
      this.write(it, 0);
    }
  }

  update(dt: number) {
    this.time += dt;
    if (this.atm && this.group.parent) bindSky(this.atm, this.group.parent as THREE.Scene);
    if (!this.waves.length || !this.mesh) return;
    this.waves = this.waves.filter((w) => this.time - w.start < 1800 / w.speed + w.dur + 0.5);
    for (const it of this.items) {
      let a = 0;
      for (const w of this.waves) {
        const dist = it.b.p.distanceTo(w.origin);
        // far buildings are answered sooner than their distance says
        const k = (this.time - w.start - dist / (w.speed * (1 + dist / 300))) / w.dur;
        if (k > 0 && k < 1) {
          a += w.strength * 0.3 * Math.sin(Math.PI * k);
          this.tmp.subVectors(it.b.p, w.origin);
          this.tmp.addScaledVector(it.b.n, -this.tmp.dot(it.b.n));
          if (this.tmp.lengthSq() > 1e-6) it.axis.crossVectors(it.b.n, this.tmp).normalize();
        }
      }
      a = Math.max(-MAX_TILT, Math.min(MAX_TILT, a));
      if (Math.abs(a - it.angle) > 1e-4) {
        it.angle = a;
        this.write(it, a);
      }
    }
  }
}
