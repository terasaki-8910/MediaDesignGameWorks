// The mark of a section's exit: where it goes and which kit pieces it is laid from, as pure functions (world.ts builds and
// lights it). An exit is a cell on a road; the player clears the section by stepping onto it. The mark is an inlay in the
// language of the path cube's faces (cyan glass line in a bronze rim): a threshold line across the road where the cell
// begins, and chevrons that point on. Visual only.
import * as THREE from 'three';
import { DIRS, cellFloor, type Side, type Vec3 } from '../core/math.ts';
import type { StageFile } from '../core/types.ts';
import type { Placement } from './kit.ts';

/** The kit's path line (cube.glb cube_inlay_arm) runs along -Z from 0.39 m to 5.81 m from its origin and is 0.2 m wide. */
const ARM_NEAR = 0.39;
const ARM_LENGTH = 5.42;
/** Half the width of a road between its parapets, less a margin: the threshold line runs this far each way from the middle. */
const ROAD_HALF = 1.6;
/** Where the lines lie: the cell's half side is 2 m. */
const NEAR_EDGE = 1.75;
/** The chevrons: where their points are (metres from the middle of the cell, towards the way on), how far their arms reach back and their angle to the way on. */
const CHEVRONS = [-0.8, 0.1, 1.0];
const CHEVRON_ARM = 1.15;
const CHEVRON_ANGLE = (40 * Math.PI) / 180;
/** The lines of the mark are this much wider than the cube's (a cube's face is looked at from 12 m, an exit from 30). */
const WIDEN = 2.2;

/** Which way is "on" at an exit: the side of the exit cell that faces away from where the section starts, along the longer axis. */
export function exitSide(from: Vec3, to: Vec3): Side {
  const dx = to[0] - from[0];
  const dz = to[2] - from[2];
  if (Math.abs(dx) >= Math.abs(dz)) return dx >= 0 ? 'E' : 'W';
  return dz >= 0 ? 'S' : 'N';
}

export interface ExitMark { section: string; cell: Vec3; side: Side }

/**
 * The exits that get a mark: every exit cell of every section except the goal's own (the gate stands there and is the mark).
 * `side` is the way on, from the section's start checkpoint to the exit.
 */
export function exitMarks(stage: StageFile): ExitMark[] {
  const goal = stage.goal.at.join(',');
  const out: ExitMark[] = [];
  for (const sec of stage.sections) {
    const start = stage.checkpoints.find((c) => c.id === sec.start);
    for (const cell of sec.exit) if (cell.join(',') !== goal) out.push({ section: sec.id, cell, side: exitSide(start?.at ?? cell, cell) });
  }
  return out;
}

/**
 * The cube_inlay_arm piece laid along `dir` (a unit vector in the ground plane) from `from` to `to` metres out of `origin`,
 * `widen` times as wide: the matrix takes the piece's own frame to the frame `origin` is in.
 */
export function armMatrix(origin: THREE.Vector3, dir: THREE.Vector3, from: number, to: number, widen = 1): THREE.Matrix4 {
  const s = (to - from) / ARM_LENGTH;
  const yaw = Math.atan2(-dir.x, -dir.z); // the piece's -Z turned onto `dir`
  return new THREE.Matrix4()
    .makeTranslation(origin.x, origin.y, origin.z)
    .multiply(new THREE.Matrix4().makeRotationY(yaw))
    .multiply(new THREE.Matrix4().makeTranslation(0, 0, ARM_NEAR * s - from))
    .multiply(new THREE.Matrix4().makeScale(widen, 1, s));
}

/** The pieces of the mark in world space: `cell`'s floor is where the road is. */
export function exitPlacements(cell: Vec3, side: Side): Placement[] {
  const floor = cellFloor(cell);
  const centre = new THREE.Vector3(floor[0], floor[1], floor[2]);
  const d = new THREE.Vector3(DIRS[side][0], 0, DIRS[side][2]);
  const c = new THREE.Vector3(-d.z, 0, d.x); // across the road
  const out: Placement[] = [];
  // the threshold: a line across the road where the cell begins, the edge the player crosses
  out.push({
    piece: 'cube_inlay_arm',
    matrix: armMatrix(centre.clone().addScaledVector(d, -NEAR_EDGE).addScaledVector(c, -ROAD_HALF), c, 0, ROAD_HALF * 2, WIDEN),
  });
  // chevrons: a point towards the way on, two arms trailing back from it
  for (const p of CHEVRONS)
    for (const k of [-1, 1]) {
      const apex = centre.clone().addScaledVector(d, p);
      const back = d.clone().multiplyScalar(-Math.cos(CHEVRON_ANGLE)).addScaledVector(c, k * Math.sin(CHEVRON_ANGLE));
      out.push({ piece: 'cube_inlay_arm', matrix: armMatrix(apex, back, 0, CHEVRON_ARM, WIDEN) });
    }
  return out;
}

/** The pad of light under the mark: how far it reaches across the road and along the cell, as a soft-edged rectangle. */
const PAD_ACROSS = 3.7;
const PAD_ALONG = 4.2;

/**
 * A pad of light on the floor of the exit cell (the cell lit, as a threshold is): a flat grid whose vertex colours are 1 in
 * the middle and fall smoothly to 0 at the edges, to be drawn additively so that no edge shows. In world space, a few
 * millimetres above the floor.
 */
export function exitPad(cell: Vec3, side: Side): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(PAD_ACROSS, PAD_ALONG, 10, 10);
  g.rotateX(-Math.PI / 2); // lies flat: across the road along x, the way on along -z (north)
  const pos = g.getAttribute('position');
  const col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const a = Math.abs(pos.getX(i)) / (PAD_ACROSS / 2);
    const b = Math.abs(pos.getZ(i)) / (PAD_ALONG / 2);
    const v = (1 - THREE.MathUtils.smoothstep(a, 0.25, 1)) * (1 - THREE.MathUtils.smoothstep(b, 0.25, 1));
    col.set([v, v, v], i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const turns = { N: 0, E: 1, S: 2, W: 3 }[side];
  g.rotateY(-turns * (Math.PI / 2));
  const f = cellFloor(cell);
  g.translate(f[0], f[1] + 0.03, f[2]);
  return g;
}
