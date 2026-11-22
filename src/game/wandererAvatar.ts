// The player character: a model file (by default the travelling sorcerer built by art/blender/gen_character.py)
// brought into the game's frame, hovering above the floor, with its cloth trailing behind the movement.
// To compare another model of the same brief (a Tripo export, say), put it next to the default one and change
// `WANDERER.url`: any GLB is scaled, turned and centred the same way and needs nothing else.
import * as THREE from 'three';
import type { Avatar } from './player.ts';

export interface WandererConfig {
  /** The model file. This is the one line to change to compare another model. */
  url: string;
  /** Metres from the model's lowest point (the cloak hem) to its crown, whatever size the file has. */
  height: number;
  /** How far the lowest point hangs above the floor. */
  hover: number;
  /** Turn about the vertical that brings the model's front to the game's forward axis (-Z). glTF models face +Z. */
  yaw: number;
}

export const WANDERER: WandererConfig = {
  url: './assets/character/wanderer.glb',
  height: 1.8,
  hover: 0.25,
  yaw: Math.PI,
};

/** `reset` puts the figure back into its rest pose with its clock at zero (the review shots call it). */
export interface WandererAvatar extends Avatar {
  reset(): void;
}

export interface WandererOptions {
  /** Read every frame: the settings' "reduce motion" scales the movement down to a gentle minimum. */
  reduceMotion?: () => boolean;
  config?: Partial<WandererConfig>;
}

/** Motion, in the model's own frame after loading: metres, Y up, forward -Z, the origin on the floor under the head. */
const MOTION = {
  bob: 0.025, // half the hover's travel
  bobRate: 1.5, // rad/s: one rise and fall in about four seconds
  lean: 0.15, // rad forward at full speed
  roll: 0.045, // rad per rad/s of turning, into the turn
  rollMax: 0.14,
  trail: 0.055, // metres the hem trails per m/s
  trailMax: 0.34,
  swing: 0.035, // metres the hem swings out per rad/s of turning
  stiffness: 42, // the cloth follows as a damped spring: it overshoots a little and settles
  damping: 6,
  ripple: 0.012, // metres, at rest ("breathing")
  rippleMoving: 0.02, // added at full speed
  fullSpeed: 5,
  reduced: 0.3, // scale of all of it with "reduce motion"
  pivot: 0.95, // the height the figure leans about
};

const SWAY_PARS = /* glsl */ `
attribute float sway;
uniform vec3 uTrail;
uniform float uSwayTime;
uniform float uRipple;
// Cloth only moves outwards from the vertical through the figure, never through it: the side facing the movement stays.
vec3 wandererSway( vec3 p, float w ) {
	vec2 rad = p.xz / max( length( p.xz ), 1e-4 );
	float len = length( uTrail.xz );
	vec2 dir = uTrail.xz / max( len, 1e-4 );
	float gate = smoothstep( -0.35, 0.55, dot( rad, dir ) );
	vec3 off = vec3( uTrail.x, 0.0, uTrail.z ) * gate * w;
	float lift = max( uTrail.y, 0.0 ) + len * 0.22;
	off.y += ( lift + min( uTrail.y, 0.0 ) ) * w;
	off.xz += rad * lift * 0.5 * w;
	float ph = uSwayTime * 1.7 - p.y * 4.5 + p.x * 3.1;
	off.xz += rad * ( 0.5 + 0.5 * sin( ph ) ) * uRipple * w;
	off.y += sin( ph * 0.7 + 1.3 ) * uRipple * 0.35 * w;
	return off;
}
`;

interface SwayUniforms {
  uTrail: { value: THREE.Vector3 };
  uSwayTime: { value: number };
  uRipple: { value: number };
}

function addSway(material: THREE.Material, uniforms: SwayUniforms) {
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${SWAY_PARS}`)
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n\ttransformed += wandererSway( transformed, sway );');
  };
  material.customProgramCacheKey = () => 'wanderer-sway';
  material.needsUpdate = true;
}

/** A sway weight for a model that brings none: nothing above the waist, rising to the lowest point. */
function swayFromHeight(geometry: THREE.BufferGeometry, height: number): THREE.BufferAttribute {
  const pos = geometry.attributes.position;
  const w = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    const t = THREE.MathUtils.smoothstep(0.55 - pos.getY(i) / height, 0, 0.55);
    w[i] = 0.5 * t * t;
  }
  return new THREE.BufferAttribute(w, 1);
}

/**
 * Bring a loaded model into the game's frame: `height` metres tall, standing on y = 0, the vertical through its head
 * at the origin (a trailing cloak must not pull the pivot back), facing -Z. Plain meshes get all of that baked into
 * their vertices, so the cloth shader works in metres for any file; a skinned model is only wrapped and does not sway.
 */
export function normaliseModel(scene: THREE.Object3D, cfg: WandererConfig, uniforms: SwayUniforms): THREE.Group {
  const turned = new THREE.Group();
  turned.rotation.y = cfg.yaw;
  turned.add(scene);
  turned.updateMatrixWorld(true);
  const meshes: THREE.Mesh[] = [];
  let skinned = false;
  scene.traverse((o) => {
    if ((o as THREE.SkinnedMesh).isSkinnedMesh) skinned = true;
    if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh);
  });
  if (!meshes.length) throw new Error('the character model has no mesh');
  const box = new THREE.Box3();
  const v = new THREE.Vector3();
  const each = (f: (p: THREE.Vector3) => void) => {
    for (const m of meshes) {
      const pos = m.geometry.attributes.position;
      for (let i = 0; i < pos.count; i++) f(v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld));
    }
  };
  each((p) => box.expandByPoint(p));
  const tall = box.max.y - box.min.y;
  if (!(tall > 1e-6)) throw new Error('the character model has no height');
  const head = new THREE.Box3();
  each((p) => p.y > box.max.y - tall * 0.12 && head.expandByPoint(p));
  const scale = cfg.height / tall;
  const fit = new THREE.Matrix4()
    .makeScale(scale, scale, scale)
    .multiply(new THREE.Matrix4().makeTranslation(-(head.min.x + head.max.x) / 2, -box.min.y, -(head.min.z + head.max.z) / 2));
  const out = new THREE.Group();
  if (skinned) {
    turned.applyMatrix4(fit);
    scene.traverse((o) => {
      o.frustumCulled = false;
      if ((o as THREE.Mesh).isMesh) o.castShadow = true;
    });
    out.add(turned);
    return out;
  }
  for (const m of meshes) {
    const geometry = m.geometry.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(fit, m.matrixWorld));
    // GLTFLoader hands a custom attribute over under its lower-case name
    const own = geometry.attributes._sway as THREE.BufferAttribute | undefined;
    geometry.setAttribute('sway', own ?? swayFromHeight(geometry, cfg.height));
    geometry.deleteAttribute('_sway');
    const mesh = new THREE.Mesh(geometry, m.material);
    for (const mat of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) addSway(mat, uniforms);
    // the sun's shadow must move with the cloth
    mesh.customDepthMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
    addSway(mesh.customDepthMaterial, uniforms);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false; // the cloth leaves the rest pose's bounds
    out.add(mesh);
  }
  return out;
}

const SHADOW_OPACITY = 0.55;
const SHADOW_LIFT = 0.015;

/** The soft round shadow straight under the figure: the low sun throws the real one far to the side. */
function contactShadow(): THREE.Mesh {
  // a disc whose opacity falls off through its rings, in the vertex colours' alpha (no texture to load or to fail)
  const rings: [number, number][] = [[0, 1], [0.2, 0.8], [0.36, 0.42], [0.5, 0.14], [0.62, 0]];
  const seg = 32;
  const pos: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  for (const [r, a] of rings)
    for (let i = 0; i < seg; i++) {
      const t = (i / seg) * Math.PI * 2;
      pos.push(Math.cos(t) * r, 0, Math.sin(t) * r);
      col.push(1, 1, 1, a);
    }
  for (let k = 0; k < rings.length - 1; k++)
    for (let i = 0; i < seg; i++) {
      const a = k * seg + i;
      const b = k * seg + ((i + 1) % seg);
      idx.push(a, a + seg, b, b, a + seg, b + seg);
    }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(col, 4));
  geometry.setIndex(idx);
  const material = new THREE.MeshBasicMaterial({
    color: '#1c1712', vertexColors: true, transparent: true, opacity: SHADOW_OPACITY, depthWrite: false, fog: false, side: THREE.DoubleSide,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.y = SHADOW_LIFT;
  mesh.renderOrder = 1;
  return mesh;
}

export async function loadWandererAvatar(opts: WandererOptions = {}): Promise<WandererAvatar> {
  const cfg = { ...WANDERER, ...opts.config };
  const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
  const gltf = await new GLTFLoader().loadAsync(cfg.url);
  const uniforms: SwayUniforms = { uTrail: { value: new THREE.Vector3() }, uSwayTime: { value: 0 }, uRipple: { value: MOTION.ripple } };
  const model = normaliseModel(gltf.scene, cfg, uniforms);
  model.position.y = -MOTION.pivot;
  const body = new THREE.Group(); // hovers, bobs and leans about the chest
  body.add(model);
  const shadow = contactShadow();
  const root = new THREE.Group();
  root.add(body, shadow);

  const reduced = () => (opts.reduceMotion?.() ? MOTION.reduced : 1);
  const trail = new THREE.Vector3();
  const trailVel = new THREE.Vector3();
  const target = new THREE.Vector3();
  const pos = new THREE.Vector3();
  const prev = new THREE.Vector3();
  const vel = new THREE.Vector3();
  const quat = new THREE.Quaternion();
  const fwd = new THREE.Vector3();
  let seen = false;
  let prevYaw = 0;
  let time = 0;
  let lean = 0;
  let roll = 0;
  let rise = 0; // how far a jump has lifted the figure above its floor

  const pose = () => {
    body.position.y = cfg.hover + MOTION.pivot + Math.sin(time * MOTION.bobRate) * MOTION.bob * reduced();
    body.rotation.set(lean, 0, roll);
    uniforms.uTrail.value.copy(trail);
    uniforms.uSwayTime.value = time;
    shadow.position.y = SHADOW_LIFT - rise;
    shadow.scale.setScalar(1 + rise * 0.35);
    (shadow.material as THREE.MeshBasicMaterial).opacity = SHADOW_OPACITY / (1 + rise * 1.6);
  };
  const reset = () => {
    seen = false;
    time = lean = roll = rise = 0;
    trail.set(0, 0, 0);
    trailVel.set(0, 0, 0);
    uniforms.uRipple.value = MOTION.ripple * reduced();
    pose();
  };
  reset();

  return {
    object: root,
    reset,
    animate(dt, speed, airborne) {
      if (!(dt > 0)) return;
      const m = reduced();
      time += dt;
      // The interface gives the speed only: the direction of travel, the turning and the jump come from how the
      // figure's own node has moved since the last call. A jump in place (a respawn) is not movement.
      root.getWorldPosition(pos);
      root.getWorldQuaternion(quat);
      fwd.set(0, 0, -1).applyQuaternion(quat);
      const yaw = Math.atan2(-fwd.x, -fwd.z);
      if (!seen || pos.distanceTo(prev) > 1.5) {
        prev.copy(pos);
        prevYaw = yaw;
        trail.set(0, 0, 0);
        trailVel.set(0, 0, 0);
        rise = 0;
        seen = true;
      }
      vel.copy(pos).sub(prev).divideScalar(dt).clampLength(0, 12);
      let turn = yaw - prevYaw;
      turn = THREE.MathUtils.clamp(Math.atan2(Math.sin(turn), Math.cos(turn)) / dt, -6, 6);
      prev.copy(pos);
      prevYaw = yaw;
      rise = airborne ? Math.max(0, rise + vel.y * dt) : rise * Math.exp(-dt * 20);

      // where the hem wants to be, in the figure's frame: behind the movement, out of a turn, up in a fall
      vel.applyQuaternion(quat.invert());
      target.set(-vel.x * MOTION.trail + turn * MOTION.swing, 0, -vel.z * MOTION.trail).clampLength(0, MOTION.trailMax);
      target.y = THREE.MathUtils.clamp(-vel.y * 0.035, -0.05, 0.2);
      target.multiplyScalar(m);
      const steps = Math.max(1, Math.ceil(dt / 0.02));
      const h = dt / steps;
      for (let i = 0; i < steps; i++) {
        trailVel.x += ((target.x - trail.x) * MOTION.stiffness - trailVel.x * MOTION.damping) * h;
        trailVel.y += ((target.y - trail.y) * MOTION.stiffness - trailVel.y * MOTION.damping) * h;
        trailVel.z += ((target.z - trail.z) * MOTION.stiffness - trailVel.z * MOTION.damping) * h;
        trail.addScaledVector(trailVel, h);
      }
      const k = Math.min(1, speed / MOTION.fullSpeed);
      uniforms.uRipple.value = (MOTION.ripple + MOTION.rippleMoving * k) * m;
      const ease = 1 - Math.exp(-dt * 6);
      lean += ((airborne ? 0.06 : -MOTION.lean * k) * m - lean) * ease;
      roll += (THREE.MathUtils.clamp(turn * MOTION.roll, -MOTION.rollMax, MOTION.rollMax) * m - roll) * ease;
      pose();
    },
  };
}
