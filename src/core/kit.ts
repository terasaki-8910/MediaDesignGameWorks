// Logical shape of each module type: walkable tiles (with ports) and solid boxes, in module-local metres.
// The local origin is the floor centre of the module's origin cell; +X east, +Y up, -Z north.
import { CELL, DIRS, OPPOSITE, SIDES, type DirName, type Side, type Vec3, add, scale } from './math.ts';
import type { CubeFace, ModuleInstance } from './types.ts';

export interface KitEdge { d: Vec3; kind: 'port' | 'link' | 'closed'; to?: string }
export interface KitTile { key: string; p: Vec3; n: Vec3; edges: KitEdge[]; plate?: Side }
export interface Box { min: Vec3; max: Vec3 }
export interface KitModule { tiles: KitTile[]; boxes: Box[] }

export const SLAB = 0.6; // walkway thickness in metres
const H = CELL / 2;
const U = DIRS.U;

export const CUBE_FACE_NORMAL: Record<CubeFace, DirName> = {
  top: 'U', bottom: 'D', north: 'N', south: 'S', east: 'E', west: 'W',
};

function slab(p: Vec3): Box {
  return { min: [p[0] - H, p[1] - SLAB, p[2] - H], max: [p[0] + H, p[1], p[2] + H] };
}

function inPlane(n: Vec3): DirName[] {
  return (Object.keys(DIRS) as DirName[]).filter((k) => {
    const d = DIRS[k];
    return d[0] * n[0] + d[1] * n[1] + d[2] * n[2] === 0;
  });
}

export function buildKit(m: ModuleInstance): KitModule {
  switch (m.type) {
    case 'tile': {
      const [w, d] = m.params.size ?? [1, 1];
      const closed = new Set(m.params.closed ?? []);
      const tiles: KitTile[] = [];
      for (let i = 0; i < w; i++)
        for (let j = 0; j < d; j++) {
          const edges: KitEdge[] = SIDES.map((s) => {
            const [dx, , dz] = DIRS[s];
            const ni = i + dx;
            const nj = j + dz;
            if (ni >= 0 && ni < w && nj >= 0 && nj < d) return { d: DIRS[s], kind: 'link', to: `t${ni}_${nj}` };
            return { d: DIRS[s], kind: closed.has(s) ? 'closed' : 'port' };
          });
          tiles.push({ key: `t${i}_${j}`, p: [i * CELL, 0, j * CELL], n: U, edges });
        }
      const boxes: Box[] = [{ min: [-H, -SLAB, -H], max: [w * CELL - H, 0, d * CELL - H] }];
      return { tiles, boxes };
    }
    case 'bridge': {
      const L = m.params.length;
      const side = new Set((m.params.sidePorts ?? []).map((s) => `${s.i}${s.side}`));
      const tiles: KitTile[] = [];
      for (let i = 0; i < L; i++) {
        const edges: KitEdge[] = [
          i === 0 ? { d: DIRS.W, kind: 'port' } : { d: DIRS.W, kind: 'link', to: `b${i - 1}` },
          i === L - 1 ? { d: DIRS.E, kind: 'port' } : { d: DIRS.E, kind: 'link', to: `b${i + 1}` },
          { d: DIRS.N, kind: side.has(`${i}N`) ? 'port' : 'closed' },
          { d: DIRS.S, kind: side.has(`${i}S`) ? 'port' : 'closed' },
        ];
        tiles.push({ key: `b${i}`, p: [i * CELL, 0, 0], n: U, edges });
      }
      // inset trims the slab ends so a bridge rotating about its middle clears its neighbours.
      const inset = m.params.inset ?? 0;
      const boxes = tiles.map((t) => slab(t.p));
      if (inset > 0) {
        boxes[0] = { min: [boxes[0].min[0] + inset, boxes[0].min[1], boxes[0].min[2]], max: boxes[0].max };
        const l = boxes.length - 1;
        boxes[l] = { min: boxes[l].min, max: [boxes[l].max[0] - inset, boxes[l].max[1], boxes[l].max[2]] };
      }
      return { tiles, boxes };
    }
    case 'cube3': {
      const c: Vec3 = [CELL, CELL * 1.5, CELL]; // centre of the 3x3x3 block
      const tiles: KitTile[] = [];
      for (const face of Object.keys(CUBE_FACE_NORMAL) as CubeFace[]) {
        const n = DIRS[CUBE_FACE_NORMAL[face]];
        const arms = m.params.faces[face] ?? [];
        const plane = inPlane(n);
        const centre = add(c, scale(n, CELL * 1.5));
        tiles.push({
          key: `${face}_c`,
          p: centre,
          n,
          edges: plane.map((a) =>
            arms.includes(a) ? { d: DIRS[a], kind: 'link', to: `${face}_${a}` } : { d: DIRS[a], kind: 'closed' },
          ),
        });
        for (const a of arms) {
          const opp = (Object.keys(DIRS) as DirName[]).find((k) => scale(DIRS[k], -1).join() === DIRS[a].join())!;
          tiles.push({
            key: `${face}_${a}`,
            p: add(centre, scale(DIRS[a], CELL)),
            n,
            edges: plane.map((b) =>
              b === a
                ? { d: DIRS[b], kind: 'port' }
                : b === opp
                  ? { d: DIRS[b], kind: 'link', to: `${face}_c` }
                  : { d: DIRS[b], kind: 'closed' },
            ),
          });
        }
      }
      return { tiles, boxes: [{ min: [-H, 0, -H], max: [CELL * 3 - H, CELL * 3, CELL * 3 - H] }] };
    }
    case 'tower': {
      const arms = m.params.arms;
      const depth = m.params.depth ?? 40;
      const tiles: KitTile[] = [
        {
          key: 'top',
          p: [0, 0, 0],
          n: U,
          edges: SIDES.map((s) =>
            arms.includes(s) ? { d: DIRS[s], kind: 'link', to: `arm_${s}` } : { d: DIRS[s], kind: 'closed' },
          ),
        },
        ...arms.map((a) => ({
          key: `arm_${a}`,
          p: scale(DIRS[a], CELL) as Vec3,
          n: U,
          edges: SIDES.map((s): KitEdge =>
            s === a
              ? { d: DIRS[s], kind: 'port' }
              : s === OPPOSITE[a]
                ? { d: DIRS[s], kind: 'link', to: 'top' }
                : { d: DIRS[s], kind: 'closed' },
          ),
        })),
      ];
      // Arms stop short of the cell edge so their corners clear neighbouring walkways while turning.
      const inset = m.params.inset ?? 0.4;
      const boxes = tiles.map((t) => {
        const b = slab(t.p);
        if (t.key === 'top') return b;
        const d = DIRS[t.key.slice(4) as Side];
        const min = [...b.min] as number[];
        const max = [...b.max] as number[];
        for (let i = 0; i < 3; i++) {
          if (d[i] > 0) max[i] -= inset;
          if (d[i] < 0) min[i] += inset;
        }
        return { min: min as unknown as Vec3, max: max as unknown as Vec3 };
      });
      boxes.push({ min: [-1.6, -depth, -1.6], max: [1.6, -SLAB, 1.6] });
      return { tiles, boxes };
    }
    case 'plate': {
      const d = m.params.dir;
      return {
        tiles: [
          {
            key: 'plate',
            p: [0, 0, 0],
            n: U,
            plate: d,
            edges: SIDES.map((s) => ({ d: DIRS[s], kind: s === d || s === OPPOSITE[d] ? 'port' : 'closed' })),
          },
        ],
        boxes: [],
      };
    }
    case 'deco':
      return { tiles: [], boxes: [] };
  }
}

/** Validate module parameters that the type system cannot express. Returns error messages. */
export function kitErrors(m: ModuleInstance): string[] {
  const errs: string[] = [];
  if (m.type === 'cube3') {
    for (const [face, arms] of Object.entries(m.params.faces) as [CubeFace, DirName[]][]) {
      const n = DIRS[CUBE_FACE_NORMAL[face]];
      for (const a of arms) {
        const d = DIRS[a];
        if (!d) errs.push(`${m.id}: unknown arm direction ${a} on ${face}`);
        else if (d[0] * n[0] + d[1] * n[1] + d[2] * n[2] !== 0) errs.push(`${m.id}: arm ${a} is not in the plane of face ${face}`);
      }
    }
  }
  if (m.type === 'bridge' && !(m.params.length >= 1)) errs.push(`${m.id}: bridge length must be >= 1`);
  if (m.type === 'tile') {
    const [w, d] = m.params.size ?? [1, 1];
    if (!(w >= 1 && d >= 1)) errs.push(`${m.id}: tile size must be >= 1`);
  }
  return errs;
}
