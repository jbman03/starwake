import { describe, expect, it } from 'vitest';
import { testData } from '../data/testData';
import {
  canJump,
  canLand,
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
    expect(refuelQuote(100, shuttle, h, 10000)).toEqual({ units: 200, cost: 400 });
  });
  it('buys partially when short of credits', () => {
    expect(refuelQuote(100, shuttle, h, 150)).toEqual({ units: 75, cost: 150 });
  });
  it('buys nothing with negative credits', () => {
    expect(refuelQuote(100, shuttle, h, -300)).toEqual({ units: 0, cost: 0, reason: 'noCredits' });
  });
  it('buys nothing with zero credits', () => {
    expect(refuelQuote(100, shuttle, h, 0)).toEqual({ units: 0, cost: 0, reason: 'noCredits' });
  });
  it('reports noFuelSold for planets without a fuel price', () => {
    expect(refuelQuote(100, shuttle, data.planets['tallow-rock'], 10000)).toEqual({
      units: 0, cost: 0, reason: 'noFuelSold',
    });
  });
  it('reports full when the tank is full', () => {
    expect(refuelQuote(300, shuttle, h, 10000)).toEqual({ units: 0, cost: 0, reason: 'full' });
  });
});

describe('towDestination', () => {
  it('stranded in vesk → a calder fuel planet', () => {
    const id = towDestination(mkWorld({ systemId: 'vesk' }, { fuel: 0 }), data);
    expect(id).not.toBeNull();
    expect(data.planets[id!].systemId).toBe('calder');
    expect(data.planets[id!].fuelPrice).toBeDefined();
  });
  it('picks the fuel planet nearest that system center', () => {
    // halcyon |(700,-200)| ≈ 728 < merrow ≈ 1006 < brigg ≈ 1170
    expect(towDestination(mkWorld({ systemId: 'vesk' }, { fuel: 0 }), data)).toBe('halcyon');
  });
  it('null in calder (fuel sold locally)', () => {
    expect(towDestination(mkWorld({ systemId: 'calder' }, { fuel: 0 }), data)).toBeNull();
  });
  it('null in vesk with enough fuel to jump', () => {
    expect(towDestination(mkWorld({ systemId: 'vesk' }, { fuel: 100 }), data)).toBeNull();
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
