import type { GameData } from '../data/schemas';
import { lanesOf } from './galaxy';
import { canJump, jumpDestination, planetsByDistance, towDestination } from './rules';
import type { WorldState } from './types';
import { dist, type Vec2 } from './vec';

/** Planets within this distance (center to ship) make `land` the context action. */
export const LAND_CONTEXT_RANGE = 600;

/** A site is opened from this close (px)... */
export const SITE_RANGE = 60;
/** ...and this slowly (px/s). */
export const SITE_MAX_SPEED = 40;

/** What the controller holds for the context button: an open hail, or a site at `pos`. */
export type PendingHint = { kind: 'hail' } | { kind: 'site'; pos: Vec2 } | null;

/** Is the ship close and slow enough to open the site at `pos`? */
export function siteReachable(world: WorldState, pos: Vec2): boolean {
  return dist(pos, world.ship.pos) <= SITE_RANGE && Math.hypot(world.ship.vel.x, world.ship.vel.y) < SITE_MAX_SPEED;
}

export type ContextAction = 'takeControl' | 'tow' | 'answerHail' | 'openSite' | 'flyToSite' | 'land' | 'plotCourse' | 'autopilotOut' | 'jump' | null;

/**
 * The one action a context button should offer right now, by priority:
 * takeControl > tow > openSite > land (a planet is targeted, at any range) > jump / autopilotOut (a course is
 * set, nothing targeted, no assist) > answerHail > flyToSite (`flyToSite`: a story site is in view but out of reach)
 * > land (a planet is in range) > plotCourse. `plotCourse` (open the star map)
 * covers the phone dead end: no jump destination can be chosen (no usable course and more than
 * one lane out), no assist running and no planet in range.
 */
export function contextAction(world: WorldState, data: GameData, pending: PendingHint = null, flyToSite = false): ContextAction {
  if (world.jump) return null;
  if (world.assist.kind === 'autopilot') return 'takeControl';
  if (towDestination(world, data)) return 'tow';
  if (pending?.kind === 'site' && siteReachable(world, pending.pos)) return 'openSite';
  // A targeted planet wins at any range: land does what the L key does (autopilot in, then land).
  if (world.targetPlanetId && data.planets[world.targetPlanetId]) return 'land';
  // Leaving with a course set must not offer "land" just because the ship is still near a planet.
  if (world.assist.kind === 'none' && jumpDestination(world, data)) {
    const out = leaveAction(world, data);
    if (out) return out;
  }
  // A hail never blocks leaving: a plotted jump or autopilot-out outranks it.
  if (pending?.kind === 'hail') return 'answerHail';
  // A story site in view but out of reach: the button flies there (a nearby port or the map must not hide it).
  if (flyToSite && world.assist.kind === 'none') return 'flyToSite';
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
