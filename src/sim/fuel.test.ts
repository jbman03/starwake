import { describe, expect, it } from 'vitest';
import { fuelText, jumpsOf } from './fuel';

describe('fuel text', () => {
  it('is singular for exactly one jump', () => {
    expect(fuelText(0)).toBe('Fuel: 0 jumps');
    expect(fuelText(1)).toBe('Fuel: 1 jump');
    expect(fuelText(3)).toBe('Fuel: 3 jumps');
  });
  it('jumpsOf floors whole jumps', () => {
    expect(jumpsOf(300, 100)).toBe(3);
    expect(jumpsOf(199, 100)).toBe(1);
    expect(jumpsOf(99, 100)).toBe(0);
    expect(jumpsOf(5, 0)).toBe(Infinity);
  });
});
