import type { GameData, StandingLevel } from '../data/schemas';
import type { WorldState } from './types';

export const STANDING_RANK: Record<StandingLevel, number> = { cool: 0, neutral: 1, friend: 2 };

export function standingOf(world: Pick<WorldState, 'standing'>, gov: string): StandingLevel {
  return world.standing[gov] ?? 'neutral';
}

/** Does the pilot's standing with the government reach the level? An absent requirement is always met. */
export function standingMet(world: Pick<WorldState, 'standing'>, req: { government: string; level: StandingLevel } | undefined): boolean {
  return !req || STANDING_RANK[standingOf(world, req.government)] >= STANDING_RANK[req.level];
}

/** The short name pilots use: "Concord of Lanterns" -> "Concord", "Free Reach Compact" -> "Free Reach". */
export function governmentShortName(gov: string, data: GameData): string {
  const name = data.governments[gov]?.name ?? gov;
  const head = name.split(' of ')[0].split(' ');
  return (head.length > 1 && head.length === name.split(' ').length ? head.slice(0, -1) : head).join(' ');
}

/** "Requires Concord friendship". */
export function standingBlockText(req: { government: string }, data: GameData): string {
  return `Requires ${governmentShortName(req.government, data)} friendship`;
}
