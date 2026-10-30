import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, type Settings } from '../save/settings';
import { testData } from '../data/testData';
import { fakeCtx } from './fakeContext';
import { Mixer } from './mixer';
import type { SoundLayer } from '../data/schemas';
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
    const { sb, made } = board();
    sb.play('jumpCharge');
    sb.setThrust(true);
    expect(made.osc + made.noise).toBe(0);
  });

  it('unlock resumes the context and play then creates nodes', () => {
    const { sb, mixer, made } = board();
    mixer.unlock();
    expect(made.resumed).toBe(1);
    sb.play('jumpCharge');
    expect(made.osc).toBeGreaterThan(0);
  });

  it('plays nothing when muted or at zero volume', () => {
    const a = board({ muted: true });
    a.mixer.unlock();
    a.sb.play('jumpCharge');
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
    for (const id of ['jumpCharge', 'jumpWhoosh', 'jumpArrive', 'land', 'takeoff', 'trade', 'paid', 'hail', 'site', 'uiClick'] as const) {
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
    sb.play('jumpCharge');
    sb.setThrust(true);
    expect(made.osc + made.noise).toBe(0);
    expect(made.resumed).toBe(3); // unlock, play and setThrust(true) each ask again
    (ctx as unknown as { state: string }).state = 'running';
    expect(mixer.running()).toBe(true);
    sb.play('jumpCharge'); // the dropped one is not replayed, new ones play
    expect(made.osc).toBe(testData().audio.sfx.jumpCharge.layers.filter((l) => l.kind === 'tone').length);
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
      sb.play('jumpCharge');
      sb.setThrust(true);
    }).not.toThrow();
  });
  it('sfx: new sounds synthesise without throwing (mocked AudioContext)', () => {
    for (const id of ['shot', 'cannon', 'missile', 'seeker', 'beam', 'shieldHit', 'armorHit', 'explosion', 'disabled', 'alarm'] as const) {
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

describe('SoundBoard routing', () => {
  /** Whether `from` reaches `target` through connect() calls. */
  const reaches = (from: { to: unknown[] }, target: unknown): boolean =>
    from.to.some((n) => n === target || reaches(n as { to: unknown[] }, target));

  function audit(play: (sb: SoundBoard) => void) {
    const { sb, mixer, made, destination } = board();
    mixer.unlock();
    const infra = new Set<unknown>(made.nodes); // master, music, effects
    const sfx = mixer.sfxBus() as unknown as { to: unknown[] };
    play(sb);
    const voices = made.nodes.filter((n) => !infra.has(n));
    expect(made.sources.length).toBeGreaterThan(0);
    for (const src of made.sources) expect(reaches(src as { to: unknown[] }, sfx)).toBe(true);
    for (const n of voices) {
      expect(n.to).not.toContain(destination);
      expect(n.to).not.toContain(mixer.musicBus());
    }
    // Every chain ends on the effects bus, so mute and volume apply to it.
    expect(voices.some((n) => n.to.includes(sfx))).toBe(true);
  }

  for (const id of [
    'land', 'takeoff', 'trade', 'paid', 'hail', 'site', 'shot', 'cannon', 'missile', 'seeker',
    'shieldHit', 'armorHit', 'explosion', 'disabled', 'alarm', 'jumpCharge', 'jumpWhoosh', 'jumpArrive', 'beam', 'uiClick',
  ] as const)
    it(`${id} feeds the effects bus and never the destination`, () => audit((sb) => sb.play(id)));

  it('the engine hum feeds the effects bus and never the destination', () => audit((sb) => sb.setThrust(true)));
});

describe('battleSounds', () => {
  const voices = testData().audio.gunVoices;
  it('turns one tick of fight events into each sound once', () => {
    expect(
      battleSounds(
        [
          { type: 'shot', ownerId: 'player', kind: 'bolt', outfitId: 'light-blaster' },
          { type: 'shot', ownerId: 'n1', kind: 'bolt', outfitId: 'light-blaster' },
          { type: 'shot', ownerId: 'n1', kind: 'seeker', outfitId: 'seeker-launcher' },
          { type: 'shot', ownerId: 'n2', kind: 'beam', outfitId: 'lance-beam' },
          { type: 'hit', targetId: 'n1', shield: true, pos: { x: 0, y: 0 } },
          { type: 'hit', targetId: 'n2', shield: false, pos: { x: 0, y: 0 } },
          { type: 'disabled', id: 'n1', byPlayer: true },
          { type: 'destroyed', id: 'n2', byPlayer: true, pos: { x: 0, y: 0 } },
          { type: 'lowArmor' },
          { type: 'angered', government: 'g' },
          { type: 'fled', id: 'n3' },
        ],
        voices,
      ),
    ).toEqual(['shot', 'seeker', 'beam', 'shieldHit', 'armorHit', 'disabled', 'explosion', 'alarm']);
    expect(battleSounds([{ type: 'playerDisabled' }, { type: 'playerDestroyed', pos: { x: 0, y: 0 } }], voices)).toEqual(['disabled', 'explosion']);
    expect(battleSounds([{ type: 'shot', ownerId: 'n1', kind: 'rocket', outfitId: 'rocket-rack' }], voices)).toEqual(['missile']);
  });

  it('gives each weapon its own voice: blaster chirp, cannon thud, rocket hiss, seeker trill', () => {
    const one = (kind: 'bolt' | 'rocket' | 'seeker' | 'beam', outfitId: string) =>
      battleSounds([{ type: 'shot', ownerId: 'n1', kind, outfitId }], voices);
    expect(one('bolt', 'light-blaster')).toEqual(['shot']);
    expect(one('bolt', 'rapid-cannon')).toEqual(['cannon']);
    expect(one('rocket', 'rocket-rack')).toEqual(['missile']);
    expect(one('seeker', 'seeker-launcher')).toEqual(['seeker']);
    expect(one('beam', 'lance-beam')).toEqual(['beam']);
    // A gun audio.json does not name keeps the blaster chirp; two guns in one tick play both voices.
    expect(one('bolt', 'some-new-gun')).toEqual(['shot']);
    expect(
      battleSounds(
        [
          { type: 'shot', ownerId: 'a', kind: 'bolt', outfitId: 'rapid-cannon' },
          { type: 'shot', ownerId: 'b', kind: 'bolt', outfitId: 'heavy-blaster' },
          { type: 'shot', ownerId: 'c', kind: 'bolt', outfitId: 'rapid-cannon' },
        ],
        voices,
      ),
    ).toEqual(['cannon', 'shot']);
  });
});

describe('sound design (shipped recipes)', () => {
  const { sfx } = testData().audio;
  const start = (l: SoundLayer) => l.at ?? 0;
  /** The largest sum of layer gains sounding at one instant (each layer's peak, at any layer's start). */
  const peak = (layers: SoundLayer[]) =>
    Math.max(...layers.map((l) => layers.filter((m) => start(m) <= start(l) && start(l) < start(m) + m.dur).reduce((a, m) => a + m.gain, 0)));
  const tones = (layers: SoundLayer[]) => layers.filter((l): l is Extract<SoundLayer, { kind: 'tone' }> => l.kind === 'tone');
  const noises = (layers: SoundLayer[]) => layers.filter((l): l is Extract<SoundLayer, { kind: 'noise' }> => l.kind === 'noise');

  it('each recipe peaks at a summed gain of 0.6 or less', () => {
    for (const [id, r] of Object.entries(sfx)) expect(peak(r.layers), id).toBeLessThanOrEqual(0.6);
  });

  it('the explosion is deep: a low-pass noise layer and a sub tone under 100 Hz', () => {
    expect(noises(sfx.explosion.layers).some((l) => l.filter === 'lowpass')).toBe(true);
    expect(tones(sfx.explosion.layers).some((l) => Math.max(l.f0, l.f1 ?? 0) < 100)).toBe(true);
  });

  it('a shield hit zaps through high- or band-pass noise; an armor hit crunches through low-pass', () => {
    expect(noises(sfx.shieldHit.layers).some((l) => l.filter === 'highpass' || l.filter === 'bandpass')).toBe(true);
    expect(noises(sfx.armorHit.layers).some((l) => l.filter === 'lowpass')).toBe(true);
  });

  it('the jump charge rises in pitch over at least 0.6 s', () => {
    expect(tones(sfx.jumpCharge.layers).some((l) => l.f1 !== undefined && l.f1 > l.f0 && l.dur >= 0.6)).toBe(true);
  });

  it('the jump whoosh has a noise layer sweeping down over at least 0.4 s', () => {
    expect(noises(sfx.jumpWhoosh.layers).some((l) => l.c1 !== undefined && l.c1 < l.c0 && l.dur >= 0.4)).toBe(true);
  });

  it('the four weapon voices differ, and combat sounds that repeat are short and soft', () => {
    const weapons = (['shot', 'cannon', 'missile', 'seeker'] as const).map((id) => JSON.stringify(sfx[id]));
    expect(new Set(weapons).size).toBe(4);
    for (const id of ['shot', 'cannon', 'shieldHit', 'armorHit'] as const) {
      expect(Math.max(...sfx[id].layers.map((l) => start(l) + l.dur)), id).toBeLessThanOrEqual(0.3);
      expect(peak(sfx[id].layers), id).toBeLessThanOrEqual(0.2);
    }
  });

  it('the UI click is a quick, quiet tick', () => {
    expect(Math.max(...sfx.uiClick.layers.map((l) => start(l) + l.dur))).toBeLessThanOrEqual(0.06);
    expect(peak(sfx.uiClick.layers)).toBeLessThanOrEqual(0.06);
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
    'land', 'takeoff', 'trade', 'paid', 'hail', 'site', 'shot', 'cannon', 'missile', 'seeker',
    'shieldHit', 'armorHit', 'explosion', 'disabled', 'alarm', 'jumpCharge', 'jumpWhoosh', 'jumpArrive', 'uiClick', 'beam',
  ] as const;
  for (const id of ids) {
    it(`${id} makes the recipe's nodes, frequencies and per-sound peak gains (the level is on the bus)`, () => {
      const { ctx, log, mark } = recordingCtx();
      const mixer = new Mixer(() => settings(), () => ctx);
      const sb = new SoundBoard(() => settings(), testData().audio, mixer);
      mixer.unlock();
      mark();
      sb.play(id);
      expect(log.join('\n')).toMatchSnapshot();
    });
  }
  it('the engine hum: a filtered tone over a low-passed noise rumble', () => {
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

describe('SoundBoard filters and the engine hum', () => {
  it('a high-pass noise layer makes a high-pass BiquadFilterNode with the given Q', () => {
    const audio = structuredClone(testData().audio);
    audio.sfx.uiClick.layers = [{ kind: 'noise', filter: 'highpass', c0: 3000, c1: 6000, q: 2.5, dur: 0.1, gain: 0.1 }];
    const f = fakeCtx();
    const mixer = new Mixer(() => settings(), () => f.ctx);
    const sb = new SoundBoard(() => settings(), audio, mixer);
    mixer.unlock();
    const before = new Set(f.made.nodes);
    sb.play('uiClick');
    const filters = f.made.nodes.filter((n) => !before.has(n) && 'Q' in n) as unknown as { type: string; Q: { calls: string[] }; frequency: { calls: string[] } }[];
    expect(filters).toHaveLength(1);
    expect(filters[0].type).toBe('highpass');
    expect(filters[0].Q.calls).toEqual(['set 2.5']);
    expect(filters[0].frequency.calls).toEqual(['set 3000', 'exp 6000']);
  });

  it('the engine hum layers a tone over a filtered noise rumble, made once and reused', () => {
    const { sb, mixer, made } = board();
    mixer.unlock();
    sb.setThrust(true);
    expect(made.osc).toBe(1);
    expect(made.noise).toBe(1);
    sb.setThrust(false);
    sb.setThrust(true);
    expect(made.osc).toBe(1);
    expect(made.noise).toBe(1);
  });

  it('a layer with an attack swells to its peak over that time, then decays by its end', () => {
    const audio = structuredClone(testData().audio);
    audio.sfx.uiClick.layers = [
      { kind: 'tone', wave: 'sine', f0: 200, f1: 800, attack: 0.5, dur: 0.7, gain: 0.1 },
      { kind: 'tone', wave: 'sine', f0: 200, dur: 0.4, gain: 0.1 },
    ];
    const f = fakeCtx();
    const mixer = new Mixer(() => settings(), () => f.ctx);
    const sb = new SoundBoard(() => settings(), audio, mixer);
    mixer.unlock();
    const n = f.made.gains.length;
    sb.play('uiClick');
    const [swell, plain] = f.made.gains.slice(n);
    expect(swell.timed.filter((c) => c.op !== 'cancel')).toEqual([
      { op: 'set', v: 0.0001, t: 0 },
      { op: 'lin', v: 0.1, t: 0.5 },
      { op: 'exp', v: 0.0001, t: 0.7 },
    ]);
    expect(plain.timed.find((c) => c.op === 'lin')).toEqual({ op: 'lin', v: 0.1, t: 0.02 }); // the default quick attack
  });
});
