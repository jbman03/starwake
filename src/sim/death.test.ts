import { describe, expect, it } from 'vitest';
import { testData } from '../data/testData';
import type { GameData, StoryMissionDef } from '../data/schemas';
import { POD_ID, hasPod, podRescue, rescuePort } from './death';
import { STORY_TYPE } from './missions';
import { acceptStory, currentStep } from './storyMissions';
import type { Mission, WorldState } from './types';
import { newWorld } from './world';

const real = testData();
const base = (): WorldState => ({ ...newWorld(real, 1), systemId: 'tessaly', credits: 777, flags: ['f'], notes: [{ day: 1, text: 'n' }], stats: { jobsDone: 3, kills: 2, captures: 1 }, shipName: 'Old', shipId: 'mule' });
const job = (over: Partial<Mission>): Mission => ({
  id: 'j', typeId: 'haul', originId: 'halcyon', destId: 'merrow', tons: 0, passengers: 0, pay: 10, paidUpfront: false,
  deadlineDay: null, title: 'T', description: '', cargoName: '', ...over,
});
const withStory = (def: StoryMissionDef): GameData => ({ ...real, story: { [def.id]: def } });
const ferry: StoryMissionDef = {
  id: 'fy', arc: 'side', title: 'Ferry Job', giver: { name: 'Ansel', title: 'Dockmaster' }, offer: { where: 'bar', ports: ['halcyon'] },
  text: 't', acceptText: 'ok', declinable: true, onComplete: [],
  steps: [{ kind: 'deliver', planet: 'merrow', text: 'Deliver.', cargo: { name: 'Crates', tons: 1 } }],
};

describe('rescuePort', () => {
  it('skips cool governments', () => {
    const w = base();
    expect(rescuePort(w, real)).toBe(real.systems.tessaly ? Object.values(real.planets).filter((p) => p.systemId === 'tessaly').map((p) => p.id).sort()[0] : '');
    const cool = { ...w, standing: { concord: 'cool' as const } };
    const port = rescuePort(cool, real);
    expect(real.systems[real.planets[port].systemId].government).not.toBe('concord');
    expect(port).toBeTruthy();
  });
  it('falls back to the start planet', () => {
    const w = { ...base(), standing: { concord: 'cool' as const, 'free-reach': 'cool' as const, independent: 'cool' as const, unlit: 'cool' as const } };
    expect(rescuePort(w, real)).toBe(real.config.startPlanetId);
  });
});

describe('podRescue', () => {
  it('keeps credits and story, drops ship, cargo and outfits, uses the pod', () => {
    const w: WorldState = { ...base(), outfits: { [POD_ID]: 1, 'cargo-pod': 2 }, cargo: { food: 3 }, ship: { ...base().ship, fuel: 0 } };
    expect(hasPod(w)).toBe(true);
    const r = podRescue(w, real);
    const out = r.world;
    expect(r.messages[0]).toBe(`Your escape pod reaches ${real.planets[r.planetId].name}.`);
    expect(out.credits).toBe(777);
    expect(out.flags).toEqual(['f']);
    expect(out.notes).toEqual(w.notes);
    expect(out.stats).toEqual(w.stats);
    expect(out.shipId).toBe(real.config.startShipId);
    expect(out.outfits).toEqual(real.config.startOutfits);
    expect(hasPod(out)).toBe(false);
    expect(out.cargo).toEqual({});
    expect(out.shipName).toBe('');
    expect(out.ship.fuel).toBeGreaterThan(0);
    expect(out.systemId).toBe(real.planets[r.planetId].systemId);
    expect(out.targetPlanetId).toBe(r.planetId);
    expect(out.ship.vel).toEqual({ x: 0, y: 0 });
    expect(out.route).toEqual([]);
    expect(out.assist).toEqual({ kind: 'none' });
    expect(out.jump).toBeNull();
    expect(out.known).toContain(out.systemId);
  });
  it('cargo and passenger jobs fail; a dump job paid up front also fails', () => {
    const w: WorldState = {
      ...base(),
      missions: [job({ id: 'a', tons: 2, title: 'Haul' }), job({ id: 'b', passengers: 1, title: 'Ride' }), job({ id: 'c', tons: 4, paidUpfront: true, title: 'Dump' }), job({ id: 'd', title: 'Bounty' })],
    };
    const r = podRescue(w, real);
    expect(r.world.missions.map((m) => m.id)).toEqual(['d']);
    expect(r.messages).toEqual(expect.arrayContaining(['Job lost: Haul', 'Job lost: Ride', 'Job lost: Dump']));
    expect(r.messages).not.toContain('Job lost: Bounty');
  });
  it('a story deliver step goes back to its giver', () => {
    const data = withStory(ferry);
    let w = acceptStory({ ...base(), systemId: 'calder' }, data, 'fy');
    expect(currentStep(w, data, 'fy')?.kind).toBe('deliver');
    w = { ...w, missions: [...w.missions, { ...job({ id: `${STORY_TYPE}:fy:0`, typeId: STORY_TYPE, tons: 1 }) }] };
    const r = podRescue(w, data);
    expect(r.world.story.active).toEqual([]);
    expect(r.world.missions.some((m) => m.typeId === STORY_TYPE)).toBe(false);
    expect(r.world.story.declined.some((d) => d.startsWith('fy@'))).toBe(true);
  });
});
