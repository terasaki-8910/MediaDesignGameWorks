// Scene graph for a compiled stage: module meshes under group pivots, parapets derived from the walk map,
// gap plates, consoles, fold animations and Fold Mode previews.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { CompiledStage, WalkMap } from '../core/compile.ts';
import { DIRS, SIDES, cellFloor, type Mat3, type Side } from '../core/math.ts';
import type { Action, CubeFace, Id, PuzzleState } from '../core/types.ts';
import type { DirName } from '../core/math.ts';
import { buildModuleMesh, consoleMesh } from './kitMeshes.ts';
import type { Materials } from './materials.ts';
import { portalMaterial, prepareDisc } from './portal.ts';

export interface EdgeMarker { pos: THREE.Vector3; side: Side; kind: 'open' | 'close' }

interface ConsoleParts { holo: THREE.Object3D; beacon: THREE.Mesh; guide: THREE.Mesh }

const AXIS: Record<'x' | 'y' | 'z', THREE.Vector3> = {
  x: new THREE.Vector3(1, 0, 0),
  y: new THREE.Vector3(0, 1, 0),
  z: new THREE.Vector3(0, 0, 1),
};

export function matToQuat(m: Mat3): THREE.Quaternion {
  const m4 = new THREE.Matrix4().set(m[0], m[1], m[2], 0, m[3], m[4], m[5], 0, m[6], m[7], m[8], 0, 0, 0, 0, 1);
  return new THREE.Quaternion().setFromRotationMatrix(m4);
}

const easeInOut = (k: number) => (k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2);

interface Anim {
  group: Id;
  pivot: THREE.Object3D;
  qStart: THREE.Quaternion;
  axis: THREE.Vector3;
  angle: number;
  t: number;
  dur: number;
  target: PuzzleState;
  onDone: () => void;
}

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
  private gateDisc: THREE.Object3D | null = null;
  private gateOpening = false;
  private highlighted: Id | null = null;
  private consoleParts = new Map<Id, ConsoleParts>();
  private guidance = { ids: new Set<Id>(), level: 0, hidden: false };
  private time = 0;
  private readonly portal: THREE.ShaderMaterial;
  private readonly cs: CompiledStage;
  private readonly M: Materials;

  constructor(cs: CompiledStage, M: Materials) {
    this.cs = cs;
    this.M = M;
    this.portal = portalMaterial(M.accent);
    this.state = cs.initialState();
    const cube = cs.modules.find((m) => m.type === 'cube3');
    const ctx = cube && cube.type === 'cube3' ? { cubeFaces: cube.params.faces as Record<CubeFace, DirName[]> } : {};
    for (const g of cs.stage.groups) {
      const p = new THREE.Group();
      p.name = `pivot:${g.id}`;
      p.position.set(g.pivot[0], g.pivot[1], g.pivot[2]);
      this.pivots.set(g.id, p);
      this.root.add(p);
    }
    for (const m of cs.modules) {
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
      if (m.type === 'plate') {
        const holder = v.root.children[0];
        holder.scale.z = 0.001;
        this.plates.set(m.id, { holder, cell: m.at.join(','), target: 0 });
      }
      if (m.type === 'deco' && m.params.kind === 'gate') this.useGateDisc(v.root.getObjectByName('gateDisc'));
    }
    for (const c of cs.stage.interactables) {
      const node = consoleMesh(c, M);
      const f = cellFloor(c.at);
      node.position.set(f[0], f[1], f[2]);
      this.consoleNodes.set(c.id, node);
      this.consoleParts.set(c.id, {
        holo: node.getObjectByName('holo')!,
        beacon: node.getObjectByName('beacon') as THREE.Mesh,
        guide: node.getObjectByName('guide') as THREE.Mesh,
      });
      this.root.add(node);
    }
    this.root.add(this.rails, this.overlay);
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
    for (const pl of this.plates.values()) {
      pl.target = wm.tiles.get(pl.cell)?.plate ? 1 : 0;
      if (!animatePlates) pl.holder.scale.z = Math.max(0.001, pl.target);
    }
  }

  get animating() {
    return this.anim !== null;
  }

  /** Animate an action from the current state; parapets and plates of the moving group retract meanwhile. */
  startAction(a: Action, durationScale: number, onDone: () => void) {
    const target = this.cs.apply(this.state, a);
    const motion = this.cs.motionOf(this.state, a);
    const g = this.cs.groups.get(a.group)!;
    const pivot = this.pivots.get(a.group)!;
    const moving = new Set(this.cs.modules.filter((m) => m.group === a.group).map((m) => m.id));
    this.buildRails(this.cs.walkMap(this.state), moving);
    for (const pl of this.plates.values()) pl.target = 0;
    this.anim = {
      group: a.group,
      pivot,
      qStart: pivot.quaternion.clone(),
      axis: AXIS[motion.axis],
      angle: (motion.quarters * Math.PI) / 2,
      t: 0,
      dur: ((g.durationMs ?? 2000) / 1000) * durationScale * (Math.abs(motion.quarters) === 2 ? 1.35 : 1),
      target,
      onDone,
    };
  }

  /** Progress of the running fold animation, 0..1 (1 when idle). */
  get animProgress() {
    return this.anim ? Math.min(1, this.anim.t / this.anim.dur) : 1;
  }

  update(dt: number) {
    this.time += dt;
    if (this.anim) {
      const a = this.anim;
      a.t += dt;
      const k = Math.min(1, a.t / a.dur);
      const q = new THREE.Quaternion().setFromAxisAngle(a.axis, a.angle * easeInOut(k));
      a.pivot.quaternion.copy(a.qStart).premultiply(q);
      if (k >= 1) {
        this.anim = null;
        const before = this.cs.walkMap(this.state);
        this.setState(a.target);
        this.flashNewEdges(before, this.cs.walkMap(a.target));
        a.onDone();
      }
    }
    for (const pl of this.plates.values()) {
      const z = pl.holder.scale.z;
      const nz = z + (pl.target - z) * Math.min(1, dt * 6);
      pl.holder.scale.z = Math.max(0.001, Math.abs(nz - pl.target) < 0.002 ? pl.target : nz);
      pl.holder.visible = pl.holder.scale.z > 0.01;
    }
    for (const [id, p] of this.consoleParts) {
      p.holo.rotation.y += dt * (id === this.highlighted ? 3 : 0.8);
      p.holo.rotation.x += dt * 0.5;
      p.holo.position.y = 1.6 + Math.sin(this.time * 2 + p.holo.id) * 0.06;
      p.beacon.visible = id === this.highlighted;
      if (p.beacon.visible) p.beacon.scale.x = p.beacon.scale.z = 1 + Math.sin(this.time * 6) * 0.35;
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

  /** Swap the procedural gate for the Blender-generated model when public/assets/gate.glb is available. */
  async loadGateModel(url: string) {
    const deco = this.cs.modules.find((m) => m.type === 'deco' && m.params.kind === 'gate');
    const node = deco ? this.root.getObjectByName(deco.id) : undefined;
    if (!node) return;
    const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
    const gltf = await new GLTFLoader().loadAsync(url);
    gltf.scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = mesh.receiveShadow = true;
      // the core material glows at strength 4 in Blender, which blooms to flat white here: keep its colour readable
      const mat = mesh.material as THREE.MeshStandardMaterial;
      if (mat.emissiveIntensity > 1.5) mat.emissiveIntensity = 1.5;
    });
    node.clear();
    node.add(gltf.scene);
    this.useGateDisc(gltf.scene.getObjectByName('CoreDisc'));
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

  /** Compile every material once (including the Fold Mode ghosts) so the first fold does not stutter. */
  warmUp(renderer: THREE.WebGLRenderer, camera: THREE.Camera, scene: THREE.Scene) {
    for (const g of this.cs.stage.groups) {
      const ghost = this.ghostFor(g.id);
      ghost.visible = true;
      ghost.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).material = this.M.ghost;
      });
    }
    const probe = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), this.M.blockedFlash);
    this.overlay.add(probe);
    renderer
      .compileAsync(scene, camera)
      .catch(() => {})
      .finally(() => {
        for (const g of this.ghosts.values()) g.visible = false;
        this.dropOverlay(probe);
      });
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
      if (on) (p.guide.material as THREE.MeshBasicMaterial).opacity = 0.05 + 0.22 * level;
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
    if (!a) return;
    const ghost = this.ghostFor(a.group);
    ghost.visible = true;
    ghost.quaternion.copy(this.groupQuaternion(a.group, this.cs.apply(this.state, a)));
    const blocked = blockedBy.length > 0;
    ghost.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).material = blocked ? this.M.ghostBlocked : this.M.ghost;
    });
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

  private buildRails(wm: WalkMap, hiddenModules: Set<Id>) {
    for (const c of [...this.rails.children]) {
      this.rails.remove(c);
      (c as THREE.Mesh).geometry?.dispose();
    }
    const walls: THREE.BufferGeometry[] = [];
    const caps: THREE.BufferGeometry[] = [];
    for (const t of wm.tiles.values()) {
      if (hiddenModules.has(t.module)) continue;
      const f = cellFloor(t.cell);
      for (const s of SIDES) {
        if (t.open[s]) continue;
        const d = DIRS[s];
        const along = d[0] === 0; // wall runs along X when the side is N or S
        const cx = f[0] + d[0] * 1.84;
        const cz = f[2] + d[2] * 1.84;
        const w = new THREE.BoxGeometry(along ? 4 : 0.28, 1.0, along ? 0.28 : 4);
        w.translate(cx, t.floorY + 0.5, cz);
        walls.push(w);
        const c = new THREE.BoxGeometry(along ? 4.08 : 0.42, 0.09, along ? 0.42 : 4.08);
        c.translate(cx, t.floorY + 1.04, cz);
        caps.push(c);
      }
    }
    if (walls.length) {
      const wm1 = new THREE.Mesh(mergeGeometries(walls), this.M.parapet);
      wm1.castShadow = wm1.receiveShadow = true;
      const cm = new THREE.Mesh(mergeGeometries(caps), this.M.brass);
      cm.castShadow = true;
      this.rails.add(wm1, cm);
    }
    for (const g of [...walls, ...caps]) g.dispose();
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
