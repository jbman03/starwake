import type { GameData } from '../data/schemas';
import { cargoUsed } from './cargo';
import { standingMet } from './standing';
import { hasFlag, setFlag } from './story';
import { shipStock } from './stock';
import type { WorldState } from './types';

export type ShipBlock = 'credits' | 'cargo' | 'passengers' | 'owned' | 'gone' | 'notSold' | 'locked' | 'standing';

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
  gone: "Sold once — she's gone.",
  notSold: 'This yard does not build that hull.',
  locked: 'Not offered to you yet.',
  standing: 'Requires friendship with this government', // the screens name the government via standingBlockText
};

/** Flag set when a one-off hull is bought, so it can never be bought twice. */
export const boughtFlag = (shipId: string): string => `bought:${shipId}`;

/** What the yard pays for the current ship: 75% of the hull plus 50% of every fitted outfit. */
export function tradeInValue(world: Pick<WorldState, 'shipId' | 'outfits'>, data: GameData): number {
  const hull = data.ships[world.shipId];
  if (!hull) return 0; // a hull this version doesn't have: the yard can't price it
  let total = Math.floor(0.75 * hull.price);
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

/** Is the hull withdrawn from the yard's list because the story flag that hides it is set? */
export function shipHidden(world: Pick<WorldState, 'flags'>, hull: { hiddenByFlag?: string }): boolean {
  return !!hull.hiddenByFlag && world.flags.includes(hull.hiddenByFlag);
}

/** Price, trade-in, net cost and whether the swap is allowed. Check order: notSold, owned, gone, locked, standing, cargo, passengers, credits. */
export function shipQuote(world: WorldState, data: GameData, planetId: string, shipId: string): ShipQuote {
  const hull = data.ships[shipId];
  const tradeIn = tradeInValue(world, data);
  const price = hull?.price ?? 0;
  const net = price - tradeIn;
  const result = (check: ShipQuote['check']): ShipQuote => ({ price, tradeIn, net, check });
  if (!hull || !shipStock(planetId, data).some((s) => s.id === shipId)) return result({ ok: false, reason: 'notSold' });
  if (world.shipId === shipId) return result({ ok: false, reason: 'owned' });
  if (hull.unique && hasFlag(world, boughtFlag(shipId))) return result({ ok: false, reason: 'gone' });
  if (hull.requiresFlag && !hasFlag(world, hull.requiresFlag)) return result({ ok: false, reason: 'locked' });
  if (!standingMet(world, hull.requiresStanding)) return result({ ok: false, reason: 'standing' });
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
