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

const port = (r: ReturnType<typeof raw>, id: string) => r.planets.find((p) => p.id === id);

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
    expect(d.systems.calder.links[0]).toBe('vesk');
    expect(Object.keys(d.systems)).toHaveLength(20);
    expect(d.config.startPlanetId).toBe('halcyon');
  });

  it('keeps the foundation start: calder (concord) jumps first to vesk (independent)', () => {
    const d = parseGameData(raw());
    expect(d.systems.calder.government).toBe('concord');
    expect(d.systems.calder.links[0]).toBe('vesk');
    expect(d.systems.vesk.government).toBe('independent');
    for (const id of ['halcyon', 'merrow', 'brigg-station']) expect(d.planets[id].systemId).toBe('calder');
    for (const id of ['tallow-rock', 'vesk-outpost']) expect(d.planets[id].systemId).toBe('vesk');
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
    const vesk = r.systems.find((s) => s.id === 'vesk');
    r.systems.push({ ...vesk, id: 'orrin', name: 'Orrin', links: [] });
    vesk.links.push('orrin');
    const e = failure(r);
    expect(e.issues).toContain('systems.json → vesk.links: link to orrin is not mirrored');
  });

  it('disconnected system fails', () => {
    const r = raw();
    r.systems.push({ ...r.systems.find((s) => s.id === 'vesk'), id: 'island', name: 'Island', links: [] });
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

  it('every port must have a fuelPrice', () => {
    const r = raw();
    delete port(r, 'tallow-rock').fuelPrice;
    expect(failure(r).issues.some((i) => i.includes('planets.json') && i.includes('tallow-rock'))).toBe(true);
  });

  it('the old refuel service is no longer valid', () => {
    const r = raw();
    port(r, 'tallow-rock').services = ['exchange', 'refuel'];
    expect(failure(r).issues.some((i) => i.includes('tallow-rock'))).toBe(true);
  });

  it('the bundled data gives every port a positive fuelPrice', () => {
    for (const p of Object.values(parseGameData(raw() as any).planets)) expect(p.fuelPrice, p.id).toBeGreaterThan(0);
  });

  it('exchange service requires a market and vice versa', () => {
    const r = raw();
    port(r, 'tallow-rock').services = [];
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

  it('event days must be positive whole numbers', () => {
    for (const days of [[0, 4], [2.5, 4], [3, 4.5], [-1, 2]]) {
      const r = raw();
      r.events[0].days = days;
      expect(failure(r).issues.some((i) => i.startsWith('events.json → bumper-harvest.days')), JSON.stringify(days)).toBe(true);
    }
  });

  it('unknown knownAtStart system fails', () => {
    const r = raw();
    r.config.knownAtStart = ['ghost'];
    expect(failure(r).issues.some((i) => i.startsWith('config.json → knownAtStart'))).toBe(true);
  });

  it('dump-site mission type requires a dumpSite port', () => {
    const r = raw();
    for (const p of r.planets) delete p.dumpSite;
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

describe('galaxy content', () => {
  const d = parseGameData(raw());
  const systemList = Object.values(d.systems);
  const ports = Object.values(d.planets);
  const CLASSIC = ['food', 'industrial', 'medical', 'luxury', 'metal', 'equipment'];
  const govOf = (g: string) => systemList.filter((s) => s.government === g);
  const portsIn = (sysId: string) => ports.filter((p) => p.systemId === sysId);

  /** Hop counts from one system to every reachable system. */
  function hopsFrom(start: string): Map<string, number> {
    const out = new Map([[start, 0]]);
    const queue = [start];
    while (queue.length) {
      const cur = queue.shift()!;
      for (const l of d.systems[cur].links) {
        if (!out.has(l)) {
          out.set(l, out.get(cur)! + 1);
          queue.push(l);
        }
      }
    }
    return out;
  }

  it('has exactly 20 systems: 7 concord, 8 free-reach, 5 independent', () => {
    expect(systemList).toHaveLength(20);
    expect(govOf('concord')).toHaveLength(7);
    expect(govOf('free-reach')).toHaveLength(8);
    expect(govOf('independent')).toHaveLength(5);
  });

  it('every system has 2-4 links and 0-4 ports', () => {
    for (const s of systemList) {
      expect(s.links.length, s.id).toBeGreaterThanOrEqual(2);
      expect(s.links.length, s.id).toBeLessThanOrEqual(4);
      expect(portsIn(s.id).length, s.id).toBeLessThanOrEqual(4);
    }
  });

  it('tech tiers follow the owner: concord 3-5, free-reach 2-4, independent 1-2', () => {
    const range: Record<string, [number, number]> = { concord: [3, 5], 'free-reach': [2, 4], independent: [1, 2] };
    for (const p of ports) {
      const [lo, hi] = range[d.systems[p.systemId].government];
      expect(p.techTier, p.id).toBeGreaterThanOrEqual(lo);
      expect(p.techTier, p.id).toBeLessThanOrEqual(hi);
    }
  });

  it('no two systems sit closer than 60 map units, and all fit within ±600', () => {
    for (const a of systemList) {
      expect(Math.abs(a.mapPos.x), a.id).toBeLessThanOrEqual(600);
      expect(Math.abs(a.mapPos.y), a.id).toBeLessThanOrEqual(600);
      for (const b of systemList) {
        if (a.id >= b.id) continue;
        const gap = Math.hypot(a.mapPos.x - b.mapPos.x, a.mapPos.y - b.mapPos.y);
        expect(gap, `${a.id}-${b.id}`).toBeGreaterThanOrEqual(60);
      }
    }
  });

  it('has at least 30 ports', () => {
    expect(ports.length).toBeGreaterThanOrEqual(30);
  });

  it('every classic good is low somewhere and high somewhere within 3 hops of it', () => {
    for (const g of CLASSIC) {
      const lows = ports.filter((p) => p.market?.[g] === 'low');
      const highs = ports.filter((p) => p.market?.[g] === 'high');
      expect(lows.length, g).toBeGreaterThan(0);
      expect(highs.length, g).toBeGreaterThan(0);
      for (const lo of lows) {
        const hops = hopsFrom(lo.systemId);
        expect(highs.some((h) => hops.get(h.systemId)! <= 3), `${g} from ${lo.id}`).toBe(true);
      }
    }
  });

  it('no golden routes: ports within 2 hops never form a reciprocal low/high pair', () => {
    const lowAt = (p: (typeof ports)[number]) => Object.keys(p.market ?? {}).filter((g) => p.market![g] === 'low');
    const highAt = (p: (typeof ports)[number]) => new Set(Object.keys(p.market ?? {}).filter((g) => p.market![g] === 'high'));
    const carries = (from: (typeof ports)[number], to: (typeof ports)[number]) => {
      const highs = highAt(to);
      return lowAt(from).some((g) => highs.has(g));
    };
    const bad: string[] = [];
    for (const a of ports) {
      const hops = hopsFrom(a.systemId);
      for (const b of ports) {
        if (a.id >= b.id || hops.get(b.systemId)! > 2) continue;
        if (carries(a, b) && carries(b, a)) bad.push(`${a.id}<->${b.id}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('classic basePrice 80-500, unique basePrice 400-900', () => {
    for (const c of Object.values(d.commodities)) {
      const [lo, hi] = c.origin ? [400, 900] : [80, 500];
      expect(c.basePrice, c.id).toBeGreaterThanOrEqual(lo);
      expect(c.basePrice, c.id).toBeLessThanOrEqual(hi);
    }
  });

  it('three unique goods: low only at origin, high at 2-3 ports not next to the origin', () => {
    const uniques = Object.values(d.commodities).filter((c) => c.origin);
    expect(uniques).toHaveLength(3);
    expect(d.commodities.glowmoss?.origin).toBe('tallow-rock');
    expect(d.commodities.copperwine?.origin).toBe('halcyon');
    for (const u of uniques) {
      const originSys = d.planets[u.origin!].systemId;
      const listed = ports.filter((p) => p.market?.[u.id] !== undefined && p.id !== u.origin);
      expect(listed.every((p) => p.market![u.id] === 'high'), u.id).toBe(true);
      expect(listed.length, u.id).toBeGreaterThanOrEqual(2);
      expect(listed.length, u.id).toBeLessThanOrEqual(3);
      const hops = hopsFrom(originSys);
      for (const p of listed) expect(hops.get(p.systemId)!, `${u.id} at ${p.id}`).toBeGreaterThanOrEqual(2);
    }
    const third = uniques.find((u) => u.id !== 'glowmoss' && u.id !== 'copperwine')!;
    expect(d.systems[d.planets[third.origin!].systemId].government).toBe('free-reach');
  });

  it('fringe ports charge more for fuel than core ports', () => {
    expect(d.planets['tallow-rock'].fuelPrice).toBe(5);
    expect(d.planets['little-wren'].fuelPrice).toBe(4);
    expect(d.planets.halcyon.fuelPrice).toBe(2);
  });

  it('at least 2 dump sites', () => {
    expect(ports.filter((p) => p.dumpSite).length).toBeGreaterThanOrEqual(2);
  });

  it('every port description is non-empty and unique', () => {
    const seen = new Set<string>();
    for (const p of ports) {
      expect(p.description.trim().length, p.id).toBeGreaterThan(0);
      expect(seen.has(p.description), p.id).toBe(false);
      seen.add(p.description);
    }
  });

  it('events: 10-14, each classic good has a surplus and a shortage in range', () => {
    const evs = Object.values(d.events);
    expect(evs.length).toBeGreaterThanOrEqual(10);
    expect(evs.length).toBeLessThanOrEqual(14);
    for (const e of evs) {
      const [lo, hi] = e.effect === 'surplus' ? [0.55, 0.7] : [1.5, 1.9];
      expect(e.strength, e.id).toBeGreaterThanOrEqual(lo);
      expect(e.strength, e.id).toBeLessThanOrEqual(hi);
      expect(e.days[0], e.id).toBeGreaterThanOrEqual(3);
      expect(e.days[1], e.id).toBeLessThanOrEqual(8);
    }
    for (const g of CLASSIC) {
      expect(evs.some((e) => e.commodity === g && e.effect === 'surplus'), g).toBe(true);
      expect(evs.some((e) => e.commodity === g && e.effect === 'shortage'), g).toBe(true);
    }
  });

  it('mission types match the spec table', () => {
    const m = d.missionTypes;
    expect(Object.keys(m).sort()).toEqual(['delivery', 'dump', 'ferry', 'rush', 'shipment', 'transport']);
    expect([m.ferry.passengers, m.ferry.hops, m.ferry.deadline]).toEqual([[1, 4], [1, 4], { perHop: 3, plus: 0 }]);
    expect([m.rush.tons, m.rush.hops, m.rush.deadline]).toEqual([[1, 5], [1, 2], { perHop: 1, plus: 1 }]);
    expect([m.transport.tons, m.transport.hops, m.transport.deadline]).toEqual([[8, 15], [2, 4], { perHop: 2, plus: 2 }]);
    expect([m.shipment.tons, m.shipment.hops, m.shipment.deadline]).toEqual([[20, 40], [3, 6], { perHop: 3, plus: 3 }]);
    expect([m.delivery.tons, m.delivery.hops, m.delivery.deadline]).toEqual([[2, 10], [1, 1], { perHop: 0, plus: 4 }]);
    expect([m.dump.tons, m.dump.deadline, m.dump.paidUpfront, m.dump.toDumpSite]).toEqual([[5, 15], null, true, true]);
    for (const t of Object.values(m)) expect(`${t.titleTemplate} ${t.textTemplate}`, t.id).toContain('{dest}');
  });

  it('mission pay lands on the tuning targets', () => {
    const pay = (id: string, hops: number, tons: number, pax: number) => {
      const t = d.missionTypes[id];
      const raw = (t.basePay + t.perHop * hops + t.perTon * tons + t.perPassenger * pax) * t.urgency;
      return Math.round(raw / 10) * 10;
    };
    for (const tons of [2, 10]) {
      expect(pay('delivery', 1, tons, 0)).toBeGreaterThanOrEqual(800);
      expect(pay('delivery', 1, tons, 0)).toBeLessThanOrEqual(1500);
    }
    for (const pax of [1, 4]) {
      expect(pay('ferry', 4, 0, pax)).toBeGreaterThanOrEqual(4000);
      expect(pay('ferry', 4, 0, pax)).toBeLessThanOrEqual(8000);
    }
    for (const [h, t] of [[1, 5], [4, 15]]) {
      expect(pay('dump', h, t, 0)).toBeGreaterThanOrEqual(300);
      expect(pay('dump', h, t, 0)).toBeLessThanOrEqual(800);
    }
    // The cheapest rush ton still beats the dearest ton of any other cargo job.
    const rushMin = pay('rush', 2, 5, 0) / 5;
    const others = [pay('delivery', 1, 2, 0) / 2, pay('transport', 4, 8, 0) / 8, pay('shipment', 6, 20, 0) / 20];
    for (const o of others) expect(rushMin).toBeGreaterThan(o);
  });

  it('every concord system is known at the start', () => {
    expect([...d.config.knownAtStart].sort()).toEqual(govOf('concord').map((s) => s.id).sort());
  });
});
