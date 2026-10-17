import { describe, expect, it } from 'vitest';
import { testData } from '../data/testData';
import {
  applyPressure,
  dailyNoise,
  displayLevel,
  economyDay,
  eventMult,
  LEVEL_MULT,
  localNews,
  priceOf,
  rumor,
} from './economy';
import type { MarketEvent, WorldState } from './types';
import { advanceDays, newWorld } from './world';

const data = testData();
const portWith = (good: string) => Object.values(data.planets).find((p) => p.market?.[good])!;

describe('prices', () => {
  it('level multipliers', () => {
    expect(LEVEL_MULT).toEqual({ low: 0.75, med: 1.0, high: 1.3 });
  });

  it('noise stays within ±6% and is stable', () => {
    for (let i = 0; i < 500; i++) {
      const n = dailyNoise(i * 7919, 'p', 'food', i);
      expect(n).toBeGreaterThanOrEqual(0.94);
      expect(n).toBeLessThanOrEqual(1.06);
    }
    expect(dailyNoise(1, 'p', 'food', 3)).toBe(dailyNoise(1, 'p', 'food', 3));
  });

  it('priceOf is null for untraded goods and rounds base x level x noise', () => {
    const w = newWorld(data, 5);
    const port = portWith('food');
    const level = port.market!.food;
    const expected = Math.round(data.commodities.food.basePrice * LEVEL_MULT[level] * dailyNoise(5, port.id, 'food', 0));
    expect(priceOf(w, data, port.id, 'food')).toBe(expected);
    const none = Object.values(data.planets).find((p) => !p.market?.glowmoss)!;
    expect(priceOf(w, data, none.id, 'glowmoss')).toBeNull();
  });

  it('priceOf combines level, event, pressure and noise exactly', () => {
    const port = portWith('food');
    const level = port.market!.food;
    const base: WorldState = { ...newWorld(data, 77), day: 13 };
    const ev: MarketEvent = { templateId: 'x', portId: port.id, commodityId: 'food', startDay: 12, days: 8, strength: 1.6 };
    const w: WorldState = { ...base, pressure: { [`${port.id}:food`]: 0.88 }, events: [ev] };
    const expected = Math.round(
      data.commodities.food.basePrice * LEVEL_MULT[level] * 1.6 * 0.88 * dailyNoise(77, port.id, 'food', 13),
    );
    expect(priceOf(w, data, port.id, 'food')).toBe(expected);
    // Each factor matters on its own.
    expect(priceOf({ ...w, events: [] }, data, port.id, 'food')).not.toBe(expected);
    expect(priceOf({ ...w, pressure: {} }, data, port.id, 'food')).not.toBe(expected);
  });

  it('displayLevel thresholds', () => {
    expect(displayLevel(85, 100)).toBe('low');
    expect(displayLevel(86, 100)).toBe('med');
    expect(displayLevel(114, 100)).toBe('med');
    expect(displayLevel(115, 100)).toBe('high');
  });
});

describe('event ramp', () => {
  const ev: MarketEvent = { templateId: 'x', portId: 'p', commodityId: 'food', startDay: 10, days: 8, strength: 1.6 };
  const at = (day: number): WorldState => ({ ...newWorld(data, 1), day, events: [ev] });
  it('full early, half-faded at 75%, gone at the end', () => {
    expect(eventMult(at(11), 'p', 'food')).toBeCloseTo(1.6);
    expect(eventMult(at(14), 'p', 'food')).toBeCloseTo(1.6);
    expect(eventMult(at(16), 'p', 'food')).toBeCloseTo(1.3);
    expect(eventMult(at(18), 'p', 'food')).toBe(1);
    expect(eventMult(at(11), 'q', 'food')).toBe(1);
  });
});

describe('pressure', () => {
  it('selling lowers, clamps, and recovers 25% a day', () => {
    let w = newWorld(data, 1);
    w = applyPressure(w, 'p', 'food', -40);
    expect(w.pressure['p:food']).toBeCloseTo(0.88);
    w = applyPressure(w, 'p', 'food', -200);
    expect(w.pressure['p:food']).toBe(0.7);
    w = applyPressure(newWorld(data, 1), 'p', 'food', 500);
    expect(w.pressure['p:food']).toBe(1.3);
    w = applyPressure(newWorld(data, 1), 'p', 'food', -40);
    expect(economyDay(w, data).pressure['p:food']).toBeCloseTo(0.91);
  });

  it.each([
    [1.003, undefined],
    [1.006, undefined], // recovers to 1.0045, then deleted
    [1.01, 1.0075], // recovers to 1.0075, still kept
    [1.03, 1.0225],
    [0.994, undefined],
  ])('recovery from %f leaves %s', (start, expected) => {
    const w = { ...newWorld(data, 1), pressure: { 'p:food': start } };
    const after = economyDay(w, data).pressure['p:food'];
    if (expected === undefined) expect(after).toBeUndefined();
    else expect(after).toBeCloseTo(expected, 6);
  });
});

describe('economyDay events', () => {
  it('over 60 days never exceeds 4 events or duplicates port+good', () => {
    let w = newWorld(data, 42);
    let spawned = 0;
    for (let i = 0; i < 60; i++) {
      const before = w.events.length;
      w = advanceDays(w, data, 1).world;
      if (w.events.length > before) spawned++;
      expect(w.events.length).toBeLessThanOrEqual(4);
      const keys = w.events.map((e) => `${e.portId}:${e.commodityId}`);
      expect(new Set(keys).size).toBe(keys.length);
      for (const e of w.events) expect(w.day).toBeLessThan(e.startDay + e.days);
    }
    expect(spawned).toBeGreaterThan(5);
  });

  it('across many seeds keeps the cap, uniqueness and market restriction', () => {
    for (let seed = 1; seed <= 10; seed++) {
      let w = newWorld(data, seed * 1013);
      for (let i = 0; i < 120; i++) {
        w = advanceDays(w, data, 1).world;
        expect(w.events.length).toBeLessThanOrEqual(4);
        const keys = w.events.map((e) => `${e.portId}:${e.commodityId}`);
        expect(new Set(keys).size).toBe(keys.length);
        for (const e of w.events) expect(data.planets[e.portId].market?.[e.commodityId]).toBeTruthy();
      }
    }
  });

  it('never adds a fifth event when four are active', () => {
    const tpl = Object.values(data.events)[0];
    const ports = Object.values(data.planets).filter((p) => p.market?.[tpl.commodity]);
    const events: MarketEvent[] = ['a', 'b', 'c', 'd'].map((id) => ({
      templateId: tpl.id,
      portId: ports[0].id,
      commodityId: `${id}-good`,
      startDay: 0,
      days: 1000,
      strength: 1.5,
    }));
    for (let seed = 1; seed <= 100; seed++) {
      const w = { ...newWorld(data, seed), day: seed, events };
      expect(economyDay(w, data).events).toHaveLength(4);
    }
  });

  it('adds nothing when every eligible port+good is already occupied', () => {
    const tpl = Object.values(data.events)[0];
    const port = Object.values(data.planets).find((p) => p.market?.[tpl.commodity])!;
    const small = {
      ...data,
      events: { [tpl.id]: tpl },
      planets: { [port.id]: { ...port, market: { [tpl.commodity]: 'med' as const } } },
    };
    const occupied: MarketEvent = {
      templateId: tpl.id,
      portId: port.id,
      commodityId: tpl.commodity,
      startDay: 0,
      days: 1000,
      strength: 1.5,
    };
    for (let seed = 1; seed <= 100; seed++) {
      const w = { ...newWorld(data, seed), day: seed, events: [occupied] };
      expect(economyDay(w, small).events).toEqual([occupied]);
    }
  });

  it('is deterministic for a seed', () => {
    const run = () => advanceDays(newWorld(data, 9), data, 30).world.events;
    expect(run()).toEqual(run());
  });
});

describe('news and rumors', () => {
  const tpl = Object.values(data.events)[0];
  const home = Object.values(data.planets)[0];
  const far = Object.values(data.planets).find((p) => p.id !== home.id)!;
  const world = (portId: string): WorldState => ({
    ...newWorld(data, 3),
    day: 5,
    events: [{ templateId: tpl.id, portId, commodityId: tpl.commodity, startDay: 5, days: 5, strength: tpl.strength }],
  });

  it('localNews fills the port name', () => {
    const text = localNews(world(home.id), data, home.id)!;
    expect(text).toContain(home.name);
    expect(text).not.toContain('{port}');
    expect(localNews(world(far.id), data, home.id)).toBeNull();
  });

  it('rumor names the other port, is deterministic, and ignores the local port', () => {
    const w = world(far.id);
    const r = rumor(w, data, home.id);
    expect(r).toBe(`Traders say ${far.name} is flooded with ${data.commodities[tpl.commodity].name}.`);
    expect(rumor(w, data, home.id)).toBe(r);
    expect(rumor(world(home.id), data, home.id)).toBeNull();
  });

  it('rumor uses "short of" for shortage events', () => {
    const w = world(far.id);
    const shortage = Object.values(data.events).find((e) => e.effect === 'shortage')!;
    w.events = [{ ...w.events[0], templateId: shortage.id, commodityId: shortage.commodity }];
    expect(rumor(w, data, home.id)).toBe(
      `Traders say ${far.name} is short of ${data.commodities[shortage.commodity].name}.`,
    );
  });
});
