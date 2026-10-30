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
    // Set outright at unlock: no ramp from the node default of 1.
    expect(last(master)).toBe('set 1');
    expect(last(music)).toBe('set 0.3');
    expect(last(sfx)).toBe('set 0.7');
    expect(made.gains.flatMap((g) => g.timed).some((e) => e.op === 'lin')).toBe(false);
  });

  it('the buses feed the master, and the master feeds the destination', () => {
    const { mixer, made, destination } = rig();
    mixer.unlock();
    const [master, music, sfx] = made.nodes;
    expect(mixer.musicBus()).toBe(music);
    expect(mixer.sfxBus()).toBe(sfx);
    expect(music.to).toEqual([master]);
    expect(sfx.to).toEqual([master]);
    expect(master.to).toEqual([destination]);
  });

  it('a change cancels, anchors at the current value and ramps over 0.05 s', () => {
    const { mixer, made, ctx, s } = rig();
    mixer.unlock();
    (ctx as unknown as { currentTime: number }).currentTime = 2;
    s.sfxVolume = 0.25;
    mixer.apply();
    const ev = made.gains[2].timed.slice(-3);
    expect(ev.map((e) => e.op)).toEqual(['cancel', 'set', 'lin']);
    expect(ev[0].t).toBe(2);
    expect(ev[1].t).toBe(2);
    expect(ev[2]).toEqual({ op: 'lin', v: 0.25, t: 2.05 });
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
