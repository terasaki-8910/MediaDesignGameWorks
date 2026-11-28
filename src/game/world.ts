// Scene graph for a compiled stage: module nodes under group pivots, the kit's pieces hung on them, parapets derived
// from the walk map, gap plates, consoles, fold animations and Fold Mode previews.
import * as THREE from 'three';
import type { CompiledStage, WalkMap } from '../core/compile.ts';
import { CELL, DIRS, SIDES, cellFloor, cellKey, type Mat3, type Side } from '../core/math.ts';
import type { Action, CubeFace, Id, PuzzleState } from '../core/types.ts';
import type { DirName } from '../core/math.ts';
import { Dust } from './dust.ts';
import { exitMarks, exitPad, exitPlacements } from './exitMarker.ts';
import { Shake, feelOf, foldCurve, foldSeconds, jointsOf, settleCurve, settleSeconds, STOP_AT, type Feel, type Joints } from './foldFeel.ts';
import { DragHandle } from './dragHandle.ts';
import type { Kit } from './kit.ts';
import { RAIL_LINE, edgeKey, isStreet, planSlabs, sideMatrix } from './kitLayout.ts';
import { buildModuleMesh, consoleMesh, faceArmsUV } from './kitMeshes.ts';
import { LOOK } from './look.ts';
import type { Materials } from './materials.ts';
import { portalMaterial, prepareDisc } from './portal.ts';
import { MURAL_FACES, TOWER_PUT_AWAY, cubeFaceRoles, cubePlacements, faceInlays, muralPlacements, toneByFacing, towerPlacements } from './setPieces.ts';
import { muralLetters } from './textures.ts';

export interface EdgeMarker { pos: THREE.Vector3; side: Side; kind: 'open' | 'close' }

/** `glass` is the console's own copy of M_console_glass once the kit is in (its cyan light is driven per console). */
interface ConsoleParts { glass: THREE.MeshStandardMaterial | null; beacon: THREE.Mesh; guide: THREE.Mesh }

/** Emission of a console's glass: at rest, and the mean while the player stands at it. */
const GLASS_REST = 1.6;
const GLASS_ACTIVE = 3.2;
/**
 * Emission of the path lines (the cube's faces, the plates, the mural's tablets, the tower's ring). On the cube and the
 * plates this is the value on a line's middle; the glass's vertex colours take it down to 0.62 of it at the edges. They
 * render at about L* 60 to 75, over the paving they lie on in the shade, and stay under the bloom threshold. (At 1.3 they
 * were flat strips at L* 86.)
 */
const PATH_GLOW = 0.5;
/**
 * The exit mark's glass breathes between these (it is the way on, a cue that can be used, so brighter than the path lines;
 * well under the bloom threshold). `EXIT_FLARE` is added at the moment the exit is crossed and dies away in `EXIT_FLARE_SECONDS`.
 */
const EXIT_GLOW = [0.75, 1.25] as const;
/** The pad of light under the mark (an additive wash of the accent), between these, and its share of the flare. */
const EXIT_PAD = [0.1, 0.24] as const;
const EXIT_PAD_FLARE = 0.5;
const EXIT_FLARE = 1.6;
const EXIT_FLARE_SECONDS = 0.6;
/** The lines the preview of a roll lays over the cube: the faces that will look up (the ones a path would be walked on) and the sides. */
const PREVIEW_GLOW = { up: 1.5, side: 0.9 } as const;
/** How far the preview's lines stand off the faces they lie on (the cube's own inlays are 2 cm proud), and how much wider the up face's are. */
const PREVIEW_LIFT = 0.05;
/** The lines of the face that will look up are this much wider than the cube's own (arms across, the hub all round). */
const PREVIEW_UP_WIDEN = 1.8;
/** While the preview shows the turned cube's lines, the cube's own are this much of their usual light. */
const CUBE_LINES_DIMMED = 0.3;
/** The camera's shake at a stop, in radians, for a group the size of the path cube; a bigger group shakes more, a smaller one less. */
const SHAKE_BASE = 0.0075;
const SHAKE_REFERENCE_RADIUS = 8.5;
/**
 * The path cube's stone and paving are the kit's ashlar and paving as on every slab; only their tone by facing is the
 * cube's own (setPieces.ts toneByFacing; the cube can lie on any face, so nothing of this is baked). Faces that do not
 * look up: the kit's 0.6 where they face the sun, the stone as it is where they face away.
 */
const CUBE_TONE = { lit: 0.6, shade: 1 };
/**
 * How much of the sky's reflection the gate's ring takes, against stone's 1 (the small gilt ornaments take look.ts
 * giltEnv, 2.4, which on a ring 9 m across is a white disc). At 0.45 the ring had little but the low warm sun on it and
 * rendered far more saturated than the kit's gilt; at 1 it was still a deeper ochre (196,153,73) than the gilt eagle
 * above it. At 1.6 its median is about (223,179,88) and its near-white share stays near 1 %.
 */
const RING_SKY = 1.6;

/**
 * The glass of the path lines gets its light shaped by its vertex colours (a lit core along the middle of a line: the kit's
 * scripts, fc_kit.py glow_gradient); without them a line is one flat value from edge to edge. Every copy of the kit's glass
 * needs it again (a cloned material does not keep the hook), and shares the one shader.
 */
function shapeGlassLight(glass: THREE.MeshStandardMaterial) {
  glass.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <emissivemap_fragment>',
      `#include <emissivemap_fragment>
	#if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA )
		totalEmissiveRadiance *= vColor.rgb;
	#endif`,
    );
  };
  glass.customProgramCacheKey = () => 'path-glass-gradient';
  glass.needsUpdate = true;
}

const AXIS: Record<'x' | 'y' | 'z', THREE.Vector3> = {
  x: new THREE.Vector3(1, 0, 0),
  y: new THREE.Vector3(0, 1, 0),
  z: new THREE.Vector3(0, 0, 1),
};

export function matToQuat(m: Mat3): THREE.Quaternion {
  const m4 = new THREE.Matrix4().set(m[0], m[1], m[2], 0, m[3], m[4], m[5], 0, m[6], m[7], m[8], 0, 0, 0, 0, 1);
  return new THREE.Quaternion().setFromRotationMatrix(m4);
}

interface Anim {
  group: Id;
  pivot: THREE.Object3D;
  qStart: THREE.Quaternion;
  axis: THREE.Vector3;
  /** The turn the animation ends on, and the one it starts from (0 for a fold; where the pointer let go for a settle). */
  angle: number;
  from: number;
  /** A settle (a group let go of by the pointer: foldFeel.settleCurve, no pull-back) and the overshoot it is given, as a fraction of its way. */
  settle: boolean;
  over: number;
  /** The camera's shake at the stop, radians (0: none). */
  kick: number;
  t: number;
  dur: number;
  target: PuzzleState;
  onDone: (result: FoldResult) => void;
  /** The pull-back and the overshoot of the turn, `reduce` (no pull-back, no overshoot, no shake), the joints met and the group's size for the shake. */
  feel: Feel;
  reduce: boolean;
  joints: Joints;
  radius: number;
  stopped: boolean;
  onStop?: () => void;
}

/** What a finished fold tells the game: how many paths it joined (foldFeel.jointsOf). */
export interface FoldResult { joined: number }

/** The mark of one section's exit: its kit meshes (own glass, so it can breathe), and its light state. */
interface ExitMarker { section: Id; cell: string; at: THREE.Vector3; group: THREE.Group; glass: THREE.MeshStandardMaterial | null; pad: THREE.MeshBasicMaterial; flare: number }

export class World {
  readonly root = new THREE.Group();
  readonly colliders: THREE.Object3D[] = [];
  readonly consoleNodes = new Map<Id, THREE.Group>();
  state: PuzzleState;
  private pivots = new Map<Id, THREE.Object3D>();
  private plates = new Map<Id, { holder: THREE.Object3D; cell: string; target: number }>();
  private rails = new THREE.Group();
  private ghosts = new Map<Id, THREE.Object3D>();
  private overlay = new THREE.Group();
  private glows: { mesh: THREE.Mesh; life: number; max: number }[] = [];
  private pulses: { mesh: THREE.Mesh; t: number }[] = [];
  private anim: Anim | null = null;
  /** The group a pointer is turning, about which axis, and the pose it was in when it was taken hold of (see beginDrag). */
  private drag: { group: Id; pivot: THREE.Object3D; base: THREE.Quaternion; axis: THREE.Vector3 } | null = null;
  /** The hidden boxes of each moving group's modules: what a pointer takes hold of (the kit's pieces are merged meshes, far too many triangles to pick against). */
  private readonly groupColliders = new Map<Id, THREE.Object3D[]>();
  private readonly otherColliders = new Map<Id, THREE.Object3D[]>();
  /** Fold Mode's handle (dragHandle.ts); hung on the root, not on a pivot, so the ghosts do not copy it. */
  readonly handle: DragHandle;
  private readonly dust = new Dust();
  private readonly shake = new Shake();
  /** The marks of the sections' exits (none until the kit is in) and the section whose mark is lit. */
  private exits: ExitMarker[] = [];
  private exitSection: Id | null = null;
  /** reduceMotion, as last told by `applyShake`. */
  private calm = false;
  /** The path lines laid on the ghost of the cube while its Fold Mode option shows (hung in the ghost's cube node). */
  private previewInlay: THREE.Group | null = null;
  /** The path cube's own copy of the path glass (so its lines can be dimmed while the preview lays the lines of the turned cube over them). */
  private cubeGlass: THREE.MeshStandardMaterial | null = null;
  private gateDisc: THREE.Object3D | null = null;
  private gateOpening = false;
  private highlighted: Id | null = null;
  private consoleParts = new Map<Id, ConsoleParts>();
  private guidance = { ids: new Set<Id>(), level: 0, hidden: false };
  private warmProbe: THREE.Object3D | null = null;
  private time = 0;
  private kit: Kit | null = null;
  private flushEdges = new Set<string>();
  /** The plain stand-ins of the kit's set pieces, built only if the kit does not load. */
  private fallbacks: (() => void)[] = [];
  private cubeFaces: Partial<Record<CubeFace, DirName[]>> = {};
  /** The gilt-crowned piers and the sills of the arm towers: hidden while their group turns. */
  private crowns: { group: Id; node: THREE.Object3D }[] = [];
  /**
   * The parapets of a street that folds, in the street's own frame: shown while the walk map has none for it (it hangs, or
   * it is on its way), so the street is a walled street all the time and not a bare slab with lamp piers.
   */
  private streetRails: { id: Id; node: THREE.Object3D }[] = [];
  /** The sills at the ends of the towers' arms: shown where the arm meets a walkway, hidden while their group turns. */
  private sills: { group: Id | undefined; node: THREE.Object3D; out: THREE.Vector3 }[] = [];
  private readonly moduleById = new Map<Id, CompiledStage['modules'][number]>();
  private readonly portal: THREE.ShaderMaterial;
  private readonly cs: CompiledStage;
  private readonly M: Materials;

  constructor(cs: CompiledStage, M: Materials) {
    this.cs = cs;
    this.M = M;
    this.portal = portalMaterial(M.accent);
    this.handle = new DragHandle(M);
    this.state = cs.initialState();
    const cube = cs.modules.find((m) => m.type === 'cube3');
    const ctx = cube && cube.type === 'cube3' ? { cubeFaces: cube.params.faces as Record<CubeFace, DirName[]> } : {};
    this.cubeFaces = ctx.cubeFaces ?? {};
    for (const g of cs.stage.groups) {
      const p = new THREE.Group();
      p.name = `pivot:${g.id}`;
      p.position.set(g.pivot[0], g.pivot[1], g.pivot[2]);
      this.pivots.set(g.id, p);
      this.root.add(p);
    }
    for (const m of cs.modules) {
      this.moduleById.set(m.id, m);
      const v = buildModuleMesh(m, M, ctx);
      const f = cellFloor(m.at);
      if (m.group) {
        const g = cs.groups.get(m.group)!;
        v.root.position.set(f[0] - g.pivot[0], f[1] - g.pivot[1], f[2] - g.pivot[2]);
        this.pivots.get(m.group)!.add(v.root);
      } else {
        v.root.position.set(f[0], f[1], f[2]);
        this.root.add(v.root);
      }
      v.root.rotation.y = ((m.yaw ?? 0) * Math.PI) / 2;
      this.colliders.push(...v.colliders);
      if (m.group) this.groupColliders.set(m.group, [...(this.groupColliders.get(m.group) ?? []), ...v.colliders]);
      if (v.fallback) this.fallbacks.push(v.fallback);
      if (m.type === 'plate') {
        const holder = v.root.children[0];
        holder.scale.z = 0.001;
        this.plates.set(m.id, { holder, cell: m.at.join(','), target: 0 });
      }
    }
    for (const c of cs.stage.interactables) {
      const node = consoleMesh(c, M);
      const f = cellFloor(c.at);
      node.position.set(f[0], f[1], f[2]);
      this.consoleNodes.set(c.id, node);
      this.consoleParts.set(c.id, {
        glass: null,
        beacon: node.getObjectByName('beacon') as THREE.Mesh,
        guide: node.getObjectByName('guide') as THREE.Mesh,
      });
      this.root.add(node);
    }
    this.root.add(this.rails, this.overlay, this.dust.group, this.handle.group);
    this.setState(this.state, false);
  }

  groupQuaternion(groupId: Id, s: PuzzleState): THREE.Quaternion {
    const g = this.cs.groups.get(groupId)!;
    return matToQuat(this.cs.groupMatrix(g, s[groupId] ?? g.initial));
  }

  setState(s: PuzzleState, animatePlates = true) {
    this.state = s;
    for (const [id, p] of this.pivots) p.quaternion.copy(this.groupQuaternion(id, s));
    const wm = this.cs.walkMap(s);
    this.buildRails(wm, new Set());
    for (const c of this.crowns) c.node.visible = true;
    this.showSills(wm);
    for (const pl of this.plates.values()) {
      pl.target = wm.tiles.get(pl.cell)?.plate ? 1 : 0;
      if (!animatePlates) pl.holder.scale.z = Math.max(0.001, pl.target);
    }
  }

  get animating() {
    return this.anim !== null;
  }

  /**
   * Animate an action from the current state; parapets and plates of the moving group retract meanwhile. The turn pulls
   * back a little, swings, overshoots a little and settles (foldFeel.foldCurve), the whole taking FOLD_TIME_GAIN of the plain
   * turn's time; at the stop the camera shakes and dust rises at the joints. `reduceMotion` turns that into one gentle ease.
   * `onStop` is called at the stop, `onDone` when the state changes (the turn is over), with what the fold joined.
   * `from`: a pointer has been turning the group (beginDrag) and let go of it at this angle (radians about the action's
   * axis): it goes on from there to the stop, with no pull-back (foldFeel.settleCurve), in the share of the time that is left.
   */
  startAction(a: Action, durationScale: number, onDone: (result: FoldResult) => void, fx: { reduceMotion?: boolean; onStop?: () => void; from?: number } = {}) {
    const target = this.cs.apply(this.state, a);
    const motion = this.cs.motionOf(this.state, a);
    const g = this.cs.groups.get(a.group)!;
    const pivot = this.pivots.get(a.group)!;
    const moving = new Set(this.cs.modules.filter((m) => m.group === a.group).map((m) => m.id));
    const held = fx.from !== undefined && this.drag?.group === a.group ? this.drag : null; // (what beginDrag has put away is already away)
    if (!held) {
      this.buildRails(this.cs.walkMap(this.state), moving);
      for (const c of this.crowns) if (c.group === a.group) c.node.visible = false;
      for (const c of this.sills) if (c.group === a.group) c.node.visible = false;
      for (const pl of this.plates.values()) pl.target = 0;
    }
    this.drag = null;
    const reduce = !!fx.reduceMotion;
    const { feel, radius } = feelOf(this.cs, this.state, a);
    const plain = ((g.durationMs ?? 2000) / 1000) * durationScale * (Math.abs(motion.quarters) === 2 ? 1.35 : 1);
    const angle = (motion.quarters * Math.PI) / 2;
    const from = held ? fx.from! : 0;
    const left = Math.abs(angle - from);
    this.anim = {
      group: a.group,
      pivot,
      qStart: held ? held.base : pivot.quaternion.clone(),
      axis: AXIS[motion.axis],
      angle,
      from,
      settle: !!held,
      over: held ? Math.min(0.3, (feel.over * Math.abs(angle)) / Math.max(left, 1e-6)) : 0,
      kick: reduce ? 0 : SHAKE_BASE * Math.min(1.4, Math.max(0.7, radius / SHAKE_REFERENCE_RADIUS)),
      t: 0,
      dur: held ? settleSeconds(plain, left / Math.abs(angle), reduce) : foldSeconds(plain, reduce),
      target,
      onDone,
      feel,
      reduce,
      joints: jointsOf(this.cs.walkMap(this.state), this.cs.walkMap(target), moving),
      radius,
      stopped: false,
      onStop: fx.onStop,
    };
  }

  // ---- turning a group by hand (Fold Mode's drag; game.ts drives it from pointer events) ----

  /**
   * A pointer has taken hold of `group`: what its fold would put away goes away now (its parapets stay in the world's frame
   * and would be left standing, its plates retract, the crowns and sills of the tower are hidden), as at the start of a fold.
   * `setDragAngle` then turns it about `axis` through its pivot, from the pose it is in.
   */
  beginDrag(group: Id, axis: 'x' | 'y' | 'z') {
    if (this.drag || this.anim) return;
    const moving = new Set(this.cs.modules.filter((m) => m.group === group).map((m) => m.id));
    this.buildRails(this.cs.walkMap(this.state), moving);
    for (const c of this.crowns) if (c.group === group) c.node.visible = false;
    for (const c of this.sills) if (c.group === group) c.node.visible = false;
    for (const pl of this.plates.values()) pl.target = 0;
    this.drag = { group, pivot: this.pivots.get(group)!, base: this.groupQuaternion(group, this.state), axis: AXIS[axis] };
  }

  get dragging(): boolean {
    return this.drag !== null;
  }

  /** How far the group a pointer holds is turned now (radians about its axis, from the pose it was taken in): 0 when none is held. It follows the settle too. */
  get dragTurn(): number {
    const d = this.drag;
    if (!d) return 0;
    const rel = d.pivot.quaternion.clone().multiply(d.base.clone().invert());
    return 2 * Math.atan2(d.axis.x * rel.x + d.axis.y * rel.y + d.axis.z * rel.z, rel.w);
  }

  /** Places on a group's hidden boxes, the biggest box first: its middle, then a third of the way to each of its ends (somewhere to take hold of the group: the e2e). */
  groupSamplePoints(group: Id): THREE.Vector3[] {
    const out: THREE.Vector3[] = [];
    const size = new THREE.Vector3();
    const boxes = (this.groupColliders.get(group) ?? []).map((c) => new THREE.Box3().setFromObject(c)).sort((a, b) => b.getSize(size).lengthSq() - a.getSize(size).lengthSq());
    for (const b of boxes) {
      const c = b.getCenter(new THREE.Vector3());
      const half = b.getSize(new THREE.Vector3()).multiplyScalar(0.5);
      out.push(c);
      for (const [x, y, z] of [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, 1, 0], [0, -1, 0]]) out.push(c.clone().add(half.clone().multiply(new THREE.Vector3(x, y, z)).multiplyScalar(0.66)));
    }
    return out;
  }

  /** Turn the group a pointer holds to `angle` (radians about its axis, from the pose it was taken in). */
  setDragAngle(angle: number) {
    const d = this.drag;
    if (!d || this.anim) return;
    d.pivot.quaternion.copy(d.base).premultiply(new THREE.Quaternion().setFromAxisAngle(d.axis, angle));
  }

  /**
   * Let go of the group at `from` without changing the puzzle: it settles back to the pose it was taken in (foldFeel.settleCurve,
   * no overshoot), and the camera shakes a little as it arrives if `refused` (the stop it was heading for is blocked). `onDone`
   * runs when it is home.
   */
  settleDrag(from: number, opts: { refused?: boolean; reduceMotion?: boolean; durationScale?: number }, onDone: () => void) {
    const d = this.drag;
    if (!d || this.anim) return;
    const g = this.cs.groups.get(d.group)!;
    const reduce = !!opts.reduceMotion;
    const plain = ((g.durationMs ?? 2000) / 1000) * (opts.durationScale ?? 1);
    this.anim = {
      group: d.group,
      pivot: d.pivot,
      qStart: d.base,
      axis: d.axis,
      angle: 0,
      from,
      settle: true,
      over: 0,
      kick: opts.refused && !reduce ? SHAKE_BASE : 0,
      t: 0,
      dur: Math.min(settleSeconds(plain, Math.abs(from) / (Math.PI / 2), reduce), 0.6),
      target: this.state,
      onDone: () => {
        this.drag = null;
        onDone();
      },
      feel: { ant: 0, over: 0 },
      reduce,
      joints: { joined: 0, seams: [] },
      radius: 0,
      stopped: false,
    };
  }

  /** Drop a drag at once (Fold Mode closed, the page lost focus, a review shot): the group is back in its pose and everything put away is back. */
  endDrag() {
    if (!this.drag) return;
    this.anim = null;
    this.drag = null;
    this.setState(this.state);
  }

  /**
   * Where a pointer ray first meets `group`'s own (hidden) boxes, unless another module's box is nearer: the point it takes hold of,
   * or null. The camera's matrices and the world's must be up to date.
   */
  pickBody(ray: THREE.Ray, group: Id): THREE.Vector3 | null {
    const mine = this.groupColliders.get(group);
    if (!mine?.length) return null;
    const caster = new THREE.Raycaster();
    caster.ray.copy(ray);
    const hit = caster.intersectObjects(mine, false)[0];
    if (!hit) return null;
    let rest = this.otherColliders.get(group);
    if (!rest) this.otherColliders.set(group, (rest = this.colliders.filter((c) => !mine.includes(c))));
    const others = caster.intersectObjects(rest, false)[0];
    return others && others.distance < hit.distance - 0.05 ? null : hit.point;
  }

  /** Progress of the running fold animation, 0..1 (1 when idle). */
  get animProgress() {
    return this.anim ? Math.min(1, this.anim.t / this.anim.dur) : 1;
  }

  /** The turn has reached its end (the overshoot's peak): the camera shakes, dust rises at the joints, the game plays the stop. */
  private stop(a: Anim) {
    a.stopped = true;
    this.dust.puff(a.joints.seams, a.reduce);
    if (a.kick > 0) this.shake.kick(a.kick);
    a.onStop?.();
  }

  /**
   * Shake the camera as the last stop does (call after the camera has been put where it looks; it is undone with the next
   * placing). `reduceMotion` (the setting, passed every frame) also keeps the exit marks from breathing.
   */
  applyShake(camera: THREE.Camera, reduceMotion = false) {
    this.calm = reduceMotion;
    if (!this.shake.active) return;
    camera.rotateY(this.shake.yaw);
    camera.rotateX(this.shake.pitch);
  }

  update(dt: number) {
    this.time += dt;
    this.shake.update(dt);
    this.dust.update(dt);
    if (this.anim) {
      const a = this.anim;
      a.t += dt;
      const k = Math.min(1, a.t / a.dur);
      const way = a.settle ? settleCurve(k, a.over, a.reduce) : foldCurve(k, a.feel, a.reduce);
      const q = new THREE.Quaternion().setFromAxisAngle(a.axis, a.from + (a.angle - a.from) * way);
      a.pivot.quaternion.copy(a.qStart).premultiply(q);
      if (!a.stopped && k >= (a.reduce ? 0.92 : STOP_AT)) this.stop(a);
      if (k >= 1) {
        this.anim = null;
        const before = this.cs.walkMap(this.state);
        this.setState(a.target);
        this.flashNewEdges(before, this.cs.walkMap(a.target));
        a.onDone({ joined: a.joints.joined });
      }
    }
    for (const pl of this.plates.values()) {
      const z = pl.holder.scale.z;
      const nz = z + (pl.target - z) * Math.min(1, dt * 6);
      pl.holder.scale.z = Math.max(0.001, Math.abs(nz - pl.target) < 0.002 ? pl.target : nz);
      pl.holder.visible = pl.holder.scale.z > 0.01;
    }
    for (const [id, p] of this.consoleParts) {
      if (p.glass) p.glass.emissiveIntensity = id === this.highlighted ? GLASS_ACTIVE + Math.sin(this.time * 6) * 0.8 : GLASS_REST;
      p.beacon.visible = id === this.highlighted;
      if (p.beacon.visible) p.beacon.scale.x = p.beacon.scale.z = 1 + Math.sin(this.time * 6) * 0.35;
    }
    for (const e of this.exits) {
      if (!e.group.visible) continue;
      e.flare = Math.max(0, e.flare - dt / EXIT_FLARE_SECONDS);
      const breath = this.calm ? 0.5 : 0.5 + 0.5 * Math.sin(this.time * 2.4); // (steady with reduceMotion)
      if (e.glass) e.glass.emissiveIntensity = EXIT_GLOW[0] + (EXIT_GLOW[1] - EXIT_GLOW[0]) * breath + EXIT_FLARE * e.flare;
      e.pad.color.copy(this.M.accent).multiplyScalar(EXIT_PAD[0] + (EXIT_PAD[1] - EXIT_PAD[0]) * breath + EXIT_PAD_FLARE * e.flare);
      if (e.section !== this.exitSection && e.flare <= 0) e.group.visible = false; // the mark of a section left behind goes out once its flare is over
    }
    if (this.gateDisc) this.gateDisc.scale.setScalar(1 + Math.sin(this.time * 1.7) * 0.03);
    this.portal.uniforms.uTime.value = this.time;
    if (this.gateOpening) this.portal.uniforms.uOpen.value = Math.min(1, this.portal.uniforms.uOpen.value + dt / 2.5);
    this.glows = this.glows.filter((g) => {
      g.life -= dt;
      (g.mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(0, g.life / g.max) * 0.85;
      if (g.life <= 0) this.dropOverlay(g.mesh);
      return g.life > 0;
    });
    this.pulses = this.pulses.filter((p) => {
      p.t += dt;
      const k = p.t / 1.6;
      p.mesh.scale.setScalar(1 + k * 30);
      (p.mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 1 - k) * 0.7;
      if (k >= 1) this.dropOverlay(p.mesh);
      return k < 1;
    });
  }

  /**
   * The kit has loaded: build what the player sees from it: the slabs of the `tile`, `bridge` and `tower` modules, the
   * piers, the lamps, the set pieces of the puzzles (path cube, plates, mural, tower, gate), the consoles and the
   * parapets. Until then (and if it fails to load) only the colliders exist.
   */
  applyKit(kit: Kit) {
    this.kit = kit;
    const plan = planSlabs(this.cs);
    this.flushEdges = plan.flushEdges;
    const fixed = kit.build(plan.world, { tintOrigin: new THREE.Vector3(), walk: plan.walkWorld });
    fixed.name = 'kit:fixed';
    this.root.add(fixed);
    for (const [id, placements] of plan.modules) {
      const f = cellFloor(this.moduleById.get(id)!.at);
      this.root.getObjectByName(id)!.add(kit.build(placements, { tintOrigin: new THREE.Vector3(f[0], f[1], f[2]), walk: plan.walkModules.get(id) }));
    }
    this.addStreetRails(kit);
    this.addSetPieces(kit);
    this.addExitMarkers(kit);
    // the bronze and gilt of all consoles are two meshes; each console keeps its own glass, lit by itself
    this.root.updateMatrixWorld(true);
    const stands: { piece: string; matrix: THREE.Matrix4 }[] = [];
    for (const [id, node] of this.consoleNodes) {
      const slot = node.getObjectByName('body')!;
      for (const piece of ['console_body', 'console_head']) stands.push({ piece, matrix: slot.matrixWorld.clone() });
      const body = kit.build([{ piece: 'console_glass', matrix: new THREE.Matrix4() }], { own: ['M_console_glass'] });
      slot.add(body);
      const glass = body.getObjectByName('kit:M_console_glass') as THREE.Mesh | undefined;
      if (glass) {
        const mat = glass.material as THREE.MeshStandardMaterial;
        mat.emissive.copy(this.M.accent);
        mat.emissiveIntensity = GLASS_REST;
        this.consoleParts.get(id)!.glass = mat;
      }
    }
    const consoles = kit.build(stands);
    consoles.name = 'kit:consoles';
    consoles.applyMatrix4(new THREE.Matrix4().copy(this.root.matrixWorld).invert());
    this.root.add(consoles);
    const bulb = kit.material('M_lamp_bulb');
    if (bulb) bulb.emissiveIntensity = 2.6; // small and warm: just enough to glow against the dusk sky
    this.setState(this.state, false);
  }

  /**
   * The balustrades of the streets that fold, as the walk map lays them once a street is down: along both sides of every
   * cell but at a side port, a post at each end of a segment. They turn with the street.
   */
  private addStreetRails(kit: Kit) {
    const slots = kit.slots('balustrade', 'baluster_');
    for (const m of this.cs.modules) {
      if (m.type !== 'bridge' || !isStreet(m) || !m.group) continue;
      const open = new Set((m.params.sidePorts ?? []).map((p) => `${p.i}${p.side}`));
      const segments: THREE.Matrix4[] = [];
      const posts = new Map<string, THREE.Matrix4>();
      for (let i = 0; i < m.params.length; i++)
        for (const side of ['N', 'S'] as const) {
          if (open.has(`${i}${side}`)) continue;
          segments.push(sideMatrix(i * CELL, 0, 0, side));
          const z = side === 'N' ? -RAIL_LINE : RAIL_LINE;
          for (const x of [i * CELL - CELL / 2, i * CELL + CELL / 2]) posts.set(`${x},${z}`, new THREE.Matrix4().makeTranslation(x, 0, z));
        }
      const balusters = segments.flatMap((seg) => slots.map((b) => new THREE.Matrix4().multiplyMatrices(seg, b)));
      const node = new THREE.Group();
      node.name = 'street-rails';
      node.add(...kit.instances('balustrade_body', segments, 0.08), ...kit.instances('baluster_00', balusters, 0.1), ...kit.instances('post', [...posts.values()], 0.08));
      this.root.getObjectByName(m.id)!.add(node);
      this.streetRails.push({ id: m.id, node });
    }
  }

  /**
   * A sill bridges the joint between an arm's end and the walkway it meets: it is shown where a walkway stands there at
   * the arm's level, and not on an arm that ends in the air.
   */
  private showSills(wm: WalkMap) {
    if (!this.sills.length) return;
    this.root.updateMatrixWorld(true);
    const p = new THREE.Vector3();
    for (const sill of this.sills) {
      sill.node.parent!.localToWorld(p.copy(sill.out));
      sill.node.visible = false;
      for (const t of wm.tiles.values()) {
        const f = cellFloor(t.cell);
        if (Math.abs(f[0] - p.x) < 2 && Math.abs(f[2] - p.z) < 2 && Math.abs(t.floorY - p.y) < 0.05) sill.node.visible = true;
      }
    }
  }

  /** The gilt materials of the kit (none until it has loaded). */
  giltMaterials(): THREE.MeshStandardMaterial[] {
    return [...(this.kit?.giltMaterials() ?? []), this.handle.gilt];
  }

  /**
   * The gate's ring takes `RING_SKY` of the scene's sky, not the 2.4 times of the small gilt ornaments: a ring of polished
   * metal 9 m across mirrors a sky that is bright all round. Call once the sky is in, as for the gilt.
   */
  ringTakesSky(scene: THREE.Scene) {
    if (!scene.environment) return;
    for (const m of this.kit?.materialsNamed('M_gilt_broad') ?? []) {
      m.envMap = scene.environment;
      m.envMapIntensity = scene.environmentIntensity * RING_SKY;
      m.needsUpdate = true;
    }
  }

  /** The kit's pieces of the cube, the plates, the mural, the tower and the gate, each under its module's node. */
  private addSetPieces(kit: Kit) {
    for (const m of this.cs.modules) {
      const node = this.root.getObjectByName(m.id)!;
      if (m.type === 'cube3') {
        // its stone and paving are its own: toned by which way each face looks, whichever face is up
        const cube = kit.build(cubePlacements(m), { own: ['M_stone', 'M_paving', 'M_path_glass'] });
        this.cubeGlass = this.lightGlass(cube, PATH_GLOW);
        for (const name of ['M_stone', 'M_paving']) {
          const mesh = cube.getObjectByName(`kit:${name}`) as THREE.Mesh | undefined;
          if (!mesh) continue;
          toneByFacing(mesh.material as THREE.MeshStandardMaterial, LOOK.sunDir, CUBE_TONE);
        }
        node.add(cube);
      } else if (m.type === 'tower') {
        const placed = towerPlacements(m);
        node.add(kit.build(placed.filter((p) => !TOWER_PUT_AWAY.includes(p.piece))));
        // the crown stands on a corner of the hub, which sweeps over the neighbours' parapets as the tower turns, and the
        // sills at the arms' ends pass the neighbours' edges: like the tower's own parapets they are put away for the turn
        const crown = kit.build(placed.filter((p) => p.piece === 'tower_crown'));
        for (const p of placed.filter((q) => q.piece === 'tower_sill')) {
          const sill = kit.build([p]);
          node.add(sill);
          // (a point just beyond the arm's end, in the tower's frame: the piece is modelled on the north arm, -Z)
          this.sills.push({ group: m.group, node: sill, out: new THREE.Vector3(0, 0, -6.5).applyMatrix4(p.matrix) });
        }
        node.add(crown);
        if (m.group) this.crowns.push({ group: m.group, node: crown });
      } else if (m.type === 'plate') {
        this.plates.get(m.id)!.holder.add(kit.build([{ piece: 'plate', matrix: new THREE.Matrix4() }]));
      } else if (m.type === 'deco' && m.params.kind === 'mural') {
        const tablets = kit.slots('mural', 'tablet_').map((t) => new THREE.Vector3().setFromMatrixPosition(t));
        node.add(kit.build(muralPlacements(tablets, MURAL_FACES.map((f) => faceArmsUV(f.face, this.cubeFaces[f.face] ?? [])))));
        // the letters under the tablets, on the bronze below each
        const pitch = tablets[1].x - tablets[0].x;
        const letters = new THREE.Mesh(
          new THREE.PlaneGeometry(pitch * tablets.length, pitch / 4),
          new THREE.MeshStandardMaterial({
            map: muralLetters(MURAL_FACES.map((f) => f.label)), transparent: true, depthWrite: false, roughness: 0.8,
            polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -20,
          }),
        );
        letters.position.set((tablets[0].x + tablets[tablets.length - 1].x) / 2, tablets[0].y - 0.87, tablets[0].z - 0.014);
        letters.receiveShadow = true;
        node.add(letters);
      } else if (m.type === 'deco' && m.params.kind === 'gate') {
        const s = m.params.size ?? 1;
        const gate = kit.build([{ piece: 'gate', matrix: new THREE.Matrix4() }]);
        const disc = kit.build([{ piece: 'CoreDisc', matrix: new THREE.Matrix4() }]);
        disc.name = 'gateDisc';
        disc.position.copy(kit.origin('CoreDisc')); // it breathes about its own centre
        const holder = new THREE.Group();
        holder.scale.setScalar(s);
        holder.add(gate, disc);
        node.add(holder);
        this.useGateDisc(disc);
      }
    }
    for (const glass of kit.materialsNamed('M_path_glass')) {
      glass.emissive.copy(this.M.accent);
      glass.emissiveIntensity = PATH_GLOW;
      shapeGlassLight(glass);
    }
  }

  /**
   * The mark of each section's exit (exitMarker.ts), built once from the kit's path-line pieces with a glass of its own so it
   * can breathe on its own; only the current section's is shown (`setExitSection`).
   */
  private addExitMarkers(kit: Kit) {
    for (const m of exitMarks(this.cs.stage)) {
      const group = kit.build(exitPlacements(m.cell, m.side), { own: ['M_path_glass', 'M_bronze_trim'] });
      group.name = `exit:${m.section}`;
      group.visible = false;
      const glass = this.lightGlass(group, EXIT_GLOW[0]);
      const pad = new THREE.MeshBasicMaterial({
        color: this.M.accent.clone().multiplyScalar(EXIT_PAD[0]), vertexColors: true, transparent: true, blending: THREE.AdditiveBlending,
        depthWrite: false, fog: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -10,
      });
      group.add(new THREE.Mesh(exitPad(m.cell, m.side), pad));
      this.root.add(group);
      this.exits.push({ section: m.section, cell: cellKey(m.cell), at: new THREE.Vector3(...cellFloor(m.cell)), group, glass, pad, flare: 0 });
    }
    this.showExits();
  }

  /** The cyan light of the path glass in a built group (a private copy of the kit's material): its colour, its strength, the shaping of its edges. */
  private lightGlass(group: THREE.Group, intensity: number): THREE.MeshStandardMaterial | null {
    const mesh = group.getObjectByName('kit:M_path_glass') as THREE.Mesh | undefined;
    if (!mesh) return null;
    const glass = mesh.material as THREE.MeshStandardMaterial;
    glass.emissive.copy(this.M.accent);
    glass.emissiveIntensity = intensity;
    shapeGlassLight(glass);
    return glass;
  }

  /** The section whose exit is marked: only its mark is lit (a mark that has just been crossed finishes its flare first). */
  setExitSection(section: Id) {
    this.exitSection = section;
    this.showExits();
  }

  private showExits() {
    for (const e of this.exits) e.group.visible = e.section === this.exitSection || e.flare > 0;
  }

  /** The exit at `cell` has been crossed: its mark flares and a ring of light runs out from it. */
  crossExit(cell: string) {
    for (const e of this.exits)
      if (e.cell === cell && e.group.visible) {
        e.flare = 1;
        this.pulse(e.at);
      }
  }

  /** The kit could not be loaded: show the plain collider slabs and the plain stand-ins so the game can still be played. */
  showColliders() {
    for (const c of this.colliders) c.visible = true;
    for (const f of this.fallbacks) f();
    this.fallbacks = [];
    this.useGateDisc(this.root.getObjectByName('gateDisc'));
  }

  /** The gate's disc pulses and shows the portal shader instead of a flat glow. */
  private useGateDisc(o: THREE.Object3D | undefined) {
    this.gateDisc = o ?? null;
    let disc: THREE.Mesh | undefined;
    o?.traverse((x) => {
      if (!disc && (x as THREE.Mesh).isMesh) disc = x as THREE.Mesh;
    });
    if (!disc) return;
    prepareDisc(disc.geometry);
    disc.material = this.portal;
    disc.castShadow = false;
  }

  /** The finale: the portal brightens and turns faster. */
  openGate() {
    this.gateOpening = true;
  }

  /**
   * Compile every material once (including the Fold Mode ghosts) so the first fold does not stutter; resolves when they are
   * ready. `compile` is the engine's (it compiles for the pass that draws, `Engine.precompile`). Nothing of this is drawn: the
   * ghosts stay hidden and the probe too, compiling needs the objects but not their being seen.
   */
  warmUp(compile: (scene: THREE.Object3D) => Promise<unknown>, scene: THREE.Scene): Promise<void> {
    for (const g of this.cs.stage.groups) {
      const ghost = this.ghostFor(g.id);
      ghost.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).material = this.M.ghost;
      });
      if (!this.previewInlay) this.layPreviewInlay(ghost, g.id, this.cs.groupMatrix(g, g.initial)); // (the path cube's lines: their shader too)
    }
    const probe = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), this.M.blockedFlash);
    probe.visible = false;
    this.overlay.add(probe);
    this.warmProbe = probe;
    return compile(scene)
      .catch(() => {})
      .then(() => this.endWarmUp());
  }

  /** Hide the warm-up ghosts and drop the probe; safe to call again (compileAsync settles on its own schedule). */
  private endWarmUp() {
    this.clearPreviewInlay();
    for (const g of this.ghosts.values()) g.visible = false;
    if (this.warmProbe) this.dropOverlay(this.warmProbe);
    this.warmProbe = null;
  }

  /**
   * Review shots: a clean scene at time zero in `state`, whatever happened before. Nothing is folding, no flash, ghost
   * or warm-up leftover is shown, and the animations that run on time start from the same phase.
   */
  resetForShot(state: PuzzleState) {
    this.anim = null;
    this.drag = null;
    this.handle.show(false);
    this.endWarmUp();
    this.preview(null, [], []);
    this.dust.clear();
    this.shake.clear();
    for (const e of this.exits) e.flare = 0;
    this.showExits();
    for (const g of this.glows) this.dropOverlay(g.mesh);
    for (const p of this.pulses) this.dropOverlay(p.mesh);
    this.glows = [];
    this.pulses = [];
    this.time = 0;
    this.gateOpening = false;
    this.portal.uniforms.uOpen.value = 0;
    this.highlighted = null;
    this.setGuidanceHidden(false);
    this.setState(state, false);
  }

  highlightConsole(id: Id | null) {
    this.highlighted = id;
  }

  /** Faint guidance columns over the given consoles; level 0..1 comes from the `beacon` tunable. */
  setGuidance(ids: Id[], level: number) {
    this.guidance.ids = new Set(ids);
    this.guidance.level = level;
    this.applyGuidance();
  }

  /** Hide the guidance columns while they would stand in front of what matters (Fold Mode, folds, the finale). */
  setGuidanceHidden(hidden: boolean) {
    this.guidance.hidden = hidden;
    this.applyGuidance();
  }

  private applyGuidance() {
    const { ids, level, hidden } = this.guidance;
    for (const [id, p] of this.consoleParts) {
      const on = !hidden && ids.has(id) && level > 0.01;
      p.guide.visible = on;
      if (on) (p.guide.material as THREE.MeshBasicMaterial).opacity = 0.09 + 0.2 * level; // of a soft-edged column that is brightest at its foot and fades out upwards
    }
  }

  /** Expanding ring of light, used when a console fires. */
  pulse(at: THREE.Vector3) {
    const m = new THREE.Mesh(
      new THREE.RingGeometry(0.9, 1.0, 64),
      new THREE.MeshBasicMaterial({ color: this.M.accent.clone().multiplyScalar(3), transparent: true, depthWrite: false, side: THREE.DoubleSide }),
    );
    m.rotation.x = -Math.PI / 2;
    m.position.copy(at).add(new THREE.Vector3(0, 0.05, 0));
    m.userData.ownMaterial = true;
    this.overlay.add(m);
    this.pulses.push({ mesh: m, t: 0 });
  }

  /** Ghost of a group at the action's target state, plus edge markers and blocking highlights. */
  preview(a: Action | null, blockedBy: string[], markers: EdgeMarker[]) {
    for (const g of this.ghosts.values()) g.visible = false;
    this.clearOverlayKind('preview');
    this.clearPreviewInlay(); // (before the ghost's materials are set: its lines keep their own)
    if (!a) return;
    const ghost = this.ghostFor(a.group);
    ghost.visible = true;
    const target = this.cs.apply(this.state, a);
    ghost.quaternion.copy(this.groupQuaternion(a.group, target));
    const blocked = blockedBy.length > 0;
    ghost.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).material = blocked ? this.M.ghostBlocked : this.M.ghost;
    });
    if (!blocked) this.layPreviewInlay(ghost, a.group, this.cs.groupMatrix(this.cs.groups.get(a.group)!, target[a.group]));
    for (const b of this.cs.worldBoxes(this.state)) {
      if (!blockedBy.includes(b.module)) continue;
      const size = new THREE.Vector3(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]);
      if (size.y > 6) size.y = 6; // tall columns: highlight only the top part
      const m = new THREE.Mesh(new THREE.BoxGeometry(size.x + 0.3, size.y + 0.3, size.z + 0.3), this.M.blockedFlash);
      m.position.set((b.min[0] + b.max[0]) / 2, b.max[1] - size.y / 2, (b.min[2] + b.max[2]) / 2);
      m.userData.kind = 'preview';
      this.overlay.add(m);
    }
    for (const mk of markers) {
      const mat = (mk.kind === 'open' ? this.M.glowSoft : this.M.ghostBlocked).clone();
      const plane = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 2.2), mat);
      plane.position.copy(mk.pos).add(new THREE.Vector3(0, 1.1, 0));
      plane.rotation.y = mk.side === 'N' || mk.side === 'S' ? 0 : Math.PI / 2;
      plane.userData.kind = 'preview';
      plane.userData.ownMaterial = true;
      (plane.material as THREE.Material).side = THREE.DoubleSide;
      this.overlay.add(plane);
    }
  }

  /**
   * The path lines of the cube, on its ghost: the cube turns about its own middle, so its ghost lies exactly on the cube and
   * shows nothing the cube does not. What the player cannot see is which paths will look up, and which sideways, once it has
   * turned by `R`: the lines of those faces are laid on the ghost (not the face that will look down), in the cyan of the cube's
   * own inlays and brighter on the face that will look up, standing a few centimetres off the cube's. Not when the option is
   * blocked. They hang in the ghost's cube node, so they turn with it.
   */
  private layPreviewInlay(ghost: THREE.Object3D, group: Id, R: Mat3) {
    const kit = this.kit;
    const cube = this.cs.modules.find((m) => m.type === 'cube3' && m.group === group);
    const node = cube && ghost.getObjectByName(cube.id);
    if (!kit || !cube || cube.type !== 'cube3' || !node) return;
    const roles = cubeFaceRoles(R);
    const holder = new THREE.Group();
    holder.name = 'preview-inlay';
    for (const role of ['up', 'side'] as const) {
      const faces = (Object.keys(roles) as CubeFace[]).filter((f) => roles[f] === role);
      if (!faces.length) continue;
      const widen = role === 'up' ? PREVIEW_UP_WIDEN : 1; // (the face that will be walked on: bolder lines)
      const placed = faces.flatMap((f) => faceInlays(cube, f, PREVIEW_LIFT)).map((p) => ({
        ...p, matrix: p.matrix.clone().multiply(new THREE.Matrix4().makeScale(widen, 1, p.piece === 'cube_inlay_hub' ? widen : 1)),
      }));
      const lines = kit.build(placed, { own: ['M_path_glass', 'M_bronze_trim'] });
      this.lightGlass(lines, PREVIEW_GLOW[role]);
      lines.traverse((o) => {
        o.castShadow = false;
        o.receiveShadow = false;
      });
      holder.add(lines);
    }
    node.add(holder);
    this.previewInlay = holder;
    if (this.cubeGlass) this.cubeGlass.emissiveIntensity = PATH_GLOW * CUBE_LINES_DIMMED;
  }

  private clearPreviewInlay() {
    const holder = this.previewInlay;
    if (!holder) return;
    holder.parent?.remove(holder);
    holder.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.geometry.dispose(); // (the kit's geometry was merged into a new one; the materials are copies)
      (mesh.material as THREE.Material).dispose();
    });
    this.previewInlay = null;
    if (this.cubeGlass) this.cubeGlass.emissiveIntensity = PATH_GLOW;
  }

  private clearOverlayKind(kind: string) {
    for (const o of [...this.overlay.children]) if (o.userData.kind === kind) this.dropOverlay(o);
  }

  /** Remove an overlay mesh and free its geometry (and its material, when nothing else shares it). */
  private dropOverlay(o: THREE.Object3D) {
    this.overlay.remove(o);
    const m = o as THREE.Mesh;
    m.geometry?.dispose();
    if (o.userData.ownMaterial) (m.material as THREE.Material).dispose();
  }

  private ghostFor(groupId: Id): THREE.Object3D {
    const hit = this.ghosts.get(groupId);
    if (hit) return hit;
    const src = this.pivots.get(groupId)!;
    const ghost = new THREE.Group();
    ghost.position.copy(src.position);
    for (const child of src.children) {
      const c = child.clone(true);
      c.traverse((o) => {
        o.castShadow = false;
        o.receiveShadow = false;
      });
      ghost.add(c);
    }
    ghost.visible = false;
    this.ghosts.set(groupId, ghost);
    this.root.add(ghost);
    return ghost;
  }

  /** Brief glow on edges that just opened, so the new connection is obvious. */
  private flashNewEdges(before: WalkMap, after: WalkMap) {
    for (const t of after.tiles.values())
      for (const s of SIDES) {
        if (!t.open[s] || before.tiles.get(t.key)?.open[s]) continue;
        const f = cellFloor(t.cell);
        const d = DIRS[s];
        const m = new THREE.Mesh(
          new THREE.PlaneGeometry(4, 4),
          new THREE.MeshBasicMaterial({ color: this.M.accent.clone().multiplyScalar(2.2), transparent: true, depthWrite: false, opacity: 0.8 }),
        );
        m.rotation.x = -Math.PI / 2;
        m.position.set(f[0] + d[0] * 0.5, t.floorY + 0.04, f[2] + d[2] * 0.5);
        m.userData.ownMaterial = true;
        this.overlay.add(m);
        this.glows.push({ mesh: m, life: 2.2, max: 2.2 });
      }
  }

  /**
   * Parapets on every closed edge of the walk map, from kit pieces: balustrades on bridges, plazas, the arm tower and
   * the sunny side of the roads, low ashlar walls where a road only waits for its neighbour, on the shaded side of the
   * roads and on the path cube, and a post wherever segments meet, turn or end.
   */
  private buildRails(wm: WalkMap, hiddenModules: Set<Id>) {
    for (const c of [...this.rails.children]) {
      this.rails.remove(c);
      (c as THREE.InstancedMesh).dispose(); // the geometry belongs to the kit and stays
    }
    const kit = this.kit;
    if (!kit) return;
    // a folding street carries its own parapets wherever this map gives it none
    for (const r of this.streetRails) {
      let walked = false;
      for (const t of wm.tiles.values()) if (t.module === r.id) walked = true;
      r.node.visible = !walked || hiddenModules.has(r.id);
    }
    const lists: Record<'balustrade' | 'wall_a' | 'wall_b', THREE.Matrix4[]> = { balustrade: [], wall_a: [], wall_b: [] };
    const posts = new Map<string, THREE.Matrix4>();
    const step = (cell: readonly number[], s: Side) => `${cell[0] + DIRS[s][0]},${cell[1]},${cell[2] + DIRS[s][2]}`;
    for (const t of wm.tiles.values()) {
      if (hiddenModules.has(t.module)) continue;
      const f = cellFloor(t.cell);
      const m = this.moduleById.get(t.module);
      SIDES.forEach((s, k) => {
        if (t.open[s]) return;
        const d = DIRS[s];
        let kind: keyof typeof lists = (t.cell[0] + t.cell[2]) % 2 ? 'wall_a' : 'wall_b';
        if (m?.type === 'tower') kind = 'balustrade';
        else if (m?.type === 'bridge') {
          // across the end of a bridge a wall, along its sides the balustrade
          const along = [s, SIDES[(k + 2) % 4]].some((x) => wm.tiles.get(step(t.cell, x))?.module === t.module);
          if (!along || m.params.length === 1) kind = 'balustrade';
        } else if (m?.type === 'tile' && !this.flushEdges.has(edgeKey(f[0], f[1], f[2], s))) {
          const [w, dd] = m.params.size ?? [1, 1];
          if (Math.min(w, dd) > 1 || s === 'S' || s === 'W') kind = 'balustrade';
        }
        lists[kind].push(sideMatrix(f[0], t.floorY, f[2], s));
        // posts at both ends: on an outer corner, on the joint with the next segment, or in an inner corner
        for (const a of [SIDES[(k + 1) % 4], SIDES[(k + 3) % 4]]) {
          const u = DIRS[a];
          const next = wm.tiles.get(step(t.cell, a));
          // where the neighbour's walkway turns the corner the post stands 16 cm further on, in the corner. On the pieces that
          // move (the street, the arm tower) it stays on the cell's edge as at a straight joint: in the corner it leaves the
          // end of their parapet open, and shows the end face that is baked to be hidden
          const moves = !!m?.group && (m.type === 'tower' || isStreet(m));
          const corner = !moves && next && next.open[s] && Math.abs(next.floorY - t.floorY) < 0.01;
          const reach = !t.open[a] ? RAIL_LINE : corner ? 2.16 : 2;
          const x = f[0] + d[0] * RAIL_LINE + u[0] * reach;
          const z = f[2] + d[2] * RAIL_LINE + u[2] * reach;
          posts.set(`${x.toFixed(2)},${t.floorY.toFixed(2)},${z.toFixed(2)}`, new THREE.Matrix4().makeTranslation(x, t.floorY, z));
        }
      });
    }
    const slots = kit.slots('balustrade', 'baluster_');
    const each: THREE.Matrix4[] = [];
    for (const seg of lists.balustrade)
      for (const b of slots) each.push(new THREE.Matrix4().multiplyMatrices(seg, b));
    this.rails.add(
      ...kit.instances('balustrade_body', lists.balustrade, 0.08),
      ...kit.instances('baluster_00', each, 0.1),
      ...kit.instances('wall_a', lists.wall_a, 0.08),
      ...kit.instances('wall_b', lists.wall_b, 0.08),
      ...kit.instances('post', [...posts.values()], 0.08),
      ...kit.instances('grime', [...lists.balustrade, ...lists.wall_a, ...lists.wall_b]),
    );
  }

  /** Centre of a group's solids in a state. */
  groupCentre(groupId: Id, s: PuzzleState): THREE.Vector3 {
    const box = new THREE.Box3();
    const ids = new Set(this.cs.modules.filter((m) => m.group === groupId).map((m) => m.id));
    for (const b of this.cs.worldBoxes(s))
      if (ids.has(b.module)) box.expandByPoint(new THREE.Vector3(...b.min)).expandByPoint(new THREE.Vector3(...b.max));
    return box.getCenter(new THREE.Vector3());
  }

  /** Centre and radius that frame a group over several states, limited to the band around the player's level. */
  framing(groupId: Id, states: PuzzleState[], player: THREE.Vector3): { center: THREE.Vector3; radius: number } {
    const box = new THREE.Box3();
    const ids = new Set(this.cs.modules.filter((m) => m.group === groupId).map((m) => m.id));
    const lo = player.y - 10;
    const hi = player.y + 30;
    for (const s of states)
      for (const b of this.cs.worldBoxes(s)) {
        if (!ids.has(b.module)) continue;
        const y0 = Math.min(Math.max(b.min[1], lo), hi);
        const y1 = Math.min(Math.max(b.max[1], lo), hi);
        box.expandByPoint(new THREE.Vector3(b.min[0], y0, b.min[2]));
        box.expandByPoint(new THREE.Vector3(b.max[0], y1, b.max[2]));
      }
    box.expandByPoint(player.clone().add(new THREE.Vector3(0, 1.5, 0)));
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    sphere.center.y = Math.max(sphere.center.y, player.y + 1);
    return { center: sphere.center, radius: Math.min(22, Math.max(7, sphere.radius)) };
  }
}
