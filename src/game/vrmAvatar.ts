// Optional VRM avatar: put a .vrm file at public/assets/player.vrm and it replaces the cloaked figure.
// The walk cycle is procedural (bone swings), so no animation files are needed.
import * as THREE from 'three';
import type { Avatar } from './player.ts';

export async function loadVrmAvatar(url: string): Promise<Avatar | null> {
  const head = await fetch(url, { method: 'HEAD' }).catch(() => null);
  // hosts that fall back to index.html for missing files answer 200 with text/html
  if (!head || !head.ok || /text\/html/.test(head.headers.get('content-type') ?? '')) return null;
  const [{ GLTFLoader }, { VRMLoaderPlugin, VRMUtils }] = await Promise.all([
    import('three/examples/jsm/loaders/GLTFLoader.js'),
    import('@pixiv/three-vrm'),
  ]);
  const loader = new GLTFLoader();
  loader.register((parser) => new VRMLoaderPlugin(parser));
  const gltf = await loader.loadAsync(url);
  const vrm = gltf.userData.vrm;
  if (!vrm) return null;
  VRMUtils.removeUnnecessaryVertices(gltf.scene);
  VRMUtils.combineSkeletons(gltf.scene);
  VRMUtils.rotateVRM0(vrm); // VRM 0.x faces the other way; afterwards every model faces +Z
  vrm.scene.rotation.y = Math.PI; // our forward is -Z
  vrm.scene.traverse((o: THREE.Object3D) => {
    o.frustumCulled = false;
    if ((o as THREE.Mesh).isMesh) o.castShadow = true;
  });
  // scale to roughly 1.7 m tall
  const box = new THREE.Box3().setFromObject(vrm.scene);
  const h = box.max.y - box.min.y;
  if (h > 0.1) vrm.scene.scale.setScalar(1.7 / h);
  const root = new THREE.Group();
  root.add(vrm.scene);
  const bone = (n: string) => vrm.humanoid?.getNormalizedBoneNode(n) as THREE.Object3D | null;
  const [lUL, rUL, lLL, rLL, lUA, rUA, spine] = [
    'leftUpperLeg', 'rightUpperLeg', 'leftLowerLeg', 'rightLowerLeg', 'leftUpperArm', 'rightUpperArm', 'spine',
  ].map(bone);
  let phase = 0;
  return {
    object: root,
    animate(dt, speed, airborne) {
      const k = Math.min(1, speed / 5);
      phase += dt * (3 + speed * 1.7);
      const s = Math.sin(phase) * 0.7 * k;
      if (lUL) lUL.rotation.x = airborne ? -0.5 : s;
      if (rUL) rUL.rotation.x = airborne ? -0.2 : -s;
      if (lLL) lLL.rotation.x = airborne ? 0.8 : Math.max(0, -Math.sin(phase + 0.6)) * 0.9 * k;
      if (rLL) rLL.rotation.x = airborne ? 0.4 : Math.max(0, Math.sin(phase + 0.6)) * 0.9 * k;
      if (lUA) {
        lUA.rotation.z = -1.2; // arms down from the T-pose (the left arm points +X)
        lUA.rotation.x = -s * 0.8;
      }
      if (rUA) {
        rUA.rotation.z = 1.2;
        rUA.rotation.x = s * 0.8;
      }
      if (spine) spine.rotation.x = 0.06 * k;
      vrm.scene.position.y = airborne ? 0 : Math.abs(Math.cos(phase)) * 0.03 * k;
      vrm.update(dt);
    },
  };
}
