import { describe, expect, it } from 'vitest';
import { testData } from '../data/testData';
import { newWorld } from '../sim/world';
import { hashString } from '../sim/random';
import { CURRENT_SAVE_VERSION, pilotFromWorld, SaveError, upgradeSave, worldFromPilot } from './pilot';

const data = testData();
const start = data.config.startPlanetId;

describe('pilot', () => {
  it('round-trips world -> pilot -> world', () => {
    const w = { ...newWorld(data), credits: 777, timeSec: 123 };
    const p = pilotFromWorld(w, start, { id: 'a', name: 'Ann' });
    expect(p.version).toBe(CURRENT_SAVE_VERSION);
    expect(p.credits).toBe(777);
    const back = worldFromPilot(upgradeSave(JSON.parse(JSON.stringify(p))), data);
    expect(back.credits).toBe(777);
    expect(back.timeSec).toBe(123);
    expect(back.systemId).toBe(w.systemId);
    expect(back.shipId).toBe(w.shipId);
    expect(back.assist).toEqual({ kind: 'none' });
    expect(back.jump).toBeNull();
    expect(back.targetPlanetId).toBeNull();
  });

  it('future version -> futureVersion', () => {
    const p = pilotFromWorld(newWorld(data), start, { id: 'a', name: 'A' });
    expect(() => upgradeSave({ ...p, version: 99 })).toThrowError(expect.objectContaining({ code: 'futureVersion' }));
  });

  it('garbage -> invalid', () => {
    for (const bad of [{}, null, 'x', 5, { version: 1 }]) {
      expect(() => upgradeSave(bad)).toThrowError(expect.objectContaining({ code: 'invalid' }));
    }
    expect(new SaveError('invalid')).toBeInstanceOf(Error);
  });

  it('unknown ids -> invalid in worldFromPilot', () => {
    const p = pilotFromWorld(newWorld(data), start, { id: 'a', name: 'A' });
    expect(() => worldFromPilot({ ...p, shipId: 'nope' }, data)).toThrowError(expect.objectContaining({ code: 'invalid' }));
    expect(() => worldFromPilot({ ...p, planetId: 'nope' }, data)).toThrowError(expect.objectContaining({ code: 'invalid' }));
  });

  it('negative credits (tow debt) are a valid save', () => {
    const p = pilotFromWorld({ ...newWorld(data), credits: -500 }, start, { id: 'a', name: 'A' });
    expect(upgradeSave(JSON.parse(JSON.stringify(p))).credits).toBe(-500);
    expect(worldFromPilot(p, data).credits).toBe(-500);
  });

  it('round-trips the v2 world fields', () => {
    const w = {
      ...newWorld(data, 99), day: 12, cargo: { food: 5 }, route: ['vesk'], pressure: { 'halcyon:food': 0.9 },
      takenOffers: ['x:3:1'], missions: [{
        id: 'm1', typeId: 'delivery', originId: 'halcyon', destId: 'merrow', tons: 2, passengers: 0, pay: 300,
        paidUpfront: false, deadlineDay: 20, title: 'T', description: 'd', cargoName: 'crates',
      }],
    };
    const back = worldFromPilot(upgradeSave(JSON.parse(JSON.stringify(pilotFromWorld(w, start, { id: 'a', name: 'A' })))), data);
    for (const k of ['day', 'seed', 'cargo', 'missions', 'route', 'known', 'pressure', 'events', 'takenOffers'] as const) {
      expect(back[k]).toEqual(w[k]);
    }
    expect(new Set(back.seen)).toEqual(new Set(w.seen));
  });

  it('upgrades a v1 save saved at vesk-outpost (Review Focus 4)', () => {
    const v1 = {
      version: 1, id: 'old-pilot', name: 'Old', credits: 500, shipId: 'shuttle', fuel: 300, systemId: 'vesk',
      planetId: 'vesk-outpost', gameTimeSec: 40, savedAt: '2026-01-01T00:00:00.000Z',
    };
    const p = upgradeSave(JSON.parse(JSON.stringify(v1)));
    expect(p.version).toBe(2);
    expect(p).toMatchObject({ day: 0, seed: hashString('old-pilot'), cargo: {}, missions: [], route: [], known: [], seen: [] });
    const w = worldFromPilot(p, data);
    expect(w.systemId).toBe('vesk');
    expect(w.credits).toBe(500);
    expect(w.known).toContain('vesk');
    for (const id of data.config.knownAtStart) expect(w.known).toContain(id);
    expect(w.seen.length).toBeGreaterThan(0);
    expect(w.seen.filter((id) => w.known.includes(id))).toEqual([]);
    expect(w.seen).toContain('lastlight'); // an unvisited neighbour of vesk
  });

  it('rejects unknown commodities in cargo and unknown ports in missions', () => {
    const p = pilotFromWorld(newWorld(data), start, { id: 'a', name: 'A' });
    expect(() => worldFromPilot({ ...p, cargo: { unobtainium: 1 } }, data)).toThrowError(expect.objectContaining({ code: 'unknownContent' }));
    const m = { id: 'm', typeId: 't', originId: 'halcyon', destId: 'atlantis', tons: 0, passengers: 0, pay: 1, paidUpfront: false, deadlineDay: null, title: '', description: '', cargoName: '' };
    expect(() => worldFromPilot({ ...p, missions: [m] }, data)).toThrowError(expect.objectContaining({ code: 'unknownContent' }));
  });
});
