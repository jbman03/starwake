import type { ArcDef, GameData, StoryMissionDef } from '../data/schemas';
import { testData } from '../data/testData';

/** Test data with two fixture arcs, alpha and beta, each with a bar mission at Halcyon (beta also hails in Calder). */
const base = testData();
const arc = (id: string, over: Partial<ArcDef> = {}): ArcDef => ({
  id, title: id === 'alpha' ? 'Alpha Arc' : 'Beta Arc', government: 'concord', blurb: 'B.',
  entry: { mission: `${id}-1`, lead: `${id} waits at Halcyon.` },
  ranks: [{ title: 'Ensign', points: 0 }, { title: 'Lieutenant', points: 20 }, { title: 'Commander', points: 50 }],
  legacy: { text: 'P.' }, ...over,
});
const m1 = base.story['m1-lights-out'];
const mission = (id: string, arcId: string, over: Partial<StoryMissionDef> = {}): StoryMissionDef => ({
  ...m1, id, arc: arcId, title: id, offer: { where: 'bar', ports: ['halcyon'] }, ...over,
});
export const twoArcs = (): GameData => ({
  ...base,
  arcs: { alpha: arc('alpha'), beta: arc('beta') },
  story: {
    ...base.story,
    'alpha-1': mission('alpha-1', 'alpha'),
    'beta-1': mission('beta-1', 'beta'),
    'beta-hail': mission('beta-hail', 'beta', { offer: { where: 'hail', systems: ['calder'] } }),
  },
});


/** A side mission whose one step is a decide card on landing at Merrow: "Keep it" (commit) or "Let it go". */
export const decideMission = (): StoryMissionDef => ({
  ...m1,
  id: 'dec-1',
  arc: 'side',
  title: 'A Hard Call',
  offer: { where: 'bar', ports: ['halcyon'] },
  steps: [
    {
      kind: 'decide',
      planet: 'merrow',
      text: 'Land at Merrow and decide.',
      card: {
        title: 'The Call',
        text: 'Someone has to decide.',
        choices: [
          { label: 'Keep it', commit: true, outcomes: [{ type: 'flag', flag: 'kept-it' }] },
          { label: 'Let it go', outcomes: [{ type: 'flag', flag: 'let-it-go' }] },
        ],
      },
    },
  ],
  onComplete: [{ type: 'credits', n: 100 }],
});
