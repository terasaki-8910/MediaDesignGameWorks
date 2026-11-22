// Sky, lights, fog, and the background city: thousands of instanced towers below the walkways and a
// mirrored city hanging from the sky. Fold events send a wave through the city that tilts each tower.
import * as THREE from 'three';
import type { VisualTheme } from '../core/types.ts';
import { LOOK, createSun, hazeFloor, installHaze, loadSky } from './look.ts';
import { facadeTextures } from './textures.ts';

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

/** Metres covered by one repeat of the facade texture (6 window columns by 14 floors). */
const FACADE_TILE: [number, number] = [12, 24];

/**
 * Repeats the facade by each tower's own size, read from its instance matrix, so a 200 m landmark has as many floors
 * as its height calls for instead of one texture stretched over it.
 */
function tileFacade(mat: THREE.MeshStandardMaterial) {
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader.replace(
      '#include <uv_vertex>',
      /* glsl */ `#include <uv_vertex>
      #ifdef USE_INSTANCING
        vec3 towerSize = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
        vec2 faceSize = abs(normal.y) > 0.5 ? towerSize.xz : abs(normal.x) > 0.5 ? towerSize.zy : towerSize.xy;
        vec2 facadeUv = uv * faceSize / vec2(${FACADE_TILE[0].toFixed(1)}, ${FACADE_TILE[1].toFixed(1)});
        vMapUv = facadeUv;
        vEmissiveMapUv = facadeUv;
        // windows: lit in few towers of the city below, and only far out, where they sit near the horizon
        float cityHash = fract(sin(dot(instanceMatrix[3].xz, vec2(12.9898, 78.233))) * 43758.5453);
        vCityLit = step(0.9, cityHash) * step(0.0, instanceMatrix[1].y) * smoothstep(170.0, 250.0, length(instanceMatrix[3].xz - vec2(4.0, -6.0)));
      #endif`,
    );
    shader.vertexShader = 'varying float vCityLit;\n' + shader.vertexShader;
    shader.fragmentShader = ('varying float vCityLit;\n' + shader.fragmentShader)
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n  totalEmissiveRadiance *= vCityLit * smoothstep(-50.0, -5.0, vFogWorld.y) * smoothstep(70.0, 25.0, vFogWorld.y);')
      // the facade map paints coloured windows: keep them only as a faint grid on a grey silhouette
      .replace('#include <map_fragment>', '#include <map_fragment>\n  diffuseColor.rgb = mix(vec3(0.5), vec3(dot(diffuseColor.rgb, vec3(0.3, 0.6, 0.1))), 0.12);');
  };
  mat.customProgramCacheKey = () => 'city-facade';
}

interface Building { x: number; z: number; y: number; w: number; h: number; d: number; axis: THREE.Vector3; angle: number; sky: boolean }
interface Wave { origin: THREE.Vector3; start: number; strength: number; speed: number; dur: number }

const ARCHETYPES = [
  { w: 10, h: 36, d: 10 },
  { w: 14, h: 22, d: 14 },
  { w: 8, h: 58, d: 8 },
  { w: 20, h: 14, d: 16 },
];

export class BackgroundCity {
  readonly group = new THREE.Group();
  private sets: { mesh: THREE.InstancedMesh; items: Building[] }[] = [];
  private waves: Wave[] = [];
  private time = 0;
  private readonly mirrorY = 95;
  private readonly m4 = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly flip = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI);

  constructor(theme: VisualTheme, center: THREE.Vector3, exclude: THREE.Box3) {
    const r = rng(theme.city.seed);
    const tex = facadeTextures(theme.city.seed);
    const [r0, r1] = theme.city.radius;
    const perType = ARCHETYPES.map(() => [] as Building[]);
    const placeOne = (sky: boolean) => {
      for (let tries = 0; tries < 20; tries++) {
        const a = r() * Math.PI * 2;
        const rad = Math.sqrt(r0 * r0 + r() * (r1 * r1 - r0 * r0));
        const x = center.x + Math.cos(a) * rad;
        const z = center.z + Math.sin(a) * rad;
        if (!sky && exclude.containsPoint(new THREE.Vector3(x, 0, z))) continue;
        const k = Math.floor(r() * ARCHETYPES.length);
        const A = ARCHETYPES[k];
        const s = 0.75 + r() * 0.6;
        const radial = new THREE.Vector3(x - center.x, 0, z - center.z).normalize();
        const axis = new THREE.Vector3(-radial.z, 0, radial.x); // tilt away from the centre
        // Most roofs sit well below the walkways (a sea of rooftops); a few far landmarks rise above them.
        const landmark = !sky && rad > r0 + (r1 - r0) * 0.35 && r() < 0.045;
        const h = landmark ? 120 + r() * 90 : A.h * s;
        const y = sky ? -20 - r() * 40 : landmark ? -100 - r() * 20 : -60 - h * (0.6 + r() * 0.9);
        perType[k].push({ x, z, y, w: A.w * (0.8 + r() * 0.4), h, d: A.d * (0.8 + r() * 0.4), axis, angle: 0, sky });
        return;
      }
    };
    for (let i = 0; i < theme.city.count; i++) placeOne(false);
    for (let i = 0; i < Math.floor(theme.city.count * 0.6); i++) placeOne(true);

    ARCHETYPES.forEach((_, k) => {
      const geo = new THREE.BoxGeometry(1, 1, 1);
      geo.translate(0, 0.5, 0);
      const mat = new THREE.MeshStandardMaterial({
        map: tex.map, emissiveMap: tex.emissive, emissive: new THREE.Color(1, 0.72, 0.42), emissiveIntensity: 1.6,
        roughness: 0.9, metalness: 0,
      });
      tileFacade(mat);
      const items = perType[k];
      const mesh = new THREE.InstancedMesh(geo, mat, items.length);
      const tint = new THREE.Color();
      items.forEach((b, i) => {
        tint.setHSL(0.62 + r() * 0.05, 0.05 + r() * 0.04, 0.3 + r() * 0.12); // cool grey; with the sun and the haze on it about #6E6A78 to #8A8494
        mesh.setColorAt(i, tint);
        this.writeMatrix(mesh, i, b);
      });
      mesh.instanceMatrix.needsUpdate = true;
      mesh.frustumCulled = false;
      this.group.add(mesh);
      this.sets.push({ mesh, items });
    });
  }

  private writeMatrix(mesh: THREE.InstancedMesh, i: number, b: Building) {
    this.q.setFromAxisAngle(b.axis, b.angle);
    if (b.sky) this.q.premultiply(this.flip);
    const y = b.sky ? this.mirrorY * 2 - b.y : b.y;
    this.m4.compose(new THREE.Vector3(b.x, y, b.z), this.q, new THREE.Vector3(b.w, b.h, b.d));
    mesh.setMatrixAt(i, this.m4);
  }

  /** Send a folding wave through the city from a point. */
  wave(origin: THREE.Vector3, strength = 0.35, speed = 90, dur = 1.6) {
    this.waves.push({ origin: origin.clone(), start: this.time, strength, speed, dur });
  }

  /** Back to time zero with every tower upright (review shots). */
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
