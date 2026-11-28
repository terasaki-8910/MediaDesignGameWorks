// Direct manipulation in Fold Mode, as pure functions (no DOM, no scene): how far a pointer has turned a group about its
// fold axis, which state that turn is nearest to, and what letting go there does. game.ts drives them from pointer events,
// world.ts and dragHandle.ts draw the result; tests/drag.test.ts checks them against the stage and the real diorama cameras.
//
// Angles are radians about the group's axis (right-handed, the sense CompiledStage.motionOf signs its quarters by), counted
// from the pose the group is in when Fold Mode opens. A console's options are the stops: each one is the signed turn its
// action makes (`quarters * PI / 2`), and the pose it started in is the stop at 0.
import * as THREE from 'three';

/** The index `nearestStop` and `releaseAt` give for "the pose it started in". */
export const REST = -1;

/** The turn of each option, in the order of the options. */
export function stopAngles(quarters: readonly number[]): number[] {
  return quarters.map((q) => (q * Math.PI) / 2);
}

/**
 * How far the group may be turned each way: as far as the farthest stop that way, and not beyond. The solver's sweep checked
 * each option's turn from 0 to its stop, so a group held inside this range is never anywhere it did not check.
 */
export interface Range { lo: number; hi: number }
export function rangeOf(angles: readonly number[]): Range {
  return { lo: Math.min(0, ...angles), hi: Math.max(0, ...angles) };
}

export function clampTo(angle: number, r: Range): number {
  return Math.min(r.hi, Math.max(r.lo, angle));
}

/** The stop nearest to `angle`: an index into `angles`, or REST. A tie goes to REST (the group stays unless the pointer has clearly turned it). */
export function nearestStop(angle: number, angles: readonly number[]): number {
  let best = REST;
  let distance = Math.abs(angle);
  angles.forEach((a, i) => {
    const d = Math.abs(angle - a);
    if (d < distance - 1e-9) {
      best = i;
      distance = d;
    }
  });
  return best;
}

/** What letting go at `angle` does: nothing (near the pose it started in), turn to a stop, or be refused because the sweep to that stop is blocked. */
export type Release = { kind: 'none' } | { kind: 'move'; index: number } | { kind: 'blocked'; index: number };

export function releaseAt(angle: number, angles: readonly number[], blocked: readonly boolean[]): Release {
  const index = nearestStop(angle, angles);
  if (index === REST) return { kind: 'none' };
  return blocked[index] ? { kind: 'blocked', index } : { kind: 'move', index };
}

// ---- the pointer: pixels, rays, and the turn they make -------------------------------------------------------------------

/** The size of the canvas in CSS pixels (the render scale is not part of it). */
export interface Viewport { width: number; height: number }

/** The world ray through a pixel (CSS px from the canvas's top left). The camera's matrices must be up to date. */
export function pixelRay(camera: THREE.Camera, x: number, y: number, vp: Viewport): THREE.Ray {
  const origin = new THREE.Vector3().setFromMatrixPosition(camera.matrixWorld);
  const far = new THREE.Vector3((x / vp.width) * 2 - 1, 1 - (y / vp.height) * 2, 0.5).unproject(camera);
  return new THREE.Ray(origin, far.sub(origin).normalize());
}

/** Where a world point lands (CSS px), or null when it is behind the camera. */
export function toPixel(camera: THREE.Camera, p: THREE.Vector3, vp: Viewport): { x: number; y: number } | null {
  const v = p.clone().applyMatrix4(camera.matrixWorldInverse);
  if (v.z >= 0) return null; // (the camera looks down -Z)
  v.applyMatrix4(camera.projectionMatrix);
  return { x: ((v.x + 1) / 2) * vp.width, y: ((1 - v.y) / 2) * vp.height };
}

/**
 * The handle of Fold Mode's drag. `px`: how far from its middle to its rim it reads on screen (the ring is then 2 x 46 px across,
 * more than the 44 px of a fingertip); `min` and `max`: its radius in metres at the nearest and the farthest camera; `hub`: the part
 * of the radius in the middle where a pointer says nothing about the angle; `clearance`: how far in front of the group it stands, in
 * metres; `grabMin` and `touch`: the least reach (CSS px from its middle) of a press that takes hold of it, and what a finger adds.
 */
export const HANDLE = { px: 46, min: 2.2, max: 7, hub: 0.3, clearance: 2, grabMin: 26, touch: 10 };
/** The wheel's face turns this much to the line of sight at least (1 = facing the camera): see `wheelNormal`. */
export const MIN_FACE = 0.62;
/** A grab on the group itself is read in the plane across its axis when that plane is seen at least this much face-on; else on the wheel's plane. */
export const MIN_BODY_FACE = 0.4;
/** The tilt never takes the wheel's face more than this far from the axis (cosine), so the turn it shows is the turn the group makes. */
const MIN_AXIS = 0.3;

/**
 * The face of the handle's wheel. The wheel sits on the axis, on the side the camera is on, turned so that its rim reads as a
 * ring and not as a line: its normal is the axis (`side`, a unit vector along it), tilted towards the camera (`toCamera`, unit,
 * from the wheel to the camera) just enough that the face is at least `minFace` to the line of sight. A view along the axis
 * leaves it as it was; the street seen at 15 degrees from edge-on gets a wheel turned about 45 degrees towards the lens.
 */
export function wheelNormal(side: THREE.Vector3, toCamera: THREE.Vector3, minFace = MIN_FACE): THREE.Vector3 {
  const c = side.dot(toCamera);
  if (c >= minFace) return side.clone();
  // n = normalize(side + beta * toCamera) with n . toCamera = minFace
  const beta = -c + minFace * Math.sqrt((1 - c * c) / (1 - minFace * minFace));
  const n = side.clone().addScaledVector(toCamera, beta).normalize();
  return n.dot(side) < MIN_AXIS ? side.clone() : n;
}

/** The end of the axis the camera is on: +1 or -1 (+1 when it is level with the pivot). */
export function sideOf(axis: THREE.Vector3, pivot: THREE.Vector3, camera: THREE.Vector3): 1 | -1 {
  return axis.dot(camera.clone().sub(pivot)) < 0 ? -1 : 1;
}

/**
 * Where the handle's wheel stands: on the axis through `pivot`, `clearance` metres beyond the end of the group on that side
 * (`boxes`: the group's world boxes), so it is in front of the group and not inside it, whether the pivot is at the group's
 * edge (the street's hinge) or in the middle of it (the cube).
 */
export function handleSpot(
  boxes: readonly { min: readonly number[]; max: readonly number[] }[], pivot: THREE.Vector3, axis: THREE.Vector3, side: 1 | -1, clearance: number,
): THREE.Vector3 {
  const dir = axis.clone().multiplyScalar(side);
  let reach = 0;
  const p = new THREE.Vector3();
  for (const b of boxes)
    for (const x of [b.min[0], b.max[0]])
      for (const y of [b.min[1], b.max[1]])
        for (const z of [b.min[2], b.max[2]]) reach = Math.max(reach, p.set(x, y, z).sub(pivot).dot(dir));
  return pivot.clone().addScaledVector(dir, reach + clearance);
}

/** World radius of a wheel that reads `px` CSS px from the middle to the rim at `distance` from a camera of this lens, within [min, max] metres. */
export function wheelRadius(distance: number, vfovDeg: number, viewportHeight: number, px: number, min: number, max: number): number {
  const perMetre = viewportHeight / (2 * distance * Math.tan(THREE.MathUtils.degToRad(vfovDeg) / 2));
  return Math.min(max, Math.max(min, px / perMetre));
}

/**
 * A plane the pointer turns something in: round `center` (on the axis), seen along `normal`. `sign` says whether a turn about
 * the normal is a turn about the axis in the same sense (+1) or the other (-1).
 */
export interface Wheel { center: THREE.Vector3; normal: THREE.Vector3; sign: 1 | -1 }

/** A right-handed pair of directions in the plane of `normal` (e1 x e2 = normal): `up`'s share in the plane is e2, so e2 reads as up on screen when `up` is the camera's. */
export function planeBasis(normal: THREE.Vector3, up: THREE.Vector3): { e1: THREE.Vector3; e2: THREE.Vector3 } {
  let e2 = up.clone().addScaledVector(normal, -up.dot(normal));
  if (e2.lengthSq() < 1e-8) e2 = Math.abs(normal.x) < 0.9 ? new THREE.Vector3(1, 0, 0).cross(normal) : new THREE.Vector3(0, 1, 0).cross(normal);
  e2.normalize();
  return { e1: e2.clone().cross(normal), e2 };
}

/**
 * The wheel for a grab on the group itself, at `point` on it. Across the axis through the grabbed point, where the point
 * really travels, when the camera sees that plane well: the point then stays under the pointer. When it is too edge-on for
 * that (the street's), the wheel's tilted plane takes over, so the turn is read on a plane that is well seen.
 * `toCamera`: unit vector from the group to the camera.
 */
export function bodyWheel(axis: THREE.Vector3, pivot: THREE.Vector3, point: THREE.Vector3, toCamera: THREE.Vector3): Wheel {
  const along = point.clone().sub(pivot).dot(axis);
  if (Math.abs(axis.dot(toCamera)) >= MIN_BODY_FACE) return { center: pivot.clone().addScaledVector(axis, along), normal: axis.clone(), sign: 1 };
  const side = axis.dot(toCamera) < 0 ? -1 : 1;
  const normal = wheelNormal(axis.clone().multiplyScalar(side), toCamera);
  // the plane through the grabbed point, where it cuts the axis
  const t = point.clone().sub(pivot).dot(normal) / axis.dot(normal);
  return { center: pivot.clone().addScaledVector(axis, t), normal, sign: side };
}

/** The wheel of the handle: on the axis at `spot`, face `normal` (wheelNormal of the side the handle is on). */
export function handleWheel(spot: THREE.Vector3, normal: THREE.Vector3, side: 1 | -1): Wheel {
  return { center: spot.clone(), normal: normal.clone(), sign: side };
}

/**
 * The turn a pointer has made on a wheel since the grab: the angle its ray's hit on the wheel's plane has swept about the
 * wheel's centre, added up from step to step (so it goes on past a half turn, and back). A ray that misses the plane, or
 * hits it inside `hub` (the angle there is all noise), leaves the turn where it was; the angle counts from the first ray that
 * is outside the hub, so a grab on the hub does not jump.
 */
export class AngleTracker {
  readonly wheel: Wheel;
  private readonly hub: number;
  private readonly e1: THREE.Vector3;
  private readonly e2: THREE.Vector3;
  private readonly plane: THREE.Plane;
  private last = 0;
  private started = false;
  private total = 0;

  constructor(wheel: Wheel, hub: number, up = new THREE.Vector3(0, 1, 0)) {
    this.wheel = wheel;
    this.hub = hub;
    const { e1, e2 } = planeBasis(wheel.normal, up);
    this.e1 = e1;
    this.e2 = e2;
    this.plane = new THREE.Plane().setFromNormalAndCoplanarPoint(wheel.normal, wheel.center);
  }

  /** The turn about the axis so far (radians, positive = the sense of positive quarters). */
  update(ray: THREE.Ray): number {
    const hit = ray.intersectPlane(this.plane, new THREE.Vector3());
    if (hit) {
      const rel = hit.sub(this.wheel.center);
      if (rel.length() >= this.hub) {
        const angle = Math.atan2(rel.dot(this.e2), rel.dot(this.e1));
        if (this.started) {
          let d = angle - this.last;
          if (d > Math.PI) d -= 2 * Math.PI;
          else if (d < -Math.PI) d += 2 * Math.PI;
          this.total += d;
        }
        this.last = angle;
        this.started = true;
      }
    }
    return this.angle;
  }

  get angle(): number {
    return this.wheel.sign * this.total;
  }
}
