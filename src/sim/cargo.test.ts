import { describe, expect, it } from 'vitest';
import type { GameData } from '../data/schemas';
import { loadGameData } from '../data/load';
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
  it('buys 10 t at one (post-impact) price, deducts credits, raises pressure', () => {
    const w = rich(newWorld(data, 1));
    const p = price(applyPressure(w, port.id, 'food', 10));
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
    const cost = (n: number) => price(applyPressure(w0, port.id, 'food', n)) * n;
    const w = { ...w0, credits: cost(4) - 1 };
    const r = buy(w, data, port.id, 'food', 10);
    expect(r.tons).toBe(3);
    expect(r.reason).toBeUndefined();
    expect(r.world.credits).toBe(cost(4) - 1 - cost(3));
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
    const cost = (n: number) => price(applyPressure(w0, port.id, 'food', n)) * n;
    expect(maxBuy(rich(w0), data, port.id, 'food')).toBe(20);
    expect(maxBuy({ ...w0, credits: cost(7) + 1 }, data, port.id, 'food')).toBe(7);
    expect(maxBuy({ ...w0, credits: -50 }, data, port.id, 'food')).toBe(0);
  });
});

describe('sell', () => {
  it('sells at one (post-impact) price, adds revenue, lowers pressure', () => {
    const w = { ...newWorld(data, 1), cargo: { food: 10 } };
    const p = price(applyPressure(w, port.id, 'food', -10));
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

describe('no same-port arbitrage (prices are post-impact)', () => {
  const roundTrip = (w: WorldState, d: GameData, portId: string, good: string, n: number | 'max') => {
    const tons = n === 'max' ? maxBuy(w, d, portId, good) : n;
    const b = buy(w, d, portId, good, tons);
    const s = sell(b.world, d, portId, good, b.tons);
    return { bought: b.tons, start: w.credits, end: s.world.credits, world: s.world };
  };

  it('buy N then sell N never gains credits (N = 1, 10, max) on several goods', async () => {
    const real = await loadGameData();
    const cases: [string, string][] = [['halcyon', 'copperwine'], [port.id, 'food']];
    for (const [pid, good] of Object.entries(real.planets).flatMap(([id, p]) => Object.keys(p.market ?? {}).map((g) => [id, g] as [string, string])).slice(0, 12)) cases.push([pid, good]);
    for (const [pid, good] of cases) {
      const d = pid === port.id && good === 'food' ? data : real;
      for (const seed of [1, 2, 3]) {
        for (const credits of [100_000, 2_000]) {
          for (const n of [1, 10, 'max'] as const) {
            const w = { ...newWorld(d, seed), credits };
            const r = roundTrip(w, d, pid, good, n);
            expect(r.bought, `${pid}:${good} n=${n}`).toBeGreaterThan(0);
            expect(r.end, `${pid}:${good} seed=${seed} n=${n}`).toBeLessThanOrEqual(r.start);
          }
        }
      }
    }
  });

  it('50 alternating max-buy / sell-all cycles never increase credits', async () => {
    const real = await loadGameData();
    for (const [pid, good] of [['halcyon', 'copperwine'], ['halcyon', Object.keys(real.planets.halcyon.market!)[0]]]) {
      let w: WorldState = { ...newWorld(real, 4), credits: 50_000 };
      for (let i = 0; i < 50; i++) {
        const before = w.credits;
        w = roundTrip(w, real, pid, good, 'max').world;
        expect(w.credits, `${pid}:${good} cycle ${i}`).toBeLessThanOrEqual(before);
      }
    }
  });

  it('buy cost and sell revenue use the price after the trade', () => {
    const w = rich(newWorld(data, 1));
    const b = buy(w, data, port.id, 'food', 10);
    expect(b.cost).toBe(price(b.world) * 10);
    const s = sell(b.world, data, port.id, 'food', 10);
    expect(s.revenue).toBe(price(s.world) * 10);
  });

  it('maxBuy is the largest affordable amount at the post-impact price', () => {
    const w0 = newWorld(data, 1);
    for (let credits = 0; credits < 3000; credits += 37) {
      const w = { ...w0, credits };
      const n = maxBuy(w, data, port.id, 'food');
      if (n > 0) expect(priceOf(applyPressure(w, port.id, 'food', n), data, port.id, 'food')! * n).toBeLessThanOrEqual(credits);
      if (n < 20) expect(priceOf(applyPressure(w, port.id, 'food', n + 1), data, port.id, 'food')! * (n + 1)).toBeGreaterThan(credits);
      expect(buy(w, data, port.id, 'food', 20).world.credits).toBeGreaterThanOrEqual(0);
    }
  });
});
