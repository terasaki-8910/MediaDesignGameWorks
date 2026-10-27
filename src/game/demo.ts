// Demo playback (?demo=1): the game plays itself along the optimal plan, with scripted walking and camera moves,
// for screen recording and for the frame-by-frame capture in tools/video. It never sends telemetry.
import * as THREE from 'three';
import { actionKey, walkPath } from '../core/compile.ts';
import { cellFloor, cellKey } from '../core/math.ts';
import { solveSection } from '../core/solver.ts';
import type { Action, PuzzleSection } from '../core/types.ts';
import type { Game } from './game.ts';

export interface DemoOptions {
  titleSec: number; // title screen before starting
  establishSec: number; // overview orbit at the start of each puzzle
  browseSec: number; // pause on each Fold Mode option
  holdSec: number; // pause on the chosen option before folding
  endSec: number; // orbit around the gate after the finale
}

export const DEMO_DEFAULTS: DemoOptions = { titleSec: 4, establishSec: 3.5, browseSec: 0.9, holdSec: 1.2, endSec: 4 };

/** Moments in the demo, in seconds from its start, so captions and sound can be placed on them later. */
export interface Cue { t: number; type: 'start' | 'section' | 'fold' | 'finale' | 'end'; id?: string; label?: string; sec?: number }

type Script = Generator<void, void, number>;

export class DemoDirector {
  done = false;
  readonly cues: Cue[] = [];
  private t = 0;
  private script: Script;
  private readonly game: Game;
  private readonly opts: DemoOptions;

  constructor(game: Game, opts: DemoOptions) {
    this.game = game;
    this.opts = opts;
    this.script = this.run();
    this.script.next(0); // run up to the first yield
  }

  update(dt: number) {
    this.t += dt;
    if (!this.done && this.script.next(dt).done) this.done = true;
  }

  private cue(type: Cue['type'], extra: Omit<Cue, 't' | 'type'> = {}) {
    this.cues.push({ t: Math.round(this.t * 1000) / 1000, type, ...extra });
  }

  private *run(): Script {
    const g = this.game;
    yield* this.wait(this.opts.titleSec);
    g.startFromTitle();
    this.cue('start');
    for (let n = 0; n < g.cs.stage.sections.length; n++) {
      const sec = g.section;
      this.cue('section', { id: sec.id, label: sec.name.ja });
      yield* this.establish(sec);
      for (const a of solveSection(g.cs, sec.id, { state: g.state, cell: g.player.cell }).plan) {
        yield* this.walkTo([cellKey(g.cs.consoles.get(a.console)!.at)]);
        yield* this.fold(a);
      }
      yield* this.walkTo(sec.exit.map((c) => cellKey(c))); // stepping on the exit clears the puzzle
      yield* this.until(() => g.section.id !== sec.id || g.mode === 'finale' || g.mode === 'clear');
    }
    this.cue('finale');
    yield* this.until(() => g.mode === 'clear');
    yield* this.orbitGate(this.opts.endSec);
    this.cue('end');
  }

  private *wait(sec: number): Script {
    for (let t = 0; t < sec; ) t += yield;
  }

  private *until(ok: () => boolean, maxSec = 30): Script {
    for (let t = 0; !ok() && t < maxSec; ) t += yield;
  }

  /** A slow orbit high above the puzzle, so its layout reads before anything moves. */
  private *establish(sec: PuzzleSection): Script {
    const g = this.game;
    const pts = [
      ...sec.consoles.map((id) => cellFloor(g.cs.consoles.get(id)!.at)),
      ...sec.exit.map((c) => cellFloor(c)),
      [g.player.pos.x, g.player.pos.y, g.player.pos.z] as const,
    ].map((p) => new THREE.Vector3(p[0], p[1], p[2]));
    const center = pts.reduce((s, p) => s.add(p), new THREE.Vector3()).divideScalar(pts.length);
    const radius = Math.max(14, ...pts.map((p) => p.distanceTo(center) + 6));
    const look = center.clone().add(new THREE.Vector3(0, 2, 0));
    const a0 = Math.atan2(g.player.pos.x - center.x, g.player.pos.z - center.z) + 0.9;
    for (let t = 0; t < this.opts.establishSec; ) {
      t += yield;
      const a = a0 - 0.22 * t;
      const pos = center.clone().add(new THREE.Vector3(Math.sin(a) * radius * 1.5, radius * 0.85 + 5, Math.cos(a) * radius * 1.5));
      g.rig.setCinematic(pos, look);
    }
    g.rig.setCinematic(null);
    g.rig.snapBehind(g.player.root.rotation.y, true);
  }

  /** Walk the shortest route to the nearest target cell, with the camera easing in behind. */
  private *walkTo(targets: string[], maxSec = 25): Script {
    const g = this.game;
    let from = '';
    let path: string[] | null = [];
    for (let t = 0; t < maxSec && g.mode === 'play'; ) {
      const dt = yield;
      t += dt;
      this.followCamera(dt);
      if (g.player.cell !== from) {
        // re-plan whenever the player enters a tile, so a nudged route still arrives
        from = g.player.cell;
        path = walkPath(g.cs.walkMap(g.state), from, targets);
        if (!path) break;
      }
      const tile = g.cs.walkMap(g.state).tiles.get(path![0] ?? from);
      if (!tile) break;
      const [x, , z] = cellFloor(tile.cell);
      const dx = x - g.player.pos.x;
      const dz = z - g.player.pos.z;
      const d = Math.hypot(dx, dz);
      if (!path!.length && d < 0.15) break;
      const k = path!.length > 1 ? 1 : Math.min(1, d / 1.2); // full speed, easing into the last tile
      g.steer = { x: (dx / Math.max(d, 1e-6)) * k, z: (dz / Math.max(d, 1e-6)) * k };
    }
    g.steer = null;
    yield* this.wait(0.25);
  }

  private followCamera(dt: number) {
    const rig = this.game.rig;
    let d = this.game.player.root.rotation.y - rig.yaw;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    rig.yaw += d * Math.min(1, dt * 1.8);
    rig.pitch += (0.4 - rig.pitch) * Math.min(1, dt * 2);
  }

  /** Open Fold Mode, show the options up to the planned one, then fold and wait for the city to settle. */
  private *fold(a: Action): Script {
    const g = this.game;
    yield* this.wait(0.3);
    const key = actionKey(a);
    const target = g.cs.consoleActions(a.console, g.state).findIndex((o) => actionKey(o.action) === key);
    if (target < 0) return;
    g.input.press('KeyE');
    yield* this.wait(this.opts.browseSec);
    for (let i = 0; i < target; i++) {
      g.input.press('KeyD');
      yield* this.wait(this.opts.browseSec);
    }
    yield* this.wait(this.opts.holdSec);
    g.input.press('KeyE');
    yield;
    const group = g.cs.groups.get(a.group)!;
    this.cue('fold', { id: key, label: g.actionLabel(a), sec: ((group.durationMs ?? 2000) / 1000) * g.foldScale });
    yield* this.until(() => g.mode === 'play');
    yield* this.wait(0.4);
  }

  private *orbitGate(sec: number): Script {
    const g = this.game;
    const gate = new THREE.Vector3(...cellFloor(g.cs.stage.goal.at));
    const look = gate.clone().add(new THREE.Vector3(0, 6, 0));
    for (let t = 0; t < sec; ) {
      t += yield;
      const a = 0.85 + 0.12 * t;
      g.rig.setCinematic(gate.clone().add(new THREE.Vector3(Math.sin(a) * 40, 22 + t, Math.cos(a) * 40)), look);
    }
  }
}
