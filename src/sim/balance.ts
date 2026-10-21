import type { GameData } from '../data/schemas';
import { LEVEL_MULT, PRESSURE_PER_10T } from './economy';
import { hopDistance } from './galaxy';
import { offersAt } from './missions';
import type { WorldState } from './types';

/**
 * Pure balance helpers for the earning-curve targets (spec section 7). Used by tests; nothing in
 * the running game calls them.
 */

/** Profit of buying `tons` at the `buyLevel` port and selling at the `sellLevel` port, at base prices with market pressure. */
function legProfit(basePrice: number, buyLevel: keyof typeof LEVEL_MULT, sellLevel: keyof typeof LEVEL_MULT, tons: number): number {
  const impact = (tons / 10) * PRESSURE_PER_10T;
  const cost = Math.round(basePrice * LEVEL_MULT[buyLevel] * (1 + impact)) * tons;
  const revenue = Math.round(basePrice * LEVEL_MULT[sellLevel] * (1 - impact)) * tons;
  return revenue - cost;
}

/** Profit of the guide's trade (buy `good` Low, sell it High) for `tons` at base prices. */
export function guideTradeProfit(data: GameData, good: string, tons: number): number {
  return legProfit(data.commodities[good].basePrice, 'low', 'high', tons);
}

/**
 * Best 2-port round trip among start-known systems, in profit per jump: a full hold each way,
 * limited by credits, at base levels with no events and no noise.
 */
export function bestLoopPerJump(world: WorldState, data: GameData, shipId: string): number {
  const hold = data.ships[shipId].cargo;
  const ports = Object.values(data.planets).filter((p) => p.market && world.known.includes(p.systemId));
  let best = 0;
  for (const a of ports) {
    for (const b of ports) {
      if (a.id >= b.id) continue;
      const hops = hopDistance(data, a.systemId, b.systemId, world.flags);
      if (!Number.isFinite(hops) || hops < 1) continue;
      const leg = (from: typeof a, to: typeof a): number => {
        let top = 0;
        for (const [good, level] of Object.entries(from.market ?? {})) {
          const sell = to.market?.[good];
          if (!sell) continue;
          const base = data.commodities[good].basePrice;
          const tons = Math.min(hold, Math.floor(world.credits / (base * LEVEL_MULT[level])));
          top = Math.max(top, legProfit(base, level, sell, tons));
        }
        return top;
      };
      best = Math.max(best, (leg(a, b) + leg(b, a)) / (2 * hops));
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

/** Median pay of those offers. */
export function medianMissionPay(world: WorldState, data: GameData, samples: number): number {
  return median(carryableOffers(world, data, samples).map((o) => o.pay));
}

/** Median-pay jobs needed to take the pilot's credits from the start to `price`. */
export function jobsToAfford(world: WorldState, data: GameData, price: number): number {
  const pay = medianMissionPay(world, data, 60);
  return pay > 0 ? Math.ceil(Math.max(0, price - world.credits) / pay) : Infinity;
}
