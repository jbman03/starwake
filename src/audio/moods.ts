import type { JumpPhase } from '../sim/types';

export type MoodId = 'core' | 'fringe' | 'combat' | 'docked' | 'hyperspace';

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
