import { describe, expect, it } from 'vitest';
import { testData } from '../data/testData';
import { cargoFree } from './cargo';
import { hopDistance } from './galaxy';
import { MAX_MISSIONS, abandon, accept, canAbandon, canAccept, completeAt, failOverdue, offersAt, type MissionOffer } from './missions';
import type { Mission, WorldState } from './types';
import { advanceDays, newWorld } from './world';

const data = testData();
const ports = Object.values(data.planets).filter((p) => p.services.includes('missions'));
const home = ports[0];
const at = (day: number, seed = 7): WorldState => ({ ...newWorld(data, seed), day });
const sysOf = (portId: string) => data.planets[portId].systemId;

/** Every offer from every mission port on a run of days. */
function sweep(days = 12): { offer: MissionOffer; hops: number }[] {
  const out: { offer: MissionOffer; hops: number }[] = [];
  for (let d = 0; d < days; d++) {
    for (const p of ports) {
      for (const offer of offersAt(at(d), data, p.id)) {
        out.push({ offer, hops: hopDistance(data, p.systemId, sysOf(offer.destId), []) });
      }
    }
  }
  return out;
}

const mission = (over: Partial<Mission>): Mission => ({
  id: 'm1', typeId: 'delivery', originId: 'a', destId: 'b', tons: 0, passengers: 0, pay: 1000,
  paidUpfront: false, deadlineDay: null, title: 'T', description: '', cargoName: 'x', ...over,
});
const withMissions = (w: WorldState, ...ms: Mission[]): WorldState => ({ ...w, missions: ms });
const offer = (over: Partial<MissionOffer> = {}): MissionOffer => ({
  offerId: 'o1', typeId: 'delivery', originId: 'a', destId: 'b', tons: 0, passengers: 0, pay: 500,
  paidUpfront: false, deadlineDay: null, title: 'T', description: '', cargoName: 'x', ...over,
});

describe('offer text', () => {
  it('writes pay with a thousands separator, as the UI does', () => {
    const big = sweep().filter(({ offer }) => offer.pay >= 1000 && offer.description.includes('credits'));
    expect(big.length).toBeGreaterThan(0);
    for (const { offer } of big) {
      expect(offer.description).toContain(`${offer.pay.toLocaleString('en-US')} credits`);
    }
  });
});

describe('offersAt', () => {
  it('is deterministic per seed, port and day, and differs the next day', () => {
    const a = offersAt(at(3), data, home.id);
    expect(offersAt(at(3), data, home.id)).toEqual(a);
    expect(offersAt(at(4), data, home.id)).not.toEqual(a);
  });

  it('gives 3-7 offers with stable unique ids', () => {
    for (let d = 0; d < 20; d++) {
      for (const p of ports) {
        const o = offersAt(at(d), data, p.id);
        expect(o.length).toBeGreaterThanOrEqual(3);
        expect(o.length).toBeLessThanOrEqual(7);
        expect(new Set(o.map((x) => x.offerId)).size).toBe(o.length);
        for (const x of o) expect(x.offerId).toMatch(new RegExp(`^${p.id}:${d}:\\d+$`));
      }
    }
  });

  it('keeps rush destinations within 2 hops, outside the origin system', () => {
    const rush = sweep().filter((s) => s.offer.typeId === 'rush');
    expect(rush.length).toBeGreaterThan(0);
    for (const { offer: o, hops } of rush) {
      expect(hops).toBeGreaterThanOrEqual(1);
      expect(hops).toBeLessThanOrEqual(2);
      expect(sysOf(o.destId)).not.toBe(sysOf(o.originId));
      expect(o.cargoName).toBe('priority parcels');
    }
  });

  it('sends garbage to a dump site, pays up front, with no deadline', () => {
    const dumps = sweep().filter((s) => s.offer.typeId === 'dump');
    expect(dumps.length).toBeGreaterThan(0);
    for (const { offer: o } of dumps) {
      expect(data.planets[o.destId].dumpSite).toBe(true);
      expect(o.paidUpfront).toBe(true);
      expect(o.deadlineDay).toBeNull();
      expect(o.cargoName).toBe('waste');
    }
  });

  it('picks the nearest dump site for garbage', () => {
    for (const { offer: o, hops } of sweep().filter((s) => s.offer.typeId === 'dump')) {
      const origin = data.planets[o.originId];
      const nearest = Math.min(
        ...Object.values(data.planets)
          .filter((p) => p.dumpSite && p.systemId !== origin.systemId)
          .map((p) => hopDistance(data, origin.systemId, p.systemId, [])),
      );
      expect(hops).toBe(nearest);
    }
  });

  it('prices by the formula: rush of 2 t over 1 hop pays 1500', () => {
    const rush = sweep().find((s) => s.offer.typeId === 'rush' && s.hops === 1 && s.offer.tons === 2)!;
    expect(rush.offer.pay).toBe(1500); // (400 + 500 + 150*2) * 1.25
    for (const { offer: o, hops } of sweep().filter((s) => !s.offer.combat)) {
      const t = data.missionTypes[o.typeId];
      const raw = (t.basePay + t.perHop * hops + t.perTon * o.tons + t.perPassenger * o.passengers) * t.urgency;
      expect(o.pay).toBe(Math.round(raw / 10) * 10);
    }
  });

  it('sets the deadline from the day, hops and type, and fills the text', () => {
    const w = at(5);
    for (const p of ports) {
      for (const o of offersAt(w, data, p.id).filter((x) => !x.combat)) {
        const t = data.missionTypes[o.typeId];
        const hops = hopDistance(data, p.systemId, sysOf(o.destId), []);
        expect(o.deadlineDay).toBe(t.deadline ? 5 + t.deadline.perHop * hops + t.deadline.plus : null);
        expect(o.title).not.toMatch(/[{}]/);
        expect(o.description).not.toMatch(/[{}]/);
        expect(o.description).toContain(o.pay.toLocaleString('en-US'));
        expect(o.title).toContain(data.planets[o.destId].name);
      }
    }
  });

  it('hides offers already accepted', () => {
    const w = at(2);
    const first = offersAt(w, data, home.id)[0];
    const after = accept(w, data, first);
    const rest = offersAt(after, data, home.id).map((o) => o.offerId);
    expect(rest).not.toContain(first.offerId);
    expect(rest.length).toBe(offersAt(w, data, home.id).length - 1);
  });
});

describe('canAccept / accept', () => {
  it('reports noSpace, noBerths and tooMany', () => {
    const w = at(0); // 20 t, 4 berths
    expect(canAccept(w, data, offer({ tons: 20 }))).toEqual({ ok: true });
    expect(canAccept(w, data, offer({ tons: 21 }))).toEqual({ ok: false, reason: 'noSpace' });
    expect(canAccept(w, data, offer({ passengers: 5 }))).toEqual({ ok: false, reason: 'noBerths' });
    const full = withMissions(w, ...Array.from({ length: MAX_MISSIONS }, (_, i) => mission({ id: `m${i}` })));
    expect(canAccept(full, data, offer())).toEqual({ ok: false, reason: 'tooMany' });
    expect(accept(full, data, offer())).toBe(full);
  });

  it('reserves cargo and berths, and the 8th mission is the last', () => {
    let w = at(0);
    for (let i = 0; i < MAX_MISSIONS; i++) w = accept(w, data, offer({ offerId: `o${i}` }));
    expect(w.missions).toHaveLength(8);
    expect(accept(w, data, offer({ offerId: 'o9' })).missions).toHaveLength(8);
    const loaded = accept(at(0), data, offer({ tons: 12, passengers: 3 }));
    expect(cargoFree(loaded, data)).toBe(8);
    expect(canAccept(loaded, data, offer({ offerId: 'x', passengers: 2 }))).toEqual({ ok: false, reason: 'noBerths' });
  });

  it('adds the mission with the offer id; accepting twice is a no-op', () => {
    const once = accept(at(0), data, offer({ tons: 5 }));
    expect(once.missions[0].id).toBe('o1');
    expect(accept(once, data, offer({ tons: 5 }))).toBe(once);
  });

  it('pays up front jobs now and others later', () => {
    const w = at(0);
    expect(accept(w, data, offer({ paidUpfront: true, pay: 700 })).credits).toBe(w.credits + 700);
    expect(accept(w, data, offer({ pay: 700 })).credits).toBe(w.credits);
  });
});

describe('accept charts the destination', () => {
  const realOffer = (destId: string) => offer({ destId });
  it('adds an uncharted destination system to seen, keeping known and seen disjoint', () => {
    const w = at(0);
    const port = Object.values(data.planets).find((p) => p.systemId === 'brackwater')!;
    expect(w.seen).not.toContain('brackwater');
    const taken = accept(w, data, realOffer(port.id));
    expect(taken.seen).toContain('brackwater');
    expect(taken.known.filter((id) => taken.seen.includes(id))).toEqual([]);
  });

  it('leaves a known or already-seen destination system alone', () => {
    const w = at(0);
    const knownPort = Object.values(data.planets).find((p) => w.known.includes(p.systemId))!;
    const seenPort = Object.values(data.planets).find((p) => w.seen.includes(p.systemId))!;
    const a = accept(w, data, realOffer(knownPort.id));
    expect(a.known).toEqual(w.known);
    expect(a.seen).toEqual(w.seen);
    expect(accept(w, data, { ...realOffer(seenPort.id), offerId: 'o2' }).seen).toEqual(w.seen);
  });
});

describe('taken offers', () => {
  it('stays hidden and unacceptable after accept then abandon on the same day', () => {
    const w = at(2);
    const o = offersAt(w, data, home.id)[0];
    const once = accept(w, data, o);
    const back = abandon(once, o.offerId);
    expect(offersAt(back, data, home.id).map((x) => x.offerId)).not.toContain(o.offerId);
    const again = accept(back, data, o);
    expect(again.missions).toEqual([]);
    expect(again.credits).toBe(back.credits);
  });

  it('keeps the offer of a completed mission hidden', () => {
    const w = [2, 3, 4, 5].map((d) => at(d)).find((x) => offersAt(x, data, home.id).some((o) => !o.combat))!;
    const o = offersAt(w, data, home.id).find((x) => !x.combat)!;
    const done = completeAt(accept(w, data, o), data, o.destId).world;
    expect(done.missions).toEqual([]);
    expect(offersAt(done, data, home.id).map((x) => x.offerId)).not.toContain(o.offerId);
  });

  it('prunes entries from earlier days when the day advances', () => {
    const w = { ...at(2), takenOffers: ['p:1:0', 'p:2:3', 'p:3:1', 'a:b:2:4'] };
    expect(advanceDays(w, data, 1).world.takenOffers).toEqual(['p:3:1']);
  });

  it('reads ferry text for one passenger without "1 travelers"', () => {
    const f = sweep(40).map((s) => s.offer).find((o) => o.typeId === 'ferry' && o.passengers === 1)!;
    expect(f.description).toContain('A party of 1,');
    expect(f.description).not.toContain('1 travelers');
  });
});

describe('completeAt / failOverdue / abandon', () => {
  it('completes every mission to the port, sums pay, keeps trade goods', () => {
    const base = withMissions(
      at(3),
      mission({ id: 'a', destId: 'p', tons: 4, pay: 1000, deadlineDay: 5 }),
      mission({ id: 'b', destId: 'p', tons: 3, pay: 250, deadlineDay: 3 }),
      mission({ id: 'c', destId: 'q', pay: 999 }),
    );
    const w: WorldState = { ...base, cargo: { food: 10 } };
    const r = completeAt(w, data, 'p');
    expect(r.completed.map((m) => m.id)).toEqual(['a', 'b']);
    expect(r.pay).toBe(1250);
    expect(r.world.credits).toBe(w.credits + 1250);
    expect(r.world.cargo).toEqual({ food: 10 });
    expect(r.world.missions.map((m) => m.id)).toEqual(['c']);
  });

  it('does not complete an overdue mission, and does not pay upfront jobs twice', () => {
    const w = withMissions(
      at(6),
      mission({ id: 'late', destId: 'p', deadlineDay: 5 }),
      mission({ id: 'dump', destId: 'p', pay: 400, paidUpfront: true }),
    );
    const r = completeAt(w, data, 'p');
    expect(r.completed.map((m) => m.id)).toEqual(['dump']);
    expect(r.pay).toBe(0);
    expect(r.world.missions.map((m) => m.id)).toEqual(['late']);
  });

  it('fails only past the deadline, never null deadlines', () => {
    const w = withMissions(
      at(5),
      mission({ id: 'on', deadlineDay: 5 }),
      mission({ id: 'over', deadlineDay: 4 }),
      mission({ id: 'none', deadlineDay: null }),
    );
    const r = failOverdue(w);
    expect(r.failed.map((m) => m.id)).toEqual(['over']);
    expect(r.world.missions.map((m) => m.id)).toEqual(['on', 'none']);
  });

  it('a 3-day advance past two deadlines fails each once with one message each', () => {
    const w = withMissions(
      at(0),
      mission({ id: 'a', title: 'Alpha', deadlineDay: 1 }),
      mission({ id: 'b', title: 'Beta', deadlineDay: 2 }),
      mission({ id: 'c', title: 'Gamma', deadlineDay: 9 }),
    );
    const r = advanceDays(w, data, 3);
    expect(r.world.missions.map((m) => m.id)).toEqual(['c']);
    expect(r.events.filter((e) => e.type === 'message')).toEqual([
      { type: 'message', text: 'Mission failed: Alpha — the deadline passed.' },
      { type: 'message', text: 'Mission failed: Beta — the deadline passed.' },
    ]);
  });

  it('abandon frees cargo, pays nothing, and returns an up-front advance', () => {
    const base = at(0);
    const taken = accept(base, data, offer({ tons: 15, passengers: 2, paidUpfront: true, pay: 300 }));
    expect(cargoFree(taken, data)).toBe(5);
    expect(taken.credits).toBe(base.credits + 300);
    const gone = abandon(taken, 'o1');
    expect(gone.missions).toEqual([]);
    expect(cargoFree(gone, data)).toBe(20);
    expect(gone.credits).toBe(base.credits);
    expect(abandon(gone, 'nope')).toBe(gone);
  });

  it('abandoning a job paid on delivery costs nothing', () => {
    const taken = accept(at(0), data, offer({ pay: 900 }));
    expect(abandon(taken, 'o1').credits).toBe(taken.credits);
  });

  it('an accept -> abandon garbage cycle leaves credits unchanged', () => {
    let w = at(0);
    const start = w.credits;
    for (let day = 0; day < 6; day++) {
      w = { ...w, day };
      for (const o of offersAt(w, data, home.id).filter((x) => x.paidUpfront)) {
        w = abandon(accept(w, data, o), o.offerId);
        expect(w.credits).toBe(start);
        expect(w.missions).toEqual([]);
      }
    }
  });

  it('a pilot who cannot refund the advance cannot abandon', () => {
    const taken = accept(at(0), data, offer({ paidUpfront: true, pay: 300 }));
    const broke = { ...taken, credits: 299 };
    expect(canAbandon(broke, 'o1')).toEqual({ ok: false, reason: 'cantRefund' });
    expect(abandon(broke, 'o1')).toBe(broke);
    expect(canAbandon({ ...taken, credits: 300 }, 'o1')).toEqual({ ok: true });
    expect(abandon({ ...taken, credits: 300 }, 'o1').credits).toBe(0);
    // Jobs paid on delivery can always be dropped, even in debt.
    const later = { ...accept(at(0), data, offer({ pay: 300 })), credits: -50 };
    expect(canAbandon(later, 'o1')).toEqual({ ok: true });
    expect(abandon(later, 'o1').missions).toEqual([]);
  });
});
