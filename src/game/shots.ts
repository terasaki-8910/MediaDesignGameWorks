// Review shots (?shots=1): eight fixed camera views of the game for art review, the same image every time.
// `window.__shots` (installed by main.ts) lists them and shows one on demand; see README.md, "開発".
// With `&ui=1` the list goes on with the HUD's own states (Fold Mode, a hint, the pause and clear dialogs, ...) for UI review.
import * as THREE from 'three';
import type { CompiledStage } from '../core/compile.ts';
import { cellFloor, cellKey } from '../core/math.ts';
import { solveSection } from '../core/solver.ts';
import type { PuzzleState } from '../core/types.ts';
import { CameraRig } from './camera.ts';
import { establishing, establishingPose, gateOrbitPose } from './demo.ts';
import type { Game, UiShot } from './game.ts';

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

type View = 'title' | 'overview' | 'play' | 'gate' | 'fold';

interface ShotDef extends ShotInfo {
  view: View;
  /** Index of the section whose start state the scene shows. */
  section: number;
  /** The HUD state shown over the scene (`?ui=1` shots only; the art shots have no HUD). */
  ui?: UiShot;
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

/** The HUD states, after the art shots. `fold` views are framed by Fold Mode itself. */
const UI_SHOTS: readonly ShotDef[] = [
  { id: 'ui-fold', label: 'UI Fold Mode', view: 'fold', section: 0, ui: 'fold' },
  { id: 'ui-fold-blocked', label: 'UI Fold Mode 干渉あり', view: 'fold', section: 0, ui: 'fold-blocked' },
  { id: 'ui-hint', label: 'UI ヒント・プロンプト・区画名', view: 'play', section: 1, ui: 'hint' },
  { id: 'ui-pause', label: 'UI ポーズ・設定', view: 'play', section: 0, ui: 'pause' },
  { id: 'ui-controls', label: 'UI タイトルと操作方法', view: 'title', section: 0, ui: 'controls' },
  { id: 'ui-clear', label: 'UI 踏破・フィードバック', view: 'gate', section: 2, ui: 'clear' },
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

/**
 * A scene with a blocked Fold Mode option: the first console, in section order, that has one at a section's start or
 * after any one free action of that section. (In the current stage that is the Fold Gate's street console once the
 * square tower has been turned.) Throws if the stage has none, so a changed stage cannot silently drop the shot.
 */
export function findBlockedFold(cs: CompiledStage, starts: PuzzleState[]): { section: number; state: PuzzleState; console: string } {
  for (const [section, start] of starts.entries()) {
    const sec = cs.stage.sections[section];
    const states = [start];
    for (const id of sec.consoles)
      for (const o of cs.consoleActions(id, start)) if (!o.blockedBy.length) states.push(cs.apply(start, o.action));
    for (const state of states)
      for (const id of sec.consoles)
        if (cs.consoleActions(id, state).some((o) => o.blockedBy.length)) return { section, state, console: id };
  }
  throw new Error('no blocked Fold Mode option in the stage for ui-fold-blocked');
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
export function createShots(game: Game, advance: (dt: number, render: boolean) => void, opts: { ui?: boolean } = {}): ShotsApi {
  let starts: PuzzleState[] | null = null;
  const defs = opts.ui ? [...SHOTS, ...UI_SHOTS] : SHOTS;

  const place = (def: ShotDef) => {
    starts ??= sectionStartStates(game.cs);
    let { section } = def;
    let state = starts[section];
    let consoleId: string | undefined;
    if (def.ui === 'fold-blocked') ({ section, state, console: consoleId } = findBlockedFold(game.cs, starts));
    game.stageShot(section, state, def.view === 'title');
    if (def.ui) game.uiShot(def.ui, consoleId); // before the camera: the hint shot moves the player to a console
    const rig = game.rig;
    if (def.view === 'fold') {
      rig.cut(); // Fold Mode framed the camera itself
    } else if (def.view === 'overview') {
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
    list: () => defs.map(({ id, label }) => ({ id, label })),
    async show(id) {
      const def = defs.find((s) => s.id === id);
      if (!def) throw new Error(`unknown shot "${id}" (known: ${defs.map((s) => s.id).join(', ')})`);
      if (!game.ready) throw new Error('the game is not ready yet: wait for __shots.ready()');
      place(def);
      // the HUD fades (1.2 s for the section card) run on the same virtual clock, so the UI shots settle longer
      const steps = def.ui ? SETTLE_STEPS * 2 : SETTLE_STEPS;
      for (let i = 0; i < steps; i++) advance(SETTLE_DT, i === steps - 1);
      await nextFrames(2);
    },
  };
}
