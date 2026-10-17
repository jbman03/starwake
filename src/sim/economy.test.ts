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

  it('drops the key once back near 1', () => {
    let w = applyPressure(newWorld(data, 1), 'p', 'food', 1);
    expect(w.pressure['p:food']).toBeCloseTo(1.003);
    w = economyDay(w, data);
    expect(w.pressure['p:food']).toBeUndefined();
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
    expect(r).not.toBeNull();
    {
      expect(r!).toContain(far.name);
      expect(r).toMatch(/short of|flooded with/);
      expect(rumor(w, data, home.id)).toBe(r);
    }
    expect(rumor(world(home.id), data, home.id)).toBeNull();
  });
});
