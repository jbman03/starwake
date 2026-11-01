import type { GameData } from '../data/schemas';
import type { Escort, EscortOrder } from './types';
import { shipStats } from './shipStats';

export const ESCORT_ORDERS: readonly EscortOrder[] = ['follow', 'attack', 'hold', 'defend'];

/** Full armor of an escort: hull plus fitted outfits. */
export function escortMaxArmor(data: GameData, e: Pick<Escort, 'shipId' | 'outfits'>): number {
  return shipStats(e.shipId, e.outfits, data).armor;
}

/** Full tank of an escort, in whole jumps. */
export function escortMaxFuel(data: GameData, e: Pick<Escort, 'shipId' | 'outfits'>): number {
  return Math.floor(shipStats(e.shipId, e.outfits, data).fuelCapacity / data.config.fuelPerJump);
}
