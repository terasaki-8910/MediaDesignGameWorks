// Shared materials. Emissive colours above 1.0 feed the bloom pass (tone mapping happens in post).
import * as THREE from 'three';
import { marbleTexture, paverTexture } from './textures.ts';

export interface Materials {
  floor: THREE.MeshStandardMaterial;
  slabSide: THREE.MeshStandardMaterial;
  parapet: THREE.MeshStandardMaterial;
  column: THREE.MeshStandardMaterial;
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
    slabSide: new THREE.MeshStandardMaterial({ color: '#7d7a86', roughness: 0.9 }),
    parapet: new THREE.MeshStandardMaterial({ color: '#d9d0c3', roughness: 0.78 }),
    column: new THREE.MeshStandardMaterial({ color: '#9a96a3', roughness: 0.85 }),
    marble: new THREE.MeshStandardMaterial({ map: marbleTexture(11), roughness: 0.45, metalness: 0.05 }),
    brass: new THREE.MeshStandardMaterial({ color: '#caa15a', roughness: 0.32, metalness: 0.95 }),
    slate: new THREE.MeshStandardMaterial({ color: '#434757', roughness: 0.7, metalness: 0.1 }),
    glow: new THREE.MeshBasicMaterial({ color: hdr(accent, 4) }),
    glowSoft: new THREE.MeshBasicMaterial({ color: hdr(accent, 1.6), transparent: true, opacity: 0.6, depthWrite: false }),
    lamp: new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffd9a0').multiplyScalar(5) }),
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
