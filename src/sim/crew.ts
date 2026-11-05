import type { GameData } from '../data/schemas';
import type { WorldState } from './types';

/** The most crew the pilot's hull berths: its complement. */
export function crewCap(world: Pick<WorldState, 'shipId'>, data: GameData): number {
  return data.ships[world.shipId]?.crew ?? 1;
}

/** Hands still to hire to fill the complement, and what that costs. */
export function crewHire(world: WorldState, data: GameData): { count: number; cost: number } {
  const count = Math.max(0, crewCap(world, data) - world.crew);
  return { count, cost: count * data.fleet.crew.hireCost };
}

/** Hire crew to the full complement at a bar. */
export function hireCrew(world: WorldState, data: GameData): { world: WorldState; count: number; paid: number } | { error: 'full' | 'short' } {
  const { count, cost } = crewHire(world, data);
  if (count <= 0) return { error: 'full' };
  if (world.credits < cost) return { error: 'short' };
  return { world: { ...world, credits: world.credits - cost, crew: world.crew + count }, count, paid: cost };
}

/** Crew lost in a capture attempt: a share of the party, rounded up on a failure and down on a success. */
export function captureCasualties(world: Pick<WorldState, 'crew'>, data: GameData, won: boolean): number {
  const c = data.fleet.crew;
  const raw = won ? Math.floor(world.crew * c.winLoss) : Math.ceil(world.crew * c.failLoss);
  return Math.max(0, Math.min(raw, world.crew - c.minCrew));
}

/** The world after a capture attempt's casualties. */
export function crewAfterCapture(world: WorldState, data: GameData, won: boolean): { world: WorldState; lost: number } {
  const lost = captureCasualties(world, data, won);
  return { world: lost > 0 ? { ...world, crew: world.crew - lost } : world, lost };
}

/** "lost 2 crew" / "lost 1 crew member", or '' for none. */
export function crewLossText(lost: number): string {
  if (lost <= 0) return '';
  return lost === 1 ? 'You lose 1 crew member.' : `You lose ${lost} crew.`;
}
