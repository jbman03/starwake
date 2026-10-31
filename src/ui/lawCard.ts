import type { EncounterView } from '../app/controller';
import type { LawReason } from '../sim/contraband';
import { formatCredits } from './dom';

/** What the law card needs to know: who hails, why, and what each answer costs. */
export interface LawCardInput {
  npcName: string;
  /** The government's short name ("Concord"). */
  govName: string;
  reason: LawReason;
  /** Contraband aboard for a scan, as "3 t of Unlicensed Stims" lines; empty for a fine. */
  goods: string[];
  /** Comply's fine (scan) or the record's fine (law hail). */
  fine: number;
  bribe: number;
  credits: number;
  /** The third answer is Run (a scan, or a fine while Wanted) rather than Refuse. */
  run: boolean;
}

const list = (items: string[]) => (items.length <= 1 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`);

/**
 * The card for a patrol's scan or law hail, shown by the encounter card (keys 1/2/3) like a raider's
 * demand: scan → Comply / Bribe / Run; fine → Pay fine / Bribe / Refuse (Run while Wanted). Pay and
 * Bribe are blocked when the credits fall short; Comply never is (a shortfall goes on the record).
 * There is no "Not now" (`noDecline`): a law hail is always answered, and Esc does nothing (Ruling 14).
 */
export function lawCardView(v: LawCardInput): EncounterView {
  const short = (cost: number) => (v.credits >= cost ? null : 'Not enough credits');
  const patrol = `${v.npcName}, a ${v.govName} patrol,`;
  if (v.reason === 'scan') {
    return {
      kind: 'hail',
      title: `${v.npcName} scans your hold`,
      text: `${patrol} has found ${list(v.goods)} in your hold. "That cargo is outlawed here. Hand it over and pay a fine of ${formatCredits(v.fine)}."`,
      choices: [
        { label: `Comply (fine ${formatCredits(v.fine)})`, blocked: null },
        { label: `Bribe ${formatCredits(v.bribe)}`, blocked: short(v.bribe) },
        { label: 'Run', blocked: null },
      ],
      noDecline: true,
    };
  }
  return {
    kind: 'hail',
    title: `${v.npcName} hails you`,
    text: `${patrol} has you on its records. "Pay your fine of ${formatCredits(v.fine)}${v.run ? ', or we open fire' : ''}."`,
    choices: [
      { label: `Pay fine ${formatCredits(v.fine)}`, blocked: short(v.fine) },
      { label: `Bribe ${formatCredits(v.bribe)}`, blocked: short(v.bribe) },
      { label: v.run ? 'Run' : 'Refuse', blocked: null },
    ],
    noDecline: true,
  };
}
