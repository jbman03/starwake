import type { GameData } from '../data/schemas';
import { canJump, planetsByDistance, towDestination } from './rules';
import type { WorldState } from './types';
import { dist } from './vec';

/** Planets within this distance (center to ship) make `land` the context action. */
export const LAND_CONTEXT_RANGE = 600;

export type ContextAction = 'takeControl' | 'tow' | 'land' | 'jump' | null;

/** The one action a context button should offer right now, by priority. */
export function contextAction(world: WorldState, data: GameData): ContextAction {
  if (world.jump) return null;
  if (world.assist.kind === 'autopilot') return 'takeControl';
  if (towDestination(world, data)) return 'tow';
  const nearest = planetsByDistance(world, data)[0];
  if (nearest && dist(nearest.pos, world.ship.pos) <= LAND_CONTEXT_RANGE) return 'land';
  if (canJump(world, data).ok) return 'jump';
  return null;
}
