import type { GameData, PlanetDef, ShipDef } from '../data/schemas';
import type { WorldState } from './types';
import { add, dist, len, norm, scale, sub, type Vec2 } from './vec';

/** Star sits at the origin of every system. */
export const SYSTEM_CENTER: Vec2 = { x: 0, y: 0 };
/** Jump point sits this far beyond the jump distance. */
export const JUMP_POINT_MARGIN = 50;

export type JumpCheck = { ok: true } | { ok: false; reason: 'tooClose' | 'noFuel' | 'jumping' | 'noDestination' };
export type RefuelQuote = { units: number; cost: number; reason?: 'full' | 'noCredits' };

/** Planets of the current system, sorted nearest-first from the ship. */
export function planetsByDistance(world: WorldState, data: GameData): PlanetDef[] {
  const pos = world.ship.pos;
  return Object.values(data.planets)
    .filter((p) => p.systemId === world.systemId)
    .sort((a, b) => dist(pos, a.pos) - dist(pos, b.pos));
}

export function canLand(world: WorldState, data: GameData, planetId: string): boolean {
  const p = data.planets[planetId];
  if (!p || p.systemId !== world.systemId) return false;
  const { landingMargin, landingSpeed } = data.config;
  return dist(world.ship.pos, p.pos) <= p.radius + landingMargin && len(world.ship.vel) <= landingSpeed;
}

/** Selected planet if set and not cycling; else nearest; cycling picks the next by distance. */
export function pickLandTarget(world: WorldState, data: GameData, cycle: boolean): string | null {
  const sorted = planetsByDistance(world, data);
  if (sorted.length === 0) return null;
  const idx = sorted.findIndex((p) => p.id === world.targetPlanetId);
  if (idx < 0) return sorted[0].id;
  if (!cycle) return sorted[idx].id;
  return sorted[(idx + 1) % sorted.length].id;
}

export function canJump(world: WorldState, data: GameData): JumpCheck {
  if (world.jump) return { ok: false, reason: 'jumping' };
  const sys = data.systems[world.systemId];
  if (dist(world.ship.pos, SYSTEM_CENTER) < sys.jumpDistance) return { ok: false, reason: 'tooClose' };
  if (world.ship.fuel < data.config.fuelPerJump) return { ok: false, reason: 'noFuel' };
  if (!jumpDestination(world, data)) return { ok: false, reason: 'noDestination' };
  return { ok: true };
}

/** True when the route's next hop is set but not linked from the current system. */
export function routeBroken(world: WorldState, data: GameData): boolean {
  const next = world.route[0];
  return next !== undefined && !data.systems[world.systemId].links.includes(next);
}

/**
 * Destination of a jump from the current system: the route's next hop if it is linked from here;
 * else the only link when there is exactly one; else null (the player must plot a course).
 */
export function jumpDestination(world: WorldState, data: GameData): string | null {
  const links = data.systems[world.systemId].links;
  const next = world.route[0];
  if (next !== undefined && links.includes(next)) return next;
  return links.length === 1 ? links[0] : null;
}

/**
 * Point at jumpDistance+50 from center, toward the destination system's map position. With no
 * destination: radially outward through the ship, or along +x when the ship sits at the center.
 */
export function jumpPoint(world: WorldState, data: GameData): Vec2 {
  const sys = data.systems[world.systemId];
  const destId = jumpDestination(world, data);
  const dest = destId ? data.systems[destId] : undefined;
  let dir = dest ? norm(sub(dest.mapPos, sys.mapPos)) : norm(sub(world.ship.pos, SYSTEM_CENTER));
  if (len(dir) === 0) dir = { x: 1, y: 0 };
  return add(SYSTEM_CENTER, scale(dir, sys.jumpDistance + JUMP_POINT_MARGIN));
}

/** How much fuel a refuel would buy. Partial when short of credits; nothing when credits ≤ 0. */
export function refuelQuote(fuel: number, def: ShipDef, planet: PlanetDef, credits: number): RefuelQuote {
  const price = planet.fuelPrice;
  const need = Math.max(0, def.fuelCapacity - fuel);
  if (need <= 0) return { units: 0, cost: 0, reason: 'full' };
  if (credits <= 0) return { units: 0, cost: 0, reason: 'noCredits' };
  if (price === 0) return { units: need, cost: 0 };
  const units = Math.min(need, Math.floor(credits / price));
  if (units <= 0) return { units: 0, cost: 0, reason: 'noCredits' };
  return { units, cost: units * price };
}

/**
 * Where a stranded ship gets towed: null unless fuel < fuelPerJump and the current system has no
 * port (every port sells fuel). BFS over links; in the first system with a port, the planet nearest its center.
 */
export function towDestination(world: WorldState, data: GameData): string | null {
  if (world.ship.fuel >= data.config.fuelPerJump) return null;
  const planets = Object.values(data.planets);
  const fuelIn = (sysId: string) => planets.filter((p) => p.systemId === sysId);
  if (fuelIn(world.systemId).length > 0) return null;

  const seen = new Set<string>([world.systemId]);
  const queue = [...data.systems[world.systemId].links];
  queue.forEach((s) => seen.add(s));
  while (queue.length) {
    const sysId = queue.shift()!;
    const found = fuelIn(sysId).sort((a, b) => dist(a.pos, SYSTEM_CENTER) - dist(b.pos, SYSTEM_CENTER));
    if (found.length) return found[0].id;
    for (const next of data.systems[sysId]?.links ?? []) {
      if (!seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  return null;
}
