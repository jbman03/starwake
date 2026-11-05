import { describe, expect, it } from 'vitest';
import { testData } from '../data/testData';
import {
  ESCORT_ORDERS, hireRefusal, ORDER_LABEL, dismissEscort, escortMaxArmor, escortMaxFuel, hireEscort, hireOffers, keepCapture,
  escortLosses, landEscorts, nextOrder, payWages, prizeValueOf, repairCost, repairEscorts, sellEscortPrize,
  type EscortOffer,
} from './escorts';
import type { Escort, WorldState } from './types';
import { advanceDays, newWorld } from './world';
import { npcLoadout } from './weapons';

const data = testData();

describe('escort helpers', () => {
  it('lists the four orders', () => {
    expect(ESCORT_ORDERS).toEqual(['follow', 'attack', 'hold', 'defend']);
  });

  it('max armor is hull plus fitted armor outfits', () => {
    const bare = escortMaxArmor(data, { shipId: 'courier', outfits: {} });
    expect(bare).toBe(data.ships.courier.armor);
    expect(escortMaxArmor(data, { shipId: 'courier', outfits: { 'armor-plate': 1 } })).toBeGreaterThan(bare);
  });

  it('max fuel is whole jumps of the tank', () => {
    expect(escortMaxFuel(data, { shipId: 'courier', outfits: {} })).toBe(
      Math.floor(data.ships.courier.fuelCapacity / data.config.fuelPerJump),
    );
    expect(escortMaxFuel(data, { shipId: 'courier', outfits: { 'fuel-tank': 1 } })).toBeGreaterThan(
      escortMaxFuel(data, { shipId: 'courier', outfits: {} }),
    );
  });
});

const PORT = 'brannock-deeps'; // tier 3, with a shipyard
const fresh = (credits = 100000): WorldState => ({ ...newWorld(data, 7), credits });
const courierOffer = (w: WorldState): EscortOffer => {
  for (let d = 0; d < 60; d++) {
    const o = hireOffers({ ...w, day: d }, data, PORT).find((x) => x.shipId === 'courier');
    if (o) return o;
  }
  throw new Error('no courier offer found');
};
const mk = (id: string, over: Partial<Escort> = {}): Escort => ({
  id, name: id, shipId: 'courier', outfits: {}, armor: escortMaxArmor(data, { shipId: 'courier', outfits: {} }), fuel: 0,
  hired: true, wage: 150, ...over,
});
const withEscorts = (es: Escort[], credits = 100000): WorldState => ({ ...fresh(credits), escorts: es });

describe('hireOffers', () => {
  it('offers 1-3 escorts of tier 3 or less, no warden, at a tier-3 shipyard', () => {
    for (let d = 0; d < 30; d++) {
      const offers = hireOffers({ ...fresh(), day: d }, data, PORT);
      expect(offers.length).toBeGreaterThanOrEqual(1);
      expect(offers.length).toBeLessThanOrEqual(3);
      for (const o of offers) {
        expect(data.ships[o.shipId].techTier).toBeLessThanOrEqual(3);
        expect(o.shipId).not.toBe('warden');
      }
    }
  });
  it('offers none without a shipyard', () => {
    expect(hireOffers(fresh(), data, 'halcyon')).toEqual([]);
  });
  it('is the same for the same seed, port and day and differs the next day', () => {
    const w = fresh();
    expect(hireOffers(w, data, PORT)).toEqual(hireOffers(w, data, PORT));
    const days = Array.from({ length: 10 }, (_, d) => JSON.stringify(hireOffers({ ...w, day: d }, data, PORT)));
    expect(new Set(days).size).toBeGreaterThan(1);
    expect(JSON.stringify(hireOffers({ ...w, day: 1 }, data, PORT))).not.toBe(JSON.stringify(hireOffers({ ...w, day: 2 }, data, PORT)));
  });
  it('never offers a name already in the group', () => {
    for (let d = 0; d < 30; d++) {
      const w = { ...fresh(), day: d };
      const names = hireOffers(w, data, PORT).map((o) => o.name);
      const group = { ...w, escorts: names.slice(0, 2).map((name, i) => mk(`esc-${i + 1}`, { name })) };
      const again = hireOffers(group, data, PORT);
      expect(again.length).toBe(names.length);
      for (const o of again) expect(names.slice(0, 2)).not.toContain(o.name);
    }
  });
});

describe('hireEscort', () => {
  it('charges the fee, sets the wage and fits the stock loadout at full armor and fuel', () => {
    const w = fresh(10000);
    const o = courierOffer(w);
    expect(o.fee).toBe(3000);
    expect(o.wage).toBe(150);
    const r = hireEscort({ ...w, day: dayOf(w, o) }, data, PORT, o.offerId);
    if ('error' in r) throw new Error(r.error);
    expect(r.world.credits).toBe(7000);
    expect(r.escort).toMatchObject({ id: 'esc-1', shipId: 'courier', hired: true, wage: 150, name: o.name });
    expect(r.escort.armor).toBe(escortMaxArmor(data, r.escort));
    expect(r.escort.fuel).toBe(escortMaxFuel(data, r.escort));
    expect(r.escort.outfits).toEqual({ ...npcLoadout(data.ships.courier) });
    expect(r.world.escorts).toEqual([r.escort]);
  });
  it('takes the offer out of hireOffers', () => {
    const w = fresh();
    const o = courierOffer(w);
    const at = { ...w, day: dayOf(w, o) };
    const r = hireEscort(at, data, PORT, o.offerId);
    if ('error' in r) throw new Error(r.error);
    expect(hireOffers(r.world, data, PORT).map((x) => x.offerId)).not.toContain(o.offerId);
    expect(hireEscort(r.world, data, PORT, o.offerId)).toEqual({ error: 'gone' });
  });
  it('refuses a fourth hire as full and short credits as short, changing nothing', () => {
    const w = fresh();
    const o = courierOffer(w);
    const full = { ...w, day: dayOf(w, o), escorts: [mk('a'), mk('b'), mk('c')] };
    expect(hireEscort(full, data, PORT, o.offerId)).toEqual({ error: 'full' });
    const poor = { ...w, day: dayOf(w, o), credits: 2999 };
    expect(hireEscort(poor, data, PORT, o.offerId)).toEqual({ error: 'short' });
    expect(hireRefusal(data, 'full')).toBe('Your group is full (3 escorts).');
    expect(hireRefusal({ ...data, escorts: { ...data.escorts, maxEscorts: 5 } }, 'full')).toBe('Your group is full (5 escorts).');
    expect(hireRefusal(data, 'short')).toBe('Not enough credits.');
    expect(hireRefusal(data, 'gone')).toBe('That pilot has moved on.');
  });
});

/** The day on which `courierOffer` found `o`. */
function dayOf(w: WorldState, o: EscortOffer): number {
  for (let d = 0; d < 60; d++) if (hireOffers({ ...w, day: d }, data, PORT).some((x) => x.offerId === o.offerId)) return d;
  throw new Error('offer not found');
}

describe('keepCapture', () => {
  const npc = { name: 'Dusty Hand', shipId: 'courier', outfits: { 'armor-plate': 1 }, hull: { armor: 17 } };
  it('keeps the ship unfuelled, unhired and unpaid, and counts the capture', () => {
    const w = fresh();
    const r = keepCapture(w, data, npc);
    if ('error' in r) throw new Error(r.error);
    expect(r.escort).toMatchObject({ name: 'Dusty Hand', shipId: 'courier', outfits: { 'armor-plate': 1 }, armor: 17, fuel: 0, hired: false, wage: 0 });
    expect(r.world.escorts).toEqual([r.escort]);
    expect(r.world.stats.captures).toBe(w.stats.captures + 1);
  });
  it('refuses a fourth as full', () => {
    expect(keepCapture(withEscorts([mk('a'), mk('b'), mk('c')]), data, npc)).toEqual({ error: 'full' });
  });
  it('hired and kept escorts get esc-<n> ids, one past the highest in the group', () => {
    const k = keepCapture(withEscorts([{ ...mk('a'), id: 'esc-4' }]), data, npc);
    if ('error' in k) throw new Error(k.error);
    expect(k.escort.id).toBe('esc-5');
    expect(keepCapture(fresh(), data, npc)).toMatchObject({ escort: { id: 'esc-1' } });
  });
  it('gives each kept ship its own id', () => {
    const a = keepCapture(fresh(), data, npc);
    if ('error' in a) throw new Error(a.error);
    const b = keepCapture(a.world, data, npc);
    if ('error' in b) throw new Error(b.error);
    expect(b.escort.id).not.toBe(a.escort.id);
  });
});

describe('dismiss and prize', () => {
  it('dismisses without a refund', () => {
    const w = withEscorts([mk('a'), mk('b')], 500);
    const r = dismissEscort(w, 'a');
    expect(r.escorts.map((e) => e.id)).toEqual(['b']);
    expect(r.credits).toBe(500);
  });
  it('sells a kept capture for its prize value and refuses a hired escort', () => {
    const w = withEscorts([mk('k', { hired: false, wage: 0 }), mk('h')], 500);
    const r = sellEscortPrize(w, data, 'k');
    if ('error' in r) throw new Error(r.error);
    expect(r.paid).toBe(prizeValueOf(data, 'courier'));
    expect(r.paid).toBe(9000);
    expect(r.world.credits).toBe(500 + 9000);
    expect(r.world.escorts.map((e) => e.id)).toEqual(['h']);
    expect(sellEscortPrize(w, data, 'h')).toEqual({ error: 'hired' });
    expect(sellEscortPrize(w, data, 'nope')).toEqual({ error: 'gone' });
  });
});

describe('payWages', () => {
  it('advanceDays charges two days of one courier wage', () => {
    const w = withEscorts([mk('a')], 1000);
    expect(advanceDays(w, data, 2).world.credits).toBe(700);
  });
  it('pays the first escort once and marks the rest leaving', () => {
    const w = payWages(withEscorts([mk('a'), mk('b'), mk('c')], 150), data);
    expect(w.escorts.find((e) => e.id === 'c')?.leaving).toBe(true);
    expect(w.credits).toBe(0);
    expect(w.escorts.find((e) => e.id === 'a')?.leaving).toBeUndefined();
    expect(w.escorts.find((e) => e.id === 'b')?.leaving).toBe(true);
  });
  it('over a 3-day advance with one wage in hand, the first is paid once and then all are leaving', () => {
    const w = advanceDays(withEscorts([mk('a'), mk('b')], 150), data, 3).world;
    expect(w.credits).toBe(0);
    expect(w.escorts.every((e) => e.leaving)).toBe(true);
  });
  it('pays nothing on negative credits', () => {
    const w = payWages(withEscorts([mk('a')], -5), data);
    expect(w.credits).toBe(-5);
    expect(w.escorts[0].leaving).toBe(true);
  });
  it('draws no wage for a kept capture', () => {
    const w = payWages(withEscorts([mk('k', { hired: false, wage: 0 })], 0), data);
    expect(w.credits).toBe(0);
    expect(w.escorts[0].leaving).toBeUndefined();
  });
});

describe('landEscorts', () => {
  it('removes leavers with the notice, refuels the rest and clears waiting', () => {
    const w = withEscorts([mk('a', { name: 'Ansel Vorne', leaving: true }), mk('b', { waiting: true, fuel: 0 })]);
    const r = landEscorts(w, data);
    expect(r.notices).toEqual(['Ansel Vorne leaves your service: unpaid wages.']);
    expect(r.world.escorts.map((e) => e.id)).toEqual(['b']);
    expect(r.world.escorts[0].waiting).toBeUndefined();
    expect(r.world.escorts[0].fuel).toBe(escortMaxFuel(data, r.world.escorts[0]));
  });
});

describe('repair', () => {
  const max = escortMaxArmor(data, { shipId: 'courier', outfits: {} });
  it('costs repairPerArmor per missing armor point', () => {
    const w = withEscorts([mk('a', { armor: max - 4 }), mk('b', { armor: max - 1 })]);
    expect(repairCost(w, data)).toBe(10 * 5);
  });
  it('restores max armor and charges', () => {
    const w = withEscorts([mk('a', { armor: max - 4 })], 100);
    const r = repairEscorts(w, data);
    if ('error' in r) throw new Error(r.error);
    expect(r.paid).toBe(40);
    expect(r.world.credits).toBe(60);
    expect(r.world.escorts[0].armor).toBe(max);
  });
  it('refuses short with no change, and none without damage', () => {
    const hurt = withEscorts([mk('a', { armor: max - 4 })], 39);
    expect(repairEscorts(hurt, data)).toEqual({ error: 'short' });
    expect(repairEscorts(withEscorts([mk('a')]), data)).toEqual({ error: 'none' });
  });
});

describe('nextOrder', () => {
  it('cycles follow, attack, hold, defend', () => {
    expect(nextOrder('follow')).toBe('attack');
    expect(nextOrder('attack')).toBe('hold');
    expect(nextOrder('hold')).toBe('defend');
    expect(nextOrder('defend')).toBe('follow');
    expect(Object.values(ORDER_LABEL)).toEqual(['Follow', 'Attack', 'Hold', 'Return fire']);
  });
});

describe('escortLosses', () => {
  const npc = (id: string) => ({ id, role: 'escort' }) as unknown as import('./traffic').Npc;
  const before = { systemId: 'calder', npcs: [npc('esc-1'), npc('esc-2')], spawnCount: 0, nextSpawnSec: 0, targetId: null };
  it('removes a destroyed escort and says so; a disabled one stays', () => {
    const w = withEscorts([mk('esc-1', { name: 'Brass Heron' }), mk('esc-2', { name: 'Ansel Vorne' })]);
    const r = escortLosses(w, before, [
      { type: 'disabled', id: 'esc-2', byPlayer: false },
      { type: 'destroyed', id: 'esc-1', byPlayer: false, pos: { x: 0, y: 0 } },
    ]);
    expect(r.world.escorts.map((e) => e.id)).toEqual(['esc-2']);
    expect(r.messages).toEqual(['Brass Heron is destroyed.']);
  });
  it('changes nothing without an escort destroyed', () => {
    const w = withEscorts([mk('esc-1')]);
    const r = escortLosses(w, before, [{ type: 'destroyed', id: 'npc-3', byPlayer: true, pos: { x: 0, y: 0 } }]);
    expect(r.world).toBe(w);
    expect(r.messages).toEqual([]);
  });
});

describe('playtest bug 4: an unpaid escort is announced the day it happens', () => {
  it('advanceDays says the escort will leave', async () => {
    const { advanceDays, newWorld } = await import('./world');
    const { testData } = await import('../data/testData');
    const d = testData();
    const w = { ...newWorld(d, 2), credits: 0, escorts: [{ id: 'esc-1', name: 'Odile Frayne', shipId: 'scout', outfits: {}, armor: 30, fuel: 3, hired: true, wage: 175 }] };
    const r = advanceDays(w, d, 1);
    expect(r.world.escorts[0].leaving).toBe(true);
    expect(r.events).toContainEqual({ type: 'message', text: "You can't pay Odile Frayne's wage. They will leave at your next landing." });
  });
});
