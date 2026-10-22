import { describe, expect, it } from 'vitest';
import { testData } from '../data/testData';
import type { GameData } from '../data/schemas';
import { fuelCheck, hopDistance, lanesOf, revealOnArrival, revealWithin, routeBetween, systemsWithin, visibleSystemCount } from './galaxy';
import { mapModel } from '../ui/starMap';
import { newWorld } from './world';

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

describe('the Dimming', () => {
  const dim = Object.values(data.systems).filter((s) => s.government === 'unlit').map((s) => s.id);
  const total = Object.keys(data.systems).length;
  const open = ['dimming-lane'];
  const world = newWorld(data, 1);
  it('has 9 systems, all hidden behind dimming-lane', () => {
    expect(dim).toHaveLength(9);
    for (const id of dim) expect(data.systems[id].unlockFlag).toBe('dimming-lane');
  });
  describe('hidden before dimming-lane', () => {
    it('mapModel leaves out every Dimming system', () => {
      const ids = mapModel({ ...world, systemId: 'oxbow', known: [...world.known, 'oxbow'] }, data).nodes.map((n) => n.id);
      for (const id of dim) expect(ids).not.toContain(id);
    });
    it('routeBetween from Oxbow finds no route in, and lanesOf shows no lane', () => {
      expect(lanesOf(data, 'oxbow', [])).not.toContain('gloam');
      expect(routeBetween(data, 'oxbow', 'gloam', () => true, [])).toBeNull();
      expect(routeBetween(data, 'oxbow', 'vane', () => true, [])).toBeNull();
    });
    it('revealWithin and revealOnArrival at Oxbow never show a Dimming system', () => {
      const all = (r: { known: string[]; seen: string[] }) => [...r.known, ...r.seen];
      for (const id of dim) {
        expect(all(revealWithin([], [], data, 'oxbow', 6, []))).not.toContain(id);
        expect(all(revealOnArrival([], [], data, 'oxbow', []))).not.toContain(id);
      }
    });
    it('visibleSystemCount excludes all nine, and hopDistance is Infinity', () => {
      expect(visibleSystemCount(data, [])).toBe(total - 10);
      expect(hopDistance(data, 'oxbow', 'gloam', [])).toBe(Infinity);
    });
  });
  describe('once dimming-lane is set', () => {
    it('Oxbow and Gloam share a lane, and the whole region is reachable', () => {
      expect(lanesOf(data, 'oxbow', open)).toContain('gloam');
      expect(lanesOf(data, 'gloam', open)).toContain('oxbow');
      expect(routeBetween(data, 'oxbow', 'gloam', () => true, open)).toEqual(['gloam']);
      for (const id of dim) expect(hopDistance(data, 'oxbow', id, open)).toBeLessThan(Infinity);
    });
    it('reveals and counts the region', () => {
      expect(revealOnArrival([], [], data, 'oxbow', open).seen).toContain('gloam');
      expect(revealWithin([], [], data, 'oxbow', 1, open).known).toContain('gloam');
      expect(visibleSystemCount(data, open)).toBe(total - 1);
      const m = mapModel({ ...world, flags: open, known: [...world.known, 'oxbow', 'gloam'] }, data);
      expect(m.nodes.some((n) => n.id === 'gloam')).toBe(true);
    });
  });
  describe('flags are separate', () => {
    it('hushwater-lane alone does not open the Dimming', () => {
      const f = ['hushwater-lane'];
      expect(lanesOf(data, 'oxbow', f)).not.toContain('gloam');
      expect(hopDistance(data, 'oxbow', 'gloam', f)).toBe(Infinity);
      expect(visibleSystemCount(data, f)).toBe(total - 9);
    });
    it('dimming-lane alone does not open Hushwater', () => {
      expect(lanesOf(data, 'skerry', open)).not.toContain('hushwater');
      expect(hopDistance(data, 'skerry', 'hushwater', open)).toBe(Infinity);
      expect(lanesOf(data, 'skerry', ['hushwater-lane'])).toContain('hushwater');
    });
  });
});
