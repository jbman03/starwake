import { describe, expect, it } from 'vitest';
import type { JumpPhase } from '../sim/types';
import { moodFor, type MoodInput } from './moods';

const base: MoodInput = { screen: 'flying', jumpPhase: null, inCombat: false, fringe: false };
const mood = (o: Partial<MoodInput>) => moodFor({ ...base, ...o });

describe('moodFor', () => {
  it('is core when flying a core system', () => expect(mood({})).toBe('core'));
  it('is fringe when flying a fringe system', () => expect(mood({ fringe: true })).toBe('fringe'));
  it('is combat when in combat', () => expect(mood({ inCombat: true })).toBe('combat'));
  it('is docked when docked', () => expect(mood({ screen: 'docked' })).toBe('docked'));
  it('treats the menu as docked', () => expect(mood({ screen: 'menu' })).toBe('docked'));
  it.each(['charge', 'burn', 'flash'] as JumpPhase[])('is hyperspace during %s', (jumpPhase) => expect(mood({ jumpPhase })).toBe('hyperspace'));
  it.each(['align', 'arrive'] as JumpPhase[])('is not hyperspace during %s', (jumpPhase) => expect(mood({ jumpPhase })).toBe('core'));
  it('combat beats hyperspace', () => expect(mood({ inCombat: true, jumpPhase: 'burn' })).toBe('combat'));
  it('combat beats docked', () => expect(mood({ inCombat: true, screen: 'docked' })).toBe('combat'));
  it('hyperspace beats fringe', () => expect(mood({ jumpPhase: 'charge', fringe: true })).toBe('hyperspace'));
  it('hyperspace beats docked', () => expect(mood({ jumpPhase: 'flash', screen: 'docked' })).toBe('hyperspace'));
  it('docked beats fringe', () => expect(mood({ screen: 'docked', fringe: true })).toBe('docked'));
  it('fringe beats core only', () => expect(mood({ fringe: true, jumpPhase: 'align' })).toBe('fringe'));
});
