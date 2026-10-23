import { describe, expect, it } from 'vitest';
import { testData } from '../data/testData';
import { choiceBlock } from './encounters';
import { storyKit } from './storyTestKit';
import { hopDistance } from './galaxy';
import { abandonStory, checkStoryDeadlines, currentStep, storyOffersAt, type StoryEvent } from './storyMissions';
import type { WorldState } from './types';
import { advanceDays, newWorld } from './world';

const data = testData();

const start = (): WorldState => ({ ...newWorld(data, 9), day: 10, credits: 0 });
const offered = (w: WorldState, port: string) => storyOffersAt(w, data, port).map((d) => d.id);

const { take, run, choose } = storyKit(data);

const landed = (planetId: string): StoryEvent => ({ kind: 'landed', planetId });

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

  it('each leg message points at the port where the next leg is offered', () => {
    for (let i = 0; i < legs.length - 1; i++) {
      const done = data.story[legs[i].id];
      const nextPort = data.story[legs[i + 1].id].offer.ports?.[0];
      expect(nextPort, legs[i].id).toBe(legs[i].to);
      const text = done.onComplete.filter((o) => o.type === 'message').map((o) => (o as { text: string }).text).join(' ');
      // The next leg is offered in the bar at the port where this one ends, so the message says "here".
      expect(text, legs[i].id).toMatch(/bar here/);
    }
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
    expect(w.credits).toBe(12000);
  });
});

describe('S6 Echoes of the Long Patience', () => {
  const ready = (): WorldState => ({ ...start(), flags: ['survey-claim', 'hushwater-lane'] });

  it('is offered at Skerry Light only once the claim and the Hushwater lane are known', () => {
    expect(offered(start(), 'skerry-light')).not.toContain('s6-long-patience');
    expect(offered({ ...start(), flags: ['survey-claim'] }, 'skerry-light')).not.toContain('s6-long-patience');
    expect(offered({ ...start(), flags: ['hushwater-lane'] }, 'skerry-light')).not.toContain('s6-long-patience');
    expect(offered(ready(), 'skerry-light')).toContain('s6-long-patience');
    expect(offered(ready(), 'lastlight-beacon')).not.toContain('s6-long-patience');
  });

  it('scans Hushwater, lands at Skerry Light, then pays and adds a rumour', () => {
    let w = take(ready(), 'skerry-light', 's6-long-patience');
    expect(currentStep(w, data, 's6-long-patience')?.kind).toBe('scan');
    w = run(w, { kind: 'site', missionId: 's6-long-patience' });
    expect(currentStep(w, data, 's6-long-patience')?.kind).toBe('land');
    expect(w.credits).toBe(0);
    w = run(w, landed('skerry-light'));
    expect(w.story.done).toContain('s6-long-patience');
    expect(w.credits).toBe(4000);
    expect(w.notes.length).toBeGreaterThan(0);
  });
});

describe('S7 The Doctor\'s Rounds', () => {
  const id = 's7-doctors-rounds';
  const stops = ['vesk-outpost', 'mirren-hollow', 'brackwater'];

  it('is offered at Lastlight Beacon', () => {
    expect(offered(start(), 'lastlight-beacon')).toContain(id);
  });

  it('delivers the clinic crates to three fringe ports, 6 to 8 days apiece, each within reach', () => {
    const def = data.story[id];
    const steps = def.steps.filter((s) => s.kind === 'deliver');
    expect(steps.map((s) => s.planet)).toEqual(stops);
    let from = data.planets['lastlight-beacon'].systemId;
    for (const s of steps) {
      expect(s.cargo.name.toLowerCase()).toContain('clinic crates');
      expect(s.deadlineDays).toBeGreaterThanOrEqual(6);
      expect(s.deadlineDays).toBeLessThanOrEqual(8);
      const planet = data.planets[s.planet];
      expect(planet.techTier === 1 || data.systems[planet.systemId].government === 'independent', s.planet).toBe(true);
      const hops = hopDistance(data, from, planet.systemId, []);
      expect(hops, `${s.planet} is reachable in time`).toBeLessThanOrEqual((s.deadlineDays ?? 0) / 2);
      from = planet.systemId;
    }
  });

  it('completes: each stop takes its crates, the last pays', () => {
    let w = take(start(), 'lastlight-beacon', id);
    const held = () => w.missions.reduce((n, m) => n + m.tons, 0);
    const total = held();
    expect(total).toBeGreaterThan(0);
    expect(w.missions.every((m) => m.cargoName.toLowerCase().includes('clinic crates'))).toBe(true);
    w = run(w, landed(stops[0]));
    expect(held()).toBeLessThan(total);
    w = run(w, landed(stops[1]));
    w = run(w, landed(stops[2]));
    expect(w.story.done).toContain(id);
    expect(w.missions).toEqual([]);
    expect(w.credits).toBeGreaterThan(0);
  });

  it('fails when a deadline is missed: cargo is lost and it is not offered again', () => {
    let w = take(start(), 'lastlight-beacon', id);
    const step = currentStep(w, data, id);
    if (step?.kind !== 'deliver') throw new Error('expected a deliver step');
    w = { ...w, day: w.day + (step.deadlineDays ?? 0) };
    expect(checkStoryDeadlines(w, data).world.story.active.length).toBe(1);
    w = checkStoryDeadlines({ ...w, day: w.day + 1 }, data).world;
    expect(w.story.failed).toContain(id);
    expect(w.story.active).toEqual([]);
    expect(w.missions).toEqual([]);
    expect(offered(w, 'lastlight-beacon')).not.toContain(id);
  });

  it("fails on a later stop's deadline too, stepping real days", () => {
    let w = take(start(), 'lastlight-beacon', id);
    w = run(w, landed('vesk-outpost'));
    const step = currentStep(w, data, id);
    if (step?.kind !== 'deliver') throw new Error('expected a deliver step');
    w = advanceDays(w, data, step.deadlineDays ?? 0).world;
    expect(w.story.active.length).toBe(1);
    w = advanceDays(w, data, 1).world;
    expect(w.story.failed).toContain(id);
    expect(w.story.active).toEqual([]);
    expect(w.missions).toEqual([]);
    expect(offered(w, 'lastlight-beacon')).not.toContain(id);
  });

  it('can be abandoned, dropping the crates', () => {
    let w = take(start(), 'lastlight-beacon', id);
    w = abandonStory(w, data, id);
    expect(w.story.active).toEqual([]);
    expect(w.missions).toEqual([]);
    expect(w.story.failed).not.toContain(id);
  });
});

describe('S8 The Last Lightkeeper', () => {
  const id = 's8-last-lightkeeper';
  const ready = (): WorldState => ({ ...start(), flags: ['dimming-lane'] });

  it('is offered at a Dimming bar once the lane is known', () => {
    expect(offered(start(), 'slagwater')).not.toContain(id);
    expect(offered(ready(), 'slagwater')).toContain(id);
  });

  it('finds the lantern, meets the keeper, lands at Reed\'s Anchor and unlocks the Keeper\'s Lens', () => {
    let w = take(ready(), 'slagwater', id);
    expect(currentStep(w, data, id)?.kind).toBe('find');
    w = run(w, { kind: 'site', missionId: id });
    expect(currentStep(w, data, id)?.kind).toBe('meet');
    w = choose(w, id, 'Offer');
    expect(currentStep(w, data, id)?.kind).toBe('land');
    expect(w.flags).not.toContain('keepers-lens-unlocked');
    w = run(w, landed('reeds-anchor'));
    expect(w.story.done).toContain(id);
    expect(w.flags).toContain('keepers-lens-unlocked');
  });

  it('every step lies on a real route', () => {
    const steps = data.story[id].steps;
    const sys = steps.map((s) => ('system' in s ? s.system : data.planets[s.planet].systemId));
    const open = ['dimming-lane'];
    let from = data.planets['slagwater'].systemId;
    for (const s of sys) {
      expect(hopDistance(data, from, s, open), `${from} to ${s}`).toBeLessThanOrEqual(3);
      from = s;
    }
  });
});

describe('story step sites match their labels', () => {
  it('a scan or find step is in the system its label or text names', () => {
    for (const def of Object.values(data.story))
      for (const st of def.steps) {
        if (st.kind !== 'scan' && st.kind !== 'find') continue;
        const name = data.systems[st.system].name;
        const named = Object.values(data.systems).filter((s) => `${st.site.label} ${st.text}`.includes(s.name));
        if (named.length) expect(named.map((s) => s.name), `${def.id}: ${st.site.label}`).toContain(name);
      }
  });

  it('C3 and R4 scan Pallow', () => {
    const sys = (id: string) => data.story[id].steps.filter((s) => s.kind === 'scan').map((s) => 'system' in s && s.system);
    expect(sys('c3-three-lanterns')).toContain('pallow');
    expect(sys('r4-waylights')).toContain('pallow');
  });
});

describe('side-job details', () => {
  it('S4 meet ship name covers both houses', () => {
    const meet = data.story['s4-two-houses'].steps.find((s) => s.kind === 'meet');
    expect(meet && meet.kind === 'meet' && meet.ship.name).toBe('Marlow and Teague haulers');
  });
  it('unique cargo outfits beat the plain pod per unit of space', () => {
    const cargo = (id: string) => (data.outfits[id].effect as { cargo: number }).cargo;
    const pod = data.outfits['cargo-pod'];
    for (const [id, tons] of [['house-rack', 10], ['cold-hold', 16]] as const) {
      const o = data.outfits[id];
      expect(cargo(id), id).toBe(tons);
      expect(cargo(id) / o.space, id).toBeGreaterThan(cargo('cargo-pod') / pod.space);
    }
  });
});
