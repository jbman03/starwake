import { describe, expect, it } from 'vitest';
import { testData } from '../data/testData';
import type { GameData, StoryMissionDef } from '../data/schemas';
import { berthsFree, cargoFree, sell } from './cargo';
import { completeAt } from './missions';
import { hasFlag } from './story';
import {
  abandonStory,
  acceptStory,
  advanceStory,
  canAcceptStory,
  checkStoryDeadlines,
  currentStep,
  declineStory,
  nextLead,
  standingOf,
  storyOffersAt,
} from './storyMissions';
import type { WorldState } from './types';
import { newWorld } from './world';

const real = testData();
const card = { title: 'Hail', text: 'A ship hails.', choices: [{ label: 'Talk', outcomes: [] }] };
const mk = (over: Partial<StoryMissionDef> & Pick<StoryMissionDef, 'id' | 'steps'>): StoryMissionDef => ({
  arc: 'side',
  title: `Title ${over.id}`,
  giver: { name: 'Ansel Voss', title: 'Dockmaster' },
  offer: { where: 'bar', ports: ['halcyon'] },
  text: 'offer',
  acceptText: 'ok',
  declinable: true,
  onComplete: [],
  ...over,
});
const m1 = mk({ id: 'm1', arc: 'main', steps: [{ kind: 'go', system: 'tessaly', text: 'Go to Tessaly.' }], onComplete: [{ type: 'flag', flag: 'm1-done' }] });
const m2 = mk({ id: 'm2', arc: 'main', offer: { where: 'bar', ports: ['halcyon'], requires: ['m1-done'] }, steps: [{ kind: 'land', planet: 'vanterre', text: 'Land.' }] });
const side = mk({ id: 's1', steps: [{ kind: 'land', planet: 'merrow', text: 'Land at Merrow.' }] });
const withStory = (...defs: StoryMissionDef[]): GameData => ({ ...real, story: Object.fromEntries(defs.map((d) => [d.id, d])) });
const world = (over: Partial<WorldState> = {}): WorldState => ({ ...newWorld(real, 5), day: 10, ...over });

describe('storyOffersAt', () => {
  it('lists a mission at its port only', () => {
    const d = withStory(side);
    expect(storyOffersAt(world(), d, 'halcyon').map((x) => x.id)).toEqual(['s1']);
    expect(storyOffersAt(world(), d, 'merrow')).toEqual([]);
  });
  it('honours systems', () => {
    const d = withStory(mk({ id: 'sy', offer: { where: 'bar', systems: ['calder'] }, steps: side.steps }));
    expect(storyOffersAt(world(), d, 'merrow')).toHaveLength(1);
    expect(storyOffersAt(world(), d, 'vanterre')).toHaveLength(0);
  });
  it('honours requires, notFlags and minDay', () => {
    const d = withStory(mk({ id: 'c', offer: { where: 'bar', ports: ['halcyon'], requires: ['a'], notFlags: ['b'], minDay: 12 }, steps: side.steps }));
    const ok = world({ day: 12, flags: ['a'] });
    expect(storyOffersAt(ok, d, 'halcyon')).toHaveLength(1);
    expect(storyOffersAt({ ...ok, day: 11 }, d, 'halcyon')).toHaveLength(0);
    expect(storyOffersAt({ ...ok, flags: [] }, d, 'halcyon')).toHaveLength(0);
    expect(storyOffersAt({ ...ok, flags: ['a', 'b'] }, d, 'halcyon')).toHaveLength(0);
  });
  it('honours standing (at least the level asked)', () => {
    const d = withStory(mk({ id: 'st', offer: { where: 'bar', ports: ['halcyon'], standing: { concord: 'friend' } }, steps: side.steps }));
    expect(storyOffersAt(world(), d, 'halcyon')).toHaveLength(0);
    expect(storyOffersAt(world({ standing: { concord: 'cool' } }), d, 'halcyon')).toHaveLength(0);
    expect(storyOffersAt(world({ standing: { concord: 'friend' } }), d, 'halcyon')).toHaveLength(1);
  });
  it('hides active, done and failed missions', () => {
    const d = withStory(side);
    const w = world();
    expect(storyOffersAt(acceptStory(w, d, 's1'), d, 'halcyon')).toHaveLength(0);
    expect(storyOffersAt({ ...w, story: { ...w.story, done: ['s1'] } }, d, 'halcyon')).toHaveLength(0);
    expect(storyOffersAt({ ...w, story: { ...w.story, failed: ['s1'] } }, d, 'halcyon')).toHaveLength(0);
  });
  it('offers the main arc in order: requires must hold and only one main is active', () => {
    const d = withStory(m1, m2);
    let w = world();
    expect(storyOffersAt(w, d, 'halcyon').map((x) => x.id)).toEqual(['m1']);
    w = acceptStory(w, d, 'm1');
    expect(storyOffersAt(w, d, 'halcyon')).toEqual([]);
    w = advanceStory(w, d, { kind: 'arrived', systemId: 'tessaly' }).world;
    expect(storyOffersAt(w, d, 'halcyon').map((x) => x.id)).toEqual(['m2']);
  });
  it('allows one active mission per chain', () => {
    const a = mk({ id: 'ca', chain: 'x', steps: side.steps });
    const b = mk({ id: 'cb', chain: 'x', steps: side.steps });
    const d = withStory(a, b);
    expect(storyOffersAt(acceptStory(world(), d, 'ca'), d, 'halcyon')).toEqual([]);
  });
  it('does not list hail missions at a bar', () => {
    const d = withStory(mk({ id: 'h', offer: { where: 'hail', systems: ['calder'] }, steps: side.steps }));
    expect(storyOffersAt(world(), d, 'halcyon')).toEqual([]);
  });
});

describe('decline', () => {
  it('hides the mission for the rest of the day and offers it again on a later one', () => {
    const d = withStory(m1);
    const w = declineStory(world(), 'm1');
    expect(w.story.declined.some((x) => x.startsWith('m1'))).toBe(true);
    expect(storyOffersAt(w, d, 'halcyon')).toEqual([]);
    expect(storyOffersAt({ ...w, day: 11 }, d, 'halcyon')).toHaveLength(1);
  });
  it('keeps one entry per mission', () => {
    const w = declineStory(declineStory(world(), 'm1'), 'm1');
    expect(w.story.declined).toHaveLength(1);
  });
});

describe('acceptStory and canAcceptStory', () => {
  const hauler = mk({
    id: 'h1',
    steps: [
      { kind: 'deliver', planet: 'merrow', cargo: { name: 'relay cores', tons: 8 }, deadlineDays: 5, text: 'Deliver.' },
      { kind: 'ferry', planet: 'vanterre', passengers: 2, text: 'Ferry.' },
    ],
  });
  const d = withStory(hauler);

  it('loads cargo and passengers for every step still to come and sets the deadline', () => {
    const w = acceptStory(world(), d, 'h1');
    expect(w.story.active).toEqual([{ id: 'h1', step: 0, deadlineDay: 15 }]);
    expect(cargoFree(w, d)).toBe(cargoFree(world(), d) - 8);
    expect(berthsFree(w, d)).toBe(berthsFree(world(), d) - 2);
  });
  it('leaves deadlineDay null when no step has a deadline', () => {
    expect(acceptStory(world(), withStory(side), 's1').story.active[0].deadlineDay).toBeNull();
  });
  it('a full hold blocks acceptance', () => {
    const w = world({ cargo: { food: cargoFree(world(), d) - 7 } });
    expect(canAcceptStory(w, d, 'h1')).toEqual({ ok: false, reason: 'cargo' });
    expect(acceptStory(w, d, 'h1')).toBe(w);
  });
  it('no berths blocks acceptance', () => {
    const w = world();
    const taken = { ...w, missions: [{ id: 'x', typeId: 'ferry', originId: 'halcyon', destId: 'merrow', tons: 0, passengers: berthsFree(w, d) - 1, pay: 1, paidUpfront: false, deadlineDay: null, title: 't', description: 'd', cargoName: 'p' }] };
    expect(canAcceptStory(taken, d, 'h1')).toEqual({ ok: false, reason: 'berths' });
  });
  it('refuses a mission already active', () => {
    const w = acceptStory(world(), d, 'h1');
    expect(canAcceptStory(w, d, 'h1')).toEqual({ ok: false, reason: 'active' });
    expect(acceptStory(w, d, 'h1')).toBe(w);
  });
  it('story cargo cannot be sold and does not complete as a job on landing', () => {
    const w = acceptStory(world(), d, 'h1');
    expect(w.cargo).toEqual({});
    expect(sell(w, d, 'halcyon', 'relay cores', 8).tons).toBe(0);
    expect(completeAt(w, 'merrow').completed).toEqual([]);
  });
});

describe('advanceStory', () => {
  const run = (def: StoryMissionDef, evs: Parameters<typeof advanceStory>[2][]) => {
    const d = withStory(def);
    let w = acceptStory(world(), d, def.id);
    const msgs: string[] = [];
    let completed: string[] = [];
    for (const ev of evs) {
      const r = advanceStory(w, d, ev);
      w = r.world;
      msgs.push(...r.messages);
      completed = [...completed, ...r.completed];
    }
    return { w, d, msgs, completed };
  };

  it('go advances on arrival at its system only', () => {
    const def = mk({ id: 'g', steps: [{ kind: 'go', system: 'tessaly', text: 'a' }, { kind: 'go', system: 'calder', text: 'b' }] });
    expect(run(def, [{ kind: 'arrived', systemId: 'calder' }]).w.story.active[0].step).toBe(0);
    const r = run(def, [{ kind: 'arrived', systemId: 'tessaly' }]);
    expect(r.w.story.active[0].step).toBe(1);
    expect(r.msgs).toEqual(['Title g: b']);
  });
  it('land advances on landing', () => {
    const def = mk({ id: 'l', steps: [{ kind: 'land', planet: 'merrow', text: 'a' }, { kind: 'land', planet: 'vanterre', text: 'b' }] });
    expect(run(def, [{ kind: 'landed', planetId: 'vanterre' }]).w.story.active[0].step).toBe(0);
    expect(run(def, [{ kind: 'landed', planetId: 'merrow' }]).w.story.active[0].step).toBe(1);
  });
  it('deliver and ferry unload their load on landing', () => {
    const def = mk({
      id: 'd',
      steps: [
        { kind: 'deliver', planet: 'merrow', cargo: { name: 'cores', tons: 5 }, text: 'a' },
        { kind: 'ferry', planet: 'vanterre', passengers: 2, text: 'b' },
      ],
    });
    const a = run(def, [{ kind: 'landed', planetId: 'merrow' }]);
    expect(a.w.missions.map((m) => m.tons + m.passengers)).toEqual([2]);
    expect(a.w.story.active[0].step).toBe(1);
    const b = run(def, [{ kind: 'landed', planetId: 'merrow' }, { kind: 'landed', planetId: 'vanterre' }]);
    expect(b.w.missions).toEqual([]);
    expect(b.completed).toEqual(['d']);
  });
  it('scan and find advance on their own mission\'s site event', () => {
    for (const kind of ['scan', 'find'] as const) {
      const def = mk({ id: 'sc', steps: [{ kind, system: 'calder', site: { label: 'Wreck' }, text: 'x' }] });
      expect(run(def, [{ kind: 'site', missionId: 'other' }]).completed).toEqual([]);
      expect(run(def, [{ kind: 'site', missionId: 'sc' }]).completed).toEqual(['sc']);
    }
  });
  it('meet advances on a card event and applies the choice outcomes', () => {
    const def = mk({ id: 'mt', steps: [{ kind: 'meet', system: 'calder', ship: { name: 'Gull', shipId: 'shuttle', government: 'concord' }, card, text: 'x' }] });
    const r = run(def, [{ kind: 'card', missionId: 'mt', outcomes: [{ type: 'credits', n: 70 }, { type: 'flag', flag: 'chose' }] }]);
    expect(r.completed).toEqual(['mt']);
    expect(r.w.credits).toBe(world().credits + 70);
    expect(hasFlag(r.w, 'chose')).toBe(true);
  });
  it('the wrong event does nothing', () => {
    const def = mk({ id: 'w', steps: [{ kind: 'land', planet: 'merrow', text: 'a' }] });
    const d = withStory(def);
    const w = acceptStory(world(), d, 'w');
    expect(advanceStory(w, d, { kind: 'arrived', systemId: 'calder' }).world).toBe(w);
  });
  it('completes: applies onComplete (including standing and unlock), moves the id to done', () => {
    const def = mk({
      id: 'c',
      steps: [{ kind: 'land', planet: 'merrow', text: 'a' }],
      onComplete: [
        { type: 'credits', n: 300 },
        { type: 'standing', government: 'concord', level: 'friend' },
        { type: 'standing', government: 'free-reach', level: 'cool' },
        { type: 'unlock', flag: 'unlock-x' },
        { type: 'message', text: 'Well done.' },
      ],
    });
    const r = run(def, [{ kind: 'landed', planetId: 'merrow' }]);
    expect(r.w.story.active).toEqual([]);
    expect(r.w.story.done).toEqual(['c']);
    expect(r.w.credits).toBe(world().credits + 300);
    expect(standingOf(r.w, 'concord')).toBe('friend');
    expect(standingOf(r.w, 'free-reach')).toBe('cool');
    expect(standingOf(r.w, 'unlit')).toBe('neutral');
    expect(hasFlag(r.w, 'unlock-x')).toBe(true);
    expect(r.msgs).toContain('Well done.');
    expect(r.w.lastEncounterDay).toBeNull();
  });
  it('moves the deadline to the next step\'s and clears a met one', () => {
    const def = mk({
      id: 'dl',
      steps: [
        { kind: 'deliver', planet: 'merrow', cargo: { name: 'c', tons: 1 }, deadlineDays: 4, text: 'a' },
        { kind: 'land', planet: 'vanterre', text: 'b' },
      ],
    });
    const r = run(def, [{ kind: 'landed', planetId: 'merrow' }]);
    expect(r.w.story.active[0]).toEqual({ id: 'dl', step: 1, deadlineDay: null });
  });
  it('is deterministic', () => {
    const def = mk({ id: 'z', steps: [{ kind: 'land', planet: 'merrow', text: 'a' }], onComplete: [{ type: 'credits', n: 5 }] });
    const a = run(def, [{ kind: 'landed', planetId: 'merrow' }]);
    const b = run(def, [{ kind: 'landed', planetId: 'merrow' }]);
    expect(a.w).toEqual(b.w);
  });
});

describe('checkStoryDeadlines', () => {
  const steps: StoryMissionDef['steps'] = [{ kind: 'deliver', planet: 'merrow', cargo: { name: 'c', tons: 3 }, deadlineDays: 2, text: 'a' }];

  it('does nothing before the deadline day passes', () => {
    const d = withStory(mk({ id: 'x', steps }));
    const w = acceptStory(world(), d, 'x');
    expect(checkStoryDeadlines({ ...w, day: 12 }, d).world).toEqual({ ...w, day: 12 });
  });
  it('a missed side deadline fails the mission, applies onFail and drops the cargo', () => {
    const d = withStory(mk({ id: 'x', steps, onFail: [{ type: 'flag', flag: 'x-failed' }] }));
    const w = { ...acceptStory(world(), d, 'x'), day: 13 };
    const r = checkStoryDeadlines(w, d);
    expect(r.world.story.failed).toEqual(['x']);
    expect(r.world.story.active).toEqual([]);
    expect(r.world.missions).toEqual([]);
    expect(hasFlag(r.world, 'x-failed')).toBe(true);
    expect(r.messages.join(' ')).toContain('Mission failed');
  });
  it('a missed main-arc deadline returns the mission to the bar the next day', () => {
    const d = withStory(mk({ id: 'x', arc: 'main', steps, onFail: [{ type: 'flag', flag: 'never' }] }));
    const w = { ...acceptStory(world(), d, 'x'), day: 13 };
    const r = checkStoryDeadlines(w, d);
    expect(r.world.story.failed).toEqual([]);
    expect(r.world.story.active).toEqual([]);
    expect(r.world.missions).toEqual([]);
    expect(hasFlag(r.world, 'never')).toBe(false);
    expect(storyOffersAt(r.world, d, 'halcyon')).toEqual([]);
    expect(storyOffersAt({ ...r.world, day: 14 }, d, 'halcyon').map((x) => x.id)).toEqual(['x']);
    expect(currentStep(acceptStory({ ...r.world, day: 14 }, d, 'x'), d, 'x')).toEqual(steps[0]);
  });
});

describe('abandonStory', () => {
  const steps: StoryMissionDef['steps'] = [{ kind: 'deliver', planet: 'merrow', cargo: { name: 'c', tons: 3 }, text: 'a' }];
  it('drops a side mission and its cargo without failing it', () => {
    const d = withStory(mk({ id: 'x', steps }));
    const r = abandonStory(acceptStory(world(), d, 'x'), d, 'x');
    expect(r.story.active).toEqual([]);
    expect(r.story.failed).toEqual([]);
    expect(r.missions).toEqual([]);
  });
  it('is refused for the main arc', () => {
    const d = withStory(mk({ id: 'x', arc: 'main', steps }));
    const w = acceptStory(world(), d, 'x');
    expect(abandonStory(w, d, 'x')).toBe(w);
  });
});

describe('currentStep', () => {
  it('returns the step the mission is on, or null', () => {
    const d = withStory(m1);
    expect(currentStep(world(), d, 'm1')).toBeNull();
    expect(currentStep(acceptStory(world(), d, 'm1'), d, 'm1')).toEqual(m1.steps[0]);
  });
});

describe('nextLead', () => {
  it('prefers the main arc, then a side offer, then null', () => {
    const lonely = mk({ id: 'sl', offer: { where: 'bar', ports: ['merrow'] }, steps: side.steps });
    const d = withStory(lonely, m1);
    const lead = nextLead(world(), d);
    expect(lead?.portId).toBe('halcyon');
    expect(lead?.text).toBe(`Talk is that Dockmaster Ansel Voss at ${real.planets.halcyon.name} wants a pilot.`);
    const w = acceptStory(world(), d, 'm1');
    expect(nextLead(w, d)?.portId).toBe('merrow');
    expect(nextLead(world(), withStory())).toBeNull();
  });
});

describe('standingOf', () => {
  it('defaults to neutral', () => {
    expect(standingOf(world(), 'concord')).toBe('neutral');
    expect(standingOf(world({ standing: { concord: 'friend' } }), 'concord')).toBe('friend');
  });
});
