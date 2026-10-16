import { describe, it, expect } from 'vitest';
import ships from '../../data/ships.json';
import systems from '../../data/systems.json';
import planets from '../../data/planets.json';
import config from '../../data/config.json';
import governments from '../../data/governments.json';
import commodities from '../../data/commodities.json';
import events from '../../data/events.json';
import missionTypes from '../../data/missionTypes.json';
import { parseGameData, DataError, loadGameData } from './load';

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const raw = () =>
  clone({ ships, systems, planets, config, governments, commodities, events, missionTypes }) as {
  ships: any[];
  systems: any[];
  planets: any[];
  config: any;
  governments: any[];
  commodities: any[];
  events: any[];
  missionTypes: any[];
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

  it('asymmetric link fails', () => {
    const r = raw();
    r.systems.push({ ...r.systems[1], id: 'orrin', name: 'Orrin', links: [] });
    r.systems[1].links.push('orrin');
    const e = failure(r);
    expect(e.issues).toContain('systems.json → vesk.links: link to orrin is not mirrored');
  });

  it('disconnected system fails', () => {
    const r = raw();
    r.systems.push({ ...r.systems[1], id: 'island', name: 'Island', links: [] });
    const e = failure(r);
    expect(e.issues).toContain('systems.json → island: unreachable from calder');
  });

  it('unknown government fails', () => {
    const r = raw();
    r.systems[0].government = 'nobody';
    expect(failure(r).issues.some((i) => i.startsWith('systems.json → calder.government'))).toBe(true);
  });

  it('unknown market commodity fails', () => {
    const r = raw();
    r.planets[0].market.spice = 'low';
    expect(failure(r).issues).toContain('planets.json → halcyon.market.spice: unknown commodity');
  });

  it('fuelPrice without refuel service fails', () => {
    const r = raw();
    r.planets[0].services = ['exchange', 'missions'];
    expect(failure(r).issues.some((i) => i.startsWith('planets.json → halcyon.services'))).toBe(true);
  });

  it('refuel service without fuelPrice fails', () => {
    const r = raw();
    r.planets[3].services = ['refuel'];
    expect(failure(r).issues.some((i) => i.startsWith('planets.json → tallow-rock.services'))).toBe(true);
  });

  it('exchange service requires a market and vice versa', () => {
    const r = raw();
    r.planets[3].services = [];
    expect(failure(r).issues.some((i) => i.startsWith('planets.json → tallow-rock.services'))).toBe(true);
  });

  it('commodity origin must be a port selling it low', () => {
    const r = raw();
    r.commodities[0].origin = 'halcyon';
    expect(() => parseGameData(r as any)).not.toThrow();
    r.commodities[0].origin = 'merrow';
    expect(failure(r).issues.some((i) => i.startsWith('commodities.json → food.origin'))).toBe(true);
  });

  it('event with unknown commodity fails', () => {
    const r = raw();
    r.events[0].commodity = 'spice';
    expect(failure(r).issues).toContain('events.json → bumper-harvest.commodity: unknown commodity "spice"');
  });

  it('unknown knownAtStart system fails', () => {
    const r = raw();
    r.config.knownAtStart = ['ghost'];
    expect(failure(r).issues.some((i) => i.startsWith('config.json → knownAtStart'))).toBe(true);
  });

  it('dump-site mission type requires a dumpSite port', () => {
    const r = raw();
    delete r.planets[2].dumpSite;
    expect(failure(r).issues.some((i) => i.startsWith('missionTypes.json → dump.toDumpSite'))).toBe(true);
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
