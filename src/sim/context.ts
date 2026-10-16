import type { GameData } from '../data/schemas';
import { canJump, planetsByDistance, towDestination } from './rules';
import type { WorldState } from './types';
import { dist } from './vec';

/** Planets within this distance (center to ship) make `land` the context action. */
export const LAND_CONTEXT_RANGE = 600;

export type ContextAction = 'takeControl' | 'tow' | 'land' | 'autopilotOut' | 'jump' | null;

/**
 * The one action a context button should offer right now, by priority:
 * takeControl > tow > land > autopilotOut > jump.
 */
export function contextAction(world: WorldState, data: GameData): ContextAction {
  if (world.jump) return null;
  if (world.assist.kind === 'autopilot') return 'takeControl';
  if (towDestination(world, data)) return 'tow';
  const nearest = planetsByDistance(world, data)[0];
  if (nearest && dist(nearest.pos, world.ship.pos) <= LAND_CONTEXT_RANGE) return 'land';
  const check = canJump(world, data);
  if (check.ok) return 'jump';
  // Only too close (fuel is fine): offer the autopilot out to the jump point.
  if (
    check.reason === 'tooClose' &&
    world.assist.kind === 'none' &&
    data.systems[world.systemId].links.length > 0 &&
    world.ship.fuel >= data.config.fuelPerJump
  ) {
    return 'autopilotOut';
  }
  return null;
}
