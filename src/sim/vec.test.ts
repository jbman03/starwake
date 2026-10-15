import { describe, expect, it } from 'vitest';
import { angleOf, fromAngle, len, norm } from './vec';

describe('vec', () => {
  it('fromAngle(0) points along +x', () => {
    const v = fromAngle(0);
    expect(v.x).toBeCloseTo(1);
    expect(v.y).toBeCloseTo(0);
  });
  it('len of 3,4 is 5', () => {
    expect(len({ x: 3, y: 4 })).toBe(5);
  });
  it('norm of zero vector is zero, not NaN', () => {
    expect(norm({ x: 0, y: 0 })).toEqual({ x: 0, y: 0 });
  });
  it('angleOf round-trips fromAngle', () => {
    expect(angleOf(fromAngle(1.2))).toBeCloseTo(1.2);
  });
});
