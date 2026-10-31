import type { GameData } from '../data/schemas';
import { cargoUsed } from './cargo';
import { revealWithin, systemsWithin } from './galaxy';
import { shipStats, worldStats } from './shipStats';
import { standingMet } from './standing';
import { boughtFlag } from './shipyard';
import { sells } from './stock';
import { hasFlag, setFlag } from './story';
import type { WorldState } from './types';
import { ammoCap, weaponsOf } from './weapons';

export type OutfitBlock = 'credits' | 'space' | 'max' | 'notSold' | 'nothingToReveal' | 'standing' | 'gone' | 'locked' | 'noLauncher';
export type SellBlock = 'notOwned' | 'cargoWouldNotFit' | 'notSellable';

export type BuyCheck = { ok: true } | { ok: false; reason: OutfitBlock };
export type SellCheck = { ok: true; refund: number; fuelLost: number } | { ok: false; reason: SellBlock };

/** Share of the price paid back when selling an outfit. */
export const SELL_REFUND = 0.5;

export const OUTFIT_BLOCK_TEXT: Record<OutfitBlock | SellBlock, string> = {
  credits: 'Not enough credits.',
  space: 'Not enough free outfit space.',
  max: 'You already carry as many as the hull can use.',
  notSold: 'This port does not stock that.',
  standing: 'Requires friendship with this government', // the screens name the government via standingBlockText
  gone: 'Sold once, and already sold.',
  locked: 'Not for sale yet.',
  noLauncher: 'Needs a launcher',
  nothingToReveal: 'Everything in range is already on your chart.',
  notOwned: 'You do not have one fitted.',
  cargoWouldNotFit: 'Your hold would be too full without it.',
  notSellable: 'Charts cannot be sold back.',
};

/** Whether the outfit can be bought here. Checks run notSold, gone, locked, standing, noLauncher (ammo), max, space, credits (maps: notSold, nothingToReveal, credits). */
export function outfitBuyCheck(world: WorldState, data: GameData, planetId: string, outfitId: string): BuyCheck {
  const def = data.outfits[outfitId];
  if (!def || !sells(planetId, def, data)) return { ok: false, reason: 'notSold' };
  if (def.unique && hasFlag(world, boughtFlag(outfitId))) return { ok: false, reason: 'gone' };
  if (def.requiresFlag && !hasFlag(world, def.requiresFlag)) return { ok: false, reason: 'locked' };
  if (!standingMet(world, def.requiresStanding, data)) return { ok: false, reason: 'standing' };
  if (def.category === 'map') {
    const system = data.planets[planetId]?.systemId;
    const known = new Set(world.known);
    const inRange = systemsWithin(data, system, def.effect.mapJumps, world.flags);
    if (inRange.every((id) => known.has(id))) return { ok: false, reason: 'nothingToReveal' };
  } else {
    if (def.category === 'ammo') {
      if (!weaponsOf(world.outfits, data).launchers.some((l) => l.def.effect.ammo === outfitId)) return { ok: false, reason: 'noLauncher' };
      if ((world.outfits[outfitId] ?? 0) >= ammoCap(world.outfits, outfitId, data)) return { ok: false, reason: 'max' };
    } else if ((world.outfits[outfitId] ?? 0) >= def.max) return { ok: false, reason: 'max' };
    if (worldStats(world, data).spaceFree < def.space) return { ok: false, reason: 'space' };
  }
  if (world.credits < def.price) return { ok: false, reason: 'credits' };
  return { ok: true };
}

/** Buys one. A map charges the price and charts the area instead of being stored. Unchanged world when blocked. */
export function buyOutfit(
  world: WorldState,
  data: GameData,
  planetId: string,
  outfitId: string,
): { world: WorldState; check: BuyCheck } {
  const check = outfitBuyCheck(world, data, planetId, outfitId);
  if (!check.ok) return { world, check };
  const def = data.outfits[outfitId];
  const paid = { ...(def.unique ? setFlag(world, boughtFlag(outfitId)) : world), credits: world.credits - def.price };
  if (def.category === 'map') {
    const revealed = revealWithin(world.known, world.seen, data, data.planets[planetId].systemId, def.effect.mapJumps, world.flags);
    return { world: { ...paid, ...revealed }, check };
  }
  return { world: { ...paid, outfits: { ...world.outfits, [outfitId]: (world.outfits[outfitId] ?? 0) + 1 } }, check };
}

function without(outfits: Record<string, number>, outfitId: string): Record<string, number> {
  const next = { ...outfits };
  if ((next[outfitId] ?? 0) <= 1) delete next[outfitId];
  else next[outfitId] -= 1;
  return next;
}

/** Whether one can be sold, and what it would refund and cost in fuel. */
export function outfitSellCheck(world: WorldState, data: GameData, outfitId: string): SellCheck {
  const def = data.outfits[outfitId];
  if (!def || def.category === 'map') return { ok: false, reason: 'notSellable' };
  if ((world.outfits[outfitId] ?? 0) <= 0) return { ok: false, reason: 'notOwned' };
  const after = shipStats(world.shipId, without(world.outfits, outfitId), data);
  if (cargoUsed(world) > after.cargo) return { ok: false, reason: 'cargoWouldNotFit' };
  return {
    ok: true,
    refund: Math.floor(def.price * SELL_REFUND),
    fuelLost: Math.max(0, world.ship.fuel - after.fuelCapacity),
  };
}

/** Sells one at half price; fuel is trimmed to the new capacity. Unchanged world when blocked. */
export function sellOutfit(
  world: WorldState,
  data: GameData,
  outfitId: string,
): { world: WorldState; check: SellCheck } {
  const check = outfitSellCheck(world, data, outfitId);
  if (!check.ok) return { world, check };
  const outfits = without(world.outfits, outfitId);
  const cap = shipStats(world.shipId, outfits, data).fuelCapacity;
  return {
    world: {
      ...world,
      outfits,
      credits: world.credits + check.refund,
      ship: { ...world.ship, fuel: Math.min(world.ship.fuel, cap) },
    },
    check,
  };
}
