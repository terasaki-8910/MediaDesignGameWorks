// Review shots (?shots=1): eight fixed camera views of the game for art review, the same image every time.
// `window.__shots` (installed by main.ts) lists them and shows one on demand; see README.md, "開発".
import * as THREE from 'three';
import type { CompiledStage } from '../core/compile.ts';
import { cellFloor, cellKey } from '../core/math.ts';
import { solveSection } from '../core/solver.ts';
import type { PuzzleState } from '../core/types.ts';
import { CameraRig } from './camera.ts';
import { establishing, establishingPose, gateOrbitPose } from './demo.ts';
import type { Game } from './game.ts';

export interface ShotInfo { id: string; label: string }

/** The page-side contract of the review mode. */
export interface ShotsApi {
  /** True once the gate model is loaded and the shaders are warmed (`game.ready`). */
  ready(): boolean;
  list(): ShotInfo[];
  /** Put the scene into the shot, settle it and resolve once it has been drawn; rejects for an unknown id. */
  show(id: string): Promise<void>;
}

/** Fixed time steps run after the scene is set up, so effects that run on time are at the same phase every time. */
export const SETTLE_STEPS = 60;
export const SETTLE_DT = 1 / 60;

type View = 'title' | 'overview' | 'play' | 'gate';

interface ShotDef extends ShotInfo {
  view: View;
  /** Index of the section whose start state the scene shows. */
  section: number;
}

/** In review order. Labels are Japanese for the reviewers. */
const SHOTS: readonly ShotDef[] = [
  { id: 'title', label: 'タイトル', view: 'title', section: 0 },
  { id: 's1-overview', label: '第1区画 俯瞰', view: 'overview', section: 0 },
  { id: 's2-overview', label: '第2区画 俯瞰', view: 'overview', section: 1 },
  { id: 's3-overview', label: '第3区画 俯瞰', view: 'overview', section: 2 },
  { id: 's1-play', label: '第1区画 プレイ視点', view: 'play', section: 0 },
  { id: 's2-play', label: '第2区画 プレイ視点', view: 'play', section: 1 },
  { id: 's3-play', label: '第3区画 プレイ視点', view: 'play', section: 2 },
  { id: 'gate', label: 'ゲート', view: 'gate', section: 2 },
];

/**
 * The puzzle state each section starts from: what a player has after solving the earlier sections with their optimal
 * plans (index 0 is the stage's initial state).
 */
export function sectionStartStates(cs: CompiledStage): PuzzleState[] {
  const starts: PuzzleState[] = [];
  let state = cs.initialState();
  for (const sec of cs.stage.sections) {
    starts.push(state);
    const cp = cs.stage.checkpoints.find((c) => c.id === sec.start)!;
    const { optimal, plan } = solveSection(cs, sec.id, { state, cell: cellKey(cp.at) });
    if (optimal === null) throw new Error(`section ${sec.id} cannot be solved from its start state`);
    for (const action of plan) state = cs.apply(state, action);
  }
  return starts;
}

const nextFrames = (n: number) =>
  new Promise<void>((resolve) => {
    const tick = (left: number) => requestAnimationFrame(() => (left > 1 ? tick(left - 1) : resolve()));
    tick(n);
  });

/**
 * `advance` steps the page's virtual clock and the game together by one fixed time step (rendering when asked),
 * as the capture hook does, so timers and CSS transitions follow the simulation.
 */
export function createShots(game: Game, advance: (dt: number, render: boolean) => void): ShotsApi {
  let starts: PuzzleState[] | null = null;

  const place = (def: ShotDef) => {
    starts ??= sectionStartStates(game.cs);
    game.stageShot(def.section, starts[def.section], def.view === 'title');
    const rig = game.rig;
    if (def.view === 'overview') {
      const sec = game.cs.stage.sections[def.section];
      const e = establishing(game.cs, sec, game.player.pos); // the player stands at the section's start checkpoint
      const pose = establishingPose(e, 0);
      rig.setCinematic(pose.pos, pose.look);
      rig.cut();
    } else if (def.view === 'play') {
      rig.pitch = CameraRig.DEFAULT_PITCH;
      rig.snapBehind(game.player.root.rotation.y); // the follow camera at the tunables' distance, as a player first gets it
    } else if (def.view === 'gate') {
      const pose = gateOrbitPose(new THREE.Vector3(...cellFloor(game.cs.stage.goal.at)), 0);
      rig.setCinematic(pose.pos, pose.look);
      rig.cut();
    }
    // 'title': the game's own title orbit, frozen at its first frame in shots mode
  };

  return {
    ready: () => game.ready,
    list: () => SHOTS.map(({ id, label }) => ({ id, label })),
    async show(id) {
      const def = SHOTS.find((s) => s.id === id);
      if (!def) throw new Error(`unknown shot "${id}" (known: ${SHOTS.map((s) => s.id).join(', ')})`);
      if (!game.ready) throw new Error('the game is not ready yet: wait for __shots.ready()');
      place(def);
      for (let i = 0; i < SETTLE_STEPS; i++) advance(SETTLE_DT, i === SETTLE_STEPS - 1);
      await nextFrames(2);
    },
  };
}
