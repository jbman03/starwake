import type { Settings } from '../save/settings';

export type Sfx = 'thrust' | 'jump' | 'arrive' | 'land' | 'takeoff' | 'trade' | 'paid' | 'hail' | 'site';

/** One pitched voice: slides from `f0` to `f1` over `dur` seconds, starting `at` seconds from now. */
interface Tone {
  f0: number;
  f1?: number;
  dur: number;
  wave?: OscillatorType;
  gain: number;
  at?: number;
}
/** A burst of filtered noise; the low-pass cutoff sweeps from `c0` to `c1`. */
interface Burst {
  dur: number;
  c0: number;
  c1?: number;
  gain: number;
  at?: number;
}

const HUM_GAIN = 0.12;
const HUM_RAMP_SEC = 0.1;

const RECIPES: Record<Exclude<Sfx, 'thrust'>, { tones?: Tone[]; bursts?: Burst[] }> = {
  jump: {
    tones: [{ f0: 120, f1: 1400, dur: 0.9, wave: 'sawtooth', gain: 0.18 }],
    bursts: [{ dur: 0.9, c0: 300, c1: 4000, gain: 0.25 }],
  },
  arrive: {
    tones: [{ f0: 1200, f1: 180, dur: 0.7, wave: 'sawtooth', gain: 0.15 }],
    bursts: [{ dur: 0.5, c0: 3500, c1: 300, gain: 0.25 }],
  },
  land: {
    tones: [{ f0: 160, f1: 60, dur: 0.5, wave: 'sine', gain: 0.35 }],
    bursts: [{ dur: 0.35, c0: 500, c1: 150, gain: 0.3 }],
  },
  takeoff: {
    tones: [{ f0: 70, f1: 220, dur: 0.6, wave: 'triangle', gain: 0.25 }],
    bursts: [{ dur: 0.6, c0: 200, c1: 1500, gain: 0.25 }],
  },
  trade: {
    tones: [
      { f0: 880, dur: 0.08, wave: 'square', gain: 0.08 },
      { f0: 1320, dur: 0.12, wave: 'square', gain: 0.08, at: 0.07 },
    ],
  },
  paid: {
    tones: [
      { f0: 523, dur: 0.12, wave: 'triangle', gain: 0.18 },
      { f0: 659, dur: 0.12, wave: 'triangle', gain: 0.18, at: 0.1 },
      { f0: 784, dur: 0.12, wave: 'triangle', gain: 0.18, at: 0.2 },
      { f0: 1047, dur: 0.3, wave: 'triangle', gain: 0.18, at: 0.3 },
    ],
  },
  hail: {
    tones: [
      { f0: 700, dur: 0.15, wave: 'sine', gain: 0.2 },
      { f0: 700, dur: 0.15, wave: 'sine', gain: 0.2, at: 0.25 },
    ],
  },
  site: {
    tones: [{ f0: 300, f1: 900, dur: 0.5, wave: 'sine', gain: 0.18 }],
  },
};

function defaultContext(): AudioContext {
  const w = window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext };
  const C = w.AudioContext ?? w.webkitAudioContext;
  if (!C) throw new Error('Web Audio is unavailable');
  return new C();
}

/**
 * Synthesised sound effects: oscillators, noise buffers and gain envelopes, no audio files.
 * Independent of Phaser. The AudioContext is made on `unlock` (a user gesture); volume and mute
 * are read from the live settings on every call.
 */
export class SoundBoard {
  private ctx: AudioContext | null = null;
  private noise: AudioBuffer | null = null;
  private hum: { gain: GainNode } | null = null;
  private humLevel = 0;

  constructor(
    private getSettings: () => Settings,
    private ctxFactory: () => AudioContext = defaultContext,
  ) {}

  muted(): boolean {
    return this.getSettings().muted;
  }

  /** Make (or wake) the audio context. Call from a pointerdown or keydown handler. */
  unlock(): void {
    try {
      this.ctx ??= this.ctxFactory();
      this.wake(this.ctx);
    } catch {
      this.ctx = null; // no audio on this device: every call stays a no-op
    }
  }

  /** Whether the context exists and is running (a gesture has really unlocked audio). */
  running(): boolean {
    return this.ctx?.state === 'running';
  }

  /** Ask a suspended context to resume; the caller drops its sound meanwhile. */
  private wake(ctx: AudioContext): void {
    if (ctx.state === 'running') return;
    try {
      void Promise.resolve(ctx.resume()).catch(() => undefined);
    } catch {
      // ignore
    }
  }

  private level(): number {
    const s = this.getSettings();
    return s.muted ? 0 : Math.min(1, Math.max(0, s.volume));
  }

  play(s: Sfx): void {
    if (s === 'thrust') return; // the hum follows setThrust, never a one-shot
    const ctx = this.ctx;
    const vol = this.level();
    if (!ctx || vol <= 0) return;
    if (ctx.state !== 'running') return this.wake(ctx); // dropped, not queued
    try {
      const r = RECIPES[s];
      for (const t of r.tones ?? []) this.tone(ctx, t, vol);
      for (const b of r.bursts ?? []) this.burst(ctx, b, vol);
    } catch {
      // a failing audio node must never break the game
    }
  }

  private envelope(ctx: AudioContext, peak: number, at: number, dur: number): GainNode {
    const g = ctx.createGain();
    const t = ctx.currentTime + at;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + Math.min(0.02, dur / 4));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    g.connect(ctx.destination);
    return g;
  }

  private tone(ctx: AudioContext, t: Tone, vol: number): void {
    const at = t.at ?? 0;
    const o = ctx.createOscillator();
    o.type = t.wave ?? 'sine';
    const start = ctx.currentTime + at;
    o.frequency.setValueAtTime(t.f0, start);
    if (t.f1 !== undefined) o.frequency.exponentialRampToValueAtTime(t.f1, start + t.dur);
    o.connect(this.envelope(ctx, t.gain * vol, at, t.dur));
    o.start(start);
    o.stop(start + t.dur + 0.05);
  }

  private noiseBuffer(ctx: AudioContext): AudioBuffer {
    if (this.noise) return this.noise;
    const len = Math.max(1, Math.floor(ctx.sampleRate));
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    let seed = 12345; // fixed LCG: the same hiss every run
    for (let i = 0; i < len; i++) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      data[i] = seed / 0x80000000 - 1;
    }
    return (this.noise = buf);
  }

  private burst(ctx: AudioContext, b: Burst, vol: number): void {
    const at = b.at ?? 0;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer(ctx);
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    const start = ctx.currentTime + at;
    f.frequency.setValueAtTime(b.c0, start);
    if (b.c1 !== undefined) f.frequency.exponentialRampToValueAtTime(b.c1, start + b.dur);
    src.connect(f);
    f.connect(this.envelope(ctx, b.gain * vol, at, b.dur));
    src.start(start);
    src.stop(start + b.dur + 0.05);
  }

  /** Engine hum: low-passed looping noise whose gain ramps over 0.1 s. Silent when muted or not unlocked. */
  setThrust(on: boolean): void {
    const ctx = this.ctx;
    if (!ctx) return;
    if (ctx.state !== 'running') {
      if (on) this.wake(ctx);
      return;
    }
    const target = on ? HUM_GAIN * this.level() : 0;
    if (target === this.humLevel) return;
    try {
      if (!this.hum) {
        if (target === 0) return;
        const src = ctx.createBufferSource();
        src.buffer = this.noiseBuffer(ctx);
        src.loop = true;
        const f = ctx.createBiquadFilter();
        f.type = 'lowpass';
        f.frequency.setValueAtTime(240, ctx.currentTime);
        const gain = ctx.createGain();
        gain.gain.setValueAtTime(0, ctx.currentTime);
        src.connect(f);
        f.connect(gain);
        gain.connect(ctx.destination);
        src.start();
        this.hum = { gain };
      }
      const now = ctx.currentTime;
      const p = this.hum.gain.gain;
      p.cancelScheduledValues(now);
      p.setValueAtTime(this.humLevel, now);
      p.linearRampToValueAtTime(target, now + HUM_RAMP_SEC);
      this.humLevel = target;
    } catch {
      // ignore audio failures
    }
  }
}
