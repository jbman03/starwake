import type { GameData } from '../data/schemas';
import { buy, sell } from './cargo';
import { hopDistance } from './galaxy';
import { offersAt } from './missions';
import type { WorldState } from './types';

/**
 * Pure balance helpers for the earning-curve targets (spec section 7). Used by tests; nothing in
 * the running game calls them.
 */

/** Days of offers every mission helper samples. */
export const SAMPLE_DAYS = 60;

/** Profit of buying `tons` of `good` at `fromId` and selling it all at `toId`, through the real buy/sell (prices, pressure, credits, hold). */
export function tradeProfit(world: WorldState, data: GameData, fromId: string, toId: string, good: string, tons: number): number {
  const bought = buy(world, data, fromId, good, tons);
  if (bought.tons <= 0) return 0;
  const sold = sell(bought.world, data, toId, good, bought.tons);
  return sold.revenue - bought.cost;
}

/**
 * Best 2-port round trip among start-known systems, in profit per jump: a full hold each way,
 * limited by credits, through the real prices and market pressure (no events; the world's day).
 */
export function bestLoopPerJump(world: WorldState, data: GameData, shipId: string): number {
  const w: WorldState = { ...world, shipId, cargo: {}, events: [], pressure: {} };
  const ports = Object.values(data.planets).filter((p) => p.market && w.known.includes(p.systemId));
  const leg = (from: string, to: string): number => {
    let top = 0;
    for (const good of Object.keys(data.planets[from].market ?? {})) {
      if (data.planets[to].market?.[good]) top = Math.max(top, tradeProfit(w, data, from, to, good, Infinity));
    }
    return top;
  };
  let best = 0;
  for (const a of ports) {
    for (const b of ports) {
      if (a.id >= b.id) continue;
      const hops = hopDistance(data, a.systemId, b.systemId, w.flags);
      if (!Number.isFinite(hops) || hops < 1) continue;
      best = Math.max(best, (leg(a.id, b.id) + leg(b.id, a.id)) / (2 * hops));
    }
  }
  return best;
}

/** Every offer at a start-known port, over `samples` days, that the starting ship can carry. */
function carryableOffers(world: WorldState, data: GameData, samples: number) {
  const def = data.ships[world.shipId];
  const ports = Object.values(data.planets).filter((p) => p.services.includes('missions') && world.known.includes(p.systemId));
  const out: { pay: number; hops: number }[] = [];
  for (let day = 0; day < samples; day++) {
    const w = { ...world, day };
    for (const p of ports) {
      for (const o of offersAt(w, data, p.id)) {
        if (o.tons > def.cargo || o.passengers > def.passengers) continue;
        const hops = hopDistance(data, p.systemId, data.planets[o.destId].systemId, world.flags);
        if (Number.isFinite(hops) && hops >= 1) out.push({ pay: o.pay, hops });
      }
    }
  }
  return out;
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s.length === 0 ? 0 : s[Math.floor(s.length / 2)];
}

/** Median pay per jump over `samples` days of offers at start-known mission ports the ship can carry. */
export function medianMissionPerJump(world: WorldState, data: GameData, samples: number): number {
  return median(carryableOffers(world, data, samples).map((o) => o.pay / o.hops));
}

/** The richest carryable offer, in pay per jump. */
export function maxMissionPerJump(world: WorldState, data: GameData, samples: number): number {
  return Math.max(0, ...carryableOffers(world, data, samples).map((o) => o.pay / o.hops));
}

/** Median pay of those offers. */
export function medianMissionPay(world: WorldState, data: GameData, samples: number): number {
  return median(carryableOffers(world, data, samples).map((o) => o.pay));
}

/** Median-pay jobs needed to take the pilot's credits from the start to `price`. */
export function jobsToAfford(world: WorldState, data: GameData, price: number): number {
  const pay = medianMissionPay(world, data, SAMPLE_DAYS);
  return pay > 0 ? Math.ceil(Math.max(0, price - world.credits) / pay) : Infinity;
}
