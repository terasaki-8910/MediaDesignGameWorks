// Game loop and state machine: title -> play <-> fold mode -> fold animation -> ... -> finale -> clear.
import * as THREE from 'three';
import { CompiledStage, actionKey, step } from '../core/compile.ts';
import { DIRS, SIDES, cellFloor, cellKey, type Side } from '../core/math.ts';
import { resolveSlots } from '../core/slots.ts';
import { nextAction, remainingActions, solveSection } from '../core/solver.ts';
import type { Tunables } from '../core/tunables.ts';
import type { Action, PuzzleSection, PuzzleState, StageFile } from '../core/types.ts';
import { Sound } from './audio.ts';
import { BackgroundCity, setupEnvironment } from './backdrop.ts';
import { CameraRig } from './camera.ts';
import { DemoDirector, type DemoOptions } from './demo.ts';
import { Engine } from './engine.ts';
import { Hud, type Settings } from './hud.ts';
import { Input } from './input.ts';
import { createMaterials } from './materials.ts';
import { Player, cloakAvatar } from './player.ts';
import { Telemetry, clientInfo, defaultConsent } from './telemetry.ts';
import { loadVrmAvatar } from './vrmAvatar.ts';
import { World, type EdgeMarker } from './world.ts';

export interface Revision { revision: number; updated: string; recent: { date: string; summary: string }[] }
export interface GameData { stage: StageFile; tunables: Tunables; revision: Revision; build: string }
/** `demo` plays the game by itself; `capture` leaves the clock to the caller (see advance()). */
export interface GameOptions { demo?: DemoOptions; capture?: boolean }

type Mode = 'title' | 'play' | 'fold' | 'anim' | 'pause' | 'finale' | 'clear';

interface FoldSession {
  console: string;
  options: { action: Action; blockedBy: string[] }[];
  index: number;
  browsed: Set<number>;
}

interface SectionRun { start: number; actions: number; hints: number; resets: number; hintTier: 0 | 1 | 2; lastProgress: number; optimal: number }

const SETTINGS_KEY = 'fold-city:settings';

export class Game {
  readonly engine: Engine;
  readonly cs: CompiledStage;
  readonly world: World;
  readonly player: Player;
  readonly input: Input;
  readonly hud: Hud;
  readonly sound = new Sound();
  readonly telemetry: Telemetry;
  readonly city: BackgroundCity;
  readonly rig: CameraRig;
  readonly director: DemoDirector | null = null;
  mode: Mode = 'title';
  /** Walking direction set by the demo instead of the keyboard. */
  steer: { x: number; z: number } | null = null;
  /** True once the gate model is in and shaders are compiled (the capture waits for this). */
  ready = false;
  state: PuzzleState;
  settings: Settings;
  private data: GameData;
  private sectionIndex = 0;
  private run: SectionRun;
  private results: { name: string; sec: number; actions: number; optimal: number }[] = [];
  private fold: FoldSession | null = null;
  private time = 0;
  private last = performance.now();
  private gameStart = 0;
  private perfClock = 0;
  private finaleClock = 0;
  private resumeMode: Mode = 'play';
  private exitKeys: Set<string>;
  private automated = false;
  private telemetryAllowed = true;

  constructor(canvas: HTMLCanvasElement, hudRoot: HTMLElement, data: GameData, opts: GameOptions = {}) {
    this.data = data;
    this.settings = loadSettings();
    const stage = resolveSlots(data.stage);
    this.cs = new CompiledStage(stage);
    this.state = this.cs.initialState();
    this.engine = new Engine(canvas, this.settings.quality, opts.capture);
    const M = createMaterials(stage.visualTheme.accent);
    setupEnvironment(this.engine.scene, this.engine.renderer, stage.visualTheme);
    this.world = new World(this.cs, M);
    this.engine.scene.add(this.world.root);
    const bounds = new THREE.Box3(new THREE.Vector3(-70, -200, -55), new THREE.Vector3(80, 200, 40));
    this.city = new BackgroundCity(stage.visualTheme, new THREE.Vector3(4, 0, -6), bounds);
    this.engine.scene.add(this.city.group);
    this.player = new Player(cloakAvatar(M));
    this.engine.scene.add(this.player.root);
    this.input = new Input(canvas);
    this.hud = new Hud(hudRoot);
    this.rig = new CameraRig(this.engine.camera, () => this.world.colliders);
    const params = new URLSearchParams(location.search);
    const playtest = params.has('playtest');
    const local = /^(localhost|127\.0\.0\.1)$/.test(location.hostname) && !params.has('telemetry');
    // the demo is not a player: it must never reach the play data the improvement loop reads
    this.telemetryAllowed = !local && !opts.demo;
    this.telemetry = new Telemetry(import.meta.env.VITE_TELEMETRY_URL ?? './api/telemetry', this.settings.telemetry && this.telemetryAllowed, playtest);
    this.exitKeys = new Set();
    this.run = this.newRun();
    this.enterSection(0, false);
    this.showTitle();
    // Automated browsers and the demo cannot hold pointer lock; do not treat that as the player pausing.
    this.automated = navigator.webdriver === true || !!opts.demo;
    document.addEventListener('pointerlockchange', () => {
      if (this.automated) return;
      if (!document.pointerLockElement && (this.mode === 'play' || this.mode === 'fold')) this.openPause();
    });
    const vrmUrl = params.get('vrm') ?? './assets/player.vrm';
    loadVrmAvatar(vrmUrl)
      .then((a) => a && this.player.setAvatar(a))
      .catch((e) => console.warn('VRM avatar not loaded:', e));
    this.world
      .loadGateModel('./assets/gate.glb')
      .catch((e) => console.warn('gate model not loaded, keeping the procedural gate:', e))
      .finally(() => {
        this.world.warmUp(this.engine.renderer, this.engine.camera, this.engine.scene);
        this.ready = true;
      });
    if (opts.demo) this.director = new DemoDirector(this, opts.demo);
    if (!opts.capture) requestAnimationFrame((t) => this.frame(t));
  }

  get section(): PuzzleSection {
    return this.cs.stage.sections[this.sectionIndex];
  }

  private newRun(): SectionRun {
    return { start: this.time, actions: 0, hints: 0, resets: 0, hintTier: 0, lastProgress: this.time, optimal: 0 };
  }

  private showTitle() {
    this.mode = 'title';
    const r = this.data.revision;
    this.hud.title({
      revision: r.revision,
      updated: r.updated,
      recent: r.recent.map((x) => `${x.date}　${x.summary}`),
      consent: this.settings.telemetry,
      onConsent: (v) => this.applySettings({ ...this.settings, telemetry: v }),
      onStart: () => this.begin(),
    });
    // a slow establishing orbit behind the title
    this.rig.setCinematic(new THREE.Vector3(-58, 34, 46), new THREE.Vector3(2, 8, -4));
  }

  /** Leave the title as if Start was pressed (the demo uses this). */
  startFromTitle() {
    if (this.mode === 'title') this.begin(true);
  }

  private begin(keepCamera = false) {
    this.sound.start();
    this.sound.setMuted(this.settings.muted);
    if (!this.automated) this.input.requestLock();
    this.hud.hideTitle();
    if (!keepCamera) {
      this.rig.setCinematic(null);
      this.rig.snapBehind(-Math.PI / 2);
    }
    this.gameStart = this.time;
    this.telemetry.log({
      type: 'session_start', build: this.data.build, revision: this.data.revision.revision, stage: `${this.cs.stage.stageId}@${this.cs.stage.version}`,
      quality: this.settings.quality, client: clientInfo(this.engine.renderer),
    });
    this.enterSection(0, true);
    this.mode = 'play';
  }

  private enterSection(i: number, announce: boolean) {
    this.sectionIndex = i;
    const sec = this.section;
    this.exitKeys = new Set(sec.exit.map((c) => cellKey(c)));
    this.run = this.newRun();
    this.run.optimal = solveSection(this.cs, sec.id).optimal ?? 0;
    const cp = this.cs.stage.checkpoints.find((c) => c.id === sec.start)!;
    if (i === 0 || !announce) this.player.place(cp.at, cp.facing, this.cs.walkMap(this.state));
    this.world.highlightConsole(null);
    this.world.setGuidance(sec.consoles, this.data.tunables.sections[sec.id]?.beacon ?? 0);
    this.hud.hint(null);
    if (announce) {
      this.hud.toast(sec.name.ja, sec.name.en.toUpperCase());
      this.telemetry.log({ type: 'section_enter', section: sec.id });
      if (sec.intro) {
        const intro = sec.intro.ja;
        this.hud.hint(intro);
        setTimeout(() => this.run.hintTier === 0 && this.hud.hint(null), 9000);
      }
    }
    // precompute sweep checks so opening Fold Mode does not hitch
    const warm = () => sec.consoles.forEach((c) => this.cs.consoleActions(c, this.state));
    (window.requestIdleCallback ?? ((f: () => void) => setTimeout(f, 50)))(warm);
    this.hud.status(`${this.cs.stage.title.ja} ・ ${sec.name.ja}`);
  }

  private frame(now: number) {
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    this.step(dt);
    this.engine.render(dt);
    this.engine.sample(dt * 1000);
    requestAnimationFrame((t) => this.frame(t));
  }

  /** Capture mode: one simulation step and (unless a test skips it) one rendered frame, at the caller's time step. */
  advance(dt: number, render = true) {
    this.step(dt);
    if (render) this.engine.render(dt);
  }

  /** One simulation step; also used by automated tests through the debug hook. */
  step(dt: number) {
    this.director?.update(dt);
    this.time += dt;
    const wm = this.cs.walkMap(this.state);
    const tun = this.data.tunables;
    const lockedMove = this.mode !== 'play';
    if (this.mode !== 'title' && this.mode !== 'pause' && this.mode !== 'clear')
      this.player.update(dt, this.input, this.rig.yaw, wm, {
        locked: lockedMove, walkSpeed: tun.player.walkSpeed, dash: tun.player.dashMultiplier, steer: this.steer,
      });
    switch (this.mode) {
      case 'play':
        this.updatePlay();
        break;
      case 'fold':
        this.updateFold();
        break;
      case 'title': {
        const a = this.time * 0.05;
        this.rig.setCinematic(new THREE.Vector3(4 + Math.cos(a) * 70, 34, -6 + Math.sin(a) * 70), new THREE.Vector3(2, 6, -4));
        break;
      }
      case 'finale':
        this.finaleClock += dt;
        if (this.finaleClock > 6) this.showClear();
        break;
      case 'pause':
        break;
      default:
        break;
    }
    this.world.update(dt);
    this.city.update(dt);
    this.rig.update(dt, this.input, this.player.pos, { ...this.settings, distance: tun.camera.distance }, this.mode === 'play');
    if (this.mode === 'play' || this.mode === 'fold' || this.mode === 'anim') {
      this.telemetry.samplePosition(this.player.cell);
      this.perfClock += dt;
      if (this.perfClock > 30) {
        this.perfClock = 0;
        this.telemetry.log({
          type: 'perf', p50: round1(this.engine.percentile(50)), p95: round1(this.engine.percentile(95)),
          scale: round1(this.engine.renderScale), quality: this.settings.quality,
        });
      }
      this.telemetry.tick();
    }
    this.input.endFrame();
  }

  private consoleHere(): string | null {
    for (const id of this.section.consoles) {
      const c = this.cs.consoles.get(id)!;
      if (cellKey(c.at) === this.player.cell) return id;
    }
    return null;
  }

  private updatePlay() {
    if (this.input.hit('Escape')) return this.openPause();
    if (this.exitKeys.has(this.player.cell)) return this.clearSection();
    const here = this.consoleHere();
    if (here) {
      const c = this.cs.consoles.get(here)!;
      this.hud.prompt(`<kbd>E</kbd> ${c.label?.ja ?? 'コンソール'}を起動`);
      if (this.input.hit('KeyE', 'Enter')) return this.openFold(here);
    } else this.hud.prompt(null);
    if (this.input.hit('KeyR')) this.resetSection('manual');
    this.updateHints();
  }

  private updateHints() {
    const sec = this.section;
    const t = this.data.tunables.sections[sec.id];
    if (!t || this.director) return;
    const idle = this.time - this.run.lastProgress;
    const want: 0 | 1 | 2 = idle > t.secondHintSec ? 2 : idle > t.firstHintSec ? 1 : 0;
    if (want <= this.run.hintTier) return;
    this.run.hintTier = want;
    const next = nextAction(this.cs, sec.id, this.state, this.player.cell);
    if (!next) return;
    this.run.hints++;
    this.world.highlightConsole(next.console);
    this.telemetry.log({ type: 'hint', section: sec.id, tier: want === 2 ? 2 : 1 });
    const c = this.cs.consoles.get(next.console)!;
    this.hud.hint(
      want === 1
        ? '光の柱が立っている操作盤を調べてみよう。'
        : `「${c.label?.ja ?? '操作盤'}」で「${this.actionLabel(next)}」を試してみよう。`,
    );
  }

  private openFold(consoleId: string) {
    const options = this.cs.consoleActions(consoleId, this.state);
    if (!options.length) return;
    this.fold = { console: consoleId, options, index: 0, browsed: new Set([0]) };
    this.mode = 'fold';
    this.hud.prompt(null);
    this.sound.select();
    this.showFoldOption();
  }

  private showFoldOption() {
    const f = this.fold!;
    const opt = f.options[f.index];
    const target = this.cs.apply(this.state, opt.action);
    const markers = this.edgeChanges(opt.action);
    this.world.preview(opt.action, opt.blockedBy, markers);
    const c = this.cs.consoles.get(f.console)!;
    const g = this.cs.groups.get(c.controls)!;
    const fr = this.world.framing(c.controls, [this.state, target], this.player.pos);
    this.rig.setFrame(fr.center, fr.radius, this.player.pos);
    const reach = this.reachChange(target, cellKey(c.at));
    this.hud.fold({
      title: g.label?.ja ?? g.id,
      index: f.index,
      count: f.options.length,
      label: this.actionLabel(opt.action),
      blocked: opt.blockedBy.length ? opt.blockedBy.map((b) => this.moduleName(b)).join('、') : null,
      opens: reach.gained,
      closes: reach.lost,
    });
  }

  /** How many tiles become reachable / unreachable from where the player stands. */
  private reachChange(target: PuzzleState, cell: string): { gained: number; lost: number } {
    const region = (s: PuzzleState) => {
      const wm = this.cs.walkMap(s);
      const r = wm.region.get(cell);
      return new Set([...wm.region].filter(([, v]) => v === r).map(([k]) => k));
    };
    const now = region(this.state);
    const next = region(target);
    let gained = 0;
    let lost = 0;
    for (const k of next) if (!now.has(k)) gained++;
    for (const k of now) if (!next.has(k)) lost++;
    return { gained, lost };
  }

  private updateFold() {
    const f = this.fold!;
    if (this.input.hit('Escape', 'KeyQ') || this.input.rightClick) return this.closeFold(false);
    let d = 0;
    if (this.input.hit('KeyA', 'ArrowLeft') || this.input.wheel < 0) d = -1;
    if (this.input.hit('KeyD', 'ArrowRight') || this.input.wheel > 0) d = 1;
    if (d) {
      f.index = (f.index + d + f.options.length) % f.options.length;
      f.browsed.add(f.index);
      this.sound.select();
      this.showFoldOption();
    }
    if (this.input.hit('KeyE', 'Enter', 'Space')) {
      const opt = f.options[f.index];
      if (opt.blockedBy.length) {
        this.sound.denied();
        this.telemetry.log({
          type: 'action', section: this.section.id, console: f.console, action: actionKey(opt.action), ok: false,
          blockedBy: opt.blockedBy, cell: this.player.cell,
        });
        return;
      }
      this.commit(opt.action);
    }
  }

  private closeFold(committed: boolean) {
    const f = this.fold;
    if (f) this.telemetry.log({ type: 'preview', section: this.section.id, console: f.console, browsed: f.browsed.size, committed });
    this.fold = null;
    this.world.preview(null, [], []);
    this.hud.fold(null);
    if (!committed) {
      this.rig.setFrame(null);
      this.mode = 'play';
    }
  }

  private commit(a: Action) {
    const sec = this.section;
    this.closeFold(true);
    this.hud.prompt(null);
    this.mode = 'anim';
    this.run.actions++;
    this.telemetry.log({ type: 'action', section: sec.id, console: a.console, action: actionKey(a), ok: true, cell: this.player.cell });
    const c = this.cs.consoles.get(a.console)!;
    const g = this.cs.groups.get(a.group)!;
    const scale = this.foldScale;
    this.world.pulse(new THREE.Vector3(...cellFloor(c.at)));
    const big = a.group === 'g_street';
    this.city.wave(new THREE.Vector3(...g.pivot), big ? 0.85 : 0.3, big ? 55 : 90, big ? 2.6 : 1.6);
    this.sound.fold(((g.durationMs ?? 2000) / 1000) * scale);
    this.world.highlightConsole(null);
    this.hud.hint(null);
    this.world.startAction(a, scale, () => {
      this.state = this.world.state;
      this.mode = 'play';
      this.rig.setFrame(null);
      this.run.lastProgress = this.time;
      this.run.hintTier = 0;
      this.sound.open();
      if (remainingActions(this.cs, sec.id, this.state, this.player.cell) === null)
        this.hud.hint('ここからは先に進めないようです。<kbd>R</kbd> でこのパズルをやり直せます。');
    });
  }

  /** How much longer or shorter than designed the fold animations run. */
  get foldScale() {
    return this.data.tunables.fold.durationScale * (this.settings.reduceMotion ? 0.7 : 1);
  }

  private resetSection(reason: 'manual' | 'softlock') {
    const sec = this.section;
    const init = this.cs.initialState();
    const next: Record<string, number> = { ...this.state };
    for (const g of sec.groups) next[g] = init[g];
    this.state = next;
    this.world.setState(next, false);
    const cp = this.cs.stage.checkpoints.find((c) => c.id === sec.start)!;
    this.player.place(cp.at, cp.facing, this.cs.walkMap(this.state));
    this.rig.snapBehind(this.player.root.rotation.y);
    this.hud.flash();
    this.run.resets++;
    this.run.lastProgress = this.time;
    this.run.hintTier = 0;
    this.world.highlightConsole(null);
    this.hud.hint(null);
    this.telemetry.log({ type: 'reset', section: sec.id, reason });
  }

  private clearSection() {
    const sec = this.section;
    const sec_ms = Math.round((this.time - this.run.start) * 1000);
    this.results.push({ name: sec.name.ja, sec: sec_ms / 1000, actions: this.run.actions, optimal: this.run.optimal });
    this.telemetry.log({
      type: 'section_clear', section: sec.id, ms: sec_ms, actions: this.run.actions, optimal: this.run.optimal,
      hints: this.run.hints, resets: this.run.resets,
    });
    this.telemetry.flush();
    this.hud.prompt(null);
    if (this.sectionIndex + 1 < this.cs.stage.sections.length) {
      this.sound.open();
      this.enterSection(this.sectionIndex + 1, true);
    } else this.startFinale();
  }

  private startFinale() {
    this.mode = 'finale';
    this.finaleClock = 0;
    const gate = new THREE.Vector3(...cellFloor(this.cs.stage.goal.at));
    this.rig.setCinematic(gate.clone().add(new THREE.Vector3(26, 22, 30)), gate.clone().add(new THREE.Vector3(0, 6, 0)));
    this.city.wave(gate, 1.25, 45, 3.2);
    this.sound.chime();
    this.hud.toast('第一区画 踏破', 'THE FOLD IS OPEN', 5200);
    this.telemetry.log({ type: 'game_clear', ms: Math.round((this.time - this.gameStart) * 1000) });
    this.telemetry.flush();
  }

  private showClear() {
    this.mode = 'clear';
    if (this.director) return; // the demo ends on the city, not on the feedback form
    document.exitPointerLock?.();
    this.hud.clear(
      { totalSec: this.time - this.gameStart, sections: this.results },
      (fb) => {
        this.telemetry.log({ type: 'feedback', ...fb });
        this.telemetry.log({ type: 'session_end', reason: 'clear', section: this.section.id, cell: this.player.cell });
        this.telemetry.flush();
      },
      () => location.reload(),
    );
  }

  private openPause() {
    if (this.mode === 'fold') this.closeFold(false);
    this.resumeMode = this.mode === 'anim' ? 'anim' : 'play';
    this.mode = 'pause';
    this.hud.pause(true, this.settings, (s) => this.applySettings(s), () => {
      this.hud.pause(false);
      this.mode = this.resumeMode;
      this.input.requestLock();
    });
  }

  private applySettings(s: Settings) {
    this.settings = s;
    this.telemetry.enabled = s.telemetry && this.telemetryAllowed;
    this.sound.setMuted(s.muted);
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
    } catch {
      /* private mode */
    }
  }

  /** Edges that a candidate action would open or close, for the preview markers and panel counts. */
  private edgeChanges(a: Action): EdgeMarker[] {
    const now = this.cs.walkMap(this.state);
    const next = this.cs.walkMap(this.cs.apply(this.state, a));
    const out: EdgeMarker[] = [];
    const seen = new Set<string>();
    const edgeId = (k: string, s: Side) => {
      const t = (next.tiles.get(k) ?? now.tiles.get(k))!;
      const n = cellKey(step(t.cell, s));
      return [k, n].sort().join('|');
    };
    const isOpen = (wm: typeof now, k: string, s: Side) => !!wm.tiles.get(k)?.open[s];
    for (const wm of [next, now])
      for (const t of wm.tiles.values())
        for (const s of SIDES) {
          const a1 = isOpen(next, t.key, s);
          const b1 = isOpen(now, t.key, s);
          if (a1 === b1) continue;
          const other = wm.tiles.get(cellKey(step(t.cell, s)));
          if (other && other.module === t.module) continue; // a moving module's own seams are not news
          const id = edgeId(t.key, s);
          if (seen.has(id)) continue;
          seen.add(id);
          const f = cellFloor(t.cell);
          const d = DIRS[s];
          out.push({ pos: new THREE.Vector3(f[0] + d[0] * 2, t.floorY, f[2] + d[2] * 2), side: s, kind: a1 ? 'open' : 'close' });
        }
    return out;
  }

  actionLabel(a: Action): string {
    if (a.kind === 'set') {
      const g = this.cs.groups.get(a.group)!;
      if (g.kind === 'states' && g.stateLabels?.[a.to]) return g.stateLabels[a.to].ja;
      return `状態 ${a.to + 1}`;
    }
    const q = a.quarters;
    if (a.axis === 'x') return q === 1 ? '南へ転がす（90°）' : q === 3 ? '北へ転がす（90°）' : 'ひっくり返す（180°）';
    if (a.axis === 'z') return q === 1 ? '西へ転がす（90°）' : q === 3 ? '東へ転がす（90°）' : 'ひっくり返す（180°）';
    return q === 1 ? '左回りに回す（90°）' : q === 3 ? '右回りに回す（90°）' : '半回転させる（180°）';
  }

  private moduleName(id: string): string {
    if (id.startsWith('anchor:')) return 'あなたの立ち位置';
    const m = this.cs.modules.find((x) => x.id === id);
    if (m?.label) return m.label.ja;
    const g = m?.group ? this.cs.groups.get(m.group) : undefined;
    return g?.label?.ja ?? id;
  }

  /** Debug / automated-playtest hooks (enabled with ?debug=1). */
  debugApi() {
    return {
      game: this,
      cell: () => this.player.cell,
      mode: () => this.mode,
      section: () => this.section.id,
      start: () => this.begin(),
      teleport: (c: [number, number, number]) => this.player.place(c, 'E', this.cs.walkMap(this.state)),
      solve: () => solveSection(this.cs, this.section.id, { state: this.state, cell: this.player.cell }).plan.map(actionKey),
      act: (consoleId: string, key: string) => {
        const opt = this.cs.consoleActions(consoleId, this.state).find((o) => actionKey(o.action) === key);
        if (!opt || opt.blockedBy.length) return false;
        this.commit(opt.action);
        return true;
      },
      openFold: (id: string) => this.openFold(id),
      press: (code: string) => this.input.press(code),
      hold: (code: string, on: boolean) => this.input.hold(code, on),
      setYaw: (y: number) => (this.rig.yaw = y),
      /** Advance the simulation without rendering (fast, deterministic playtests). */
      simulate: (seconds: number, held: string[] = []) => {
        for (const k of held) this.input.hold(k, true);
        for (let t = 0; t < seconds; t += 1 / 60) this.step(1 / 60);
        for (const k of held) this.input.hold(k, false);
        return { cell: this.player.cell, x: this.player.pos.x, z: this.player.pos.z, mode: this.mode, section: this.section.id };
      },
    };
  }
}

function round1(x: number) {
  return Math.round(x * 10) / 10;
}

function loadSettings(): Settings {
  const d: Settings = { sensitivity: 1, invertY: false, reduceMotion: false, quality: 'medium', telemetry: defaultConsent(), muted: false };
  let s = d;
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) s = { ...d, ...JSON.parse(raw) };
  } catch {
    /* ignore */
  }
  const q = new URLSearchParams(location.search).get('q');
  if (q === 'low' || q === 'medium' || q === 'high') s = { ...s, quality: q };
  return s;
}
