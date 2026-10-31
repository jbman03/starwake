import { describe, expect, it } from 'vitest';
import { testData } from '../data/testData';
import { accept, completeAt, failOverdue, offersAt, type MissionOffer } from './missions';
import { bountyToSpawn, combatOffersOk, combatTargetSystem, recordKill } from './combatMissions';
import type { WorldState } from './types';
import { advanceDays, newWorld } from './world';

const data = testData();
const ports = Object.values(data.planets).filter((p) => p.services.includes('missions'));
const govOf = (portId: string) => data.systems[data.planets[portId].systemId].government;
const world = (day = 0, seed = 7): WorldState => ({ ...newWorld(data, seed), day });
const unarmed = (w: WorldState): WorldState => ({ ...w, outfits: {} });
const combatOnly = (os: MissionOffer[]) => os.filter((o) => o.combat);

/** Every combat offer in a run of days across all mission ports. */
function sweep(w0: WorldState, days = 30): { offer: MissionOffer; portId: string }[] {
  const out: { offer: MissionOffer; portId: string }[] = [];
  for (let d = 0; d < days; d++) for (const p of ports) for (const offer of combatOnly(offersAt({ ...w0, day: d }, data, p.id))) out.push({ offer, portId: p.id });
  return out;
}
const take = (typeId: string, w: WorldState): MissionOffer => {
  const found = sweep(w).find((s) => s.offer.typeId === typeId);
  if (!found) throw new Error(`no ${typeId} offer`);
  return found.offer;
};
const withJob = (offer: MissionOffer, w = world()): WorldState => accept({ ...w, day: Number(offer.offerId.split(':')[1]) }, data, offer);

describe('combat missions', () => {
  it('combat offers only in Concord/Free Reach ports and only when armed', () => {
    const w = world();
    expect(w.outfits).not.toEqual({});
    const armed = sweep(w);
    expect(armed.length).toBeGreaterThan(0);
    for (const { portId } of armed) expect(['concord', 'free-reach']).toContain(govOf(portId));
    expect(armed.some((s) => s.offer.typeId === 'bounty')).toBe(true);
    expect(armed.some((s) => s.offer.typeId === 'clear')).toBe(true);
    expect(sweep(unarmed(w))).toEqual([]);
    const indie = Object.values(data.planets).find((p) => data.systems[p.systemId].government === 'independent' && p.services.includes('missions'));
    if (indie) expect(combatOffersOk(w, data, indie.id)).toBe(false);
    expect(combatOffersOk(w, data, ports.find((p) => govOf(p.id) === 'concord')!.id)).toBe(true);
    expect(combatOffersOk(unarmed(w), data, ports[0].id)).toBe(false);
  });

  it('offers are seeded, name a nearby open non-Concord system and return to the origin port', () => {
    const all = sweep(world());
    expect(sweep(world())).toEqual(all);
    for (const { offer, portId } of all) {
      expect(offer.destId).toBe(portId);
      expect(offer.originId).toBe(portId);
      const sys = offer.combat!.systemId;
      expect(data.systems[sys].government).not.toBe('concord');
      expect(sys).not.toBe(data.planets[portId].systemId);
      expect(combatTargetSystem(offer)).toBe(sys);
      expect(offer.description).not.toMatch(/\{\w+\}/);
      expect(offer.title).not.toMatch(/\{\w+\}/);
      if (offer.typeId === 'bounty') {
        expect(offer.combat).toMatchObject({ kind: 'bounty', needed: 1, done: 0 });
        expect(data.ships[offer.combat!.shipId!].techTier).toBeGreaterThanOrEqual(2);
        expect(offer.combat!.targetName).toBeTruthy();
        expect(offer.title).toContain(offer.combat!.targetName!);
      } else {
        expect(offer.combat!.needed).toBeGreaterThanOrEqual(2);
        expect(offer.combat!.needed).toBeLessThanOrEqual(4);
      }
    }
  });

  it('bounty: spawn on arrival, disable counts, pays on return', () => {
    const offer = take('bounty', world());
    const w = withJob(offer);
    const m = w.missions[0];
    expect(bountyToSpawn(w, m.combat!.systemId)).toEqual([m]);
    expect(bountyToSpawn(w, 'calder')).toEqual([]);
    // Another ship in that system, or the wrong mission id, does not count.
    expect(recordKill(w, m.combat!.systemId, { role: 'raider' }).missions[0].combat!.done).toBe(0);
    expect(recordKill(w, m.combat!.systemId, { role: 'raider', missionId: 'other' }).missions[0].combat!.done).toBe(0);
    // Not paid before the kill.
    const early = completeAt(w, data, m.originId);
    expect(early.completed).toEqual([]);
    expect(early.world.missions).toHaveLength(1);
    const killed = recordKill(w, m.combat!.systemId, { role: 'raider', missionId: m.id });
    expect(killed.missions[0].combat!.done).toBe(1);
    expect(combatTargetSystem(killed.missions[0])).toBeNull();
    expect(bountyToSpawn(killed, m.combat!.systemId)).toEqual([]);
    const paid = completeAt(killed, data, m.originId);
    expect(paid.completed).toHaveLength(1);
    expect(paid.pay).toBe(m.pay);
    expect(paid.world.credits).toBe(w.credits + m.pay);
  });

  it('clear: counts raiders in its system only, pays at needed', () => {
    const offer = take('clear', world());
    const w = withJob(offer);
    const m = w.missions[0];
    const sys = m.combat!.systemId;
    expect(recordKill(w, 'calder', { role: 'raider' })).toBe(w);
    expect(recordKill(w, sys, { role: 'trader' })).toBe(w);
    let x = w;
    for (let i = 0; i < m.combat!.needed - 1; i++) x = recordKill(x, sys, { role: 'raider' });
    expect(x.missions[0].combat!.done).toBe(m.combat!.needed - 1);
    expect(combatTargetSystem(x.missions[0])).toBe(sys);
    expect(completeAt(x, data, m.originId).completed).toEqual([]);
    x = recordKill(x, sys, { role: 'raider' });
    expect(x.missions[0].combat!.done).toBe(m.combat!.needed);
    x = recordKill(x, sys, { role: 'raider' });
    expect(x.missions[0].combat!.done).toBe(m.combat!.needed); // never over
    expect(completeAt(x, data, m.originId).pay).toBe(m.pay);
  });

  it('incomplete combat job is not paid on landing', () => {
    const w = withJob(take('clear', world()));
    const m = w.missions[0];
    const r = completeAt(w, data, m.originId);
    expect(r.completed).toEqual([]);
    expect(r.pay).toBe(0);
    expect(r.world).toBe(w);
    expect(r.world.missions).toHaveLength(1);
  });

  it('deadline fails it like other jobs', () => {
    const w = withJob(take('bounty', world()));
    const m = w.missions[0];
    const late = { ...w, day: m.deadlineDay! + 1 };
    expect(failOverdue(late).failed).toHaveLength(1);
    const done = recordKill(late, m.combat!.systemId, { role: 'raider', missionId: m.id });
    expect(completeAt(done, data, m.originId).completed).toEqual([]);
    const days = m.deadlineDay! + 1 - w.day;
    expect(advanceDays(w, data, days).world.missions).toEqual([]);
  });
});
