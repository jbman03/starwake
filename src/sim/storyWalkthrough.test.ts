import { describe, expect, it } from 'vitest';
import { testData } from '../data/testData';
import { choiceBlock } from './encounters';
import { lanesOf } from './galaxy';
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
  type StoryEvent,
} from './storyMissions';
import type { WorldState } from './types';
import { newWorld } from './world';

const data = testData();

/** Take the mission offered at `port` (it must be on offer there). */
function take(w: WorldState, port: string, id: string): WorldState {
  expect(storyOffersAt(w, data, port).map((d) => d.id), `${id} is offered at ${port}`).toContain(id);
  const next = acceptStory(w, data, id);
  expect(next.story.active.some((a) => a.id === id), `${id} was accepted`).toBe(true);
  return next;
}

/** Feed events in order; every one must move some mission on. */
function run(w: WorldState, ...events: StoryEvent[]): WorldState {
  for (const ev of events) {
    const r = advanceStory(w, data, ev);
    expect(r.world, `event ${JSON.stringify(ev)} moved a mission`).not.toBe(w);
    w = r.world;
  }
  return w;
}

/** Answer the card of the mission's current meet step with the choice whose label starts with `label`. */
function choose(w: WorldState, id: string, label: string): WorldState {
  const step = currentStep(w, data, id);
  if (step?.kind !== 'meet') throw new Error(`${id} is not at a meet step`);
  const idx = step.card.choices.findIndex((c) => c.label.startsWith(label));
  expect(idx, `a choice starting "${label}"`).toBeGreaterThanOrEqual(0);
  const choice = step.card.choices[idx];
  expect(choiceBlock(w, data, choice, `story:${id}`), `choice "${label}" is open`).toBeNull();
  return run(w, { kind: 'card', missionId: id, outcomes: choice.outcomes });
}

const done = (w: WorldState, id: string) => expect(w.story.done).toContain(id);

/** Plays the whole shared arc, then both side chains, picking the sides' choices. */
function playArc(side: 'concord' | 'reach') {
  let w: WorldState = { ...newWorld(data, 11), day: 2, credits: 0 };

  // M1 Lights Out on the Rim: scan the dead lantern at Skerry.
  w = take(w, 'halcyon', 'm1-lights-out');
  expect(storyOffersAt(w, data, 'halcyon').map((d) => d.id)).not.toContain('m2-second-opinion');
  w = run(w, { kind: 'site', missionId: 'm1-lights-out' });
  done(w, 'm1-lights-out');
  expect(w.credits).toBe(3000);
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
  expect(w.credits).toBe(7000);
  expect(w.notes.map((n) => n.text).join(' ')).toMatch(/cut/);
  expect(w.missions).toEqual([]);

  // M3 Low Tide: the Lastlight bar sends the pilot to Brackwater.
  w = take(w, 'lastlight-beacon', 'm3-low-tide');
  w = { ...w, systemId: 'brackwater' };
  expect(currentStep(w, data, 'm3-low-tide')?.kind).toBe('meet');
  if (side === 'concord') {
    w = choose(w, 'm3-low-tide', 'Pay'); // 5,000 cr
    expect(w.credits).toBe(2000);
  } else {
    w = { ...w, cargo: { food: 10 } };
    w = choose(w, 'm3-low-tide', 'Trade');
    expect(w.cargo.food ?? 0).toBe(0);
    expect(w.credits).toBe(7000);
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
