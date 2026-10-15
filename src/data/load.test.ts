import { describe, it, expect } from 'vitest';
import ships from '../../data/ships.json';
import systems from '../../data/systems.json';
import planets from '../../data/planets.json';
import config from '../../data/config.json';
import { parseGameData, DataError, loadGameData } from './load';

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const raw = () => clone({ ships, systems, planets, config }) as {
  ships: any[];
  systems: any[];
  planets: any[];
  config: any;
};

function failure(r: unknown): DataError {
  try {
    parseGameData(r as any);
  } catch (e) {
    expect(e).toBeInstanceOf(DataError);
    return e as DataError;
  }
  throw new Error('expected parseGameData to throw');
}

describe('game data', () => {
  it('shipped data passes validation', () => {
    const d = parseGameData(raw());
    expect(d.ships.shuttle.maxSpeed).toBe(300);
    expect(d.systems.calder.links).toEqual(['vesk']);
    expect(Object.keys(d.planets)).toHaveLength(5);
    expect(d.config.startPlanetId).toBe('halcyon');
  });

  it('loadGameData resolves the shipped data', async () => {
    const d = await loadGameData();
    expect(d.config.startShipId).toBe('shuttle');
  });

  it('planet referencing unknown systemId fails', () => {
    const r = raw();
    r.planets[0].systemId = 'nowhere';
    const e = failure(r);
    expect(e.file).toBe('planets.json');
    expect(e.issues.some((i) => i.startsWith(`planets.json → ${r.planets[0].id}.systemId`))).toBe(true);
  });

  it('link to unknown system fails', () => {
    const r = raw();
    r.systems[0].links = ['ghost'];
    const e = failure(r);
    expect(e.issues.some((i) => i.startsWith('systems.json → calder.links'))).toBe(true);
  });

  it('string maxSpeed fails with a precise message', () => {
    const r = raw();
    r.ships[0].maxSpeed = 'fast';
    const e = failure(r);
    expect(e.file).toBe('ships.json');
    expect(e.issues).toContain('ships.json → shuttle.maxSpeed: expected number');
  });

  it('config start planet must be in start system', () => {
    const r = raw();
    r.config.startPlanetId = 'tallow-rock';
    const e = failure(r);
    expect(e.issues.some((i) => i.startsWith('config.json → startPlanetId'))).toBe(true);
  });
});
