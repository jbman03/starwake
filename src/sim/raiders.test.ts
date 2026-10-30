import { describe, expect, it } from 'vitest';
import { testData } from '../data/testData';
import { demandTerms, dumpCargo, payCredits } from './raiders';
import { newWorld } from './world';

const data = testData();
const withHold = (credits: number, cargo: Record<string, number>) => ({ ...newWorld(data, 3), credits, cargo });
const ids = Object.keys(data.commodities).sort((a, b) => data.commodities[b].basePrice - data.commodities[a].basePrice);
const [dear, , cheap] = [ids[0], ids[1], ids[ids.length - 1]];

describe('raider demands', () => {
  it('terms: 5% of credits, at least 300, rounded to 10', () => {
    expect(demandTerms(withHold(100, {}), data).credits).toBe(300);
    expect(demandTerms(withHold(10000, {}), data).credits).toBe(500);
    expect(demandTerms(withHold(10234, {}), data).credits).toBe(510);
    expect(demandTerms(withHold(100, {}), data).cargo).toBeNull();
  });

  it('dump picks the most valuable 10 t', () => {
    const w = withHold(100, { [cheap]: 8, [dear]: 6 });
    const t = demandTerms(w, data);
    expect(t.cargo).toMatchObject({ good: dear, tons: 10 });
    expect(dumpCargo(w, t)!.cargo).toEqual({ [cheap]: 4 });
    const small = withHold(100, { [cheap]: 3 });
    expect(demandTerms(small, data).cargo).toMatchObject({ good: cheap, tons: 3 });
    expect(dumpCargo(small, demandTerms(small, data))!.cargo).toEqual({});
  });

  it('pay refuses when short', () => {
    const w = withHold(299, {});
    expect(payCredits(w, demandTerms(w, data))).toBeNull();
    const rich = withHold(1000, {});
    expect(payCredits(rich, demandTerms(rich, data))!.credits).toBe(700);
  });

  it('dump refuses with an empty hold', () => {
    const w = withHold(1000, {});
    expect(dumpCargo(w, demandTerms(w, data))).toBeNull();
  });
});
