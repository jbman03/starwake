import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, type Settings } from '../save/settings';
import { SoundBoard } from './sfx';

function param() {
  const calls: string[] = [];
  return {
    value: 0,
    calls,
    setValueAtTime: (v: number) => (calls.push(`set ${v}`), undefined),
    linearRampToValueAtTime: (v: number) => (calls.push(`lin ${v}`), undefined),
    exponentialRampToValueAtTime: (v: number) => (calls.push(`exp ${v}`), undefined),
    cancelScheduledValues: () => undefined,
  };
}

function fakeCtx() {
  const made = { osc: 0, noise: 0, gains: [] as ReturnType<typeof param>[], resumed: 0 };
  const node = () => ({ connect: (n: unknown) => n, disconnect: () => undefined });
  const ctx = {
    currentTime: 0,
    sampleRate: 8000,
    state: 'suspended',
    destination: node(),
    resume: () => ((made.resumed += 1), Promise.resolve()),
    createOscillator: () => {
      made.osc += 1;
      return { ...node(), type: 'sine', frequency: param(), start: () => undefined, stop: () => undefined };
    },
    createGain: () => {
      const gain = param();
      made.gains.push(gain);
      return { ...node(), gain };
    },
    createBiquadFilter: () => ({ ...node(), type: 'lowpass', frequency: param(), Q: param() }),
    createBuffer: (_c: number, len: number) => ({ getChannelData: () => new Float32Array(len) }),
    createBufferSource: () => {
      made.noise += 1;
      return { ...node(), buffer: null, loop: false, start: () => undefined, stop: () => undefined };
    },
  };
  return { ctx: ctx as unknown as AudioContext, made };
}

const settings = (over: Partial<Settings> = {}): Settings => ({ ...DEFAULT_SETTINGS, ...over });

function board(over: Partial<Settings> = {}) {
  const s = settings(over);
  const f = fakeCtx();
  return { sb: new SoundBoard(() => s, () => f.ctx), s, ...f };
}

describe('SoundBoard', () => {
  it('plays nothing before unlock', () => {
    const { sb, made } = board();
    sb.play('jump');
    sb.setThrust(true);
    expect(made.osc + made.noise).toBe(0);
  });

  it('unlock resumes the context and play then creates nodes', () => {
    const { sb, made } = board();
    sb.unlock();
    expect(made.resumed).toBe(1);
    sb.play('jump');
    expect(made.osc).toBeGreaterThan(0);
  });

  it('plays nothing when muted or at zero volume', () => {
    const a = board({ muted: true });
    a.sb.unlock();
    a.sb.play('jump');
    expect(a.made.osc + a.made.noise).toBe(0);
    expect(a.sb.muted()).toBe(true);
    const b = board({ volume: 0 });
    b.sb.unlock();
    b.sb.play('land');
    expect(b.made.osc + b.made.noise).toBe(0);
  });

  it('follows the live settings: muting after unlock silences it', () => {
    const { sb, s, made } = board();
    sb.unlock();
    s.muted = true;
    sb.play('trade');
    expect(made.osc + made.noise).toBe(0);
    s.muted = false;
    sb.play('trade');
    expect(made.osc).toBeGreaterThan(0);
  });

  it('every sound can be played', () => {
    for (const id of ['thrust', 'jump', 'arrive', 'land', 'takeoff', 'trade', 'paid', 'hail', 'site'] as const) {
      const { sb, made } = board();
      sb.unlock();
      sb.play(id);
      expect(made.osc + made.noise, id).toBeGreaterThan(0);
    }
  });

  it('thrust hum is a looping noise that ramps its gain', () => {
    const { sb, made } = board();
    sb.unlock();
    sb.setThrust(true);
    expect(made.noise).toBe(1);
    const hum = made.gains[made.gains.length - 1];
    expect(hum.calls.some((c) => c.startsWith('lin ') && c !== 'lin 0')).toBe(true);
    sb.setThrust(false);
    expect(hum.calls[hum.calls.length - 1]).toBe('lin 0');
    sb.setThrust(true);
    expect(made.noise).toBe(1); // reuses the same source
  });

  it('thrust hum goes quiet when muted', () => {
    const { sb, s, made } = board();
    sb.unlock();
    sb.setThrust(true);
    const hum = made.gains[made.gains.length - 1];
    s.muted = true;
    sb.setThrust(true);
    expect(hum.calls[hum.calls.length - 1]).toBe('lin 0');
  });

  it('survives a context that cannot be made', () => {
    const sb = new SoundBoard(
      () => settings(),
      () => {
        throw new Error('no audio');
      },
    );
    expect(() => {
      sb.unlock();
      sb.play('jump');
      sb.setThrust(true);
    }).not.toThrow();
  });
});
