// Small synthesised soundscape (no audio files): ambient drone, fold rumble, UI blips and a clear chime.
export class Sound {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  muted = false;

  start() {
    if (this.ctx) return;
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0.55;
    this.master.connect(ctx.destination);
    // drone: two detuned saws through a slow low-pass
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 380;
    const g = ctx.createGain();
    g.gain.value = 0.05;
    lp.connect(g).connect(this.master);
    for (const f of [55, 82.4, 110.3]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f;
      o.detune.value = (Math.random() - 0.5) * 14;
      o.connect(lp);
      o.start();
    }
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.05;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 160;
    lfo.connect(lfoGain).connect(lp.frequency);
    lfo.start();
    // wind
    const wind = this.noise(4);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 600;
    bp.Q.value = 0.6;
    const wg = ctx.createGain();
    wg.gain.value = 0.035;
    wind.loop = true;
    wind.connect(bp).connect(wg).connect(this.master);
    wind.start();
  }

  setMuted(m: boolean) {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : 0.55;
  }

  private noise(seconds: number): AudioBufferSourceNode {
    const ctx = this.ctx!;
    const buf = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < d.length; i++) {
      last = last * 0.97 + (Math.random() * 2 - 1) * 0.03;
      d[i] = last * 6;
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    return src;
  }

  private tone(freq: number, dur: number, type: OscillatorType, vol: number, when = 0, glide?: number) {
    if (!this.ctx || !this.master) return;
    const t = this.ctx.currentTime + when;
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (glide) o.frequency.exponentialRampToValueAtTime(glide, t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  select() {
    this.tone(880, 0.12, 'sine', 0.08);
  }

  denied() {
    this.tone(160, 0.25, 'square', 0.05, 0, 110);
  }

  open() {
    this.tone(523, 0.2, 'triangle', 0.08);
    this.tone(784, 0.3, 'triangle', 0.06, 0.08);
  }

  fold(seconds: number) {
    if (!this.ctx || !this.master) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const n = this.noise(Math.max(1, seconds + 0.6));
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(90, t);
    lp.frequency.linearRampToValueAtTime(260, t + seconds * 0.6);
    lp.frequency.linearRampToValueAtTime(80, t + seconds + 0.5);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.5, t + 0.25);
    g.gain.exponentialRampToValueAtTime(0.0001, t + seconds + 0.6);
    n.connect(lp).connect(g).connect(this.master);
    n.start(t);
    this.tone(55, seconds + 0.5, 'sine', 0.18, 0, 41);
    this.tone(1320, 0.6, 'sine', 0.04, 0.05, 1500);
    this.tone(196, 1.2, 'triangle', 0.07, seconds, 196);
    this.tone(392, 1.0, 'sine', 0.05, seconds + 0.05);
  }

  chime() {
    [523, 659, 784, 1047, 1319].forEach((f, i) => this.tone(f, 1.4, 'sine', 0.07, i * 0.12));
  }
}
