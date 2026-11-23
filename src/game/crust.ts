// The crust the mirrored city hangs from: one continuous inverted ground, a ring of rock far overhead. Its underside is
// what the player sees between the hanging buildings; its ragged inner and outer edges hang down into a fringe of
// stalactites that the haze dissolves into the sky. Every hanging building takes its height from `underside`, so none
// floats with sky above it.
import * as THREE from 'three';
import { noise } from './kit.ts';

export interface CrustSpec {
  /** Centre of the ring (the middle of the stage) and the mean height of the underside. */
  cx: number;
  cz: number;
  y: number;
  /** Mean inner and outer radius; both edges are ragged. */
  inner: number;
  outer: number;
}

/** How far the fringe hangs below the ceiling at the very edge, and how far in from the edge it reaches (metres). */
const RIM_DROP = 42;
const RIM_WIDTH = 130;
/** The edges are walled up to this far above the ceiling, so nothing looks through the rim: what shows of the wall is the fringe. */
const CLIFF = 4;
/** One repeat of the stone map on the rock, in metres. */
const TILE = 52;

const fbm = (x: number, z: number) => 0.55 * noise(x, z) + 0.3 * noise(x * 2.13 + 5.2, z * 2.13 - 3.1) + 0.15 * noise(x * 4.37 - 1.7, z * 4.37 + 9.3);

export class Crust {
  readonly spec: CrustSpec;

  constructor(spec: CrustSpec) {
    this.spec = spec;
  }

  /** Radius of the inner and outer edge in the direction `a` (radians). Lobes a few hundred metres across, with bites. */
  edges(a: number): [number, number] {
    const c = Math.cos(a);
    const s = Math.sin(a);
    const { inner, outer } = this.spec;
    const i = fbm(c * 2.6 + 11.3, s * 2.6 - 4.1) - 0.5;
    const o = fbm(c * 2.1 - 7.7, s * 2.1 + 2.9) - 0.5;
    const bite = fbm(c * 9 + 3.3, s * 9 + 8.8) - 0.5;
    return [inner + i * 190 + bite * 60, outer + o * 300 + bite * 90];
  }

  /** Metres inside the nearest edge (negative outside the ring). */
  depth(x: number, z: number): number {
    const dx = x - this.spec.cx;
    const dz = z - this.spec.cz;
    const [i, o] = this.edges(Math.atan2(dz, dx));
    const r = Math.hypot(dx, dz);
    return Math.min(r - i, o - r);
  }

  /** The ceiling's height where it is not fringed: slow swells of a few metres. */
  level(x: number, z: number): number {
    return this.spec.y + (fbm(x / 330 + 3.1, z / 330 - 8.4) - 0.5) * 12 + (fbm(x / 120 - 2.2, z / 120 + 6.7) - 0.5) * 5;
  }

  /** Height of the underside at a place: the ceiling less the fringe of hanging rock near an edge. */
  underside(x: number, z: number): number {
    const d = this.depth(x, z);
    const w = 1 - THREE.MathUtils.smoothstep(d, 0, RIM_WIDTH);
    const lumps = fbm(x / 47 + 9.1, z / 47 - 5.3);
    // stalactites: sharp ridges of the noise stand up as spikes that hang, with broad lumps between them
    const spike = Math.pow(1 - Math.abs(2 * noise(x / 31 - 4.4, z / 23 + 6.2) - 1), 2.4);
    const rock = RIM_DROP * Math.pow(w, 1.35) * (0.12 + 0.45 * Math.pow(lumps, 1.5) + 0.75 * spike * (0.4 + lumps));
    const rough = (fbm(x / 13 + 2.7, z / 13 - 1.3) - 0.5) * 7 * (0.3 + w);
    return this.level(x, z) - rock + rough;
  }

  /** The mesh: the underside as a polar grid between the edges, and a cliff face up from each edge. */
  build(map: THREE.Texture | null, angular = 440, radial = 64): THREE.Mesh {
    const { cx, cz } = this.spec;
    const pos: number[] = [];
    const uv: number[] = [];
    const col: number[] = [];
    const idx: number[] = [];
    const c = new THREE.Color();
    const base = new THREE.Color('#4f4d45');
    const push = (x: number, y: number, z: number, u: number, v: number, shade: number, warm: number) => {
      pos.push(x, y, z);
      uv.push(u, v);
      c.copy(base);
      c.r *= shade * (1 + warm);
      c.g *= shade;
      c.b *= shade * (1 - warm);
      col.push(c.r, c.g, c.b);
    };
    const stride = radial + 1;
    for (let i = 0; i < angular; i++) {
      const a = (i / angular) * Math.PI * 2;
      const [r0, r1] = this.edges(a);
      for (let j = 0; j <= radial; j++) {
        const r = r0 + ((r1 - r0) * j) / radial;
        const x = cx + Math.cos(a) * r;
        const z = cz + Math.sin(a) * r;
        const y = this.underside(x, z);
        const lump = fbm(x / 63 + 1.4, z / 63 + 7.2);
        const hang = (this.level(x, z) - y) / RIM_DROP; // 0 on the flat ceiling, 1 at the longest stalactite
        push(x, y, z, x / TILE, z / TILE, (0.55 + 0.8 * lump) * (0.8 + 0.4 * hang), (lump - 0.5) * 0.06);
      }
    }
    const ring = (i: number) => ((i % angular) + angular) % angular;
    for (let i = 0; i < angular; i++)
      for (let j = 0; j < radial; j++) {
        const a = i * stride + j;
        const b = ring(i + 1) * stride + j;
        // wound so the faces look down
        idx.push(a, a + 1, b, b, a + 1, b + 1);
      }
    // cliffs: a face up from each edge, its own vertices so the edge stays hard; in rows so the strata and the relief show
    const rows = 12;
    for (const edge of [0, 1]) {
      const first = pos.length / 3;
      for (let i = 0; i < angular; i++) {
        const a = (i / angular) * Math.PI * 2;
        const [r0, r1] = this.edges(a);
        const r = edge ? r1 : r0;
        const x = cx + Math.cos(a) * r;
        const z = cz + Math.sin(a) * r;
        const lower = this.underside(x, z);
        const top = this.level(x, z) + CLIFF;
        const lump = fbm(x / 63 + 1.4, z / 63 + 7.2);
        for (let k = 0; k <= rows; k++) {
          const y = lower + ((top - lower) * k) / rows;
          // bedded rock: courses a few metres thick, each a little lighter or darker, and the face worn in and out
          const course = Math.floor(y / 5.5);
          const bed = 0.62 + 0.3 * noise(course * 0.71 + 3.3, lump * 5) + 0.12 * Math.sin(y * 0.9 + lump * 7);
          const rr = r + (k === 0 ? 0 : (fbm(a * 55 + k * 0.9, y / 11) - 0.5) * 9) * (edge ? 1 : -1);
          push(cx + Math.cos(a) * rr, y, cz + Math.sin(a) * rr, (a * r) / TILE, y / TILE, bed * (0.75 + 0.5 * lump), 0.02);
        }
      }
      for (let i = 0; i < angular; i++)
        for (let k = 0; k < rows; k++) {
          const a = first + i * (rows + 1) + k;
          const b = first + ring(i + 1) * (rows + 1) + k;
          // the inner cliff faces the middle of the ring, the outer one away from it
          if (edge) idx.push(a, b, a + 1, a + 1, b, b + 1);
          else idx.push(a, a + 1, b, b, a + 1, b + 1);
        }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    g.computeBoundingSphere();
    // the underside must face down; fix the winding once if the first guess was the other way
    const n = g.getAttribute('normal');
    if (n.getY(Math.floor(angular / 2) * stride + Math.floor(radial / 2)) > 0) {
      const flipped = g.getIndex()!.array as unknown as number[];
      const limit = angular * radial * 6;
      for (let k = 0; k < limit; k += 3) [flipped[k + 1], flipped[k + 2]] = [flipped[k + 2], flipped[k + 1]];
      g.getIndex()!.needsUpdate = true;
      g.computeVertexNormals();
    }
    const mat = new THREE.MeshStandardMaterial({ map, vertexColors: true, roughness: 0.93, metalness: 0, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(g, mat);
    mesh.name = 'crust';
    mesh.frustumCulled = false;
    return mesh;
  }
}
