// The diorama view: a long lens high above a puzzle section, framing everything the puzzle can reach (every module in every
// state of the section's groups, its consoles, entry and exit) so the player reads it at a glance. The camera is computed
// from the section's own data and the window's aspect; nothing is placed by hand per section. Pure maths (no DOM), so it is
// unit-tested.
import * as THREE from 'three';
import { step, type CompiledStage } from '../core/compile.ts';
import { CELL, CUBE_GROUP, SIDES, cellFloor, cellKey, type Vec3 } from '../core/math.ts';
import type { ModuleInstance, PuzzleSection, PuzzleState } from '../core/types.ts';

/** The look of the view. Angles in degrees; `below` and `gate` in metres. */
export const DIORAMA = {
  /**
   * Vertical field of view in a landscape window: a long lens, so depth flattens and the layout reads like a model. Not
   * narrower: the third section (the largest puzzle) is then 130 m off, which is out in the background city's buildings
   * (a spire stands 136 m from it), and the turned view clips them; at 25 degrees the nearest is 12 m from the camera.
   */
  fov: 25,
  /** Looking down by this much: about isometric (35.3), a little steeper so the walkways read as plans. */
  pitch: 36,
  /** The camera stands this far round from straight behind the section's way through (see `dioramaAngles`). */
  yawOffset: 42,
  /** How far below the walkways the puzzle counts: the hanging street (16 m) and the cube (12 m) in, the tower's 30 m shaft out. */
  below: 18,
  /** The orbit the player may take round the view, in radians: as far as the city leaves room (tests/e2e and the notes in the report scan it). */
  orbit: { yaw: 0.3, pitch: 0.06 },
};

/** How much of each side of the frame is kept clear (fractions of the frame): the section card above, the Fold Mode panel below. */
export interface Margins { left: number; right: number; top: number; bottom: number }
export const MARGINS: Record<'intro' | 'fold', Margins> = {
  intro: { left: 0.07, right: 0.07, top: 0.15, bottom: 0.08 },
  fold: { left: 0.07, right: 0.07, top: 0.09, bottom: 0.33 },
};

export interface DioramaPose { pos: THREE.Vector3; look: THREE.Vector3; fov: number }

export interface DioramaView {
  /** Camera for a window of this aspect, orbited from the base angles by `dyaw` and `dpitch` (radians). */
  pose(aspect: number, dyaw?: number, dpitch?: number): DioramaPose;
  /** Middle of the framed points, and how far they spread from it on the ground. */
  readonly centre: THREE.Vector3;
  readonly radius: number;
  /** Half the side of the sun's shadow map that covers the puzzle, in metres (the map is centred on `centre` meanwhile). */
  readonly shadowHalf: number;
  readonly yaw: number;
  readonly pitch: number;
  readonly points: readonly THREE.Vector3[];
}

/** Every state a section's groups can take together (the stage has at most a few dozen). */
export function sectionStates(cs: CompiledStage, sec: PuzzleSection): PuzzleState[] {
  let states: Record<string, number>[] = [{ ...cs.initialState() }];
  for (const id of sec.groups) {
    const g = cs.groups.get(id)!;
    const n = g.kind === 'states' ? g.states.length : CUBE_GROUP.length;
    states = states.flatMap((s) => Array.from({ length: n }, (_, i) => ({ ...s, [id]: i })));
  }
  return states;
}

/**
 * The modules of a section's puzzle: those its groups move, and every one the player can walk on from the start without
 * passing a section exit (in any state the groups can take), so the walkways that connect and the plates that bridge are in.
 * The exit cells are reached but not crossed: past them is the next puzzle.
 */
export function sectionModules(cs: CompiledStage, sec: PuzzleSection): Set<string> {
  const stage = cs.stage;
  const out = new Set<string>(cs.modules.filter((m) => m.group && sec.groups.includes(m.group)).map((m) => m.id));
  const stop = new Set(stage.sections.flatMap((s) => s.exit.map((c) => cellKey(c))));
  const start = cellKey(stage.checkpoints.find((c) => c.id === sec.start)!.at);
  for (const state of sectionStates(cs, sec)) {
    const wm = cs.walkMap(state);
    const seen = new Set<string>();
    const queue = [start];
    while (queue.length) {
      const key = queue.pop()!;
      if (seen.has(key)) continue;
      seen.add(key);
      const tile = wm.tiles.get(key);
      if (!tile) continue;
      out.add(tile.module);
      if (stop.has(key) && key !== start) continue;
      for (const side of SIDES) if (tile.open[side]) queue.push(cellKey(step(tile.cell, side)));
      // (v0.5) a thread is a way too: what lies across it belongs to the puzzle
      for (const l of wm.links) {
        if (l.from === key) queue.push(l.to);
        else if (l.to === key) queue.push(l.from);
      }
    }
  }
  return out;
}

/** What a decoration of this kind adds above its floor, in metres (the gate's ring and finials reach about 12 m). */
function decoHeight(m: ModuleInstance): number {
  if (m.type !== 'deco') return 0;
  const size = m.params.size ?? 1;
  return { gate: 12 * size, arch: 8 * size, mural: 4.5, obelisk: 8 }[m.params.kind];
}

/**
 * The points a section's view has to hold: the corners of every box of its modules in every state (clamped to `below` the
 * walkways), the cells of the start, the consoles and the exit (with the gate's height over the exit), and decorations
 * standing on the section's walkways.
 */
export function sectionPoints(cs: CompiledStage, sec: PuzzleSection): THREE.Vector3[] {
  const stage = cs.stage;
  const modules = sectionModules(cs, sec);
  const startCell = stage.checkpoints.find((c) => c.id === sec.start)!.at;
  const cells = [startCell, ...sec.consoles.map((id) => cs.consoles.get(id)!.at), ...(sec.handles ?? []).map((id) => cs.handles.get(id)!.at), ...sec.exit];
  const floorY = Math.min(...cells.map((c) => cellFloor(c)[1]));
  const lo = floorY - DIORAMA.below;
  const pts: THREE.Vector3[] = [];
  const box = (min: Vec3, max: Vec3) => {
    for (const x of [min[0], max[0]])
      for (const y of [Math.max(min[1], lo), Math.max(max[1], lo)])
        for (const z of [min[2], max[2]]) pts.push(new THREE.Vector3(x, y, z));
  };
  const seen = new Set<string>();
  for (const state of sectionStates(cs, sec))
    for (const b of cs.worldBoxes(state)) {
      if (!modules.has(b.module)) continue;
      const k = `${b.module}|${b.min.join()}|${b.max.join()}`;
      if (seen.has(k)) continue;
      seen.add(k);
      box(b.min, b.max);
    }
  // plates are bridged tiles, not boxes: the cells they cover while the puzzle is in a state that bridges them
  const reachedCells = new Set<string>(cells.map((c) => cellKey(c)));
  for (const state of sectionStates(cs, sec))
    for (const t of cs.walkMap(state).tiles.values()) if (modules.has(t.module)) reachedCells.add(t.key);
  for (const key of reachedCells) {
    const [cx, cy, cz] = key.split(',').map(Number);
    const f = cellFloor([cx, cy, cz]);
    box([f[0] - CELL / 2, f[1] - 0.6, f[2] - CELL / 2], [f[0] + CELL / 2, f[1] + 1.8, f[2] + CELL / 2]);
  }
  for (const m of cs.modules) {
    const h = decoHeight(m);
    if (!h || !(reachedCells.has(cellKey(m.at)) || sec.exit.some((c) => cellKey(c) === cellKey(m.at)))) continue;
    const f = cellFloor(m.at);
    box([f[0] - CELL / 2, f[1], f[2] - CELL / 2], [f[0] + CELL / 2, f[1] + h, f[2] + CELL / 2]);
  }
  return pts;
}

/** The vertical field of view for a window of this aspect: a tall (phone-shaped) frame needs a wider lens to hold the width. */
export function dioramaFov(aspect: number): number {
  const k = Math.min(1, Math.max(0, (1.3 - aspect) / 0.75));
  return DIORAMA.fov * (1 + 0.9 * k);
}

/**
 * The tightest camera with the given orientation that holds every point inside the frame with the margins kept clear.
 * The apex of the view pyramid is where the four frame planes, each pushed in by its margin, just clear the points; solved
 * in closed form, so perspective is exact (no iterating towards a fit) and the result is continuous in the angles.
 */
export function fitView(
  points: readonly THREE.Vector3[],
  o: { yaw: number; pitch: number; vfov: number; aspect: number; margins: Margins; centre?: THREE.Vector3 },
): { pos: THREE.Vector3; look: THREE.Vector3 } {
  const off = new THREE.Vector3(Math.sin(o.yaw) * Math.cos(o.pitch), Math.sin(o.pitch), Math.cos(o.yaw) * Math.cos(o.pitch));
  const f = off.clone().negate();
  const r = new THREE.Vector3(-f.z, 0, f.x).normalize();
  const u = new THREE.Vector3().crossVectors(r, f).normalize();
  const tanY = Math.tan(THREE.MathUtils.degToRad(o.vfov) / 2);
  const tanX = tanY * o.aspect;
  const m = o.margins;
  const aR = tanX * (1 - m.right);
  const aL = tanX * (1 - m.left);
  const aT = tanY * (1 - m.top);
  const aB = tanY * (1 - m.bottom);
  const n = [
    r.clone().addScaledVector(f, -aR),
    r.clone().negate().addScaledVector(f, -aL),
    u.clone().addScaledVector(f, -aT),
    u.clone().negate().addScaledVector(f, -aB),
  ];
  const h = [-Infinity, -Infinity, -Infinity, -Infinity];
  for (const p of points) for (let i = 0; i < 4; i++) h[i] = Math.max(h[i], p.dot(n[i]));
  // along the view direction the apex has to stand back far enough for both axes: the further back of the two
  const c = Math.min(-(h[0] + h[1]) / (aR + aL), -(h[2] + h[3]) / (aT + aB));
  const a = (h[0] + aR * c + (-h[1] - aL * c)) / 2;
  const b = (h[2] + aT * c + (-h[3] - aB * c)) / 2;
  const pos = new THREE.Vector3().addScaledVector(r, a).addScaledVector(u, b).addScaledVector(f, c);
  const mid = o.centre ?? new THREE.Box3().setFromPoints(points as THREE.Vector3[]).getCenter(new THREE.Vector3());
  const look = pos.clone().addScaledVector(f, Math.max(1, mid.clone().sub(pos).dot(f)));
  return { pos, look };
}

/** How far from `pivot` a camera looking at it must stand, along the given angles, for every point to be inside the frame. */
export function distanceFor(
  points: readonly THREE.Vector3[],
  pivot: THREE.Vector3,
  o: { yaw: number; pitch: number; vfov: number; aspect: number; margins: Margins },
): number {
  const f = new THREE.Vector3(-Math.sin(o.yaw) * Math.cos(o.pitch), -Math.sin(o.pitch), -Math.cos(o.yaw) * Math.cos(o.pitch));
  const r = new THREE.Vector3(-f.z, 0, f.x).normalize();
  const u = new THREE.Vector3().crossVectors(r, f).normalize();
  const tanY = Math.tan(THREE.MathUtils.degToRad(o.vfov) / 2);
  const tanX = tanY * o.aspect;
  const m = o.margins;
  const aR = tanX * (1 - m.right);
  const aL = tanX * (1 - m.left);
  const aT = tanY * (1 - m.top);
  const aB = tanY * (1 - m.bottom);
  const d = new THREE.Vector3();
  let need = 0;
  for (const p of points) {
    d.subVectors(p, pivot);
    const x = d.dot(r);
    const y = d.dot(u);
    const z = d.dot(f); // a point at depth z from the pivot is D + z from the camera; x / (D + z) must stay inside the frame
    need = Math.max(need, x / aR - z, -x / aL - z, y / aT - z, -y / aB - z);
  }
  return need;
}

/**
 * A view of these points from the angles given (`yaw`, `pitch` in radians, as `CameraRig` has them). The camera looks at a
 * pivot in the middle of the puzzle, and the player turns it round that pivot. At rest the distance is the tightest that keeps
 * the puzzle inside the margins; turning the view backs the camera off towards the distance it needs at the limits of the
 * orbit, where the puzzle must still be in frame (with half the margins).
 */
export function dioramaView(points: readonly THREE.Vector3[], yaw: number, pitch: number, margins: Margins): DioramaView {
  const box = new THREE.Box3().setFromPoints(points as THREE.Vector3[]);
  const centre = box.getCenter(new THREE.Vector3());
  let radius = 0;
  for (const p of points) radius = Math.max(radius, Math.hypot(p.x - centre.x, p.z - centre.z));
  const slack: Margins = { left: margins.left / 2, right: margins.right / 2, top: margins.top / 2, bottom: margins.bottom / 2 };
  const setups = new Map<number, { pivot: THREE.Vector3; rest: number; limit: number; vfov: number }>();
  const setup = (aspect: number) => {
    const key = Math.round(aspect * 1000);
    let s = setups.get(key);
    if (!s) {
      if (setups.size > 24) setups.clear(); // (dragging the window edge goes through many shapes)
      const vfov = dioramaFov(aspect);
      const fit = fitView(points, { yaw, pitch, vfov, aspect, margins, centre });
      const pivot = fit.look;
      const rest = distanceFor(points, pivot, { yaw, pitch, vfov, aspect, margins });
      let limit = rest;
      for (const dy of [-DIORAMA.orbit.yaw, 0, DIORAMA.orbit.yaw])
        for (const dp of [-DIORAMA.orbit.pitch, 0, DIORAMA.orbit.pitch])
          if (dy || dp) limit = Math.max(limit, distanceFor(points, pivot, { yaw: yaw + dy, pitch: orbitPitch(pitch, dp), vfov, aspect, margins: slack }));
      setups.set(key, (s = { pivot, rest, limit, vfov }));
    }
    return s;
  };
  return {
    centre, radius, yaw, pitch, points, shadowHalf: THREE.MathUtils.clamp(radius * 1.2, 30, 70),
    pose(aspect, dyaw = 0, dpitch = 0) {
      const { pivot, rest, limit, vfov } = setup(aspect);
      const turned = Math.min(1, Math.max(Math.abs(dyaw) / DIORAMA.orbit.yaw, Math.abs(dpitch) / DIORAMA.orbit.pitch));
      const dist = rest + (limit - rest) * turned;
      const a = yaw + dyaw;
      const p = orbitPitch(pitch, dpitch);
      const pos = pivot.clone().add(new THREE.Vector3(Math.sin(a) * Math.cos(p), Math.sin(p), Math.cos(a) * Math.cos(p)).multiplyScalar(dist));
      return { pos, look: pivot.clone(), fov: vfov };
    },
  };
}

const orbitPitch = (pitch: number, d: number) => THREE.MathUtils.clamp(pitch + d, 0.3, 1.2);

/**
 * The angles for a section: round from straight behind the way the player goes through it (start to exit) by `yawOffset`,
 * to the side that puts the start near on the left and the exit far on the right, so the way reads left to right and into
 * the distance, as the follow camera shows it.
 */
export function dioramaAngles(cs: CompiledStage, sec: PuzzleSection): { yaw: number; pitch: number } {
  const start = cellFloor(cs.stage.checkpoints.find((c) => c.id === sec.start)!.at);
  const exit = sec.exit.map((c) => cellFloor(c));
  const to = exit.reduce((s, p) => [s[0] + p[0] / exit.length, s[1] + p[1] / exit.length, s[2] + p[2] / exit.length], [0, 0, 0]);
  const travel = Math.atan2(to[0] - start[0], to[2] - start[2]); // yaw of the direction of travel, as the rig counts it
  const yaw = travel + Math.PI + THREE.MathUtils.degToRad(DIORAMA.yawOffset); // straight behind, turned to the left of it
  return { yaw: Math.atan2(Math.sin(yaw), Math.cos(yaw)), pitch: THREE.MathUtils.degToRad(DIORAMA.pitch) };
}

/** The diorama of a section, with the margins of a use (`intro`: the establishing view; `fold`: Fold Mode with its panel). */
export function sectionDiorama(cs: CompiledStage, sec: PuzzleSection, use: keyof typeof MARGINS): DioramaView {
  const { yaw, pitch } = dioramaAngles(cs, sec);
  return dioramaView(sectionPoints(cs, sec), yaw, pitch, MARGINS[use]);
}
