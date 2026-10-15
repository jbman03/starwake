import { describe, it, expect } from 'vitest';
import { FixedStepper } from './stepper';

describe('FixedStepper', () => {
  it('advance(1/30) ticks twice', () => {
    let n = 0;
    new FixedStepper().advance(1 / 30, () => n++);
    expect(n).toBe(2);
  });
  it('accumulates small frames and returns alpha in [0,1)', () => {
    const s = new FixedStepper();
    let n = 0;
    s.advance(0.01, () => n++);
    const a = s.advance(0.01, () => n++);
    expect(n).toBe(1);
    expect(a).toBeGreaterThanOrEqual(0);
    expect(a).toBeLessThan(1);
  });
  it('clamps a 10 minute stall to at most 15 ticks', () => {
    let n = 0;
    new FixedStepper().advance(600, () => n++);
    expect(n).toBeLessThanOrEqual(15);
    expect(n).toBeGreaterThan(0);
  });
  it('passes the fixed step as dt', () => {
    const dts: number[] = [];
    new FixedStepper().advance(1 / 60, (dt) => dts.push(dt));
    expect(dts).toEqual([1 / 60]);
  });
});
