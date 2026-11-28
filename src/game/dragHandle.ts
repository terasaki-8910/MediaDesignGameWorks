// The handle of Fold Mode's drag: a gilt hand-wheel with a ring of cyan light, standing on the fold axis in front of the group
// it turns. Cyan, as everywhere else in the game, means "you can act on this". It is drawn over the scene (no depth test), so no
// piece of the puzzle can stand in front of the one thing the player is meant to take hold of.
//
// The wheel is built at radius 1 in its own XY plane, facing +Z; `place` puts it where the game wants it, turned to face the
// camera as drag.ts's wheelNormal says, and spins it by the group's turn so the hand sees what it is doing.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Materials } from './materials.ts';
import { planeBasis, type Range } from './drag.ts';

/** Where the wheel is: its middle, the way its face looks, size in metres, and the turn of the group. */
export interface HandlePose {
  centre: THREE.Vector3;
  normal: THREE.Vector3;
  /** The camera's up: the arrows stand at the top of the wheel on screen. */
  up: THREE.Vector3;
  /** A direction across the axis that is fixed in the world: the spokes are measured from it, so looking round does not turn the wheel. */
  ref: THREE.Vector3;
  radius: number;
  /** The turn of the wheel about its normal, radians. */
  spin: number;
  /** The turns the group has (the arrows show the ways it can go: counter-clockwise if `hi` > 0, clockwise if `lo` < 0). */
  range: Range;
  /** 0 at rest, 1 under the pointer or in the hand. */
  hot: number;
}

const GLOW_REST = 1.5;
const GLOW_HOT = 2.6;
/** The cyan breathes a little at rest, so the wheel reads as something to take hold of; steady with reduceMotion. */
const BREATH = 0.25;

/** The shape of an arrow head: a triangle pointing along +X, its tip at x = 0.22. */
function arrowHead(): THREE.BufferGeometry {
  const s = new THREE.Shape();
  s.moveTo(0.22, 0);
  s.lineTo(-0.14, 0.2);
  s.lineTo(-0.06, 0);
  s.lineTo(-0.14, -0.2);
  s.closePath();
  return new THREE.ShapeGeometry(s);
}

/** A geometry turned by `angle` about Z, then moved to the rim at `at` (radians round the wheel). */
function onRim(g: THREE.BufferGeometry, at: number, radius: number, angle: number, z = 0): THREE.BufferGeometry {
  return g.rotateZ(angle).translate(Math.cos(at) * radius, Math.sin(at) * radius, z);
}

export class DragHandle {
  readonly group = new THREE.Group();
  /** The gilt of the wheel: the kit's gilt takes the sky's reflection (look.ts giltTakesSky), and so does this one. */
  readonly gilt: THREE.MeshStandardMaterial;
  private readonly wheel = new THREE.Group();
  private readonly marks = new THREE.Group();
  private readonly ccw: THREE.Mesh;
  private readonly cw: THREE.Mesh;
  private readonly glass: THREE.MeshBasicMaterial;
  private readonly accent: THREE.Color;

  constructor(M: Materials) {
    this.accent = M.accent.clone();
    this.gilt = new THREE.MeshStandardMaterial({
      color: M.brass.color, metalness: 1, roughness: 0.34, emissive: M.brass.color, emissiveIntensity: 0.28,
      transparent: true, depthTest: false, depthWrite: false,
    });
    this.glass = new THREE.MeshBasicMaterial({ color: M.accent.clone().multiplyScalar(GLOW_REST), transparent: true, opacity: 0.96, depthTest: false, depthWrite: false, toneMapped: true });
    const order = 1000;

    // gilt: the rim, two crossed spokes, the hub, and eight grips standing out of the rim
    const parts: THREE.BufferGeometry[] = [
      new THREE.TorusGeometry(1, 0.09, 10, 72),
      new THREE.BoxGeometry(2, 0.085, 0.085),
      new THREE.BoxGeometry(0.085, 2, 0.085),
      new THREE.CylinderGeometry(0.21, 0.24, 0.2, 20).rotateX(Math.PI / 2),
    ];
    for (let i = 0; i < 8; i++) parts.push(onRim(new THREE.CylinderGeometry(0.075, 0.095, 0.3, 8).rotateZ(Math.PI / 2), (i * Math.PI) / 4, 1.12, (i * Math.PI) / 4));
    const gilt = new THREE.Mesh(mergeGeometries(parts.map((p) => p.toNonIndexed())), this.gilt);
    // cyan: the ring of light inside the rim, and the lens in the hub
    const light = new THREE.Mesh(
      mergeGeometries([new THREE.TorusGeometry(0.8, 0.04, 8, 72), new THREE.CircleGeometry(0.1, 16).translate(0, 0, 0.11)].map((p) => p.toNonIndexed())),
      this.glass,
    );
    for (const m of [gilt, light]) {
      m.renderOrder = order;
      m.castShadow = false;
      m.receiveShadow = false;
    }
    gilt.renderOrder = order;
    light.renderOrder = order + 1;
    this.wheel.add(gilt, light);

    // the arrows: at the top of the wheel, either side of it, one for each way the group can go
    const head = arrowHead();
    const top = Math.PI / 2;
    const spread = 0.46;
    this.ccw = new THREE.Mesh(onRim(head.clone(), top + spread, 1.34, top + spread + Math.PI / 2, 0.02), this.glass);
    this.cw = new THREE.Mesh(onRim(head.clone(), top - spread, 1.34, top - spread - Math.PI / 2, 0.02), this.glass);
    for (const m of [this.ccw, this.cw]) {
      m.renderOrder = order + 1;
      this.marks.add(m);
    }
    head.dispose();
    this.group.add(this.wheel, this.marks);
    this.group.visible = false;
    this.group.name = 'drag-handle';
  }

  get visible(): boolean {
    return this.group.visible;
  }

  show(on: boolean) {
    this.group.visible = on;
  }

  /** Put the wheel where `pose` says; `time` (seconds) breathes the light unless `calm`. */
  place(pose: HandlePose, time = 0, calm = false) {
    const { e1, e2 } = planeBasis(pose.normal, pose.up);
    this.group.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(e1, e2, pose.normal));
    this.group.position.copy(pose.centre);
    this.group.scale.setScalar(pose.radius);
    // the spokes at `ref`'s angle in the wheel's plane, turned by the group's turn; the arrows keep to the top of the picture
    const r = planeBasis(pose.normal, pose.ref).e1;
    this.wheel.rotation.z = pose.spin + Math.atan2(r.dot(e2), r.dot(e1));
    this.ccw.visible = pose.range.hi > 1e-3;
    this.cw.visible = pose.range.lo < -1e-3;
    const breath = calm ? 0.5 : 0.5 + 0.5 * Math.sin(time * 2.6);
    const k = (GLOW_REST + BREATH * breath) * (1 - pose.hot) + GLOW_HOT * pose.hot;
    this.glass.color.copy(this.accent).multiplyScalar(k);
  }
}
