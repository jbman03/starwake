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
  'sy1-quiet-cargo': 'merrow', 'sy2-customs': 'lastlight-beacon', 'sy3-customs-cutter': 'lastlight-beacon', 'sy4-silver-run': 'skerry-light',
  'sy5-whose-silver': 'skerry-light', 'sy6-undermarket': 'skerry-light', 'sy7-boss-of-the-rim': 'the-undermarket',
  'rr6-open-the-lanes': 'wrenhold', 'rr7-free-compact': 'wrenhold', 'n6l-hold-the-line': 'concordance', 'n7l-the-commons': 'picket-station',
};
const OPEN = ['sy1-quiet-cargo', 'sy2-customs', 'sy3-customs-cutter', 'sy4-silver-run', 'sy5-whose-silver'] as const;

function walk(path: readonly string[], picks: Record<string, string>): WorldState {
  let w: WorldState = { ...newWorld(data, 17), credits: 20000 };
  for (const id of path) {
    expect(leads(w, data).length, `a lead before ${id}`).toBeGreaterThan(0);
    w = kit.play(w, PORTS[id], id, picks);
    expect(w.story.done, `${id} done`).toContain(id);
  }
  return w;
}

describe('The Syndicate arc', () => {
  it('the syndicate arc: ranks, legacy, SY1 commit, SY4 stranger, nightjar gate', () => {
    const arc = data.arcs.syndicate;
    expect(data.governments.syndicate.color).toBe('#e05fb0');
    expect(arc.ranks.map((r) => [r.title, r.points])).toEqual([['Runner', 0], ['Fixer', 20], ['Underboss', 50], ['Boss', 90]]);
    expect(arc.legacy.credits).toBe(7500);
    expect(data.story['sy1-quiet-cargo'].commit).toBe(true);
    expect(data.story['sy4-silver-run'].giver.stranger).toBe(true);
    expect(data.ships.nightjar.requiresFlag).toBe('syndicate-rank-2');
    expect(data.ships.nightjar.soldAt).toEqual(['the-undermarket']);
  });

  it('syndicate loyal SY1–SY7: vesk, skerry, brackwater Syndicate; The Undermarket open; 90 points; Hunted by the Concord; arcdone:syndicate', () => {
    const w = walk([...OPEN, 'sy6-undermarket', 'sy7-boss-of-the-rim'], { 'sy3-customs-cutter': 'Run', 'sy5-whose-silver': 'Keep', 'sy7-boss-of-the-rim': 'Buy' });
    expect(chosenArc(w, data)).toBe('syndicate');
    const view = applyGalaxy(data, w);
    for (const s of ['vesk', 'skerry', 'brackwater']) expect(view.systems[s].government, s).toBe('syndicate');
    expect(view.planets['the-undermarket']?.systemId).toBe('brackwater');
    expect(w.arcPoints.syndicate).toBe(90);
    expect(arcRank(w, data, 'syndicate')).toBe(3);
    expect(legalStatus(w, data, 'concord')).toBe('hunted');
    expect(w.flags).toEqual(expect.arrayContaining(['arcdone:syndicate', 'syndicate-done']));
  });

  it('Syndicate→Reach: SY1–SY5 sell to the Reach, then RR6, RR7; chosenArc rising; arcdone:rising', () => {
    const w = walk([...OPEN, 'rr6-open-the-lanes', 'rr7-free-compact'], { 'sy5-whose-silver': 'Sell it to the Reach', 'rr6-open-the-lanes': 'Take' });
    expect(chosenArc(w, data)).toBe('rising');
    expect(w.arcPoints.rising).toBe(65);
    expect(legalStatus(w, data, 'syndicate')).toBe('hunted');
    expect(w.flags).toContain('arcdone:rising');
    expect(w.flags).not.toContain('arcdone:syndicate');
  });

  it('Syndicate→Navy via the inspector: SY3 turn her, SY5 Vosk, then N6L, N7L; chosenArc navy; arcdone:navy', () => {
    const w = walk([...OPEN, 'n6l-hold-the-line', 'n7l-the-commons'], { 'sy3-customs-cutter': 'Turn', 'sy5-whose-silver': 'Have Maren Vosk', 'n7l-the-commons': 'Accept' });
    expect(chosenArc(w, data)).toBe('navy');
    expect(w.arcPoints.navy).toBe(65);
    expect(w.flags).toContain('arcdone:navy');
  });

  it('each SY3 choice leads on to SY4', () => {
    for (const pick of ['Turn', 'Run', 'Dump']) {
      const w = walk(OPEN.slice(0, 3), { 'sy3-customs-cutter': pick });
      expect(w.flags, pick).toContain('syndicate-3');
      expect(kit.take(w, 'skerry-light', 'sy4-silver-run').story.active.map((a) => a.id)).toContain('sy4-silver-run');
    }
  });

  it('the inspector-only choice needs syndicate-inspector', () => {
    const step = data.story['sy5-whose-silver'].steps.find((s) => s.kind === 'decide');
    if (step?.kind !== 'decide') throw new Error('SY5 has no decide step');
    const vosk = step.card.choices.find((c) => c.needs?.flag === 'syndicate-inspector')!;
    expect(vosk).toBeDefined();
    expect(choiceBlock(newWorld(data, 1), data, vosk, 'story:sy5-whose-silver')).not.toBeNull();
  });
});
