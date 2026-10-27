import './styles.css';
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
const isTouchOnly = matchMedia('(pointer: coarse)').matches && !matchMedia('(pointer: fine)').matches;

if (isTouchOnly) {
  new Hud(hudRoot).mobileNotice(hudRoot);
} else {
  const game = new Game(canvas, hudRoot, {
    stage: area1 as unknown as StageFile,
    tunables: tunables as Tunables,
    revision,
    build: __BUILD__,
  });
  if (new URLSearchParams(location.search).has('debug')) (window as unknown as { __fold: unknown }).__fold = game.debugApi();
}
