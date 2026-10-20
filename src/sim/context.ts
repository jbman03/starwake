import type { GameData } from '../data/schemas';
import { lanesOf } from './galaxy';
import { canJump, jumpDestination, planetsByDistance, towDestination } from './rules';
import type { WorldState } from './types';
import { dist } from './vec';

/** Planets within this distance (center to ship) make `land` the context action. */
export const LAND_CONTEXT_RANGE = 600;

export type ContextAction = 'takeControl' | 'tow' | 'land' | 'plotCourse' | 'autopilotOut' | 'jump' | null;

/**
 * The one action a context button should offer right now, by priority:
 * takeControl > tow > land (a planet is targeted, at any range) > jump / autopilotOut (a course is
 * set, nothing targeted, no assist) > land (a planet is in range) > plotCourse. `plotCourse` (open the star map)
 * covers the phone dead end: no jump destination can be chosen (no usable course and more than
 * one lane out), no assist running and no planet in range.
 */
export function contextAction(world: WorldState, data: GameData): ContextAction {
  if (world.jump) return null;
  if (world.assist.kind === 'autopilot') return 'takeControl';
  if (towDestination(world, data)) return 'tow';
  // A targeted planet wins at any range: land does what the L key does (autopilot in, then land).
  if (world.targetPlanetId && data.planets[world.targetPlanetId]) return 'land';
  // Leaving with a course set must not offer "land" just because the ship is still near a planet.
  if (world.assist.kind === 'none' && jumpDestination(world, data)) {
    const out = leaveAction(world, data);
    if (out) return out;
  }
  const nearest = planetsByDistance(world, data)[0];
  if (nearest && dist(nearest.pos, world.ship.pos) <= LAND_CONTEXT_RANGE) return 'land';
  if (world.assist.kind === 'none' && !jumpDestination(world, data) && lanesOf(data, world.systemId, world.flags).length > 1) {
    return 'plotCourse';
  }
  return leaveAction(world, data);
}

/** Jump when clear of the star; autopilot out when only too close (fuel is fine); else null. */
function leaveAction(world: WorldState, data: GameData): 'jump' | 'autopilotOut' | null {
  const check = canJump(world, data);
  if (check.ok) return 'jump';
  if (
    check.reason === 'tooClose' &&
    world.assist.kind === 'none' &&
    lanesOf(data, world.systemId, world.flags).length > 0 &&
    world.ship.fuel >= data.config.fuelPerJump
  ) {
    return 'autopilotOut';
  }
  return null;
}
