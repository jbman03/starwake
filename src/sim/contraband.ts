import type { GameData } from '../data/schemas';
import { addHeat, bribeCost, commitCrime, fineFor, legalStatus, payFines, tryBribe } from './law';
import { hashString, mulberry32 } from './random';
import type { WorldState } from './types';

/** Why a patrol hails: its scan found contraband, or the pilot owes it a fine (spec §4.4, §5.2). */
export type LawReason = 'scan' | 'fine';
/** The card's three answers: Comply (or Pay fine), Bribe, and Run (or Refuse). */
export type LawAnswer = 'comply' | 'bribe' | 'refuse';
/**
 * What the patrol does after the answer: carries on, leaves (bribed), attacks the pilot alone (a
 * failed bribe), or its whole government turns on the pilot (Run).
 */
export type PatrolFate = 'stays' | 'leaves' | 'attacks' | 'angry';

/** Commodity → tons in the hold that `gov` outlaws (an empty record when the hold is legal there). */
export function illegalHeld(world: WorldState, data: GameData, gov: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [id, tons] of Object.entries(world.cargo)) if (tons > 0 && data.commodities[id]?.illegalIn?.includes(gov)) out[id] = tons;
  return out;
}

const totalTons = (held: Record<string, number>) => Object.values(held).reduce((a, b) => a + b, 0);

/** A scrambler outfit is fitted. */
function scrambled(world: WorldState, data: GameData): boolean {
  return Object.entries(world.outfits).some(([id, n]) => n > 0 && data.outfits[id]?.category === 'scrambler');
}

/**
 * Does `gov`'s scan catch the hold? Never with nothing it outlaws aboard. Otherwise with probability
 * `catchChance`, cut by the fraction `scramblerCut` when a scrambler is fitted (0.8 → 0.4 by
 * default), drawn from `mulberry32(hashString(seed))`.
 */
export function scanCatches(world: WorldState, data: GameData, gov: string, seed: string): boolean {
  if (totalTons(illegalHeld(world, data, gov)) <= 0) return false;
  const { catchChance, scramblerCut } = data.law;
  const chance = scrambled(world, data) ? catchChance * (1 - scramblerCut) : catchChance;
  return mulberry32(hashString(seed))() < chance;
}

/**
 * Comply with a scan: the cargo `gov` outlaws goes and `contrabandFine` per ton is charged. The
 * credits pay what they can (nothing when in debt); the shortfall goes on the record as heat at
 * `fineRate` (rounded up). Caught with contraband also adds the `contraband` crime's heat.
 */
export function confiscate(world: WorldState, data: GameData, gov: string): { world: WorldState; tons: number; fine: number; paid: number } {
  const held = illegalHeld(world, data, gov);
  const tons = totalTons(held);
  const fine = Math.round(data.law.contrabandFine * tons);
  const paid = Math.max(0, Math.min(world.credits, fine));
  const cargo = Object.fromEntries(Object.entries(world.cargo).filter(([id]) => !(id in held)));
  let w: WorldState = { ...world, cargo, credits: world.credits - paid };
  w = commitCrime(w, data, gov, 'contraband');
  const short = fine - paid;
  if (short > 0 && data.law.fineRate > 0) w = addHeat(w, data, gov, Math.ceil(short / data.law.fineRate));
  return { world: w, tons, fine, paid };
}

/** What the card asks for Comply / Pay fine: the contraband fine for a scan, the record's fine otherwise. */
export function lawFine(world: WorldState, data: GameData, gov: string, reason: LawReason): number {
  return reason === 'scan' ? Math.round(data.law.contrabandFine * totalTons(illegalHeld(world, data, gov))) : fineFor(world, data, gov);
}

/** A bribe: bribeMul × the contraband fine for a scan (Ruling 4), bribeMul × the record's fine for a law hail. */
export function lawBribeCost(world: WorldState, data: GameData, gov: string, reason: LawReason): number {
  return reason === 'scan' ? Math.round(data.law.bribeMul * lawFine(world, data, gov, 'scan')) : bribeCost(world, data, gov);
}

/** Refuse is Run while Wanted (or worse); a scan's third answer is always Run. */
export function refuseIsRun(world: WorldState, data: GameData, gov: string, reason: LawReason): boolean {
  if (reason === 'scan') return true;
  const s = legalStatus(world, data, gov);
  return s === 'wanted' || s === 'hunted';
}

/**
 * The pilot's answer to a patrol's scan or law hail (spec §4.3, §5.2). Null, changing nothing, when
 * it can't be done: Pay fine or Bribe short of credits, or a fine no longer owed.
 * - scan Comply: `confiscate`. fine Pay: `payFines`. Both leave the patrol peaceful.
 * - Bribe: `tryBribe` (a scan's cost per Ruling 4). It works and the patrol leaves, heat unchanged;
 *   or it fails, costing nothing but `bribeFailHeat`, and that patrol attacks (Ruling 3).
 * - Run: `run` heat and the government turns on the pilot. Refuse while Suspect: `refuseHeat`, and peace.
 */
export function answerLaw(
  world: WorldState,
  data: GameData,
  hail: { gov: string; reason: LawReason; npcName: string },
  answer: LawAnswer,
  seed: string,
): { world: WorldState; messages: string[]; patrol: PatrolFate } | null {
  const { gov, reason, npcName } = hail;
  if (answer === 'comply') {
    if (reason === 'scan') {
      const c = confiscate(world, data, gov);
      const took = `${npcName} confiscates ${c.tons} t of contraband.`;
      const messages =
        c.paid <= 0 && c.fine > 0
          ? [`${took} You can't pay the fine of ${c.fine} cr: it goes on your record.`]
          : [`${took} You pay a fine of ${c.paid} cr.`];
      if (c.paid > 0 && c.paid < c.fine) messages.push(`You can't cover the other ${c.fine - c.paid} cr: it goes on your record.`);
      return { world: c.world, messages, patrol: 'stays' };
    }
    const fine = fineFor(world, data, gov);
    const r = payFines(world, data, gov);
    if ('error' in r) return null;
    return { world: r.world, messages: [`You pay the fine of ${fine} cr. Your record is clean.`], patrol: 'stays' };
  }
  if (answer === 'bribe') {
    const cost = lawBribeCost(world, data, gov, reason);
    const r = tryBribe(world, data, gov, seed, cost);
    if ('error' in r) return null;
    return r.ok
      ? { world: r.world, messages: [`${npcName} takes the ${cost} cr and looks the other way.`], patrol: 'leaves' }
      : { world: r.world, messages: [`${npcName} refuses the bribe and opens fire.`], patrol: 'attacks' };
  }
  if (refuseIsRun(world, data, gov, reason)) {
    return { world: commitCrime(world, data, gov, 'run'), messages: [`You run. ${npcName} opens fire.`], patrol: 'angry' };
  }
  return { world: addHeat(world, data, gov, data.law.refuseHeat), messages: [`You refuse. ${npcName} logs it on your record.`], patrol: 'stays' };
}
