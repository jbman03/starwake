import { describe, expect, it } from 'vitest';
import { testData } from '../data/testData';
import { applyOutcomes, choiceBlock, ENCOUNTER_BLOCK_TEXT } from './encounters';
import { hopDistance } from './galaxy';
import { standingOf } from './standing';
import { shipQuote } from './shipyard';
import {
  acceptStory,
  advanceStory,
  checkStoryDeadlines,
  currentStep,
  storyOffersAt,
  type StoryEvent,
} from './storyMissions';
import type { WorldState } from './types';
import { newWorld } from './world';

const data = testData();

/** A world that has finished M4 on the Free Reach side. */
function afterM4Reach(): WorldState {
  let w: WorldState = { ...newWorld(data, 5), day: 30, credits: 8000 };
  w = applyOutcomes(
    w,
    data,
    [
      { type: 'flag', flag: 'core-cut' },
      { type: 'flag', flag: 'dimming-lane' },
      { type: 'flag', flag: 'side-reach' },
      { type: 'standing', government: 'free-reach', level: 'friend' },
    ],
    'test',
    { npcName: '' },
  ).world;
  const m = ['m1-lights-out', 'm2-second-opinion', 'm3-low-tide', 'm4-past-the-charts'];
  return { ...w, story: { ...w.story, done: m } };
}

const offered = (w: WorldState, port = 'wrenhold') => storyOffersAt(w, data, port).map((d) => d.id);

function take(w: WorldState, id: string, port = 'wrenhold'): WorldState {
  expect(offered(w, port), `${id} is offered at ${port}`).toContain(id);
  const next = acceptStory(w, data, id);
  expect(next.story.active.some((a) => a.id === id)).toBe(true);
  return next;
}

function run(w: WorldState, ...events: StoryEvent[]): WorldState {
  for (const ev of events) {
    const r = advanceStory(w, data, ev);
    expect(r.world, `event ${JSON.stringify(ev)} moved a mission`).not.toBe(w);
    w = r.world;
  }
  return w;
}

const site = (id: string): StoryEvent => ({ kind: 'site', missionId: id });
const landed = (planetId: string): StoryEvent => ({ kind: 'landed', planetId });

function meetCard(w: WorldState, id: string) {
  const step = currentStep(w, data, id);
  if (step?.kind !== 'meet') throw new Error(`${id} is not at a meet`);
  return step.card;
}

/** Play R1 to R3 up to (not including) the R3 card. */
function toR3(w: WorldState): WorldState {
  w = take(w, 'r1-lane-charts');
  w = run(w, landed('skerry-light'));
  w = take(w, 'r2-settler-delegates', 'cairn-rest');
  w = run(w, landed('wrenhold'));
  return take(w, 'r3-back-pay');
}

/** Play from the R3 card, with the given choice, up to just before R5's card. */
function toR5(w: WorldState, choiceIdx: number): WorldState {
  const choice = meetCard(w, 'r3-back-pay').choices[choiceIdx];
  w = run(w, { kind: 'card', missionId: 'r3-back-pay', outcomes: choice.outcomes });
  w = take(w, 'r4-waylights');
  w = run(w, site('r4-waylights'), site('r4-waylights'), site('r4-waylights'));
  return take(w, 'r5-the-cordon');
}

describe('Free Reach arc "Free Lanes"', () => {
  it('is offered one mission at a time, in order', () => {
    expect(offered(afterM4Reach())).toEqual(['r1-lane-charts']);
  });

  it('plays R1 to R7 and unlocks the Freewind runner', () => {
    let w = afterM4Reach();
    const start = w.credits;
    const seenArcs = new Set<string>();
    const watch = () => {
      for (const port of Object.keys(data.planets)) for (const d of storyOffersAt(w, data, port)) seenArcs.add(d.arc);
    };
    watch();

    // The runner is not for sale before the arc is done.
    expect(shipQuote({ ...w, credits: 999999 }, data, 'wrenhold', 'freewind').check).toEqual({ ok: false, reason: 'locked' });

    w = take(w, 'r1-lane-charts');
    expect(w.missions.reduce((n, m) => n + m.tons, 0)).toBe(2);
    w = run(w, landed('skerry-light'));
    expect(w.credits).toBe(start + 10000);
    expect(w.missions).toEqual([]);
    watch();

    w = take(w, 'r2-settler-delegates', 'cairn-rest');
    expect(w.missions.reduce((n, m) => n + m.passengers, 0)).toBe(4);
    expect(w.story.active[0].deadlineDay).toBe(w.day + 12);
    w = run(w, landed('wrenhold'));
    expect(w.credits).toBe(start + 20000);
    watch();

    w = take(w, 'r3-back-pay');
    const card = meetCard(w, 'r3-back-pay');
    expect(card.choices).toHaveLength(2);
    const broker = card.choices[0];
    expect(broker.needs?.credits).toBe(4000);
    expect(choiceBlock(w, data, broker, 'story:r3')).toBeNull();
    w = run(w, { kind: 'card', missionId: 'r3-back-pay', outcomes: broker.outcomes });
    expect(w.credits).toBe(start + 32000); // the 4,000 advance is repaid in full
    expect(w.flags).toContain('salvagers-paid');
    watch();

    w = take(w, 'r4-waylights');
    w = run(w, site('r4-waylights'), site('r4-waylights'), site('r4-waylights'));
    expect(w.credits).toBe(start + 44000);
    watch();

    w = take(w, 'r5-the-cordon');
    const cordon = meetCard(w, 'r5-the-cordon');
    const quiet = cordon.choices[1];
    expect(choiceBlock(w, data, quiet, 'story:r5')).toBeNull();
    w = run(w, { kind: 'card', missionId: 'r5-the-cordon', outcomes: quiet.outcomes });
    expect(w.credits).toBe(start + 50000);
    watch();

    w = take(w, 'r6-bring-ama-reed', 'reeds-anchor');
    expect(w.missions.reduce((n, m) => n + m.passengers, 0)).toBe(1);
    w = run(w, landed('wrenhold'));
    expect(w.credits).toBe(start + 56000);
    watch();

    w = take(w, 'r7-the-signing');
    w = run(w, landed('redwater-sound'), landed('wrenhold'));
    expect(w.credits).toBe(start + 68000);
    expect(w.flags).toContain('reach-done');
    expect(standingOf(w, 'free-reach')).toBe('friend');
    expect(w.notes.map((n) => n.text).join(' ')).toContain('Freewind');
    for (const id of ['r1-lane-charts', 'r2-settler-delegates', 'r3-back-pay', 'r4-waylights', 'r5-the-cordon', 'r6-bring-ama-reed', 'r7-the-signing'])
      expect(w.story.done).toContain(id);
    for (const port of Object.keys(data.planets)) expect(storyOffersAt(w, data, port).filter((d) => d.arc === 'reach')).toEqual([]);

    expect(shipQuote({ ...w, credits: 999999 }, data, 'wrenhold', 'freewind').check).toEqual({ ok: true });
    expect(seenArcs.has('concord')).toBe(false);
  });

  it('is never offered to a pilot who sided with the Concord', () => {
    const w = afterM4Reach();
    const concord = { ...w, flags: [...w.flags.filter((f) => f !== 'side-reach'), 'side-concord'] };
    for (const port of Object.keys(data.planets)) expect(storyOffersAt(concord, data, port).filter((d) => d.arc === 'reach')).toEqual([]);
    const both = { ...w, flags: [...w.flags, 'side-concord'] };
    for (const port of Object.keys(data.planets)) expect(storyOffersAt(both, data, port).filter((d) => d.arc === 'reach')).toEqual([]);
  });

  it('R2 is feasible: Cairn Rest is two jumps from Wrenhold, well inside 12 days', () => {
    const w = afterM4Reach();
    const from = data.planets['cairn-rest'].systemId;
    expect(hopDistance(data, from, 'wrenhold', w.flags)).toBe(2);
    const step = data.story['r2-settler-delegates'].steps[0];
    expect(step.kind === 'ferry' ? step.deadlineDays : undefined).toBe(12);
  });

  it('a late R2 returns to the Cairn Rest bar the next day and the arc continues once redone', () => {
    let w = take(afterM4Reach(), 'r1-lane-charts');
    w = run(w, landed('skerry-light'));
    w = take(w, 'r2-settler-delegates', 'cairn-rest');
    const late = w.day + 13;
    w = checkStoryDeadlines({ ...w, day: late }, data).world;
    expect(w.missions).toEqual([]);
    expect(w.story.active).toEqual([]);
    expect(w.story.failed).toEqual([]);
    expect(offered(w, 'cairn-rest')).toEqual([]); // put off for the rest of today
    w = { ...w, day: late + 1 };
    expect(offered(w, 'cairn-rest')).toEqual(['r2-settler-delegates']);
    w = take(w, 'r2-settler-delegates', 'cairn-rest');
    w = run(w, landed('wrenhold'));
    expect(offered(w)).toEqual(['r3-back-pay']);
  });

  it('R3: promising a share also ends it, costs nothing, and leaves the quiet route shut', () => {
    const w0 = toR3(afterM4Reach());
    const promise = meetCard(w0, 'r3-back-pay').choices[1];
    expect(promise.needs).toBeUndefined();
    expect(promise.outcomes.some((o) => o.type === 'credits')).toBe(false);
    const w = run(w0, { kind: 'card', missionId: 'r3-back-pay', outcomes: promise.outcomes });
    expect(w.story.done).toContain('r3-back-pay');
    expect(w.flags).not.toContain('salvagers-paid');
    expect(w.flags).toContain('reach-3');
    expect(w.credits).toBe(8000 + 10000 + 10000 + 12000);
  });

  it('R3: the broker choice is blocked with under 4,000 cr', () => {
    const w = toR3(afterM4Reach());
    const broker = meetCard(w, 'r3-back-pay').choices[0];
    expect(choiceBlock({ ...w, credits: 3999 }, data, broker, 'story:r3')).toBe('credits');
    expect(choiceBlock({ ...w, credits: 4000 }, data, broker, 'story:r3')).toBeNull();
  });

  it('R5: the quiet route needs salvagers-paid; the long route burns fuel but keeps a jump in reserve', () => {
    // Promised, not paid: the quiet route is shut, the long route is open.
    const promised = toR5(toR3(afterM4Reach()), 1);
    const card = meetCard(promised, 'r5-the-cordon');
    const [long, quiet] = card.choices;
    expect(choiceBlock(promised, data, quiet, 'story:r5')).toBe('flag');
    expect(ENCOUNTER_BLOCK_TEXT.flag).toBeTruthy();
    expect(choiceBlock(promised, data, long, 'story:r5')).toBeNull();
    const fuelCost = long.outcomes.reduce((n, o) => n + (o.type === 'fuel' ? o.n : 0), 0);
    expect(fuelCost).toBeLessThan(0);
    // Too little fuel to spare.
    const dry = { ...promised, ship: { ...promised.ship, fuel: -fuelCost + data.config.fuelPerJump - 1 } };
    expect(choiceBlock(dry, data, long, 'story:r5')).toBe('fuel');
    const w = run(promised, { kind: 'card', missionId: 'r5-the-cordon', outcomes: long.outcomes });
    expect(w.ship.fuel).toBe(promised.ship.fuel + fuelCost);
    expect(w.story.done).toContain('r5-the-cordon');
    expect(w.flags).toContain('reach-5');
    expect(data.story['r5-the-cordon'].combatLater).toBeTruthy();

    // Paid: the quiet route is open and costs no fuel.
    const paid = toR5(toR3(afterM4Reach()), 0);
    expect(choiceBlock(paid, data, quiet, 'story:r5')).toBeNull();
    expect(quiet.outcomes.some((o) => o.type === 'fuel')).toBe(false);
  });
});
