import type { GameData, StandingLevel } from '../data/schemas';
import { legalStatus } from './law';
import type { WorldState } from './types';

export const STANDING_RANK: Record<StandingLevel, number> = { cool: 0, neutral: 1, friend: 2 };

/** The world's standing, plus its law record when the cap should apply. */
type StandingView = Pick<WorldState, 'standing'> & Partial<Pick<WorldState, 'law'>>;

/**
 * The pilot's standing with the government. Given `data` and a law record, it is capped at `cool`
 * while that government has the pilot Wanted or Hunted (spec §4.1); the stored standing is untouched,
 * so it returns once heat falls. Without them it is the stored standing (what anger and the story write to).
 */
export function standingOf(world: StandingView, gov: string, data?: GameData): StandingLevel {
  const stored = world.standing[gov] ?? 'neutral';
  if (!data || !world.law) return stored;
  const status = legalStatus({ law: world.law }, data, gov);
  return status === 'wanted' || status === 'hunted' ? 'cool' : stored;
}

/** Does the pilot's standing with the government reach the level? An absent requirement is always met. Capped as `standingOf` with `data`. */
export function standingMet(world: StandingView, req: { government: string; level: StandingLevel } | undefined, data?: GameData): boolean {
  return !req || STANDING_RANK[standingOf(world, req.government, data)] >= STANDING_RANK[req.level];
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
