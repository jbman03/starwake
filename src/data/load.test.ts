import { describe, it, expect } from 'vitest';
import ships from '../../data/ships.json';
import systems from '../../data/systems.json';
import planets from '../../data/planets.json';
import config from '../../data/config.json';
import governments from '../../data/governments.json';
import commodities from '../../data/commodities.json';
import events from '../../data/events.json';
import missionTypes from '../../data/missionTypes.json';
import outfits from '../../data/outfits.json';
import names from '../../data/names.json';
import encounters from '../../data/encounters.json';
import story from '../../data/story.json';
import combat from '../../data/combat.json';
import audio from '../../data/audio.json';
import law from '../../data/law.json';
import factions from '../../data/factions.json';
import { parseGameData, DataError, loadGameData } from './load';
import { SFX_IDS } from './schemas';
import { sells } from '../sim/stock';
import { MOOD_IDS } from '../audio/moods';

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const raw = () =>
  clone({ ships, systems, planets, config, governments, commodities, events, missionTypes, outfits, names, encounters, story, combat, audio, law, factions }) as {
  ships: any[];
  systems: any[];
  planets: any[];
  config: any;
  governments: any[];
  commodities: any[];
  events: any[];
  missionTypes: any[];
  outfits: any[];
  names: { first: string[]; second: string[] };
  encounters: any[];
  story: { missions: any[] };
  combat: any;
  audio: any;
  law: any;
  factions: any;
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
    expect(Object.keys(d.systems)).toHaveLength(30);
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

  it('has 30 systems: 7 concord, 8 free-reach, 6 independent (incl. hidden Hushwater), 9 unlit (the Dimming)', () => {
    expect(systemList).toHaveLength(30);
    expect(govOf('unlit')).toHaveLength(9);
    expect(govOf('concord')).toHaveLength(7);
    expect(govOf('free-reach')).toHaveLength(8);
    expect(govOf('independent')).toHaveLength(6);
  });

  it('every system has 2-4 links and 0-4 ports', () => {
    for (const s of systemList.filter((x) => !x.hidden)) {
      expect(s.links.length, s.id).toBeGreaterThanOrEqual(2);
      expect(s.links.length, s.id).toBeLessThanOrEqual(4);
      expect(portsIn(s.id).length, s.id).toBeLessThanOrEqual(4);
    }
  });

  it('tech tiers follow the owner: concord 3-5, free-reach 2-4, independent 1-2, unlit 1-3', () => {
    const range: Record<string, [number, number]> = { concord: [3, 5], 'free-reach': [2, 4], independent: [1, 2], unlit: [1, 3] };
    for (const p of ports) {
      const [lo, hi] = range[d.systems[p.systemId].government];
      expect(p.techTier, p.id).toBeGreaterThanOrEqual(lo);
      expect(p.techTier, p.id).toBeLessThanOrEqual(hi);
    }
  });

  it('no two systems sit closer than 60 map units; charted ones fit within ±600 and the Dimming sits at x 650-950', () => {
    for (const a of systemList) {
      if (a.government === 'unlit') {
        expect(a.mapPos.x, a.id).toBeGreaterThanOrEqual(650);
        expect(a.mapPos.x, a.id).toBeLessThanOrEqual(950);
      } else {
        expect(Math.abs(a.mapPos.x), a.id).toBeLessThanOrEqual(600);
      }
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

  it('classic basePrice 80-500, unique and contraband basePrice 400-900', () => {
    for (const c of Object.values(d.commodities)) {
      const [lo, hi] = c.origin || ['stims', 'relics', 'gunparts'].includes(c.id) ? [400, 900] : [80, 500];
      expect(c.basePrice, c.id).toBeGreaterThanOrEqual(lo);
      expect(c.basePrice, c.id).toBeLessThanOrEqual(hi);
    }
  });

  it('three unique goods: low only at origin, high at 2-3 ports not next to the origin', () => {
    // Stillwater Pearl is Hushwater's own good (no lanes in, so no hop rules); it is covered separately.
    const uniques = Object.values(d.commodities).filter(
      (c) => c.origin && !d.systems[d.planets[c.origin].systemId].hidden,
    );
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

  it('Dimglass: base 700, low only at Cullet Yard, high at 2-3 Concord worlds', () => {
    expect(d.commodities.dimglass.basePrice).toBe(700);
    expect(d.commodities.dimglass.origin).toBe('cullet-yard');
    const buyers = ports.filter((p) => p.id !== 'cullet-yard' && p.market?.dimglass !== undefined);
    expect(buyers.length).toBeGreaterThanOrEqual(2);
    expect(buyers.length).toBeLessThanOrEqual(3);
    for (const p of buyers) {
      expect(p.market!.dimglass, p.id).toBe('high');
      expect(d.systems[p.systemId].government, p.id).toBe('concord');
    }
  });

  it("the Dimming: 9 hidden systems on dimming-lane, 5 ports with the bar, Reed's Anchor a tier-3 hub", () => {
    const dim = systemList.filter((s) => s.government === 'unlit');
    for (const s of dim) {
      expect(s.hidden, s.id).toBe(true);
      expect(s.unlockFlag, s.id).toBe('dimming-lane');
    }
    expect(d.systems.hushwater.unlockFlag).toBe('hushwater-lane');
    expect(d.systems.gloam.hiddenLinks).toEqual(['oxbow']);
    expect(d.systems.oxbow.hiddenLinks).toEqual(['gloam']);
    const dimPorts = ports.filter((p) => d.systems[p.systemId].government === 'unlit');
    expect(dimPorts).toHaveLength(5);
    for (const p of dimPorts) expect(p.services, p.id).toContain('bar');
    const anchor = d.planets['reeds-anchor'];
    expect(anchor).toMatchObject({ name: "Reed's Anchor", techTier: 3, kind: 'station', hub: true });
    expect(anchor.services).toEqual(expect.arrayContaining(['shipyard', 'outfitter']));
    expect(d.governments.unlit.name).toBe('Unlit Holdings');
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
    expect(Object.keys(m).sort()).toEqual(['bounty', 'clear', 'delivery', 'dump', 'ferry', 'rush', 'shipment', 'transport']);
    expect([m.ferry.passengers, m.ferry.hops, m.ferry.deadline]).toEqual([[1, 4], [1, 4], { perHop: 3, plus: 0 }]);
    expect([m.rush.tons, m.rush.hops, m.rush.deadline]).toEqual([[1, 5], [1, 2], { perHop: 1, plus: 1 }]);
    expect([m.transport.tons, m.transport.hops, m.transport.deadline]).toEqual([[8, 15], [2, 4], { perHop: 2, plus: 2 }]);
    expect([m.shipment.tons, m.shipment.hops, m.shipment.deadline]).toEqual([[20, 40], [3, 6], { perHop: 3, plus: 3 }]);
    expect([m.delivery.tons, m.delivery.hops, m.delivery.deadline]).toEqual([[2, 10], [1, 1], { perHop: 0, plus: 4 }]);
    expect([m.dump.tons, m.dump.deadline, m.dump.paidUpfront, m.dump.toDumpSite]).toEqual([[5, 15], null, true, true]);
    for (const t of Object.values(m).filter((x) => !x.combat)) expect(`${t.titleTemplate} ${t.textTemplate}`, t.id).toContain('{dest}');
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

describe('ship and outfit cross-checks', () => {
  const has = (e: DataError, s: string) => expect(e.issues.some((i) => i.includes(s)), e.issues.join(', ')).toBe(true);
  const ship = (r: ReturnType<typeof raw>, id: string) => r.ships.find((s) => s.id === id);
  const outfit = (r: ReturnType<typeof raw>, id: string) => r.outfits.find((s) => s.id === id);

  it('soldBy must name known governments', () => {
    const r = raw();
    ship(r, 'kestrel').soldBy = ['nobody'];
    has(failure(r), 'unknown government "nobody"');
    const r2 = raw();
    outfit(r2, 'heavy-armor').soldBy = ['nobody'];
    has(failure(r2), 'unknown government "nobody"');
  });

  it('outfit effect must match its category', () => {
    const r = raw();
    outfit(r, 'cargo-pod').effect = { fuel: 5 };
    expect(failure(r).file).toBe('outfits.json');
  });

  it('every hub needs both shops', () => {
    const r = raw();
    port(r, 'vanterre').services = port(r, 'vanterre').services.filter((s: string) => s !== 'shipyard');
    has(failure(r), 'hub must have both shipyard and outfitter');
  });

  it('every government needs a hub', () => {
    const r = raw();
    port(r, 'lastlight-beacon').hub = false;
    has(failure(r), 'government "independent" has no hub');
  });

  it('two hubs of one government must be at least 2 jumps apart', () => {
    const r = raw();
    // wrenhold and dunmore are free-reach hubs; make a hub in a system next to wrenhold's.
    const wren = r.systems.find((s) => s.id === 'wrenhold');
    const neighbour = r.planets.find((p) => p.systemId === wren.links.find((l: string) => r.systems.find((s) => s.id === l).government === 'free-reach') && p.techTier >= 3);
    neighbour.hub = true;
    neighbour.services = [...new Set([...neighbour.services, 'shipyard', 'outfitter'])];
    has(failure(r), 'jump apart');
  });

  it('an item with soldBy must be sold at a hub of each listed government', () => {
    const r = raw();
    outfit(r, 'heavy-armor').techTier = 5;
    for (const id of ['vanterre', 'corvana-works']) port(r, id).techTier = 4;
    has(failure(r), 'heavy-armor');
  });

  it('every ship and outfit must be sold somewhere', () => {
    const r = raw();
    ship(r, 'bastion').techTier = 5;
    for (const p of r.planets) if (p.techTier === 5) p.techTier = 4;
    has(failure(r), 'bastion');
    const r2 = raw();
    outfit(r2, 'fuel-scoop').soldBy = ['independent'];
    has(failure(r2), 'fuel-scoop');
  });

  it('the start ship must be the cheapest', () => {
    const r = raw();
    ship(r, 'courier').price = 5000;
    has(failure(r), 'startShipId');
  });
});

describe('living-galaxy data', () => {
  const enc = (r: ReturnType<typeof raw>, id: string) => r.encounters.find((e) => e.id === id);

  it('names.json has at least 20 entries in each list', () => {
    const d = parseGameData(raw());
    expect(d.names.first.length).toBeGreaterThanOrEqual(20);
    expect(d.names.second.length).toBeGreaterThanOrEqual(20);
  });

  it('ships a rich encounter set keyed by id', () => {
    const d = parseGameData(raw());
    expect(Object.keys(d.encounters).length).toBeGreaterThanOrEqual(15);
    expect(d.encounters['survey-beacon'].kind).toBe('hail');
    expect(d.encounters['survey-beacon'].when).toMatchObject({
      systems: ['skerry'],
      requiresFlag: 'survey-rumour',
      notFlag: 'hushwater-lane',
    });
    expect(d.encounters['survey-beacon'].once).toBe(true);
    expect(d.encounters['long-patience'].kind).toBe('site');
    expect(d.encounters['long-patience'].when?.systems).toEqual(['hushwater']);
  });

  it('rejects an encounter with 0 choices', () => {
    const r = raw();
    enc(r, 'cargo-drift').choices = [];
    expect(failure(r).issues.some((i) => i.startsWith('encounters.json → cargo-drift.choices'))).toBe(true);
  });

  it('rejects an encounter with 4 choices', () => {
    const r = raw();
    const e = enc(r, 'cargo-drift');
    e.choices = [e.choices[0], e.choices[0], e.choices[0], e.choices[0]];
    expect(failure(r).issues.some((i) => i.startsWith('encounters.json → cargo-drift.choices'))).toBe(true);
  });

  it('rejects an unknown outcome type', () => {
    const r = raw();
    enc(r, 'cargo-drift').choices[0].outcomes = [{ type: 'teleport', n: 1 }];
    expect(failure(r).issues.some((i) => i.startsWith('encounters.json → cargo-drift.choices.0.outcomes'))).toBe(true);
  });

  it('rejects a hiddenLinks target that is not a system', () => {
    const r = raw();
    r.systems.find((s) => s.id === 'skerry').hiddenLinks = ['ghost'];
    expect(failure(r).issues.some((i) => i.startsWith('systems.json → skerry.hiddenLinks'))).toBe(true);
  });

  it('keeps hidden lanes two-way and the hidden system reachable through them', () => {
    const d = parseGameData(raw());
    expect(d.systems.hushwater.hidden).toBe(true);
    expect(d.systems.hushwater.links).toEqual([]);
    expect(d.systems.skerry.hiddenLinks).toEqual(['hushwater']);
    expect(d.systems.skerry.links).not.toContain('hushwater');
    const r = raw();
    r.systems.find((s) => s.id === 'hushwater').hiddenLinks = [];
    expect(failure(r).issues).toContain('systems.json → skerry.hiddenLinks: link to hushwater is not mirrored');
  });

  it('requires an unlockFlag on every hidden system', () => {
    const r = raw();
    delete r.systems.find((s) => s.id === 'gloam').unlockFlag;
    expect(failure(r).issues).toContain('systems.json → gloam.unlockFlag: a hidden system needs an unlockFlag');
  });

  it('every encounter references known goods, systems, governments and mission types', () => {
    const d = parseGameData(raw());
    for (const e of Object.values(d.encounters)) {
      for (const s of e.when?.systems ?? []) expect(d.systems[s], `${e.id} system ${s}`).toBeDefined();
      for (const g of e.when?.governments ?? []) expect(d.governments[g], `${e.id} gov ${g}`).toBeDefined();
      for (const c of e.choices)
        for (const o of c.outcomes) {
          if (o.type === 'cargo') expect(d.commodities[o.good], `${e.id} good`).toBeDefined();
          if (o.type === 'mission') {
            expect(d.missionTypes[o.missionType], `${e.id} mission`).toBeDefined();
            if (o.toSystem) expect(d.systems[o.toSystem]).toBeDefined();
          }
          if (o.type === 'reveal') for (const s of o.systems ?? []) expect(d.systems[s]).toBeDefined();
        }
    }
  });

  it('rejects an encounter outcome naming an unknown good, system or mission type', () => {
    const r = raw();
    enc(r, 'cargo-drift').choices[0].outcomes = [{ type: 'cargo', good: 'spice', tons: 3 }];
    expect(failure(r).issues).toContain('encounters.json → cargo-drift.choices.0.outcomes.0: unknown commodity "spice"');
    const r2 = raw();
    enc(r2, 'cargo-drift').choices[0].outcomes = [{ type: 'mission', missionType: 'heist' }];
    expect(failure(r2).issues.some((i) => i.includes('unknown mission type "heist"'))).toBe(true);
    const r3 = raw();
    enc(r3, 'cargo-drift').when = { systems: ['nowhere'] };
    expect(failure(r3).issues.some((i) => i.includes('unknown system "nowhere"'))).toBe(true);
  });

  it('has the Hushwater world, the Stillwater Pearl and the Patience surveyor', () => {
    const d = parseGameData(raw());
    expect(d.planets['quiet-shoal'].systemId).toBe('hushwater');
    expect(d.planets['quiet-shoal'].services).toContain('exchange');
    expect(d.planets['quiet-shoal'].fuelPrice).toBeGreaterThan(0);
    expect(d.commodities['stillwater-pearl']).toMatchObject({ basePrice: 900, origin: 'quiet-shoal' });
    expect(d.ships.patience).toMatchObject({
      price: 60000,
      cargo: 40,
      techTier: 3,
      role: 'scout',
      unique: true,
      requiresFlag: 'survey-claim',
      chartJumps: 2,
      fuelCapacity: d.ships.scout.fuelCapacity,
      maxSpeed: d.ships.courier.maxSpeed,
    });
  });

  it('survey thread flags and rewards are wired', () => {
    const d = parseGameData(raw());
    const outs = (id: string) => d.encounters[id].choices.flatMap((c) => c.outcomes);
    expect(outs('survey-beacon')).toContainEqual({ type: 'flag', flag: 'hushwater-lane' });
    expect(outs('long-patience')).toContainEqual({ type: 'flag', flag: 'survey-claim' });
    expect(outs('long-patience')).toContainEqual({ type: 'flag', flag: 'survey-stripped' });
    expect(outs('long-patience')).toContainEqual({ type: 'credits', n: 6000 });
  });
});

describe('story data', () => {
  const mission = (steps: unknown[], over: Record<string, unknown> = {}) => ({
    id: 'm1', arc: 'side', title: 'T', giver: { name: 'G', title: 'Clerk' },
    offer: { where: 'bar', ports: ['halcyon'] }, text: 'x', acceptText: 'y', declinable: true,
    steps, onComplete: [{ type: 'credits', n: 100 }], ...over,
  });
  const card = (outcomes: unknown[] = []) => ({ title: 'C', text: 't', choices: [{ label: 'ok', outcomes }] });
  const withMission = (m: unknown) => {
    const r = raw();
    r.story.missions.push(m);
    return r;
  };

  it('accepts an empty missions list', () => {
    const r = raw();
    r.story = { missions: [] };
    // with no story, nothing can set the flags that gate story hulls and outfits
    for (const g of [...r.ships, ...r.outfits]) {
      delete g.requiresFlag;
      delete g.hiddenByFlag;
    }
    expect(parseGameData(r).story).toEqual({});
  });

  it('accepts a valid mission with every step kind', () => {
    const steps = [
      { kind: 'go', system: 'calder', text: 'a' },
      { kind: 'land', planet: 'halcyon', text: 'b' },
      { kind: 'deliver', planet: 'merrow', cargo: { name: 'crates', tons: 2 }, deadlineDays: 5, text: 'c' },
      { kind: 'ferry', planet: 'merrow', passengers: 2, text: 'd' },
      { kind: 'scan', system: 'vesk', site: { label: 'Buoy' }, text: 'e' },
      { kind: 'find', system: 'vesk', site: { label: 'Wreck' }, text: 'f' },
      { kind: 'meet', system: 'vesk', ship: { name: 'Wren', shipId: 'courier', government: 'independent' },
        card: card([{ type: 'standing', government: 'concord', level: 'friend' }, { type: 'unlock', flag: 'f' }]), text: 'g' },
    ];
    expect(Object.keys(parseGameData(withMission(mission(steps))).story)).toContain('m1');
  });

  it('rejects a step naming an unknown planet, with a path', () => {
    const e = failure(withMission(mission([{ kind: 'land', planet: 'nowhere', text: 'b' }])));
    expect(e.file).toBe('story.json');
    expect(e.issues.join('\n')).toMatch(/m1\.steps\.0\.planet.*unknown planet "nowhere"/);
  });

  it('rejects an unknown step kind', () => {
    const e = failure(withMission(mission([{ kind: 'teleport', system: 'calder', text: 'a' }])));
    expect(e.file).toBe('story.json');
    expect(e.issues[0]).toContain('m1.steps.0');
  });

  it('rejects unknown system, ship, government, good and outcome references', () => {
    const meet = (shipId: string, government: string, outcomes: unknown[]) => ({
      kind: 'meet', system: 'calder', ship: { name: 'W', shipId, government }, card: card(outcomes), text: 'g',
    });
    const msg = (m: unknown) => failure(withMission(m)).issues.join('\n');
    expect(msg(mission([{ kind: 'go', system: 'nope', text: 'a' }]))).toContain('unknown system "nope"');
    expect(msg(mission([meet('nope', 'concord', [])]))).toContain('unknown ship "nope"');
    expect(msg(mission([meet('courier', 'nope', [])]))).toContain('unknown government "nope"');
    expect(msg(mission([meet('courier', 'concord', [{ type: 'cargo', good: 'nope', tons: 1 }])]))).toContain('unknown commodity "nope"');
    expect(msg(mission([meet('courier', 'concord', [{ type: 'standing', government: 'nope', level: 'cool' }])]))).toContain('unknown government "nope"');
    expect(msg(mission([{ kind: 'go', system: 'calder', text: 'a' }], { onComplete: [{ type: 'standing', government: 'nope', level: 'cool' }] }))).toContain('m1.onComplete.0');
    expect(msg(mission([{ kind: 'go', system: 'calder', text: 'a' }], { offer: { where: 'bar', ports: ['nope'] } }))).toContain('m1.offer.ports.0');
  });

  it('requires the unlock flag of a hidden system in the offer of a step or hail there', () => {
    const msg = (m: unknown) => failure(withMission(m)).issues.join('\n');
    const step = { kind: 'go', system: 'hushwater', text: 'a' };
    expect(msg(mission([step]))).toMatch(/m1\.steps\.0\.system.*hushwater.*hushwater-lane/);
    expect(msg(mission([{ kind: 'land', planet: 'halcyon', text: 'a' }], { offer: { where: 'hail', systems: ['hushwater'] } }))).toMatch(/m1\.offer\.systems\.0.*hushwater-lane/);
    const ok = withMission(mission([step], { offer: { where: 'bar', ports: ['halcyon'], requires: ['hushwater-lane'] } }));
    expect(Object.keys(parseGameData(ok).story)).toContain('m1');
  });

  it('rejects offer requires and notFlags naming a flag nothing sets', () => {
    const msg = (m: unknown) => failure(withMission(m)).issues.join('\n');
    const steps = [{ kind: 'go', system: 'calder', text: 'a' }];
    expect(msg(mission(steps, { offer: { where: 'bar', ports: ['halcyon'], requires: ['never-set'] } }))).toMatch(/m1\.offer\.requires\.0.*never-set/);
    expect(msg(mission(steps, { offer: { where: 'bar', ports: ['halcyon'], notFlags: ['never-set'] } }))).toMatch(/m1\.offer\.notFlags\.0.*never-set/);
    const ok = withMission(mission(steps, { offer: { where: 'bar', ports: ['halcyon'], notFlags: ['hushwater-lane'] } }));
    expect(Object.keys(parseGameData(ok).story)).toContain('m1');
  });

  it('rejects a shop item whose requiresStanding names an unknown government', () => {
    const r = raw();
    r.outfits[0].requiresStanding = { government: 'nope', level: 'friend' };
    expect(failure(r).issues.join('\n')).toMatch(/requiresStanding\.government.*unknown government "nope"/);
  });

  it('rejects a meet step whose ship is unique', () => {
    const e = failure(withMission(mission([
      { kind: 'meet', system: 'calder', ship: { name: 'W', shipId: 'patience', government: 'concord' }, card: card(), text: 'g' },
    ])));
    expect(e.issues.join('\n')).toMatch(/m1\.steps\.0\.ship\.shipId.*unique/);
  });

  it('allows standing requirements on ships and outfits', () => {
    const r = raw();
    r.ships.find((s) => s.id === 'kestrel').requiresStanding = { government: 'concord', level: 'friend' };
    r.outfits[0].requiresStanding = { government: 'concord', level: 'friend' };
    const d = parseGameData(r);
    expect(d.ships.kestrel.requiresStanding).toEqual({ government: 'concord', level: 'friend' });
  });
});


describe('shipped story data', () => {
  const d = parseGameData(raw());
  const missions = Object.values(d.story);

  it('has the arc and all eight side chains', () => {
    expect(missions.filter((m) => m.arc === 'main').map((m) => m.id)).toEqual([
      'm1-lights-out',
      'm2-second-opinion',
      'm3-low-tide',
      'm4-past-the-charts',
    ]);
    expect(missions.filter((m) => m.chain).map((m) => m.id)).toEqual([
      's1-missing-courier',
      's2-surveyors-charts',
      's3-pilgrim-road-1',
      's3-pilgrim-road-2',
      's3-pilgrim-road-3',
      's3-pilgrim-road-4',
      's4-two-houses',
      's5-the-collector',
      's6-long-patience',
      's7-doctors-rounds',
      's8-last-lightkeeper',
    ]);
  });

  it('every story mission is reachable', () => {
    // Fixed point: flags come from the outcomes of missions that can be reached, starting from none.
    // Encounters set flags too (the Skerry survey beacon opens the Hushwater lane), so they seed the set.
    const flags = new Set<string>(
      Object.values(d.encounters).flatMap((e) => e.choices.flatMap((c) => c.outcomes.flatMap((o) => (o.type === 'flag' || o.type === 'unlock' ? [o.flag] : [])))),
    );
    const reached = new Set<string>();
    const outcomesOf = (m: (typeof missions)[number]) => [
      ...m.onComplete,
      ...m.steps.flatMap((s) => (s.kind === 'meet' ? s.card.choices.flatMap((c) => c.outcomes) : [])),
    ];
    for (let changed = true; changed; ) {
      changed = false;
      for (const m of missions) {
        if (reached.has(m.id)) continue;
        if (!(m.offer.requires ?? []).every((f) => flags.has(f))) continue;
        reached.add(m.id);
        for (const out of outcomesOf(m)) if ((out.type === 'flag' || out.type === 'unlock') && !flags.has(out.flag)) flags.add(out.flag);
        changed = true;
      }
    }
    expect(missions.filter((m) => !reached.has(m.id)).map((m) => m.id)).toEqual([]);
  });

  it('a hail mission names its systems; a bar mission names ports or systems', () => {
    for (const m of missions) {
      if (m.offer.where === 'hail') expect(m.offer.systems?.length, m.id).toBeGreaterThan(0);
      else expect((m.offer.ports?.length ?? 0) + (m.offer.systems?.length ?? 0), m.id).toBeGreaterThan(0);
    }
  });

  it('every bar mission is offered at a port that has a bar', () => {
    for (const m of missions.filter((x) => x.offer.where === 'bar'))
      for (const p of m.offer.ports ?? []) expect(d.planets[p].services, `${m.id} at ${p}`).toContain('bar');
  });

  it('offer and accept text run 2 to 4 sentences, and no retired name appears', () => {
    for (const m of missions) {
      for (const t of [m.text, m.acceptText]) {
        const sentences = t.split(/(?<=[.!?])\s+/).filter(Boolean).length;
        expect(sentences, `${m.id}: ${t}`).toBeGreaterThanOrEqual(2);
        expect(sentences, `${m.id}: ${t}`).toBeLessThanOrEqual(4);
      }
      expect(JSON.stringify(m)).not.toMatch(/Jory/);
    }
  });
});

describe('gear flag validation', () => {
  const has = (e: DataError, s: string) => expect(e.issues.some((i) => i.includes(s)), e.issues.join(', ')).toBe(true);

  it('rejects a hull or outfit gated on a flag nothing sets', () => {
    const a = raw();
    a.ships.find((s) => s.id === 'patience')!.requiresFlag = 'no-such-flag';
    has(failure(a), 'patience.requiresFlag');
    const b = raw();
    b.ships.find((s) => s.id === 'patience')!.hiddenByFlag = 'no-such-flag';
    has(failure(b), 'patience.hiddenByFlag');
    const c = raw();
    c.outfits.find((o) => o.id === 'house-rack')!.requiresFlag = 'no-such-flag';
    has(failure(c), 'house-rack.requiresFlag');
  });
});

describe('combat data', () => {
  const has = (e: DataError, s: string) => expect(e.issues.some((i) => i.includes(s)), e.issues.join(', ')).toBe(true);
  const base = { description: '', price: 1, techTier: 1, space: 1, max: 1 };
  const withOutfit = (o: any) => {
    const r = raw();
    r.outfits.push({ ...base, name: 'T', ...o });
    return r;
  };

  it('parses every new outfit category', () => {
    const good = [
      { id: 't-gun', category: 'gun', effect: { damage: 6, rate: 4, speed: 700, range: 450, spread: 0, assist: 0 } },
      { id: 't-turret', category: 'turret', effect: { damage: 8, rate: 3, speed: 650, range: 400 } },
      { id: 't-launcher', category: 'launcher', effect: { ammo: 'rocket', rate: 1 } },
      { id: 't-ammo', category: 'ammo', space: 0, effect: { damage: 40, speed: 500, range: 700, turnRate: 0 } },
      { id: 't-beam', category: 'beam', effect: { dps: 30, range: 350 } },
      { id: 't-pod', category: 'pod', effect: { pods: 1 } },
    ];
    for (const o of good) expect(() => parseGameData(withOutfit(o)), o.id).not.toThrow();
    const bad = [
      { id: 'b-gun', category: 'gun', effect: { damage: 0, rate: 4, speed: 700, range: 450, spread: 0, assist: 0 } },
      { id: 'b-gun2', category: 'gun', effect: { damage: 6, rate: 4, speed: 700, range: 450, spread: -1, assist: 0 } },
      { id: 'b-turret', category: 'turret', effect: { damage: 8, rate: 0, speed: 650, range: 400 } },
      { id: 'b-launcher', category: 'launcher', effect: { ammo: 'rocket', rate: 0 } },
      { id: 'b-ammo', category: 'ammo', effect: { damage: 40, speed: 500, range: 700, turnRate: -1 } },
      { id: 'b-beam', category: 'beam', effect: { dps: 0, range: 350 } },
      { id: 'b-pod', category: 'pod', effect: { pods: 2 } },
      { id: 'b-extra', category: 'beam', effect: { dps: 3, range: 350, extra: 1 } },
    ];
    for (const o of bad) expect(() => parseGameData(withOutfit(o)), o.id).toThrow(DataError);
  });

  it('rejects a launcher whose ammo id is missing or not ammo', () => {
    has(failure(withOutfit({ id: 't-l', category: 'launcher', effect: { ammo: 'no-such', rate: 1 } })), 't-l.effect.ammo');
    has(failure(withOutfit({ id: 't-l', category: 'launcher', effect: { ammo: 'fuel-tank', rate: 1 } })), 't-l.effect.ammo');
  });

  it('rejects a ship loadout naming an unknown outfit', () => {
    const r = raw();
    r.ships.find((s) => s.id === 'kestrel')!.loadout = { 'no-such': 1 };
    has(failure(r), 'kestrel.loadout.no-such');
  });

  it('rejects startOutfits naming an unknown outfit', () => {
    const r = raw();
    r.config.startOutfits = { 'no-such': 1 };
    has(failure(r), 'startOutfits.no-such');
  });

  it('rejects spawn hulls naming an unknown ship', () => {
    const r = raw();
    r.combat.spawn.raiderHulls = { ...r.combat.spawn.raiderHulls, 'no-such': 1 };
    r.combat.spawn.patrolHulls = ['no-such-2'];
    has(failure(r), 'spawn.hulls.no-such');
    has(failure(r), 'spawn.hulls.no-such-2');
  });

  it('every ship has crew', () => {
    const d = parseGameData(raw());
    for (const s of Object.values(d.ships)) expect(s.crew, s.id).toBeGreaterThan(0);
    const r = raw();
    delete r.ships[0].crew;
    expect(() => parseGameData(r)).toThrow(DataError);
  });

  it('every loadout fits its hull\'s outfit space', () => {
    const d = parseGameData(raw());
    for (const s of Object.values(d.ships)) {
      const used = Object.entries(s.loadout ?? {}).reduce((n, [id, c]) => n + d.outfits[id].space * c, 0);
      expect(used, s.id).toBeLessThanOrEqual(s.outfitSpace);
    }
  });

  it('ships the raiders government, starter gun and tier-5 lance', () => {
    const d = parseGameData(raw());
    expect(d.governments.raiders.name).toBe('Rimward Raiders');
    expect(d.config.startOutfits).toEqual({ 'light-blaster': 1 });
    expect(d.outfits['lance-beam'].soldAt).toEqual(['vanterre', 'corvana-works']);
  });
});

describe('combat.json', () => {
  const has = (e: DataError, s: string) => expect(e.issues.some((i) => i.includes(s)), e.issues.join(', ')).toBe(true);
  it('loads the AI profiles per role', () => {
    const d = parseGameData(raw());
    expect(d.combat.ai.patrol.flee).toBe(0);
    expect(d.combat.ai.raider.engageRange).toBe(900);
  });
  it('holds the boarding, mission and tow tunables', () => {
    const d = parseGameData(raw());
    expect(d.combat.boarding).toMatchObject({ scuttleSec: 3, commandArmorFraction: 0.25, twoGoodsChance: 0.5, twoGoodsSplit: [0.3, 0.7] });
    expect(d.combat.missions.offerGovernments).toEqual(['concord', 'free-reach']);
    expect(d.combat.tow.quietSec).toBe(15);
  });
  it('rejects combat-job governments that do not exist', () => {
    const r = raw();
    r.combat.missions.offerGovernments = ['concord', 'no-such-gov'];
    has(failure(r), 'missions.offerGovernments.no-such-gov');
  });
  it('rejects a negative range, an unknown key, a bad fraction and a missing role', () => {
    const bad: ((c: any) => void)[] = [
      (c) => (c.ai.raider.engageRange = -5),
      (c) => (c.ai.raider.bogus = 1),
      (c) => (c.bogus = {}),
      (c) => (c.ai.trader.flee = 1.5),
      (c) => delete c.ai.patrol,
      (c) => (c.boarding.scuttleSec = 0),
      (c) => (c.boarding.commandArmorFraction = 1.5),
      (c) => (c.boarding.twoGoodsSplit = [0.7, 0.3]),
      (c) => (c.tow.quietSec = -1),
      (c) => delete c.missions,
    ];
    for (const mutate of bad) {
      const r = raw();
      mutate(r.combat);
      expect(failure(r).file).toBe('combat.json');
    }
  });
});

describe('audio.json and config.jump', () => {
  const has = (e: DataError, s: string) => expect(e.issues.some((i) => i.includes(s)), e.issues.join(', ')).toBe(true);
  it('the shipped audio data parses and has a recipe for every sound but the two voices', () => {
    const d = parseGameData(raw());
    for (const id of SFX_IDS.filter((x) => x !== 'thrust' && x !== 'beam')) expect(d.audio.sfx[id].layers.length, id).toBeGreaterThan(0);
    expect(Object.keys(d.audio.sfx).sort()).toEqual(SFX_IDS.filter((x) => x !== 'thrust' && x !== 'beam').sort());
    expect(d.audio.voices.beam.holdSec).toBe(0.1);
    expect(d.audio.sfx.uiClick.layers).toEqual([
      { kind: 'tone', wave: 'sine', f0: 2400, f1: 1800, dur: 0.025, gain: 0.03 },
      { kind: 'noise', filter: 'highpass', c0: 4000, dur: 0.015, gain: 0.015 },
    ]);
  });
  it('rejects a noise layer with no filter, naming audio.json', () => {
    const r = raw();
    r.audio.sfx.land.layers[1] = { kind: 'noise', c0: 300, dur: 0.9, gain: 0.25 };
    const e = failure(r);
    expect(e.file).toBe('audio.json');
    has(e, 'audio.json');
  });
  it('rejects a sound id outside SfxId', () => {
    const r = raw();
    r.audio.sfx.bogus = { layers: [{ kind: 'tone', wave: 'sine', f0: 440, dur: 0.1, gain: 0.1 }] };
    has(failure(r), 'audio.json');
  });
  it('rejects a missing recipe', () => {
    const r = raw();
    delete r.audio.sfx.uiClick;
    has(failure(r), 'audio.json');
  });
  it('no longer carries the retired jump and arrive recipes', () => {
    for (const id of ['jump', 'arrive']) {
      expect(SFX_IDS as readonly string[], id).not.toContain(id);
      const r = raw();
      r.audio.sfx[id] = { layers: [{ kind: 'tone', wave: 'sine', f0: 440, dur: 0.1, gain: 0.1 }] };
      has(failure(r), 'audio.json');
    }
  });
  it('maps gun outfits to a weapon voice, and rejects an unknown outfit, a non-gun or an unknown voice', () => {
    expect(parseGameData(raw()).audio.gunVoices).toEqual({ 'rapid-cannon': 'cannon' });
    const bad: [(a: any) => void, string][] = [
      [(a) => (a.gunVoices['no-such-gun'] = 'cannon'), 'gunVoices.no-such-gun'],
      [(a) => (a.gunVoices['rocket-rack'] = 'cannon'), 'gunVoices.rocket-rack'],
      [(a) => (a.gunVoices['light-blaster'] = 'missile'), 'audio.json'],
    ];
    for (const [mutate, where] of bad) {
      const r = raw();
      mutate(r.audio);
      const e = failure(r);
      expect(e.file).toContain('audio.json');
      has(e, where);
    }
  });
  it('gives the engine hum a tone under its noise rumble, and rejects a hum without one', () => {
    const { hum } = parseGameData(raw()).audio.voices;
    expect(hum.tone.f).toBeLessThan(hum.f);
    const r = raw();
    delete r.audio.voices.hum.tone;
    has(failure(r), 'audio.json');
  });
  it('keeps the beam timbre in data, and rejects a bad beam wave', () => {
    const { beam } = parseGameData(raw()).audio.voices;
    expect([beam.wave, beam.f, beam.cutoff]).toEqual(['sawtooth', 110, 900]);
    const r = raw();
    r.audio.voices.beam.wave = 'noise';
    has(failure(r), 'audio.json');
  });
  it('lets a layer swell with an attack shorter than its length, and rejects one that is not', () => {
    const ok = raw();
    ok.audio.sfx.land.layers[0].attack = 0.2;
    expect(parseGameData(ok).audio.sfx.land.layers[0].attack).toBe(0.2);
    for (const attack of [0, -0.1, 5]) {
      const r = raw();
      r.audio.sfx.land.layers[0].attack = attack;
      has(failure(r), 'audio.json');
    }
  });
  it('has a music mood record for every MoodId, chords of 8–20 s, and a pulse only in combat', () => {
    const { moods } = parseGameData(raw()).audio;
    expect(Object.keys(moods).sort()).toEqual([...MOOD_IDS].sort());
    for (const id of MOOD_IDS) {
      const [lo, hi] = moods[id].chordSec;
      expect(lo, id).toBeGreaterThanOrEqual(8);
      expect(hi, id).toBeLessThanOrEqual(20);
      expect(lo, id).toBeLessThanOrEqual(hi);
      expect(moods[id].pulse !== null, id).toBe(id === 'combat');
    }
  });
  it('rejects a mood with chords outside 8–20 s, a pulse outside combat, an unordered scale, or a missing mood', () => {
    const bad: ((a: any) => void)[] = [
      (a) => (a.moods.core.chordSec = [4, 12]),
      (a) => (a.moods.fringe.chordSec = [12, 30]),
      (a) => (a.moods.docked.chordSec = [16, 10]),
      (a) => (a.moods.core.pulse = { bpm: 90, gain: 0.1 }),
      (a) => (a.moods.core.scale = [0, 4, 2, 7, 9]),
      (a) => delete a.moods.hyperspace,
      (a) => (a.moods.calm = a.moods.core),
    ];
    for (const mutate of bad) {
      const r = raw();
      mutate(r.audio);
      has(failure(r), 'audio.json');
    }
  });
  it('holds the jump timings in config', () => {
    expect(parseGameData(raw()).config.jump).toEqual({
      alignMaxSec: 0.6, alignToleranceDeg: 3, chargeSec: 0.7, burnSec: 0.5, burnThrustMul: 3, flashSec: 0.15, arriveSec: 0.6, arriveSpeedMul: 3,
    });
  });
  it('rejects a negative jump timing, naming config.json', () => {
    const r = raw();
    r.config.jump.chargeSec = -1;
    const e = failure(r);
    expect(e.file).toBe('config.json');
    has(e, 'chargeSec');
  });
});

describe('law.json, factions.json and contraband', () => {
  const has = (e: DataError, text: string) => expect(e.issues.join('\n')).toContain(text);

  it('the shipped law and factions data parse', () => {
    const d = parseGameData(raw());
    expect(d.law.thresholds).toEqual({ suspect: 10, wanted: 30, hunted: 60 });
    expect(d.law.crimes).toEqual({ hit: 10, disable: 20, destroy: 40, contraband: 15, run: 20, board: 15 });
    expect(d.law).toMatchObject({
      refuseHeat: 5, decayPerDay: 2, fineRate: 40, bribeMul: 1.5, bribeChance: 0.6, bribeFailHeat: 10,
      hailRange: 900, scanRange: 600, catchChance: 0.8, scramblerCut: 0.5, contrabandFine: 100,
    });
    expect(d.law.rankPoints).toEqual({ mission: 2, combatJob: 4, story: 5, raiderKill: 1 });
    expect(Object.keys(d.factions).sort()).toEqual(['concord', 'free-reach', 'independent', 'unlit']);
    for (const f of Object.values(d.factions)) {
      expect(f.ranks.map((r) => r.points)).toEqual([10, 30, 70, 150, 300]);
      expect(f.ranks.map((r) => r.perk.kind)).toEqual(['title', 'discount', 'salary', 'unlock', 'discountSalary']);
    }
    expect(d.factions.concord.ranks.map((r) => r.title)).toEqual(['Lamplighter', 'Warden', 'Keeper', 'Beacon', 'Lanternmarshal']);
    expect(d.factions.concord.rivals).toEqual(['unlit']);
    expect(d.factions.unlit.rivals).toEqual(['concord']);
    expect(d.factions.concord.ranks[1].perk).toEqual({ kind: 'discount', pct: 5 });
    expect(d.factions.concord.ranks[2].perk).toEqual({ kind: 'salary', cr: 150 });
    expect(d.factions.concord.ranks[3].perk).toEqual({ kind: 'unlock', missionPayPct: 10 });
    expect(d.factions.concord.ranks[4].perk).toEqual({ kind: 'discountSalary', pct: 10, cr: 400 });
  });

  it('ships the three contraband goods, a scrambler, and black markets that respect the law', () => {
    const d = parseGameData(raw());
    expect(d.commodities.stims).toMatchObject({ name: 'Unlicensed Stims', basePrice: 600, illegalIn: ['concord', 'free-reach'] });
    expect(d.commodities.relics).toMatchObject({ name: 'Dimming Relics', basePrice: 900, illegalIn: ['concord', 'unlit'] });
    expect(d.commodities.gunparts).toMatchObject({ name: 'Weapon Parts', basePrice: 750, illegalIn: ['concord', 'independent'] });
    expect(d.outfits.scrambler).toMatchObject({ name: 'Scan Scrambler', price: 4500, space: 1 });
    for (const g of ['stims', 'relics', 'gunparts']) {
      const lows = Object.values(d.planets).filter((p) => p.market?.[g] === 'low');
      expect(lows.length, g).toBeGreaterThanOrEqual(2);
      expect(Object.values(d.planets).some((p) => p.market?.[g] === 'high'), g).toBe(true);
    }
    const fringe = new Set(Object.values(d.planets).filter((p) => ['stims', 'relics', 'gunparts'].some((g) => p.market?.[g] === 'low')).map((p) => p.id));
    expect(fringe.size).toBeGreaterThanOrEqual(2);
    expect(fringe.size).toBeLessThanOrEqual(3);
    // The scrambler is not sold at any Concord port.
    for (const p of Object.values(d.planets)) if (d.systems[p.systemId].government === 'concord') expect(sells(p.id, d.outfits.scrambler, d), p.id).toBe(false);
  });

  it('every lawful faction has a rank-4 gated item at its hub', () => {
    const d = parseGameData(raw());
    for (const [gid, f] of Object.entries(d.factions)) {
      const gated = [...Object.values(d.ships), ...Object.values(d.outfits)].filter(
        (i) => i.requiresRank?.government === gid && i.requiresRank.rank === 4,
      );
      expect(gated.length, gid).toBeGreaterThan(0);
      expect(gated.some((i) => sells(f.hub, i, d)), `${gid} hub ${f.hub}`).toBe(true);
      // Every hub of the faction's government stocks at least one gated item, so no hub is left ungated.
      const hubs = Object.values(d.planets).filter((p) => p.hub && d.systems[p.systemId].government === gid);
      for (const h of hubs) expect(gated.some((i) => sells(h.id, i, d)), `${gid} hub ${h.id}`).toBe(true);
    }
  });

  it('rejects a faction with 4 ranks, naming factions.json', () => {
    const r = raw();
    r.factions.concord.ranks.pop();
    const e = failure(r);
    expect(e.file).toBe('factions.json');
    has(e, 'factions.json');
  });

  it('rejects rank points that do not increase', () => {
    const r = raw();
    r.factions.concord.ranks[2].points = 30;
    const e = failure(r);
    expect(e.file).toBe('factions.json');
    r.factions.concord.ranks[2].points = 5;
    expect(failure(r).file).toBe('factions.json');
  });

  it('rejects an unknown perk kind', () => {
    const r = raw();
    r.factions.concord.ranks[0].perk = { kind: 'free-ship' };
    expect(failure(r).file).toBe('factions.json');
  });

  it('rejects an unknown government as a faction, a rival, an illegalIn entry or a requiresRank', () => {
    let r = raw();
    r.factions['no-such'] = clone(r.factions.concord);
    has(failure(r), 'no-such');
    r = raw();
    r.factions.concord.rivals = ['no-such'];
    has(failure(r), 'factions.json');
    r = raw();
    r.commodities.find((c) => c.id === 'stims').illegalIn = ['concord', 'no-such'];
    const e = failure(r);
    has(e, 'commodities.json');
    has(e, 'no-such');
    r = raw();
    r.ships.find((s) => s.id === 'ironback').requiresRank = { government: 'no-such', rank: 4 };
    has(failure(r), 'no-such');
    r = raw();
    r.outfits.find((o) => o.id === 'lance-beam').requiresRank = { government: 'no-such', rank: 4 };
    has(failure(r), 'no-such');
  });

  it('rejects a requiresRank outside 1 to 5', () => {
    const r = raw();
    r.ships.find((s) => s.id === 'ironback').requiresRank = { government: 'free-reach', rank: 6 };
    expect(failure(r).issues.length).toBeGreaterThan(0);
  });

  it('rejects a hub naming an unknown planet, or one outside the faction', () => {
    let r = raw();
    r.factions.concord.hub = 'no-such-port';
    has(failure(r), 'no-such-port');
    r = raw();
    r.factions.concord.hub = 'wrenhold';
    has(failure(r), 'factions.json');
  });

  it('rejects a planet whose own government outlaws a good in its market', () => {
    let r = raw();
    port(r, 'halcyon').market.stims = 'low'; // concord outlaws stims
    let e = failure(r);
    has(e, 'planets.json');
    has(e, 'halcyon.market.stims');
    r = raw();
    port(r, 'cullet-yard').market.relics = 'low'; // unlit outlaws relics
    e = failure(r);
    has(e, 'cullet-yard.market.relics');
  });

  it('rejects an illegalIn list that is empty or has duplicates', () => {
    for (const bad of [[], ['concord', 'concord']]) {
      const r = raw();
      r.commodities.find((c) => c.id === 'stims').illegalIn = bad;
      expect(failure(r).file).toBe('commodities.json');
    }
  });

  it('rejects the raiders in illegalIn, requiresRank, rivals and as a faction key', () => {
    let r = raw();
    r.commodities.find((c) => c.id === 'stims').illegalIn = ['concord', 'raiders'];
    let e = failure(r);
    expect(e.file).toBe('commodities.json');
    has(e, 'raiders have no law');
    r = raw();
    r.ships.find((s) => s.id === 'ironback').requiresRank = { government: 'raiders', rank: 4 };
    has(failure(r), 'raiders have no law');
    r = raw();
    r.outfits.find((o) => o.id === 'lance-beam').requiresRank = { government: 'raiders', rank: 4 };
    e = failure(r);
    expect(e.file).toBe('planets.json');
    has(e, 'raiders have no law');
    r = raw();
    r.factions.concord.rivals = ['unlit', 'raiders'];
    e = failure(r);
    expect(e.file).toBe('factions.json');
    has(e, 'raiders have no law');
    r = raw();
    r.factions.raiders = clone(r.factions.concord);
    e = failure(r);
    expect(e.file).toBe('factions.json');
    has(e, 'raiders have no law');
  });

  it('requires a faction for every government that holds a system', () => {
    for (const gid of ['concord', 'free-reach', 'independent', 'unlit']) {
      const r = raw();
      delete r.factions[gid];
      const e = failure(r);
      expect(e.file).toBe('factions.json');
      has(e, `"${gid}" holds a system`);
    }
  });

  it('rejects duplicate and one-way rivals', () => {
    let r = raw();
    r.factions.concord.rivals = ['unlit', 'unlit'];
    let e = failure(r);
    expect(e.file).toBe('factions.json');
    has(e, 'duplicate rival');
    r = raw();
    r.factions.unlit.rivals = [];
    e = failure(r);
    expect(e.file).toBe('factions.json');
    has(e, 'as a rival back');
  });

  it('rejects a bad law.json, naming it', () => {
    const muts: ((l: any) => void)[] = [
      (l) => delete l.fineRate,
      (l) => (l.thresholds = { suspect: 30, wanted: 30, hunted: 60 }),
      (l) => (l.bribeChance = 1.5),
      (l) => (l.catchChance = -0.1),
      (l) => (l.scramblerCut = 2),
      (l) => (l.crimes.hit = -1),
      (l) => (l.extra = 1),
      (l) => delete l.rankPoints,
      (l) => (l.rankPoints.mission = -1),
      (l) => (l.rankPoints.story = 2.5),
      (l) => (l.rankPoints.bonus = 1),
    ];
    for (const mutate of muts) {
      const r = raw();
      mutate(r.law);
      expect(failure(r).file).toBe('law.json');
    }
  });
});
