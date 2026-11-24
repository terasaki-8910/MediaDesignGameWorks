// The Blender-built kit (art/blender/gen_*.py -> public/assets/kit/*.glb): loading, and turning lists of placed pieces
// into a few merged or instanced meshes. Piece names are the node names the scripts document.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/** `materials` holds the tiling stone maps once; the other files only name M_paving and M_stone. */
export const KIT_FILES = ['materials', 'floor', 'parapet', 'pier', 'pylon', 'console', 'lamp'] as const;

export interface KitPart { geometry: THREE.BufferGeometry; material: THREE.MeshStandardMaterial; matrix: THREE.Matrix4 }
/** A piece at a place: `matrix` takes the piece's own frame (a 4 m cell, see the scripts) to the frame being built. */
export interface Placement {
  piece: string;
  matrix: THREE.Matrix4;
  /** Quarter turns of the paving's texture in this cell (its edge is a joint, so any turn fits its neighbours). */
  uvTurn?: number;
}
/** A lighter strip on the paving where people walk, from a to b in the frame being built (y is ignored). */
export interface WalkLine { a: THREE.Vector3; b: THREE.Vector3 }

const QUARTER = Math.PI / 2;

/** A piece modelled on the north edge (or north-east corner) turned to the side `turns` quarter turns clockwise from north. */
export function place(piece: string, x: number, y: number, z: number, turns = 0, sx = 1, sz = 1): Placement {
  const m = new THREE.Matrix4().makeTranslation(x, y, z);
  if (sx !== 1 || sz !== 1) m.multiply(new THREE.Matrix4().makeScale(sx, 1, sz));
  if (turns) m.multiply(new THREE.Matrix4().makeRotationY(-turns * QUARTER));
  return { piece, matrix: m };
}

/** Smooth 2D value noise in 0..1, the same for the same place every time. */
export function noise(x: number, z: number): number {
  const h = (i: number, j: number) => {
    const s = Math.sin(i * 127.1 + j * 311.7) * 43758.5453;
    return s - Math.floor(s);
  };
  const xi = Math.floor(x);
  const zi = Math.floor(z);
  const fx = x - xi;
  const fz = z - zi;
  const ux = fx * fx * (3 - 2 * fx);
  const uz = fz * fz * (3 - 2 * fz);
  return (h(xi, zi) * (1 - ux) + h(xi + 1, zi) * ux) * (1 - uz) + (h(xi, zi + 1) * (1 - ux) + h(xi + 1, zi + 1) * ux) * uz;
}

export class Kit {
  private readonly pieces = new Map<string, THREE.Object3D>();
  /** One material per name, per occlusion map and per use of vertex colours, shared by every file. */
  private readonly canonical = new Map<string, THREE.MeshStandardMaterial>();

  static async load(renderer: THREE.WebGLRenderer, base = './assets/kit/'): Promise<Kit> {
    const kit = new Kit();
    const loader = new GLTFLoader();
    const files = await Promise.all(KIT_FILES.map((f) => loader.loadAsync(`${base}${f}.glb`)));
    const anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    // the library: the materials that carry the tiling maps
    const library = new Map<string, THREE.MeshStandardMaterial>();
    files[0].scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const mat = mesh.material as THREE.MeshStandardMaterial;
      for (const t of [mat.map, mat.normalMap, mat.roughnessMap]) if (t) t.anisotropy = anisotropy;
      library.set(mat.name, mat);
    });
    files.forEach((gltf, k) => {
      if (k === 0) return;
      gltf.scene.updateMatrixWorld(true);
      gltf.scene.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (mesh.isMesh) {
          // GLTFLoader clones a material per mesh when the mesh has vertex colours, and the same named material comes
          // from several files: keep one for each combination that needs its own shader inputs
          const mat = mesh.material as THREE.MeshStandardMaterial;
          const ao = mat.aoMap ? `${KIT_FILES[k]}` : '';
          const key = `${mat.name}:${ao}:${mesh.geometry.hasAttribute('color') ? 'c' : ''}`;
          const first = kit.canonical.get(key);
          if (first) mesh.material = first;
          else {
            const lib = library.get(mat.name);
            if (lib) {
              mat.map = lib.map;
              mat.normalMap = lib.normalMap;
              mat.normalScale.copy(lib.normalScale);
              mat.roughnessMap = lib.roughnessMap;
              mat.metalnessMap = lib.metalnessMap;
              mat.color.copy(lib.color);
              mat.roughness = lib.roughness;
              mat.metalness = lib.metalness;
            }
            if (mat.name === 'M_grime') {
              mat.depthWrite = false;
              mat.polygonOffset = true;
              // lies 12 mm above the paving; the offset keeps it in front where the depth buffer cannot tell them apart
              mat.polygonOffsetFactor = -4;
              mat.polygonOffsetUnits = -40;
            }
            kit.canonical.set(key, mat);
          }
        }
        if (o.name && o !== gltf.scene) kit.pieces.set(o.name, o);
      });
    });
    return kit;
  }

  has(piece: string): boolean {
    return this.pieces.has(piece);
  }

  /** Every mesh of a piece (a named node and what hangs under it), with its matrix in the piece's frame. */
  parts(piece: string): KitPart[] {
    const node = this.pieces.get(piece);
    if (!node) throw new Error(`kit piece "${piece}" is missing`);
    const inv = new THREE.Matrix4().copy(node.matrixWorld).invert();
    const out: KitPart[] = [];
    node.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      out.push({
        geometry: mesh.geometry,
        material: mesh.material as THREE.MeshStandardMaterial,
        matrix: new THREE.Matrix4().multiplyMatrices(inv, mesh.matrixWorld),
      });
    });
    return out;
  }

  /**
   * One mesh per material holding all the placed pieces. `tintOrigin` (the frame's place in the world) switches on the
   * paving's colour variation: broad lighter and darker patches by world position, so cells do not repeat exactly,
   * and a lighter line along `walk`. `own` gives the named materials a private copy (a console's glass is lit on its own).
   */
  build(placements: Placement[], opts: { tintOrigin?: THREE.Vector3; own?: string[]; walk?: WalkLine[] } = {}): THREE.Group {
    const group = new THREE.Group();
    const byMaterial = new Map<THREE.MeshStandardMaterial, THREE.BufferGeometry[]>();
    for (const p of placements)
      for (const part of this.parts(p.piece)) {
        const g = part.geometry.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(p.matrix, part.matrix));
        if (p.uvTurn && part.material.name === 'M_paving') turnUv(g, p.uvTurn);
        const list = byMaterial.get(part.material);
        if (list) list.push(g);
        else byMaterial.set(part.material, [g]);
      }
    for (const [material, list] of byMaterial) {
      const merged = list.length === 1 ? list[0] : mergeGeometries(list);
      if (list.length > 1) for (const g of list) g.dispose();
      if (material.name === 'M_paving' && opts.tintOrigin) tintPaving(merged, opts.tintOrigin, opts.walk ?? []);
      const mat = opts.own?.includes(material.name) ? material.clone() : material;
      const mesh = new THREE.Mesh(merged, mat);
      mesh.name = `kit:${material.name}`;
      const light = material.name === 'M_console_glass' || material.name === 'M_lamp_bulb';
      mesh.castShadow = !light;
      mesh.receiveShadow = !light;
      group.add(mesh);
    }
    return group;
  }

  /** The same piece many times, as one InstancedMesh per part. Tints vary a little per instance when `vary` is set. */
  instances(piece: string, matrices: THREE.Matrix4[], vary = 0): THREE.InstancedMesh[] {
    if (!matrices.length) return [];
    const m = new THREE.Matrix4();
    const c = new THREE.Color();
    return this.parts(piece).map((part) => {
      const inst = new THREE.InstancedMesh(part.geometry, part.material, matrices.length);
      matrices.forEach((mat, i) => {
        inst.setMatrixAt(i, m.multiplyMatrices(mat, part.matrix));
        if (vary) {
          const e = mat.elements;
          const n = noise(e[12] * 0.37 + e[14] * 0.11, e[14] * 0.29 - e[12] * 0.07);
          inst.setColorAt(i, c.setScalar(1 - vary * n));
        }
      });
      inst.instanceMatrix.needsUpdate = true;
      const flat = part.material.transparent; // the dirt strips lie on the paving: no shadow of their own
      inst.castShadow = !flat;
      inst.receiveShadow = true;
      inst.computeBoundingSphere();
      return inst;
    });
  }

  /** Matrices of the child nodes of a piece whose names start with `prefix` (the twelve balusters of a balustrade). */
  slots(piece: string, prefix: string): THREE.Matrix4[] {
    const node = this.pieces.get(piece);
    if (!node) throw new Error(`kit piece "${piece}" is missing`);
    const inv = new THREE.Matrix4().copy(node.matrixWorld).invert();
    return node.children
      .filter((c) => c.name.startsWith(prefix))
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((c) => new THREE.Matrix4().multiplyMatrices(inv, c.matrixWorld));
  }

  /** Every gilt material (one per file that has gilt): `giltTakesSky` in look.ts gives them the sky's reflection. */
  giltMaterials(): THREE.MeshStandardMaterial[] {
    return [...this.canonical].filter(([key]) => key.startsWith('M_gilt:')).map(([, mat]) => mat);
  }

  /** A kit material by name (the first one of that name, whichever file it came from). */
  material(name: string): THREE.MeshStandardMaterial | undefined {
    for (const [key, mat] of this.canonical) if (key.startsWith(`${name}:`)) return mat;
    return undefined;
  }
}

/** Turn UV0 by quarter turns about the middle of the 0..1 square. */
function turnUv(g: THREE.BufferGeometry, turns: number) {
  const uv = g.getAttribute('uv');
  for (let i = 0; i < uv.count; i++) {
    let u = uv.getX(i) - 0.5;
    let v = uv.getY(i) - 0.5;
    for (let k = 0; k < ((turns % 4) + 4) % 4; k++) [u, v] = [-v, u];
    uv.setXY(i, u + 0.5, v + 0.5);
  }
}

/**
 * Vertex colours for the paving: patches a few metres across, up to 13 % darker, a touch warmer where they are light,
 * and a walking line about 1.6 m wide that feet have worn 8 % lighter (the brief: a little lighter where people walk).
 */
function tintPaving(g: THREE.BufferGeometry, origin: THREE.Vector3, walk: WalkLine[]) {
  const pos = g.getAttribute('position');
  const col = new Float32Array(pos.count * 3);
  const p = new THREE.Vector2();
  const a = new THREE.Vector2();
  const ab = new THREE.Vector2();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i) + origin.x;
    const z = pos.getZ(i) + origin.z;
    const broad = noise(x / 5.3 + 11.2, z / 5.3 - 4.7);
    const fine = noise(x / 1.7 - 3.1, z / 1.7 + 8.9);
    let near = Infinity;
    p.set(pos.getX(i), pos.getZ(i));
    for (const w of walk) {
      a.set(w.a.x, w.a.z);
      ab.set(w.b.x - w.a.x, w.b.z - w.a.z);
      const t = THREE.MathUtils.clamp(p.clone().sub(a).dot(ab) / Math.max(ab.lengthSq(), 1e-6), 0, 1);
      near = Math.min(near, p.distanceTo(a.addScaledVector(ab, t)));
    }
    const worn = 1 - THREE.MathUtils.smoothstep(near, 0.3, 1.1 + 0.4 * fine);
    const v = (1 - 0.09 * broad - 0.04 * fine) * (1 + 0.08 * worn);
    col[i * 3] = v;
    col[i * 3 + 1] = v * (0.985 + 0.015 * (1 - broad));
    col[i * 3 + 2] = v * (0.965 + 0.035 * (1 - broad));
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
}
