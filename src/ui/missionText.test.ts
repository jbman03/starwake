import { describe, expect, it } from 'vitest';
import { testData } from '../data/testData';
import { missionSystem } from '../sim/combatMissions';
import type { Mission } from '../sim/types';
import { destinationText, loadText } from './missionText';

const data = testData();
const job = (combat: NonNullable<Mission['combat']>): Mission => ({
  id: 'j', typeId: combat.kind, originId: 'halcyon', destId: 'halcyon', tons: 0, passengers: 0, pay: 5000,
  paidUpfront: false, deadlineDay: null, title: 'T', description: '', cargoName: 'x', combat,
});

describe('combat job text', () => {
  it('shows the target system until the job is done, then the origin port', () => {
    const open = job({ kind: 'clear', systemId: 'vesk', needed: 3, done: 1 });
    expect(destinationText(open, data)).toBe('Vesk system');
    expect(missionSystem(open, data)).toBe('vesk');
    expect(loadText(open)).toBe('Raiders cleared: 1 of 3');
    const done = job({ kind: 'clear', systemId: 'vesk', needed: 3, done: 3 });
    expect(destinationText(done, data)).toBe(`${data.planets.halcyon.name}, ${data.systems[data.planets.halcyon.systemId].name} system`);
    expect(missionSystem(done, data)).toBe(data.planets.halcyon.systemId);
    expect(loadText(done)).toContain('Collect');
  });
  it('names a bounty target', () => {
    expect(loadText(job({ kind: 'bounty', systemId: 'vesk', shipId: 'kestrel', targetName: 'Brass Heron', needed: 1, done: 0 }))).toBe('Target: Brass Heron');
  });
});
