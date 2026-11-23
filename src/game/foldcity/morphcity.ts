// The folded city of the game: one sheet of streets and buildings (sheet.ts, morphplan.ts) that shows a different
// structure in each puzzle section and folds from one into the next when a section is cleared. The ground is one mesh
// whose vertices follow the sheet, the buildings are one BatchedMesh whose instances ride it.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { VisualTheme } from '../../core/types.ts';
import { atmosphereUniforms, bindSky, keyTurn, patchShader, type AtmosphereUniforms } from './atmosphere.ts';
import { ATMOSPHERE, type Background } from './foldcity.ts';
import { buildSheetGround, type SheetGround } from './ground.ts';
import { footprint } from './layout.ts';
import { meshName, MODELS } from './models.ts';
import { heightAt, planSteps, type KeepOut, type MorphBuilding, type MorphPlan } from './morphplan.ts';
import { SECTION_STRUCTURE, type Freeze } from './progression.ts';
import { rng } from './rng.ts';
import { blendState, copyState, makeState, restState, sheetFrame, STRUCTURES, type SheetState, type StructureName } from './sheet.ts';
import { makeFrame } from './surfaces.ts';

/** A fold from one structure into the next takes this long; with reduced motion the city fades out and back in instead. */
export const MORPH_SECONDS = 4;
const FADE_SECONDS = 0.35;

/** Let the page draw a frame's worth of other work. Not a timer: the capture's virtual clock holds timers back. */
const breathe = () =>
  new Promise<void>((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => resolve();
    channel.port2.postMessage(0);
  });

interface Item {
  b: MorphBuilding;
  id: number;
  geometry: [number, number];
  lod: 0 | 1;
  /** Its footprint along a and b. */
  foot: [number, number];
  /** The frame it stands in now, its height factor (0 = not shown) and how far its base is sunk. */
  p: THREE.Vector3;
  x: THREE.Vector3;
  n: THREE.Vector3;
  z: THREE.Vector3;
  h: number;
  sink: number;
  angle: number;
  axis: THREE.Vector3;
}
interface Wave { origin: THREE.Vector3; start: number; strength: number; speed: number; dur: number }

const MAX_TILT = 0.09;
const EXTRA_SINK = 1.4;

export interface MorphCityOptions {
  /** Squares of sheet to keep free of buildings (the piers' feet). */
  keepOut?: readonly KeepOut[];
  /** Show this structure in every section (`?city=<name>`). */
  pin?: StructureName;
  freeze?: Freeze | null;
  /** Fold on and on through every structure and back (`?morph=loop`), to measure the frame time of a fold. */
  loop?: boolean;
  /** `?bgdebug=facing`: paint the background by class instead of lighting it (atmosphere.ts, bgFacing). */
  debug?: boolean;
}

export class MorphCity implements Background {
  readonly group = new THREE.Group();
  plan: MorphPlan | null = null;
  stats = { instances: 0, groundTriangles: 0 };
  /** How long the folds' warm-up took at load, in ms. */
  warmMs = 0;
  private readonly theme: VisualTheme;
  private readonly opts: MorphCityOptions;
  private items: Item[] = [];
  private mesh: THREE.BatchedMesh | null = null;
  private ground: SheetGround | null = null;
  private atm: AtmosphereUniforms | null = null;
  private waves: Wave[] = [];
  private time = 0;
  /** What is shown: structure `from` at rest, or a fraction `f` of the way to `to`. */
  private from = 0;
  private to = 0;
  private f = 0;
  /** A fold under way (seconds run), or a fade (reduced motion): out, switch, in. */
  private morph: { t: number } | null = null;
  private fade: { t: number; target: number; switched: boolean } | null = null;
  private loopStep = 1;
  private readonly state: SheetState = makeState();
  private readonly frame = makeFrame();
  private readonly m4 = new THREE.Matrix4();
  private readonly m5 = new THREE.Matrix4();
  private readonly tmp = new THREE.Vector3();
  private readonly t1 = new THREE.Vector3();
  private readonly t2 = new THREE.Vector3();
  private readonly t3 = new THREE.Vector3();

  constructor(theme: VisualTheme, opts: MorphCityOptions = {}) {
    this.theme = theme;
    this.opts = opts;
    if (opts.freeze) ({ from: this.from, to: this.to, f: this.f } = opts.freeze);
    else this.from = this.to = this.structureOf(0);
  }

  private structureOf(section: number): number {
    const name = this.opts.pin ?? SECTION_STRUCTURE[Math.min(Math.max(section, 0), SECTION_STRUCTURE.length - 1)];
    return STRUCTURES.indexOf(name);
  }

  async load(url: string) {
    // the buildings, and beside them the props (trees, fountains, the piers' feet): one batch, the buildings' material
    const loader = new GLTFLoader();
    const [gltf, props] = await Promise.all([loader.loadAsync(url), loader.loadAsync(url.replace(/city\.glb$/, 'cityprops.glb'))]);
    // planned a step at a time, so the page keeps drawing while it loads
    const steps = planSteps(this.theme.city.seed, this.opts.keepOut);
    let step = steps.next();
    while (!step.done) {
      await breathe();
      step = steps.next();
    }
    const plan = step.value;
    this.plan = plan;
    const atm = atmosphereUniforms(ATMOSPHERE);
    this.atm = atm;
    if (this.opts.debug) atm.uBgDebug.value = 1;

    const ground = buildSheetGround(plan.lattice, atm);
    ground.mesh.onBeforeRender = (_r, scene) => bindSky(atm, scene);
    this.ground = ground;
    this.stats.groundTriangles = ground.triangles;
    this.group.add(ground.mesh);

    const list = plan.buildings.filter((b) => b.alive.some(Boolean));
    const sources = new Map<string, THREE.Mesh>();
    let vertices = 0;
    let indices = 0;
    for (const b of list)
      for (const lod of [0, 1] as const) {
        const m = MODELS[b.model];
        const key = meshName(m, lod);
        if (sources.has(key)) continue;
        const src = (m.props ? props : gltf).scene.getObjectByName(key) as THREE.Mesh | undefined;
        if (!src?.isMesh) throw new Error(`${m.props ? 'cityprops.glb' : 'city.glb'} has no mesh "${key}"`);
        sources.set(key, src);
        vertices += src.geometry.getAttribute('position').count;
        indices += src.geometry.index!.count;
      }
    for (const m of MODELS) {
      const src = sources.get(meshName(m, 0));
      if (!src) continue;
      src.geometry.computeBoundingBox();
      const bb = src.geometry.boundingBox!;
      const off = Math.abs(bb.max.x - bb.min.x - m.w) + Math.abs(bb.max.z - bb.min.z - m.d) + Math.abs(bb.max.y - m.h);
      const centre = Math.abs((bb.max.x + bb.min.x) / 2 - m.cx) + Math.abs((bb.max.z + bb.min.z) / 2 - m.cz);
      if (off + centre > 1.5) console.warn(`foldcity/models.ts disagrees with the GLB for ${m.name} (off by ${(off + centre).toFixed(1)} m)`);
    }
    const material = (gltf.scene.getObjectByName(meshName(MODELS[0], 0)) as THREE.Mesh).material as THREE.MeshStandardMaterial;
    material.fog = false;
    if (material.map) material.map.anisotropy = 4;
    material.onBeforeCompile = (shader) => patchShader(shader, atm);
    material.customProgramCacheKey = () => 'foldcity-buildings';

    const mesh = new THREE.BatchedMesh(list.length, vertices, indices, material);
    mesh.sortObjects = false;
    mesh.frustumCulled = false; // its instances move with the sheet; each is still culled on its own
    mesh.name = 'foldcity-buildings';
    mesh.renderOrder = 1; // after the play area, before the ground
    const ids = new Map<string, number>();
    for (const [key, src] of sources) ids.set(key, mesh.addGeometry(src.geometry));
    const rTint = rng(this.theme.city.seed * 13 + 5);
    const tint = new THREE.Vector4();
    for (const b of list) {
      const geometry: [number, number] = [ids.get(meshName(MODELS[b.model], 0))!, ids.get(meshName(MODELS[b.model], 1))!];
      const id = mesh.addInstance(geometry[1]);
      mesh.setVisibleAt(id, false); // until the first pose puts it on the sheet
      const v = 0.94 * (0.94 + rTint() * 0.12);
      const warm = (rTint() - 0.5) * 0.06;
      // the alpha carries where the key light stands for this building (atmosphere.ts)
      mesh.setColorAt(id, tint.set(v * (1 + warm), v, v * (1 - warm), keyTurn(b.lot.swap, b.lot.flip)));
      this.items.push({
        b, id, geometry, lod: 1, foot: footprint(MODELS[b.model], b.lot.scale, b.lot.swap, b.lot.stretch), p: new THREE.Vector3(), x: new THREE.Vector3(1, 0, 0), n: new THREE.Vector3(0, 1, 0), z: new THREE.Vector3(0, 0, 1),
        h: 0, sink: 0.5, angle: 0, axis: new THREE.Vector3(1, 0, 0),
      });
    }
    this.stats.instances = list.length;
    this.mesh = mesh;
    this.group.add(mesh);
    this.warm();
    this.pose();
  }

  /**
   * Run every fold once, a few fractions each way, before the city is first shown: the fold's code is compiled and its
   * tables have been through the blend by the time a player clears the first section. Costs a few poses at load.
   */
  private warm() {
    const t0 = performance.now();
    const shown = { from: this.from, to: this.to, f: this.f };
    for (let k = 0; k < 3; k++)
      for (let i = 0; i + 1 < STRUCTURES.length; i++)
        for (const [from, to] of [[i, i + 1], [i + 1, i]])
          for (const f of [0.15, 0.5, 0.85]) {
            Object.assign(this, { from, to, f });
            this.pose();
          }
    Object.assign(this, shown);
    this.warmMs = performance.now() - t0;
  }

  /**
   * The game entered a section. `fold` folds the city there from the structure before it (when the two are neighbours);
   * otherwise, and in the review shots, it is simply there. `reduceMotion` replaces the fold by a short fade.
   */
  setSection(section: number, fold = false, reduceMotion = false) {
    if (this.opts.freeze || this.opts.loop) return;
    const target = this.structureOf(section);
    const shown = this.morph || this.from !== this.to ? this.to : this.from;
    if (this.fade && fold && reduceMotion) {
      this.fade.target = target;
      return;
    }
    if (target === shown && !this.fade) return;
    if (fold && reduceMotion) {
      this.rest(shown);
      this.fade = { t: 0, target, switched: false };
    } else if (fold && Math.abs(target - shown) === 1) {
      this.rest(shown);
      this.to = target;
      this.morph = { t: 0 };
    } else {
      this.fade = null;
      this.setVeil(0);
      this.rest(target);
    }
  }

  private rest(structure: number) {
    this.morph = null;
    if (this.from === structure && this.to === structure && this.f === 0) return;
    this.from = this.to = structure;
    this.f = 0;
    this.pose();
  }

  private setVeil(v: number) {
    if (this.atm) this.atm.uBgVeil.value = v;
  }

  /** Put the ground and every building where the current structure, or the current fraction of a fold, has them. */
  private pose() {
    if (!this.mesh || !this.ground) return;
    const resting = this.from === this.to || this.f <= 0;
    const arrived = this.from !== this.to && this.f >= 1;
    const at = arrived ? this.to : this.from;
    // the plan's transitions run forwards (STRUCTURES[i] to STRUCTURES[i + 1]); a fold back reads them in reverse
    const ti = Math.min(this.from, this.to);
    const fwd = this.from < this.to ? this.f : 1 - this.f;
    if (resting || arrived) copyState(restState(STRUCTURES[at]), this.state);
    else blendState({ from: STRUCTURES[this.from], to: STRUCTURES[this.to] }, this.f, this.state);
    this.ground.update(this.state);
    const still = resting || arrived;
    for (const it of this.items) {
      const { b } = it;
      const h = still ? (b.alive[at] ? b.sy[at] : 0) : heightAt(b, ti, fwd);
      if (h <= 0) {
        if (it.h > 0) this.mesh.setVisibleAt(it.id, false);
        it.h = 0;
        continue;
      }
      const lod = still ? b.lod[at] : b.lod[fwd < 0.5 ? ti : ti + 1];
      if (lod !== it.lod) {
        this.mesh.setGeometryIdAt(it.id, it.geometry[lod]);
        it.lod = lod;
      }
      if (it.h <= 0) this.mesh.setVisibleAt(it.id, true);
      it.h = h;
      const f = sheetFrame(this.state, b.lot.u, b.lot.v, this.frame);
      it.p.copy(f.p);
      it.n.copy(f.n);
      it.x.copy(b.lot.swap ? f.ev : f.eu).multiplyScalar(b.lot.flip ? -1 : 1);
      it.z.crossVectors(it.x, it.n);
      // while the sheet bends its curl lies between the two structures', and so does the seat (nothing jumps on arrival)
      if (still) it.sink = b.sink[at];
      else if (b.alive[ti] && b.alive[ti + 1]) it.sink = b.sink[ti] + (b.sink[ti + 1] - b.sink[ti]) * fwd;
      else it.sink = b.alive[ti] ? b.sink[ti] : b.sink[ti + 1];
      this.write(it);
    }
  }

  /** Compose a building's matrix: its frame on the sheet, sunk, at its height, tilted by its wave angle about its base. */
  private write(it: Item) {
    const m = MODELS[it.b.model];
    const s = it.b.lot.scale;
    const sx = s * (it.b.lot.stretch ?? 1);
    this.m4.makeBasis(this.t1.copy(it.x).multiplyScalar(sx), this.t2.copy(it.n).multiplyScalar(s * it.h), this.t3.copy(it.z).multiplyScalar(s));
    this.tmp.set(0, 0, 0).addScaledVector(it.x, -m.cx * sx).addScaledVector(it.z, -m.cz * s).addScaledVector(it.n, -(it.sink + EXTRA_SINK));
    this.m4.setPosition(this.tmp);
    if (it.angle !== 0) {
      this.m5.makeRotationAxis(it.axis, it.angle).multiply(this.m4);
      this.m4.copy(this.m5);
    }
    const e = this.m4.elements;
    this.m4.setPosition(e[12] + it.p.x, e[13] + it.p.y, e[14] + it.p.z);
    this.mesh!.setMatrixAt(it.id, this.m4);
  }

  wave(origin: THREE.Vector3, strength = 0.35, speed = 90, dur = 1.6) {
    this.waves.push({ origin: origin.clone(), start: this.time, strength, speed, dur });
  }

  /** Back to time zero: no wave, no fold under way (the city rests in the structure it was folding to). */
  reset() {
    this.time = 0;
    this.waves = [];
    for (const it of this.items) it.angle = 0;
    this.fade = null;
    this.setVeil(0);
    if (this.opts.freeze) {
      ({ from: this.from, to: this.to, f: this.f } = this.opts.freeze);
      this.pose();
    } else {
      const target = this.to;
      this.from = -1; // force the pose: the waves' tilts are gone
      this.rest(target);
    }
  }

  update(dt: number) {
    this.time += dt;
    if (this.atm && this.group.parent) bindSky(this.atm, this.group.parent as THREE.Scene);
    if (!this.mesh) return;
    let posed = false;
    if (this.opts.loop && !this.morph) {
      if (this.to + this.loopStep < 0 || this.to + this.loopStep >= STRUCTURES.length) this.loopStep = -this.loopStep;
      this.from = this.to;
      this.to += this.loopStep;
      this.f = 0;
      this.morph = { t: 0 };
    }
    if (this.morph) {
      this.morph.t += dt;
      this.f = Math.min(1, this.morph.t / MORPH_SECONDS);
      if (this.f >= 1) {
        const target = this.to;
        this.from = -1;
        this.rest(target);
      } else this.pose();
      posed = true;
    } else if (this.fade) {
      this.fade.t += dt;
      const k = this.fade.t / FADE_SECONDS;
      if (k >= 1 && !this.fade.switched) {
        this.fade.switched = true;
        this.rest(this.fade.target);
        posed = true;
      }
      this.setVeil(k < 1 ? k : Math.max(0, 2 - k));
      if (k >= 2) this.fade = null;
    }
    if (!this.waves.length) return;
    this.waves = this.waves.filter((w) => this.time - w.start < 1800 / w.speed + w.dur + 0.5);
    for (const it of this.items) {
      if (it.h <= 0) continue;
      let a = 0;
      for (const w of this.waves) {
        const dist = it.p.distanceTo(w.origin);
        // far buildings are answered sooner than their distance says
        const k = (this.time - w.start - dist / (w.speed * (1 + dist / 300))) / w.dur;
        if (k > 0 && k < 1) {
          a += w.strength * 0.3 * Math.sin(Math.PI * k);
          this.tmp.subVectors(it.p, w.origin);
          this.tmp.addScaledVector(it.n, -this.tmp.dot(it.n));
          if (this.tmp.lengthSq() > 1e-6) it.axis.crossVectors(it.n, this.tmp).normalize();
        }
      }
      a = Math.max(-MAX_TILT, Math.min(MAX_TILT, a));
      if (Math.abs(a - it.angle) > 1e-4 || (posed && a !== 0)) {
        it.angle = a;
        this.write(it);
      }
    }
  }
}
