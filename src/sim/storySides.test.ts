import { describe, expect, it } from 'vitest';
import { testData } from '../data/testData';
import { choiceBlock } from './encounters';
import { hopDistance } from './galaxy';
import { acceptStory, advanceStory, currentStep, storyOffersAt, type StoryEvent } from './storyMissions';
import type { WorldState } from './types';
import { newWorld } from './world';

const data = testData();

const start = (): WorldState => ({ ...newWorld(data, 9), day: 10, credits: 0 });
const offered = (w: WorldState, port: string) => storyOffersAt(w, data, port).map((d) => d.id);

function take(w: WorldState, port: string, id: string): WorldState {
  expect(offered(w, port), `${id} is offered at ${port}`).toContain(id);
  const next = acceptStory(w, data, id);
  expect(next.story.active.some((a) => a.id === id), `${id} was accepted`).toBe(true);
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

const landed = (planetId: string): StoryEvent => ({ kind: 'landed', planetId });

/** Answer the current meet card with the choice whose label starts with `label`. */
function choose(w: WorldState, id: string, label: string): WorldState {
  const step = currentStep(w, data, id);
  if (step?.kind !== 'meet') throw new Error(`${id} is not at a meet step`);
  const choice = step.card.choices.find((c) => c.label.startsWith(label));
  if (!choice) throw new Error(`no choice "${label}"`);
  expect(choiceBlock(w, data, choice, `story:${id}`), `choice "${label}" is open`).toBeNull();
  return run(w, { kind: 'card', missionId: id, outcomes: choice.outcomes });
}

describe('S3 The Pilgrim Road', () => {
  const legs = [
    { id: 's3-pilgrim-road-1', from: 'hallow', to: 'lastlight-beacon' },
    { id: 's3-pilgrim-road-2', from: 'lastlight-beacon', to: 'skerry-light' },
    { id: 's3-pilgrim-road-3', from: 'skerry-light', to: 'ferrymans-rest' },
    { id: 's3-pilgrim-road-4', from: 'ferrymans-rest', to: 'hollis-landing' },
  ];

  it('offers only the first leg until it is done, and one leg at a time', () => {
    const w = start();
    expect(offered(w, 'hallow')).toContain(legs[0].id);
    for (const l of legs.slice(1)) expect(offered(w, l.from), l.id).not.toContain(l.id);
  });

  it('carries the pilgrims through all four lamps, 3,000 cr a leg', () => {
    let w = start();
    for (const [i, l] of legs.entries()) {
      w = take(w, l.from, l.id);
      expect(w.missions.reduce((n, m) => n + m.passengers, 0)).toBe(3);
      // The next leg is not on offer while this one is active.
      if (i < legs.length - 1) expect(offered(w, legs[i + 1].from)).not.toContain(legs[i + 1].id);
      w = run(w, landed(l.to));
      expect(w.story.done).toContain(l.id);
      expect(w.credits).toBe(3000 * (i + 1));
      expect(w.missions).toEqual([]);
    }
    expect(w.notes.some((n) => n.text.includes('four lamps'))).toBe(true);
  });

  it('each lamp is reachable from the last with no hidden lane', () => {
    for (const l of legs) {
      const from = data.planets[l.from].systemId;
      const to = data.planets[l.to].systemId;
      expect(hopDistance(data, from, to, []), `${l.from} to ${l.to}`).toBeLessThanOrEqual(3);
    }
    expect(hopDistance(data, 'minster', data.planets['lastlight-beacon'].systemId, [])).toBe(3);
  });
});

describe('S4 Two Houses', () => {
  const play = (label: string, flag: string, other: string) => {
    let w = start();
    expect(offered(w, 'redwater-sound')).toContain('s4-two-houses');
    w = take(w, 'redwater-sound', 's4-two-houses');
    expect(w.missions.reduce((n, m) => n + m.tons, 0)).toBe(5);
    expect(w.flags).not.toContain('house-rack-unlocked');
    w = run(w, landed('redwater-locks'));
    expect(currentStep(w, data, 's4-two-houses')?.kind).toBe('meet');
    w = choose(w, 's4-two-houses', label);
    expect(w.flags).toContain(flag);
    expect(w.flags).not.toContain(other);
    expect(currentStep(w, data, 's4-two-houses')?.kind).toBe('deliver');
    w = run(w, landed('redwater-sound'));
    expect(w.story.done).toContain('s4-two-houses');
    expect(w.flags).toContain('house-rack-unlocked');
    expect(w.credits).toBe(4000);
    expect(w.missions).toEqual([]);
  };

  it('completes on the Marlow branch', () => play('Side with the Marlows', 'house-marlow', 'house-teague'));
  it('completes on the Teague branch', () => play('Side with the Teagues', 'house-teague', 'house-marlow'));
});

describe('S5 The Collector', () => {
  const stocked = (w: WorldState): WorldState => ({
    ...w,
    cargo: { ...w.cargo, copperwine: 4, glowmoss: 3, 'stillwater-pearl': 2 },
  });

  it('is not offered until the Hushwater lane is known', () => {
    expect(offered(start(), 'quillon-spires')).not.toContain('s5-the-collector');
    expect(offered({ ...start(), flags: ['hushwater-lane'] }, 'quillon-spires')).toContain('s5-the-collector');
  });

  it('takes the three goods and unlocks the Cold Hold', () => {
    let w = take({ ...start(), flags: ['hushwater-lane'] }, 'quillon-spires', 's5-the-collector');
    // A meet whose goods are missing is refused by the card.
    const step = currentStep(w, data, 's5-the-collector');
    if (step?.kind !== 'meet') throw new Error('expected a meet');
    expect(choiceBlock(w, data, step.card.choices[0], 'story:s5')).toBe('goods');

    w = stocked(w);
    w = choose(w, 's5-the-collector', 'Hand over 4 t of Halcyon Copperwine');
    expect(w.cargo.copperwine ?? 0).toBe(0);
    w = choose(w, 's5-the-collector', 'Hand over 3 t of Vesk Glowmoss');
    expect(w.cargo.glowmoss ?? 0).toBe(0);
    w = choose(w, 's5-the-collector', 'Hand over 2 t of Stillwater Pearl');
    expect(w.cargo['stillwater-pearl'] ?? 0).toBe(0);
    expect(w.credits).toBe(9000);
    expect(w.flags).not.toContain('cold-hold-unlocked');

    w = run(w, landed('quillon-spires'));
    expect(w.story.done).toContain('s5-the-collector');
    expect(w.flags).toContain('cold-hold-unlocked');
    expect(w.credits).toBe(14000);
  });
});
