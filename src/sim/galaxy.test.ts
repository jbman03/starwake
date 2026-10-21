import { describe, expect, it } from 'vitest';
import { testData } from '../data/testData';
import type { GameData } from '../data/schemas';
import { fuelCheck, hopDistance, lanesOf, revealOnArrival, revealWithin, routeBetween, systemsWithin } from './galaxy';

const data = testData();

/** A chain a-b-c-d for gap edge cases. */
function chain(): GameData {
  const ids = ['a', 'b', 'c', 'd'];
  const systems: Record<string, unknown> = {};
  ids.forEach((id, i) => {
    systems[id] = { id, links: [ids[i - 1], ids[i + 1]].filter(Boolean) };
  });
  return { ...data, systems } as unknown as GameData;
}

describe('routeBetween', () => {
  it('returns [] when from === to', () => expect(routeBetween(chain(), 'a', 'a', () => true, [])).toEqual([]));
  it('excludes the start and includes the destination', () => {
    expect(routeBetween(chain(), 'a', 'd', () => true, [])).toEqual(['b', 'c', 'd']);
  });
  it('returns null when an intermediate system is not allowed', () => {
    expect(routeBetween(chain(), 'a', 'd', (id) => id !== 'c', [])).toBeNull();
  });
  it('does not require the destination itself to be allowed', () => {
    expect(routeBetween(chain(), 'a', 'c', (id) => id === 'b', [])).toEqual(['b', 'c']);
  });
  it('routes across the real galaxy', () => {
    const [from, to] = [Object.keys(data.systems)[0], 'tessaly'];
    const r = routeBetween(data, from, to, () => true, []);
    expect(r?.at(-1)).toBe(to);
    expect(r).not.toContain(from);
  });
});

describe('revealOnArrival', () => {
  it('marks the system known and its neighbours seen', () => {
    expect(revealOnArrival([], [], chain(), 'b', [])).toEqual({ known: ['b'], seen: ['a', 'c'] });
  });
  it('removes newly known systems from seen and never duplicates', () => {
    const r = revealOnArrival(['a'], ['b'], chain(), 'b', []);
    expect(r.known).toEqual(['a', 'b']);
    expect(r.seen).toEqual(['c']);
  });
});

describe('fuelCheck', () => {
  it('computes needed, have and reachable', () => {
    expect(fuelCheck(250, 3, data.config)).toEqual({ needed: 300, have: 250, reachable: 2 });
  });
});

describe('hopDistance', () => {
  it('counts hops', () => expect(hopDistance(chain(), 'a', 'd', [])).toBe(3));
  it('is 0 for the same system', () => expect(hopDistance(chain(), 'b', 'b', [])).toBe(0));
  it('is Infinity when disconnected', () => {
    const d = chain();
    (d.systems as Record<string, { links: string[] }>).z = { links: [] };
    expect(hopDistance(d, 'a', 'z', [])).toBe(Infinity);
  });
});

describe('hidden lanes', () => {
  const flags = ['hushwater-lane'];
  it('routeBetween ignores hidden lane without the flag', () => {
    expect(routeBetween(data, 'skerry', 'hushwater', () => true, [])).toBeNull();
  });
  it('routes Skerry to Hushwater in one hop, and back, once the flag is set', () => {
    expect(routeBetween(data, 'skerry', 'hushwater', () => true, flags)).toEqual(['hushwater']);
    expect(routeBetween(data, 'hushwater', 'skerry', () => true, flags)).toEqual(['skerry']);
  });
  it('lanesOf adds hidden and reverse lanes only with the flag', () => {
    expect(lanesOf(data, 'skerry', [])).not.toContain('hushwater');
    expect(lanesOf(data, 'hushwater', [])).toEqual([]);
    expect(lanesOf(data, 'skerry', flags)).toContain('hushwater');
    expect(lanesOf(data, 'hushwater', flags)).toEqual(['skerry']);
  });
  it('chart never reveals hidden', () => {
    const r = revealWithin([], [], data, 'skerry', 4, []);
    expect([...r.known, ...r.seen]).not.toContain('hushwater');
    expect(systemsWithin(data, 'skerry', 4, [])).not.toContain('hushwater');
    expect(systemsWithin(data, 'skerry', 1, flags)).toContain('hushwater');
  });
  it('arriving at Skerry shows Hushwater as seen only with the flag', () => {
    expect(revealOnArrival([], [], data, 'skerry', []).seen).not.toContain('hushwater');
    expect(revealOnArrival([], [], data, 'skerry', flags).seen).toContain('hushwater');
  });
  it('hopDistance only counts hidden lanes with the flag', () => {
    expect(hopDistance(data, 'skerry', 'hushwater', [])).toBe(Infinity);
    expect(hopDistance(data, 'skerry', 'hushwater', flags)).toBe(1);
  });
});
