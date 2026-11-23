// Sky, lights, haze, and the background city: modelled buildings (art/blender/gen_city.py) laid out in districts of
// streets as a sea of rooftops below the walkways, and the same buildings hanging upside down from a crust of rock
// far overhead (crust.ts). Fold events send a wave through both that tilts each building.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { VisualTheme } from '../core/types.ts';
import { Crust } from './crust.ts';
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

/**
 * The hanging city is seen from far below and far off: only roofs read, so the domes, towers and spires weigh more than
 * in the streets and every kind of roof is there.
 */
const SKY_WEIGHT: Record<string, number> = {
  haussmann_a: 3, haussmann_corner: 2.4, haussmann_step: 2.4, haussmann_low: 2, haussmann_tall: 2.4, haussmann_court: 1.4,
  belfry: 2.2, deco_hall: 0.8, deco_tower: 1.2, dome: 1.9,
};

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
 * Mirrored city: a ring of rock (the crust) at this height and radii, with the buildings, larger than the streets' so their
 * roofs read from here, hanging from its underside. From the play camera (top of the frame 13 degrees up) one sees the
 * lower part of the far half of the ring as a skyline of roofs; the haze takes it into the sky towards the horizon.
 */
const SKY = { y: 150, inner: 700, outer: 1450, scale: 1.7, districts: 12, edge: 70, detail: 950 };
/** Buildings nearer than this to the middle of the stage get the detailed model (the hanging city: `SKY.detail`). */
const NEAR = 215;

interface Building { kind: string; x: number; z: number; y: number; yaw: number; scale: number; axis: THREE.Vector3; angle: number; sky: boolean; id: number }
interface Wave { origin: THREE.Vector3; start: number; strength: number; speed: number; dur: number }
/** A building in the layout: which model, which level of detail, and the radius of its lot. */
interface Placed { b: Building; name: string; lod: 0 | 1; lot: number }

/** Landmarks must not stand twice the same way close together (the eye sees the copy at once). */
const LANDMARKS = new Set(['belfry', 'dome', 'deco_tower', 'deco_hall', 'haussmann_corner', 'haussmann_step', 'haussmann_court']);
/** The ordinary blocks may stand in a row, but not as identical neighbours: the next smaller kind replaces the second. */
const SWAP: Record<string, string> = { haussmann_a: 'haussmann_low', haussmann_tall: 'haussmann_low' };
/** A landmark right beside one of its own kind becomes this other landmark (about the same lot). */
const NEIGHBOUR_KIND: Record<string, string> = { belfry: 'haussmann_corner', dome: 'haussmann_step', deco_tower: 'haussmann_tall', deco_hall: 'haussmann_court' };
/** Turn symmetry of a model: a 2-fold one looks the same after half a turn. */
const SYMMETRY: Record<string, number> = { haussmann_a: Math.PI, haussmann_low: Math.PI, haussmann_tall: Math.PI, deco_hall: Math.PI, dome: Math.PI / 2, deco_tower: Math.PI / 2 };

const turnApart = (a: number, b: number, period: number) => {
  const d = Math.abs(((a - b) % period + period) % period);
  return Math.min(d, period - d);
};

/**
 * No two neighbours of one model stand identically: a landmark right beside another of its kind becomes another landmark;
 * one within `range` of it is turned in quarter turns to a heading apart from theirs and given a different height; an ordinary block
 * beside one of its own kind in the same heading becomes the next smaller kind, or, with none, lower. Deterministic
 * and in layout order, so the streets themselves are not disturbed.
 */
function untwin(list: Placed[], ranges: { street: number; sky: number }) {
  for (const sky of [false, true]) {
    const group = list.filter((p) => p.b.sky === sky);
    const range = sky ? ranges.sky : ranges.street;
    group.forEach((p, i) => {
      const near = group.slice(0, i).filter((q) => q.name === p.name && Math.hypot(q.b.x - p.b.x, q.b.z - p.b.z) < (LANDMARKS.has(p.name) ? range : (p.lot + q.lot) * 0.8));
      if (!near.length) return;
      const period = SYMMETRY[p.name] ?? Math.PI * 2;
      const apart = (yaw: number) => Math.min(...near.map((q) => turnApart(q.b.yaw, yaw, period)));
      const close = near.some((q) => Math.hypot(q.b.x - p.b.x, q.b.z - p.b.z) < range * 0.4);
      if (LANDMARKS.has(p.name) && close && NEIGHBOUR_KIND[p.name]) {
        const was = VARIANTS.find((v) => v.name === p.name)!.scale;
        p.name = NEIGHBOUR_KIND[p.name];
        p.b.scale *= VARIANTS.find((v) => v.name === p.name)!.scale / was;
      } else if (LANDMARKS.has(p.name)) {
        // quarter turns (a right angle first: it shows the most different side from above) to a heading well apart from every neighbour's
        let best = p.b.yaw;
        let gap = apart(best);
        for (const k of [0, 1, 3, 2]) {
          const yaw = p.b.yaw + (k * Math.PI) / 2;
          if (apart(yaw) > gap + 1e-6) [best, gap] = [yaw, apart(yaw)];
          if (gap >= 1) break;
        }
        p.b.yaw = best;
        // and a different height: not within 7 % of a neighbour's, never below three quarters of the model's size
        const own = VARIANTS.find((v) => v.name === p.name)!.scale;
        if (near.some((q) => Math.abs(q.b.scale - p.b.scale) / p.b.scale < 0.07)) {
          p.b.scale = Math.max(0.74 * own, Math.min(p.b.scale, ...near.map((q) => q.b.scale)) * 0.86);
        }
      } else if (apart(p.b.yaw) < 0.5) {
        const swap = SWAP[p.name];
        if (swap) p.name = swap;
        else p.b.scale *= 0.88;
      }
    });
  }
}

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
    const seed = this.theme.city.seed;
    // one stream for the streets as before; the hanging city and the tints have their own, so none disturbs another
    const r = rng(seed);
    const rSky = rng(seed * 7 + 101);
    const rTint = rng(seed * 13 + 5);
    const [r0, r1] = this.theme.city.radius;
    const placed: Placed[] = [];
    const total = VARIANTS.reduce((s, v) => s + v.weight, 0);
    const pick = () => {
      let k = r() * total;
      for (const v of VARIANTS) if ((k -= v.weight) <= 0) return v;
      return VARIANTS[0];
    };
    /**
     * The lower city, a layer between two radii. Districts are the cells of a Voronoi diagram; each lays its blocks on its
     * own turned grid with its own block size and ground level. Lots that would touch one already built are left
     * empty, as are those on the avenue (an arc through the city) and under the play space.
     */
    const lay = (inner: number, outer: number, keep: number) => {
      const seeds = Array.from({ length: DISTRICTS }, () => {
        const a = r() * Math.PI * 2;
        const d = inner + (outer - inner) * Math.sqrt(r());
        return {
          x: this.center.x + Math.cos(a) * d, z: this.center.z + Math.sin(a) * d, turn: r() * Math.PI,
          bx: BLOCK[0] * (0.92 + r() * 0.3), bz: BLOCK[1] * (0.9 + r() * 0.5), level: (r() - 0.5) * 12,
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
            if (this.exclude.containsPoint(new THREE.Vector3(x, 0, z))) continue;
            const scale = v.scale * (0.9 + jit[4] * 0.22);
            const lot = v.lot * scale;
            let free = true;
            for (let m = 0; m < placed.length && free; m++) free = Math.hypot(x - placed[m].b.x, z - placed[m].b.z) > (lot + placed[m].lot) * 0.66;
            if (!free) continue;
            const radial = new THREE.Vector3(x - this.center.x, 0, z - this.center.z).normalize();
            const b: Building = {
              kind: v.name, x, z,
              // the ground steps from district to district and a little from lot to lot: no two rooflines level
              y: GROUND + s.level + (jit[5] - 0.5) * 5 - ((rad - inner) / (outer - inner)) * 6,
              yaw: -s.turn + (jit[2] < 0.5 ? 0 : Math.PI) + (jit[2] - 0.5) * 0.1,
              scale,
              axis: new THREE.Vector3(-radial.z, 0, radial.x), // tilt away from the centre
              angle: 0,
              sky: false,
              id: -1,
            };
            placed.push({ b, name: v.name, lod: rad < NEAR ? 0 : 1, lot });
          }
      });
    };
    lay(r0 - 12, r1, 0.95);

    /**
     * The hanging city: the crust first, then lots on turned grids over it as in the streets, but dense, at the crust's
     * own height and only where it is thick enough to hold them; towards an edge they thin out, so the city breaks up
     * before the rock does. A building takes the highest point of the underside under it, so it is always joined to the rock.
     */
    const crust = new Crust({ cx: this.center.x, cz: this.center.z, y: SKY.y, inner: SKY.inner, outer: SKY.outer });
    const laySky = () => {
      const first = placed.length;
      const skyTotal = VARIANTS.reduce((s, v) => s + SKY_WEIGHT[v.name], 0);
      const pickSky = () => {
        let k = rSky() * skyTotal;
        for (const v of VARIANTS) if ((k -= SKY_WEIGHT[v.name]) <= 0) return v;
        return VARIANTS[0];
      };
      const seeds = Array.from({ length: SKY.districts }, () => {
        const a = rSky() * Math.PI * 2;
        const d = SKY.inner + (SKY.outer - SKY.inner) * Math.sqrt(rSky());
        return {
          x: this.center.x + Math.cos(a) * d, z: this.center.z + Math.sin(a) * d, turn: rSky() * Math.PI,
          bx: BLOCK[0] * SKY.scale * (0.92 + rSky() * 0.3), bz: BLOCK[1] * SKY.scale * (0.9 + rSky() * 0.5),
        };
      });
      const CELL = 160;
      const hash = new Map<string, Placed[]>();
      const cellKey = (x: number, z: number) => `${Math.floor(x / CELL)},${Math.floor(z / CELL)}`;
      seeds.forEach((s, k) => {
        const cos = Math.cos(s.turn);
        const sin = Math.sin(s.turn);
        const n = Math.ceil((SKY.outer * 2) / Math.min(s.bx, s.bz));
        for (let i = -n; i <= n; i++)
          for (let j = -n; j <= n; j++) {
            const gx = i * s.bx + (j % 2 ? s.bx * 0.37 : 0);
            const gz = j * s.bz;
            const x = s.x + gx * cos - gz * sin;
            const z = s.z + gx * sin + gz * cos;
            const rad = Math.hypot(x - this.center.x, z - this.center.z);
            if (rad < SKY.inner - 150 || rad > SKY.outer + 200) continue;
            const v = pickSky();
            const jit = [rSky(), rSky(), rSky(), rSky()];
            const depth = crust.depth(x, z);
            if (depth < SKY.edge) continue;
            if (jit[3] > THREE.MathUtils.smoothstep(depth, SKY.edge, SKY.edge + 160) * 0.97 + 0.03) continue; // thins towards an edge
            let near = k;
            let best = Math.hypot(x - s.x, z - s.z);
            seeds.forEach((o, m) => {
              const d = Math.hypot(x - o.x, z - o.z);
              if (d < best) [near, best] = [m, d];
            });
            if (near !== k) continue;
            const scale = v.scale * SKY.scale * (0.92 + jit[0] * 0.2);
            const lot = v.lot * scale;
            const cx = Math.floor(x / CELL);
            const cz = Math.floor(z / CELL);
            let free = true;
            for (let a = -1; a <= 1 && free; a++)
              for (let b = -1; b <= 1 && free; b++)
                for (const o of hash.get(`${cx + a},${cz + b}`) ?? []) {
                  if (Math.hypot(x - o.b.x, z - o.b.z) <= (lot + o.lot) * 0.66) {
                    free = false;
                    break;
                  }
                }
            if (!free) continue;
            let top = crust.underside(x, z);
            for (let a = 0; a < 8; a++) top = Math.max(top, crust.underside(x + Math.cos((a * Math.PI) / 4) * lot * 0.85, z + Math.sin((a * Math.PI) / 4) * lot * 0.85));
            const radial = new THREE.Vector3(x - this.center.x, 0, z - this.center.z).normalize();
            const p: Placed = {
              b: {
                kind: v.name, x, z, y: top + 1.5,
                yaw: -s.turn + (jit[1] < 0.5 ? 0 : Math.PI) + (jit[1] - 0.5) * 0.1,
                scale,
                axis: new THREE.Vector3(-radial.z, 0, radial.x),
                angle: 0,
                sky: true,
                id: -1,
              },
              name: v.name, lod: rad < SKY.detail ? 0 : 1, lot,
            };
            placed.push(p);
            const key = cellKey(x, z);
            const cell = hash.get(key);
            if (cell) cell.push(p);
            else hash.set(key, [p]);
          }
      });
      return first;
    };
    laySky();
    untwin(placed, { street: 230, sky: 420 });

    // one batch for the whole city: every building is an instance of one of the twenty models, drawn in one call
    const models = new Map<string, THREE.Mesh>();
    let vertices = 0;
    let indices = 0;
    const keyOf = (p: Placed) => `${p.name}_lod${p.lod}`;
    for (const key of new Set(placed.map(keyOf))) {
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
      p.b.kind = p.name;
      p.b.id = mesh.addInstance(geometryIds.get(keyOf(p))!);
      // about 6 % lighter or darker from house to house, a little warmer or cooler; all below the play area's values
      const v = (p.b.sky ? 0.5 : 0.7) * (0.94 + rTint() * 0.12);
      const warm = (rTint() - 0.5) * 0.06;
      mesh.setColorAt(p.b.id, tint.setRGB(v * (1 + warm), v, v * (1 - warm)));
      this.items.push(p.b);
    }
    this.mesh = mesh;
    for (const b of this.items) this.writeMatrix(b);
    this.group.add(mesh);
    this.group.add(crust.build(null));
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
    this.waves = this.waves.filter((w) => this.time - w.start < 1500 / w.speed + w.dur + 0.5);
    for (const b of this.items) {
      let a = 0;
      for (const w of this.waves) {
        const dist = Math.hypot(b.x - w.origin.x, b.z - w.origin.z);
        // the far ring is answered sooner than its distance says (the wave would take ten seconds to get there)
        const k = (this.time - w.start - dist / (w.speed * (b.sky ? 2.4 : 1))) / w.dur;
        // the hanging city is joined to rock that does not move: it sways, it does not tip
        if (k > 0 && k < 1) a += w.strength * Math.sin(Math.PI * k) * (b.sky ? -0.3 : 1);
      }
      if (Math.abs(a - b.angle) > 1e-4) {
        b.angle = a;
        this.writeMatrix(b);
      }
    }
  }
}
