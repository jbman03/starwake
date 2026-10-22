import { describe, expect, it } from 'vitest';
import { testData } from '../data/testData';
import { standingBlockText } from './standing';
import { buyShip, shipHidden, shipQuote, SHIP_BLOCK_TEXT, tradeInValue } from './shipyard';
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

describe('survey hull gating', () => {
  const YARD = 'wrenhold';
  it('is locked without the claim and open with it', () => {
    expect(shipQuote(base(), data, YARD, 'patience').check).toEqual({ ok: false, reason: 'locked' });
    expect(shipQuote(base({ flags: ['survey-claim'] }), data, YARD, 'patience').check).toEqual({ ok: true });
  });
  it('is hidden once the wreck is stripped, and sold-once reads as gone', () => {
    expect(shipHidden(base({ flags: ['survey-claim'] }), data.ships.patience)).toBe(false);
    expect(shipHidden(base({ flags: ['survey-stripped'] }), data.ships.patience)).toBe(true);
    expect(shipHidden(base({ flags: ['survey-stripped'] }), data.ships.shuttle)).toBe(false);
    const sold = base({ flags: ['survey-claim', 'bought:patience'] });
    expect(shipQuote(sold, data, YARD, 'patience').check).toEqual({ ok: false, reason: 'gone' });
    expect(SHIP_BLOCK_TEXT.gone).toBe("Sold once — she's gone.");
  });
  it('an unknown ship trades in for nothing', () => {
    expect(tradeInValue(base({ shipId: 'nope' }), data)).toBe(0);
  });
  it('records the purchase and is then owned', () => {
    const r = buyShip(base({ flags: ['survey-claim'] }), data, YARD, 'patience');
    expect(r.world.flags).toContain('bought:patience');
    expect(shipQuote(r.world, data, YARD, 'patience').check).toEqual({ ok: false, reason: 'owned' });
  });
});

describe('requiresStanding', () => {
  const gated = { ...data, ships: { ...data.ships, mule: { ...data.ships.mule, requiresStanding: { government: 'concord', level: 'friend' as const } } } };

  it('blocks with reason "standing" until the government is a friend', () => {
    expect(shipQuote(base(), gated, PORT, 'mule').check).toEqual({ ok: false, reason: 'standing' });
    expect(shipQuote(base({ standing: { concord: 'cool' } }), gated, PORT, 'mule').check).toEqual({ ok: false, reason: 'standing' });
    expect(shipQuote(base({ standing: { concord: 'friend' } }), gated, PORT, 'mule').check).toEqual({ ok: true });
    expect(buyShip(base(), gated, PORT, 'mule').world.shipId).toBe('shuttle');
  });

  it('names the government', () => {
    expect(standingBlockText(gated.ships.mule.requiresStanding, data)).toBe('Requires Concord friendship');
    expect(SHIP_BLOCK_TEXT.standing).toBeTruthy();
  });
});

describe('story hulls (Lantern-tender, Freewind)', () => {
  const cases = [
    { id: 'lantern-tender', yard: 'concordance', flag: 'concord-done', gov: 'concord' },
    { id: 'freewind', yard: 'wrenhold', flag: 'reach-done', gov: 'free-reach' },
  ];
  for (const c of cases) {
    it(`${c.id}: locked, then standing, then buyable, owned, gone`, () => {
      const rich = { credits: 400000 };
      expect(shipQuote(base({ ...rich }), data, c.yard, c.id).check).toEqual({ ok: false, reason: 'locked' });
      expect(shipQuote(base({ ...rich, standing: { [c.gov]: 'friend' } }), data, c.yard, c.id).check).toEqual({ ok: false, reason: 'locked' });
      expect(shipQuote(base({ ...rich, flags: [c.flag] }), data, c.yard, c.id).check).toEqual({ ok: false, reason: 'standing' });
      const ready = base({ ...rich, flags: [c.flag], standing: { [c.gov]: 'friend' } });
      expect(shipQuote(ready, data, c.yard, c.id).check).toEqual({ ok: true });
      expect(shipQuote(ready, data, 'vanterre', c.id).check).toEqual({ ok: false, reason: 'notSold' });
      const bought = buyShip(ready, data, c.yard, c.id).world;
      expect(shipQuote(bought, data, c.yard, c.id).check).toEqual({ ok: false, reason: 'owned' });
      const traded = buyShip(bought, data, c.yard, 'mule').world;
      expect(shipQuote(traded, data, c.yard, c.id).check).toEqual({ ok: false, reason: 'gone' });
    });
  }
});

describe('locked hull teasers', () => {
  it('Patience keeps its survey teaser; other flag-locked hulls default to the neutral caption', () => {
    expect(data.ships.patience.teaser).toBe('Ask about the old survey ship');
    expect(data.ships['lantern-tender'].teaser).toBeUndefined();
    expect(data.ships.freewind.teaser).toBeUndefined();
    expect(SHIP_BLOCK_TEXT.locked).toBe('Not offered to you yet.');
    expect(SHIP_BLOCK_TEXT.locked).not.toMatch(/survey/i);
  });
});
