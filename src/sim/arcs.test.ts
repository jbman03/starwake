import { describe, expect, it } from 'vitest';
import { addArcPoints, arcLocked, arcRank, chosenArc } from './arcs';
import { applyOutcomes } from './encounters';
import { acceptStory, storyHailAt, storyOffersAt } from './storyMissions';
import { newWorld } from './world';
import { twoArcs } from './arcsTestKit';

describe('arc lockout', () => {
  const data = twoArcs();
  it("taking an arc mission sets arc:<id> and hides the other arc's missions from bars, hails and offers", () => {
    const w0 = newWorld(data, 1);
    expect(storyOffersAt(w0, data, 'halcyon').map((d) => d.id)).toEqual(expect.arrayContaining(['alpha-1', 'beta-1']));
    expect(chosenArc(w0, data)).toBeNull();
    const w = acceptStory(w0, data, 'alpha-1');
    expect(w.flags).toContain('arc:alpha');
    expect(chosenArc(w, data)).toBe('alpha');
    expect(arcLocked(w, data, 'beta')).toBe(true);
    expect(arcLocked(w, data, 'alpha')).toBe(false);
    expect(storyOffersAt(w, data, 'halcyon').map((d) => d.id)).not.toContain('beta-1');
    expect(storyHailAt(w, data, 'calder')?.id).not.toBe('beta-hail');
    // Non-arc story is untouched.
    expect(storyOffersAt(w, data, 'halcyon').some((d) => d.arc === 'main')).toBe(storyOffersAt(w0, data, 'halcyon').some((d) => d.arc === 'main'));
  });
});

describe('arc points and ranks', () => {
  const data = twoArcs();
  it('points cross 20 and 50: Lieutenant, then Commander; each flag set once', () => {
    let w = newWorld(data, 1);
    expect(arcRank(w, data, 'alpha')).toBe(0);
    let r = addArcPoints(w, data, 'alpha', 10);
    expect(r.promoted).toBeNull();
    r = addArcPoints(r.world, data, 'alpha', 15);
    expect(r.promoted).toBe('Lieutenant');
    expect(arcRank(r.world, data, 'alpha')).toBe(1);
    expect(r.world.flags.filter((f) => f === 'alpha-rank-1')).toHaveLength(1);
    expect(r.world.notes[0].text).toBe('Promoted to Lieutenant (Alpha Arc)');
    r = addArcPoints(r.world, data, 'alpha', 30);
    expect(r.promoted).toBe('Commander');
    w = r.world;
    expect(w.arcPoints.alpha).toBe(55);
    expect(w.flags).toEqual(expect.arrayContaining(['alpha-rank-1', 'alpha-rank-2']));
  });
  it('the arcPoints outcome promotes with a message; arcDone sets arcdone:<id>', () => {
    const r = applyOutcomes(newWorld(data, 1), data, [{ type: 'arcPoints', arc: 'alpha', n: 20 }, { type: 'arcDone', arc: 'alpha' }], 't', { npcName: '' });
    expect(r.messages).toContain('Promoted to Lieutenant (Alpha Arc).');
    expect(r.world.flags).toContain('arcdone:alpha');
  });
});

describe('switchArc (cycle 7 part 2)', () => {
  const data = twoArcs();
  it('switchArc moves alpha to beta: flags swap, half the points carry, rank flags and the note', async () => {
    const { switchArc } = await import('./arcs');
    let w = acceptStory(newWorld(data, 1), data, 'alpha-1');
    w = addArcPoints(w, data, 'alpha', 50).world;
    const r = switchArc(w, data, 'beta');
    expect(chosenArc(r.world, data)).toBe('beta');
    expect(r.world.flags).not.toContain('arc:alpha');
    expect(r.world.flags).toContain('arc:beta');
    expect(r.world.arcPoints).toEqual({ alpha: 50, beta: 25 });
    expect(r.world.flags).toContain('beta-rank-1');
    expect(r.world.notes.map((n) => n.text)).toContain('You have gone over to Beta Arc.');
  });
  it('switchArc with no arc chosen sets the target and moves nothing', async () => {
    const { switchArc } = await import('./arcs');
    const r = switchArc(newWorld(data, 1), data, 'beta');
    expect(chosenArc(r.world, data)).toBe('beta');
    expect(r.world.arcPoints).toEqual({});
  });
  it('switchArc to the arc already chosen changes nothing', async () => {
    const { switchArc } = await import('./arcs');
    const w = acceptStory(newWorld(data, 1), data, 'alpha-1');
    expect(switchArc(w, data, 'alpha').world).toBe(w);
  });
  it('the switchArc outcome promotes with a message', () => {
    let w = acceptStory(newWorld(data, 1), data, 'alpha-1');
    w = addArcPoints(w, data, 'alpha', 50).world;
    const r = applyOutcomes(w, data, [{ type: 'switchArc', to: 'beta' }], 't', { npcName: '' });
    expect(r.messages).toContain('Promoted to Lieutenant (Beta Arc).');
    expect(chosenArc(r.world, data)).toBe('beta');
  });
  it('acceptStory refuses a mission of a locked arc', () => {
    const w = acceptStory(newWorld(data, 1), data, 'alpha-1');
    expect(acceptStory(w, data, 'beta-1')).toBe(w);
  });
});
