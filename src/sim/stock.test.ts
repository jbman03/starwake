import { describe, it, expect } from 'vitest';
import { testData } from '../data/testData';
import { governmentOf, outfitStock, sells, shipStock } from './stock';

const d = testData();
const ids = (xs: { id: string }[]) => xs.map((x) => x.id);

describe('port stock', () => {
  it('halcyon (tier 3, concord, outfitter only) sells basics but nothing restricted or high tier', () => {
    expect(governmentOf('halcyon', d)).toBe('concord');
    const o = ids(outfitStock('halcyon', d));
    expect(o).toContain('cargo-pod');
    expect(o).not.toContain('heavy-armor');
    expect(o).not.toContain('frontier-rack');
    expect(shipStock('halcyon', d)).toEqual([]);
  });

  it('vanterre sells the tier-5 concord hulls', () => {
    const s = ids(shipStock('vanterre', d));
    expect(s).toContain('meridian');
    expect(s).toContain('bastion');
  });

  it('wrenhold sells ironback but not kestrel', () => {
    const s = ids(shipStock('wrenhold', d));
    expect(s).toContain('ironback');
    expect(s).not.toContain('kestrel');
  });

  it('lastlight beacon sells the scout and the salvage tank', () => {
    expect(ids(shipStock('lastlight-beacon', d))).toContain('scout');
    expect(ids(outfitStock('lastlight-beacon', d))).toContain('salvage-tank');
  });

  it('stock sorts by tier then price; ports without the service are empty', () => {
    const s = shipStock('vanterre', d);
    for (let i = 1; i < s.length; i++) {
      const a = s[i - 1], b = s[i];
      expect(a.techTier < b.techTier || (a.techTier === b.techTier && a.price <= b.price)).toBe(true);
    }
    expect(outfitStock('merrow', d)).toEqual([]);
  });

  it('sells needs tier and government', () => {
    expect(sells('halcyon', { techTier: 4 }, d)).toBe(false);
    expect(sells('halcyon', { techTier: 3, soldBy: ['free-reach'] }, d)).toBe(false);
    expect(sells('halcyon', { techTier: 3, soldBy: ['concord'] }, d)).toBe(true);
  });
});
