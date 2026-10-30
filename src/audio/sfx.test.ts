import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, type Settings } from '../save/settings';
import { battleSounds, SoundBoard } from './sfx';

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
  const made = { osc: 0, noise: 0, gains: [] as ReturnType<typeof param>[], resumed: 0, autoRun: true };
  const node = () => ({ connect: (n: unknown) => n, disconnect: () => undefined });
  const ctx = {
    currentTime: 0,
    sampleRate: 8000,
    state: 'suspended' as string,
    destination: node(),
    resume: () => {
      made.resumed += 1;
      if (made.autoRun) ctx.state = 'running';
      return Promise.resolve();
    },
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

  it('every one-shot can be played', () => {
    for (const id of ['jump', 'arrive', 'land', 'takeoff', 'trade', 'paid', 'hail', 'site'] as const) {
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

  it('thrust off does not poke a suspended context awake', () => {
    const { sb, made } = board();
    made.autoRun = false;
    sb.unlock();
    const before = made.resumed;
    sb.setThrust(false);
    expect(made.resumed).toBe(before);
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

  it('a context that stays suspended drops sounds, retries resume, and plays once running', () => {
    const { sb, made, ctx } = board();
    made.autoRun = false;
    sb.unlock();
    expect(sb.running()).toBe(false);
    sb.play('jump');
    sb.setThrust(true);
    expect(made.osc + made.noise).toBe(0);
    expect(made.resumed).toBe(3); // unlock, play and setThrust(true) each ask again
    (ctx as unknown as { state: string }).state = 'running';
    expect(sb.running()).toBe(true);
    sb.play('jump'); // the dropped one is not replayed, new ones play
    expect(made.osc).toBe(1);
  });

  it("play('thrust') does not start the hum", () => {
    const { sb, made } = board();
    sb.unlock();
    sb.play('thrust');
    expect(made.noise).toBe(0);
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
  it('sfx: new sounds synthesise without throwing (mocked AudioContext)', () => {
    for (const id of ['shot', 'missile', 'beam', 'shieldHit', 'armorHit', 'explosion', 'disabled', 'alarm'] as const) {
      const { sb, made } = board();
      sb.unlock();
      expect(() => sb.play(id), id).not.toThrow();
      expect(made.osc + made.noise, id).toBeGreaterThan(0);
    }
  });

  it('the beam loops on one source while it keeps firing, and fades out 0.1 s after the last', () => {
    const { sb, made, ctx } = board();
    sb.unlock();
    sb.play('beam');
    const sources = made.osc + made.noise;
    const gain = made.gains[made.gains.length - 1];
    // Held at its level until 0.1 s after this pulse, then ramped to silence.
    const [hold, fade] = gain.calls.slice(-2);
    expect(hold).toMatch(/^set /);
    expect(Number(hold.slice(4))).toBeGreaterThan(0);
    expect(fade).toBe('lin 0');
    expect(sb.beamStopsAt()).toBeCloseTo(0.1, 6);
    (ctx as unknown as { currentTime: number }).currentTime = 0.05;
    sb.play('beam');
    sb.play('beam');
    expect(made.osc + made.noise).toBe(sources); // the same loop, kept alive
    expect(gain.calls[gain.calls.length - 1]).toBe('lin 0');
    expect(sb.beamStopsAt()).toBeCloseTo(0.15, 6);
  });

  it('a muted beam does not start', () => {
    const { sb, made } = board({ muted: true });
    sb.unlock();
    sb.play('beam');
    expect(made.osc + made.noise).toBe(0);
  });
});

describe('battleSounds', () => {
  it('turns one tick of fight events into each sound once', () => {
    expect(
      battleSounds([
        { type: 'shot', ownerId: 'player', kind: 'bolt' },
        { type: 'shot', ownerId: 'n1', kind: 'bolt' },
        { type: 'shot', ownerId: 'n1', kind: 'seeker' },
        { type: 'shot', ownerId: 'n2', kind: 'beam' },
        { type: 'hit', targetId: 'n1', shield: true, pos: { x: 0, y: 0 } },
        { type: 'hit', targetId: 'n2', shield: false, pos: { x: 0, y: 0 } },
        { type: 'disabled', id: 'n1', byPlayer: true },
        { type: 'destroyed', id: 'n2', byPlayer: true, pos: { x: 0, y: 0 } },
        { type: 'lowArmor' },
        { type: 'angered', government: 'g' },
        { type: 'fled', id: 'n3' },
      ]),
    ).toEqual(['shot', 'missile', 'beam', 'shieldHit', 'armorHit', 'disabled', 'explosion', 'alarm']);
    expect(battleSounds([{ type: 'playerDisabled' }, { type: 'playerDestroyed', pos: { x: 0, y: 0 } }])).toEqual(['disabled', 'explosion']);
    expect(battleSounds([{ type: 'shot', ownerId: 'n1', kind: 'rocket' }])).toEqual(['missile']);
  });
});
