import type { MoodDef } from '../data/schemas';
import { hashString, mulberry32 } from '../sim/random';
import type { Mixer } from './mixer';
import type { MoodId } from './moods';

type Moods = Record<MoodId, MoodDef>;

/** How far ahead (context seconds) each tick schedules chords and pulse beats. */
const LOOKAHEAD_SEC = 2;
/** Crossfade between moods, and into or out of combat. */
const FADE_SEC = 3;
const COMBAT_FADE_SEC = 2;
/** Fade-out when the pause menu opens. */
const PAUSE_FADE_SEC = 1;
/** A chord's pad swells in over up to this long, and rings on this long after the next chord starts. */
const CHORD_ATTACK_SEC = 3;
const CHORD_RELEASE_SEC = 4;
/** Cents each pad oscillator is pulled off pitch, by wave index: the slow beating makes the pad lush. */
const PAD_DETUNE = [-7, 7, 0];
const MELODY_ATTACK_SEC = 0.8;
const MELODY_RING_SEC = 4.5;
/** Pulse accents, beat by beat: a low, steady heartbeat. */
const PULSE_ACCENTS = [1, 0.55, 0.8, 0.55];
/** The filter opens from this fraction of its cutoff as the voice fades in, so each mood swells up. */
const SWELL_FROM = 0.4;
/** Context seconds after a node's last sound before it is disconnected. */
const SWEEP_MARGIN_SEC = 0.1;

/** A group of nodes that is torn down together once `endAt` (context seconds) has passed. */
interface Part {
  nodes: AudioNode[];
  sources: AudioScheduledSourceNode[];
  endAt: number;
}

/** One mood playing: its own output gain (for crossfades), a filter for the pad, and the parts it has scheduled. */
interface Voice {
  id: MoodId;
  mood: MoodDef;
  rng: () => number;
  out: GainNode;
  filter: BiquadFilterNode;
  /** The combat pulse's envelope, when the mood has one. */
  pulseGain: GainNode | null;
  parts: Part[];
  degree: number | null;
  nextChordAt: number;
  beat: number;
  nextBeatAt: number;
  /** When the fade-out ends and the voice is torn down; Infinity while it plays. */
  endsAt: number;
}

/** Semitones above the root of scale degree `i`, counting on into higher octaves. */
function step(scale: number[], i: number): number {
  return scale[i % scale.length] + 12 * Math.floor(i / scale.length);
}

const hz = (root: number, semis: number) => root * 2 ** (semis / 12);

/**
 * Generative ambient music: each mood is a seeded, slowly changing pad over a drone, with now and
 * then a soft melody note (and in combat a low pulse). Everything is scheduled on the AudioContext
 * clock a little ahead by `tick()`; nothing runs between ticks. Silent no-op without audio.
 */
export class Music {
  private voices: Voice[] = [];
  private current: Voice | null = null;
  private want: MoodId | null = null;
  private paused = false;

  constructor(
    private mixer: Mixer,
    private moods: Moods,
  ) {}

  /** Play this mood, crossfading from the last. The same mood again does nothing. */
  setMood(id: MoodId): void {
    if (id === this.want) return;
    this.want = id;
    this.guard(() => this.sync());
  }

  /** Fade out and schedule nothing until `resume` (the pause menu). */
  pause(): void {
    if (this.paused) return;
    this.paused = true;
    this.guard(() => {
      const ctx = this.mixer.context();
      if (ctx && this.current) this.fadeOut(this.current, ctx.currentTime, PAUSE_FADE_SEC);
      this.current = null;
    });
  }

  /** Fade the latest mood back in after `pause`. */
  resume(): void {
    if (!this.paused) return;
    this.paused = false;
    this.guard(() => this.sync());
  }

  /** Schedule the next couple of seconds and tear down faded voices. Call every 250 ms or so. */
  tick(): void {
    this.guard(() => {
      const ctx = this.ready();
      if (!ctx) return;
      this.sync();
      const now = ctx.currentTime;
      this.sweep(now);
      if (this.current) this.schedule(this.current, now);
    });
  }

  private guard(fn: () => void): void {
    try {
      fn();
    } catch {
      // audio failures stay silent
    }
  }

  /** The context, when music can play right now: unlocked, running (the page is shown) and a bus to play into. */
  private ready(): AudioContext | null {
    const ctx = this.mixer.context();
    if (!ctx || !this.mixer.musicBus() || ctx.state !== 'running') return null;
    return ctx;
  }

  /** Bring the playing voice in line with the wanted mood. */
  private sync(): void {
    const ctx = this.ready();
    if (!ctx || this.paused || !this.want || this.current?.id === this.want) return;
    const from = this.current?.id;
    const fade = from === 'combat' || this.want === 'combat' ? COMBAT_FADE_SEC : FADE_SEC;
    const now = ctx.currentTime;
    if (this.current) this.fadeOut(this.current, now, fade);
    this.current = this.start(ctx, this.want, now, fade);
  }

  private start(ctx: AudioContext, id: MoodId, now: number, fade: number): Voice {
    const mood = this.moods[id];
    const out = ctx.createGain();
    out.gain.setValueAtTime(0, now);
    out.gain.linearRampToValueAtTime(mood.level, now + fade);
    out.connect(this.mixer.musicBus()!);
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.Q.setValueAtTime(0.7, now);
    filter.frequency.setValueAtTime(mood.pad.cutoff * SWELL_FROM, now);
    filter.frequency.exponentialRampToValueAtTime(mood.pad.cutoff, now + fade);
    filter.connect(out);
    const v: Voice = {
      id,
      mood,
      rng: mulberry32(hashString('music:' + id)),
      out,
      filter,
      pulseGain: null,
      parts: [{ nodes: [out, filter], sources: [], endAt: Infinity }],
      degree: null,
      nextChordAt: now,
      beat: 0,
      nextBeatAt: now,
      endsAt: Infinity,
    };
    this.voices.push(v);

    // The drone: the root and a faintly detuned octave, for the whole life of the voice.
    const droneGain = ctx.createGain();
    droneGain.gain.setValueAtTime(mood.drone.gain / 2, now);
    droneGain.connect(out);
    const drone: Part = { nodes: [droneGain], sources: [], endAt: Infinity };
    for (const [mul, cents] of [
      [1, 0],
      [2, 5],
    ]) {
      const o = this.osc(ctx, 'sine', mood.root * mul, cents, now);
      o.connect(droneGain);
      drone.nodes.push(o);
      drone.sources.push(o);
    }
    v.parts.push(drone);

    if (mood.pulse) {
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, now);
      g.connect(out);
      const o = this.osc(ctx, 'triangle', mood.root, 0, now);
      o.connect(g);
      v.parts.push({ nodes: [o, g], sources: [o], endAt: Infinity });
      v.pulseGain = g;
    }
    this.schedule(v, now);
    return v;
  }

  private osc(ctx: AudioContext, type: OscillatorType, freq: number, cents: number, at: number): OscillatorNode {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, at);
    if (cents) o.detune.setValueAtTime(cents, at);
    o.start(at);
    return o;
  }

  /** Schedule chords and pulse beats that start before `now + LOOKAHEAD_SEC`. A few iterations at most. */
  private schedule(v: Voice, now: number): void {
    if (v.endsAt !== Infinity) return;
    const ctx = this.mixer.context()!;
    const horizon = now + LOOKAHEAD_SEC;
    v.nextChordAt = Math.max(v.nextChordAt, now);
    for (let i = 0; i < 4 && v.nextChordAt < horizon; i++) this.chord(ctx, v, v.nextChordAt);
    const pulse = v.mood.pulse;
    if (pulse && v.pulseGain) {
      const beatSec = 60 / pulse.bpm;
      const g = v.pulseGain.gain;
      v.nextBeatAt = Math.max(v.nextBeatAt, now);
      for (let i = 0; i < 16 && v.nextBeatAt < horizon; i++) {
        const t = v.nextBeatAt;
        const peak = pulse.gain * PULSE_ACCENTS[v.beat % PULSE_ACCENTS.length];
        g.setValueAtTime(0, t);
        g.linearRampToValueAtTime(peak, t + 0.015);
        g.linearRampToValueAtTime(0, t + beatSec * 0.45);
        v.beat += 1;
        v.nextBeatAt = t + beatSec;
      }
    }
  }

  /** One chord of the pad (and maybe a melody note), starting at `t`. Advances the voice's RNG. */
  private chord(ctx: AudioContext, v: Voice, t: number): void {
    const { mood, rng } = v;
    const scale = mood.scale;
    // Chords stack every other degree; only degrees with a perfect fifth (no diminished chords).
    const usable = scale.map((_, i) => i).filter((i) => step(scale, i + 4) - step(scale, i) === 7);
    let degree = 0;
    if (v.degree !== null) {
      const next = usable.filter((i) => i !== v.degree);
      degree = next.length > 0 ? next[Math.floor(rng() * next.length)] : usable[0] ?? 0;
    }
    v.degree = degree;
    const [lo, hi] = mood.chordSec;
    const dur = lo + rng() * (hi - lo);
    const attack = Math.min(CHORD_ATTACK_SEC, dur * 0.4);
    const end = t + dur + CHORD_RELEASE_SEC;

    const waves = mood.pad.waves;
    const level = mood.pad.gain / (3 * waves.length);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(level, t + attack);
    g.gain.setValueAtTime(level, t + dur);
    g.gain.linearRampToValueAtTime(0, end);
    g.connect(v.filter);
    const part: Part = { nodes: [g], sources: [], endAt: end + SWEEP_MARGIN_SEC };
    for (const d of [degree, degree + 2, degree + 4]) {
      const f = hz(mood.root, 12 + step(scale, d));
      waves.forEach((wave, w) => {
        const o = this.osc(ctx, wave, f, PAD_DETUNE[w % PAD_DETUNE.length], t);
        o.stop(end);
        o.connect(g);
        part.nodes.push(o);
        part.sources.push(o);
      });
    }
    v.parts.push(part);
    v.nextChordAt = t + dur;

    // Always draw, so the sequence does not depend on whether the mood has a melody.
    const roll = rng();
    const when = t + dur * (0.2 + 0.5 * rng());
    const note = Math.floor(rng() * scale.length);
    const melody = mood.melody;
    if (melody && roll < melody.chance) {
      const mEnd = when + MELODY_RING_SEC;
      const mg = ctx.createGain();
      mg.gain.setValueAtTime(0, when);
      mg.gain.linearRampToValueAtTime(melody.gain, when + MELODY_ATTACK_SEC);
      mg.gain.linearRampToValueAtTime(0, mEnd);
      mg.connect(v.out);
      const o = this.osc(ctx, 'sine', hz(mood.root, 24 + step(scale, note)), 0, when);
      o.stop(mEnd);
      o.connect(mg);
      v.parts.push({ nodes: [o, mg], sources: [o], endAt: mEnd + SWEEP_MARGIN_SEC });
    }
  }

  private fadeOut(v: Voice, now: number, fade: number): void {
    const p = v.out.gain;
    p.cancelScheduledValues(now);
    p.setValueAtTime(p.value, now);
    p.linearRampToValueAtTime(0, now + fade);
    v.endsAt = Math.min(v.endsAt, now + fade);
  }

  /** Disconnect finished parts, and stop and disconnect every node of a voice whose fade is over. */
  private sweep(now: number): void {
    this.voices = this.voices.filter((v) => {
      if (v.endsAt <= now) {
        for (const part of v.parts) this.release(part, true);
        v.parts = [];
        return false;
      }
      v.parts = v.parts.filter((part) => {
        if (part.endAt > now) return true;
        this.release(part, false);
        return false;
      });
      return true;
    });
  }

  private release(part: Part, stop: boolean): void {
    for (const s of stop ? part.sources : []) {
      try {
        s.stop();
      } catch {
        // already stopped
      }
    }
    for (const n of part.nodes) {
      try {
        n.disconnect();
      } catch {
        // already disconnected
      }
    }
  }
}
