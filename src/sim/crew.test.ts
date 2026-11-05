import { describe, expect, it } from 'vitest';
import { testData } from '../data/testData';
import { captureCasualties, crewAfterCapture, crewCap, crewHire, crewLossText, hireCrew } from './crew';
import { takeCommand } from './boarding';
import { buyShip } from './shipyard';
import { podRescue } from './death';
import { escortNpc } from './escortNpcs';
import { newWorld } from './world';
import type { WorldState } from './types';

const data = testData();
const base = newWorld(data, 7);

describe('crew', () => {
  it('a new pilot starts with a full complement', () => {
    expect(base.crew).toBe(data.ships[base.shipId].crew);
    expect(crewCap(base, data)).toBe(base.crew);
  });

  it('hiring fills the complement at hireCost each', () => {
    const w: WorldState = { ...base, shipId: 'warden', crew: 5, credits: 10_000 };
    expect(crewHire(w, data)).toEqual({ count: 15, cost: 15 * data.fleet.crew.hireCost });
    const r = hireCrew(w, data);
    if ('error' in r) throw new Error(r.error);
    expect(r.world.crew).toBe(20);
    expect(r.world.credits).toBe(10_000 - r.paid);
  });

  it('hiring is refused when full or short', () => {
    expect(hireCrew(base, data)).toEqual({ error: 'full' });
    expect(hireCrew({ ...base, shipId: 'warden', crew: 5, credits: 10 }, data)).toEqual({ error: 'short' });
  });

  it('a failed capture costs a quarter (rounded up), a success a tenth (rounded down), never below minCrew', () => {
    const w = { ...base, crew: 20 };
    expect(captureCasualties(w, data, false)).toBe(5);
    expect(captureCasualties(w, data, true)).toBe(2);
    expect(captureCasualties({ crew: 2 }, data, false)).toBe(1);
    expect(captureCasualties({ crew: 1 }, data, false)).toBe(0);
    expect(captureCasualties({ crew: 5 }, data, true)).toBe(0);
    expect(crewAfterCapture(w, data, false).world.crew).toBe(15);
    expect(crewLossText(1)).toBe('You lose 1 crew member.');
    expect(crewLossText(3)).toBe('You lose 3 crew.');
    expect(crewLossText(0)).toBe('');
  });

  it('a bought ship comes fully crewed', () => {
    const w: WorldState = { ...base, credits: 1_000_000, crew: 1 };
    const r = buyShip(w, data, 'vanterre', 'kestrel');
    expect(r.quote.check.ok).toBe(true);
    expect(r.world.crew).toBe(data.ships.kestrel.crew);
  });

  it('taking command moves the crew across, capped at her complement', () => {
    const npc = escortNpc({ id: 'x', name: 'Her', shipId: 'kestrel', outfits: {}, armor: 10, fuel: 0, hired: false, wage: 0 }, data, { pos: { x: 0, y: 0 }, heading: 0 });
    expect(takeCommand({ ...base, shipId: 'warden', crew: 18 }, data, npc).crew).toBe(4);
    expect(takeCommand({ ...base, shipId: 'warden', crew: 3 }, data, npc).crew).toBe(3);
  });

  it('the pod rescue wakes the pilot with a full starter crew', () => {
    const r = podRescue({ ...base, shipId: 'warden', crew: 3 }, data);
    expect(r.world.crew).toBe(data.ships[data.config.startShipId].crew);
  });
});
