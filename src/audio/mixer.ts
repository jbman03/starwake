import type { Settings } from '../save/settings';

/** Seconds a gain change takes, so a slider drag or the V key never clicks. */
const RAMP_SEC = 0.05;

function defaultContext(): AudioContext {
  const w = window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext };
  const C = w.AudioContext ?? w.webkitAudioContext;
  if (!C) throw new Error('Web Audio is unavailable');
  return new C();
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/**
 * Owns the AudioContext and the bus graph: music and effects buses into a master into the speakers.
 * The context is made on `unlock` (a user gesture). Every call is a silent no-op when audio is
 * unavailable; nothing here may break the game.
 */
export class Mixer {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private music: GainNode | null = null;
  private sfx: GainNode | null = null;
  private hidden = false;

  constructor(
    private getSettings: () => Settings,
    private ctxFactory: () => AudioContext = defaultContext,
  ) {}

  /** Make the context and buses (once), and wake a suspended context. Call from a gesture handler. */
  unlock(): void {
    try {
      if (!this.ctx) {
        const ctx = this.ctxFactory();
        const master = ctx.createGain();
        const music = ctx.createGain();
        const sfx = ctx.createGain();
        music.connect(master);
        sfx.connect(master);
        master.connect(ctx.destination);
        this.ctx = ctx;
        this.master = master;
        this.music = music;
        this.sfx = sfx;
        this.apply();
      }
      if (!this.hidden) this.wake(this.ctx);
    } catch {
      this.ctx = this.master = this.music = this.sfx = null; // no audio here: every call stays a no-op
    }
  }

  /** Whether the context exists and is running (a gesture has really unlocked audio). */
  running(): boolean {
    return this.ctx?.state === 'running';
  }

  context(): AudioContext | null {
    return this.ctx;
  }

  sfxBus(): GainNode | null {
    return this.sfx;
  }

  musicBus(): GainNode | null {
    return this.music;
  }

  /** Ramp the master, music and effects gains to the current settings. Call whenever settings change. */
  apply(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const s = this.getSettings();
    try {
      this.ramp(this.master, 1);
      this.ramp(this.music, s.muted ? 0 : clamp01(s.musicVolume));
      this.ramp(this.sfx, s.muted ? 0 : clamp01(s.sfxVolume));
    } catch {
      // ignore audio failures
    }
  }

  /** Suspend the context while the page is hidden and resume it when it is shown again. */
  setHidden(hidden: boolean): void {
    this.hidden = hidden;
    const ctx = this.ctx;
    if (!ctx) return;
    try {
      if (hidden) void Promise.resolve(ctx.suspend()).catch(() => undefined);
      else this.wake(ctx);
    } catch {
      // ignore
    }
  }

  private ramp(node: GainNode | null, target: number): void {
    if (!node || !this.ctx) return;
    const p = node.gain;
    const now = this.ctx.currentTime;
    p.cancelScheduledValues(now);
    p.setValueAtTime(p.value, now);
    p.linearRampToValueAtTime(target, now + RAMP_SEC);
  }

  private wake(ctx: AudioContext): void {
    if (ctx.state === 'running') return;
    try {
      void Promise.resolve(ctx.resume()).catch(() => undefined);
    } catch {
      // ignore
    }
  }

  /** Ask a suspended context to resume (the caller drops its sound meanwhile). */
  wakeContext(): void {
    if (this.ctx && !this.hidden) this.wake(this.ctx);
  }
}
