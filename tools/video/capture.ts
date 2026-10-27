// `npm run video:capture -- video/demo.yaml`: records the demo playback frame by frame and encodes it with ffmpeg.
// Every frame advances the game by exactly 1/fps, so the video is smooth at any size however slowly it renders.
// Next to the video it writes `<name>.cues.json`: when each puzzle starts and each fold happens, for editing.
// Needs the game running (`npm run build && npm run preview`, or `url:` pointing at the deployed site),
// Playwright's Chromium (`npx playwright install chromium`) and ffmpeg.
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { chromium } from 'playwright';
import { parse } from 'yaml';

interface CaptureConfig {
  url: string;
  out: string;
  size: [number, number];
  fps: number;
  quality: 'low' | 'medium' | 'high';
  hud: boolean;
  /** CSS pixels → video pixels. The UI is laid out at size / uiScale, like a phone (360 wide) or a laptop (1280 wide). */
  uiScale?: number;
  crf: number; // x264 quality: lower is better and bigger (18 is visually lossless)
  maxSeconds: number;
  demo: Partial<Record<'title' | 'establish' | 'browse' | 'hold' | 'end', number>>;
}

const DEFAULTS: CaptureConfig = {
  url: 'http://localhost:4173/',
  out: 'video/out/demo.mp4',
  size: [1080, 1920],
  fps: 30,
  quality: 'high',
  hud: true,
  crf: 18,
  maxSeconds: 180,
  demo: {},
};

// The page side of the capture (src/main.ts). Functions passed to page.evaluate run in the browser,
// so each one reaches it through `window` itself.
type Page = Window & { __capture?: { ready(): boolean; advance(dt: number): { done: boolean; t: number }; cues(): unknown[] } };

const file = process.argv[2] ?? 'video/demo.yaml';
const cfg: CaptureConfig = { ...DEFAULTS, ...(parse(readFileSync(file, 'utf8')) as Partial<CaptureConfig>) };
const [width, height] = cfg.size;
const uiScale = cfg.uiScale ?? (width < height ? width / 360 : height / 720);
const url = new URL(cfg.url);
url.searchParams.set('demo', '1');
url.searchParams.set('capture', '1');
url.searchParams.set('q', cfg.quality);
if (!cfg.hud) url.searchParams.set('hud', '0');
for (const [k, v] of Object.entries(cfg.demo)) url.searchParams.set(k, String(v));

const browser = await chromium.launch({
  // Linux containers have no GPU: SwiftShader renders the same image, only slower. macOS uses the GPU.
  args: process.platform === 'linux' ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] : [],
});
const page = await browser.newPage({
  viewport: { width: Math.round(width / uiScale), height: Math.round(height / uiScale) },
  deviceScaleFactor: uiScale,
});
page.on('pageerror', (e) => console.error(`page error: ${e.message}`));
await page.goto(url.href, { waitUntil: 'load' });
await page.waitForFunction(() => (window as Page).__capture?.ready(), null, { timeout: 120_000 });

mkdirSync(dirname(cfg.out), { recursive: true });
const ffmpeg = spawn(
  'ffmpeg',
  [
    '-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(cfg.fps), '-c:v', 'mjpeg', '-i', '-',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', String(cfg.crf), '-preset', 'medium', '-movflags', '+faststart', cfg.out,
  ],
  { stdio: ['pipe', 'inherit', 'inherit'] },
);
const encoded = new Promise<number>((resolve) => ffmpeg.on('close', (code) => resolve(code ?? 1)));

const started = Date.now();
let frames = 0;
let done = false;
while (!done && frames < cfg.maxSeconds * cfg.fps) {
  done = (await page.evaluate((dt) => (window as Page).__capture!.advance(dt), 1 / cfg.fps)).done;
  const jpeg = await page.screenshot({ type: 'jpeg', quality: 92 });
  if (!ffmpeg.stdin.write(jpeg)) await new Promise((r) => ffmpeg.stdin.once('drain', r));
  frames++;
  if (frames % (cfg.fps * 10) === 0) {
    const perFrame = (Date.now() - started) / frames / 1000;
    console.log(`${(frames / cfg.fps).toFixed(0)} s of video, ${perFrame.toFixed(2)} s per frame`);
  }
}
ffmpeg.stdin.end();
const cues = await page.evaluate(() => (window as Page).__capture!.cues());
await browser.close();
if ((await encoded) !== 0) throw new Error('ffmpeg failed');
const cueFile = cfg.out.replace(/\.\w+$/, '.cues.json');
writeFileSync(cueFile, `${JSON.stringify({ fps: cfg.fps, size: cfg.size, seconds: frames / cfg.fps, cues }, null, 2)}\n`);
console.log(`${cfg.out}: ${(frames / cfg.fps).toFixed(1)} s (${frames} frames) in ${((Date.now() - started) / 60000).toFixed(1)} min${done ? '' : ', stopped at maxSeconds'}`);
console.log(`${cueFile}: ${cues.length} cues`);
