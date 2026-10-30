import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, type Settings } from '../save/settings';
import { testData } from '../data/testData';
import { fakeCtx } from './fakeContext';
import { Mixer } from './mixer';
import { battleSounds, SoundBoard } from './sfx';

const settings = (over: Partial<Settings> = {}): Settings => ({ ...DEFAULT_SETTINGS, ...over });

function board(over: Partial<Settings> = {}) {
  const s = settings(over);
  const f = fakeCtx();
  const mixer = new Mixer(() => s, () => f.ctx);
  return { sb: new SoundBoard(() => s, testData().audio, mixer), mixer, s, ...f };
}

describe('SoundBoard', () => {
  it('plays nothing before unlock', () => {
    const { sb, mixer, made } = board();
    sb.play('jump');
    sb.setThrust(true);
    expect(made.osc + made.noise).toBe(0);
  });

  it('unlock resumes the context and play then creates nodes', () => {
    const { sb, mixer, made } = board();
    mixer.unlock();
    expect(made.resumed).toBe(1);
    sb.play('jump');
    expect(made.osc).toBeGreaterThan(0);
  });

  it('plays nothing when muted or at zero volume', () => {
    const a = board({ muted: true });
    a.mixer.unlock();
    a.sb.play('jump');
    expect(a.made.osc + a.made.noise).toBe(0);
    expect(a.sb.muted()).toBe(true);
    const b = board({ sfxVolume: 0 });
    b.mixer.unlock();
    b.sb.play('land');
    expect(b.made.osc + b.made.noise).toBe(0);
  });

  it('follows the live settings: muting after unlock silences it', () => {
    const { sb, mixer, s, made } = board();
    mixer.unlock();
    s.muted = true;
    sb.play('trade');
    expect(made.osc + made.noise).toBe(0);
    s.muted = false;
    sb.play('trade');
    expect(made.osc).toBeGreaterThan(0);
  });

  it('every one-shot can be played', () => {
    for (const id of ['jump', 'arrive', 'land', 'takeoff', 'trade', 'paid', 'hail', 'site'] as const) {
      const { sb, mixer, made } = board();
      mixer.unlock();
      sb.play(id);
      expect(made.osc + made.noise, id).toBeGreaterThan(0);
    }
  });

  it('thrust hum is a looping noise that ramps its gain', () => {
    const { sb, mixer, made } = board();
    mixer.unlock();
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
    const { sb, mixer, made } = board();
    made.autoRun = false;
    mixer.unlock();
    const before = made.resumed;
    sb.setThrust(false);
    expect(made.resumed).toBe(before);
  });

  it('thrust hum goes quiet when muted', () => {
    const { sb, mixer, s, made } = board();
    mixer.unlock();
    sb.setThrust(true);
    const hum = made.gains[made.gains.length - 1];
    s.muted = true;
    sb.setThrust(true);
    expect(hum.calls[hum.calls.length - 1]).toBe('lin 0');
  });

  it('a context that stays suspended drops sounds, retries resume, and plays once running', () => {
    const { sb, mixer, made, ctx } = board();
    made.autoRun = false;
    mixer.unlock();
    expect(mixer.running()).toBe(false);
    sb.play('jump');
    sb.setThrust(true);
    expect(made.osc + made.noise).toBe(0);
    expect(made.resumed).toBe(3); // unlock, play and setThrust(true) each ask again
    (ctx as unknown as { state: string }).state = 'running';
    expect(mixer.running()).toBe(true);
    sb.play('jump'); // the dropped one is not replayed, new ones play
    expect(made.osc).toBe(1);
  });

  it("play('thrust') does not start the hum", () => {
    const { sb, mixer, made } = board();
    mixer.unlock();
    sb.play('thrust');
    expect(made.noise).toBe(0);
  });

  it('survives a context that cannot be made', () => {
    const mixer = new Mixer(
      () => settings(),
      () => {
        throw new Error('no audio');
      },
    );
    const sb = new SoundBoard(() => settings(), testData().audio, mixer);
    expect(() => {
      mixer.unlock();
      sb.play('jump');
      sb.setThrust(true);
    }).not.toThrow();
  });
  it('sfx: new sounds synthesise without throwing (mocked AudioContext)', () => {
    for (const id of ['shot', 'missile', 'beam', 'shieldHit', 'armorHit', 'explosion', 'disabled', 'alarm'] as const) {
      const { sb, mixer, made } = board();
      mixer.unlock();
      expect(() => sb.play(id), id).not.toThrow();
      expect(made.osc + made.noise, id).toBeGreaterThan(0);
    }
  });

  it('the beam loops on one source while it keeps firing, and fades out 0.1 s after the last', () => {
    const { sb, mixer, made, ctx } = board();
    mixer.unlock();
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
    const { sb, mixer, made } = board({ muted: true });
    mixer.unlock();
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

/** A context that logs every node made and every parameter call, so a recipe port can be compared exactly. */
function recordingCtx() {
  const log: string[] = [];
  let n = 0;
  const param = (name: string) => ({
    setValueAtTime: (v: number, t: number) => (log.push(`${name} set ${v} @${t}`), undefined),
    linearRampToValueAtTime: (v: number, t: number) => (log.push(`${name} lin ${v} @${t}`), undefined),
    exponentialRampToValueAtTime: (v: number, t: number) => (log.push(`${name} exp ${v} @${t}`), undefined),
    cancelScheduledValues: () => undefined,
  });
  const node = (name: string) => ({ connect: (x: unknown) => x, disconnect: () => undefined, name });
  const ctx = {
    currentTime: 0,
    sampleRate: 8000,
    state: 'running',
    destination: node('dest'),
    resume: () => Promise.resolve(),
    createOscillator: () => {
      const id = `osc${n++}`;
      log.push(`create ${id}`);
      const o = {
        ...node(id),
        frequency: param(`${id}.freq`),
        start: (t?: number) => (log.push(`${id} start ${t ?? ''}`), undefined),
        stop: (t?: number) => (log.push(`${id} stop ${t ?? ''}`), undefined),
      };
      return new Proxy(o, { set: (t, k, v) => (k === 'type' && log.push(`${id} type ${v}`), Reflect.set(t, k, v)) });
    },
    createGain: () => {
      const id = `gain${n++}`;
      log.push(`create ${id}`);
      return { ...node(id), gain: param(`${id}.gain`) };
    },
    createBiquadFilter: () => {
      const id = `filter${n++}`;
      log.push(`create ${id}`);
      const f = { ...node(id), frequency: param(`${id}.freq`), Q: param(`${id}.Q`) };
      return new Proxy(f, { set: (t, k, v) => (k === 'type' && log.push(`${id} type ${v}`), Reflect.set(t, k, v)) });
    },
    createBuffer: (_c: number, len: number) => ({ getChannelData: () => new Float32Array(len) }),
    createBufferSource: () => {
      const id = `src${n++}`;
      log.push(`create ${id}`);
      return {
        ...node(id),
        buffer: null,
        loop: false,
        start: (t?: number) => (log.push(`${id} start ${t ?? ''}`), undefined),
        stop: (t?: number) => (log.push(`${id} stop ${t ?? ''}`), undefined),
      };
    },
  };
  // The mixer's own nodes are made at unlock; mark() forgets them so the recipe logs show only the board's.
  const mark = () => {
    log.length = 0;
    n = 0;
  };
  return { ctx: ctx as unknown as AudioContext, log, mark };
}

describe('SoundBoard recipes from data', () => {
  const ids = [
    'jump', 'arrive', 'land', 'takeoff', 'trade', 'paid', 'hail', 'site', 'shot', 'missile',
    'shieldHit', 'armorHit', 'explosion', 'disabled', 'alarm', 'beam',
  ] as const;
  for (const id of ids) {
    it(`${id} makes the same nodes, frequencies and gains as the original recipe`, () => {
      const { ctx, log, mark } = recordingCtx();
      const mixer = new Mixer(() => settings(), () => ctx);
      const sb = new SoundBoard(() => settings(), testData().audio, mixer);
      mixer.unlock();
      mark();
      sb.play(id);
      expect(log.join('\n')).toMatchSnapshot();
    });
  }
  it('the engine hum is unchanged', () => {
    const { ctx, log, mark } = recordingCtx();
    const mixer = new Mixer(() => settings(), () => ctx);
    const sb = new SoundBoard(() => settings(), testData().audio, mixer);
    mixer.unlock();
    mark();
    sb.setThrust(true);
    sb.setThrust(false);
    expect(log.join('\n')).toMatchSnapshot();
  });
});

describe('SoundBoard noise layers', () => {
  it('sets the filter Q only when the layer gives one, and uses the layer filter type', () => {
    const { ctx, log, mark } = recordingCtx();
    const audio = structuredClone(testData().audio);
    audio.sfx.uiClick.layers = [
      { kind: 'noise', filter: 'bandpass', c0: 1000, dur: 0.1, gain: 0.1, q: 4 },
      { kind: 'noise', filter: 'highpass', c0: 2000, dur: 0.1, gain: 0.1 },
    ];
    const mixer = new Mixer(() => settings(), () => ctx);
    const sb = new SoundBoard(() => settings(), audio, mixer);
    mixer.unlock();
    mark();
    sb.play('uiClick');
    expect(log.some((l) => / type bandpass$/.test(l))).toBe(true);
    expect(log.filter((l) => l.includes('.Q set'))).toHaveLength(1);
    expect(log.filter((l) => l.includes('.Q set'))[0]).toMatch(/\.Q set 4 @0$/);
    expect(log.some((l) => l.includes('type highpass'))).toBe(true);
  });
});
