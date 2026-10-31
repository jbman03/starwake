import type { GameData, Perk, RankReq, StandingLevel } from '../data/schemas';
import { legalStatus } from './law';
import { governmentShortName, standingMet } from './standing';
import { governmentOf } from './stock';
import type { WorldState } from './types';

/** A faction rank: 0 (unranked) to 5. */
export type Rank = 0 | 1 | 2 | 3 | 4 | 5;

/** Concord rank 4 also covers the Concord's `requiresStanding: friend` gates (spec §6.4). */
const STANDING_COVER = { government: 'concord', rank: 4 } as const;

function pointsOf(world: Pick<WorldState, 'ranks'>, gov: string): number {
  return world.ranks[gov]?.points ?? 0;
}

/** The pilot's rank with the government: how many of its thresholds the points reach. 0 for a government with no faction. */
export function rankOf(world: WorldState, data: GameData, gov: string): Rank {
  const faction = data.factions[gov];
  if (!faction) return 0;
  const points = pointsOf(world, gov);
  return faction.ranks.filter((r) => points >= r.points).length as Rank;
}

/** The title of the pilot's rank with the government, or null below rank 1. */
export function rankTitle(world: WorldState, data: GameData, gov: string): string | null {
  const rank = rankOf(world, data, gov);
  return rank > 0 ? data.factions[gov].ranks[rank - 1].title : null;
}

/** The perks the pilot holds with the government: those of every rank at or below the current one. */
function perksHeld(world: WorldState, data: GameData, gov: string): Perk[] {
  const rank = rankOf(world, data, gov);
  return rank > 0 ? data.factions[gov].ranks.slice(0, rank).map((r) => r.perk) : [];
}

function setPoints(world: WorldState, gov: string, points: number): WorldState {
  const old = world.ranks[gov];
  if ((old?.points ?? 0) === points) return world;
  return { ...world, ranks: { ...world.ranks, [gov]: { points, salaryDay: old?.salaryDay ?? -1 } } };
}

/**
 * Add `n` rank points with the government (negative takes them off), never below 0. A no-op while
 * it has the pilot Wanted or Hunted, and for a government with no faction. A gain of n also takes
 * floor(n/2) from each of its rivals, never below 0; that loss pulls from no one else.
 */
export function addPoints(world: WorldState, data: GameData, gov: string, n: number): WorldState {
  const faction = data.factions[gov];
  if (!faction || n === 0) return world;
  const status = legalStatus(world, data, gov);
  if (status === 'wanted' || status === 'hunted') return world;
  let w = setPoints(world, gov, Math.max(0, pointsOf(world, gov) + n));
  const loss = n > 0 ? Math.floor(n / 2) : 0;
  if (loss > 0) for (const rival of faction.rivals) if (w.ranks[rival]) w = setPoints(w, rival, Math.max(0, pointsOf(w, rival) - loss));
  return w;
}

/** The discount (percent) at the port, from its owner's best discount perk the pilot holds. */
export function discountPct(world: WorldState, data: GameData, portId: string): number {
  const gov = governmentOf(portId, data);
  let best = 0;
  for (const p of perksHeld(world, data, gov)) if (p.kind === 'discount' || p.kind === 'discountSalary') best = Math.max(best, p.pct);
  return best;
}

/** A list price after the port's discount: rounded, never below 0. */
export function discountedPrice(world: WorldState, data: GameData, portId: string, listPrice: number): number {
  return Math.max(0, Math.round((listPrice * (100 - discountPct(world, data, portId))) / 100));
}

/** The extra pay (percent) the government's missions give, from the best unlock perk the pilot holds. */
export function missionPayPct(world: WorldState, data: GameData, gov: string): number {
  let best = 0;
  for (const p of perksHeld(world, data, gov)) if (p.kind === 'unlock') best = Math.max(best, p.missionPayPct);
  return best;
}

/** The daily salary (cr) the government pays, from the best salary perk the pilot holds. */
function salaryOf(world: WorldState, data: GameData, gov: string): number {
  let best = 0;
  for (const p of perksHeld(world, data, gov)) if (p.kind === 'salary' || p.kind === 'discountSalary') best = Math.max(best, p.cr);
  return best;
}

/** Landing at a port pays its owner's salary, once per `world.day` per government; `paid` is 0 when none is due. */
export function paySalary(world: WorldState, data: GameData, portId: string): { world: WorldState; paid: number } {
  const gov = governmentOf(portId, data);
  const record = world.ranks[gov];
  const paid = salaryOf(world, data, gov);
  if (!record || paid <= 0 || record.salaryDay === world.day) return { world, paid: 0 };
  return {
    world: { ...world, credits: world.credits + paid, ranks: { ...world.ranks, [gov]: { ...record, salaryDay: world.day } } },
    paid,
  };
}

/** Does the pilot's rank with the government reach the requirement? An absent requirement is always met. */
export function rankMet(world: WorldState, data: GameData, req: { government: string; rank: number } | undefined): boolean {
  return !req || rankOf(world, data, req.government) >= req.rank;
}

/**
 * Is an item's standing gate met? As `standingMet` (with the law cap), or, for a Concord gate, by
 * Concord rank 4, so neither requirement blocks the other. The cover goes while the Concord has the
 * pilot Wanted or Hunted, as the standing itself does.
 */
export function standingGateMet(world: WorldState, data: GameData, req: { government: string; level: StandingLevel } | undefined): boolean {
  if (standingMet(world, req, data)) return true;
  if (!req || req.government !== STANDING_COVER.government || !rankMet(world, data, STANDING_COVER)) return false;
  const status = legalStatus(world, data, req.government);
  return status !== 'wanted' && status !== 'hunted';
}

/** "Requires Concord rank 4 (Beacon)". */
export function rankBlockText(req: RankReq, data: GameData): string {
  const title = data.factions[req.government]?.ranks[req.rank - 1]?.title;
  const head = `Requires ${governmentShortName(req.government, data)} rank ${req.rank}`;
  return title ? `${head} (${title})` : head;
}

/** The planet-screen notice for a paid salary: "Concord salary: +150 cr". */
export function salaryNoticeText(gov: string, paid: number, data: GameData): string {
  return `${governmentShortName(gov, data)} salary: +${paid} cr`;
}
