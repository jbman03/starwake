import { describe, expect, it } from 'vitest';
import { testData } from '../data/testData';
import { berthsFree, buy, cargoFree, cargoUsed, maxBuy, sell } from './cargo';
import { PRESSURE_MAX, PRESSURE_MIN, applyPressure, priceOf } from './economy';
import type { Mission, WorldState } from './types';
import { newWorld } from './world';

const data = testData();
const port = Object.values(data.planets).find((p) => p.market?.food)!;
const other = Object.values(data.planets).find((p) => !p.market?.glowmoss)!;
const mission = (tons: number, passengers = 0): Mission => ({
  id: 'm',
  typeId: 't',
  originId: 'a',
  destId: 'b',
  tons,
  passengers,
  pay: 0,
  paidUpfront: false,
  deadlineDay: null,
  title: '',
  description: '',
  cargoName: '',
});
const rich = (w: WorldState, credits = 100000): WorldState => ({ ...w, credits });
const price = (w: WorldState) => priceOf(w, data, port.id, 'food')!;

describe('hold accounting', () => {
  it('shuttle has 20 t and 4 berths', () => {
    const w = newWorld(data, 1);
    expect(cargoFree(w, data)).toBe(20);
    expect(berthsFree(w, data)).toBe(4);
  });

  it('counts trade tons and mission tons', () => {
    const w = { ...newWorld(data, 1), cargo: { food: 5, metal: 3 }, missions: [mission(4, 2), mission(1, 1)] };
    expect(cargoUsed(w)).toBe(13);
    expect(cargoFree(w, data)).toBe(7);
    expect(berthsFree(w, data)).toBe(1);
  });
});

describe('buy', () => {
  it('buys 10 t at one price, deducts credits, raises pressure', () => {
    const w = rich(newWorld(data, 1));
    const p = price(w);
    const r = buy(w, data, port.id, 'food', 10);
    expect(r).toMatchObject({ tons: 10, cost: p * 10 });
    expect(r.reason).toBeUndefined();
    expect(r.world.credits).toBe(w.credits - p * 10);
    expect(r.world.cargo.food).toBe(10);
    expect(r.world.pressure[`${port.id}:food`]).toBeCloseTo(1.03);
    expect(w.cargo).toEqual({});
  });

  it('partial buy when the hold is short has no reason', () => {
    const w = { ...rich(newWorld(data, 1)), missions: [mission(5)] };
    const r = buy(w, data, port.id, 'food', 30);
    expect(r.tons).toBe(15);
    expect(r.reason).toBeUndefined();
  });

  it('holdFull only when nothing fits', () => {
    const w = { ...rich(newWorld(data, 1)), cargo: { metal: 20 } };
    const r = buy(w, data, port.id, 'food', 10);
    expect(r).toMatchObject({ tons: 0, cost: 0, reason: 'holdFull' });
    expect(r.world).toBe(w);
  });

  it('is limited by credits (whole tons) without a reason when some bought', () => {
    const w0 = newWorld(data, 1);
    const p = price(w0);
    const w = { ...w0, credits: p * 3 + p - 1 };
    const r = buy(w, data, port.id, 'food', 10);
    expect(r.tons).toBe(3);
    expect(r.reason).toBeUndefined();
    expect(r.world.credits).toBe(p - 1);
  });

  it('noCredits when broke or in debt', () => {
    for (const credits of [0, -300]) {
      const w = { ...newWorld(data, 1), credits };
      const r = buy(w, data, port.id, 'food', 10);
      expect(r).toMatchObject({ tons: 0, cost: 0, reason: 'noCredits' });
      expect(r.world.credits).toBe(credits);
    }
  });

  it('holdFull wins over noCredits', () => {
    const w = { ...newWorld(data, 1), credits: 0, cargo: { metal: 20 } };
    expect(buy(w, data, port.id, 'food', 10).reason).toBe('holdFull');
  });

  it('notTraded at a port that does not carry the good', () => {
    const w = rich(newWorld(data, 1));
    expect(buy(w, data, other.id, 'glowmoss', 10)).toMatchObject({ tons: 0, reason: 'notTraded' });
    expect(maxBuy(w, data, other.id, 'glowmoss')).toBe(0);
  });

  it('maxBuy is min of free hold and affordable tons', () => {
    const w0 = newWorld(data, 1);
    const p = price(w0);
    expect(maxBuy(rich(w0), data, port.id, 'food')).toBe(20);
    expect(maxBuy({ ...w0, credits: p * 7 + 1 }, data, port.id, 'food')).toBe(7);
    expect(maxBuy({ ...w0, credits: -50 }, data, port.id, 'food')).toBe(0);
  });
});

describe('sell', () => {
  it('sells at one price, adds revenue, lowers pressure', () => {
    const w = { ...newWorld(data, 1), cargo: { food: 10 } };
    const p = price(w);
    const r = sell(w, data, port.id, 'food', 10);
    expect(r).toMatchObject({ tons: 10, revenue: p * 10 });
    expect(r.world.credits).toBe(w.credits + p * 10);
    expect(r.world.pressure[`${port.id}:food`]).toBeCloseTo(0.97);
  });

  it('drops the cargo key at zero and keeps a remainder', () => {
    const w = { ...newWorld(data, 1), cargo: { food: 10, metal: 4 } };
    expect(sell(w, data, port.id, 'food', 10).world.cargo).toEqual({ metal: 4 });
    expect(sell(w, data, port.id, 'food', 3).world.cargo).toEqual({ food: 7, metal: 4 });
  });

  it('selling more than held sells what is held, no reason', () => {
    const w = { ...newWorld(data, 1), cargo: { food: 4 } };
    const r = sell(w, data, port.id, 'food', 10);
    expect(r.tons).toBe(4);
    expect(r.reason).toBeUndefined();
    expect(r.world.cargo).toEqual({});
  });

  it('noneHeld and notTraded', () => {
    const w = newWorld(data, 1);
    expect(sell(w, data, port.id, 'food', 10)).toMatchObject({ tons: 0, revenue: 0, reason: 'noneHeld' });
    const held = { ...w, cargo: { glowmoss: 5 } };
    expect(sell(held, data, other.id, 'glowmoss', 5)).toMatchObject({ tons: 0, reason: 'notTraded' });
  });

  it('a pilot in debt can sell', () => {
    const w = { ...newWorld(data, 1), credits: -200, cargo: { food: 5 } };
    const r = sell(w, data, port.id, 'food', 5);
    expect(r.tons).toBe(5);
    expect(r.world.credits).toBe(-200 + r.revenue);
  });
});

describe('invariants', () => {
  it('50 alternating buy/sell presses keep credits >= 0 and pressure clamped', () => {
    let w: WorldState = { ...newWorld(data, 9), credits: 400 };
    for (let i = 0; i < 50; i++) {
      w = (i % 2 === 0 ? buy(w, data, port.id, 'food', 10) : sell(w, data, port.id, 'food', 10)).world;
      expect(w.credits).toBeGreaterThanOrEqual(0);
      expect(cargoUsed(w)).toBeLessThanOrEqual(20);
      const p = w.pressure[`${port.id}:food`] ?? 1;
      expect(p).toBeGreaterThanOrEqual(PRESSURE_MIN);
      expect(p).toBeLessThanOrEqual(PRESSURE_MAX);
    }
  });

  it('repeated buys under pressure never overspend', () => {
    let w: WorldState = rich(newWorld(data, 3), 150);
    w = applyPressure(w, port.id, 'food', 100);
    for (let i = 0; i < 20; i++) {
      w = buy(w, data, port.id, 'food', 1).world;
      expect(w.credits).toBeGreaterThanOrEqual(0);
    }
  });
});
