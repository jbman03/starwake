import type { GameData } from '../data/schemas';
import { applyPressure, priceOf } from './economy';
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
  return Math.max(0, data.ships[world.shipId].cargo - cargoUsed(world));
}

export function berthsFree(world: WorldState, data: GameData): number {
  let taken = 0;
  for (const m of world.missions) taken += m.passengers;
  return Math.max(0, data.ships[world.shipId].passengers - taken);
}

/** Most tons buyable right now: limited by free hold and whole tons of credits. 0 if not traded. */
export function maxBuy(world: WorldState, data: GameData, portId: string, commodityId: string): number {
  const price = priceOf(world, data, portId, commodityId);
  if (price === null) return 0;
  const affordable = price > 0 ? Math.floor(Math.max(0, world.credits) / price) : Infinity;
  return Math.min(cargoFree(world, data), affordable);
}

/** Buys up to `tons` at the current price (one price per transaction), then applies market pressure. */
export function buy(world: WorldState, data: GameData, portId: string, commodityId: string, tons: number): BuyResult {
  const price = priceOf(world, data, portId, commodityId);
  if (price === null) return { world, tons: 0, cost: 0, reason: 'notTraded' };
  const moved = Math.min(Math.max(0, Math.floor(tons)), maxBuy(world, data, portId, commodityId));
  if (moved <= 0) {
    if (tons < 1) return { world, tons: 0, cost: 0 };
    return { world, tons: 0, cost: 0, reason: cargoFree(world, data) <= 0 ? 'holdFull' : 'noCredits' };
  }
  const cost = price * moved;
  const next: WorldState = {
    ...world,
    credits: world.credits - cost,
    cargo: { ...world.cargo, [commodityId]: (world.cargo[commodityId] ?? 0) + moved },
  };
  return { world: applyPressure(next, portId, commodityId, moved), tons: moved, cost };
}

/** Sells up to `tons` of what is held at the current price, then applies market pressure. */
export function sell(world: WorldState, data: GameData, portId: string, commodityId: string, tons: number): SellResult {
  const price = priceOf(world, data, portId, commodityId);
  if (price === null) return { world, tons: 0, revenue: 0, reason: 'notTraded' };
  const held = world.cargo[commodityId] ?? 0;
  const moved = Math.min(Math.max(0, Math.floor(tons)), held);
  if (moved <= 0) {
    if (tons < 1) return { world, tons: 0, revenue: 0 };
    return { world, tons: 0, revenue: 0, reason: 'noneHeld' };
  }
  const revenue = price * moved;
  const cargo = { ...world.cargo };
  if (held - moved <= 0) delete cargo[commodityId];
  else cargo[commodityId] = held - moved;
  const next: WorldState = { ...world, credits: world.credits + revenue, cargo };
  return { world: applyPressure(next, portId, commodityId, -moved), tons: moved, revenue };
}
