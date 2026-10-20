import type { GameData, OutfitDef, ShipDef } from '../data/schemas';

/** A port belongs to the government of its system. */
export function governmentOf(planetId: string, data: GameData): string {
  const p = data.planets[planetId];
  return p ? (data.systems[p.systemId]?.government ?? '') : '';
}

/** True when the port's tier is high enough and, if the item is restricted, its government is listed. */
export function sells(
  planetId: string,
  item: { techTier: number; soldBy?: string[] },
  data: GameData,
): boolean {
  const p = data.planets[planetId];
  if (!p || p.techTier < item.techTier) return false;
  return !item.soldBy || item.soldBy.includes(governmentOf(planetId, data));
}

const byTierThenPrice = (a: { techTier: number; price: number }, b: { techTier: number; price: number }) =>
  a.techTier - b.techTier || a.price - b.price;

function stock<T extends { techTier: number; price: number; soldBy?: string[] }>(
  planetId: string,
  service: 'shipyard' | 'outfitter',
  items: Record<string, T>,
  data: GameData,
): T[] {
  if (!data.planets[planetId]?.services.includes(service)) return [];
  return Object.values(items)
    .filter((i) => sells(planetId, i, data))
    .sort(byTierThenPrice);
}

export const shipStock = (planetId: string, data: GameData): ShipDef[] =>
  stock(planetId, 'shipyard', data.ships, data);

export const outfitStock = (planetId: string, data: GameData): OutfitDef[] =>
  stock(planetId, 'outfitter', data.outfits, data);
