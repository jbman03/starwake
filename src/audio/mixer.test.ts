import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, type Settings } from '../save/settings';
import { fakeCtx } from './fakeContext';
import { Mixer } from './mixer';

function rig(over: Partial<Settings> = {}) {
  const s: Settings = { ...DEFAULT_SETTINGS, ...over };
  const f = fakeCtx();
  return { mixer: new Mixer(() => s, () => f.ctx), s, ...f };
}

const last = (g: { calls: string[] }) => g.calls[g.calls.length - 1];

describe('Mixer', () => {
  it('has no context or buses before unlock', () => {
    const { mixer } = rig();
    expect(mixer.context()).toBeNull();
    expect(mixer.sfxBus()).toBeNull();
    expect(mixer.musicBus()).toBeNull();
    expect(mixer.running()).toBe(false);
    expect(() => {
      mixer.apply();
      mixer.setHidden(true);
    }).not.toThrow();
  });

  it('buses are created once on unlock', () => {
    const { mixer, made, ctx } = rig();
    mixer.unlock();
    expect(made.gains).toHaveLength(3); // master, music, effects
    const sfx = mixer.sfxBus();
    const music = mixer.musicBus();
    expect(sfx).not.toBeNull();
    expect(music).not.toBeNull();
    expect(sfx).not.toBe(music);
    mixer.unlock();
    mixer.unlock();
    expect(made.gains).toHaveLength(3);
    expect(mixer.sfxBus()).toBe(sfx);
    expect(mixer.context()).toBe(ctx);
    expect(made.resumed).toBe(1); // the first unlock woke it; later ones find it running
    expect(mixer.running()).toBe(true);
  });

  it('starts at the settings levels', () => {
    const { mixer, made } = rig({ musicVolume: 0.3, sfxVolume: 0.7 });
    mixer.unlock();
    const [master, music, sfx] = made.gains;
    expect(last(master)).toBe('lin 1');
    expect(last(music)).toBe('lin 0.3');
    expect(last(sfx)).toBe('lin 0.7');
  });

  it('apply ramps bus gains, no node recreated', () => {
    const { mixer, made, s } = rig();
    mixer.unlock();
    const nodes = made.gains.length;
    const sfx = mixer.sfxBus();
    s.sfxVolume = 0.25;
    s.musicVolume = 0.5;
    mixer.apply();
    expect(made.gains).toHaveLength(nodes);
    expect(mixer.sfxBus()).toBe(sfx);
    const [, music, eff] = made.gains;
    expect(last(eff)).toBe('lin 0.25');
    expect(last(music)).toBe('lin 0.5');
  });

  it('clamps out-of-range volumes', () => {
    const { mixer, made, s } = rig();
    mixer.unlock();
    s.sfxVolume = 4;
    s.musicVolume = -1;
    mixer.apply();
    expect(last(made.gains[2])).toBe('lin 1');
    expect(last(made.gains[1])).toBe('lin 0');
  });

  it('muted zeroes both buses', () => {
    const { mixer, made, s } = rig();
    mixer.unlock();
    s.muted = true;
    mixer.apply();
    expect(last(made.gains[1])).toBe('lin 0');
    expect(last(made.gains[2])).toBe('lin 0');
    expect(last(made.gains[0])).toBe('lin 1'); // master stays at 1
    s.muted = false;
    mixer.apply();
    expect(last(made.gains[2])).toBe(`lin ${s.sfxVolume}`);
  });

  it('a factory that throws leaves every call a no-op', () => {
    const mixer = new Mixer(
      () => DEFAULT_SETTINGS,
      () => {
        throw new Error('no audio');
      },
    );
    expect(() => {
      mixer.unlock();
      mixer.apply();
      mixer.setHidden(true);
      mixer.setHidden(false);
    }).not.toThrow();
    expect(mixer.context()).toBeNull();
    expect(mixer.sfxBus()).toBeNull();
    expect(mixer.musicBus()).toBeNull();
    expect(mixer.running()).toBe(false);
  });

  it('setHidden(true) suspends and setHidden(false) resumes', () => {
    const { mixer, made } = rig();
    mixer.unlock();
    expect(mixer.running()).toBe(true);
    mixer.setHidden(true);
    expect(made.suspended).toBe(1);
    expect(mixer.running()).toBe(false);
    const resumed = made.resumed;
    mixer.setHidden(false);
    expect(made.resumed).toBe(resumed + 1);
    expect(mixer.running()).toBe(true);
  });

  it('an unlock while hidden does not wake the context', () => {
    const { mixer, made } = rig();
    mixer.setHidden(true);
    mixer.unlock();
    expect(made.resumed).toBe(0);
    mixer.setHidden(false);
    expect(made.resumed).toBe(1);
  });

  it('a context that stays suspended is retried on each unlock', () => {
    const { mixer, made } = rig();
    made.autoRun = false;
    mixer.unlock();
    mixer.unlock();
    expect(made.resumed).toBe(2);
    expect(mixer.running()).toBe(false);
  });
});
