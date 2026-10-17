import type { GameData } from '../data/schemas';
import { hopDistance } from '../sim/galaxy';
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
 * The guided trade starting from `portId`: a classic good (one with no unique origin) that is Low
 * there and High at an exchange port in a different known system within 3 hops. Deterministic:
 * fewest hops first, then port id, then good id. Null if the port offers no such trade.
 */
export function pickTarget(world: WorldState, data: GameData, portId: string): GuideTarget | null {
  const from = data.planets[portId];
  if (!from?.market) return null;
  const known = new Set(world.known);
  const goods = Object.keys(from.market)
    .filter((g) => from.market?.[g] === 'low' && data.commodities[g] && !data.commodities[g].origin)
    .sort();
  if (goods.length === 0) return null;
  let best: { good: string; port: string; system: string; hops: number } | null = null;
  const hopsTo = new Map<string, number>();
  for (const planet of Object.values(data.planets)) {
    if (planet.id === portId || planet.systemId === from.systemId) continue;
    if (!known.has(planet.systemId) || !planet.services.includes('exchange')) continue;
    let hops = hopsTo.get(planet.systemId);
    if (hops === undefined) hopsTo.set(planet.systemId, (hops = hopDistance(data, from.systemId, planet.systemId)));
    if (hops > MAX_TARGET_HOPS) continue;
    for (const good of goods) {
      if (planet.market?.[good] !== 'high') continue;
      const better =
        !best ||
        hops < best.hops ||
        (hops === best.hops && (planet.id < best.port || (planet.id === best.port && good < best.good)));
      if (better) best = { good, port: planet.id, system: planet.systemId, hops };
    }
  }
  return best ? { good: best.good, system: best.system, port: best.port } : null;
}

/**
 * Fallback for a pilot whose current port has no guided trade: the trade from the nearest known
 * exchange port (fewest hops from the current system, then id) that has one. Null if none does.
 */
export function pickTargetNear(world: WorldState, data: GameData): GuideTarget | null {
  const known = new Set(world.known);
  const ports = Object.values(data.planets)
    .filter((p) => p.services.includes('exchange') && known.has(p.systemId))
    .map((p) => ({ id: p.id, hops: hopDistance(data, world.systemId, p.systemId) }))
    .filter((p) => Number.isFinite(p.hops))
    .sort((a, b) => a.hops - b.hops || (a.id < b.id ? -1 : 1));
  for (const p of ports) {
    const t = pickTarget(world, data, p.id);
    if (t) return t;
  }
  return null;
}
