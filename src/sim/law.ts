import type { GameData } from '../data/schemas';
import { RAIDERS } from './ai';
import { hashString, mulberry32 } from './random';
import type { WorldState } from './types';

/** How a government's law sees the pilot, read from its heat (spec §4.1). */
export type LegalStatus = 'clean' | 'suspect' | 'wanted' | 'hunted';
/** Crimes against a government's ships; each adds `law.crimes[crime]` heat (spec §4.2). */
export type Crime = 'hit' | 'disable' | 'destroy' | 'contraband' | 'run' | 'board';

/** How each status reads in the UI ("Wanted") and its colour (sidebar, spec §7). */
export const LEGAL_LABEL: Record<LegalStatus, string> = { clean: 'Clean', suspect: 'Suspect', wanted: 'Wanted', hunted: 'Hunted' };
export const LEGAL_COLOR: Record<LegalStatus, string> = { clean: '#7fd18b', suspect: '#e0c060', wanted: '#e08a50', hunted: '#e05050' };

const MAX_HEAT = 100;

/** The pilot's heat (0-100) with the government's law; 0 when it has no record. */
export function heatOf(world: Pick<WorldState, 'law'>, gov: string): number {
  return world.law[gov]?.heat ?? 0;
}

export function legalStatus(world: Pick<WorldState, 'law'>, data: GameData, gov: string): LegalStatus {
  const heat = heatOf(world, gov);
  const t = data.law.thresholds;
  if (heat >= t.hunted) return 'hunted';
  if (heat >= t.wanted) return 'wanted';
  if (heat >= t.suspect) return 'suspect';
  return 'clean';
}

/** The governments that hunt the pilot (their patrols attack on sight, spec §4.4), in record order. */
export function huntingGovernments(world: Pick<WorldState, 'law'>, data: GameData): string[] {
  return Object.keys(world.law).filter((gov) => legalStatus(world, data, gov) === 'hunted');
}

function setHeat(world: WorldState, gov: string, heat: number): WorldState {
  return { ...world, law: { ...world.law, [gov]: { heat } } };
}

/** Add (or, negative, take off) heat with the government, clamped to 0-100. The raiders have no law: a no-op. */
export function addHeat(world: WorldState, _data: GameData, gov: string, amount: number): WorldState {
  if (gov === RAIDERS) return world;
  const before = heatOf(world, gov);
  const heat = Math.min(MAX_HEAT, Math.max(0, before + amount));
  return heat === before ? world : setHeat(world, gov, heat);
}

/** A crime against one of the government's ships (or its scan): its data heat. */
export function commitCrime(world: WorldState, data: GameData, gov: string, crime: Crime): WorldState {
  return addHeat(world, data, gov, data.law.crimes[crime]);
}

/** `days` days pass: every government's heat falls by `decayPerDay` each, never below 0. */
export function decayHeat(world: WorldState, data: GameData, days: number): WorldState {
  const cut = data.law.decayPerDay * days;
  if (cut <= 0 || Object.keys(world.law).length === 0) return world;
  const law = Object.fromEntries(Object.entries(world.law).map(([g, l]) => [g, { heat: Math.max(0, l.heat - cut) }]));
  return { ...world, law };
}

/** What clearing the government's record costs: heat x fineRate, rounded. */
export function fineFor(world: Pick<WorldState, 'law'>, data: GameData, gov: string): number {
  return Math.round(heatOf(world, gov) * data.law.fineRate);
}

/**
 * Pay the government's fine: the credits go and its heat drops to 0. Refused with `none` while Clean
 * (nothing is owed) and with `short` when the credits don't cover it; a refusal changes nothing.
 */
export function payFines(world: WorldState, data: GameData, gov: string): { world: WorldState } | { error: 'short' | 'none' } {
  if (legalStatus(world, data, gov) === 'clean') return { error: 'none' };
  const fine = fineFor(world, data, gov);
  if (world.credits < fine) return { error: 'short' };
  return { world: setHeat({ ...world, credits: world.credits - fine }, gov, 0) };
}

/** A bribe costs bribeMul x the fine, rounded. */
export function bribeCost(world: Pick<WorldState, 'law'>, data: GameData, gov: string): number {
  return Math.round(data.law.bribeMul * fineFor(world, data, gov));
}

/**
 * Offer a bribe. It works with probability `bribeChance`, drawn from `mulberry32(hashString(seed))`,
 * so the seed fixes the outcome. On success the cost is paid and heat is unchanged; on failure the
 * patrol keeps its honour (no credits change hands) and heat rises by `bribeFailHeat`. Refused with
 * `short`, changing nothing, when the credits don't cover the cost. `cost` defaults to `bribeCost`; a scan's
 * bribe passes its own (Ruling 4).
 */
export function tryBribe(
  world: WorldState,
  data: GameData,
  gov: string,
  seed: string,
  cost: number = bribeCost(world, data, gov),
): { world: WorldState; ok: boolean } | { error: 'short' } {
  if (world.credits < cost) return { error: 'short' };
  const ok = mulberry32(hashString(seed))() < data.law.bribeChance;
  if (ok) return { world: { ...world, credits: world.credits - cost }, ok };
  return { world: addHeat(world, data, gov, data.law.bribeFailHeat), ok };
}

/** The planet's owner (its system's government) hunts the pilot, so it refuses landing. */
export function landingRefused(world: Pick<WorldState, 'law'>, data: GameData, planetId: string): boolean {
  const planet = data.planets[planetId];
  const gov = planet ? data.systems[planet.systemId]?.government : undefined;
  return gov !== undefined && legalStatus(world, data, gov) === 'hunted';
}

/**
 * Taken into custody on arrival at a port of a government that hunts the pilot (a tow or pod with
 * nowhere else to go, Ruling 2): its fine is paid from the credits as far as they go (nothing when
 * in debt). Paid in full, the record is clear; part-paid, the heat drops by what was paid (at `fineRate`) but
 * never above just below Wanted, so the port takes the ship and patrols hold fire (Ruling 13).
 */
export function takeIntoCustody(world: WorldState, data: GameData, gov: string): { world: WorldState; paid: number } {
  if (gov === RAIDERS) return { world, paid: 0 };
  const fine = fineFor(world, data, gov);
  const paid = Math.max(0, Math.min(world.credits, fine));
  // Paid in full clears the record; part-paid takes off the heat the payment covers, held to just below Wanted.
  const covered = data.law.fineRate > 0 ? Math.floor(paid / data.law.fineRate) : 0;
  const heat = paid >= fine ? 0 : Math.min(heatOf(world, gov) - covered, data.law.thresholds.wanted - 1);
  return { world: setHeat({ ...world, credits: world.credits - paid }, gov, Math.max(0, heat)), paid };
}
