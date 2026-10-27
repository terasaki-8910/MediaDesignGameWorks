// Procedural meshes for each module type, built in the same module-local frame as src/core/kit.ts.
import * as THREE from 'three';
import { CUBE_FACE_NORMAL, SLAB } from '../core/kit.ts';
import { DIRS, type DirName } from '../core/math.ts';
import type { CubeFace, Interactable, ModuleInstance } from '../core/types.ts';
import type { Materials } from './materials.ts';
import { cubeFaceTextures, muralTexture } from './textures.ts';

const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);

function mesh(g: THREE.BufferGeometry, m: THREE.Material | THREE.Material[], cast = true, receive = true) {
  const o = new THREE.Mesh(g, m);
  o.castShadow = cast;
  o.receiveShadow = receive;
  return o;
}

/** A floor slab whose top face repeats the paver texture once per 4 m cell. */
function slabMesh(M: Materials, w: number, d: number, cellsU: number, cellsV: number) {
  const g = box(w, SLAB, d);
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  const top = g.groups[2];
  for (let i = top.start; i < top.start + top.count; i++) {
    const vi = g.index!.getX(i);
    uv.setXY(vi, uv.getX(vi) * cellsU, uv.getY(vi) * cellsV);
  }
  const m = mesh(g, [M.slabSide, M.slabSide, M.floor, M.slabSide, M.slabSide, M.slabSide]);
  m.position.y = -SLAB / 2;
  m.userData.collider = true;
  return m;
}

function cornice(M: Materials, w: number, d: number) {
  const c = mesh(box(w + 0.35, 0.16, d + 0.35), M.parapet);
  c.position.y = -SLAB - 0.05;
  return c;
}

function columns(M: Materials, pts: [number, number][], depth = 46) {
  const g = new THREE.CylinderGeometry(0.42, 0.55, depth, 10);
  const inst = new THREE.InstancedMesh(g, M.column, pts.length);
  const m4 = new THREE.Matrix4();
  pts.forEach(([x, z], i) => inst.setMatrixAt(i, m4.makeTranslation(x, -SLAB - depth / 2, z)));
  inst.castShadow = true;
  inst.receiveShadow = true;
  return inst;
}

function lampPost(M: Materials) {
  const g = new THREE.Group();
  const post = mesh(new THREE.CylinderGeometry(0.06, 0.09, 3.0, 8), M.brass);
  post.position.y = 1.5;
  const bulb = mesh(new THREE.SphereGeometry(0.2, 12, 8), M.lamp, false, false);
  bulb.position.y = 3.1;
  const cap = mesh(new THREE.ConeGeometry(0.28, 0.25, 10), M.brass);
  cap.position.y = 3.38;
  g.add(post, bulb, cap);
  return g;
}

function arch(M: Materials, span: number, height: number) {
  const g = new THREE.Group();
  const r = span / 2;
  for (const x of [-r, r]) {
    const p = mesh(box(0.5, height, 0.5), M.parapet);
    p.position.set(x, height / 2, 0);
    g.add(p);
  }
  const ring = mesh(new THREE.TorusGeometry(r, 0.25, 8, 24, Math.PI), M.parapet);
  ring.position.y = height;
  g.add(ring);
  const key = mesh(box(0.6, 0.6, 0.6), M.brass);
  key.position.y = height + r;
  g.add(key);
  return g;
}

/** Texture-space offset of an arm on a BoxGeometry face (u right, v down), see BoxGeometry's buildPlane. */
const FACE_UV: Record<CubeFace, { u: readonly number[]; v: readonly number[]; material: number }> = {
  east: { u: [0, 0, -1], v: [0, -1, 0], material: 0 },
  west: { u: [0, 0, 1], v: [0, -1, 0], material: 1 },
  top: { u: [1, 0, 0], v: [0, 0, 1], material: 2 },
  bottom: { u: [1, 0, 0], v: [0, 0, -1], material: 3 },
  south: { u: [1, 0, 0], v: [0, -1, 0], material: 4 },
  north: { u: [-1, 0, 0], v: [0, -1, 0], material: 5 },
};

export function faceArmsUV(face: CubeFace, arms: DirName[]): { u: number; v: number }[] {
  const f = FACE_UV[face];
  return arms.map((a) => {
    const d = DIRS[a];
    return { u: d[0] * f.u[0] + d[1] * f.u[1] + d[2] * f.u[2], v: d[0] * f.v[0] + d[1] * f.v[1] + d[2] * f.v[2] };
  });
}

export interface ModuleVisual {
  root: THREE.Object3D;
  /** Meshes that should block the camera. */
  colliders: THREE.Object3D[];
}

export interface BuildContext { cubeFaces?: Record<CubeFace, DirName[]> }

export function buildModuleMesh(m: ModuleInstance, M: Materials, ctx: BuildContext = {}): ModuleVisual {
  const root = new THREE.Group();
  root.name = m.id;
  switch (m.type) {
    case 'tile': {
      const [w, d] = m.params.size ?? [1, 1];
      const s = slabMesh(M, w * 4, d * 4, w, d);
      s.position.set((w - 1) * 2, -SLAB / 2, (d - 1) * 2);
      const c = cornice(M, w * 4, d * 4);
      c.position.x = (w - 1) * 2;
      c.position.z = (d - 1) * 2;
      const pts: [number, number][] = [];
      for (let i = 0; i <= w; i += Math.max(1, Math.floor(w / 2)))
        for (let j = 0; j <= d; j += Math.max(1, Math.floor(d / 2))) pts.push([i * 4 - 2.4 + (i === 0 ? 0.8 : 0), j * 4 - 2.4 + (j === 0 ? 0.8 : 0)]);
      root.add(s, c, columns(M, pts));
      return { root, colliders: [s] };
    }
    case 'bridge': {
      const L = m.params.length;
      const inset = m.params.inset ?? 0;
      const s = slabMesh(M, L * 4 - inset * 2, 4, L, 1);
      s.position.set((L - 1) * 2, -SLAB / 2, 0);
      const beam = mesh(box(L * 4 - inset * 2 - 1, 1.4, 1.6), M.slate);
      beam.position.set((L - 1) * 2, -SLAB - 0.7, 0);
      const trim = mesh(box(L * 4 - inset * 2, 0.12, 4.3), M.brass);
      trim.position.set((L - 1) * 2, -SLAB - 0.02, 0);
      root.add(s, beam, trim);
      if (m.params.lamps) {
        const open = new Set((m.params.sidePorts ?? []).map((p) => `${p.i}${p.side}`));
        for (let i = 0; i < L; i++)
          for (const side of ['N', 'S'] as const) {
            if (open.has(`${i}${side}`)) continue;
            const lp = lampPost(M);
            lp.position.set(i * 4, 0, side === 'N' ? -1.75 : 1.75);
            root.add(lp);
          }
        if (L >= 4) {
          const a = arch(M, 4.2, 4.2);
          a.rotation.y = Math.PI / 2;
          a.position.set((L - 1) * 4 + 1.2, 0, 0);
          root.add(a);
        }
      }
      return { root, colliders: [s] };
    }
    case 'cube3': {
      const faces = m.params.faces;
      const mats: THREE.Material[] = new Array(6);
      (Object.keys(FACE_UV) as CubeFace[]).forEach((face, k) => {
        const { map, emissive } = cubeFaceTextures(faceArmsUV(face, faces[face] ?? []), '#7ff6ff', 30 + k);
        mats[FACE_UV[face].material] = new THREE.MeshStandardMaterial({
          map, emissiveMap: emissive, emissive: new THREE.Color(1, 1, 1), emissiveIntensity: 2.2, roughness: 0.42, metalness: 0.05,
        });
      });
      const c = mesh(box(12, 12, 12), mats);
      c.position.set(4, 6, 4);
      c.userData.collider = true;
      root.add(c);
      // brass edges
      const e = 6.05;
      for (const [sx, sy, sz, px, py, pz] of [
        [12.3, 0.3, 0.3, 0, e, e], [12.3, 0.3, 0.3, 0, -e, e], [12.3, 0.3, 0.3, 0, e, -e], [12.3, 0.3, 0.3, 0, -e, -e],
        [0.3, 12.3, 0.3, e, 0, e], [0.3, 12.3, 0.3, -e, 0, e], [0.3, 12.3, 0.3, e, 0, -e], [0.3, 12.3, 0.3, -e, 0, -e],
        [0.3, 0.3, 12.3, e, e, 0], [0.3, 0.3, 12.3, -e, e, 0], [0.3, 0.3, 12.3, e, -e, 0], [0.3, 0.3, 12.3, -e, -e, 0],
      ]) {
        const b = mesh(box(sx, sy, sz), M.brass);
        b.position.set(4 + px, 6 + py, 4 + pz);
        root.add(b);
      }
      return { root, colliders: [c] };
    }
    case 'tower': {
      const depth = m.params.depth ?? 40;
      const inset = m.params.inset ?? 0.4;
      const top = slabMesh(M, 4, 4, 1, 1);
      root.add(top);
      const colliders: THREE.Object3D[] = [top];
      for (const a of m.params.arms) {
        const d = DIRS[a];
        const along = Math.abs(d[0]) > 0;
        const len = 4 - inset;
        const s = slabMesh(M, along ? len : 4, along ? 4 : len, along ? 1 : 1, 1);
        s.position.set(d[0] * (2 + len / 2), -SLAB / 2, d[2] * (2 + len / 2));
        root.add(s);
        colliders.push(s);
        const strut = mesh(box(along ? len : 0.6, 1.2, along ? 0.6 : len), M.brass);
        strut.position.set(d[0] * (2 + len / 2), -SLAB - 0.6, d[2] * (2 + len / 2));
        root.add(strut);
      }
      const col = mesh(new THREE.CylinderGeometry(1.6, 1.9, depth, 20), M.slate);
      col.position.y = -SLAB - depth / 2;
      const gear = mesh(new THREE.TorusGeometry(2.1, 0.22, 8, 32), M.brass);
      gear.rotation.x = Math.PI / 2;
      gear.position.y = -SLAB - 0.4;
      const ring = mesh(new THREE.TorusGeometry(1.2, 0.06, 6, 32), M.glow, false, false);
      ring.rotation.x = Math.PI / 2;
      ring.position.y = 0.03;
      root.add(col, gear, ring);
      colliders.push(col);
      return { root, colliders };
    }
    case 'plate': {
      // A gap filler that extends from the owner side (opposite of dir) towards dir. Origin at the owner edge.
      const d = DIRS[m.params.dir];
      const holder = new THREE.Group();
      holder.position.set(-d[0] * 2, 0, -d[2] * 2);
      holder.rotation.y = Math.atan2(d[0], d[2]);
      const p = mesh(box(3.8, 0.25, 4), [M.slabSide, M.slabSide, M.floor, M.slabSide, M.slabSide, M.slabSide]);
      p.geometry.translate(0, -0.125, 2);
      const lip = mesh(box(3.9, 0.1, 0.25), M.glow, false, false);
      lip.geometry.translate(0, -0.02, 3.9);
      holder.add(p, lip);
      holder.userData.plate = true;
      root.add(holder);
      return { root, colliders: [] };
    }
    case 'deco': {
      if (m.params.kind === 'gate') {
        const s = m.params.size ?? 1;
        const g = new THREE.Group();
        const ring = mesh(new THREE.TorusGeometry(4.2 * s, 0.45 * s, 16, 64), M.brass);
        ring.position.y = 5 * s;
        const inner = mesh(new THREE.TorusGeometry(3.4 * s, 0.12 * s, 8, 64), M.glow, false, false);
        inner.position.y = 5 * s;
        const disc = mesh(new THREE.CircleGeometry(3.3 * s, 48), M.glowSoft, false, false);
        disc.position.y = 5 * s;
        disc.name = 'gateDisc';
        const base = mesh(box(9 * s, 0.6, 2.2 * s), M.parapet);
        base.position.y = 0.3;
        g.add(ring, inner, disc, base);
        root.add(g);
      } else if (m.params.kind === 'mural') {
        const panel = mesh(box(9, 3.2, 0.25), [M.parapet, M.parapet, M.parapet, M.parapet, M.parapet,
          new THREE.MeshStandardMaterial({
            map: muralTexture(
              (['top', 'north', 'east', 'south', 'west', 'bottom'] as CubeFace[]).map((f) => ({
                name: { top: '上', north: '北', east: '東', south: '南', west: '西', bottom: '底' }[f],
                arms: faceArmsUV(f, ctx.cubeFaces?.[f] ?? []),
              })),
              '#7ff6ff',
            ),
            roughness: 0.6,
          })]);
        panel.position.set(0, 1.9, 1.7);
        panel.rotation.y = Math.PI;
        root.add(panel);
      } else {
        const ob = mesh(new THREE.CylinderGeometry(0.4, 0.8, 8, 4), M.parapet);
        ob.position.y = 4;
        root.add(ob);
      }
      return { root, colliders: [] };
    }
  }
}

export function consoleMesh(c: Interactable, M: Materials): THREE.Group {
  const g = new THREE.Group();
  const d = DIRS[c.facing];
  const ped = mesh(new THREE.CylinderGeometry(0.42, 0.55, 1.05, 12), M.parapet);
  ped.position.set(d[0] * 1.35, 0.52, d[2] * 1.35);
  const top = mesh(new THREE.CylinderGeometry(0.52, 0.52, 0.08, 16), M.brass);
  top.position.set(d[0] * 1.35, 1.08, d[2] * 1.35);
  const holo = mesh(new THREE.BoxGeometry(0.42, 0.42, 0.42), M.glow, false, false);
  holo.position.set(d[0] * 1.35, 1.6, d[2] * 1.35);
  holo.name = 'holo';
  const ring = mesh(new THREE.RingGeometry(1.5, 1.62, 40), M.glowSoft, false, false);
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.03;
  ring.name = 'ring';
  const beacon = mesh(new THREE.CylinderGeometry(0.18, 0.18, 30, 8, 1, true), M.glowSoft, false, false);
  beacon.position.set(d[0] * 1.35, 16, d[2] * 1.35);
  beacon.visible = false;
  beacon.name = 'beacon';
  g.add(ped, top, holo, ring, beacon);
  return g;
}

export { CUBE_FACE_NORMAL };
