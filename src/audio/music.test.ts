import { describe, expect, it } from 'vitest';
import { testData } from '../data/testData';
import { DEFAULT_SETTINGS } from '../save/settings';
import { fakeCtx, type FakeNode, type param } from './fakeContext';
import { Mixer } from './mixer';
import type { MoodId } from './moods';
import { Music } from './music';

const moods = testData().audio.moods;
type Osc = FakeNode & { type: string; frequency: ReturnType<typeof param> };
type Gain = FakeNode & { gain: ReturnType<typeof param> };

function rig(unlocked = true) {
  const f = fakeCtx();
  const mixer = new Mixer(() => DEFAULT_SETTINGS, () => f.ctx);
  if (unlocked) mixer.unlock();
  const music = new Music(mixer, moods);
  const clock = f.ctx as unknown as { currentTime: number };
  /** Advance the audio clock, ticking every 250 ms as main.ts does. */
  const run = (sec: number) => {
    for (let i = 0; i < sec * 4; i++) {
      clock.currentTime = Math.round((clock.currentTime + 0.25) * 1000) / 1000;
      music.tick();
    }
  };
  const at = (t: number) => (clock.currentTime = t);
  /** Every voice output: the gains that feed the music bus, oldest first. */
  const outs = () => f.made.nodes.filter((n) => n.to.includes(mixer.musicBus())) as unknown as Gain[];
  const oscs = () => f.made.nodes.filter((n) => 'detune' in n) as unknown as Osc[];
  return { ...f, mixer, music, run, at, outs, oscs };
}

/** The first frequency each oscillator was set to, with its wave: the notes played. */
const notes = (list: Osc[]) => list.map((o) => `${o.type} ${o.frequency.timed[0]?.v?.toFixed(2)}`);
const lin = (g: Gain) => g.gain.timed.filter((e) => e.op === 'lin');

describe('Music', () => {
  it('the same mood plays the same chord sequence each time it starts', () => {
    const r = rig();
    const first = r.oscs().length;
    r.music.setMood('core');
    r.run(60);
    const a = notes(r.oscs().slice(first));
    r.music.setMood('fringe');
    r.run(30);
    const second = r.oscs().length;
    r.music.setMood('core');
    r.run(60);
    const b = notes(r.oscs().slice(second));
    expect(b).toEqual(a);
    // More than one chord, and the chords are not all the same.
    expect(new Set(a).size).toBeGreaterThan(6);
    // Another mood plays something else.
    const c = rig();
    c.music.setMood('fringe');
    c.run(60);
    expect(notes(c.oscs())).not.toEqual(a);
  });

  it('setMood crossfades: the old voice ramps to 0 and the new one up over 3 s (2 s for combat)', () => {
    const r = rig();
    r.music.setMood('core');
    expect(r.outs()).toHaveLength(1);
    expect(lin(r.outs()[0])).toEqual([{ op: 'lin', v: moods.core.level, t: 3 }]); // fades in from silence
    r.run(10);
    r.music.setMood('fringe');
    const [core, fringe] = r.outs();
    expect(lin(core).at(-1)).toEqual({ op: 'lin', v: 0, t: 13 });
    expect(fringe.gain.timed[0]).toEqual({ op: 'set', v: 0, t: 10 });
    expect(lin(fringe)).toEqual([{ op: 'lin', v: moods.fringe.level, t: 13 }]);

    r.run(10);
    r.music.setMood('combat');
    const combat = r.outs()[2];
    expect(lin(fringe).at(-1)).toEqual({ op: 'lin', v: 0, t: 22 });
    expect(lin(combat)).toEqual([{ op: 'lin', v: moods.combat.level, t: 22 }]);

    r.run(10);
    r.music.setMood('core'); // out of combat is 2 s too
    expect(lin(combat).at(-1)).toEqual({ op: 'lin', v: 0, t: 32 });
    expect(lin(r.outs()[3])).toEqual([{ op: 'lin', v: moods.core.level, t: 32 }]);
  });

  it('setMood with the current mood does nothing', () => {
    const r = rig();
    r.music.setMood('docked');
    r.run(5);
    const nodes = r.made.nodes.length;
    const events = r.made.gains.reduce((n, g) => n + g.timed.length, 0);
    r.music.setMood('docked');
    expect(r.made.nodes.length).toBe(nodes);
    expect(r.made.gains.reduce((n, g) => n + g.timed.length, 0)).toBe(events);
    expect(r.outs()).toHaveLength(1);
  });

  it('mood() is the mood last asked for, null before the first, even with no audio', () => {
    const r = rig(false);
    expect(r.music.mood()).toBeNull();
    r.music.setMood('core');
    expect(r.music.mood()).toBe('core');
    r.music.setMood('combat');
    expect(r.music.mood()).toBe('combat');
  });

  it('hide during crossfade resumes on the latest mood', () => {
    const r = rig();
    r.music.setMood('core');
    r.run(10);
    r.music.setMood('fringe');
    r.run(1); // mid-crossfade
    r.mixer.setHidden(true);
    const made = r.made.nodes.length;
    r.music.setMood('combat');
    r.music.setMood('docked');
    r.music.tick();
    expect(r.made.nodes.length).toBe(made); // nothing is built while the page is hidden
    r.mixer.setHidden(false);
    r.music.tick();
    const outs = r.outs();
    expect(outs).toHaveLength(3); // core, fringe, then docked: combat never started
    expect(lin(outs[2])).toEqual([{ op: 'lin', v: moods.docked.level, t: 14 }]);
    expect(lin(outs[1]).at(-1)).toEqual({ op: 'lin', v: 0, t: 14 });
    r.run(10);
    // Only the docked voice is left connected.
    expect(outs.map((o) => o.log.disconnects > 0)).toEqual([true, true, false]);
  });

  it('pause fades out and builds nothing; resume fades the latest mood back in', () => {
    const r = rig();
    r.music.setMood('core');
    r.run(10);
    r.music.pause();
    expect(lin(r.outs()[0]).at(-1)?.v).toBe(0);
    r.run(2);
    const made = r.made.nodes.length;
    r.music.setMood('fringe');
    r.run(30);
    expect(r.made.nodes.length).toBe(made);
    r.music.resume();
    expect(r.outs()).toHaveLength(2);
    expect(lin(r.outs()[1])).toEqual([{ op: 'lin', v: moods.fringe.level, t: 45 }]);
  });

  it('no musicBus (locked or no audio) makes every call a no-op', () => {
    const locked = rig(false);
    const failing = new Music(
      (() => {
        const m = new Mixer(() => DEFAULT_SETTINGS, () => {
          throw new Error('no audio');
        });
        m.unlock();
        return m;
      })(),
      moods,
    );
    for (const music of [locked.music, failing]) {
      expect(() => {
        for (const id of ['core', 'combat', 'hyperspace'] as MoodId[]) music.setMood(id);
        music.tick();
        music.pause();
        music.resume();
        music.tick();
      }).not.toThrow();
    }
    expect(locked.made.nodes).toHaveLength(0);
  });

  it('starts playing once the mixer unlocks', () => {
    const r = rig(false);
    r.music.setMood('core');
    r.music.tick();
    expect(r.made.nodes).toHaveLength(0);
    r.mixer.unlock();
    r.music.tick();
    expect(r.outs()).toHaveLength(1);
  });

  it('voices are stopped and disconnected after a fade (no node leak after 20 mood changes)', () => {
    const r = rig();
    const ids: MoodId[] = ['core', 'combat', 'fringe', 'hyperspace', 'docked'];
    for (let i = 0; i < 20; i++) {
      r.music.setMood(ids[i % ids.length]);
      r.run(i % 3 === 0 ? 1 : 25); // some changes land mid-crossfade
    }
    r.music.setMood('core');
    r.run(60);
    const buses: unknown[] = [r.mixer.musicBus(), r.mixer.sfxBus()];
    const live = r.made.nodes.filter((n) => n.log.disconnects === 0 && !buses.includes(n));
    const master = r.made.nodes[0];
    const voiceNodes = live.filter((n) => n !== master);
    // Only the playing core voice remains: its output, filter, drone and the chords now sounding.
    expect(voiceNodes.length).toBeLessThan(40);
    expect(voiceNodes).toContain(r.outs().at(-1));
    for (const out of r.outs().slice(0, -1)) expect(out.log.disconnects).toBeGreaterThan(0);
    // Every source made, other than the live voice's, was told to stop.
    const running = r.made.sources.filter((s) => s.log.stops.length === 0);
    for (const s of running) expect(voiceNodes).toContain(s);
    // Every source was started before it was stopped, and every stop time is finite.
    for (const s of r.made.sources) {
      expect(s.log.starts).toHaveLength(1);
      for (const t of s.log.stops) expect(Number.isFinite(t)).toBe(true);
    }
  });
});
