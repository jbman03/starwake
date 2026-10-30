import { describe, expect, it } from 'vitest';
import { fullHull, PLAYER_ID } from '../sim/combat';
import {
  burstParticles,
  hullBars,
  particleCount,
  projectileDrawPos,
  pushTrail,
  shotColor,
  SHOT_COLORS,
  sparkCount,
  sparkPoints,
  TRAIL_POINTS,
} from './combatFx';

describe('combatFx', () => {
  it('low quality uses fewer particles', () => {
    expect(particleCount('high')).toBe(24);
    expect(particleCount('low')).toBe(8);
    expect(sparkCount('low')).toBeLessThan(sparkCount('high'));
    expect(burstParticles(7, particleCount('low'))).toHaveLength(8);
    expect(burstParticles(7, particleCount('high'))).toHaveLength(24);
  });

  it('a burst is the same for the same seed and spreads all round', () => {
    const a = burstParticles(42, 24);
    expect(burstParticles(42, 24)).toEqual(a);
    expect(burstParticles(43, 24)).not.toEqual(a);
    for (const p of a) {
      expect(Math.hypot(p.dx, p.dy)).toBeCloseTo(1, 6);
      expect(p.speed).toBeGreaterThan(0);
      expect(p.size).toBeGreaterThan(0);
    }
    // Every quadrant gets some.
    const quads = new Set(a.map((p) => `${Math.sign(p.dx)}${Math.sign(p.dy)}`));
    expect(quads.size).toBe(4);
  });

  it('hull bars are fractions of the maxima, clamped, and empty with no shield generator', () => {
    expect(hullBars(fullHull(100, 50))).toEqual({ shields: 1, armor: 1 });
    expect(hullBars({ ...fullHull(100, 50), shields: 25, armor: 10 })).toEqual({ shields: 0.25, armor: 0.2 });
    expect(hullBars({ ...fullHull(0, 50), armor: -5 })).toEqual({ shields: 0, armor: 0 });
  });

  it('the player and other ships shoot in different colours', () => {
    expect(shotColor(PLAYER_ID)).toBe(SHOT_COLORS.player);
    expect(shotColor('npc-1')).toBe(SHOT_COLORS.other);
    expect(SHOT_COLORS.player).not.toBe(SHOT_COLORS.other);
  });

  it('a trail keeps the last six points, newest first', () => {
    let t: { x: number; y: number }[] = [];
    for (let i = 0; i < 10; i++) t = pushTrail(t, { x: i, y: 0 });
    expect(t).toHaveLength(TRAIL_POINTS);
    expect(TRAIL_POINTS).toBe(6);
    expect(t[0]).toEqual({ x: 9, y: 0 });
    expect(t[5]).toEqual({ x: 4, y: 0 });
  });

  it('sparks sit within the ship and change over time', () => {
    const a = sparkPoints(5, 1, 20, 4);
    expect(a).toHaveLength(4);
    for (const p of a) expect(Math.hypot(p.x, p.y)).toBeLessThanOrEqual(20);
    expect(sparkPoints(5, 1, 20, 4)).toEqual(a);
    expect(sparkPoints(5, 1.5, 20, 4)).not.toEqual(a);
  });

  it('projectiles are drawn back along their path to match the interpolated ship', () => {
    const p = { pos: { x: 100, y: 0 }, vel: { x: 600, y: 0 } };
    expect(projectileDrawPos(p, 1, 1 / 60)).toEqual({ x: 100, y: 0 });
    expect(projectileDrawPos(p, 0, 1 / 60).x).toBeCloseTo(90, 6);
  });
});
