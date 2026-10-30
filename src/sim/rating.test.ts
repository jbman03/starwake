import { describe, expect, it } from 'vitest';
import { combatRating } from './rating';

const k = (kills: number, captures = 0) => combatRating({ kills, captures });

describe('combatRating', () => {
  it('maps the score boundaries', () => {
    const cases: [number, string][] = [
      [0, 'Harmless'], [1, 'Green'], [9, 'Green'], [10, 'Steady'], [29, 'Steady'], [30, 'Veteran'],
      [74, 'Veteran'], [75, 'Ace'], [149, 'Ace'], [150, 'Legend'],
    ];
    for (const [kills, name] of cases) expect(k(kills), String(kills)).toBe(name);
  });
  it('counts a capture as two kills', () => {
    expect(k(0, 1)).toBe('Green');
    expect(k(0, 5)).toBe('Steady');
    expect(k(1, 37)).toBe('Ace');
    expect(k(0, 75)).toBe('Legend');
  });
});
