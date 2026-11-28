// What every module type needs before the Blender kit has loaded, in the same module-local frame as src/core/kit.ts:
// the hidden colliders the camera's rays hit, and the nodes the kit's pieces are hung on. What the player sees comes
// from the kit (kit.ts, kitLayout.ts, setPieces.ts). `fallback` builds the old plain meshes instead; it is called only
// when the kit could not be loaded, so the game can still be played.
import * as THREE from 'three';
import { CUBE_FACE_NORMAL, SLAB, TETHER_HEIGHT, tetherRing } from '../core/kit.ts';
import { DIRS, type DirName, type Side } from '../core/math.ts';
import type { CubeFace, Handle, Interactable, ModuleInstance } from '../core/types.ts';
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
  const verts = new Set<number>(); // each vertex once: the index buffer repeats shared corners
  for (let i = top.start; i < top.start + top.count; i++) verts.add(g.index!.getX(i));
  for (const vi of verts) uv.setXY(vi, uv.getX(vi) * cellsU, uv.getY(vi) * cellsV);
  const m = mesh(g, [M.slabSide, M.slabSide, M.floor, M.slabSide, M.slabSide, M.slabSide]);
  m.position.y = -SLAB / 2;
  m.userData.collider = true;
  return m;
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
  /** Builds the plain stand-in for the kit's pieces (the kit failed to load). */
  fallback?: () => void;
}

/** A collider that is never drawn: the camera's rays still hit it. */
function hidden<T extends THREE.Object3D>(o: T): T {
  o.visible = false;
  return o;
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
      s.visible = false; // the camera's rays still hit it
      root.add(s);
      return { root, colliders: [s] };
    }
    case 'bridge': {
      const L = m.params.length;
      const inset = m.params.inset ?? 0;
      const s = slabMesh(M, L * 4 - inset * 2, 4, L, 1);
      s.position.set((L - 1) * 2, -SLAB / 2, 0);
      s.visible = false;
      root.add(s);
      return { root, colliders: [s] };
    }
    case 'cube3': {
      const faces = m.params.faces;
      const c = hidden(mesh(box(12, 12, 12), M.parapet));
      c.position.set(4, 6, 4);
      c.userData.collider = true;
      root.add(c);
      const fallback = () => {
        const mats: THREE.Material[] = new Array(6);
        (Object.keys(FACE_UV) as CubeFace[]).forEach((face, k) => {
          const { map, emissive } = cubeFaceTextures(faceArmsUV(face, faces[face] ?? []), '#7ff6ff', 30 + k);
          mats[FACE_UV[face].material] = new THREE.MeshStandardMaterial({
            map, emissiveMap: emissive, emissive: new THREE.Color(1, 1, 1), emissiveIntensity: 2.2, roughness: 0.42, metalness: 0.05,
          });
        });
        c.material = mats;
        c.visible = true;
      };
      return { root, colliders: [c], fallback };
    }
    case 'tower': {
      const depth = m.params.depth ?? 40;
      const inset = m.params.inset ?? 0.4;
      const top = hidden(slabMesh(M, 4, 4, 1, 1));
      root.add(top);
      const colliders: THREE.Object3D[] = [top];
      for (const a of m.params.arms) {
        const d = DIRS[a];
        const along = Math.abs(d[0]) > 0;
        const len = 4 - inset;
        const s = hidden(slabMesh(M, along ? len : 4, along ? 4 : len, along ? 1 : 1, 1));
        s.position.set(d[0] * (2 + len / 2), -SLAB / 2, d[2] * (2 + len / 2));
        root.add(s);
        colliders.push(s);
      }
      const col = hidden(mesh(new THREE.CylinderGeometry(1.6, 1.9, depth, 20), M.slate));
      col.position.y = -SLAB - depth / 2;
      root.add(col);
      colliders.push(col);
      return { root, colliders };
    }
    case 'plate': {
      // A gap filler that extends from the owner side (opposite of dir) towards dir. Origin at the owner edge.
      const d = DIRS[m.params.dir];
      const holder = new THREE.Group();
      holder.position.set(-d[0] * 2, 0, -d[2] * 2);
      holder.rotation.y = Math.atan2(d[0], d[2]);
      holder.userData.plate = true;
      root.add(holder);
      const fallback = () => {
        const p = mesh(box(3.8, 0.25, 4), [M.slabSide, M.slabSide, M.floor, M.slabSide, M.slabSide, M.slabSide]);
        p.geometry.translate(0, -0.125, 2);
        const lip = mesh(box(3.9, 0.1, 0.25), M.glow, false, false);
        lip.geometry.translate(0, -0.02, 3.9);
        holder.add(p, lip);
      };
      return { root, colliders: [], fallback };
    }
    case 'deco': {
      const fallback = () => {
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
      };
      if (m.params.kind !== 'gate' && m.params.kind !== 'mural') {
        fallback(); // no kit piece for it: the plain mesh is all there is
        return { root, colliders: [] };
      }
      return { root, colliders: [], fallback };
    }
    case 'tether':
      root.add(tetherRingMesh(m.params.facing, M)); // v0.5, greybox: a ring on a post (the art pass makes the real thing)
      return { root, colliders: [] };
  }
}

/** Radius of a tether's ring and of its tube, and of the post it hangs on (metres). Greybox numbers. */
const TETHER = { ring: 0.42, tube: 0.05, core: 0.1, post: 0.045 };

/**
 * A tether, in the module's own frame (it turns with its group): a gilt ring at the middle of its cell's `facing` edge, 1.6 m
 * over the floor, its face turned towards the cell it looks at, a cyan core in the middle of it (the core is the part that
 * lights up when the ring is joined to another: it is named for the world to find), and a slim gilt post under it to the floor.
 * Greybox: a placeholder for the art pass after the owner's playtest.
 */
export function tetherRingMesh(facing: Side, M: Materials): THREE.Group {
  const g = new THREE.Group();
  g.name = 'tether-ring';
  const at = tetherRing(facing);
  const d = DIRS[facing];
  const ring = mesh(new THREE.TorusGeometry(TETHER.ring, TETHER.tube, 8, 28), M.brass, true, false);
  ring.position.set(at[0], at[1], at[2]);
  ring.rotation.y = Math.atan2(d[0], d[2]); // the torus faces +Z: turn it to face the way the thread goes
  const core = mesh(new THREE.SphereGeometry(TETHER.core, 12, 8), M.glow.clone(), false, false);
  core.name = 'tether-core';
  core.position.set(at[0], at[1], at[2]);
  const post = mesh(new THREE.CylinderGeometry(TETHER.post, TETHER.post, TETHER_HEIGHT - TETHER.ring, 6), M.brass, true, false);
  post.position.set(at[0], (TETHER_HEIGHT - TETHER.ring) / 2, at[2]);
  g.add(ring, core, post);
  return g;
}

/** Radius of a handle's ring (metres). Greybox. */
const HANDLE_RING = 0.5;

/**
 * A handle, in the world's frame (it does not move with the group it turns): a floating gilt ring standing on edge, with a cyan
 * turn glyph (two arrows chasing round) in it, both turning slowly about the vertical (the group named `spin`), and a cyan core
 * (`handle-core`) that stays put. Greybox: a placeholder for the art pass.
 */
export function handleMesh(h: Handle, M: Materials): THREE.Group {
  const g = new THREE.Group();
  g.name = `handle:${h.id}`;
  const spin = new THREE.Group();
  spin.name = 'spin';
  spin.add(mesh(new THREE.TorusGeometry(HANDLE_RING, 0.055, 8, 32), M.brass, true, false));
  const glyph = M.glow.clone(); // (each handle lights on its own: whether it is the one Q and E turn)
  glyph.name = 'handle-glyph';
  for (const turn of [0, Math.PI]) {
    const arc = mesh(new THREE.TorusGeometry(HANDLE_RING * 0.62, 0.028, 6, 14, Math.PI * 0.7), glyph, false, false);
    arc.rotation.z = turn;
    const tip = mesh(new THREE.ConeGeometry(0.075, 0.18, 6), glyph, false, false);
    const a = turn + Math.PI * 0.7;
    tip.position.set(Math.cos(a) * HANDLE_RING * 0.62, Math.sin(a) * HANDLE_RING * 0.62, 0);
    tip.rotation.z = a; // (the cone points up its own +Y: the tangent at angle a is a + 90 degrees)
    spin.add(arc, tip);
  }
  const core = mesh(new THREE.SphereGeometry(0.09, 10, 8), glyph, false, false);
  core.name = 'handle-core';
  g.add(spin, core);
  return g;
}

/** An open cylinder whose vertex colours run from full at the foot to nothing at the top: a column of light with no cap. */
function fadingColumn(radius: number, height: number, sides: number): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(radius, radius, height, sides, 10, true);
  const pos = g.getAttribute('position');
  const col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const t = pos.getY(i) / height + 0.5;
    const v = (1 - t) ** 1.6 * THREE.MathUtils.smoothstep(t, 0, 0.06);
    col.set([v, v, v], i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

/**
 * The guidance column: a lit tube that is brightest in the middle of its width and dies away at both edges (the glow of a
 * beam of light, not a slab: the brief keeps it a faint cue), and fades out smoothly well short of its top so it never runs
 * up into the sky. The edges fall off with the angle between the surface and the eye (see `softEdge`); the fade with
 * height is in the vertex colours, a slow start at the foot and an ease to nothing at the top.
 */
function guideColumn(radius: number, height: number): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(radius, radius, height, 16, 14, true);
  const pos = g.getAttribute('position');
  const col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const t = pos.getY(i) / height + 0.5;
    const v = (1 - THREE.MathUtils.smoothstep(t, 0.0, 1.0)) ** 1.5 * THREE.MathUtils.smoothstep(t, 0, 0.08);
    col.set([v, v, v], i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

/**
 * A copy of the column material whose opacity falls to nothing where the tube turns away from the eye: across the width the
 * brightness is 1 - (x / r)^2 (a smooth bell), so the beam has soft edges at any distance and from any side.
 */
function softEdge(base: THREE.Material): THREE.MeshBasicMaterial {
  const m = base.clone() as THREE.MeshBasicMaterial;
  m.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vEdgeN;\nvarying vec3 vEdgeV;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvEdgeN = normalize( normalMatrix * normal );\nvEdgeV = ( modelViewMatrix * vec4( position, 1.0 ) ).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vEdgeN;\nvarying vec3 vEdgeV;')
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.a *= pow( abs( dot( normalize( vEdgeN ), normalize( - vEdgeV ) ) ), 2.0 );');
  };
  m.customProgramCacheKey = () => 'guide-soft-edge';
  return m;
}

/** Where a console stands in its cell: against the side it is named after. */
export const CONSOLE_OFFSET = 1.35;
/** The guidance column stands from 1.5 m over the cell floor and is 4.4 m tall: from the play camera it ends about a tenth of the frame below its top edge. */
const GUIDE_FOOT = 1.5;
const GUIDE_HEIGHT = 4.4;

/**
 * The cues of a console (floor ring, beacon, guidance column). Its body comes from the kit and is added under the
 * node named `body`, which is already turned so the kit's front faces the player.
 */
export function consoleMesh(c: Interactable, M: Materials): THREE.Group {
  const g = new THREE.Group();
  const d = DIRS[c.facing];
  const body = new THREE.Group();
  body.name = 'body';
  body.position.set(d[0] * CONSOLE_OFFSET, 0, d[2] * CONSOLE_OFFSET);
  body.rotation.y = Math.atan2(-d[0], -d[2]);
  const ring = mesh(new THREE.RingGeometry(1.5, 1.6, 40), M.glowSoft, false, false);
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.03;
  ring.name = 'ring';
  const beacon = mesh(fadingColumn(0.18, 30, 8), M.column.clone(), false, false);
  beacon.position.set(d[0] * CONSOLE_OFFSET, 16, d[2] * CONSOLE_OFFSET);
  beacon.visible = false;
  beacon.name = 'beacon';
  // faint guidance column, brightness set by the section's `beacon` tunable
  const guide = mesh(guideColumn(0.55, GUIDE_HEIGHT), softEdge(M.column), false, false);
  guide.position.set(d[0] * CONSOLE_OFFSET, GUIDE_FOOT + GUIDE_HEIGHT / 2, d[2] * CONSOLE_OFFSET);
  guide.name = 'guide';
  guide.visible = false;
  g.add(body, ring, beacon, guide);
  return g;
}

export { CUBE_FACE_NORMAL };
