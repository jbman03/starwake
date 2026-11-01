import type { GameData } from '../data/schemas';
import { hashString, mulberry32, randInt } from './random';
import { ESCORT_ID_PREFIX } from './combat';
import type { Escort, EscortOrder, WorldState } from './types';
import { shipStats } from './shipStats';
import { npcLoadout } from './weapons';

export const ESCORT_ORDERS: readonly EscortOrder[] = ['follow', 'attack', 'hold', 'defend'];

/** Full armor of an escort: hull plus fitted outfits. */
export function escortMaxArmor(data: GameData, e: Pick<Escort, 'shipId' | 'outfits'>): number {
  return shipStats(e.shipId, e.outfits, data).armor;
}

/** Full tank of an escort, in whole jumps. */
export function escortMaxFuel(data: GameData, e: Pick<Escort, 'shipId' | 'outfits'>): number {
  return Math.floor(shipStats(e.shipId, e.outfits, data).fuelCapacity / data.config.fuelPerJump);
}

export const ORDER_LABEL: Record<EscortOrder, string> = {
  follow: 'Follow',
  attack: 'Attack',
  hold: 'Hold',
  defend: 'Return fire',
};

export const HIRE_REFUSAL: Record<'full' | 'short' | 'gone', string> = {
  full: 'Your group is full (3 escorts).', // keep in step with data/escorts.json maxEscorts
  short: 'Not enough credits.',
  gone: 'That pilot has moved on.',
};

/** A pilot for hire on a shipyard's board. `offerId` becomes the escort's id. */
export interface EscortOffer {
  offerId: string;
  name: string;
  shipId: string;
  fee: number;
  wage: number;
}

const round10 = (n: number): number => Math.round(n / 10) * 10;

/** A fresh escort id: `esc-<n>`, one past the highest `n` in the group. */
export function nextEscortId(escorts: readonly Pick<Escort, 'id'>[]): string {
  let top = 0;
  for (const e of escorts) {
    const n = e.id.startsWith(ESCORT_ID_PREFIX) ? Number(e.id.slice(ESCORT_ID_PREFIX.length)) : NaN;
    if (Number.isInteger(n) && n > top) top = n;
  }
  return `${ESCORT_ID_PREFIX}${top + 1}`;
}

/** Cycle follow, attack, hold, return fire. */
export function nextOrder(o: EscortOrder): EscortOrder {
  return ESCORT_ORDERS[(ESCORT_ORDERS.indexOf(o) + 1) % ESCORT_ORDERS.length];
}

/** Pilots for hire at `portId` today: 1 to maxOffers, same for the same (seed, port, day). None without a shipyard. */
export function hireOffers(world: WorldState, data: GameData, portId: string): EscortOffer[] {
  const port = data.planets[portId];
  if (!port || !port.services.includes('shipyard')) return [];
  const cfg = data.escorts;
  const ships = cfg.hireable.filter((id) => data.ships[id] && data.ships[id].techTier <= port.techTier);
  if (ships.length === 0 || cfg.names.length === 0) return [];
  const r = mulberry32(hashString(world.seed, 'escorts', portId, world.day));
  const want = randInt(r, 1, cfg.maxOffers);
  const used = new Set<string>();
  const offers: EscortOffer[] = [];
  for (let index = 0; index < want; index++) {
    const shipId = ships[Math.floor(r() * ships.length)];
    let n = Math.floor(r() * cfg.names.length);
    for (let k = 0; k < cfg.names.length && used.has(cfg.names[n]); k++) n = (n + 1) % cfg.names.length;
    const name = cfg.names[n];
    used.add(name);
    const price = data.ships[shipId].price;
    offers.push({
      offerId: `escort:${portId}:${world.day}:${index}`,
      name,
      shipId,
      fee: Math.round(price * cfg.hireFeeMul),
      wage: Math.round(price * cfg.wageMul),
    });
  }
  const taken = new Set(world.takenOffers);
  return offers.filter((o) => !taken.has(o.offerId));
}

/** Hire an offer: fee paid, ship at full armor and fuel. */
export function hireEscort(
  world: WorldState,
  data: GameData,
  portId: string,
  offerId: string,
): { world: WorldState; escort: Escort } | { error: 'full' | 'short' | 'gone' } {
  const offer = hireOffers(world, data, portId).find((o) => o.offerId === offerId);
  if (!offer) return { error: 'gone' };
  if (world.escorts.length >= data.escorts.maxEscorts) return { error: 'full' };
  if (world.credits < offer.fee) return { error: 'short' };
  const outfits = { ...npcLoadout(data.ships[offer.shipId]) };
  const escort: Escort = {
    id: nextEscortId(world.escorts),
    name: offer.name,
    shipId: offer.shipId,
    outfits,
    armor: escortMaxArmor(data, { shipId: offer.shipId, outfits }),
    fuel: escortMaxFuel(data, { shipId: offer.shipId, outfits }),
    hired: true,
    wage: offer.wage,
  };
  return {
    world: {
      ...world,
      credits: world.credits - offer.fee,
      escorts: [...world.escorts, escort],
      takenOffers: [...world.takenOffers, offer.offerId],
    },
    escort,
  };
}

/** Keep a captured ship as an escort: no fuel, no wage, never hired. */
export function keepCapture(
  world: WorldState,
  data: GameData,
  npc: { name: string; shipId: string; outfits: Record<string, number>; hull: { armor: number } },
): { world: WorldState; escort: Escort } | { error: 'full' } {
  if (world.escorts.length >= data.escorts.maxEscorts) return { error: 'full' };
  const escort: Escort = {
    id: nextEscortId(world.escorts),
    name: npc.name,
    shipId: npc.shipId,
    outfits: { ...npc.outfits },
    armor: npc.hull.armor,
    fuel: 0,
    hired: false,
    wage: 0,
  };
  return {
    world: { ...world, escorts: [...world.escorts, escort], stats: { ...world.stats, captures: world.stats.captures + 1 } },
    escort,
  };
}

/** Let an escort go. Nothing is refunded. */
export function dismissEscort(world: WorldState, id: string): WorldState {
  return { ...world, escorts: world.escorts.filter((e) => e.id !== id) };
}

/** What a captured hull fetches as a prize. */
export function prizeValueOf(data: GameData, shipId: string): number {
  return round10(data.combat.boarding.prizeFraction * data.ships[shipId].price);
}

/** Sell a kept capture as a prize. A hired escort is not for sale. */
export function sellEscortPrize(
  world: WorldState,
  data: GameData,
  id: string,
): { world: WorldState; paid: number } | { error: 'hired' | 'gone' } {
  const e = world.escorts.find((x) => x.id === id);
  if (!e) return { error: 'gone' };
  if (e.hired) return { error: 'hired' };
  const paid = prizeValueOf(data, e.shipId);
  return { world: { ...dismissEscort(world, id), credits: world.credits + paid }, paid };
}

/** One day's wages, in list order. An escort that can't be paid starts leaving (and draws no more). */
export function payWages(world: WorldState, data: GameData): WorldState {
  void data;
  let credits = world.credits;
  const escorts = world.escorts.map((e) => {
    if (!e.hired || e.leaving || e.wage <= 0) return e;
    if (credits >= e.wage) {
      credits -= e.wage;
      return e;
    }
    return { ...e, leaving: true as const };
  });
  return { ...world, credits, escorts };
}

/** Landing: unpaid escorts go, the rest refuel and are no longer waiting. */
export function landEscorts(world: WorldState, data: GameData): { world: WorldState; notices: string[] } {
  const notices = world.escorts.filter((e) => e.leaving).map((e) => `${e.name} leaves your service: unpaid wages.`);
  const escorts = world.escorts
    .filter((e) => !e.leaving)
    .map((e) => {
      const { waiting: _waiting, ...rest } = e;
      return { ...rest, fuel: escortMaxFuel(data, e) };
    });
  return { world: { ...world, escorts }, notices };
}

/** Cost of mending every escort to full armor. */
export function repairCost(world: WorldState, data: GameData): number {
  const missing = world.escorts.reduce((n, e) => n + Math.max(0, escortMaxArmor(data, e) - e.armor), 0);
  return Math.round(data.escorts.repairPerArmor * missing);
}

export function repairEscorts(world: WorldState, data: GameData): { world: WorldState; paid: number } | { error: 'short' | 'none' } {
  const paid = repairCost(world, data);
  if (paid <= 0) return { error: 'none' };
  if (world.credits < paid) return { error: 'short' };
  return {
    world: { ...world, credits: world.credits - paid, escorts: world.escorts.map((e) => ({ ...e, armor: escortMaxArmor(data, e) })) },
    paid,
  };
}
