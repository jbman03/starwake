import { describe, expect, it } from 'vitest';
import { testData } from '../data/testData';
import { buyShip, shipQuote, SHIP_BLOCK_TEXT, tradeInValue } from './shipyard';
import type { Mission, WorldState } from './types';
import { newWorld } from './world';

const data = testData();
const PORT = 'vanterre';
const base = (over: Partial<WorldState> = {}): WorldState => ({ ...newWorld(data, 1), credits: 100000, ...over });
const mission = (over: Partial<Mission>): Mission => ({
  id: 'm1', typeId: 't', originId: 'vanterre', destId: 'halcyon', tons: 0, passengers: 0, pay: 0,
  paidUpfront: false, deadlineDay: null, title: 't', description: 'd', cargoName: 'c', ...over,
});

describe('tradeInValue', () => {
  it('is 75% of the shuttle hull', () => {
    expect(tradeInValue(base(), data)).toBe(7500);
  });
  it('adds half of each outfit, per count', () => {
    expect(tradeInValue(base({ outfits: { 'cargo-pod': 2 } }), data)).toBe(9500);
  });
});

describe('shipQuote / buyShip', () => {
  it('nets the mule price against the trade-in', () => {
    const q = shipQuote(base(), data, PORT, 'mule');
    expect(q).toMatchObject({ price: 45000, tradeIn: 7500, net: 37500, check: { ok: true } });
  });

  it('buys: new hull, no outfits, full fuel, credits reduced by net', () => {
    const w = base({ outfits: { 'cargo-pod': 2 } });
    const r = buyShip(w, data, PORT, 'mule');
    expect(r.quote.check).toEqual({ ok: true });
    expect(r.world.shipId).toBe('mule');
    expect(r.world.outfits).toEqual({});
    expect(r.world.ship.fuel).toBe(data.ships.mule.fuelCapacity);
    expect(r.world.credits).toBe(100000 - (45000 - 9500));
  });

  it('blocks on credits (below net) and leaves the world unchanged', () => {
    const w = base({ credits: 37499 });
    const r = buyShip(w, data, PORT, 'mule');
    expect(r.quote.check).toEqual({ ok: false, reason: 'credits' });
    expect(r.world).toBe(w);
    expect(shipQuote(base({ credits: 37500 }), data, PORT, 'mule').check).toEqual({ ok: true });
  });

  it('blocks on owned', () => {
    expect(shipQuote(base(), data, PORT, 'shuttle').check).toEqual({ ok: false, reason: 'owned' });
  });

  it('blocks on notSold at a port without a shipyard', () => {
    expect(shipQuote(base(), data, 'halcyon', 'mule').check).toEqual({ ok: false, reason: 'notSold' });
  });

  it('blocks on cargo when tons aboard exceed the new base hold', () => {
    const w = base({ cargo: { food: 10 } });
    expect(shipQuote(w, data, PORT, 'kestrel').check).toEqual({ ok: false, reason: 'cargo' });
    const m = base({ missions: [mission({ tons: 10 })] });
    expect(shipQuote(m, data, PORT, 'kestrel').check).toEqual({ ok: false, reason: 'cargo' });
  });

  it('blocks on passengers when berths would be too few', () => {
    const w = base({ missions: [mission({ passengers: 2 })] });
    expect(shipQuote(w, data, PORT, 'kestrel').check).toEqual({ ok: false, reason: 'passengers' });
  });

  it('checks run notSold, owned, cargo, passengers, credits', () => {
    const w = base({ credits: 0, cargo: { food: 10 }, missions: [mission({ passengers: 2 })] });
    expect(shipQuote(w, data, PORT, 'kestrel').check).toEqual({ ok: false, reason: 'cargo' });
    const p = base({ credits: 0, missions: [mission({ passengers: 2 })] });
    expect(shipQuote(p, data, PORT, 'kestrel').check).toEqual({ ok: false, reason: 'passengers' });
    expect(shipQuote(p, data, PORT, 'shuttle').check).toEqual({ ok: false, reason: 'owned' });
  });

  it('a trade-in above the new price pays the pilot', () => {
    const w = base({ shipId: 'kestrel', credits: 0, outfits: {} });
    const r = buyShip(w, data, PORT, 'shuttle');
    expect(r.quote.net).toBe(10000 - 52500);
    expect(r.quote.check).toEqual({ ok: true });
    expect(r.world.credits).toBe(42500);
    expect(r.world.shipName).toBe(data.ships.shuttle.name);
  });

  it('has block text for every reason', () => {
    for (const k of ['credits', 'cargo', 'passengers', 'owned', 'notSold'] as const) expect(SHIP_BLOCK_TEXT[k]).toBeTruthy();
  });
});
