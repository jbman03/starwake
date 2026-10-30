import { describe, expect, it } from 'vitest';
import { testData } from '../data/testData';
import { rumor, SURVEY_RUMOUR } from './economy';
import { applyChoice, rollEncounter } from './encounters';
import { HIDDEN_LANE_FLAG, lanesOf, routeBetween } from './galaxy';
import { buyShip, shipQuote } from './shipyard';
import { addNote, hasFlag, setFlag } from './story';
import type { WorldState } from './types';
import { jumpFixedSec, newWorld, stepWorld } from './world';

const w0 = newWorld(testData(), 1);

describe('story helpers', () => {
  it('setFlag is idempotent and hasFlag reads it', () => {
    expect(hasFlag(w0, 'a')).toBe(false);
    const w = setFlag(setFlag(w0, 'a'), 'a');
    expect(w.flags).toEqual(['a']);
    expect(hasFlag(w, 'a')).toBe(true);
  });

  it('addNote puts the newest first and dedupes the same text', () => {
    let w = addNote({ ...w0, day: 1 }, 'one');
    w = addNote({ ...w, day: 2 }, 'two');
    w = addNote({ ...w, day: 3 }, 'one');
    expect(w.notes).toEqual([{ day: 2, text: 'two' }, { day: 1, text: 'one' }]);
  });

  it('addNote caps the list at 20, dropping the oldest', () => {
    let w = w0;
    for (let i = 0; i < 25; i++) w = addNote(w, `n${i}`);
    expect(w.notes).toHaveLength(20);
    expect(w.notes[0].text).toBe('n24');
    expect(w.notes[19].text).toBe('n5');
  });
});

describe('the survey-ship thread', () => {
  const data = testData();
  const npc = { npcName: 'x' };
  const rich = (over: Partial<WorldState>): WorldState => ({ ...newWorld(data, 5), credits: 80_000, day: 20, ...over });

  it('runs from rumour to beacon, lane, derelict, claim, quote and a single purchase', () => {
    // The rumour: find a day it shows, then note it as the mission computer does.
    let w = rich({ day: 5 });
    while (rumor(w, data, 'vanterre') !== SURVEY_RUMOUR) w = { ...w, day: w.day + 1 };
    w = addNote(setFlag(w, 'survey-rumour'), SURVEY_RUMOUR);
    expect(rumor(w, data, 'vanterre')).not.toBe(SURVEY_RUMOUR);

    // Skerry: the beacon is guaranteed; following it opens the hidden lane.
    w = { ...w, systemId: 'skerry', lastEncounterDay: null };
    const beacon = rollEncounter(w, data, { guideActive: false });
    expect(beacon?.id).toBe('survey-beacon');
    w = applyChoice(w, data, beacon!, 0, npc).world;
    expect(hasFlag(w, HIDDEN_LANE_FLAG)).toBe(true);
    expect(lanesOf(data, 'skerry', w.flags)).toContain('hushwater');
    expect(w.seen).toContain('hushwater');
    const route = routeBetween(data, 'skerry', 'hushwater', () => true, w.flags);
    expect(route).toEqual(['hushwater']);

    // Hushwater: the derelict. Taking her log claims the hull and leaves a note naming the yard.
    w = { ...w, systemId: 'hushwater', lastEncounterDay: null };
    const wreck = rollEncounter(w, data, { guideActive: false });
    expect(wreck?.id).toBe('long-patience');
    w = applyChoice(w, data, wreck!, 0, npc).world;
    expect(hasFlag(w, 'survey-claim')).toBe(true);
    expect(w.notes[0].text).toBe('The Free Reach yards at Wrenhold can restore the Long Patience.');

    // The yard at Wrenhold: ok at 60,000, then owned.
    const q = shipQuote(w, data, 'wrenhold', 'patience');
    expect(q).toMatchObject({ price: 60000, check: { ok: true } });
    const bought = buyShip(w, data, 'wrenhold', 'patience').world;
    expect(bought.shipId).toBe('patience');
    expect(shipQuote(bought, data, 'wrenhold', 'patience').check).toEqual({ ok: false, reason: 'owned' });
    // Swap away: the one-off hull can never be bought again.
    const away = buyShip({ ...bought, credits: 500_000 }, data, 'wrenhold', 'shuttle');
    expect(shipQuote(away.world, data, 'wrenhold', 'patience').check).toEqual({ ok: false, reason: 'gone' });
  });

  it('stripping the wreck pays 6000 and never unlocks the hull', () => {
    const w0 = rich({ systemId: 'hushwater', credits: 100_000 });
    const w = applyChoice(w0, data, data.encounters['long-patience'], 1, npc).world;
    expect(w.credits).toBe(106_000);
    expect(hasFlag(w, 'survey-stripped')).toBe(true);
    expect(hasFlag(w, 'survey-claim')).toBe(false);
    expect(shipQuote(w, data, 'wrenhold', 'patience').check).toEqual({ ok: false, reason: 'locked' });
  });

  it('is sold only at Wrenhold', () => {
    const w = setFlag(rich({}), 'survey-claim');
    for (const p of Object.values(data.planets).filter((p) => p.id !== 'wrenhold')) {
      expect(shipQuote(w, data, p.id, 'patience').check).toEqual({ ok: false, reason: 'notSold' });
    }
  });

  it('charts two jumps on every arrival once she is flown', () => {
    const w0 = rich({ systemId: 'oxbow', shipId: 'patience', known: ['oxbow'], seen: [], jump: { toSystemId: 'redwater', phase: 'align', t: 0 } });
    // One step long enough for every phase, align at its longest included.
    const whole = jumpFixedSec(data) + data.config.jump.alignMaxSec;
    const w = stepWorld(w0, data, { pressed: new Set(), held: new Set() } as never, whole, { autoLandOnArrival: false }).world;
    expect(w.systemId).toBe('redwater');
    expect(w.jump).toBeNull();
    for (const id of ['redwater', 'skerry', 'saltmarsh', 'oxbow', 'cinderfall', 'brackwater', 'dunmore']) expect(w.known).toContain(id);
    const plain = stepWorld({ ...w0, shipId: 'shuttle' }, data, { pressed: new Set(), held: new Set() } as never, whole, { autoLandOnArrival: false }).world;
    expect(plain.known).not.toContain('brackwater');
  });
});
