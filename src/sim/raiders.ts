import type { GameData } from '../data/schemas';
import type { WorldState } from './types';

/** What a raider asks for. `credits` is rounded to 10; `cargo` is null with an empty hold. */
export interface DemandTerms {
  credits: number;
  /** The main good (the most valuable held) and the tons taken in all; `take` spreads them over goods, dearest first. */
  cargo: { good: string; tons: number; take: Record<string, number> } | null;
}

/** The demand for this pilot: a share of credits (at least the minimum) or the dearest tons of cargo. */
export function demandTerms(world: WorldState, data: GameData): DemandTerms {
  const d = data.combat.demand;
  const credits = Math.round(Math.max(d.minCredits, d.creditsFraction * world.credits) / 10) * 10;
  const goods = Object.entries(world.cargo)
    .filter(([id, t]) => t > 0 && data.commodities[id])
    .sort((a, b) => data.commodities[b[0]].basePrice - data.commodities[a[0]].basePrice || a[0].localeCompare(b[0]));
  if (goods.length === 0) return { credits, cargo: null };
  const take: Record<string, number> = {};
  let left = d.cargoTons;
  for (const [id, held] of goods) {
    if (left <= 0) break;
    const n = Math.min(held, left);
    take[id] = n;
    left -= n;
  }
  return { credits, cargo: { good: goods[0][0], tons: d.cargoTons - left, take } };
}

/** The pilot pays; null when short of credits. */
export function payCredits(world: WorldState, t: DemandTerms): WorldState | null {
  if (world.credits < t.credits) return null;
  return { ...world, credits: world.credits - t.credits };
}

/** The pilot dumps the demanded cargo; null when there is none (or the hold no longer has it). */
export function dumpCargo(world: WorldState, t: DemandTerms): WorldState | null {
  if (!t.cargo) return null;
  const cargo = { ...world.cargo };
  for (const [id, n] of Object.entries(t.cargo.take)) {
    if ((cargo[id] ?? 0) < n) return null;
    const left = cargo[id] - n;
    if (left > 0) cargo[id] = left;
    else delete cargo[id];
  }
  return { ...world, cargo };
}
