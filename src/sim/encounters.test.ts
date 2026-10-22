import { describe, expect, it } from 'vitest';
import { testData } from '../data/testData';
import type { EncounterDef } from '../data/schemas';
import { cargoFree } from './cargo';
import { ENCOUNTER_BLOCK_TEXT, ENCOUNTER_CHANCE, applyChoice, choiceBlock, fillText, rollEncounter } from './encounters';
import { HIDDEN_LANE_FLAG } from './galaxy';
import { hasFlag } from './story';
import type { WorldState } from './types';
import { newWorld } from './world';

const data = testData();
const ctx = { npcName: 'Brisk Heron' };
const enc = (id: string): EncounterDef => data.encounters[id];
const base = (over: Partial<WorldState> = {}): WorldState => ({ ...newWorld(data, 11), day: 10, ...over });
const choiceOf = (id: string, i: number) => enc(id).choices[i];
const def = (over: Partial<EncounterDef> & Pick<EncounterDef, 'choices'>): EncounterDef => ({
  id: 't', kind: 'hail', weight: 1, title: 't', text: 't', ...over,
});

describe('rollEncounter', () => {
  it('is null while the guide is active', () => {
    for (let d = 1; d < 200; d++) expect(rollEncounter(base({ day: d }), data, { guideActive: true })).toBeNull();
    const w = base({ systemId: 'hushwater' });
    expect(rollEncounter(w, data, { guideActive: true })).toBeNull();
  });

  it('never fires on two arrivals in a row', () => {
    for (let d = 2; d < 300; d++) {
      expect(rollEncounter(base({ day: d, lastEncounterDay: d - 1 }), data, { guideActive: false })).toBeNull();
    }
  });

  it('is deterministic for the same world', () => {
    for (let d = 1; d < 100; d++) {
      const w = base({ day: d });
      expect(rollEncounter(w, data, { guideActive: false })?.id).toBe(rollEncounter(w, data, { guideActive: false })?.id);
    }
  });

  it('fires about a quarter of the time over 1000 seeded arrivals', () => {
    let hits = 0;
    for (let i = 0; i < 1000; i++) {
      const w = { ...newWorld(data, 1000 + i), day: 20 };
      if (rollEncounter(w, data, { guideActive: false })) hits++;
    }
    expect(ENCOUNTER_CHANCE).toBe(0.25);
    expect(hits / 1000).toBeGreaterThan(0.2);
    expect(hits / 1000).toBeLessThan(0.3);
  });

  const seen = (w: (d: number) => WorldState) => {
    const ids = new Set<string>();
    for (let d = 1; d < 600; d++) {
      const e = rollEncounter(w(d), data, { guideActive: false });
      if (e) ids.add(e.id);
    }
    return ids;
  };

  it('honours minDay', () => {
    // days 1..2 are below salvage-derelict's minDay of 3
    expect(seen((d) => base({ day: 1 + (d % 2) })).has('salvage-derelict')).toBe(false);
    expect(seen((d) => base({ day: 3 + d })).has('salvage-derelict')).toBe(true);
  });

  it('honours governments', () => {
    expect(data.systems[base().systemId].government).toBe('concord');
    expect(seen((d) => base({ day: 10 + d })).has('pilgrim-convoy')).toBe(false);
    expect(seen((d) => base({ day: 10 + d, systemId: 'skerry' })).has('pilgrim-convoy')).toBe(true);
  });

  it('honours tiers (some port in the system has a listed tier)', () => {
    const tiers = new Set(Object.values(data.planets).filter((p) => p.systemId === 'calder').map((p) => p.techTier));
    const ok = [1, 2, 3].some((t) => tiers.has(t as 1 | 2 | 3));
    expect(seen((d) => base({ day: 10 + d })).has('old-chart-seller')).toBe(ok);
    const high = Object.values(data.planets).find((p) => p.techTier >= 4)!;
    const onlyHigh = Object.values(data.planets).filter((p) => p.systemId === high.systemId).every((p) => p.techTier >= 4);
    if (onlyHigh) expect(seen((d) => base({ day: 10 + d, systemId: high.systemId })).has('old-chart-seller')).toBe(false);
  });

  it('honours systems, requiresFlag and notFlag', () => {
    expect(seen((d) => base({ day: 10 + d })).has('pearl-diver')).toBe(false);
    expect(seen((d) => base({ day: 10 + d, systemId: 'hushwater', flags: ['enc:long-patience'] })).has('pearl-diver')).toBe(true);
    const sk = (flags: string[]) => (d: number) => base({ day: 10 + d, systemId: 'skerry', flags });
    expect(seen(sk([])).has('survey-beacon')).toBe(false);
    expect(seen(sk(['survey-rumour'])).has('survey-beacon')).toBe(true);
    expect(seen(sk(['survey-rumour', HIDDEN_LANE_FLAG])).has('survey-beacon')).toBe(false);
  });

  it('never repeats a once template', () => {
    const w = (d: number) => base({ day: 10 + d, systemId: 'hushwater', flags: ['enc:long-patience'] });
    expect(seen(w).has('long-patience')).toBe(false);
    const w2 = (d: number) => base({ day: 10 + d, systemId: 'skerry', flags: ['survey-rumour', 'enc:survey-beacon'] });
    expect(seen(w2).has('survey-beacon')).toBe(false);
  });

  it('guarantees survey-beacon in Skerry with the rumour, ignoring chance and the not-twice rule', () => {
    for (let d = 1; d < 50; d++) {
      const w = base({ day: d, systemId: 'skerry', flags: ['survey-rumour'], lastEncounterDay: d - 1 });
      expect(rollEncounter(w, data, { guideActive: false })?.id).toBe('survey-beacon');
    }
  });

  it('guarantees long-patience on arrival in Hushwater until its flag is set', () => {
    for (let d = 1; d < 50; d++) {
      const w = base({ day: d, systemId: 'hushwater', lastEncounterDay: d - 1 });
      expect(rollEncounter(w, data, { guideActive: false })?.id).toBe('long-patience');
    }
    const done = base({ systemId: 'hushwater', flags: ['enc:long-patience'], lastEncounterDay: 9 });
    expect(rollEncounter(done, data, { guideActive: false })).toBeNull();
  });
});

describe('choiceBlock', () => {
  it('blocks on credits, cargo space and fuel needs', () => {
    expect(choiceBlock(base({ credits: 399 }), data, choiceOf('cheap-goods-pedlar', 0), 'cheap-goods-pedlar')).toBe('credits');
    expect(choiceBlock(base({ credits: 400 }), data, choiceOf('cheap-goods-pedlar', 0), 'cheap-goods-pedlar')).toBeNull();
    const full = base({ cargo: { food: cargoFree(base(), data) } });
    expect(choiceBlock(full, data, choiceOf('cargo-drift', 0), 'cargo-drift')).toBe('cargoSpace');
    const dry = base();
    dry.ship = { ...dry.ship, fuel: 39 };
    expect(choiceBlock(dry, data, choiceOf('fuel-starved-hauler', 0), 'fuel-starved-hauler')).toBe('fuel');
  });

  it('fuel choice disabled when short: fuel left must cover one jump', () => {
    const per = data.config.fuelPerJump;
    const give = { label: 'g', outcomes: [{ type: 'fuel' as const, n: -20 }] };
    const w = base();
    w.ship = { ...w.ship, fuel: 20 + per - 1 };
    expect(choiceBlock(w, data, give, 't')).toBe('fuel');
    w.ship = { ...w.ship, fuel: 20 + per };
    expect(choiceBlock(w, data, give, 't')).toBeNull();
    w.ship = { ...w.ship, fuel: 0 };
    expect(choiceBlock(w, data, { label: 'x', outcomes: [{ type: 'fuel', n: 5 }] }, 't')).toBeNull();
  });
});

describe('mission blocks', () => {
  const ferry = () => choiceOf('stranded-passenger', 0);
  const filler = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      id: `x${i}`, typeId: 'delivery', originId: 'halcyon', destId: 'vanterre', tons: 0, passengers: 0, pay: 1,
      paidUpfront: false, deadlineDay: null, title: 't', description: '', cargoName: 'x',
    }));

  it('is open with an empty log, blocked with a full one', () => {
    expect(choiceBlock(base(), data, ferry(), 'stranded-passenger')).toBeNull();
    expect(choiceBlock(base({ missions: filler(8) }), data, ferry(), 'stranded-passenger')).toBe('missions');
  });

  it('is blocked when there are no free berths', () => {
    const w = base({ missions: filler(1).map((m) => ({ ...m, passengers: 99 })) });
    expect(choiceBlock(w, data, ferry(), 'stranded-passenger')).toBe('missions');
  });

  it('is blocked when there is nowhere to go', () => {
    const w = base({ known: [base().systemId] });
    const d = def({ choices: [{ label: 'a', outcomes: [{ type: 'mission', missionType: 'delivery' }] }] });
    expect(choiceBlock(w, data, d.choices[0], 'none')).toBe('missions');
  });

  it('agrees with applyChoice: a blocked choice adds no mission', () => {
    const w = base({ missions: filler(8) });
    expect(applyChoice(w, data, enc('stranded-passenger'), 0, ctx).missions).toHaveLength(0);
  });

  it('has text for every block reason', () => {
    for (const k of ['fuel', 'credits', 'cargoSpace', 'missions'] as const) expect(ENCOUNTER_BLOCK_TEXT[k].length).toBeGreaterThan(0);
  });

  it('throws on an out-of-range choice', () => {
    expect(() => applyChoice(base(), data, enc('lost-parcel'), 5, ctx)).toThrow(/no choice/);
  });
});

describe('applyChoice', () => {
  it('credits', () => {
    const r = applyChoice(base({ credits: 1000 }), data, enc('salvage-derelict'), 1, ctx);
    expect(r.world.credits).toBe(1350);
    expect(r.messages).toHaveLength(1);
    expect(r.world.lastEncounterDay).toBe(10);
  });

  it('cargo is capped at the free space', () => {
    const w = base();
    const free = cargoFree(w, data);
    const r = applyChoice({ ...w, cargo: { food: free - 3 } }, data, enc('cargo-drift'), 0, ctx);
    expect(r.world.cargo.industrial).toBe(3);
    expect(cargoFree(r.world, data)).toBe(0);
    const none = applyChoice({ ...w, cargo: { food: free } }, data, enc('cargo-drift'), 0, ctx);
    expect(none.world.cargo.industrial).toBeUndefined();
  });

  it('fuel is clamped between 0 and capacity', () => {
    const w = base();
    w.ship = { ...w.ship, fuel: 5 };
    const d = def({ choices: [{ label: 'a', outcomes: [{ type: 'fuel', n: -50 }] }, { label: 'b', outcomes: [{ type: 'fuel', n: 9999 }] }] });
    expect(applyChoice(w, data, d, 0, ctx).world.ship.fuel).toBe(0);
    expect(applyChoice(w, data, d, 1, ctx).world.ship.fuel).toBe(data.ships[w.shipId].fuelCapacity);
  });

  it('reveal by jumps charts nearby systems; by names charts those', () => {
    const w = base();
    const r = applyChoice(w, data, enc('old-chart-seller'), 0, ctx);
    expect(r.world.known.length).toBeGreaterThan(w.known.length);
    expect(r.world.credits).toBe(w.credits - 300);
    const target = Object.keys(data.systems).find((id) => !w.known.includes(id) && !data.systems[id].hidden)!;
    const d = def({ choices: [{ label: 'a', outcomes: [{ type: 'reveal', systems: [target] }] }] });
    const r2 = applyChoice(w, data, d, 0, ctx);
    expect(r2.world.known).toContain(target);
    expect(r2.world.seen).not.toContain(target);
  });

  it('mission outcome adds a mission from the existing generator', () => {
    const w = base();
    const r = applyChoice(w, data, enc('stranded-passenger'), 0, ctx);
    expect(r.missions).toHaveLength(1);
    expect(r.world.missions).toEqual([r.missions[0]]);
    const m = r.missions[0];
    expect(m.typeId).toBe('ferry');
    expect(w.known).toContain(data.planets[m.destId].systemId);
    expect(r.messages).toHaveLength(1);
  });

  it('mission with toSystem goes to that system first port', () => {
    const d = def({ choices: [{ label: 'a', outcomes: [{ type: 'mission', missionType: 'delivery', toSystem: 'tessaly' }] }] });
    const r = applyChoice(base(), data, d, 0, ctx);
    expect(r.missions[0].destId).toBe('vanterre');
  });

  it('rumour adds a filled note; message is returned filled', () => {
    const r = applyChoice(base(), data, enc('rumour-broadcast'), 0, ctx);
    expect(r.world.notes[0].text).toContain('Calder');
    expect(r.world.notes[0].text).not.toContain('{');
    const m = applyChoice(base(), data, enc('empty-derelict'), 0, ctx);
    expect(m.messages).toEqual(['Nothing but a folded blanket and a pencil stub. You take neither and feel faintly respectful.']);
  });

  it('flag outcome sets the flag; the hidden lane flag charts Hushwater at once', () => {
    const w = base({ systemId: 'skerry', flags: ['survey-rumour'] });
    expect(w.seen).not.toContain('hushwater');
    const r = applyChoice(w, data, enc('survey-beacon'), 0, ctx);
    expect(hasFlag(r.world, HIDDEN_LANE_FLAG)).toBe(true);
    expect(r.world.seen).toContain('hushwater');
    expect(hasFlag(r.world, 'enc:survey-beacon')).toBe(true);
  });

  it('once templates get enc:<id> only for a choice with a real outcome', () => {
    const w = base({ systemId: 'skerry', flags: ['survey-rumour'] });
    const decline = applyChoice(w, data, enc('survey-beacon'), 1, ctx);
    expect(hasFlag(decline.world, 'enc:survey-beacon')).toBe(false);
    expect(decline.world.lastEncounterDay).toBe(10);
    const r = applyChoice(base(), data, enc('salvage-derelict'), 1, ctx);
    expect(r.world.flags.some((f) => f.startsWith('enc:'))).toBe(false);
  });

  it('does not mutate the input world', () => {
    const w = base({ credits: 1000 });
    const copy = JSON.parse(JSON.stringify(w));
    applyChoice(w, data, enc('salvage-derelict'), 1, ctx);
    expect(w).toEqual(copy);
  });
});

describe('fillText', () => {
  it('replaces {ship}, {system} and {pilot}', () => {
    expect(fillText('{ship} in {system}, hi {pilot}; {ship}.', { ship: 'A', system: 'B', pilot: 'C' })).toBe('A in B, hi C; A.');
  });
});

describe('choiceBlock flag gate', () => {
  const gated = { label: 'g', needs: { flag: 'some-favour' }, outcomes: [] };
  it('blocks a choice until the flag is set', () => {
    expect(choiceBlock(base(), data, gated, 't')).toBe('flag');
    expect(choiceBlock(base({ flags: ['some-favour'] }), data, gated, 't')).toBeNull();
    expect(ENCOUNTER_BLOCK_TEXT.flag).toBeTruthy();
  });
});
