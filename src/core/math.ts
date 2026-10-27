// Integer rotation matrices and small vector helpers shared by the game and Node tools.
// Rotations are always multiples of 90 degrees, so matrices stay exact.

export type Vec3 = readonly [number, number, number];
export type Mat3 = readonly number[]; // row-major 3x3

export const CELL = 4; // metres per grid cell, horizontally and vertically

export const DIRS = {
  N: [0, 0, -1],
  E: [1, 0, 0],
  S: [0, 0, 1],
  W: [-1, 0, 0],
  U: [0, 1, 0],
  D: [0, -1, 0],
} as const satisfies Record<string, Vec3>;
export type DirName = keyof typeof DIRS;
export type Side = 'N' | 'E' | 'S' | 'W';
export const SIDES: readonly Side[] = ['N', 'E', 'S', 'W'];
export const OPPOSITE: Record<Side, Side> = { N: 'S', S: 'N', E: 'W', W: 'E' };

export const I3: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];

export function mul(a: Mat3, b: Mat3): Mat3 {
  const r: number[] = [];
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++) r.push(a[i * 3] * b[j] + a[i * 3 + 1] * b[3 + j] + a[i * 3 + 2] * b[6 + j]);
  return r;
}

export function apply(m: Mat3, v: Vec3): [number, number, number] {
  return [
    m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
    m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
    m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
  ];
}

/** Rotation by q quarter turns about a principal axis (right-hand rule). */
export function rot(axis: 'x' | 'y' | 'z', q: number): Mat3 {
  const k = ((q % 4) + 4) % 4;
  const c = [1, 0, -1, 0][k];
  const s = [0, 1, 0, -1][k];
  if (axis === 'x') return [1, 0, 0, 0, c, -s, 0, s, c];
  if (axis === 'y') return [c, 0, s, 0, 1, 0, -s, 0, c];
  return [c, -s, 0, s, c, 0, 0, 0, 1];
}

/** Rotation by an arbitrary angle (radians) about a principal axis, for sweep sampling. */
export function rotAngle(axis: 'x' | 'y' | 'z', a: number): Mat3 {
  const c = Math.cos(a);
  const s = Math.sin(a);
  if (axis === 'x') return [1, 0, 0, 0, c, -s, 0, s, c];
  if (axis === 'y') return [c, 0, s, 0, 1, 0, -s, 0, c];
  return [c, -s, 0, s, c, 0, 0, 0, 1];
}

export const add = (a: Vec3, b: Vec3): [number, number, number] => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: Vec3, b: Vec3): [number, number, number] => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a: Vec3, k: number): [number, number, number] => [a[0] * k, a[1] * k, a[2] * k];
export const round3 = (a: Vec3): [number, number, number] => [snap(a[0]), snap(a[1]), snap(a[2])];

function snap(x: number): number {
  const r = Math.round(x * 1000) / 1000;
  return r === 0 ? 0 : r; // avoid -0 in keys
}

export function vecEq(a: Vec3, b: Vec3, eps = 1e-3): boolean {
  return Math.abs(a[0] - b[0]) < eps && Math.abs(a[1] - b[1]) < eps && Math.abs(a[2] - b[2]) < eps;
}

export function sideOf(v: Vec3): Side | null {
  for (const s of SIDES) if (vecEq(DIRS[s], v)) return s;
  return null;
}

export const cellKey = (c: Vec3): string => `${c[0]},${c[1]},${c[2]}`;
export const parseCell = (k: string): [number, number, number] => k.split(',').map(Number) as [number, number, number];

/** World-space centre of a cell's floor. Cell (x, y, z) spans X in [4x, 4x+4] with its floor at Y = 4y. */
export const cellFloor = (c: Vec3): [number, number, number] => [c[0] * CELL + CELL / 2, c[1] * CELL, c[2] * CELL + CELL / 2];

export function cellOfFloorPoint(p: Vec3): [number, number, number] {
  return [Math.floor(p[0] / CELL), Math.round(p[1] / CELL), Math.floor(p[2] / CELL)];
}

/** The 24 proper rotations of the cube, generated from quarter turns about X and Y. */
export const CUBE_GROUP: readonly Mat3[] = (() => {
  const seen = new Map<string, Mat3>([[I3.join(','), I3]]);
  const queue: Mat3[] = [I3];
  while (queue.length) {
    const m = queue.shift()!;
    for (const g of [rot('x', 1), rot('y', 1)]) {
      const n = mul(g, m);
      const k = n.join(',');
      if (!seen.has(k)) {
        seen.set(k, n);
        queue.push(n);
      }
    }
  }
  return [...seen.values()];
})();

export function cubeIndex(m: Mat3): number {
  const k = m.join(',');
  return CUBE_GROUP.findIndex((g) => g.join(',') === k);
}
