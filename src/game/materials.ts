// Shared materials of the parts that are still procedural, and of the cues. Colours brighter than the bloom
// threshold in look.ts glow; the accent is kept just around it (brief: less glow, only on what can be operated).
import * as THREE from 'three';
import { marbleTexture, paverTexture } from './textures.ts';

export interface Materials {
  floor: THREE.MeshStandardMaterial;
  slabSide: THREE.MeshStandardMaterial;
  parapet: THREE.MeshStandardMaterial;
  /** Columns of light over the consoles (guidance, highlight): additive, faded by vertex colours. */
  column: THREE.MeshBasicMaterial;
  /** Warm white for the stand-in avatar's eyes: not the accent, which is kept for what can be operated. */
  warmGlow: THREE.MeshBasicMaterial;
  marble: THREE.MeshStandardMaterial;
  brass: THREE.MeshStandardMaterial;
  slate: THREE.MeshStandardMaterial;
  glow: THREE.MeshBasicMaterial;
  glowSoft: THREE.MeshBasicMaterial;
  lamp: THREE.MeshBasicMaterial;
  ghost: THREE.MeshBasicMaterial;
  ghostBlocked: THREE.MeshBasicMaterial;
  blockedFlash: THREE.MeshBasicMaterial;
  accent: THREE.Color;
}

export function createMaterials(accentHex: string): Materials {
  const accent = new THREE.Color(accentHex);
  const hdr = (c: THREE.Color, k: number) => c.clone().multiplyScalar(k);
  return {
    floor: new THREE.MeshStandardMaterial({ map: repeat(paverTexture(3)), roughness: 0.82, metalness: 0.02 }),
    slabSide: new THREE.MeshStandardMaterial({ color: '#8a8378', roughness: 0.9 }),
    parapet: new THREE.MeshStandardMaterial({ color: '#c2b8a8', roughness: 0.8 }),
    column: new THREE.MeshBasicMaterial({
      color: hdr(accent, 1.1), vertexColors: true, transparent: true, opacity: 0.4, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    }),
    warmGlow: new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffe2b0').multiplyScalar(1.6) }),
    marble: new THREE.MeshStandardMaterial({ map: marbleTexture(11), roughness: 0.45, metalness: 0.05 }),
    brass: new THREE.MeshStandardMaterial({ color: '#d4af37', roughness: 0.32, metalness: 1 }),
    slate: new THREE.MeshStandardMaterial({ color: '#4a4640', roughness: 0.75, metalness: 0.1 }),
    glow: new THREE.MeshBasicMaterial({ color: hdr(accent, 3.4) }),
    glowSoft: new THREE.MeshBasicMaterial({ color: hdr(accent, 1.5), transparent: true, opacity: 0.5, depthWrite: false }),
    lamp: new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffd9a0').multiplyScalar(3) }),
    ghost: new THREE.MeshBasicMaterial({
      color: hdr(accent, 1.2), transparent: true, opacity: 0.22, depthWrite: false, blending: THREE.AdditiveBlending,
    }),
    ghostBlocked: new THREE.MeshBasicMaterial({
      color: new THREE.Color('#ff7a3d').multiplyScalar(1.4), transparent: true, opacity: 0.25, depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
    blockedFlash: new THREE.MeshBasicMaterial({
      color: new THREE.Color('#ff6a2a').multiplyScalar(2.5), transparent: true, opacity: 0.45, depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
    accent,
  };
}

function repeat<T extends THREE.Texture>(t: T): T {
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
