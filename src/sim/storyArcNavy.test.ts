import { describe, expect, it } from 'vitest';
import { testData } from '../data/testData';
import { arcRank, chosenArc } from './arcs';
import { choiceBlock } from './encounters';
import { applyGalaxy } from './galaxyOverlay';
import { legalStatus, landingRefused } from './law';
import { leads } from './leads';
import { storyKit } from './storyTestKit';
import type { WorldState } from './types';
import { newWorld } from './world';

const data = testData();
const kit = storyKit(data);
const NAVY_OPEN = ['n1-commission', 'n2-picket', 'n3-convoy', 'n4-ledger', 'n5-cold-cores'] as const;
const PORTS: Record<string, string> = {
  'n1-commission': 'halcyon', 'n2-picket': 'vanterre', 'n3-convoy': 'picket-station', 'n4-ledger': 'lamplight-yards',
  'n5-cold-cores': 'corvana-works', 'n6l-hold-the-line': 'concordance', 'n7l-the-commons': 'picket-station',
  'n6x-running-dark': 'dunmore-crossing', 'n7x-lantern-fire': 'wrenhold',
};

/** Play the Navy arc in order, with a lead at every step, and return the world after each mission. */
function walk(path: readonly string[], picks: Record<string, string>): WorldState {
  let w: WorldState = { ...newWorld(data, 11), credits: 20000 };
  for (const id of path) {
    expect(leads(w, data).length, `a lead before ${id}`).toBeGreaterThan(0);
    w = kit.play(w, PORTS[id], id, picks);
    expect(w.story.done, `${id} done`).toContain(id);
    expect(leads(w, data).length + (w.flags.includes('navy-done') ? 1 : 0), `a lead after ${id}`).toBeGreaterThan(0);
  }
  return w;
}

describe('Concord Navy arc', () => {
  it('the arc is in the data with its four ranks and a 5,000 cr legacy', () => {
    expect(data.arcs.navy.ranks.map((r) => [r.title, r.points])).toEqual([['Ensign', 0], ['Lieutenant', 20], ['Commander', 50], ['Captain', 90]]);
    expect(data.arcs.navy.legacy.credits).toBe(5000);
    expect(data.story['n1-commission'].commit).toBe(true);
    expect(data.story['n4-ledger'].giver.stranger).toBe(true);
  });

  it('loyal path: N1 to N7L destroying The Commons; brannock, thistle and wrenhold are Concord, the-commons is gone, rank Captain, arcdone:navy', () => {
    const w = walk([...NAVY_OPEN, 'n6l-hold-the-line', 'n7l-the-commons'], { 'n3-convoy': 'Seize', 'n5-cold-cores': 'Keep', 'n7l-the-commons': 'Destroy' });
    expect(chosenArc(w, data)).toBe('navy');
    const view = applyGalaxy(data, w);
    for (const s of ['brannock', 'thistle', 'wrenhold']) expect(view.systems[s].government, s).toBe('concord');
    expect(view.planets['the-commons']).toBeUndefined();
    expect(arcRank(w, data, 'navy')).toBe(3);
    expect(w.arcPoints.navy).toBe(90);
    expect(w.flags).toEqual(expect.arrayContaining(['arcdone:navy', 'navy-done', 'navy-loyal', 'navy-rank-3']));
  });

  it('loyal path, surrender: the-commons stays', () => {
    const w = walk([...NAVY_OPEN, 'n6l-hold-the-line', 'n7l-the-commons'], { 'n3-convoy': 'Escort', 'n5-cold-cores': 'Keep', 'n7l-the-commons': 'Accept' });
    const view = applyGalaxy(data, w);
    expect(view.planets['the-commons']).toBeDefined();
    expect(view.systems.wrenhold.government).toBe('concord');
  });

  it('exposed path: N1 to N7X now carries on into Free Reach Rising; Hunted by the Concord; hollis Free Reach; Freehold Light in the view', () => {
    expect(applyGalaxy(data, newWorld(data, 1)).planets['freehold-light']).toBeUndefined();
    const w = walk([...NAVY_OPEN, 'n6x-running-dark', 'n7x-lantern-fire'], { 'n3-convoy': 'Wave', 'n5-cold-cores': 'Expose' });
    expect(legalStatus(w, data, 'concord')).toBe('hunted');
    const view = applyGalaxy(data, w);
    expect(view.systems.hollis.government).toBe('free-reach');
    expect(view.planets['freehold-light']?.systemId).toBe('hollis');
    expect(landingRefused(w, view, 'freehold-light')).toBe(false);
    expect(chosenArc(w, data)).toBe('rising');
    expect(w.flags).toEqual(expect.arrayContaining(['navy-exposed', 'rising-defector', 'rising-line']));
    expect(w.flags).not.toContain('arcdone:navy');
    expect(w.arcPoints).toEqual({ navy: 50, rising: 65 });
  });

  it('each of the three convoy choices leads on to N4', () => {
    for (const pick of ['Seize', 'Escort', 'Wave']) {
      const w = walk(NAVY_OPEN.slice(0, 3), { 'n3-convoy': pick });
      expect(w.flags, pick).toContain('navy-3');
      expect(kit.take(w, 'lamplight-yards', 'n4-ledger').story.active.map((a) => a.id)).toContain('n4-ledger');
    }
  });

  it('the mercy-only expose choice needs navy-mercy', () => {
    const step = data.story['n5-cold-cores'].steps.find((s) => s.kind === 'decide');
    if (step?.kind !== 'decide') throw new Error('N5 has no decide step');
    const mercy = step.card.choices.find((c) => c.needs?.flag === 'navy-mercy')!;
    expect(mercy).toBeDefined();
    expect(choiceBlock({ ...newWorld(data, 1), flags: [] }, data, mercy, 'story:n5-cold-cores')).not.toBeNull();
    expect(choiceBlock({ ...newWorld(data, 1), flags: ['navy-mercy'] }, data, mercy, 'story:n5-cold-cores')).toBeNull();
    const w = walk(NAVY_OPEN, { 'n3-convoy': 'Escort', 'n5-cold-cores': 'Hand' });
    expect(w.flags).toContain('navy-exposed');
  });

  it('commit choices: N3 seize, all three N5 choices and N7L destroy carry commit', () => {
    const cards = (id: string) => data.story[id].steps.flatMap((s) => (s.kind === 'meet' || s.kind === 'decide' ? s.card.choices : []));
    expect(cards('n3-convoy').find((c) => c.label.startsWith('Seize'))?.commit).toBe(true);
    expect(cards('n5-cold-cores').every((c) => c.commit)).toBe(true);
    expect(cards('n7l-the-commons').find((c) => c.label.startsWith('Destroy'))?.commit).toBe(true);
  });
});
