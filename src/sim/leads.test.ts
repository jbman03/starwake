import { describe, expect, it } from 'vitest';
import { formatDate } from './calendar';
import { leads } from './leads';
import { acceptStory } from './storyMissions';
import { newWorld } from './world';
import { decideMission, twoArcs } from './arcsTestKit';

describe('leads', () => {
  const data = twoArcs();
  it('a new pilot has the arc leads and the Lanterns offer', () => {
    const ls = leads({ ...newWorld(data, 1), day: 5 }, data);
    const arcLeads = ls.filter((l) => l.kind === 'arc');
    expect(arcLeads.map((l) => l.text)).toEqual(['alpha waits at Halcyon.', 'beta waits at Halcyon.']);
    expect(arcLeads[0].why).toBe('Story arc: Alpha Arc. Taking it closes the other arcs.');
    expect(arcLeads[0].systemId).toBe('calder');
    expect(ls.some((l) => l.kind === 'offer' && l.text.includes('Lights Out on the Rim'))).toBe(true);
    // An arc's entry mission is shown as the arc lead, not again as an offer.
    expect(ls.some((l) => l.kind === 'offer' && l.text.endsWith(': alpha-1'))).toBe(false);
  });

  it("an active mission's lead names its step and system", () => {
    const d = { ...data, story: { ...data.story, 'dec-1': decideMission() } };
    const w = acceptStory(newWorld(d, 1), d, 'dec-1');
    const a = leads(w, d).find((l) => l.kind === 'active')!;
    expect(a.text).toBe('A Hard Call: Land at Merrow and decide.');
    expect(a.why).toBe(`for ${d.story['dec-1'].giver.name}`);
    expect(a.systemId).toBe(d.planets.merrow.systemId);
    expect(leads(w, d)[0].kind).toBe('active');
  });

  it("after choosing an arc, other arcs' leads are gone", () => {
    const w = acceptStory(newWorld(data, 1), data, 'alpha-1');
    expect(leads(w, data).filter((l) => l.kind === 'arc')).toEqual([]);
    expect(leads(w, data).some((l) => l.text.includes('beta'))).toBe(false);
  });

  it('a side chain waiting only on minDay leads with "From <formatted date>"', () => {
    const later = { ...data.story['m1-lights-out'], id: 'later-1', arc: 'side', chain: 'later', title: 'Later Job', offer: { where: 'bar' as const, ports: ['halcyon'], minDay: 30 } };
    const d = { ...data, story: { ...data.story, 'later-1': later } };
    const l = leads(newWorld(d, 1), d).find((x) => x.text.endsWith('Later Job'))!;
    expect(l.kind).toBe('offer');
    expect(l.why).toBe(`From ${formatDate(30, d.config)}`);
  });
});

describe('leads after a decline (cycle 7 part 2)', () => {
  it('a declined arc entry keeps its arc lead that day', async () => {
    const { declineStory } = await import('./storyMissions');
    const data = twoArcs();
    const w = declineStory(newWorld(data, 1), 'alpha-1');
    const lead = leads(w, data).find((l) => l.kind === 'arc' && l.text.startsWith('alpha'));
    expect(lead?.systemId).toBe('calder');
  });
});
