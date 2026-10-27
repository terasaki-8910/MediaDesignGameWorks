// Client side of the play log: queue events, batch them, and send with sendBeacon when leaving.
import type { ClientInfo, TelemetryBatch, TelemetryEvent } from '../core/telemetry.ts';

type Payload = TelemetryEvent extends infer E ? (E extends unknown ? Omit<E, 't'> : never) : never;

export class Telemetry {
  readonly session: string;
  enabled: boolean;
  private seq = 0;
  private queue: TelemetryEvent[] = [];
  private t0 = performance.now();
  private lastFlush = performance.now();
  private samples: [number, string][] = [];
  private lastCell = '';
  private lastSample = 0;
  private readonly endpoint: string;
  private readonly playtest: boolean;

  constructor(endpoint: string, enabled: boolean, playtest: boolean) {
    this.endpoint = endpoint;
    this.enabled = enabled;
    this.playtest = playtest;
    this.session = crypto.randomUUID?.() ?? fallbackUuid();
    window.addEventListener('pagehide', () => this.flush(true));
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') this.flush(true);
    });
  }

  now() {
    return Math.round(performance.now() - this.t0);
  }

  log(e: Payload) {
    if (!this.enabled) return;
    this.queue.push({ ...e, t: this.now() } as TelemetryEvent);
    if (this.queue.length > 300) this.flush();
  }

  /** Coarse position trail: at most one sample every 2 s, only when the cell changed. */
  samplePosition(cell: string) {
    const t = this.now();
    if (t - this.lastSample < 2000 || cell === this.lastCell) return;
    this.lastSample = t;
    this.lastCell = cell;
    this.samples.push([t, cell]);
  }

  /** Send every 3 minutes at most: each batch is one Blob write, and the Hobby plan allows 2,000 a month. */
  tick() {
    if (performance.now() - this.lastFlush > 180000) this.flush();
  }

  flush(beacon = false) {
    if (!this.enabled) return;
    if (this.samples.length) {
      this.queue.push({ t: this.now(), type: 'pos', samples: this.samples });
      this.samples = [];
    }
    if (!this.queue.length) return;
    const batch: TelemetryBatch = { v: 1, session: this.session, seq: this.seq++, playtest: this.playtest, events: this.queue };
    this.queue = [];
    this.lastFlush = performance.now();
    const body = JSON.stringify(batch);
    try {
      if (beacon && navigator.sendBeacon) {
        navigator.sendBeacon(this.endpoint, new Blob([body], { type: 'application/json' }));
      } else {
        fetch(this.endpoint, { method: 'POST', body, keepalive: true, headers: { 'content-type': 'application/json' } }).catch(() => {});
      }
    } catch {
      /* telemetry must never break the game */
    }
  }
}

export function clientInfo(renderer: { getContext(): WebGLRenderingContext | WebGL2RenderingContext }): ClientInfo {
  const ua = navigator.userAgent;
  const browser = /Edg\//.test(ua) ? 'edge' : /Chrome\//.test(ua) ? 'chrome' : /Firefox\//.test(ua) ? 'firefox' : /Safari\//.test(ua) ? 'safari' : 'other';
  const os = /Mac OS X/.test(ua) ? 'mac' : /Windows/.test(ua) ? 'windows' : /Linux/.test(ua) ? 'linux' : 'other';
  let gpuTier = 'unknown';
  try {
    const gl = renderer.getContext();
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const name = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : '';
    gpuTier = /Apple M\d|RTX|Radeon RX|Arc A/.test(name) ? 'high' : /Intel|Iris|UHD|SwiftShader|llvmpipe/.test(name) ? 'low' : name ? 'mid' : 'unknown';
  } catch {
    /* ignore */
  }
  const w = window.screen.width;
  const screen = w >= 2500 ? 'xl' : w >= 1800 ? 'l' : w >= 1300 ? 'm' : 's';
  return { browser, os, lang: (navigator.language || 'ja').slice(0, 5).replace(/[^\w-]/g, ''), screen, gpuTier };
}

function fallbackUuid() {
  const h = [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

/** Whether to collect by default: off when the browser signals a privacy preference. */
export function defaultConsent(): boolean {
  const nav = navigator as Navigator & { globalPrivacyControl?: boolean; doNotTrack?: string };
  return !(nav.globalPrivacyControl === true || nav.doNotTrack === '1');
}
