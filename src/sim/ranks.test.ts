import { describe, expect, it } from 'vitest';
import { testData } from '../data/testData';
import type { GameData } from '../data/schemas';
import { applyOutcomes } from './encounters';
import { completeAt } from './missions';
import { buyOutfit, outfitBuyCheck, outfitPrice, OUTFIT_BLOCK_TEXT } from './outfitter';
import { addPoints, discountPct, missionPayPct, paySalary, rankBlockText, rankMet, rankOf, rankTitle, salaryNoticeText } from './ranks';
import { buyShip, shipQuote, SHIP_BLOCK_TEXT } from './shipyard';
import type { Mission, WorldState } from './types';
import { newWorld } from './world';

const data = testData();
const base = newWorld(data, 1);
/** Rank points per government, plus any other fields. */
const withPoints = (points: Record<string, number>, p: Partial<WorldState> = {}): WorldState => ({
  ...base,
  ...p,
  ranks: Object.fromEntries(Object.entries(points).map(([g, n]) => [g, { points: n, salaryDay: -1 }])),
});
const pointsOf = (w: WorldState, gov: string) => w.ranks[gov]?.points ?? 0;
const AT_RANK = [0, 10, 30, 70, 150, 300];
const mission = (over: Partial<Mission>): Mission => ({
  id: 'm1', typeId: 'cargo', originId: 'vanterre', destId: 'halcyon', tons: 0, passengers: 0, pay: 1000,
  paidUpfront: false, deadlineDay: null, title: 't', description: 'd', cargoName: 'c', ...over,
});

describe('rankOf / rankTitle', () => {
  it('ranks at points 9, 10, 30, 70, 150 and 300', () => {
    const at = (n: number) => rankOf(withPoints({ concord: n }), data, 'concord');
    expect([0, 9, 10, 29, 30, 70, 149, 150, 299, 300, 9999].map(at)).toEqual([0, 0, 1, 1, 2, 3, 3, 4, 4, 5, 5]);
  });
  it('titles come from the faction ladder; none below rank 1', () => {
    const title = (n: number) => rankTitle(withPoints({ concord: n }), data, 'concord');
    expect(title(9)).toBeNull();
    expect([10, 30, 70, 150, 300].map(title)).toEqual(['Lamplighter', 'Warden', 'Keeper', 'Beacon', 'Lanternmarshal']);
    expect(rankTitle(withPoints({ unlit: 150 }), data, 'unlit')).toBe('Duskwarden');
  });
  it('a government with no faction (the raiders) or no record is rank 0', () => {
    expect(rankOf(base, data, 'concord')).toBe(0);
    expect(rankOf(withPoints({ raiders: 500 }), data, 'raiders')).toBe(0);
    expect(rankTitle(withPoints({ raiders: 500 }), data, 'raiders')).toBeNull();
  });
});

describe('addPoints and rivals', () => {
  it('adds points and creates the record', () => {
    const w = addPoints(base, data, 'free-reach', 4);
    expect(pointsOf(w, 'free-reach')).toBe(4);
    expect(pointsOf(addPoints(w, data, 'free-reach', 2), 'free-reach')).toBe(6);
  });
  it('10 Concord points take 5 from the Unlit, floored at 0', () => {
    const w = addPoints(withPoints({ unlit: 20 }), data, 'concord', 10);
    expect(pointsOf(w, 'concord')).toBe(10);
    expect(pointsOf(w, 'unlit')).toBe(15);
    expect(pointsOf(addPoints(withPoints({ unlit: 3 }), data, 'concord', 10), 'unlit')).toBe(0);
    expect(pointsOf(addPoints(withPoints({ unlit: 20 }), data, 'concord', 3), 'unlit')).toBe(19); // floor(3/2) = 1
    expect(base.ranks.unlit).toBeUndefined();
    expect(addPoints(base, data, 'concord', 10).ranks.unlit).toBeUndefined(); // nothing to take
  });
  it('a rival can drop a rank', () => {
    const w = addPoints(withPoints({ unlit: 32 }), data, 'concord', 10);
    expect(rankOf(w, data, 'unlit')).toBe(1);
  });
  it('the rival pull does not cascade back', () => {
    const w = addPoints(withPoints({ concord: 50, unlit: 50 }), data, 'unlit', 10);
    expect(pointsOf(w, 'unlit')).toBe(60);
    expect(pointsOf(w, 'concord')).toBe(45); // and the Unlit lose nothing for the Concord's loss
  });
  it('factions without rivals pull from no one', () => {
    const w = addPoints(withPoints({ concord: 50, unlit: 50 }), data, 'free-reach', 10);
    expect(w.ranks.concord.points).toBe(50);
    expect(w.ranks.unlit.points).toBe(50);
  });
  it('no points while Wanted or Hunted', () => {
    for (const heat of [30, 60]) {
      const w = withPoints({ unlit: 20 }, { law: { concord: { heat } } });
      expect(addPoints(w, data, 'concord', 10)).toBe(w);
    }
    const suspect = withPoints({}, { law: { concord: { heat: 10 } } });
    expect(pointsOf(addPoints(suspect, data, 'concord', 10), 'concord')).toBe(10);
  });
  it('no points for a government with no faction', () => {
    expect(addPoints(base, data, 'raiders', 10)).toBe(base);
    expect(addPoints(base, data, 'nobody', 10)).toBe(base);
  });
  it('points never go below 0', () => {
    expect(pointsOf(addPoints(withPoints({ concord: 3 }), data, 'concord', -10), 'concord')).toBe(0);
  });
});

describe('missions and story award points', () => {
  it('completing a Concord mission gives +2', () => {
    const w = withPoints({}, { missions: [mission({})] });
    const r = completeAt(w, data, 'halcyon');
    expect(pointsOf(r.world, 'concord')).toBe(2);
    expect(r.pay).toBe(1000);
  });
  it('applies +10% pay at rank 4 (and rank 5), not below', () => {
    const at = (n: number) => completeAt(withPoints({ concord: n }, { missions: [mission({})] }), data, 'halcyon');
    expect(at(AT_RANK[3]).pay).toBe(1000);
    expect(at(AT_RANK[4]).pay).toBe(1100);
    expect(at(AT_RANK[4]).world.credits).toBe(base.credits + 1100);
    expect(at(AT_RANK[5]).pay).toBe(1100);
    // The bonus follows the mission's origin government, not the destination's.
    const reach = withPoints({ concord: 150 }, { missions: [mission({ originId: 'wrenhold', destId: 'vanterre' })] });
    expect(completeAt(reach, data, 'vanterre').pay).toBe(1000);
    expect(pointsOf(completeAt(reach, data, 'vanterre').world, 'free-reach')).toBe(2);
  });
  it('a job paid up front earns only the bonus on completion', () => {
    const w = withPoints({ concord: 150 }, { missions: [mission({ paidUpfront: true })] });
    expect(completeAt(w, data, 'halcyon').pay).toBe(100);
  });
  it('mission points pull from rivals', () => {
    const w = withPoints({ unlit: 10 }, { missions: [mission({}), mission({ id: 'm2' })] });
    const r = completeAt(w, data, 'halcyon');
    expect(pointsOf(r.world, 'concord')).toBe(4);
    expect(pointsOf(r.world, 'unlit')).toBe(8);
  });
  it('a combat job gives +4', () => {
    const job = mission({
      typeId: 'bounty', destId: 'vanterre',
      combat: { kind: 'bounty', systemId: 'vesk', shipId: 'x', targetName: 'X', needed: 1, done: 1 },
    });
    const r = completeAt(withPoints({}, { missions: [job] }), data, 'vanterre');
    expect(r.completed).toHaveLength(1);
    expect(pointsOf(r.world, 'concord')).toBe(4);
    const unfinished = completeAt(withPoints({}, { missions: [{ ...job, combat: { ...job.combat!, done: 0 } }] }), data, 'vanterre');
    expect(pointsOf(unfinished.world, 'concord')).toBe(0);
  });
  it('a story friend step gives +5; other standing steps give nothing', () => {
    const step = (w: WorldState, level: 'cool' | 'neutral' | 'friend') =>
      applyOutcomes(w, data, [{ type: 'standing', government: 'concord', level }], 'story:x', { npcName: '' }).world;
    expect(pointsOf(step(base, 'friend'), 'concord')).toBe(5);
    expect(pointsOf(step({ ...base, standing: { concord: 'cool' } }, 'neutral'), 'concord')).toBe(5);
    expect(pointsOf(step({ ...base, standing: { concord: 'friend' } }, 'friend'), 'concord')).toBe(0);
    expect(pointsOf(step(base, 'cool'), 'concord')).toBe(0);
    expect(pointsOf(step(base, 'neutral'), 'concord')).toBe(0);
  });
});

describe('discount', () => {
  it('is 0/0/5/5/5/10% at ranks 0-5, applied only at that faction\'s ports', () => {
    expect(AT_RANK.map((n) => discountPct(withPoints({ concord: n }), data, 'vanterre'))).toEqual([0, 0, 5, 5, 5, 10]);
    expect(AT_RANK.map((n) => discountPct(withPoints({ concord: n }), data, 'wrenhold'))).toEqual([0, 0, 0, 0, 0, 0]);
    expect(discountPct(withPoints({ 'free-reach': 300 }), data, 'wrenhold')).toBe(10);
    expect(discountPct(withPoints({ concord: 300 }), data, 'nowhere')).toBe(0);
  });
  it('discount applies to the purchase price before trade-in and never yields a negative cost', () => {
    const w = withPoints({ concord: 30 }, { outfits: {}, credits: 100000 });
    const q = shipQuote(w, data, 'vanterre', 'mule');
    expect(q).toMatchObject({ listPrice: 45000, price: 42750, tradeIn: 7500, net: 42750 - 7500, check: { ok: true } });
    expect(buyShip(w, data, 'vanterre', 'mule').world.credits).toBe(100000 - 35250);
    // Unchanged at rank 0, and at another faction's port.
    expect(shipQuote({ ...w, ranks: {} }, data, 'vanterre', 'mule')).toMatchObject({ price: 45000, net: 37500 });
    // A 100% discount (data) makes the hull free, never negative; the trade-in is still paid.
    const free: GameData = {
      ...data,
      factions: {
        ...data.factions,
        concord: { ...data.factions.concord, ranks: data.factions.concord.ranks.map((r, i) => (i === 1 ? { ...r, perk: { kind: 'discount' as const, pct: 100 } } : r)) },
      },
    };
    const fq = shipQuote(w, free, 'vanterre', 'mule');
    expect(fq.price).toBe(0);
    expect(fq.net).toBe(-7500);
    expect(outfitPrice(w, free, 'vanterre', 'cargo-pod')).toBe(0);
  });
  it('outfits cost the discounted price at the faction\'s ports', () => {
    const list = data.outfits['cargo-pod'].price;
    const w = withPoints({ concord: 300 }, { credits: 100000 });
    expect(outfitPrice(w, data, 'vanterre', 'cargo-pod')).toBe(Math.round(list * 0.9));
    expect(outfitPrice(w, data, 'wrenhold', 'cargo-pod')).toBe(list);
    expect(buyOutfit(w, data, 'vanterre', 'cargo-pod').world.credits).toBe(100000 - Math.round(list * 0.9));
    // The credits check uses the discounted price.
    const tight = { ...w, credits: Math.round(list * 0.9) };
    expect(outfitBuyCheck(tight, data, 'vanterre', 'cargo-pod')).toEqual({ ok: true });
    expect(outfitBuyCheck({ ...tight, ranks: {} }, data, 'vanterre', 'cargo-pod')).toEqual({ ok: false, reason: 'credits' });
  });
});

describe('missionPayPct', () => {
  it('is 10 from rank 4', () => {
    expect(AT_RANK.map((n) => missionPayPct(withPoints({ concord: n }), data, 'concord'))).toEqual([0, 0, 0, 0, 10, 10]);
    expect(missionPayPct(base, data, 'raiders')).toBe(0);
  });
});

describe('paySalary', () => {
  it('is 150 at rank 3 and 400 at rank 5, none below rank 3', () => {
    const pay = (n: number) => paySalary(withPoints({ concord: n }, { day: 4 }), data, 'vanterre').paid;
    expect(AT_RANK.map(pay)).toEqual([0, 0, 0, 150, 150, 400]);
  });
  it('pays once per day per faction', () => {
    const w = withPoints({ concord: 70, 'free-reach': 300 }, { day: 4, credits: 1000 });
    const first = paySalary(w, data, 'vanterre');
    expect(first.paid).toBe(150);
    expect(first.world.credits).toBe(1150);
    expect(first.world.ranks.concord).toEqual({ points: 70, salaryDay: 4 });
    const again = paySalary(first.world, data, 'halcyon');
    expect(again.paid).toBe(0);
    expect(again.world).toBe(first.world);
    const reach = paySalary(again.world, data, 'wrenhold');
    expect(reach.paid).toBe(400);
    expect(reach.world.credits).toBe(1550);
    expect(paySalary({ ...reach.world, day: 5 }, data, 'vanterre').paid).toBe(150);
  });
  it('pays nothing at a port with no faction or no record', () => {
    expect(paySalary(base, data, 'vanterre')).toEqual({ world: base, paid: 0 });
    expect(paySalary(base, data, 'nowhere')).toEqual({ world: base, paid: 0 });
  });
});

describe('requiresRank', () => {
  it('rankMet: absent is met; otherwise the rank must reach it', () => {
    expect(rankMet(base, data, undefined)).toBe(true);
    expect(rankMet(withPoints({ concord: 149 }), data, { government: 'concord', rank: 4 })).toBe(false);
    expect(rankMet(withPoints({ concord: 150 }), data, { government: 'concord', rank: 4 })).toBe(true);
  });
  it('a requiresRank 4 item is blocked with the exact text below rank 4 and offered at rank 4', () => {
    const req = data.outfits['lance-beam'].requiresRank!;
    expect(rankBlockText(req, data)).toBe('Requires Concord rank 4 (Beacon)');
    expect(rankBlockText(data.ships.ironback.requiresRank!, data)).toBe('Requires Free Reach rank 4 (Reeve)');
    const rich = { credits: 500000, outfits: {}, shipId: 'kestrel' };
    expect(outfitBuyCheck(withPoints({ concord: 149 }, rich), data, 'vanterre', 'lance-beam')).toEqual({ ok: false, reason: 'rank' });
    expect(buyOutfit(withPoints({ concord: 149 }, rich), data, 'vanterre', 'lance-beam').world.outfits).toEqual({});
    expect(outfitBuyCheck(withPoints({ concord: 150 }, rich), data, 'vanterre', 'lance-beam')).toEqual({ ok: true });
    expect(shipQuote(withPoints({ 'free-reach': 149 }, rich), data, 'wrenhold', 'ironback').check).toEqual({ ok: false, reason: 'rank' });
    expect(shipQuote(withPoints({ 'free-reach': 150 }, rich), data, 'wrenhold', 'ironback').check).toEqual({ ok: true });
    expect(SHIP_BLOCK_TEXT.rank).toBeTruthy();
    expect(OUTFIT_BLOCK_TEXT.rank).toBeTruthy();
  });
  it('a Concord requiresStanding: friend item is also offered at Concord rank 4', () => {
    const rich = { credits: 500000, outfits: {}, flags: ['concord-done'] };
    expect(shipQuote(withPoints({ concord: 149 }, rich), data, 'concordance', 'lantern-tender').check).toEqual({ ok: false, reason: 'standing' });
    expect(shipQuote(withPoints({ concord: 150 }, rich), data, 'concordance', 'lantern-tender').check).toEqual({ ok: true });
    expect(shipQuote(withPoints({ concord: 150 }, { ...rich, standing: { concord: 'cool' } }), data, 'concordance', 'lantern-tender').check).toEqual({ ok: true });
    // Not while the Concord has the pilot Wanted: the law cap still holds.
    expect(shipQuote(withPoints({ concord: 150 }, { ...rich, law: { concord: { heat: 30 } } }), data, 'concordance', 'lantern-tender').check).toEqual({ ok: false, reason: 'standing' });
    // Another faction's rank does not cover the Concord's standing gate.
    expect(shipQuote(withPoints({ 'free-reach': 300 }, rich), data, 'concordance', 'lantern-tender').check).toEqual({ ok: false, reason: 'standing' });
  });
});

describe('salaryNoticeText', () => {
  it('names the government and the pay', () => {
    expect(salaryNoticeText('concord', 150, data)).toBe('Concord salary: +150 cr');
    expect(salaryNoticeText('free-reach', 400, data)).toBe('Free Reach salary: +400 cr');
  });
});
