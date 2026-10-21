import type { GameData } from '../data/schemas';
import { cargoUsed } from './cargo';
import { hasFlag, setFlag } from './story';
import { shipStock } from './stock';
import type { WorldState } from './types';

export type ShipBlock = 'credits' | 'cargo' | 'passengers' | 'owned' | 'notSold' | 'locked';

export interface ShipQuote {
  price: number;
  tradeIn: number;
  net: number;
  check: { ok: true } | { ok: false; reason: ShipBlock };
}

export const SHIP_BLOCK_TEXT: Record<ShipBlock, string> = {
  credits: 'Not enough credits after your trade-in.',
  cargo: 'Your cargo will not fit in that hold.',
  passengers: 'That hull has too few berths for your passengers.',
  owned: 'You already fly this ship.',
  notSold: 'This yard does not build that hull.',
  locked: 'Ask about the old survey ship',
};

/** Flag set when a one-off hull is bought, so it can never be bought twice. */
export const boughtFlag = (shipId: string): string => `bought:${shipId}`;

/** What the yard pays for the current ship: 75% of the hull plus 50% of every fitted outfit. */
export function tradeInValue(world: Pick<WorldState, 'shipId' | 'outfits'>, data: GameData): number {
  let total = Math.floor(0.75 * data.ships[world.shipId].price);
  for (const [id, count] of Object.entries(world.outfits)) {
    const def = data.outfits[id];
    if (def && count > 0) total += Math.floor(0.5 * def.price * count);
  }
  return total;
}

/** Credits plus what the yard would pay for the ship and its fitted outfits. */
export function netWorth(w: Pick<WorldState, 'credits' | 'shipId' | 'outfits'>, data: GameData): number {
  return w.credits + tradeInValue(w, data);
}

/** The name to show for a ship: its own name, or the hull's when it has none ('' means unnamed). */
export function shipDisplayName(shipName: string, shipId: string, data: GameData): string {
  return shipName || data.ships[shipId]?.name || shipId;
}

/** Price, trade-in, net cost and whether the swap is allowed. Check order: notSold, owned, locked, cargo, passengers, credits. */
export function shipQuote(world: WorldState, data: GameData, planetId: string, shipId: string): ShipQuote {
  const hull = data.ships[shipId];
  const tradeIn = tradeInValue(world, data);
  const price = hull?.price ?? 0;
  const net = price - tradeIn;
  const result = (check: ShipQuote['check']): ShipQuote => ({ price, tradeIn, net, check });
  if (!hull || !shipStock(planetId, data).some((s) => s.id === shipId)) return result({ ok: false, reason: 'notSold' });
  if (world.shipId === shipId || (hull.unique && hasFlag(world, boughtFlag(shipId)))) return result({ ok: false, reason: 'owned' });
  if (hull.requiresFlag && !hasFlag(world, hull.requiresFlag)) return result({ ok: false, reason: 'locked' });
  if (cargoUsed(world) > hull.cargo) return result({ ok: false, reason: 'cargo' });
  const riders = world.missions.reduce((n, m) => n + m.passengers, 0);
  if (riders > hull.passengers) return result({ ok: false, reason: 'passengers' });
  if (world.credits < net) return result({ ok: false, reason: 'credits' });
  return result({ ok: true });
}

/** Trades in the current ship and outfits for a new bare hull with a full tank. Unchanged world when blocked. */
export function buyShip(
  world: WorldState,
  data: GameData,
  planetId: string,
  shipId: string,
): { world: WorldState; quote: ShipQuote } {
  const quote = shipQuote(world, data, planetId, shipId);
  if (!quote.check.ok) return { world, quote };
  const bought = data.ships[shipId].unique ? setFlag(world, boughtFlag(shipId)) : world;
  return {
    world: {
      ...bought,
      shipId,
      shipName: data.ships[shipId].name,
      outfits: {},
      credits: world.credits - quote.net,
      ship: { ...world.ship, fuel: data.ships[shipId].fuelCapacity },
    },
    quote,
  };
}
