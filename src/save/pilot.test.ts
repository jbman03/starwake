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
    expect(p.version).toBe(CURRENT_SAVE_VERSION);
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
    expect(up.version).toBe(CURRENT_SAVE_VERSION);
    expect(up.outfits).toEqual({ 'light-blaster': 1 }); // the v5 -> v6 step arms a bare shuttle
    expect(up).toEqual({ ...v3, shipName: '' }); // migration writes an empty name = use the hull name
    const w = worldFromPilot(up, data);
    expect(w.outfits).toEqual({ 'light-blaster': 1 });
    expect(w.cargo).toEqual({ food: 3 });
    expect(w.missions).toEqual([mission]);
  });

  it('upgrades a v1 save through to the current version', () => {
    const v1 = {
      version: 1, id: 'old', name: 'Old', credits: 5, shipId: 'shuttle', fuel: 3, systemId: 'vesk',
      planetId: 'vesk-outpost', gameTimeSec: 1, savedAt: '2026-01-01T00:00:00.000Z',
    };
    const p = upgradeSave(v1);
    expect(p.version).toBe(CURRENT_SAVE_VERSION);
    expect(p.outfits).toEqual({ 'light-blaster': 1 });
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

  it('a version-8 save -> futureVersion', () => {
    const p = pilotFromWorld(newWorld(data), start, { id: 'a', name: 'A' });
    expect(() => upgradeSave({ ...p, version: 8 })).toThrowError(expect.objectContaining({ code: 'futureVersion' }));
  });

  it('migration 3 -> 4 fills the story fields; shipName starts empty', () => {
    const v4 = pilotFromWorld(newWorld(data, 5), start, { id: 'a', name: 'A' });
    const { flags: _f, notes: _n, shipName: _s, stats: _st, lastEncounterDay: _l, ...rest } = v4;
    const up = upgradeSave(JSON.parse(JSON.stringify({ ...rest, version: 3 })));
    expect(up).toMatchObject({ version: CURRENT_SAVE_VERSION, flags: [], notes: [], shipName: '', stats: { jobsDone: 0, kills: 0, captures: 0 }, lastEncounterDay: null });
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
    expect(w.stats).toEqual({ jobsDone: 0, kills: 0, captures: 0 });
  });

  it('round-trips the v4 story fields', () => {
    const w = {
      ...newWorld(data, 5), flags: ['met-ship'], notes: [{ day: 3, text: 'hello' }], shipName: 'Wren',
      stats: { jobsDone: 7, kills: 0, captures: 0 }, lastEncounterDay: 4,
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
    expect(up).toMatchObject({ version: CURRENT_SAVE_VERSION, story: emptyStory, standing: {} });
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

describe('save v6', () => {
  const v5Of = (over: Record<string, unknown> = {}) => {
    const v6 = pilotFromWorld(newWorld(data, 5), start, { id: 'a', name: 'A' });
    const { stats, ...rest } = v6;
    return JSON.parse(JSON.stringify({ ...rest, ...over, version: 5, stats: { jobsDone: stats.jobsDone } }));
  };

  it('v5 -> v6 fills kills and captures 0', () => {
    const up = upgradeSave(v5Of());
    expect(up.version).toBe(CURRENT_SAVE_VERSION);
    expect(up.stats).toEqual({ jobsDone: 0, kills: 0, captures: 0 });
  });

  it('v5 shuttle pilot with no weapon gets a light blaster', () => {
    const up = upgradeSave(v5Of({ shipId: 'shuttle', outfits: { 'cargo-pod': 1 } }));
    expect(up.outfits).toEqual({ 'cargo-pod': 1, 'light-blaster': 1 });
    expect(worldFromPilot(up, data).outfits['light-blaster']).toBe(1);
  });

  it('v5 shuttle pilot with any pre-v6 outfit gets the gun when it fits', () => {
    expect(upgradeSave(v5Of({ shipId: 'shuttle', outfits: { 'armor-plate': 1 } })).outfits).toEqual({ 'armor-plate': 1, 'light-blaster': 1 });
    expect(upgradeSave(v5Of({ shipId: 'shuttle', outfits: { 'shield-booster': 1, 'fuel-tank': 1 } })).outfits).toEqual({ 'shield-booster': 1, 'fuel-tank': 1, 'light-blaster': 1 });
    expect(upgradeSave(v5Of({ shipId: 'shuttle', outfits: { 'fuel-scoop': 1, 'surveyors-folio': 1, 'keepers-lens': 1 } })).outfits).toEqual({
      'fuel-scoop': 1, 'surveyors-folio': 1, 'keepers-lens': 1, 'light-blaster': 1,
    });
    // No room: 5 + 4 t leaves 1 t.
    expect(upgradeSave(v5Of({ shipId: 'shuttle', outfits: { 'armor-plate': 1, 'shield-booster': 1 } })).outfits).toEqual({ 'armor-plate': 1, 'shield-booster': 1 });
  });

  it('the migration knows the space of every outfit that existed before v6', () => {
    const pre = ['cargo-pod', 'fuel-tank', 'local-chart', 'armor-plate', 'shield-booster', 'fuel-scoop', 'cargo-bay', 'extended-tank', 'salvage-tank',
      'frontier-rack', 'reinforced-plating', 'heavy-armor', 'shield-array', 'surveyors-folio', 'house-rack', 'cold-hold', 'keepers-lens'];
    for (const id of pre) {
      const space = data.outfits[id].space;
      const gets = space + 3 <= 10;
      expect(upgradeSave(v5Of({ shipId: 'shuttle', outfits: { [id]: 1 } })).outfits['light-blaster'] ?? 0, id).toBe(gets ? 1 : 0);
    }
  });

  it('migration skips the gun when space is full', () => {
    const up = upgradeSave(v5Of({ shipId: 'shuttle', outfits: { 'cargo-pod': 2 } }));
    expect(up.outfits).toEqual({ 'cargo-pod': 2 });
  });

  it('migration skips the gun when an outfit has unknown space, or the ship is not a shuttle', () => {
    expect(upgradeSave(v5Of({ shipId: 'shuttle', outfits: { 'mystery-kit': 1 } })).outfits).toEqual({ 'mystery-kit': 1 });
    expect(upgradeSave(v5Of({ shipId: 'hauler', outfits: {} })).outfits).toEqual({});
  });

  it('migration keeps a weapon the pilot already has', () => {
    const up = upgradeSave(v5Of({ shipId: 'shuttle', outfits: { 'rapid-cannon': 1 } }));
    expect(up.outfits).toEqual({ 'rapid-cannon': 1 });
  });

  it('v1 save loads to the current version', () => {
    const p = upgradeSave({
      version: 1, id: 'old', name: 'Old', credits: 5, shipId: 'shuttle', fuel: 3, systemId: 'vesk',
      planetId: start, gameTimeSec: 0, savedAt: '2026-01-01T00:00:00.000Z',
    });
    expect(p.version).toBe(CURRENT_SAVE_VERSION);
    expect(p.outfits).toEqual({ 'light-blaster': 1 });
    expect(p.stats).toEqual({ jobsDone: 0, kills: 0, captures: 0 });
  });

  it('round-trips Mission.combat and stats', () => {
    const base = newWorld(data, 5);
    const mission = {
      id: 'c1', typeId: 'bounty', originId: start, destId: start, tons: 0, passengers: 0, pay: 100, paidUpfront: false,
      deadlineDay: null, title: 'Bounty', description: 'd', cargoName: '',
      combat: { kind: 'bounty' as const, systemId: 'vesk', shipId: 'kestrel', targetName: 'Rook', needed: 1, done: 0 },
    };
    const clear = { ...mission, id: 'c2', combat: { kind: 'clear' as const, systemId: 'vesk', needed: 3, done: 1 } };
    const w = { ...base, missions: [mission, clear], stats: { jobsDone: 1, kills: 4, captures: 2 } };
    const back = worldFromPilot(upgradeSave(JSON.parse(JSON.stringify(pilotFromWorld(w, start, { id: 'a', name: 'A' })))), data);
    expect(back.missions).toEqual([mission, clear]);
    expect(back.stats).toEqual({ jobsDone: 1, kills: 4, captures: 2 });
  });

  it('a combat job naming an unknown ship or system is dropped, and the save still loads', () => {
    const base = newWorld(data, 5);
    const job = {
      id: 'ok', typeId: 'bounty', originId: start, destId: start, tons: 0, passengers: 0, pay: 100, paidUpfront: false,
      deadlineDay: null, title: 'Bounty', description: 'd', cargoName: '',
      combat: { kind: 'bounty' as const, systemId: 'vesk', shipId: 'kestrel', targetName: 'Rook', needed: 1, done: 0 },
    };
    const badShip = { ...job, id: 'bad-ship', combat: { ...job.combat, shipId: 'no-such-hull' } };
    const badSystem = { ...job, id: 'bad-system', combat: { kind: 'clear' as const, systemId: 'no-such-system', needed: 3, done: 0 } };
    const { shipId: _gone, ...noShip } = job.combat;
    const bountyNoShip = { ...job, id: 'no-ship', combat: noShip };
    const plain = { ...job, id: 'plain', combat: undefined };
    delete (plain as { combat?: unknown }).combat;
    const w = { ...base, missions: [job, badShip, badSystem, bountyNoShip, plain] };
    const back = worldFromPilot(upgradeSave(JSON.parse(JSON.stringify(pilotFromWorld(w, start, { id: 'a', name: 'A' })))), data);
    expect(back.missions.map((m) => m.id)).toEqual(['ok', 'plain']);
  });
});

describe('save v7', () => {
  const v6Of = () => {
    const { law: _l, ranks: _r, ...rest } = pilotFromWorld(newWorld(data, 5), start, { id: 'a', name: 'A' });
    return JSON.parse(JSON.stringify({ ...rest, version: 6 }));
  };

  it('a v6 save migrates to v7 with empty law and ranks', () => {
    const up = upgradeSave(v6Of());
    expect(up).toMatchObject({ version: 7, law: {}, ranks: {} });
    const w = worldFromPilot(up, data);
    expect(w.law).toEqual({});
    expect(w.ranks).toEqual({});
  });

  it('a v1 save still migrates all the way', () => {
    const p = upgradeSave({
      version: 1, id: 'old', name: 'Old', credits: 5, shipId: 'shuttle', fuel: 3, systemId: 'vesk',
      planetId: start, gameTimeSec: 0, savedAt: '2026-01-01T00:00:00.000Z',
    });
    expect(p).toMatchObject({ version: 7, law: {}, ranks: {} });
  });

  it('corrupt heat clamps to 0–100 and negative points to 0 on load', () => {
    const raw = { ...v6Of(), version: 7, law: { concord: { heat: 250 }, 'free-reach': { heat: -4 } }, ranks: { concord: { points: -9, salaryDay: 3 } } };
    for (const w of [worldFromPilot(upgradeSave(raw), data), worldFromPilot(raw, data)]) {
      expect(w.law).toEqual({ concord: { heat: 100 }, 'free-reach': { heat: 0 } });
      expect(w.ranks).toEqual({ concord: { points: 0, salaryDay: 3 } });
    }
  });

  it('non-numeric, null, NaN and 1e999 heat and points still load and clamp', () => {
    const raw = JSON.parse(
      '{"law":{"a":{"heat":"hot"},"b":{"heat":null},"c":{"heat":1e999},"d":{"heat":-1e999},"e":7,"f":null,"g":[1]},' +
        '"ranks":{"a":{"points":"x","salaryDay":"y"},"b":{"points":null,"salaryDay":null},"c":{"points":1e999,"salaryDay":-5},"d":"no"}}',
    );
    const nan = { ...v6Of(), version: 7, law: { n: { heat: NaN } }, ranks: { n: { points: NaN, salaryDay: Infinity } } };
    const up = upgradeSave({ ...v6Of(), version: 7, ...raw });
    expect(up.law).toEqual({ a: { heat: 0 }, b: { heat: 0 }, c: { heat: 0 }, d: { heat: 0 } });
    expect(up.ranks).toEqual({ a: { points: 0, salaryDay: 0 }, b: { points: 0, salaryDay: 0 }, c: { points: 0, salaryDay: -1 } });
    const w = worldFromPilot(upgradeSave(nan), data);
    expect(w.law).toEqual({ n: { heat: 0 } });
    expect(w.ranks).toEqual({ n: { points: 0, salaryDay: 0 } });
  });

  it('upgradeSave itself clamps heat, points and salaryDay', () => {
    const up = upgradeSave({ ...v6Of(), version: 7, law: { a: { heat: 250 } }, ranks: { a: { points: -3, salaryDay: -2 } } });
    expect(up.law).toEqual({ a: { heat: 100 } });
    expect(up.ranks).toEqual({ a: { points: 0, salaryDay: -1 } });
  });

  it('salaryDay keeps the -1 "never paid" sentinel and clamps anything lower to it', () => {
    const up = upgradeSave({ ...v6Of(), version: 7, ranks: { a: { points: 1, salaryDay: -1 }, b: { points: 1, salaryDay: -40 }, c: { points: 1, salaryDay: 6 } } });
    expect(up.ranks).toEqual({ a: { points: 1, salaryDay: -1 }, b: { points: 1, salaryDay: -1 }, c: { points: 1, salaryDay: 6 } });
  });

  it('a v7 save whose law or ranks is missing, null or an array still loads as empty', () => {
    for (const bad of [undefined, null, [], [1, 2], 'x', 7]) {
      const up = upgradeSave({ ...v6Of(), version: 7, law: bad, ranks: bad });
      expect(up).toMatchObject({ version: 7, law: {}, ranks: {} });
    }
    const { law: _l, ranks: _r, ...rest } = { ...v6Of(), version: 7, law: 1, ranks: 1 };
    expect(upgradeSave(rest)).toMatchObject({ law: {}, ranks: {} });
  });

  it('law and ranks round-trip', () => {
    const w = { ...newWorld(data, 5), law: { concord: { heat: 40 } }, ranks: { concord: { points: 12, salaryDay: 9 } } };
    const back = worldFromPilot(upgradeSave(JSON.parse(JSON.stringify(pilotFromWorld(w, start, { id: 'a', name: 'A' })))), data);
    expect(back.law).toEqual(w.law);
    expect(back.ranks).toEqual(w.ranks);
  });
});
