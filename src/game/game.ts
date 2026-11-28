// Game loop and state machine: title -> play <-> fold mode -> fold animation -> ... -> finale -> clear.
import * as THREE from 'three';
import { CompiledStage, actionKey, step } from '../core/compile.ts';
import { DIRS, SIDES, cellFloor, cellKey, type Side } from '../core/math.ts';
import { resolveSlots } from '../core/slots.ts';
import { nextAction, remainingActions, solveSection } from '../core/solver.ts';
import type { Tunables } from '../core/tunables.ts';
import type { Action, PuzzleSection, PuzzleState, StageFile } from '../core/types.ts';
import { Sound } from './audio.ts';
import { createBackground, setupEnvironment } from './backdrop.ts';
import { pierKeepOut } from './foldcity/keepout.ts';
import { pierFeet, planSlabs } from './kitLayout.ts';
import type { Background } from './foldcity/foldcity.ts';
import { CameraRig } from './camera.ts';
import { DemoDirector, type DemoOptions } from './demo.ts';
import { sectionDiorama, type DioramaView } from './diorama.ts';
import {
  AngleTracker, HANDLE, REST, bodyWheel, clampTo, handleSpot, handleWheel, nearestStop, pixelRay, planeBasis, rangeOf, releaseAt, sideOf, stopAngles,
  toPixel, wheelNormal, wheelRadius, type Range,
} from './drag.ts';
import { Engine } from './engine.ts';
import { Hud, type Settings } from './hud.ts';
import { Input, type PointerSample } from './input.ts';
import { Kit } from './kit.ts';
import { giltTakesSky, type Sun } from './look.ts';
import { createMaterials } from './materials.ts';
import { Player, cloakAvatar, type Avatar } from './player.ts';
import { FrameProbe, PLANS, isQualitySetting, stepDownFor, type Quality } from './quality.ts';
import { Stepper } from './stepper.ts';
import { Telemetry, clientInfo, defaultConsent } from './telemetry.ts';
import { loadVrmAvatar } from './vrmAvatar.ts';
import { loadWandererAvatar, type WandererAvatar } from './wandererAvatar.ts';
import { World, type EdgeMarker } from './world.ts';

export interface Revision { revision: number; updated: string; recent: { date: string; summary: string }[] }
export interface GameData { stage: StageFile; tunables: Tunables; revision: Revision; build: string }
/**
 * `demo` plays the game by itself; `capture` leaves the clock to the caller (see advance());
 * `shots` is the review mode (shots.ts): fixed scenes, no telemetry, no adaptive resolution.
 */
export interface GameOptions { demo?: DemoOptions; capture?: boolean; shots?: boolean }

/** The HUD states the review shots show with `?ui=1` (shots.ts). */
export type UiShot = 'fold' | 'fold-blocked' | 'hint' | 'pause' | 'controls' | 'clear';

/** `shot` is a still scene for the review shots: nothing walks, folds or reacts to input. */
type Mode = 'title' | 'play' | 'fold' | 'anim' | 'pause' | 'finale' | 'clear' | 'shot';

interface FoldSession {
  console: string;
  options: { action: Action; blockedBy: string[] }[];
  index: number;
  browsed: Set<number>;
  /** What a pointer can turn here: null when the console's options are not turns of one axis. */
  grab: FoldGrab | null;
}

/** How the group of the console at hand turns, and where its handle stands (all fixed while Fold Mode is open). */
interface FoldGrab {
  group: string;
  axisName: 'x' | 'y' | 'z';
  axis: THREE.Vector3;
  pivot: THREE.Vector3;
  /** The end of the axis the handle is on, and where its wheel stands. */
  side: 1 | -1;
  spot: THREE.Vector3;
  /** The turn of each option, in the order of `options`, and how far the group may be turned each way. */
  angles: number[];
  range: Range;
  /** How far the group can really be turned each way: `range`, held back where the sweep towards a blocked stop meets something. */
  reach: Range;
  /** A direction across the axis, fixed in the world (see HandlePose.ref). */
  ref: THREE.Vector3;
}

/** A pointer holding the handle or the group: where it took hold, whether the group has begun to turn, and how far it has. */
interface DragSession {
  kind: 'handle' | 'body';
  tracker: AngleTracker;
  x0: number;
  y0: number;
  live: boolean;
  /** The turn the hand has asked for (radians about the axis, within the range), the stop that is nearest to it, and where the group is (the same, held back at a contact). */
  angle: number;
  near: number;
  shown: number;
  /** Let go: the group is on its way to a stop or back. */
  settling: boolean;
}

interface SectionRun {
  start: number;
  actions: number;
  hints: number;
  resets: number;
  hintTier: 0 | 1 | 2;
  lastProgress: number;
  optimal: number;
  /** Optimal actions still needed from where the player stands; only a fold that lowers it is progress. */
  remaining: number;
  /** A fold or reset changed the next step, so a hint on screen has to point somewhere else. */
  hintStale: boolean;
}

const SETTINGS_KEY = 'fold-city:settings';
/** 2: the quality in the stored settings is the player's choice (earlier versions saved the default along with every other setting). */
const SETTINGS_VERSION = 2;
const UP = new THREE.Vector3(0, 1, 0);
const AXES = { x: new THREE.Vector3(1, 0, 0), y: new THREE.Vector3(0, 1, 0), z: new THREE.Vector3(0, 0, 1) };

/** A grab on the group itself ignores the angle this close to its axis (metres). */
const BODY_HUB = 1.2;
/** A press has to move this far (CSS px) before the group begins to turn: a tap is no drag. */
const DRAG_SLOP = { mouse: 5, touch: 9 };

/**
 * The establishing view at the start of a section: the camera goes up into the diorama (camera.ts: DIORAMA_MOVE.in), holds,
 * and comes back behind the player (DIORAMA_MOVE.out), about 3.2 s in all. `hold` counts from the start, so it includes the
 * move in. With reduceMotion the camera cuts there and back, and the hold is what is left.
 */
const ESTABLISH = { hold: 2.2, holdStill: 2.0 };
/** The keys that walk and jump: a new press of one of them (or a click) ends the establishing view. */
const SKIP_KEYS = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'];

/**
 * What the camera shows while a fold turns, by the group that moves: the whole puzzle (the diorama, as in Fold Mode: the
 * default), or the purpose-made view of the moving part (`frameFold`). Chosen by looking at each fold under both cameras:
 * the first section's bridge and the cube (about 200 px across in the diorama) read best in the diorama, with what they join
 * up in the same picture, and so do the tower's turns (arms about 55 px long there, but the fold lasts 1.6 s, and a camera
 * that dives in takes 0.7 s of it: the picture would move as well as the arm). The street, hinged at one end, swings
 * edge-on to the diorama, and its 3.2 s leaves room for the dive, so it keeps its view.
 */
const FOLD_CAMERA: Record<string, 'diorama' | 'view'> = { g_street: 'view' };

export class Game {
  readonly engine: Engine;
  readonly cs: CompiledStage;
  readonly world: World;
  readonly player: Player;
  readonly input: Input;
  readonly hud: Hud;
  readonly sound = new Sound();
  readonly telemetry: Telemetry;
  readonly city: Background;
  readonly rig: CameraRig;
  readonly director: DemoDirector | null = null;
  mode: Mode = 'title';
  /** Walking direction set by the demo instead of the keyboard. */
  steer: { x: number; z: number } | null = null;
  /** True once the kit and the character are in and shaders are compiled (the capture waits for this). */
  ready = false;
  state: PuzzleState;
  settings: Settings;
  /**
   * The tier auto has chosen for this machine (the GPU's name first, then the frames the title measured). It is what the
   * settings show as 自動（低）, and the tier in use when the setting is auto.
   */
  autoChoice: Quality;
  /** What auto knew and did: the GPU string, the tier it guessed, the median frame interval the title measured (0 until it has), the tier it stepped to. */
  readonly autoInfo = { gpu: '', guess: 'medium' as Quality, p50: 0, typical: 0, measured: false, chosen: 'medium' as Quality };
  private readonly sun: Sun;
  /** The title's measuring of real frame intervals, while it runs (quality.ts). */
  private probe: FrameProbe | null = null;
  private data: GameData;
  private sectionIndex = 0;
  private run: SectionRun;
  private results: { name: string; sec: number; actions: number; optimal: number }[] = [];
  private fold: FoldSession | null = null;
  private time = 0;
  private last = performance.now();
  private readonly stepper = new Stepper();
  private gameStart = 0;
  private perfClock = 0;
  private finaleClock = 0;
  private resumeMode: Mode = 'play';
  private exitKeys: Set<string>;
  private automated = false;
  private telemetryAllowed = true;
  private introTimer = 0;
  /** The establishing view at the start of a section, while it runs: seconds so far, and the walking keys that were already down. */
  private establish: { t: number; down: Set<string> } | null = null;
  /** The section's intro text, waiting for the establishing view to end. */
  private showIntro: (() => void) | null = null;
  private readonly dioramas = new Map<string, DioramaView>();
  private readonly foldCameras: Record<string, 'diorama' | 'view'> = { ...FOLD_CAMERA };
  private readonly shots: boolean;
  /** Fold Mode's drag, while a pointer holds the handle or the group, and the cursor the canvas shows. */
  private drag: DragSession | null = null;
  private handleHot = 0;
  private cursor = '';
  /** A point of the group to take hold of, for the debug hook `grabPoint` (null until it has been asked for). */
  private bodyProbe: THREE.Vector3 | null = null;
  /** Fold Mode let go of the mouse so that its cursor can be seen and moved: the lock is taken back when it closes. */
  private lockBeforeFold = false;
  private relockArmed = false;
  /** The character model, when it is the avatar in use (the review shots put it back into its rest pose). */
  private wanderer: WandererAvatar | null = null;

  constructor(canvas: HTMLCanvasElement, hudRoot: HTMLElement, data: GameData, opts: GameOptions = {}) {
    this.data = data;
    this.shots = !!opts.shots;
    this.settings = loadSettings(this.shots);
    const stage = resolveSlots(data.stage);
    this.cs = new CompiledStage(stage);
    this.state = this.cs.initialState();
    // (the frame-by-frame capture must not look different from one machine to the next: auto is the middle tier there)
    this.engine = new Engine(
      canvas, opts.capture && this.settings.quality === 'auto' ? 'medium' : this.settings.quality, opts.capture, new URLSearchParams(location.search).get('gpu'),
    );
    this.engine.adaptive = !this.shots;
    const quality = this.engine.quality;
    this.autoChoice = this.settings.quality === 'auto' ? quality : this.engine.guess;
    Object.assign(this.autoInfo, { gpu: this.engine.gpu, guess: this.engine.guess, chosen: this.autoChoice });
    const M = createMaterials(stage.visualTheme.accent);
    const env = setupEnvironment(this.engine.scene, this.engine.renderer, quality);
    this.sun = env.sun;
    this.engine.beforeRender = () => env.sun.follow(this.engine.camera, this.player.pos.y, this.rig.shadowView());
    this.world = new World(this.cs, M);
    this.engine.scene.add(this.world.root);
    const query = new URLSearchParams(location.search);
    this.city = createBackground(stage.visualTheme, { variant: query.get('city'), morph: query.get('morph'), debug: query.get('bgdebug'), farWindows: query.get('farwin') === '1', tune: query.get('bgtune'), buildings: query.get('bldg'), detail: PLANS[quality].city, keepOut: pierKeepOut(pierFeet(planSlabs(this.cs))) });
    this.engine.scene.add(this.city.group);
    this.player = new Player({ object: new THREE.Group(), animate: () => {} }); // nothing until the character has loaded
    this.engine.scene.add(this.player.root);
    this.input = new Input(canvas);
    this.input.grab = {
      down: (p) => this.grabDown(p),
      move: (p) => this.grabMove(p),
      up: () => this.grabUp(),
      cancel: () => this.grabCancel(),
    };
    this.hud = new Hud(hudRoot);
    this.rig = new CameraRig(this.engine.camera, () => this.world.colliders);
    const params = new URLSearchParams(location.search);
    const playtest = params.has('playtest');
    const local = /^(localhost|127\.0\.0\.1)$/.test(location.hostname) && !params.has('telemetry');
    // the demo and the review shots are not players: they must never reach the play data the improvement loop reads
    this.telemetryAllowed = !local && !opts.demo && !this.shots;
    this.telemetry = new Telemetry(import.meta.env.VITE_TELEMETRY_URL ?? './api/telemetry', this.settings.telemetry && this.telemetryAllowed, playtest);
    this.exitKeys = new Set();
    this.run = this.newRun();
    this.enterSection(0, false);
    this.showTitle();
    // Automated browsers and the demo cannot hold pointer lock; do not treat that as the player pausing.
    this.automated = navigator.webdriver === true || !!opts.demo || this.shots;
    // (Fold Mode lets go of the lock on purpose, to show the cursor the drag needs: losing it there is not the player pausing)
    document.addEventListener('pointerlockchange', () => {
      if (this.automated) return;
      if (!document.pointerLockElement && this.mode === 'play') this.openPause();
    });
    const vrmUrl = params.get('vrm') ?? './assets/player.vrm';
    // Wall-clock play compiles what it is about to show off the frame (see `precompile`); the capture and the review shots
    // draw frames on demand under a virtual clock, which holds back the timers that compileAsync polls with.
    const live = !opts.capture;
    const sky = env.sky.catch((e) => console.warn('sky not loaded, keeping the haze colour:', e));
    // (a program is made for the sky the scene has, so what is compiled waits for it)
    const compile = async (o: THREE.Object3D) => {
      await sky;
      await this.engine.precompile(o);
    };
    const takeSky = () => {
      giltTakesSky(this.engine.scene, this.world.giltMaterials()); // before anything is compiled, so the gilt's shader is compiled once
      this.world.ringTakesSky(this.engine.scene);
    };
    // The avatar: a VRM file if one is there, else the character model, else (loading failed) the old cloaked stand-in.
    const character = loadVrmAvatar(vrmUrl)
      .catch((e) => {
        console.warn('VRM avatar not loaded:', e);
        return null;
      })
      .then(async (vrm) => {
        let avatar: Avatar;
        if (vrm) avatar = vrm;
        else {
          try {
            this.wanderer = await loadWandererAvatar({ reduceMotion: () => this.settings.reduceMotion });
            avatar = this.wanderer;
          } catch (e) {
            console.warn('character model not loaded, keeping the cloaked stand-in:', e);
            avatar = cloakAvatar(M);
          }
        }
        if (live) await compile(avatar.object); // it joins the scene with its shaders ready
        this.player.setAvatar(avatar);
        performance.mark('fold:character');
      });
    const kit = Kit.load(this.engine.renderer)
      .then(async (k) => {
        if (live) {
          // Nothing of the world is drawn until the kit is in (the colliders are never drawn), so it is hidden for the moment
          // its shaders take: the first frame to draw it would otherwise build them all, one after another.
          await sky;
          this.world.root.visible = false;
        }
        this.world.applyKit(k);
        if (live) {
          takeSky();
          await this.engine.precompile(this.world.root);
          this.world.root.visible = true;
        }
        performance.mark('fold:kit');
      })
      .catch((e) => {
        this.world.root.visible = true;
        console.error('kit not loaded, showing the plain slabs:', e);
        this.world.showColliders();
      });
    // (the city's shaders are compiled off the frame, against the scene as it is lit once the sky is in, before the city is shown)
    const city = this.city.load('./assets/city.glb', live ? compile : undefined).catch((e) => console.warn('background city not loaded:', e));
    Promise.all([sky, kit, city, character])
      .then(async () => {
        if (!live) takeSky(); // (once the sky and the kit are both in; the live path did it when the kit came in)
        const warmed = this.world.warmUp(compile, this.engine.scene);
        if (live) await warmed; // (the review shots and the capture do not wait: their frames are drawn on demand)
        if (['facing', 'range', 'dist', 'unit0', 'unit1', 'unit2'].includes(query.get('bgdebug') ?? '')) this.flattenForDebug();
      })
      .finally(() => {
        this.ready = true;
        performance.mark('fold:ready');
        this.hud.setStartReady();
        // auto measures what this machine really does for about two seconds from here, on the title (see measureQuality)
        if (this.settings.quality === 'auto' && this.engine.adaptive && !opts.demo && !opts.capture) this.probe = new FrameProbe();
      });
    // frames drawn while the page was hidden say nothing about the machine
    document.addEventListener('visibilitychange', () => this.probe?.reset());
    if (opts.demo) this.director = new DemoDirector(this, opts.demo);
    if (!opts.capture) requestAnimationFrame((t) => this.frame(t));
  }

  /** `?bgdebug=facing`: everything but the background city turns flat white and the sky black, so a script can count classes. */
  private flattenForDebug() {
    const white = new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false });
    const black = new THREE.MeshBasicMaterial({ color: 0x000000, fog: false });
    this.engine.scene.background = new THREE.Color(0x000000);
    this.engine.bloom.intensity = 0;
    this.engine.scene.traverse((o) => {
      for (let p: THREE.Object3D | null = o; p; p = p.parent) if (p === this.city.group) return;
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) mesh.material = o.parent === this.engine.scene && mesh.geometry.type === 'CircleGeometry' ? black : white;
      else if ((o as THREE.Sprite).isSprite || (o as THREE.Points).isPoints || (o as THREE.Line).isLine) o.visible = false;
    });
  }

  get section(): PuzzleSection {
    return this.cs.stage.sections[this.sectionIndex];
  }

  private newRun(): SectionRun {
    return { start: this.time, actions: 0, hints: 0, resets: 0, hintTier: 0, lastProgress: this.time, optimal: 0, remaining: 0, hintStale: false };
  }

  private showTitle() {
    this.mode = 'title';
    const r = this.data.revision;
    this.hud.title({
      revision: r.revision,
      updated: r.updated,
      recent: r.recent,
      consent: this.settings.telemetry,
      ready: this.ready,
      onConsent: (v) => this.applySettings({ ...this.settings, telemetry: v }),
      onStart: () => this.mode === 'title' && this.ready && this.begin(),
      onSettings: () =>
        this.hud.pause(true, this.settings, (s) => this.applySettings(s), () => this.hud.pause(false), 'settings', this.autoChoice),
    });
    // a slow establishing orbit behind the title
    this.rig.setCinematic(new THREE.Vector3(-58, 34, 46), new THREE.Vector3(2, 8, -4));
  }

  /** Leave the title as if Start was pressed (the demo uses this). */
  startFromTitle() {
    if (this.mode === 'title') this.begin(true);
  }

  /**
   * Review shots (shots.ts): jump to the start of section `index` in `state` without playing it. The player stands at
   * the section's checkpoint, no fold is under way, no hint or toast is up, the HUD is hidden (the title shot keeps
   * only the title) and everything that runs on time starts over at zero, so the same shot always looks the same.
   * The caller then sets the camera and steps the simulation.
   */
  stageShot(index: number, state: PuzzleState, title: boolean) {
    clearTimeout(this.introTimer);
    this.time = this.finaleClock = this.perfClock = 0;
    this.fold = null;
    this.drag = null;
    this.setCursor('');
    this.state = state;
    this.world.resetForShot(state);
    this.city.reset();
    this.hud.resetForShot();
    this.hud.setVisible(title);
    this.establish = null;
    this.hud.holdHint(false); // (a shot of Fold Mode left it held)
    this.rig.setFrame(null);
    this.rig.setCinematic(null);
    this.rig.setDiorama(null);
    this.enterSection(index, false);
    this.wanderer?.reset();
    this.engine.scene.updateMatrixWorld(true); // the camera's collision rays must see this pose, not the last frame's
    if (title) this.showTitle();
    else this.mode = 'shot';
    this.rig.cut();
  }

  /**
   * Review shots with `?ui=1` (shots.ts): show one HUD state over the scene `stageShot` has just set up. It throws when
   * the stage has no scene for the state, so a changed stage fails loudly instead of showing something else.
   * `consoleId` is the console of `fold-blocked`.
   */
  uiShot(kind: UiShot, consoleId?: string) {
    this.hud.setVisible(true);
    const sec = this.section;
    switch (kind) {
      case 'fold':
        this.foldShot(sec.consoles[0], false);
        break;
      case 'fold-blocked':
        this.foldShot(consoleId ?? sec.consoles[0], true);
        break;
      case 'hint': {
        // everything the play HUD can show at once: the section card, the hint and the prompt at a console
        const next = nextAction(this.cs, sec.id, this.state, this.player.cell);
        if (!next) throw new Error(`no next action in ${sec.id} to show a hint for`);
        const c = this.cs.consoles.get(next.console)!;
        this.player.place(c.at, 'E', this.cs.walkMap(this.state));
        this.world.highlightConsole(next.console);
        this.hud.toast(sec.name.ja, sec.name.en.toUpperCase(), 600000);
        this.hud.hint(this.hintText(2, next));
        this.hud.prompt(this.consolePrompt(next.console));
        break;
      }
      case 'pause':
        this.openPause();
        break;
      case 'controls':
        this.hud.openControls();
        break;
      case 'clear':
        this.clearShot();
        break;
    }
  }

  /** Fold Mode open at `consoleId` with its first free (or first blocked) option showing. */
  private foldShot(consoleId: string, blocked: boolean) {
    const options = this.cs.consoleActions(consoleId, this.state);
    const index = options.findIndex((o) => (o.blockedBy.length > 0) === blocked);
    if (index < 0) throw new Error(`console ${consoleId} has no ${blocked ? 'blocked' : 'free'} option to show`);
    this.player.place(this.cs.consoles.get(consoleId)!.at, 'E', this.cs.walkMap(this.state));
    if (blocked && !this.blockerFix(options[index].blockedBy)) throw new Error(`the blocked option of ${consoleId} has no fix hint to show`);
    this.openFold(consoleId, index);
    this.rig.cut();
  }

  /** The clear screen with made-up times (the shots never play the game): real section names and shortest move counts. */
  private clearShot() {
    this.mode = 'clear';
    const sections = this.cs.stage.sections.map((s, i) => {
      const optimal = solveSection(this.cs, s.id).optimal ?? 0;
      return { name: s.name.ja, sec: 48 + i * 37, actions: optimal + (i === 1 ? 2 : 0), optimal };
    });
    this.hud.clear({ totalSec: sections.reduce((t, x) => t + x.sec, 0), sections }, () => {}, () => {});
  }

  private begin(keepCamera = false) {
    this.sound.start();
    this.sound.setMuted(this.settings.muted);
    if (!this.automated) this.input.requestLock();
    this.hud.hideTitle();
    if (!keepCamera) {
      this.rig.setCinematic(null);
      this.rig.snapBehind(-Math.PI / 2, !this.director); // (the establishing view glides on from the title's orbit)
    }
    this.gameStart = this.time;
    this.telemetry.log({
      type: 'session_start', build: this.data.build, revision: this.data.revision.revision, stage: `${this.cs.stage.stageId}@${this.cs.stage.version}`,
      quality: this.engine.quality, client: clientInfo(this.engine.renderer),
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
    this.run.remaining = this.run.optimal;
    const cp = this.cs.stage.checkpoints.find((c) => c.id === sec.start)!;
    if (i === 0 || !announce) this.player.place(cp.at, cp.facing, this.cs.walkMap(this.state));
    this.world.highlightConsole(null);
    this.world.setGuidance(sec.consoles, this.data.tunables.sections[sec.id]?.beacon ?? 0);
    this.world.setExitSection(sec.id); // (its exit is marked on the floor)
    // the city shows this section's structure; walking on from the section before, it folds there
    const fold = announce && i > 0;
    this.city.setSection?.(i, fold, this.settings.reduceMotion);
    if (fold) this.engine.hold(5); // no resize hitch inside the 4 s fold of the background
    this.hud.hint(null);
    // a previous section's intro timer must not hide this section's text
    clearTimeout(this.introTimer);
    this.showIntro = null;
    if (announce) {
      this.hud.toast(sec.name.ja, sec.name.en.toUpperCase());
      this.telemetry.log({ type: 'section_enter', section: sec.id });
      if (sec.intro) {
        const intro = sec.intro.ja;
        this.showIntro = () => {
          this.showIntro = null;
          this.hud.hint(intro);
          this.introTimer = window.setTimeout(() => this.run.hintTier === 0 && this.hud.hint(null), 9000);
        };
        if (this.director) this.showIntro(); // (the demo has no establishing view of its own to wait for)
      }
    }
    if (announce && !this.director) this.beginEstablish(); // (it shows the section's intro text when it ends: the text's box would stand over the view)
    // precompute sweep checks so opening Fold Mode does not hitch
    const warm = () => sec.consoles.forEach((c) => this.cs.consoleActions(c, this.state));
    (window.requestIdleCallback ?? ((f: () => void) => setTimeout(f, 50)))(warm);
    this.hud.status(`${this.cs.stage.title.ja} ・ ${sec.name.ja}`);
  }

  /** The diorama of the current section for a use (`intro`: the establishing view; `fold`: Fold Mode, with room for its panel). */
  private dioramaOf(use: 'intro' | 'fold'): DioramaView {
    const key = `${this.sectionIndex}:${use}`;
    let view = this.dioramas.get(key);
    if (!view) this.dioramas.set(key, (view = sectionDiorama(this.cs, this.section, use)));
    return view;
  }

  /** The camera goes up to look over the whole puzzle before the player sets out; any step, jump or click ends it early. */
  private beginEstablish() {
    this.establish = { t: 0, down: new Set(SKIP_KEYS.filter((k) => this.input.down(k))) };
    this.rig.setDiorama(this.dioramaOf('intro'));
  }

  /** Runs inside `step`. Time stands still while the game is paused or Fold Mode is open. */
  private updateEstablish(dt: number) {
    const e = this.establish;
    if (!e || this.mode !== 'play') return;
    e.t += dt;
    // a key that is held on entering the section (the player ran through the exit) does not skip it; a new one does
    const pressed = SKIP_KEYS.some((k) => this.input.hit(k) || (this.input.down(k) && !e.down.has(k)));
    for (const k of [...e.down]) if (!this.input.down(k)) e.down.delete(k);
    if (pressed || this.input.clicked || e.t >= (this.settings.reduceMotion ? ESTABLISH.holdStill : ESTABLISH.hold)) this.endEstablish(true);
  }

  /** `back`: the camera returns to the follow camera (not when Fold Mode takes the diorama over). */
  private endEstablish(back: boolean) {
    if (!this.establish) return;
    this.establish = null;
    if (back) this.rig.setDiorama(null);
    this.showIntro?.();
  }

  /**
   * One displayed frame. Game time follows the clock: the simulation runs as many steps of at most 1/60 s as the real time
   * since the last frame needs (stepper.ts), up to a quarter of a second of it, so a slow machine sees the game at its real
   * speed and only a slideshow (under 4 fps) slows it. One render per frame, however many steps ran.
   */
  private frame(now: number) {
    const real = Math.max(0, (now - this.last) / 1000);
    this.last = now;
    this.stepper.run(real, (dt) => this.step(dt));
    this.engine.render(Math.min(real, 0.05));
    // (the adaptive resolution is told how slow the frame really was, not how much of it the simulation took)
    this.engine.sample(Math.min(real, 1) * 1000);
    if (this.probe && (this.mode === 'title' || this.mode === 'play') && this.probe.add(Math.min(real, 1) * 1000)) this.measureQuality();
    requestAnimationFrame((t) => this.frame(t));
  }

  /**
   * Auto's second look (quality.ts): the median of the real frame intervals since `ready`, on the title (or in the first
   * seconds of play, for a player who pressed Start at once). A machine slower than its GPU's name said steps down, live.
   */
  private measureQuality() {
    const { p50, typical } = this.probe!;
    this.probe = null;
    if (this.settings.quality !== 'auto') return; // (the player chose a tier while it was measuring: theirs stands)
    Object.assign(this.autoInfo, { p50, typical, measured: true });
    // (the median of the time, not of the frames: the same for steady frames, and it also sees short and long frames by turns)
    this.applyQuality(stepDownFor(this.engine.quality, typical));
  }

  /** Lower the quality while the game runs: the renderer, the sun's shadow map, and how much of the city is drawn. Never raises. */
  private applyQuality(next: Quality) {
    if (next === this.engine.quality) return;
    this.engine.setQuality(next);
    this.sun.setQuality(next);
    this.city.setDetail?.(PLANS[next].city);
    this.autoChoice = this.autoInfo.chosen = next;
    performance.mark(`fold:quality-${next}`);
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
    if (this.mode !== 'title' && this.mode !== 'pause' && this.mode !== 'clear' && this.mode !== 'shot')
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
        const a = (this.shots ? 0 : this.time) * 0.05; // the shots keep the orbit where a player first sees it
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
    this.updateEstablish(dt);
    this.world.update(dt);
    this.city.update(dt);
    // (the mouse looks round the follow camera in play, and round the diorama in Fold Mode; neither while the establishing view runs)
    this.rig.update(dt, this.input, this.player.pos, { ...this.settings, distance: tun.camera.distance }, this.mode === 'play' && !this.establish, this.mode === 'fold' && !this.input.grabbing);
    this.world.applyShake(this.engine.camera, this.settings.reduceMotion); // (the stop of a fold shakes it a little; none with reduceMotion)
    this.updateGrabView(dt); // (the handle and the cursor stand where the camera has put the picture)
    if (this.mode === 'play' || this.mode === 'fold' || this.mode === 'anim') {
      this.telemetry.samplePosition(this.player.cell);
      this.perfClock += dt;
      if (this.perfClock > 30) {
        this.perfClock = 0;
        this.telemetry.log({
          type: 'perf', p50: round1(this.engine.percentile(50)), p95: round1(this.engine.percentile(95)),
          scale: round1(this.engine.renderScale), quality: this.engine.quality,
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
      this.hud.prompt(this.consolePrompt(here));
      if (this.input.hit('KeyE', 'Enter')) return this.openFold(here);
    } else this.hud.prompt(null);
    if (this.input.hit('KeyR')) this.resetSection('manual');
    this.updateHints();
  }

  /**
   * Hints come after `firstHintSec` / `secondHintSec` without progress. Progress means a fold that brings the goal
   * closer: folding back and forth or resetting does not restart the clock, so a player who flails still gets help.
   */
  private updateHints() {
    const sec = this.section;
    const t = this.data.tunables.sections[sec.id];
    if (!t || this.director) return;
    const idle = this.time - this.run.lastProgress;
    const want: 0 | 1 | 2 = idle > t.secondHintSec ? 2 : idle > t.firstHintSec ? 1 : 0;
    const raise = want > this.run.hintTier;
    const retarget = this.run.hintStale && this.run.hintTier > 0;
    this.run.hintStale = false;
    if (!raise && !retarget) return;
    if (raise) this.run.hintTier = want;
    const next = nextAction(this.cs, sec.id, this.state, this.player.cell);
    if (!next) return;
    if (raise) {
      this.run.hints++;
      this.telemetry.log({ type: 'hint', section: sec.id, tier: want === 2 ? 2 : 1 });
    }
    this.world.highlightConsole(next.console);
    this.hud.hint(this.hintText(this.run.hintTier === 1 ? 1 : 2, next));
  }

  /** Tier 1 only says where to look; tier 2 names the console and the move. */
  private hintText(tier: 1 | 2, next: Action): string {
    if (tier === 1) return '光の柱が立っている操作盤を調べてみよう。';
    const c = this.cs.consoles.get(next.console)!;
    return `「${c.label?.ja ?? '操作盤'}」で「${this.actionLabel(next)}」を試してみよう。`;
  }

  private consolePrompt(id: string): string {
    return `<kbd>E</kbd> ${this.cs.consoles.get(id)!.label?.ja ?? 'コンソール'}を起動`;
  }

  private openFold(consoleId: string, index = 0) {
    const options = this.cs.consoleActions(consoleId, this.state);
    if (!options.length) return;
    this.fold = { console: consoleId, options, index, browsed: new Set([index]), grab: this.foldGrab(consoleId, options) };
    this.mode = 'fold';
    // the cursor has to be seen and moved to take hold of anything: the lock is let go of (and taken back when Fold Mode closes)
    if (!this.automated && document.pointerLockElement) {
      this.lockBeforeFold = true;
      document.exitPointerLock();
    }
    this.handleHot = 0;
    this.bodyProbe = null;
    this.world.handle.show(!!this.fold.grab);
    this.endEstablish(false); // Fold Mode takes the diorama over, with the room its panel needs
    this.rig.setDiorama(this.dioramaOf('fold'));
    // the section's intro text would stand over the preview; a hint that helps with the choice (the player is stuck) stays
    this.hud.holdHint(this.hud.hintIs(this.section.intro?.ja));
    this.hud.prompt(null);
    this.world.setGuidanceHidden(true); // the guidance columns would stand in front of the preview
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
    const reach = this.reachChange(target, cellKey(c.at));
    const blocked = opt.blockedBy.length > 0;
    this.hud.fold({
      title: g.label?.ja ?? g.id,
      index: f.index,
      count: f.options.length,
      label: this.actionLabel(opt.action),
      blocked: blocked ? opt.blockedBy.map((b) => this.moduleName(b)).join('、') : null,
      fix: blocked ? this.blockerFix(opt.blockedBy) : null,
      frees: blocked ? [] : this.freedActions(f.console, target),
      opens: reach.gained,
      closes: reach.lost,
    });
  }

  /** Where the thing in the way can be moved from, e.g. 腕の塔は「塔の操作盤（岩棚）」で動かせる. Prefers a console the player can walk to. */
  private blockerFix(blockedBy: string[]): string | null {
    const wm = this.cs.walkMap(this.state);
    const here = wm.region.get(this.player.cell);
    for (const id of blockedBy) {
      const group = this.cs.modules.find((m) => m.id === id)?.group;
      if (!group) continue;
      const movers = this.section.consoles.map((k) => this.cs.consoles.get(k)!).filter((k) => k.controls === group);
      const near = movers.filter((k) => wm.region.get(cellKey(k.at)) === here);
      const dist = (k: (typeof movers)[number]) => {
        const p = cellFloor(k.at);
        return Math.hypot(p[0] - this.player.pos.x, p[2] - this.player.pos.z);
      };
      const pick = (near.length ? near : movers).sort((a, b) => dist(a) - dist(b))[0];
      if (pick) return `${this.moduleName(id)}は「${pick.label?.ja ?? pick.id}」で動かせる`;
    }
    return null;
  }

  /**
   * Actions of the section's other consoles that this option would free from interference. Only the freeing side is
   * shown: in the Fold Gate the move that reaches the ledge is exactly the one that blocks the street.
   */
  private freedActions(consoleId: string, target: PuzzleState): string[] {
    const moving = this.cs.consoles.get(consoleId)!.controls;
    const out: string[] = [];
    for (const id of this.section.consoles) {
      const c = this.cs.consoles.get(id)!;
      if (c.controls === moving) continue;
      const before = new Map(this.cs.consoleActions(id, this.state).map((o) => [actionKey(o.action), o.blockedBy.length > 0]));
      for (const o of this.cs.consoleActions(id, target))
        if (before.get(actionKey(o.action)) && !o.blockedBy.length)
          out.push(`「${c.label?.ja ?? id}」で「${this.actionLabel(o.action)}」ができるようになる`);
    }
    return out.slice(0, 2);
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
    if (this.drag || this.world.animating) return; // (a pointer has the group, or it is on its way: the keys and the wheel wait)
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
      if (opt.blockedBy.length) return this.refuse(opt);
      this.commit(opt.action);
    }
  }

  // ---- Fold Mode's drag: the handle and the group itself, taken hold of by a pointer (drag.ts has the maths) ----

  /** How the console's group turns and where its wheel stands; null for a console whose options are not turns about one axis. */
  private foldGrab(consoleId: string, options: FoldSession['options']): FoldGrab | null {
    const c = this.cs.consoles.get(consoleId)!;
    const group = c.controls;
    const motions = options.map((o) => this.cs.motionOf(this.state, o.action));
    if (!motions.length || motions.some((m) => m.axis !== motions[0].axis)) return null;
    const axisName = motions[0].axis;
    const axis = AXES[axisName].clone();
    const pivot = new THREE.Vector3(...motions[0].pivot);
    const ids = new Set(this.cs.modules.filter((m) => m.group === group).map((m) => m.id));
    const boxes = this.cs.worldBoxes(this.state).filter((b) => ids.has(b.module));
    // the side the diorama camera is on at rest, so the wheel does not change sides as the player looks round
    const rest = this.dioramaOf('fold').pose(this.engine.camera.aspect).pos;
    const side = sideOf(axis, pivot, rest);
    const angles = stopAngles(motions.map((m) => m.quarters));
    const ref = AXES[axisName === 'y' ? 'x' : 'y'].clone();
    // a group is not carried through what its fold would hit: the turn towards a blocked stop ends where the sweep meets something
    const range = rangeOf(angles);
    const reach = { ...range };
    options.forEach((o, i) => {
      if (!o.blockedBy.length) return;
      const clear = this.cs.sweepClearance(this.state, o.action);
      if (angles[i] > 0) reach.hi = Math.min(reach.hi, clear);
      else reach.lo = Math.max(reach.lo, clear);
    });
    return { group, axisName, axis, pivot, side, spot: handleSpot(boxes, pivot, axis, side, HANDLE.clearance), angles, range, reach, ref };
  }

  /** The wheel as it is drawn now, and how far a pointer may be from its middle (CSS px) to take hold of it. */
  private handleView(grab: FoldGrab, vp: { width: number; height: number }, touch: boolean) {
    const cam = this.engine.camera;
    cam.updateMatrixWorld();
    const toCam = cam.position.clone().sub(grab.spot);
    const distance = toCam.length();
    toCam.divideScalar(distance);
    const normal = wheelNormal(grab.axis.clone().multiplyScalar(grab.side), toCam);
    const radius = wheelRadius(distance, cam.fov, vp.height, HANDLE.px, HANDLE.min, HANDLE.max);
    const perMetre = vp.height / (2 * distance * Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2));
    const centre = toPixel(cam, grab.spot, vp);
    const reach = Math.max(HANDLE.grabMin, radius * perMetre + 8) + (touch ? HANDLE.touch : 0);
    return { normal, radius, centre, reach, perMetre };
  }

  /** What a pointer at `p` would take hold of: the handle, else the group's own solid (unless something else is in front of it). */
  private pickGrab(p: PointerSample): { kind: 'handle' } | { kind: 'body'; point: THREE.Vector3 } | null {
    const grab = this.fold?.grab;
    if (!grab) return null;
    const vp = { width: p.width, height: p.height };
    const v = this.handleView(grab, vp, p.type === 'touch');
    if (v.centre && Math.hypot(p.x - v.centre.x, p.y - v.centre.y) <= v.reach) return { kind: 'handle' };
    // (the boxes are where the last frame drew them: that is what the pointer sees)
    const point = this.world.pickBody(pixelRay(this.engine.camera, p.x, p.y, vp), grab.group);
    return point ? { kind: 'body', point } : null;
  }

  private grabDown(p: PointerSample): boolean {
    const f = this.fold;
    const grab = f?.grab;
    if (this.mode !== 'fold' || !f || !grab || this.drag || this.world.animating || this.director) return false;
    const hit = this.pickGrab(p);
    if (!hit) return false;
    const cam = this.engine.camera;
    const vp = { width: p.width, height: p.height };
    const up = UP.clone().applyQuaternion(cam.quaternion);
    let tracker: AngleTracker;
    if (hit.kind === 'handle') {
      const v = this.handleView(grab, vp, p.type === 'touch');
      tracker = new AngleTracker(handleWheel(grab.spot, v.normal, grab.side), v.radius * HANDLE.hub, up);
    } else tracker = new AngleTracker(bodyWheel(grab.axis, grab.pivot, hit.point, cam.position.clone().sub(hit.point).normalize()), BODY_HUB, up);
    tracker.update(pixelRay(cam, p.x, p.y, vp)); // (the angle counts from where the press is)
    this.drag = { kind: hit.kind, tracker, x0: p.x, y0: p.y, live: false, angle: 0, near: REST, shown: 0, settling: false };
    return true;
  }

  private grabMove(p: PointerSample) {
    const f = this.fold;
    const d = this.drag;
    const grab = f?.grab;
    if (!f || !d || !grab || d.settling) return;
    const turn = d.tracker.update(pixelRay(this.engine.camera, p.x, p.y, { width: p.width, height: p.height }));
    if (!d.live) {
      if (Math.hypot(p.x - d.x0, p.y - d.y0) < (p.type === 'touch' ? DRAG_SLOP.touch : DRAG_SLOP.mouse)) return;
      d.live = true;
      this.world.beginDrag(grab.group, grab.axisName);
      this.showFoldRest();
    }
    d.angle = clampTo(turn, grab.range);
    d.shown = clampTo(d.angle, grab.reach);
    this.world.setDragAngle(d.shown);
    const near = nearestStop(d.angle, grab.angles);
    if (near === d.near) return;
    d.near = near;
    if (near === REST) this.showFoldRest();
    else {
      f.index = near;
      f.browsed.add(near);
      this.sound.select();
      this.showFoldOption(); // (the ghost, the preview lines and the panel follow the stop that is nearest)
    }
  }

  /** The pointer has let go. Near the pose it started in: nothing. At a free stop: the fold, from where the group is. At a blocked one: refused. */
  private grabUp() {
    const f = this.fold;
    const d = this.drag;
    const grab = f?.grab;
    if (!f || !d || !grab) return;
    if (!d.live) {
      this.drag = null; // (a press that did not move: nothing)
      return;
    }
    const r = releaseAt(d.angle, grab.angles, f.options.map((o) => o.blockedBy.length > 0));
    if (r.kind === 'move') return this.commit(f.options[r.index].action, d.shown);
    d.settling = true;
    if (r.kind === 'blocked') this.refuse(f.options[r.index]); // (the same denial as E on a blocked option: the panel already says what is in the way)
    this.showFoldOption();
    this.world.settleDrag(d.shown, { refused: r.kind === 'blocked', reduceMotion: this.settings.reduceMotion, durationScale: this.foldScale }, () => {
      this.drag = null;
    });
  }

  /** The pointer was taken away (a gesture, the window lost focus): the group goes back where it was, at once. */
  private grabCancel() {
    if (!this.drag) return;
    this.drag = null;
    this.world.endDrag();
    if (this.fold) this.showFoldOption();
  }

  /** A blocked option was chosen (E, or a drag let go of at it): the denial, and what the improvement loop is told. */
  private refuse(opt: FoldSession['options'][number]) {
    this.sound.denied();
    this.telemetry.log({
      type: 'action', section: this.section.id, console: this.fold!.console, action: actionKey(opt.action), ok: false,
      blockedBy: opt.blockedBy, cell: this.player.cell,
    });
  }

  /** The panel and the preview while the group is held near the pose it started in: no ghost, and a line that says letting go changes nothing. */
  private showFoldRest() {
    const f = this.fold!;
    this.world.preview(null, [], []);
    const g = this.cs.groups.get(this.cs.consoles.get(f.console)!.controls)!;
    this.hud.fold({
      title: g.label?.ja ?? g.id, index: f.index, count: f.options.length, label: '動かさない', blocked: null, fix: null, frees: [], opens: 0, closes: 0, rest: true,
    });
  }

  private setCursor(cursor: string) {
    if (cursor === this.cursor) return;
    this.cursor = cursor;
    this.engine.renderer.domElement.style.cursor = cursor;
  }

  /**
   * Every step of Fold Mode: the cursor over what can be taken hold of, and the wheel where the camera has put it, turned with
   * the group (and lit while it is under the pointer or in the hand).
   */
  private updateGrabView(dt: number) {
    const f = this.mode === 'fold' ? this.fold : null;
    const grab = f?.grab;
    if (!f || !grab) return this.setCursor('');
    const canvas = this.engine.renderer.domElement;
    const vp = { width: canvas.clientWidth || 1, height: canvas.clientHeight || 1 };
    const p = this.input.pointer;
    const over = !this.drag && !this.world.animating && p && p.type !== 'touch' && !this.input.locked ? (this.pickGrab(p)?.kind ?? null) : null;
    this.setCursor(this.drag?.live ? 'grabbing' : over ? 'grab' : '');
    const want = this.drag?.live || over === 'handle' ? 1 : over === 'body' ? 0.5 : 0;
    this.handleHot += (want - this.handleHot) * (1 - Math.exp(-dt * 14));
    const v = this.handleView(grab, vp, false);
    this.world.handle.place(
      {
        centre: grab.spot, normal: v.normal, up: UP.clone().applyQuaternion(this.engine.camera.quaternion), ref: grab.ref, radius: v.radius,
        spin: grab.side * this.world.dragTurn, range: grab.range, hot: this.handleHot,
      },
      this.time,
      this.settings.reduceMotion,
    );
  }

  /** Take the mouse lock back after Fold Mode (a key press is no gesture the browser accepts for this: the next click takes it if it refused). */
  private retakeLock() {
    this.input.requestLock();
    if (this.relockArmed) return;
    this.relockArmed = true;
    window.addEventListener('pointerdown', () => {
      this.relockArmed = false;
      if (this.mode === 'play') this.input.requestLock();
    }, { once: true });
  }

  private foldView() {
    const f = this.fold;
    const grab = f?.grab;
    if (!f || !grab || this.mode !== 'fold') return null;
    const canvas = this.engine.renderer.domElement;
    const vp = { width: canvas.clientWidth || 1, height: canvas.clientHeight || 1 };
    const v = this.handleView(grab, vp, false);
    const deg = (r: number) => (r * 180) / Math.PI;
    return {
      console: f.console, group: grab.group, index: f.index, angles: grab.angles.map(deg), range: { lo: deg(grab.range.lo), hi: deg(grab.range.hi) },
      reach: { lo: deg(grab.reach.lo), hi: deg(grab.reach.hi) },
      blocked: f.options.map((o) => o.blockedBy.length > 0),
      /** The camera has come to rest in the diorama (the handle stands still on screen from here). */
      arrived: this.rig.arrived,
      handle: v.centre ? { x: v.centre.x, y: v.centre.y, reach: v.reach, radiusPx: v.radius * v.perMetre } : null,
      drag: this.drag ? { live: this.drag.live, angle: deg(this.drag.angle), shown: deg(this.drag.shown), near: this.drag.near, settling: this.drag.settling, kind: this.drag.kind } : null,
      cursor: this.cursor,
      turn: deg(this.world.dragTurn),
      animating: this.world.animating,
    };
  }

  /** Screen point (CSS px) of the handle's rim, or of a point on the group, once the group has been turned by `turn` radians. */
  private grabPoint(kind: 'handle' | 'body', turn: number) {
    const grab = this.fold?.grab;
    if (!grab) return null;
    const canvas = this.engine.renderer.domElement;
    const vp = { width: canvas.clientWidth || 1, height: canvas.clientHeight || 1 };
    const cam = this.engine.camera;
    cam.updateMatrixWorld();
    if (kind === 'handle') {
      const v = this.handleView(grab, vp, false);
      const { e1, e2 } = planeBasis(v.normal, grab.ref);
      const psi = grab.side * turn; // (the wheel turns with the group, the same way when the handle is on the + end, the other way on the - end)
      return toPixel(cam, grab.spot.clone().addScaledVector(e1, Math.cos(psi) * v.radius * 0.88).addScaledVector(e2, Math.sin(psi) * v.radius * 0.88), vp);
    }
    // a point of the group the pointer can take hold of, found once (while the group is at rest) and then followed as it turns
    if (!this.bodyProbe) {
      this.engine.scene.updateMatrixWorld();
      const handle = this.handleView(grab, vp, false);
      for (const c of this.world.groupSamplePoints(grab.group)) {
        const px = toPixel(cam, c, vp);
        if (!px || px.x < 0 || px.y < 0 || px.x > vp.width || px.y > vp.height * 0.7) continue;
        if (handle.centre && Math.hypot(px.x - handle.centre.x, px.y - handle.centre.y) < handle.reach + 12) continue; // (that press would take the handle)
        this.bodyProbe = this.world.pickBody(pixelRay(cam, px.x, px.y, vp), grab.group);
        if (this.bodyProbe) break;
      }
    }
    return this.bodyProbe ? toPixel(cam, this.bodyProbe.clone().sub(grab.pivot).applyAxisAngle(grab.axis, turn).add(grab.pivot), vp) : null;
  }

  private closeFold(committed: boolean) {
    const f = this.fold;
    if (f) this.telemetry.log({ type: 'preview', section: this.section.id, console: f.console, browsed: f.browsed.size, committed });
    this.fold = null;
    this.drag = null;
    if (!committed) this.world.endDrag(); // (a fold that goes on from where the pointer let go of the group keeps what the drag set up)
    this.world.handle.show(false);
    this.setCursor('');
    this.world.preview(null, [], []);
    this.hud.fold(null);
    this.hud.holdHint(false);
    if (this.lockBeforeFold) {
      this.lockBeforeFold = false;
      this.retakeLock();
    }
    if (!committed) {
      this.rig.setFrame(null);
      this.rig.setDiorama(null);
      this.world.setGuidanceHidden(false);
      this.mode = 'play';
    }
  }

  /** `from`: the group has been turned by hand and let go of at this angle (radians about its axis): the fold goes on from there. */
  private commit(a: Action, from?: number) {
    const sec = this.section;
    this.endEstablish(false); // (a fold made without Fold Mode, from the debug hooks)
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
    const turn = (this.cs.motionOf(this.state, a).quarters * Math.PI) / 2;
    const share = from === undefined ? 1 : Math.min(1, Math.abs(turn - from) / Math.abs(turn)); // (the rumble is as long as what is left of the turn)
    this.sound.fold(((g.durationMs ?? 2000) / 1000) * scale * share);
    this.world.highlightConsole(null);
    this.hud.hint(null);
    this.frameFold(a, from !== undefined);
    const reduceMotion = this.settings.reduceMotion;
    this.world.startAction(a, scale, ({ joined }) => {
      this.state = this.world.state;
      this.mode = 'play';
      this.rig.setFrame(null);
      this.rig.setDiorama(null);
      this.world.setGuidanceHidden(false);
      this.sound.joined(joined); // one note, a step higher each, for every path the fold joined
      const left = remainingActions(this.cs, sec.id, this.state, this.player.cell);
      if (left !== null && left < this.run.remaining) {
        // the goal came closer: the hint clock starts over
        this.run.lastProgress = this.time;
        this.run.hintTier = 0;
      } else this.run.hintStale = true;
      if (left !== null) this.run.remaining = left;
      else this.hud.hint('ここからは先に進めないようです。<kbd>R</kbd> でこのパズルをやり直せます。');
    }, { reduceMotion, onStop: () => this.sound.thud(reduceMotion), from });
  }

  /**
   * Camera for the fold itself: the diorama of Fold Mode stays (FOLD_CAMERA), or else a view of the moving part. Turns about
   * the vertical stay framed from above. A tipping motion is watched so the swing happens in the picture instead of towards
   * the lens: something hinged at one end (the street) from behind its hinge, looking the way it will lie, like a drawbridge
   * seen from its gate; something turning about its middle (the cube) along its axis, from whichever side has the clearer view.
   */
  private frameFold(a: Action, byHand = false) {
    // (a fold the player has already turned most of the way by hand has a few tenths of a second left: the view they were watching it in stays)
    if (byHand || (this.foldCameras[a.group] ?? 'diorama') === 'diorama') return this.rig.setDiorama(this.dioramaOf('fold')); // Fold Mode's view stays
    this.rig.setDiorama(null);
    const target = this.cs.apply(this.state, a);
    const fr = this.world.framing(a.group, [this.state, target], this.player.pos);
    const motion = this.cs.motionOf(this.state, a);
    if (motion.axis === 'y') return this.rig.setFrame(fr.center, fr.radius, this.player.pos);
    const r = fr.radius * (this.engine.camera.aspect < 1 ? 1.45 : 1); // a tall frame shows less to the sides
    const pivot = new THREE.Vector3(...motion.pivot);
    const lie = this.world.groupCentre(a.group, target).sub(pivot).setY(0);
    const height = Math.max(this.player.pos.y + 6, fr.center.y + r * 0.55 + 4);
    let shots: THREE.Vector3[];
    if (lie.length() > fr.radius * 0.5) {
      const behind = lie.normalize().negate();
      shots = [pivot.clone().addScaledVector(behind, r * 1.5).setY(Math.max(height, pivot.y + r * 1.1 + 4))];
    } else {
      const hinge = motion.axis === 'x' ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 0, 1);
      const towardsPlayer = this.player.pos.clone().sub(fr.center).setY(0).normalize();
      shots = [hinge, hinge.clone().negate()].map((h) => {
        // a quarter profile turned away from the player, so the avatar does not stand in the middle of the shot
        const dir = [0.38, -0.38].map((t) => h.clone().applyAxisAngle(UP, t)).sort((p, q) => p.dot(towardsPlayer) - q.dot(towardsPlayer))[0];
        return fr.center.clone().addScaledVector(dir, r * 2).setY(height);
      });
    }
    this.rig.setFrame(fr.center, fr.radius, this.player.pos, this.rig.clearestShot(fr.center, shots));
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
    this.endEstablish(true);
    this.rig.snapBehind(this.player.root.rotation.y);
    this.hud.flash();
    this.run.resets++;
    // starting over is not progress: the hint clock keeps running, and a shown hint points at the first step again
    this.run.remaining = this.run.optimal;
    this.run.hintStale = true;
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
      this.sound.passage();
      this.world.crossExit(this.player.cell); // the exit's mark flares as it is crossed
      this.enterSection(this.sectionIndex + 1, true);
    } else this.startFinale();
  }

  private startFinale() {
    this.mode = 'finale';
    this.finaleClock = 0;
    this.showIntro = null;
    this.endEstablish(true);
    const gate = new THREE.Vector3(...cellFloor(this.cs.stage.goal.at));
    this.rig.setCinematic(gate.clone().add(new THREE.Vector3(26, 22, 30)), gate.clone().add(new THREE.Vector3(0, 6, 0)));
    this.world.setGuidanceHidden(true);
    this.world.openGate();
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
    document.exitPointerLock?.(); // the dialog is clicked with the mouse: it must not be captured by a lock that is still on
    this.hud.pause(true, this.settings, (s) => this.applySettings(s), () => {
      this.hud.pause(false);
      this.mode = this.resumeMode;
      this.input.requestLock();
      // Escape is not a user gesture, so the browser may refuse the lock: take it on the next click instead
      if (!this.automated)
        window.addEventListener('pointerdown', () => this.mode === 'play' && this.input.requestLock(), { once: true }); // (play only: a press on Fold Mode's handle must not take the cursor away)
    }, 'pause', this.autoChoice);
  }

  private applySettings(s: Settings) {
    this.settings = s;
    this.telemetry.enabled = s.telemetry && this.telemetryAllowed;
    this.sound.setMuted(s.muted);
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ...s, v: SETTINGS_VERSION }));
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
      /** The tier in use, the setting, and what auto knew and did (the GPU string, its guess, the measured median, the tier it chose). */
      quality: () => ({ quality: this.engine.quality, setting: this.settings.quality, scale: this.engine.renderScale, ...this.autoInfo }),
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
      /** Which camera a group's fold gets: the 'diorama' (default) or the purpose-made 'view'. */
      foldCamera: (group: string, kind: 'diorama' | 'view') => (this.foldCameras[group] = kind),
      /** The establishing view is running. */
      establishing: () => !!this.establish,
      diorama: (use: 'intro' | 'fold') => this.dioramaOf(use),
      /** What Fold Mode's drag shows now (null when Fold Mode is closed): where the handle is on screen, the stops, the turn. */
      foldView: () => this.foldView(),
      /** The screen point (CSS px) of the handle's rim, or of a point of the group, after the group has been turned by `deg` degrees. */
      grabPoint: (kind: 'handle' | 'body', deg: number) => this.grabPoint(kind, (deg * Math.PI) / 180),
      /** What a press at this screen point (CSS px) would take hold of: 'handle', 'body' or null. */
      pickAt: (x: number, y: number) => {
        this.engine.scene.updateMatrixWorld();
        const c = this.engine.renderer.domElement;
        return this.fold?.grab ? (this.pickGrab({ id: 0, type: 'mouse', x, y, width: c.clientWidth || 1, height: c.clientHeight || 1 })?.kind ?? null) : null;
      },
      /** Put the game in a section in a state, as a player walks into it (`stageShot` does it for the review shots, in a mode of its own). */
      scene: (index: number, state: Record<string, number>) => {
        this.state = state;
        this.world.setState(state, false);
        this.enterSection(index, false);
        this.mode = 'play';
        this.rig.setDiorama(null);
      },
      press: (code: string) => this.input.press(code),
      hold: (code: string, on: boolean) => this.input.hold(code, on),
      setYaw: (y: number) => (this.rig.yaw = y),
      /** Advance the simulation without rendering (fast, deterministic playtests). */
      simulate: (seconds: number, held: string[] = []) => {
        for (const k of held) this.input.hold(k, true);
        for (let t = 0; t < seconds; t += 1 / 60) this.step(1 / 60);
        for (const k of held) this.input.hold(k, false);
        // the wall-clock time this took is not game time: without this the frame loop would pay it back afterwards
        this.last = performance.now();
        this.stepper.reset();
        return { cell: this.player.cell, x: this.player.pos.x, z: this.player.pos.z, mode: this.mode, section: this.section.id };
      },
    };
  }
}

function round1(x: number) {
  return Math.round(x * 10) / 10;
}

/** `shots` (review mode) renders at quality high unless the URL says `q=`. */
function loadSettings(shots = false): Settings {
  const d: Settings = { sensitivity: 1, invertY: false, reduceMotion: false, quality: 'auto', telemetry: defaultConsent(), muted: false };
  let s = d;
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) {
      const { v, ...stored } = JSON.parse(raw) as Partial<Settings> & { v?: number };
      // (before version 2 the quality was stored with every other setting whether or not the player had chosen it: it is auto's to pick)
      if (v !== SETTINGS_VERSION) delete stored.quality;
      s = { ...d, ...stored };
    }
  } catch {
    /* ignore */
  }
  if (!isQualitySetting(s.quality)) s = { ...s, quality: 'auto' };
  const q = new URLSearchParams(location.search).get('q');
  if (isQualitySetting(q)) s = { ...s, quality: q };
  else if (shots) s = { ...s, quality: 'high' };
  return s;
}
