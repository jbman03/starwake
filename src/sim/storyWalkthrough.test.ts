import { describe, expect, it } from 'vitest';
import { testData } from '../data/testData';
import { applyChoice, choiceBlock } from './encounters';
import { storyKit } from './storyTestKit';
import { lanesOf } from './galaxy';
import { shipQuote } from './shipyard';
import { buyOutfit, outfitBuyCheck } from './outfitter';
import { standingOf } from './standing';
import {
  acceptStory,
  advanceStory,
  answerStoryHail,
  checkStoryDeadlines,
  currentStep,
  storyHailAt,
  storyOffersAt,
} from './storyMissions';
import type { WorldState } from './types';
import { newWorld } from './world';

const data = testData();

const { take, run, choose } = storyKit(data);

const done = (w: WorldState, id: string) => expect(w.story.done).toContain(id);

/** Plays the whole shared arc, then both side chains, picking the sides' choices. */
function playArc(side: 'concord' | 'reach') {
  let w: WorldState = { ...newWorld(data, 11), day: 2, credits: 0 };

  // M1 Lights Out on the Rim: scan the dead lantern at Skerry.
  w = take(w, 'halcyon', 'm1-lights-out');
  expect(storyOffersAt(w, data, 'halcyon').map((d) => d.id)).not.toContain('m2-second-opinion');
  w = run(w, { kind: 'site', missionId: 'm1-lights-out' });
  done(w, 'm1-lights-out');
  expect(w.credits).toBe(4000);
  expect(w.flags).toContain('lanterns-1');

  // M2 A Second Opinion: a 1 t core fragment to Lastlight inside 8 days.
  w = { ...w, day: 3 };
  expect(storyOffersAt(w, data, 'concordance').map((d) => d.id)).toContain('m2-second-opinion');
  w = take(w, 'halcyon', 'm2-second-opinion');
  expect(w.missions.reduce((n, m) => n + m.tons, 0)).toBe(1);
  expect(w.story.active[0].deadlineDay).toBe(3 + 8);
  w = { ...w, day: 6 };
  w = run(w, { kind: 'landed', planetId: 'lastlight-beacon' });
  done(w, 'm2-second-opinion');
  expect(w.credits).toBe(9000);
  expect(w.notes.map((n) => n.text).join(' ')).toMatch(/cut/);
  expect(w.missions).toEqual([]);

  // M3 Low Tide: the Lastlight bar sends the pilot to Brackwater.
  w = take(w, 'lastlight-beacon', 'm3-low-tide');
  w = { ...w, systemId: 'brackwater' };
  expect(currentStep(w, data, 'm3-low-tide')?.kind).toBe('meet');
  if (side === 'concord') {
    w = choose(w, 'm3-low-tide', 'Pay'); // 5,000 cr
    expect(w.credits).toBe(4000);
  } else {
    w = { ...w, cargo: { food: 10 } };
    w = choose(w, 'm3-low-tide', 'Trade');
    expect(w.cargo.food ?? 0).toBe(0);
    expect(w.credits).toBe(9000);
  }
  done(w, 'm3-low-tide');
  expect(w.flags).toContain('dimming-lane');
  expect(w.known).toContain('gloam');
  expect(lanesOf(data, 'oxbow', w.flags)).toContain('gloam');
  w = { ...w, credits: 2000 };

  // M4 Past the Charts: a hail on entering Gloam, then the choice.
  w = { ...w, systemId: 'gloam' };
  expect(storyHailAt(w, data, 'gloam')?.id).toBe('m4-past-the-charts');
  expect(storyHailAt(w, data, 'oxbow')).toBeNull();
  w = answerStoryHail(w, data, 'm4-past-the-charts').world;
  expect(currentStep(w, data, 'm4-past-the-charts')?.kind).toBe('find'); // the arrival counted as "go to Gloam"
  expect(storyHailAt(w, data, 'gloam')).toBeNull();
  w = run(w, { kind: 'site', missionId: 'm4-past-the-charts' });
  expect(currentStep(w, data, 'm4-past-the-charts')?.kind).toBe('meet');
  w = choose(w, 'm4-past-the-charts', side === 'concord' ? 'Give the evidence' : 'Sell the charts');
  done(w, 'm4-past-the-charts');
  expect(w.credits).toBe(8000);

  // The side chains run alongside.
  w = { ...w, day: 20 };
  w = take(w, 'lastlight-beacon', 's1-missing-courier');
  w = run(
    w,
    { kind: 'landed', planetId: 'vesk-outpost' },
    { kind: 'site', missionId: 's1-missing-courier' },
    { kind: 'landed', planetId: 'lastlight-beacon' },
  );
  done(w, 's1-missing-courier');
  expect(w.credits).toBe(13000);
  w = take(w, 'corvana-works', 's2-surveyors-charts');
  expect(outfitBuyCheck(w, data, 'corvana-works', 'surveyors-folio')).toEqual({ ok: false, reason: 'locked' });
  w = run(
    w,
    { kind: 'site', missionId: 's2-surveyors-charts' },
    { kind: 'site', missionId: 's2-surveyors-charts' },
    { kind: 'landed', planetId: 'corvana-works' },
  );
  done(w, 's2-surveyors-charts');
  expect(w.flags).toContain('folio-unlocked');
  return w;
}

describe('story walk-through', () => {
  it('plays the shared arc and both chains, choosing Concord', () => {
    const w = playArc('concord');
    expect(w.flags).toContain('side-concord');
    expect(w.flags).not.toContain('side-reach');
    expect(standingOf(w, 'concord')).toBe('friend');
    expect(standingOf(w, 'free-reach')).toBe('cool');
    expect(w.notes.map((n) => n.text).join(' ')).toContain('Concordance');
  });

  it('plays the shared arc and both chains, choosing the Free Reach', () => {
    const w = playArc('reach');
    expect(w.flags).toContain('side-reach');
    expect(w.flags).not.toContain('side-concord');
    expect(standingOf(w, 'free-reach')).toBe('friend');
    expect(standingOf(w, 'concord')).toBe('cool');
    expect(w.notes.map((n) => n.text).join(' ')).toContain('Wrenhold');
  });

  it("the Surveyor's Folio is sold once, at Corvana, after the chain", () => {
    const w = { ...playArc('concord'), credits: 50000 };
    expect(outfitBuyCheck(w, data, 'corvana-works', 'surveyors-folio')).toEqual({ ok: true });
    expect(outfitBuyCheck(w, data, 'wrenhold', 'surveyors-folio')).toEqual({ ok: false, reason: 'notSold' });
    const bought = buyOutfit(w, data, 'corvana-works', 'surveyors-folio').world;
    expect(bought.known.length).toBeGreaterThan(w.known.length);
    expect(outfitBuyCheck(bought, data, 'corvana-works', 'surveyors-folio')).toEqual({ ok: false, reason: 'gone' });
  });

  it('M3: the bluff needs food in the hold, the trade needs 10 t, the payment needs 5,000 cr', () => {
    const step = data.story['m3-low-tide'].steps[0];
    if (step.kind !== 'meet') throw new Error('M3 is a meet');
    const [pay, trade, bluff] = step.card.choices;
    const w = { ...newWorld(data, 1), credits: 100, cargo: {} };
    expect(choiceBlock(w, data, pay, 'x')).toBe('credits');
    expect(choiceBlock(w, data, trade, 'x')).toBe('goods');
    expect(choiceBlock(w, data, bluff, 'x')).toBe('goods');
    expect(choiceBlock({ ...w, cargo: { food: 3 } }, data, trade, 'x')).toBe('goods');
    expect(choiceBlock({ ...w, cargo: { food: 3 } }, data, bluff, 'x')).toBeNull();
  });

  it('M2 returns to the Halcyon bar the day after a missed deadline, cargo lost', () => {
    let w: WorldState = { ...newWorld(data, 3), day: 3, flags: ['lanterns-1'] };
    w = acceptStory(w, data, 'm2-second-opinion');
    w = checkStoryDeadlines({ ...w, day: 12 }, data).world;
    expect(w.story.active).toEqual([]);
    expect(w.missions).toEqual([]);
    expect(storyOffersAt({ ...w, day: 13 }, data, 'halcyon').map((d) => d.id)).toContain('m2-second-opinion');
  });
});

/**
 * Credits a pilot holds after the whole walk: 15,000 (M1-M4) + the arc + 45,000 (S1-S8), less the 5,000 the Concord
 * pilot pays at M3. Concord arc 61,000; Reach arc 62,000 (the R3 advance is repaid in full, so it nets to R3's 12,000).
 */
const EXPECTED_CREDITS = { concord: 116000, reach: 122000 } as const;

const ARC = {
  concord: {
    port: 'concordance',
    ids: ['c1-lane-engineers', 'c2-lantern-cores', 'c3-three-lanterns', 'c4-brams-surrender', 'c5-the-charter', 'c6-escort-the-liner', 'c7-the-ceremony'],
    ports: {} as Record<string, string>,
    hull: 'lantern-tender',
    doneFlag: 'concord-done',
  },
  reach: {
    port: 'wrenhold',
    ids: ['r1-lane-charts', 'r2-settler-delegates', 'r3-back-pay', 'r4-waylights', 'r5-the-cordon', 'r6-bring-ama-reed', 'r7-the-signing'],
    ports: { 'r2-settler-delegates': 'cairn-rest', 'r6-bring-ama-reed': 'reeds-anchor' } as Record<string, string>,
    hull: 'freewind',
    doneFlag: 'reach-done',
  },
} as const;

/** The bar where `id` is offered (its first listed port); a hail mission has none. */
const offerPort = (id: string): string => data.story[id].offer.ports?.[0] ?? '';

/**
 * A fresh pilot plays M1 to M4, the side's whole arc, then every side chain, one mission at a time,
 * a day apart, picking the side's choices. Returns the world after the last mission.
 */
function fullWalk(side: 'concord' | 'reach'): WorldState {
  const kit = storyKit(data);
  const arc = ARC[side];
  const picks: Record<string, string> =
    side === 'concord'
      ? { 'm3-low-tide': 'Pay', 'm4-past-the-charts': 'Give the evidence' }
      : { 'm3-low-tide': 'Trade', 'm4-past-the-charts': 'Sell the charts', 'r3-back-pay': 'Broker', 'r5-the-cordon': 'Take the quiet' };
  let w: WorldState = { ...newWorld(data, 21), day: 2, credits: 0 };
  const play = (id: string) => {
    w = kit.play({ ...w, day: w.day + 1 }, offerPort(id), id, picks);
    expect(w.story.done, `${id} done`).toContain(id);
    expect(w.missions, `${id} leaves nothing in the hold`).toEqual([]);
  };

  for (const id of ['m1-lights-out', 'm2-second-opinion', 'm3-low-tide', 'm4-past-the-charts']) play(id);
  expect(w.flags).toContain(`side-${side}`);
  expect(w.flags).not.toContain(`side-${side === 'concord' ? 'reach' : 'concord'}`);

  // The Reach hull is not for sale until the arc is done.
  expect(shipQuote({ ...w, credits: 999999 }, data, arc.port, arc.hull).check).toEqual({ ok: false, reason: 'locked' });
  for (const id of arc.ids) play(id);
  expect(w.flags).toContain(arc.doneFlag);

  // Hushwater and the Long Patience come from the survey-ship encounters (survey-rumour is set directly: it comes from a bar rumour).
  w = { ...w, flags: [...w.flags, 'survey-rumour'] };
  w = applyChoice(w, data, data.encounters['survey-beacon'], 0, { npcName: '' }).world;
  w = applyChoice(w, data, data.encounters['long-patience'], 0, { npcName: '' }).world;
  expect(w.flags).toEqual(expect.arrayContaining(['hushwater-lane', 'survey-claim']));

  const chains = Object.values(data.story).filter((d) => d.arc === 'side');
  for (const d of chains) {
    const id = d.id;
    if (id === 's4-two-houses') picks[id] = 'Side with the Marlows';
    if (id === 's8-last-lightkeeper') picks[id] = 'Offer';
    play(id);
  }
  return w;
}

describe('full story walk-through, one pilot per side', () => {
  for (const side of ['concord', 'reach'] as const) {
    it(`plays M1-M4, the whole ${side} arc and every side chain, then buys the ${ARC[side].hull}`, () => {
      const w = fullWalk(side);
      const arc = ARC[side];
      for (const d of Object.values(data.story)) {
        const other = d.arc === 'concord' || d.arc === 'reach' ? d.arc !== side : false;
        if (other) expect(w.story.done, `${d.id} belongs to the other side`).not.toContain(d.id);
        else expect(w.story.done, `${d.id} done`).toContain(d.id);
      }
      expect(w.story.active).toEqual([]);
      expect(w.story.failed).toEqual([]);
      for (const f of ['folio-unlocked', 'house-rack-unlocked', 'cold-hold-unlocked', 'keepers-lens-unlocked']) expect(w.flags, f).toContain(f);
      expect(Math.abs(w.credits - EXPECTED_CREDITS[side]), `final credits ${w.credits}`).toBeLessThanOrEqual(2000);
      expect(shipQuote({ ...w, credits: 999999 }, data, arc.port, arc.hull).check).toEqual({ ok: true });
    });
  }
});
