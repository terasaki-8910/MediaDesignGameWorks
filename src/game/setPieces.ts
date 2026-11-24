// Which kit pieces make up the set pieces of the puzzles, each in its module's own frame: the path cube and the diagrams
// of its faces on the mural (both laid out from the cube's stage data, so the solver's tiles and what the player sees
// cannot drift apart), and what carries and crowns the arm tower. Visual only, like kitLayout.ts.
import * as THREE from 'three';
import { CUBE_FACE_NORMAL } from '../core/kit.ts';
import { CELL, DIRS, SIDES, type DirName } from '../core/math.ts';
import type { CubeFace, ModuleInstance } from '../core/types.ts';
import { place, type Placement } from './kit.ts';

type Cube = Extract<ModuleInstance, { type: 'cube3' }>;
type Tower = Extract<ModuleInstance, { type: 'tower' }>;

const vec = (d: readonly number[]) => new THREE.Vector3(d[0], d[1], d[2]);

/**
 * The frame of a piece modelled on a face that looks up, with its north at -Z (the cube's cells and inlays, the
 * mural's inlays): laid at `origin` on a face whose normal is `normal`, its north along `north`.
 */
export function onFace(origin: THREE.Vector3, normal: THREE.Vector3, north: THREE.Vector3): THREE.Matrix4 {
  const z = north.clone().negate();
  const x = new THREE.Vector3().crossVectors(normal, z);
  return new THREE.Matrix4().makeBasis(x, normal, z).setPosition(origin);
}

const FACES = Object.keys(CUBE_FACE_NORMAL) as CubeFace[];
/** The four directions in the plane of a face, in a fixed order. */
const inPlane = (n: readonly number[]) => (Object.keys(DIRS) as DirName[]).filter((k) => DIRS[k][0] * n[0] + DIRS[k][1] * n[1] + DIRS[k][2] * n[2] === 0);

/**
 * The path cube: on each face nine cells (paved where the face's path runs, a carved coffer elsewhere), the path line
 * from the middle of the face out along each arm, and the gilt binding round the whole block.
 */
export function cubePlacements(m: Cube): Placement[] {
  const out: Placement[] = [];
  const centre = new THREE.Vector3(CELL, CELL * 1.5, CELL); // of the 3 x 3 x 3 block, as in src/core/kit.ts
  FACES.forEach((face, f) => {
    const n = vec(DIRS[CUBE_FACE_NORMAL[face]]);
    const arms = m.params.faces[face] ?? [];
    const dirs = inPlane(DIRS[CUBE_FACE_NORMAL[face]]);
    const u = vec(DIRS[dirs[0]]);
    const w = new THREE.Vector3().crossVectors(n, u);
    const middle = centre.clone().addScaledVector(n, CELL * 1.5);
    for (let i = -1; i <= 1; i++)
      for (let j = -1; j <= 1; j++) {
        const offset = u.clone().multiplyScalar(i).addScaledVector(w, j);
        const path = (i === 0 && j === 0) || arms.some((a) => vec(DIRS[a]).distanceTo(offset) < 1e-6);
        // the stone's pattern is turned from cell to cell, so nine cells do not show one photograph nine times
        const north = vec(DIRS[dirs[(f * 3 + (i + 1) * 5 + (j + 1) * 7) % 4]]);
        out.push({ piece: path ? 'cube_cell_path' : 'cube_cell_blank', matrix: onFace(middle.clone().addScaledVector(offset, CELL), n, north) });
      }
    out.push({ piece: 'cube_inlay_hub', matrix: onFace(middle, n, u) });
    for (const a of arms) out.push({ piece: 'cube_inlay_arm', matrix: onFace(middle, n, vec(DIRS[a])) });
  });
  out.push({ piece: 'cube_frame', matrix: new THREE.Matrix4().makeTranslation(centre.x, centre.y, centre.z) });
  return out;
}

/** The order of the mural's tablets, from the left as seen from the south, and their letters. */
export const MURAL_FACES: readonly { face: CubeFace; label: string }[] = [
  { face: 'top', label: '上' }, { face: 'north', label: '北' }, { face: 'east', label: '東' },
  { face: 'south', label: '南' }, { face: 'west', label: '西' }, { face: 'bottom', label: '底' },
];

/**
 * The mural: the stele, and on each tablet of its south face the path of one face of the cube. `tablets` are the
 * middles of the tablets (kit.slots('mural', 'tablet_')); `arms[k]` are the arms of face k as seen on the tablet
 * (u to the right, v down: kitMeshes.ts faceArmsUV).
 */
export function muralPlacements(tablets: THREE.Vector3[], arms: { u: number; v: number }[][]): Placement[] {
  const out: Placement[] = [{ piece: 'mural', matrix: new THREE.Matrix4() }];
  const south = new THREE.Vector3(0, 0, 1);
  tablets.forEach((t, k) => {
    // seen from the south, right is east (+X) and up is +Y
    out.push({ piece: 'mural_hub', matrix: onFace(t, south, new THREE.Vector3(0, 1, 0)) });
    for (const a of arms[k] ?? []) out.push({ piece: 'mural_arm', matrix: onFace(t, south, new THREE.Vector3(a.u, -a.v, 0)) });
  });
  return out;
}

/** Depth of the tower's shaft as modelled (art/blender/gen_tower.py). */
const TOWER_DEPTH = 30;
const SLAB = 0.6;

/**
 * What carries and crowns the arm tower (its deck comes from kitLayout.ts): the shaft, a console under each arm, the
 * turntable's ring on the hub, and a gilt-crowned pier on each corner of the hub that has no arm on either side.
 */
export function towerPlacements(m: Tower): Placement[] {
  const arms = m.params.arms;
  const shaft = place('tower_shaft', 0, 0, 0);
  const depth = m.params.depth ?? 40;
  if (depth !== TOWER_DEPTH) {
    // another depth stretches the shaft below the slab (the solver's box ends at -depth)
    const k = (depth - SLAB) / (TOWER_DEPTH - SLAB);
    shaft.matrix.multiply(new THREE.Matrix4().makeTranslation(0, -SLAB, 0)).multiply(new THREE.Matrix4().makeScale(1, k, 1)).multiply(new THREE.Matrix4().makeTranslation(0, SLAB, 0));
  }
  const out = [shaft, place('tower_ring', 0, 0, 0)];
  SIDES.forEach((s, k) => {
    if (arms.includes(s)) out.push(place('tower_bracket', 0, 0, 0, k));
    else if (!arms.includes(SIDES[(k + 1) % 4])) out.push(place('tower_crown', 0, 0, 0, k));
  });
  return out;
}

/**
 * A stone or paving material whose faces are treated by where they look, decided as each is drawn: what the kit bakes into
 * its pieces (fc_kit.py face_weathering: upright stone at 0.6, so that a sun 12 degrees up does not make it outshine the
 * paving), for a block that can lie on any of its faces. `sun` points towards the sun.
 *   lit, shade   tone of upright and downward faces where they face the sun and where they face away (faces that look
 *                up keep 1), with a smooth step between
 *   calmUp, calmSide   how far the stone's photograph is moved towards its mean colour `mean` (linear) on faces that
 *                look up and on the others (0 = as photographed): a block dressed smooth, its blocks and stains fainter
 */
export interface FacingTone { lit: number; shade: number; calmUp: number; calmSide: number; mean: THREE.Color }

export function toneByFacing(material: THREE.MeshStandardMaterial, sun: THREE.Vector3, t: FacingTone) {
  const f = (x: number) => x.toFixed(4);
  const apply = 'diffuseColor *= sampledDiffuseColor;';
  const chunk = THREE.ShaderChunk.map_fragment;
  if (!chunk.includes(apply)) throw new Error('three.js map_fragment has changed: toneByFacing cannot reach the stone map');
  material.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <map_fragment>',
        `vec3 toneN = inverseTransformDirection( normalize( vNormal ), viewMatrix );
	float toneUp = smoothstep( 0.3, 0.8, toneN.y );
	${chunk.replace(apply, `sampledDiffuseColor.rgb = mix( sampledDiffuseColor.rgb, vec3( ${f(t.mean.r)}, ${f(t.mean.g)}, ${f(t.mean.b)} ), mix( ${f(t.calmSide)}, ${f(t.calmUp)}, toneUp ) );
	${apply}`)}`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
	float toneSide = mix( ${f(t.shade)}, ${f(t.lit)}, smoothstep( -0.05, 0.3, dot( toneN, vec3( ${f(sun.x)}, ${f(sun.y)}, ${f(sun.z)} ) ) ) );
	diffuseColor.rgb *= mix( toneSide, 1.0, toneUp );`,
      );
  };
  material.customProgramCacheKey = () => `tone-by-facing:${[t.lit, t.shade, t.calmUp, t.calmSide].map(f).join(':')}:${t.mean.getHexString()}`;
  material.needsUpdate = true;
}
