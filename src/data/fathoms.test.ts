import { describe, expect, it } from 'vitest';
import { hopDistance, lanesOf } from '../sim/galaxy';
import { applyChoice } from '../sim/encounters';
import { newWorld } from '../sim/world';
import { testData } from './testData';

const data = testData();
const FATHOMS = ['sounding', 'brinewell', 'undertow', 'coldharbour', 'rimeshelf', 'fathom', 'driftmark', 'kelpford', 'glimmer', 'gullwing'];

describe('the Fathoms (a southern region)', () => {
  it('is open from the start, with lanes in from Lastlight and Brackwater', () => {
    expect(lanesOf(data, 'lastlight', [])).toContain('sounding');
    expect(lanesOf(data, 'brackwater', [])).toContain('undertow');
    for (const id of FATHOMS) expect(hopDistance(data, data.config.startSystemId, id, []), id).toBeLessThan(Infinity);
  });

  it('is held by the Tideward Guild, whose hub is Tidehall in Fathom', () => {
    expect(data.governments.tideward.name).toBe('Tideward Guild');
    expect(data.factions.tideward.hub).toBe('tidehall');
    expect(data.planets.tidehall).toMatchObject({ systemId: 'fathom', hub: true });
    expect(Object.values(data.systems).filter((s) => s.government === 'tideward')).toHaveLength(7);
  });

  it('keeps Longlamp hidden until the marker buoy opens its lane from Glimmer', () => {
    expect(hopDistance(data, 'glimmer', 'longlamp', [])).toBe(Infinity);
    expect(lanesOf(data, 'glimmer', ['longlamp-lane'])).toContain('longlamp');
    const f5 = data.story['f5-under-the-glimmer'];
    expect(f5.onComplete).toContainEqual({ type: 'flag', flag: 'longlamp-lane' });
  });

  it('runs a six-mission chain from Sounding Line to the Longlamp, ending in a one-off chart', () => {
    const chain = Object.values(data.story).filter((d) => d.chain === 'longlamp');
    expect(chain.map((d) => d.id)).toEqual(['f1-soundings', 'f2-cold-water', 'f3-weavers-passage', 'f4-wreckers-claim', 'f5-under-the-glimmer', 'f6-the-longlamp']);
    expect(chain[0].offer.ports).toEqual(['sounding-line']);
    expect(chain[5].onComplete).toContainEqual({ type: 'flag', flag: 'longlamp-charts-unlocked' });
    expect(data.outfits['longlamp-charts']).toMatchObject({ unique: true, requiresFlag: 'longlamp-charts-unlocked', soldAt: ['tidehall'] });
  });

  it('a Tideward hauler met in the south points the pilot to the Fathoms', () => {
    const w = newWorld(data, 1);
    const r = applyChoice(w, data, data.encounters['tideward-hauler'], 0, { npcName: '' }).world;
    expect(r.known).toEqual(expect.arrayContaining(['sounding', 'brinewell', 'undertow']));
  });
});
