import type { GameData } from '../data/schemas';
import type { WorldState } from './types';

export interface ShipStats {
  cargo: number;
  passengers: number;
  fuelCapacity: number;
  shields: number;
  armor: number;
  outfitSpace: number;
  spaceUsed: number;
  /** outfitSpace - spaceUsed. Unclamped: negative means over capacity. */
  spaceFree: number;
  fuelPerMin: number;
}

/** Hull stats plus installed outfits. Pure; works for ships the player doesn't own (shipyard previews). Unknown outfit ids are ignored. */
export function shipStats(shipId: string, outfits: Record<string, number>, data: GameData): ShipStats {
  const hull = data.ships[shipId];
  const s: ShipStats = {
    cargo: hull.cargo,
    passengers: hull.passengers,
    fuelCapacity: hull.fuelCapacity,
    shields: hull.shields,
    armor: hull.armor,
    outfitSpace: hull.outfitSpace,
    spaceUsed: 0,
    spaceFree: hull.outfitSpace,
    fuelPerMin: 0,
  };
  for (const [id, count] of Object.entries(outfits)) {
    const def = data.outfits[id];
    if (!def || !(count > 0)) continue;
    s.spaceUsed += def.space * count;
    const e = def.effect; // weapons, ammo and pods add space only
    if ('cargo' in e) s.cargo += e.cargo * count;
    else if ('fuel' in e) s.fuelCapacity += e.fuel * count;
    else if ('armor' in e) s.armor += e.armor * count;
    else if ('shields' in e) s.shields += e.shields * count;
    else if ('fuelPerMin' in e) s.fuelPerMin += e.fuelPerMin * count;
  }
  s.spaceFree = s.outfitSpace - s.spaceUsed;
  return s;
}

export function worldStats(world: WorldState, data: GameData): ShipStats {
  return shipStats(world.shipId, world.outfits, data);
}
