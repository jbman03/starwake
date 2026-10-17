import { describe, expect, it } from 'vitest';
import { testData } from '../data/testData';
import type { GameData } from '../data/schemas';
import { fuelCheck, hopDistance, revealOnArrival, routeBetween } from './galaxy';

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
  it('returns [] when from === to', () => expect(routeBetween(chain(), 'a', 'a', () => true)).toEqual([]));
  it('excludes the start and includes the destination', () => {
    expect(routeBetween(chain(), 'a', 'd', () => true)).toEqual(['b', 'c', 'd']);
  });
  it('returns null when an intermediate system is not allowed', () => {
    expect(routeBetween(chain(), 'a', 'd', (id) => id !== 'c')).toBeNull();
  });
  it('does not require the destination itself to be allowed', () => {
    expect(routeBetween(chain(), 'a', 'c', (id) => id === 'b')).toEqual(['b', 'c']);
  });
  it('routes across the real galaxy', () => {
    const [from, to] = [Object.keys(data.systems)[0], 'tessaly'];
    const r = routeBetween(data, from, to, () => true);
    expect(r?.at(-1)).toBe(to);
    expect(r).not.toContain(from);
  });
});

describe('revealOnArrival', () => {
  it('marks the system known and its neighbours seen', () => {
    expect(revealOnArrival([], [], chain(), 'b')).toEqual({ known: ['b'], seen: ['a', 'c'] });
  });
  it('removes newly known systems from seen and never duplicates', () => {
    const r = revealOnArrival(['a'], ['b'], chain(), 'b');
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
  it('counts hops', () => expect(hopDistance(chain(), 'a', 'd')).toBe(3));
  it('is 0 for the same system', () => expect(hopDistance(chain(), 'b', 'b')).toBe(0));
  it('is Infinity when disconnected', () => {
    const d = chain();
    (d.systems as Record<string, { links: string[] }>).z = { links: [] };
    expect(hopDistance(d, 'a', 'z')).toBe(Infinity);
  });
});
