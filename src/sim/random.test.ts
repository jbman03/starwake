import { describe, it, expect } from 'vitest';
import { hashString, mulberry32, randInt, pick } from './random';

describe('random', () => {
  it('same seed gives the same sequence', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    for (let i = 0; i < 20; i++) expect(a()).toBe(b());
  });

  it('different seeds differ and values are in [0,1)', () => {
    expect(mulberry32(1)()).not.toBe(mulberry32(2)());
    const r = mulberry32(7);
    for (let i = 0; i < 1000; i++) {
      const v = r();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('randInt is inclusive and bounded', () => {
    const r = mulberry32(9);
    const seen = new Set<number>();
    for (let i = 0; i < 1000; i++) seen.add(randInt(r, 1, 3));
    expect([...seen].sort()).toEqual([1, 2, 3]);
  });

  it('hashString distinguishes parts', () => {
    expect(hashString('a', 1)).not.toBe(hashString('a', 2));
    expect(hashString('a', 1)).toBe(hashString('a', 1));
  });

  it('pick returns a list member', () => {
    expect(['x', 'y']).toContain(pick(mulberry32(3), ['x', 'y']));
  });
});
