import { describe, expect, it } from 'vitest';
import { testData } from '../data/testData';
import { applyOutcomes, choiceBlock } from './encounters';
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

/** A world that has finished M4 on the Concord side. */
function afterM4Concord(): WorldState {
  let w: WorldState = { ...newWorld(data, 5), day: 30, credits: 8000 };
  w = applyOutcomes(
    w,
    data,
    [
      { type: 'flag', flag: 'lanterns-1' },
      { type: 'flag', flag: 'core-cut' },
      { type: 'flag', flag: 'dimming-lane' },
      { type: 'flag', flag: 'side-concord' },
      { type: 'standing', government: 'concord', level: 'friend' },
    ],
    'test',
    { npcName: '' },
  ).world;
  const m = ['m1-lights-out', 'm2-second-opinion', 'm3-low-tide', 'm4-past-the-charts'];
  return { ...w, story: { ...w.story, done: m } };
}

const offered = (w: WorldState, port = 'concordance') => storyOffersAt(w, data, port).map((d) => d.id);

function take(w: WorldState, id: string): WorldState {
  expect(offered(w), `${id} is offered at Concordance`).toContain(id);
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

describe('Concord arc "Relight"', () => {
  it('is offered one mission at a time, in order', () => {
    const w = afterM4Concord();
    expect(offered(w)).toEqual(['c1-lane-engineers']);
  });

  it('plays C1 to C7 and unlocks the Lantern-tender', () => {
    let w = afterM4Concord();
    const start = w.credits;
    const seenArcs = new Set<string>();
    const watch = () => {
      for (const port of Object.keys(data.planets)) for (const d of storyOffersAt(w, data, port)) seenArcs.add(d.arc);
    };
    watch();

    // The tender is not for sale before the arc is done.
    expect(shipQuote({ ...w, credits: 999999 }, data, 'concordance', 'lantern-tender').check).toEqual({ ok: false, reason: 'locked' });

    w = take(w, 'c1-lane-engineers');
    expect(w.missions.reduce((n, m) => n + m.passengers, 0)).toBe(3);
    w = run(w, landed('reeds-anchor'));
    expect(w.credits).toBe(start + 6000);
    expect(w.missions).toEqual([]);
    watch();

    w = take(w, 'c2-lantern-cores');
    expect(w.missions.reduce((n, m) => n + m.tons, 0)).toBe(6);
    expect(w.story.active[0].deadlineDay).toBe(w.day + 10);
    w = run(w, landed('slagwater'));
    expect(w.credits).toBe(start + 13000);
    watch();

    w = take(w, 'c3-three-lanterns');
    w = run(w, site('c3-three-lanterns'), site('c3-three-lanterns'), site('c3-three-lanterns'));
    expect(w.credits).toBe(start + 22000);
    expect(w.flags).toContain('lanterns-relit');
    watch();

    w = take(w, 'c4-brams-surrender');
    const step = currentStep(w, data, 'c4-brams-surrender');
    if (step?.kind !== 'meet') throw new Error('C4 is a meet');
    expect(step.card.choices.length).toBeGreaterThanOrEqual(2);
    const choice = step.card.choices[0];
    expect(choiceBlock(w, data, choice, 'story:c4')).toBeNull();
    w = run(w, { kind: 'card', missionId: 'c4-brams-surrender', outcomes: choice.outcomes });
    expect(w.credits).toBe(start + 28000);
    watch();

    w = take(w, 'c5-the-charter');
    expect(w.missions.reduce((n, m) => n + m.tons, 0)).toBe(1);
    w = run(w, landed('reeds-anchor'));
    expect(w.credits).toBe(start + 34000);
    watch();

    w = take(w, 'c6-escort-the-liner');
    w = run(w, site('c6-escort-the-liner'), site('c6-escort-the-liner'), landed('reeds-anchor'));
    expect(w.credits).toBe(start + 42000);
    watch();

    w = take(w, 'c7-the-ceremony');
    w = run(w, landed('concordance'));
    expect(w.credits).toBe(start + 52000);
    expect(w.flags).toContain('concord-done');
    expect(standingOf(w, 'concord')).toBe('friend');
    expect(w.notes.map((n) => n.text).join(' ')).toContain('Lantern-tender');
    for (const id of ['c1-lane-engineers', 'c2-lantern-cores', 'c3-three-lanterns', 'c4-brams-surrender', 'c5-the-charter', 'c6-escort-the-liner', 'c7-the-ceremony'])
      expect(w.story.done).toContain(id);
    expect(offered(w)).toEqual([]);

    expect(shipQuote({ ...w, credits: 999999 }, data, 'concordance', 'lantern-tender').check).toEqual({ ok: true });
    expect(seenArcs.has('reach')).toBe(false);
  });

  it('is never offered to a pilot who sided with the Free Reach', () => {
    const w = afterM4Concord();
    const reach = { ...w, flags: [...w.flags.filter((f) => f !== 'side-concord'), 'side-reach'] };
    for (const port of Object.keys(data.planets)) expect(storyOffersAt(reach, data, port).filter((d) => d.arc === 'concord')).toEqual([]);
    const both = { ...w, flags: [...w.flags, 'side-reach'] };
    expect(offered(both)).toEqual([]);
  });

  it('a late C2 loses the cores but does not strand the arc', () => {
    let w = take(afterM4Concord(), 'c1-lane-engineers');
    w = run(w, landed('reeds-anchor'));
    w = take(w, 'c2-lantern-cores');
    w = checkStoryDeadlines({ ...w, day: w.day + 11 }, data).world;
    expect(w.missions).toEqual([]);
    expect(offered(w)).toEqual(['c3-three-lanterns']);
  });
});
