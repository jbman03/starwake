import { describe, expect, it } from 'vitest';
import { testData, withoutPorts } from '../data/testData';
import {
  canJump,
  canLand,
  jumpDestination,
  jumpPoint,
  pickLandTarget,
  refuelQuote,
  towDestination,
} from './rules';
import type { WorldState } from './types';
import { dist, len } from './vec';

const data = testData();
const shuttle = data.ships.shuttle;

const mkWorld = (p: Partial<WorldState> = {}, ship: Partial<WorldState['ship']> = {}): WorldState => ({
  systemId: 'calder',
  shipId: 'shuttle',
  credits: 10000,
  targetPlanetId: null,
  assist: { kind: 'none' },
  jump: null,
  timeSec: 0,
  day: 0,
  seed: 1,
  cargo: {},
  missions: [],
  route: ['vesk'],
  known: ['calder'],
  seen: ['vesk', 'tessaly', 'minster', 'dunmore'],
  pressure: {},
  events: [],
  takenOffers: [],
  outfits: {},
  flags: [],
  notes: [],
  shipName: 'Shuttle',
  stats: { jobsDone: 0, kills: 0, captures: 0 },
  lastEncounterDay: null,
  story: { active: [], done: [], failed: [], declined: [] },
  standing: {},
  ...p,
  ship: { pos: { x: 0, y: 0 }, vel: { x: 0, y: 0 }, heading: 0, fuel: 300, ...ship },
});

describe('canLand', () => {
  const h = data.planets.halcyon; // pos (700,-200), radius 60
  const edge = (extra: number) => ({ x: h.pos.x + h.radius + 40 + extra, y: h.pos.y });

  it('true at exactly radius+40 and 60 px/s', () => {
    expect(canLand(mkWorld({}, { pos: edge(0), vel: { x: 0, y: 60 } }), data, 'halcyon')).toBe(true);
  });
  it('false one pixel further out', () => {
    expect(canLand(mkWorld({}, { pos: edge(1), vel: { x: 0, y: 0 } }), data, 'halcyon')).toBe(false);
  });
  it('false at 61 px/s', () => {
    expect(canLand(mkWorld({}, { pos: edge(0), vel: { x: 61, y: 0 } }), data, 'halcyon')).toBe(false);
  });
  it('false for a planet in another system', () => {
    const t = data.planets['tallow-rock'];
    expect(canLand(mkWorld({}, { pos: t.pos }), data, 'tallow-rock')).toBe(false);
  });
});

describe('refuelQuote', () => {
  const h = data.planets.halcyon; // fuelPrice 2
  it('fills the tank when affordable', () => {
    expect(refuelQuote(100, shuttle.fuelCapacity, h, 10000)).toEqual({ units: 200, cost: 400 });
  });
  it('buys partially when short of credits', () => {
    expect(refuelQuote(100, shuttle.fuelCapacity, h, 150)).toEqual({ units: 75, cost: 150 });
  });
  it('buys nothing with negative credits', () => {
    expect(refuelQuote(100, shuttle.fuelCapacity, h, -300)).toEqual({ units: 0, cost: 0, reason: 'noCredits' });
  });
  it('buys nothing with zero credits', () => {
    expect(refuelQuote(100, shuttle.fuelCapacity, h, 0)).toEqual({ units: 0, cost: 0, reason: 'noCredits' });
  });
  it('quotes fuel at a fringe port', () => {
    expect(refuelQuote(100, shuttle.fuelCapacity, data.planets['tallow-rock'], 10000)).toEqual({ units: 200, cost: 1000 });
  });
  it('quotes whole units and whole credits for a fractional tank', () => {
    const q = refuelQuote(287.3333, shuttle.fuelCapacity, h, 10000);
    expect(q).toEqual({ units: 13, cost: 26 });
    expect(Number.isInteger(q.units) && Number.isInteger(q.cost)).toBe(true);
  });
  it('reports full when the tank is full', () => {
    expect(refuelQuote(300, shuttle.fuelCapacity, h, 10000)).toEqual({ units: 0, cost: 0, reason: 'full' });
  });
});

describe('towDestination', () => {
  const noVesk = withoutPorts(data, 'vesk'); // a system with no port at all
  it('stranded in a system with no port → a calder planet', () => {
    const id = towDestination(mkWorld({ systemId: 'vesk' }, { fuel: 0 }), noVesk);
    expect(id).not.toBeNull();
    expect(noVesk.planets[id!].systemId).toBe('calder');
  });
  it('picks the planet nearest that system center', () => {
    // halcyon |(700,-200)| ≈ 728 < merrow ≈ 1006 < brigg ≈ 1170
    expect(towDestination(mkWorld({ systemId: 'vesk' }, { fuel: 0 }), noVesk)).toBe('halcyon');
  });
  it('null in calder (fuel sold locally)', () => {
    expect(towDestination(mkWorld({ systemId: 'calder' }, { fuel: 0 }), data)).toBeNull();
  });
  it('null when the ship has under one jump of fuel but its system has any port', () => {
    expect(towDestination(mkWorld({ systemId: 'vesk' }, { fuel: 0 }), data)).toBeNull();
    expect(towDestination(mkWorld({ systemId: 'vesk' }, { fuel: 99 }), data)).toBeNull();
  });
  it('null with enough fuel to jump, even with no port', () => {
    expect(towDestination(mkWorld({ systemId: 'vesk' }, { fuel: 100 }), noVesk)).toBeNull();
  });
  it('disabled: the port nearest the ship in this system, whatever the fuel', () => {
    const near = (x: number, y: number, fuel = 300) => mkWorld({ systemId: 'calder' }, { pos: { x, y }, fuel });
    expect(towDestination(near(-800, 400), data, { disabled: true })).toBe('merrow');
    expect(towDestination(near(450, 1000), data, { disabled: true })).toBe('brigg-station');
    expect(towDestination(near(650, -150, 0), data, { disabled: true })).toBe('halcyon');
    // Without the option a fuelled ship (or one in a system with ports) gets no tow.
    expect(towDestination(near(-800, 400), data)).toBeNull();
    expect(towDestination(near(-800, 400), data, { disabled: false })).toBeNull();
  });
  it('disabled with no port here: the nearest system with one, as when stranded', () => {
    expect(towDestination(mkWorld({ systemId: 'vesk' }, { fuel: 300 }), noVesk, { disabled: true })).toBe('halcyon');
  });
});

describe('canJump / jumpPoint', () => {
  it('too close at 1999 px in calder', () => {
    expect(canJump(mkWorld({}, { pos: { x: 1999, y: 0 } }), data)).toEqual({ ok: false, reason: 'tooClose' });
  });
  it('ok at 2000 px with fuel', () => {
    expect(canJump(mkWorld({}, { pos: { x: 2000, y: 0 } }), data)).toEqual({ ok: true });
  });
  it('noFuel at 99 fuel', () => {
    expect(canJump(mkWorld({}, { pos: { x: 2100, y: 0 }, fuel: 99 }), data)).toEqual({
      ok: false, reason: 'noFuel',
    });
  });
  it('jumping while a jump is in progress', () => {
    const w = mkWorld({ jump: { toSystemId: 'vesk', t: 0.2 } }, { pos: { x: 2100, y: 0 } });
    expect(canJump(w, data)).toEqual({ ok: false, reason: 'jumping' });
  });
  it('jump point lies at jumpDistance+50 toward the destination', () => {
    const p = jumpPoint(mkWorld(), data);
    expect(len(p)).toBeCloseTo(2050, 6);
    // Toward vesk (calder's first link) on the star map.
    const calder = data.systems.calder.mapPos;
    const vesk = data.systems.vesk.mapPos;
    expect(Math.atan2(p.y, p.x)).toBeCloseTo(Math.atan2(vesk.y - calder.y, vesk.x - calder.x), 6);
    expect(canJump(mkWorld({}, { pos: p }), data)).toEqual({ ok: true });
  });
  it('noDestination outside the jump distance with fuel but no course', () => {
    expect(canJump(mkWorld({ route: [] }, { pos: { x: 2100, y: 0 } }), data)).toEqual({
      ok: false, reason: 'noDestination',
    });
  });
  it('tooClose and noFuel take precedence over noDestination', () => {
    expect(canJump(mkWorld({ route: [] }, { pos: { x: 100, y: 0 } }), data)).toEqual({ ok: false, reason: 'tooClose' });
    expect(canJump(mkWorld({ route: [] }, { pos: { x: 2100, y: 0 }, fuel: 0 }), data)).toEqual({
      ok: false, reason: 'noFuel',
    });
  });
  it('with no destination the jump point lies radially outward through the ship', () => {
    const p = jumpPoint(mkWorld({ route: [] }, { pos: { x: -300, y: 400 } }), data);
    expect(len(p)).toBeCloseTo(2050, 6);
    expect(Math.atan2(p.y, p.x)).toBeCloseTo(Math.atan2(400, -300), 6);
  });
  it('with no destination and the ship at the center the jump point lies along +x', () => {
    const p = jumpPoint(mkWorld({ route: [] }, { pos: { x: 0, y: 0 } }), data);
    expect(p.x).toBeCloseTo(2050, 6);
    expect(p.y).toBeCloseTo(0, 6);
  });
});

describe('jumpDestination', () => {
  it('the first hop of the route when it is linked', () => {
    expect(jumpDestination(mkWorld({ route: ['tessaly', 'aurelle'] }), data)).toBe('tessaly');
  });
  it('null with no route and several links', () => {
    expect(jumpDestination(mkWorld({ route: [] }), data)).toBeNull();
  });
  it("null when the route's first hop is not linked (stale) and there are several links", () => {
    expect(jumpDestination(mkWorld({ route: ['skerry'] }), data)).toBeNull();
  });
  it('the single link when there is exactly one', () => {
    const one = { ...data, systems: { ...data.systems, mirren: { ...data.systems.mirren, links: ['vesk'] } } };
    expect(jumpDestination(mkWorld({ systemId: 'mirren', route: [] }), one)).toBe('vesk');
    expect(jumpDestination(mkWorld({ systemId: 'mirren', route: ['skerry'] }), one)).toBe('vesk');
  });
});

describe('pickLandTarget', () => {
  const near = (id: string) => ({ ...data.planets[id].pos });
  it('nearest when no target', () => {
    expect(pickLandTarget(mkWorld({}, { pos: near('merrow') }), data, false)).toBe('merrow');
  });
  it('selected target when not cycling', () => {
    const w = mkWorld({ targetPlanetId: 'brigg-station' }, { pos: near('merrow') });
    expect(pickLandTarget(w, data, false)).toBe('brigg-station');
  });
  it('cycling picks the next by distance', () => {
    const w = mkWorld({ targetPlanetId: 'merrow' }, { pos: near('merrow') });
    const next = pickLandTarget(w, data, true);
    expect(next).not.toBe('merrow');
    const pos = w.ship.pos;
    const others = ['halcyon', 'brigg-station'].sort(
      (a, b) => dist(pos, data.planets[a].pos) - dist(pos, data.planets[b].pos),
    );
    expect(next).toBe(others[0]);
  });
});
