import { describe, expect, it } from 'vitest';
import { testData } from '../data/testData';
import { newWorld } from '../sim/world';
import { revealOnArrival } from '../sim/galaxy';
import { hashString } from '../sim/random';
import { shipDisplayName } from '../sim/shipyard';
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
    const base = newWorld(data, 99);
    // Chart with an extra visited system (vesk) and the matching seen list.
    const chart = revealOnArrival(base.known, base.seen, data, 'vesk', []);
    const w = {
      ...base, day: 12, cargo: { food: 5 }, route: ['mirren'], pressure: { 'halcyon:food': 0.9 },
      known: chart.known, seen: chart.seen,
      events: [{ templateId: Object.keys(data.events)[0], portId: 'halcyon', commodityId: 'food', startDay: 10, days: 5, strength: 1.6 }],
      takenOffers: ['x:3:1'], missions: [{
        id: 'm1', typeId: 'delivery', originId: 'halcyon', destId: 'merrow', tons: 2, passengers: 0, pay: 300,
        paidUpfront: false, deadlineDay: 20, title: 'T', description: 'd', cargoName: 'crates',
      }],
    };
    expect(w.known).toContain('vesk');
    const back = worldFromPilot(upgradeSave(JSON.parse(JSON.stringify(pilotFromWorld(w, start, { id: 'a', name: 'A' })))), data);
    for (const k of ['day', 'seed', 'cargo', 'missions', 'route', 'known', 'seen', 'pressure', 'events', 'takenOffers'] as const) {
      expect(back[k]).toEqual(w[k]);
    }
  });

  it('upgrades a v1 save saved at vesk-outpost (Review Focus 4)', () => {
    const v1 = {
      version: 1, id: 'old-pilot', name: 'Old', credits: 500, shipId: 'shuttle', fuel: 300, systemId: 'vesk',
      planetId: 'vesk-outpost', gameTimeSec: 40, savedAt: '2026-01-01T00:00:00.000Z',
    };
    const p = upgradeSave(JSON.parse(JSON.stringify(v1)));
    expect(p.version).toBe(5);
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

  it('upgrades a v2 save with cargo and a mission to v3 with no outfits, round trip unchanged', () => {
    const mission = {
      id: 'm1', typeId: 'delivery', originId: 'halcyon', destId: 'merrow', tons: 2, passengers: 0, pay: 300,
      paidUpfront: false, deadlineDay: 20, title: 'T', description: 'd', cargoName: 'crates',
    };
    const v3 = pilotFromWorld({ ...newWorld(data, 5), cargo: { food: 3 }, missions: [mission] }, start, { id: 'a', name: 'A' });
    const { outfits: _o, ...rest } = v3;
    const v2 = { ...rest, version: 2 };
    const up = upgradeSave(JSON.parse(JSON.stringify(v2)));
    expect(up.version).toBe(5);
    expect(up.outfits).toEqual({});
    expect(up).toEqual({ ...v3, shipName: '' }); // migration writes an empty name = use the hull name
    const w = worldFromPilot(up, data);
    expect(w.outfits).toEqual({});
    expect(w.cargo).toEqual({ food: 3 });
    expect(w.missions).toEqual([mission]);
  });

  it('upgrades a v1 save through to v5', () => {
    const v1 = {
      version: 1, id: 'old', name: 'Old', credits: 5, shipId: 'shuttle', fuel: 3, systemId: 'vesk',
      planetId: 'vesk-outpost', gameTimeSec: 1, savedAt: '2026-01-01T00:00:00.000Z',
    };
    const p = upgradeSave(v1);
    expect(p.version).toBe(5);
    expect(p.outfits).toEqual({});
  });

  it('round-trips owned outfits', () => {
    const w = { ...newWorld(data, 5), outfits: { 'cargo-pod': 2 } };
    const back = worldFromPilot(upgradeSave(JSON.parse(JSON.stringify(pilotFromWorld(w, start, { id: 'a', name: 'A' })))), data);
    expect(back.outfits).toEqual({ 'cargo-pod': 2 });
  });

  it('drops map-category outfits so a crafted save cannot hold charts', () => {
    const p = pilotFromWorld(newWorld(data), start, { id: 'a', name: 'A' });
    const back = worldFromPilot({ ...p, outfits: { 'local-chart': 1, 'cargo-pod': 1 } }, data);
    expect(back.outfits).toEqual({ 'cargo-pod': 1 });
  });

  it('an unknown outfit id -> unknownContent', () => {
    const p = pilotFromWorld(newWorld(data), start, { id: 'a', name: 'A' });
    expect(() => worldFromPilot({ ...p, outfits: { 'no-such-outfit': 1 } }, data)).toThrowError(
      expect.objectContaining({ code: 'unknownContent', message: 'unknown outfit "no-such-outfit"' }),
    );
  });

  it('a version-6 save -> futureVersion', () => {
    const p = pilotFromWorld(newWorld(data), start, { id: 'a', name: 'A' });
    expect(() => upgradeSave({ ...p, version: 6 })).toThrowError(expect.objectContaining({ code: 'futureVersion' }));
  });

  it('migration 3 -> 4 fills the story fields; shipName starts empty', () => {
    const v4 = pilotFromWorld(newWorld(data, 5), start, { id: 'a', name: 'A' });
    const { flags: _f, notes: _n, shipName: _s, stats: _st, lastEncounterDay: _l, ...rest } = v4;
    const up = upgradeSave(JSON.parse(JSON.stringify({ ...rest, version: 3 })));
    expect(up).toMatchObject({ version: 5, flags: [], notes: [], shipName: '', stats: { jobsDone: 0 }, lastEncounterDay: null });
    // The loader keeps '' as is; shipDisplayName resolves it to the hull's name.
    const w = worldFromPilot(up, data);
    expect(w.shipName).toBe('');
    expect(shipDisplayName(w.shipName, w.shipId, data)).toBe(data.ships[v4.shipId].name);
  });

  it('a v3 save with missions and outfits round-trips through v4', () => {
    const mission = {
      id: 'm1', typeId: 'delivery', originId: 'halcyon', destId: 'merrow', tons: 2, passengers: 0, pay: 300,
      paidUpfront: false, deadlineDay: 20, title: 'T', description: 'd', cargoName: 'crates',
    };
    const v4 = pilotFromWorld({ ...newWorld(data, 5), missions: [mission], outfits: { 'cargo-pod': 2 } }, start, { id: 'a', name: 'A' });
    const { flags: _f, notes: _n, shipName: _s, stats: _st, lastEncounterDay: _l, ...rest } = v4;
    const up = upgradeSave(JSON.parse(JSON.stringify({ ...rest, version: 3 })));
    const w = worldFromPilot(up, data);
    expect(w.missions).toEqual([mission]);
    expect(w.outfits).toEqual({ 'cargo-pod': 2 });
    expect(w.flags).toEqual([]);
    expect(w.stats).toEqual({ jobsDone: 0 });
  });

  it('round-trips the v4 story fields', () => {
    const w = {
      ...newWorld(data, 5), flags: ['met-ship'], notes: [{ day: 3, text: 'hello' }], shipName: 'Wren',
      stats: { jobsDone: 7 }, lastEncounterDay: 4,
    };
    const back = worldFromPilot(upgradeSave(JSON.parse(JSON.stringify(pilotFromWorld(w, start, { id: 'a', name: 'A' })))), data);
    for (const k of ['flags', 'notes', 'shipName', 'stats', 'lastEncounterDay'] as const) expect(back[k]).toEqual(w[k]);
  });
});

describe('save v5', () => {
  const emptyStory = { active: [], done: [], failed: [], declined: [] };

  it('migration 4 -> 5 fills empty story state and neutral standing', () => {
    const v5 = pilotFromWorld(newWorld(data, 5), start, { id: 'a', name: 'A' });
    const { story: _s, standing: _st, ...rest } = v5;
    const up = upgradeSave(JSON.parse(JSON.stringify({ ...rest, version: 4 })));
    expect(up).toMatchObject({ version: 5, story: emptyStory, standing: {} });
    const w = worldFromPilot(up, data);
    expect(w.story).toEqual(emptyStory);
    expect(w.standing).toEqual({});
  });

  it('a v4 save mid-survey-thread keeps flags through v5', () => {
    const flags = ['survey-rumour', 'enc:survey-beacon', 'hushwater-lane'];
    const notes = [{ day: 3, text: 'A beacon, faint.' }];
    const v5 = pilotFromWorld({ ...newWorld(data, 5), flags, notes, lastEncounterDay: 4 }, start, { id: 'a', name: 'A' });
    const { story: _s, standing: _st, ...rest } = v5;
    const w = worldFromPilot(upgradeSave(JSON.parse(JSON.stringify({ ...rest, version: 4 }))), data);
    expect(w.flags).toEqual(flags);
    expect(w.notes).toEqual(notes);
    expect(w.lastEncounterDay).toBe(4);
    expect(w.story).toEqual(emptyStory);
  });

  it('round-trips story state and standing', () => {
    const w = {
      ...newWorld(data, 5),
      story: { active: [{ id: 'm1', step: 2, deadlineDay: 40 }, { id: 'm2', step: 0, deadlineDay: null }], done: ['a'], doneDays: { a: 31 }, failed: ['b'], declined: ['c'] },
      standing: { concord: 'friend', 'free-reach': 'cool' } as const,
    };
    const back = worldFromPilot(upgradeSave(JSON.parse(JSON.stringify(pilotFromWorld(w, start, { id: 'a', name: 'A' })))), data);
    expect(back.story).toEqual(w.story);
    expect(back.standing).toEqual(w.standing);
  });

  it('rejects a save with a bad standing level', () => {
    const p = pilotFromWorld(newWorld(data), start, { id: 'a', name: 'A' });
    expect(() => upgradeSave({ ...p, standing: { concord: 'adored' } })).toThrowError(expect.objectContaining({ code: 'invalid' }));
  });
});
