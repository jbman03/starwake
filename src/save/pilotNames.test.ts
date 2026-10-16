import { describe, expect, it } from 'vitest';
import { CALLSIGNS, FIRST_NAMES, randomPilotName, SURNAMES } from './pilotNames';

/** Deterministic generator: cycles through the given values. */
function seq(...values: number[]): () => number {
  let i = 0;
  return () => values[i++ % values.length];
}

describe('randomPilotName', () => {
  it('builds "First Last" when the callsign roll misses', () => {
    // callsign roll 0.9 (miss), first index 0, surname index 0
    expect(randomPilotName(seq(0.9, 0, 0))).toBe(`${FIRST_NAMES[0]} ${SURNAMES[0]}`);
  });

  it('adds a callsign when the roll hits', () => {
    // callsign roll 0.1 (hit), first 0, surname 0, callsign 0
    expect(randomPilotName(seq(0.1, 0, 0, 0))).toBe(`${FIRST_NAMES[0]} '${CALLSIGNS[0]}' ${SURNAMES[0]}`);
  });

  it('is deterministic for the same random source', () => {
    expect(randomPilotName(seq(0.5, 0.3, 0.7, 0.2))).toBe(randomPilotName(seq(0.5, 0.3, 0.7, 0.2)));
  });

  it('never exceeds 24 characters, even with the longest parts and a callsign', () => {
    for (const f of FIRST_NAMES)
      for (const s of SURNAMES) {
        expect(`${f} ${s}`.length).toBeLessThanOrEqual(24);
      }
    for (let i = 0; i < 2000; i++) {
      const name = randomPilotName();
      expect(name.length).toBeGreaterThan(0);
      expect(name.length).toBeLessThanOrEqual(24);
      expect(name).toBe(name.trim());
    }
  });

  it('offers plenty of variety', () => {
    expect(FIRST_NAMES.length * SURNAMES.length).toBeGreaterThanOrEqual(1000);
    const seen = new Set(Array.from({ length: 200 }, () => randomPilotName()));
    expect(seen.size).toBeGreaterThan(150);
  });
});
