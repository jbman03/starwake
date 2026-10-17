import type { GameData } from '../data/schemas';
import { setRoute } from '../sim/world';
import type { WorldState } from '../sim/types';

/** What the guide has the player trade: buy {good} at the start port, sell it at {port} in {system}. */
export interface GuideTarget {
  good: string;
  system: string;
  port: string;
}

/** How far (in jumps) the selling port may be. */
export const MAX_TARGET_HOPS = 3;

/**
 * Jumps the player would need to plot from `fromSystem` to `toSystem` using only charted lanes
 * (exactly what the star map allows), or null when there is no such course, it is longer than
 * MAX_TARGET_HOPS, or the ship's fuel can't cover it.
 */
function plottableHops(world: WorldState, data: GameData, fromSystem: string, toSystem: string): number | null {
  // Mission clients' charts don't count: the guide must work for a pilot with no jobs.
  const r = setRoute({ ...world, systemId: fromSystem, missions: [] }, data, toSystem);
  if (!r.ok) return null;
  const hops = r.world.route.length;
  if (hops < 1 || hops > MAX_TARGET_HOPS) return null;
  return world.ship.fuel >= hops * data.config.fuelPerJump ? hops : null;
}

const isClassic = (data: GameData, g: string): boolean => !!data.commodities[g] && !data.commodities[g].origin;

/** Exchange ports in known systems where `good` is High, with plottable hops from `fromSystem`. */
function buyers(world: WorldState, data: GameData, fromSystem: string, portId: string | null, goods: string[]) {
  const known = new Set(world.known);
  const hopsTo = new Map<string, number | null>();
  const out: { good: string; port: string; system: string; hops: number }[] = [];
  for (const planet of Object.values(data.planets)) {
    if (planet.id === portId || planet.systemId === fromSystem) continue;
    if (!known.has(planet.systemId) || !planet.services.includes('exchange')) continue;
    if (!hopsTo.has(planet.systemId)) hopsTo.set(planet.systemId, plottableHops(world, data, fromSystem, planet.systemId));
    const hops = hopsTo.get(planet.systemId);
    if (hops == null) continue;
    for (const good of goods) {
      if (planet.market?.[good] === 'high') out.push({ good, port: planet.id, system: planet.systemId, hops });
    }
  }
  // Fewest hops, then port id, then good id.
  out.sort((a, b) => a.hops - b.hops || (a.port < b.port ? -1 : a.port > b.port ? 1 : a.good < b.good ? -1 : a.good > b.good ? 1 : 0));
  return out;
}

/**
 * The guided trade starting from `portId`: a classic good (one with no unique origin) that is Low
 * there and High at an exchange port in a different known system the player can really plot a
 * course to (charted lanes only), within 3 jumps and with fuel to make it. Deterministic: fewest
 * hops, then port id, then good id. Null if the port offers no such trade.
 */
export function pickTarget(world: WorldState, data: GameData, portId: string): GuideTarget | null {
  const from = data.planets[portId];
  if (!from?.market) return null;
  const goods = Object.keys(from.market)
    .filter((g) => from.market?.[g] === 'low' && isClassic(data, g))
    .sort();
  const best = buyers(world, data, from.systemId, portId, goods)[0];
  return best ? { good: best.good, system: best.system, port: best.port } : null;
}

/**
 * Fallback for a pilot whose current port has no guided trade (the guide then starts at Leave and
 * never asks them to buy). Measured from where the player is now: the nearest plottable exchange
 * port that pays High for a classic good that is Low at some known exchange port. Null if none.
 */
export function pickTargetNear(world: WorldState, data: GameData): GuideTarget | null {
  const known = new Set(world.known);
  const cheap = new Set<string>();
  for (const p of Object.values(data.planets)) {
    if (!p.services.includes('exchange') || !known.has(p.systemId)) continue;
    for (const [g, lvl] of Object.entries(p.market ?? {})) if (lvl === 'low' && isClassic(data, g)) cheap.add(g);
  }
  const best = buyers(world, data, world.systemId, null, [...cheap].sort())[0];
  return best ? { good: best.good, system: best.system, port: best.port } : null;
}
