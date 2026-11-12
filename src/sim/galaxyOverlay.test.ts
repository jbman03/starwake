import { describe, expect, it } from 'vitest';
import { testData } from '../data/testData';
import { applyOutcomes } from './encounters';
import { applyGalaxy } from './galaxyOverlay';
import { legalStatus } from './law';
import { newWorld } from './world';

const shipped = testData();
/** The shipped data without its story-opened ports (Freehold Light), so an untouched galaxy is the base itself. */
const data = { ...shipped, planets: Object.fromEntries(Object.entries(shipped.planets).filter(([, p]) => !p.appearsFlag)) };
const empty = { governments: {}, destroyed: [] };
const NPC = { npcName: '' };

describe('applyGalaxy', () => {
  it('returns the base data unchanged with no changes', () => {
    expect(applyGalaxy(data, { galaxy: empty, flags: [] })).toBe(data);
  });
  it('overrides a system government', () => {
    const v = applyGalaxy(data, { galaxy: { governments: { brannock: 'concord' }, destroyed: [] }, flags: [] });
    expect(v.systems.brannock.government).toBe('concord');
    expect(data.systems.brannock.government).toBe('free-reach');
    expect(v.planets).toBe(data.planets);
  });
  it('drops destroyed planets and planets whose appearsFlag is unset, keeping them once the flag is set', () => {
    const withNew = { ...data, planets: { ...data.planets, 'new-port': { ...data.planets.merrow, id: 'new-port', appearsFlag: 'opened' } } };
    const gone = applyGalaxy(withNew, { galaxy: { governments: {}, destroyed: ['merrow'] }, flags: [] });
    expect(gone.planets.merrow).toBeUndefined();
    expect(gone.planets['new-port']).toBeUndefined();
    expect(gone.planets.halcyon).toBeDefined();
    const open = applyGalaxy(withNew, { galaxy: empty, flags: ['opened'] });
    expect(open.planets['new-port']).toBeDefined();
  });
  it('the shipped data hides Freehold Light until navy-freehold is set', () => {
    expect(applyGalaxy(shipped, { galaxy: empty, flags: [] }).planets['freehold-light']).toBeUndefined();
    expect(applyGalaxy(shipped, { galaxy: empty, flags: ['navy-freehold'] })).toBe(shipped);
  });

  it('returns the same object for the same changes', () => {
    const g = { governments: { thistle: 'concord' }, destroyed: [] };
    expect(applyGalaxy(data, { galaxy: g, flags: [] })).toBe(applyGalaxy(data, { galaxy: { governments: { thistle: 'concord' }, destroyed: [] }, flags: ['unrelated'] }));
  });
});

describe('map outcomes', () => {
  const w = () => newWorld(data, 3);
  it('government sets galaxy.governments', () => {
    const r = applyOutcomes(w(), data, [{ type: 'government', system: 'brannock', government: 'concord' }], 't', NPC);
    expect(r.world.galaxy.governments).toEqual({ brannock: 'concord' });
  });
  it('destroyPlanet appends once', () => {
    const o = { type: 'destroyPlanet', planet: 'the-commons' } as const;
    const r = applyOutcomes(w(), data, [o, o], 't', NPC);
    expect(r.world.galaxy.destroyed).toEqual(['the-commons']);
  });
  it('heat 100 makes the pilot hunted', () => {
    const r = applyOutcomes(w(), data, [{ type: 'heat', government: 'concord', n: 100 }], 't', NPC);
    expect(legalStatus(r.world, data, 'concord')).toBe('hunted');
  });
});
