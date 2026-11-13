import { describe, expect, it } from 'vitest';
import { testData } from '../data/testData';
import { arcRank, chosenArc } from './arcs';
import { choiceBlock } from './encounters';
import { applyGalaxy } from './galaxyOverlay';
import { legalStatus } from './law';
import { leads } from './leads';
import { storyKit } from './storyTestKit';
import type { WorldState } from './types';
import { newWorld } from './world';

const data = testData();
const kit = storyKit(data);
const PORTS: Record<string, string> = {
  'rr1-free-hand': 'dunmore-crossing', 'rr2-charters': 'redwater-sound', 'rr3-picket-captain': 'hollis-landing',
  'rr4-ferrymans-cargo': 'wrenhold', 'rr5-price-of-lanterns': 'thistledown', 'rr6-open-the-lanes': 'wrenhold', 'rr7-free-compact': 'wrenhold',
  'n1-commission': 'halcyon', 'n2-picket': 'vanterre', 'n3-convoy': 'picket-station', 'n4-ledger': 'lamplight-yards',
  'n5-cold-cores': 'corvana-works', 'n6l-hold-the-line': 'concordance', 'n7l-the-commons': 'picket-station',
  'n6x-running-dark': 'dunmore-crossing', 'n7x-lantern-fire': 'wrenhold',
};
const RISING_OPEN = ['rr1-free-hand', 'rr2-charters', 'rr3-picket-captain', 'rr4-ferrymans-cargo', 'rr5-price-of-lanterns'] as const;

/** Play missions in order with a lead before each; returns the world after the last. */
function walk(path: readonly string[], picks: Record<string, string>): WorldState {
  let w: WorldState = { ...newWorld(data, 13), credits: 20000 };
  for (const id of path) {
    expect(leads(w, data).length, `a lead before ${id}`).toBeGreaterThan(0);
    w = kit.play(w, PORTS[id], id, picks);
    expect(w.story.done, `${id} done`).toContain(id);
  }
  return w;
}

describe('Free Reach Rising arc', () => {
  it('the rising arc: ranks, legacy courier, RR1 commit, RR4 giver is the stranger', () => {
    const arc = data.arcs.rising;
    expect(arc.title).toBe('Free Reach Rising');
    expect(arc.ranks.map((r) => [r.title, r.points])).toEqual([['Hand', 0], ['Agitator', 20], ['Organiser', 50], ['Speaker', 90]]);
    expect(arc.legacy.shipId).toBe('courier');
    expect(arc.entry.mission).toBe('rr1-free-hand');
    expect(data.story['rr1-free-hand'].commit).toBe(true);
    expect(data.story['rr4-ferrymans-cargo'].giver.stranger).toBe(true);
    expect(data.ships['lane-runner'].requiresFlag).toBe('rising-rank-2');
  });

  it('rising loyal: RR1–RR7; hollis, minster, corvana Free Reach; Hollis Free Market in the view; 90 points; arcdone:rising', () => {
    const w = walk([...RISING_OPEN, 'rr6-open-the-lanes', 'rr7-free-compact'], { 'rr3-picket-captain': 'Bluff', 'rr5-price-of-lanterns': 'Keep', 'rr6-open-the-lanes': 'Take' });
    expect(chosenArc(w, data)).toBe('rising');
    const view = applyGalaxy(data, w);
    for (const s of ['hollis', 'minster', 'corvana']) expect(view.systems[s].government, s).toBe('free-reach');
    expect(view.planets['hollis-free-market']?.systemId).toBe('hollis');
    expect(w.arcPoints.rising).toBe(90);
    expect(arcRank(w, data, 'rising')).toBe(3);
    expect(w.flags).toEqual(expect.arrayContaining(['arcdone:rising', 'rising-done']));
  });

  it('Reach→Navy defector: RR1–RR5 defect, then N6L, N7L; chosenArc navy; arcPoints.navy 65; Hunted by the Reach; arcdone:navy', () => {
    const w = walk([...RISING_OPEN, 'n6l-hold-the-line', 'n7l-the-commons'], { 'rr3-picket-captain': 'Run', 'rr5-price-of-lanterns': 'Take it to the Navy', 'n7l-the-commons': 'Accept' });
    expect(chosenArc(w, data)).toBe('navy');
    expect(w.arcPoints.navy).toBe(65);
    expect(legalStatus(w, data, 'free-reach')).toBe('hunted');
    expect(w.flags).toContain('arcdone:navy');
    expect(w.flags).not.toContain('arcdone:rising');
  });

  it('Navy→Reach defector: N1–N5 expose, then N6X, N7X, RR6, RR7; chosenArc rising; arcPoints.rising 105; arcdone:rising and not arcdone:navy', () => {
    const w = walk(['n1-commission', 'n2-picket', 'n3-convoy', 'n4-ledger', 'n5-cold-cores', 'n6x-running-dark', 'n7x-lantern-fire', 'rr6-open-the-lanes', 'rr7-free-compact'], {
      'n3-convoy': 'Wave', 'n5-cold-cores': 'Expose', 'rr6-open-the-lanes': 'Take',
    });
    expect(chosenArc(w, data)).toBe('rising');
    expect(w.arcPoints.rising).toBe(105);
    expect(w.flags).toContain('arcdone:rising');
    expect(w.flags).not.toContain('arcdone:navy');
    const view = applyGalaxy(data, w);
    expect(view.planets['freehold-light']).toBeDefined();
    expect(view.planets['hollis-free-market']).toBeDefined();
  });

  it('each RR3 choice leads on to RR4', () => {
    for (const pick of ['Bluff', 'Turn', 'Run']) {
      const w = walk(RISING_OPEN.slice(0, 3), { 'rr3-picket-captain': pick });
      expect(w.flags, pick).toContain('rising-3');
      expect(kit.take(w, 'wrenhold', 'rr4-ferrymans-cargo').story.active.map((a) => a.id)).toContain('rr4-ferrymans-cargo');
    }
  });

  it('the Royce-only defect choice needs rising-royce', () => {
    const step = data.story['rr5-price-of-lanterns'].steps.find((s) => s.kind === 'decide');
    if (step?.kind !== 'decide') throw new Error('RR5 has no decide step');
    const royce = step.card.choices.find((c) => c.needs?.flag === 'rising-royce')!;
    expect(royce).toBeDefined();
    expect(choiceBlock(newWorld(data, 1), data, royce, 'story:rr5-price-of-lanterns')).not.toBeNull();
    const w = walk(RISING_OPEN, { 'rr3-picket-captain': 'Turn', 'rr5-price-of-lanterns': 'Have Ada Royce' });
    expect(chosenArc(w, data)).toBe('navy');
  });
});
