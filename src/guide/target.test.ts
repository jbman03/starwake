import { describe, expect, it } from 'vitest';
import type { GameData } from '../data/schemas';
import { testData } from '../data/testData';
import { hopDistance } from '../sim/galaxy';
import { setRoute } from '../sim/world';
import { newWorld } from '../sim/world';
import { pickTarget, pickTargetNear } from './target';

const data = testData();
const world = newWorld(data, 1);

describe('pickTarget', () => {
  it('finds a reachable High port for Halcyon', () => {
    const t = pickTarget(world, data, 'halcyon');
    expect(t).not.toBeNull();
    if (!t) return;
    expect(data.planets.halcyon.market?.[t.good]).toBe('low');
    expect(data.planets[t.port].market?.[t.good]).toBe('high');
    expect(data.planets[t.port].systemId).toBe(t.system);
    expect(world.known).toContain(t.system);
    expect(t.system).not.toBe('calder');
    const hops = hopDistance(data, 'calder', t.system);
    expect(hops).toBeGreaterThanOrEqual(1);
    expect(hops).toBeLessThanOrEqual(3);
  });

  it('is stable and ignores unique goods', () => {
    const a = pickTarget(world, data, 'halcyon');
    expect(pickTarget(world, data, 'halcyon')).toEqual(a);
    // Halcyon's Low copperwine has a unique origin; it must never be chosen.
    expect(a?.good).not.toBe('copperwine');
  });

  it('picks the nearest selling port, ties broken by port id', () => {
    const t = pickTarget(world, data, 'halcyon');
    if (!t) throw new Error('no target');
    const best = hopDistance(data, 'calder', t.system);
    for (const p of Object.values(data.planets)) {
      if (p.market?.[t.good] !== 'high' || !world.known.includes(p.systemId) || p.systemId === 'calder') continue;
      const h = hopDistance(data, 'calder', p.systemId);
      expect(h > best || (h === best && p.id >= t.port)).toBe(true);
    }
  });

  it('only sells into known systems', () => {
    expect(pickTarget({ ...world, known: ['calder'] }, data, 'halcyon')).toBeNull();
  });

  it('is null for a port with no market or no Low good', () => {
    expect(pickTarget(world, data, 'tollgate')).toBeNull();
    expect(pickTarget(world, data, 'nowhere')).toBeNull();
  });

  it('respects the 3-hop limit', () => {
    // A chain a-b-c-d-e: the only High port is 4 hops from the Low one.
    const ids = ['a', 'b', 'c', 'd', 'e'];
    const systems: Record<string, unknown> = {};
    ids.forEach((id, i) => (systems[id] = { id, links: [ids[i - 1], ids[i + 1]].filter(Boolean) }));
    const mk = (id: string, sys: string, lvl: 'low' | 'high') => ({
      id,
      systemId: sys,
      services: ['exchange'],
      market: { food: lvl },
    });
    const planets = { p1: mk('p1', 'a', 'low'), p2: mk('p2', 'e', 'high') };
    const d = { ...data, systems, planets, commodities: { food: data.commodities.food } } as unknown as GameData;
    const w = { ...world, known: ids };
    expect(pickTarget(w, d, 'p1')).toBeNull();
    const near = { ...planets, p2: mk('p2', 'd', 'high') };
    expect(pickTarget(w, { ...d, planets: near } as unknown as GameData, 'p1')).toEqual({
      good: 'food',
      system: 'd',
      port: 'p2',
    });
  });
});

describe('pickTarget reachability', () => {
  // Lanes: a-b-d (short, b uncharted) and a-x-y-d (longer, all charted). Low food at a, High at d.
  const mk = (id: string, sys: string, lvl: 'low' | 'high') => ({ id, systemId: sys, services: ['exchange'], market: { food: lvl } });
  const build = (links: Record<string, string[]>, cfg: Record<string, unknown> = {}) => {
    const systems: Record<string, unknown> = {};
    for (const [id, l] of Object.entries(links)) systems[id] = { id, links: l };
    return {
      ...data,
      config: { ...data.config, ...cfg },
      systems,
      planets: { p1: mk('p1', 'a', 'low'), p2: mk('p2', 'd', 'high') },
      commodities: { food: data.commodities.food },
    } as unknown as GameData;
  };
  const w = (known: string[], fuel = 1000) => ({ ...world, systemId: 'a', known, seen: [], ship: { ...world.ship, fuel } });

  it('rejects a target whose only short path crosses an uncharted system', () => {
    const d = build({ a: ['b'], b: ['a', 'd'], d: ['b'] });
    expect(setRoute(w(['a', 'd']), d, 'd').ok).toBe(false); // the map can't plot it
    expect(pickTarget(w(['a', 'd']), d, 'p1')).toBeNull();
  });

  it('takes the longer charted route instead when there is one', () => {
    const d = build({ a: ['b', 'x'], b: ['a', 'd'], x: ['a', 'y'], y: ['x', 'd'], d: ['b', 'y'] });
    expect(pickTarget(w(['a', 'x', 'y', 'd']), d, 'p1')).toEqual({ good: 'food', system: 'd', port: 'p2' });
  });

  it('rejects a charted route longer than 3 hops even if the lane graph is short elsewhere', () => {
    const d = build({ a: ['x'], x: ['a', 'y'], y: ['x', 'z'], z: ['y', 'd'], d: ['z'] });
    expect(pickTarget(w(['a', 'x', 'y', 'z', 'd']), d, 'p1')).toBeNull();
  });

  it('requires fuel for the whole trip', () => {
    const d = build({ a: ['d'], d: ['a'] }, { fuelPerJump: 10 });
    expect(pickTarget(w(['a', 'd'], 9), d, 'p1')).toBeNull();
    expect(pickTarget(w(['a', 'd'], 10), d, 'p1')).not.toBeNull();
  });

  it('a new pilot can plot and afford the real Halcyon target', () => {
    const t = pickTarget(world, data, 'halcyon');
    if (!t) throw new Error('no target');
    const r = setRoute(world, data, t.system);
    expect(r.ok).toBe(true);
    expect(world.ship.fuel).toBeGreaterThanOrEqual(r.world.route.length * data.config.fuelPerJump);
  });
});

describe('pickTargetNear', () => {
  it('finds a trade from the nearest port when needed', () => {
    expect(pickTargetNear(world, data)).not.toBeNull();
  });
  it('measures from the player, not from the selling port', () => {
    const t = pickTargetNear({ ...world, systemId: 'minster' }, data);
    if (!t) throw new Error('no target');
    const r = setRoute({ ...world, systemId: 'minster', missions: [] }, data, t.system);
    expect(r.ok).toBe(true);
    expect(r.world.route.length).toBeLessThanOrEqual(3);
  });
  it('is null when nothing is tradeable', () => {
    expect(pickTargetNear({ ...world, known: ['calder'] }, data)).toBeNull();
  });
});
