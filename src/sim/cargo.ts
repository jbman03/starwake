import type { GameData } from '../data/schemas';
import { applyPressure, priceOf } from './economy';
import { worldStats } from './shipStats';
import type { WorldState } from './types';

export interface BuyResult {
  world: WorldState;
  tons: number;
  cost: number;
  /** Set only when nothing moved. */
  reason?: 'notTraded' | 'holdFull' | 'noCredits';
}

export interface SellResult {
  world: WorldState;
  tons: number;
  revenue: number;
  /** Set only when nothing moved. */
  reason?: 'notTraded' | 'noneHeld';
}

/** Tons in the hold: trade goods plus mission cargo. */
export function cargoUsed(world: WorldState): number {
  let used = 0;
  for (const t of Object.values(world.cargo)) used += t;
  for (const m of world.missions) used += m.tons;
  return used;
}

export function cargoFree(world: WorldState, data: GameData): number {
  return Math.max(0, worldStats(world, data).cargo - cargoUsed(world));
}

export function berthsFree(world: WorldState, data: GameData): number {
  let taken = 0;
  for (const m of world.missions) taken += m.passengers;
  return Math.max(0, worldStats(world, data).passengers - taken);
}

/** Price per ton once the market has absorbed `tonsBought` (negative = sold). Null if not traded. */
function priceAfter(world: WorldState, data: GameData, portId: string, commodityId: string, tonsBought: number): number | null {
  return priceOf(applyPressure(world, portId, commodityId, tonsBought), data, portId, commodityId);
}

/**
 * Most tons buyable right now: limited by free hold and by credits at the post-impact price
 * (buying n t costs n × the price after n t of pressure). 0 if not traded.
 */
export function maxBuy(world: WorldState, data: GameData, portId: string, commodityId: string): number {
  const price = priceOf(world, data, portId, commodityId);
  if (price === null) return 0;
  const credits = Math.max(0, world.credits);
  // The post-impact price is never below the current one, so this bound is an upper limit.
  let n = Math.min(cargoFree(world, data), price > 0 ? Math.floor(credits / price) : Infinity);
  while (n > 0 && (priceAfter(world, data, portId, commodityId, n) ?? 0) * n > credits) n--;
  return n;
}

/**
 * Buys up to `tons`. Market pressure is applied first and the whole lot is priced at the
 * post-impact price, so buying and selling back at the same port can never make money.
 */
export function buy(world: WorldState, data: GameData, portId: string, commodityId: string, tons: number): BuyResult {
  if (priceOf(world, data, portId, commodityId) === null) return { world, tons: 0, cost: 0, reason: 'notTraded' };
  const moved = Math.min(Math.max(0, Math.floor(tons)), maxBuy(world, data, portId, commodityId));
  if (moved <= 0) {
    if (tons < 1) return { world, tons: 0, cost: 0 };
    return { world, tons: 0, cost: 0, reason: cargoFree(world, data) <= 0 ? 'holdFull' : 'noCredits' };
  }
  const after = applyPressure(world, portId, commodityId, moved);
  const cost = priceOf(after, data, portId, commodityId)! * moved;
  return {
    world: {
      ...after,
      credits: world.credits - cost,
      cargo: { ...world.cargo, [commodityId]: (world.cargo[commodityId] ?? 0) + moved },
    },
    tons: moved,
    cost,
  };
}

/** Sells up to `tons` of what is held, priced at the post-impact price (pressure applied first). */
export function sell(world: WorldState, data: GameData, portId: string, commodityId: string, tons: number): SellResult {
  if (priceOf(world, data, portId, commodityId) === null) return { world, tons: 0, revenue: 0, reason: 'notTraded' };
  const held = world.cargo[commodityId] ?? 0;
  const moved = Math.min(Math.max(0, Math.floor(tons)), held);
  if (moved <= 0) {
    if (tons < 1) return { world, tons: 0, revenue: 0 };
    return { world, tons: 0, revenue: 0, reason: 'noneHeld' };
  }
  const after = applyPressure(world, portId, commodityId, -moved);
  const revenue = priceOf(after, data, portId, commodityId)! * moved;
  const cargo = { ...world.cargo };
  if (held - moved <= 0) delete cargo[commodityId];
  else cargo[commodityId] = held - moved;
  return { world: { ...after, credits: world.credits + revenue, cargo }, tons: moved, revenue };
}
