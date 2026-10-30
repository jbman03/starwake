/** Combat effect helpers, free of Phaser so they are unit-tested: particle seeds, bar fractions, colours. */
import type { Settings } from '../save/settings';
import { PLAYER_ID, type Hull } from '../sim/combat';
import { hashString, mulberry32 } from '../sim/random';
import type { Vec2 } from '../sim/vec';

type Quality = Settings['quality'];

/** Explosion particles per burst. */
const EXPLOSION_PARTICLES: Record<Quality, number> = { high: 24, low: 8 };
/** Sparks shown at once on a disabled ship. */
const SPARKS: Record<Quality, number> = { high: 4, low: 2 };
/** Points kept in a rocket's or seeker's trail. */
export const TRAIL_POINTS = 6;

/** Bolt and beam colours: the player's are cyan, everyone else's are a warm red. */
export const SHOT_COLORS = { player: 0x7fe9ff, other: 0xff7a5a } as const;
/** The rest of the palette, chosen to read on the dark background. */
export const FX_COLORS = {
  shield: 0x6fc4ff,
  armorHit: 0xffb15a,
  missileHead: 0xfff0c0,
  missileTrail: 0xff9a4a,
  explosion: [0xfff4d0, 0xffc14a, 0xff7a2a, 0xd8452a] as const,
  spark: [0xfff2a8, 0x9fe0ff] as const,
  barTrack: 0x1a2433,
  barShield: 0x4aa8ff,
  barArmor: 0xc9a24a,
} as const;

export const particleCount = (q: Quality): number => EXPLOSION_PARTICLES[q];
export const sparkCount = (q: Quality): number => SPARKS[q];

export const shotColor = (ownerId: string): number => (ownerId === PLAYER_ID ? SHOT_COLORS.player : SHOT_COLORS.other);

export interface Particle {
  /** Unit direction. */
  dx: number;
  dy: number;
  /** px/s. */
  speed: number;
  /** Radius in px. */
  size: number;
  /** Index into FX_COLORS.explosion. */
  color: number;
}

/**
 * A burst of `count` particles, the same for the same seed. Directions are spread evenly with a
 * little jitter, so even a low-quality burst of 8 goes all round.
 */
export function burstParticles(seed: number, count: number): Particle[] {
  const r = mulberry32(seed);
  const out: Particle[] = [];
  for (let i = 0; i < count; i++) {
    const a = ((i + r() * 0.8) / count) * Math.PI * 2;
    out.push({
      dx: Math.cos(a),
      dy: Math.sin(a),
      speed: 40 + r() * 140,
      size: 1.5 + r() * 2.5,
      color: Math.floor(r() * FX_COLORS.explosion.length),
    });
  }
  return out;
}

/** Shield and armor as 0–1 fractions of their maxima (0 when the ship has none). */
export function hullBars(h: Hull): { shields: number; armor: number } {
  const frac = (v: number, max: number) => (max > 0 ? Math.max(0, Math.min(1, v / max)) : 0);
  return { shields: frac(h.shields, h.maxShields), armor: frac(h.armor, h.maxArmor) };
}

/** `trail` with `p` added at the front, keeping the newest TRAIL_POINTS. */
export function pushTrail(trail: readonly Vec2[], p: Vec2, max = TRAIL_POINTS): Vec2[] {
  return [{ x: p.x, y: p.y }, ...trail].slice(0, max);
}

/** How often the sparks on a disabled ship jump to new spots (per second). */
const SPARK_RATE = 6;

/** Offsets (from the ship's centre) of the sparks on a disabled ship at `timeSec`; all within `radius`. */
export function sparkPoints(seed: number, timeSec: number, radius: number, count: number): Vec2[] {
  const r = mulberry32(hashString(seed, Math.floor(timeSec * SPARK_RATE)));
  const out: Vec2[] = [];
  for (let i = 0; i < count; i++) {
    const a = r() * Math.PI * 2;
    const d = Math.sqrt(r()) * radius * 0.8;
    out.push({ x: Math.cos(a) * d, y: Math.sin(a) * d });
  }
  return out;
}

/**
 * Where to draw a projectile so it matches the ship, which is drawn `alpha` of the way from its
 * previous tick to the current one: back along its velocity by the part of the tick not yet shown.
 */
export function projectileDrawPos(p: { pos: Vec2; vel: Vec2 }, alpha: number, dt: number): Vec2 {
  const back = (1 - alpha) * dt;
  return { x: p.pos.x - p.vel.x * back, y: p.pos.y - p.vel.y * back };
}
