// A thin cyan line between two points of the world: the thread the player sees before a swing (ring to ring), the thread in
// the hand during one (hand to the far ring), and the line from a targeted handle to the pivot of the group it turns. A greybox
// stand-in for the art pass: one stretched cylinder, placed with `place` every frame it is shown.
import * as THREE from 'three';
import type { Vec3 } from '../core/math.ts';

const UP = new THREE.Vector3(0, 1, 0);

export class Thread {
  readonly mesh: THREE.Mesh;
  private readonly a = new THREE.Vector3();
  private readonly b = new THREE.Vector3();
  private readonly d = new THREE.Vector3();

  /** `radius` in metres: 3 cm is about 5 px at the follow camera's distance. */
  constructor(material: THREE.Material, radius = 0.03) {
    this.mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, 1, 6, 1, true), material);
    this.mesh.visible = false;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
    this.mesh.frustumCulled = false; // (its bounding sphere is the unit cylinder's: it is stretched far past it)
    this.mesh.renderOrder = 4;
  }

  get visible(): boolean {
    return this.mesh.visible;
  }

  /** Stretch the line from `a` to `b` and show it. */
  place(a: Vec3, b: Vec3) {
    this.a.set(a[0], a[1], a[2]);
    this.b.set(b[0], b[1], b[2]);
    this.d.subVectors(this.b, this.a);
    const len = this.d.length();
    if (len < 1e-4) return this.hide();
    this.mesh.position.addVectors(this.a, this.b).multiplyScalar(0.5);
    this.mesh.scale.set(1, len, 1);
    this.mesh.quaternion.setFromUnitVectors(UP, this.d.divideScalar(len));
    this.mesh.visible = true;
  }

  hide() {
    this.mesh.visible = false;
  }

  dispose() {
    this.mesh.geometry.dispose();
  }
}

/** The cyan material of a thread: `k` brightens it past the bloom threshold, `opacity` fades it. */
export function threadMaterial(accent: THREE.Color, k: number, opacity: number): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color: accent.clone().multiplyScalar(k), transparent: opacity < 1, opacity, depthWrite: false, side: THREE.DoubleSide,
  });
}
