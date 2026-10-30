import type { JumpPhase } from '../sim/types';

/** Every music mood; `data/audio.json` → `moods` has a record for each. */
export const MOOD_IDS = ['core', 'fringe', 'combat', 'docked', 'hyperspace'] as const;
export type MoodId = (typeof MOOD_IDS)[number];

export interface MoodInput {
  screen: 'menu' | 'docked' | 'flying';
  jumpPhase: JumpPhase | null;
  inCombat: boolean;
  fringe: boolean;
}

/** Which music mood fits the game state: combat > hyperspace > docked (and the menu) > fringe > core. */
export function moodFor(i: MoodInput): MoodId {
  if (i.inCombat) return 'combat';
  if (i.jumpPhase === 'charge' || i.jumpPhase === 'burn' || i.jumpPhase === 'flash') return 'hyperspace';
  if (i.screen === 'docked' || i.screen === 'menu') return 'docked';
  return i.fringe ? 'fringe' : 'core';
}
