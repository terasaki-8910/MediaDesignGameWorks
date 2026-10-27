// Virtual time for frame-by-frame capture (?capture=1): page timers and CSS transitions follow the simulation
// instead of the wall clock, so a frame that takes a second to render still shows exactly 1/30 s of change.
export class VirtualClock {
  now = 0; // seconds
  private timers = new Map<number, { at: number; fn: () => void }>();
  private nextId = 1;
  private started = new WeakMap<Animation, number>();

  install() {
    const w = window as unknown as Record<string, unknown>;
    w.setTimeout = (fn: TimerHandler, ms = 0, ...args: unknown[]) => {
      const id = this.nextId++;
      this.timers.set(id, { at: this.now + ms / 1000, fn: () => typeof fn === 'function' && fn(...args) });
      return id;
    };
    w.clearTimeout = (id?: number) => id !== undefined && this.timers.delete(id);
    w.requestIdleCallback = (fn: IdleRequestCallback) =>
      (w.setTimeout as typeof setTimeout)(() => fn({ didTimeout: false, timeRemaining: () => 50 }), 1);
  }

  advance(dt: number) {
    this.now += dt;
    for (;;) {
      let due: [number, { at: number; fn: () => void }] | null = null;
      for (const e of this.timers) if (e[1].at <= this.now && (!due || e[1].at < due[1].at)) due = e;
      if (!due) break;
      this.timers.delete(due[0]);
      due[1].fn();
    }
    for (const a of document.getAnimations()) {
      if (!this.started.has(a)) {
        this.started.set(a, this.now - dt);
        a.pause();
      }
      const t = (this.now - this.started.get(a)!) * 1000;
      const end = Number(a.effect?.getComputedTiming().endTime ?? 0);
      if (t >= end) a.finish();
      else a.currentTime = t;
    }
  }
}
