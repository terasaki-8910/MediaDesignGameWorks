import './styles.css';
import { VirtualClock } from './game/clock.ts';
import { DEMO_DEFAULTS, type DemoOptions } from './game/demo.ts';
import { Game } from './game/game.ts';
import { Hud } from './game/hud.ts';
import revision from './revision.json';
import area1 from './stages/area1.json';
import tunables from './stages/tunables.json';
import type { Tunables } from './core/tunables.ts';
import type { StageFile } from './core/types.ts';

declare const __BUILD__: string;

const canvas = document.getElementById('game') as HTMLCanvasElement;
const hudRoot = document.getElementById('hud')!;
const params = new URLSearchParams(location.search);
const isTouchOnly = matchMedia('(pointer: coarse)').matches && !matchMedia('(pointer: fine)').matches;

// ?demo=1 plays by itself (timings: &title= &establish= &browse= &hold= &end= in seconds);
// ?capture=1 additionally hands the clock to tools/video/capture.ts; ?hud=0 hides the on-screen UI.
const capture = params.has('capture');
const clock = capture ? new VirtualClock() : null;
clock?.install();
const sec = (name: string, fallback: number) => {
  const v = Number(params.get(name));
  return params.has(name) && Number.isFinite(v) ? v : fallback;
};
const demo: DemoOptions | undefined =
  params.has('demo') || capture
    ? {
        titleSec: sec('title', DEMO_DEFAULTS.titleSec),
        establishSec: sec('establish', DEMO_DEFAULTS.establishSec),
        browseSec: sec('browse', DEMO_DEFAULTS.browseSec),
        holdSec: sec('hold', DEMO_DEFAULTS.holdSec),
        endSec: sec('end', DEMO_DEFAULTS.endSec),
      }
    : undefined;

if (isTouchOnly && !demo) {
  new Hud(hudRoot).mobileNotice(hudRoot);
} else {
  const game = new Game(
    canvas,
    hudRoot,
    { stage: area1 as unknown as StageFile, tunables: tunables as Tunables, revision, build: __BUILD__ },
    { demo, capture },
  );
  if (demo) document.body.classList.add('demo');
  if (params.get('hud') === '0') hudRoot.style.display = 'none';
  if (params.has('debug')) (window as unknown as { __fold: unknown }).__fold = game.debugApi();
  if (clock)
    (window as unknown as { __capture: unknown }).__capture = {
      ready: () => game.ready,
      advance: (dt: number, render = true) => {
        clock.advance(dt);
        game.advance(dt, render);
        return { done: game.director!.done, t: clock.now };
      },
      cues: () => game.director!.cues,
    };
}
