import { expect } from 'vitest';
import type { GameData } from '../data/schemas';
import { choiceBlock } from './encounters';
import { acceptStory, advanceStory, answerStoryHail, currentStep, storyHailAt, storyOffersAt, type StoryEvent } from './storyMissions';
import type { WorldState } from './types';

/** Shared helpers for the story tests: take a mission, feed it events, answer its cards, or play it end to end. */
export function storyKit(data: GameData) {
  /** Take the mission offered at `port` (it must be on offer there). */
  function take(w: WorldState, port: string, id: string): WorldState {
    expect(storyOffersAt(w, data, port).map((d) => d.id), `${id} is offered at ${port}`).toContain(id);
    const next = acceptStory(w, data, id);
    expect(next.story.active.some((a) => a.id === id), `${id} was accepted`).toBe(true);
    return next;
  }

  /** Feed events in order; every one must move some mission on. */
  function run(w: WorldState, ...events: StoryEvent[]): WorldState {
    for (const ev of events) {
      const r = advanceStory(w, data, ev);
      expect(r.world, `event ${JSON.stringify(ev)} moved a mission`).not.toBe(w);
      w = r.world;
    }
    return w;
  }

  /** Answer the card of the mission's current meet step with the choice whose label starts with `label`. */
  function choose(w: WorldState, id: string, label: string): WorldState {
    const step = currentStep(w, data, id);
    if (step?.kind !== 'meet') throw new Error(`${id} is not at a meet step`);
    const choice = step.card.choices.find((c) => c.label.startsWith(label));
    if (!choice) throw new Error(`no choice "${label}"`);
    expect(choiceBlock(w, data, choice, `story:${id}`), `choice "${label}" is open`).toBeNull();
    return run(w, { kind: 'card', missionId: id, outcomes: choice.outcomes });
  }

  /**
   * Take the mission at `port` (a hail mission is answered on arriving in its system) and play every step in order. Meet steps use the choice starting with
   * `picks[id]`, else the first open one; goods a choice asks for are put in the hold first (the walk
   * is about the story rules, not about shopping for them).
   */
  function play(w: WorldState, port: string, id: string, picks: Record<string, string> = {}): WorldState {
    const offer = data.story[id].offer;
    if (offer.where === 'hail') {
      // A hail comes on arriving in its system; answering it counts the arrival for the first step.
      w = { ...w, systemId: offer.systems?.[0] ?? w.systemId };
      expect(storyHailAt(w, data, w.systemId)?.id, `${id} hails in ${w.systemId}`).toBe(id);
      w = answerStoryHail(w, data, id).world;
      expect(w.story.active.some((a) => a.id === id) || w.story.done.includes(id), `${id} was answered`).toBe(true);
    } else w = take(w, port, id);
    for (let guard = 0; w.story.active.some((a) => a.id === id); guard++) {
      expect(guard, `${id} finishes`).toBeLessThan(20);
      const step = currentStep(w, data, id);
      if (!step) throw new Error(`${id} has no current step`);
      switch (step.kind) {
        case 'go':
          w = run(w, { kind: 'arrived', systemId: step.system });
          break;
        case 'land':
        case 'deliver':
        case 'ferry':
          w = run(w, { kind: 'landed', planetId: step.planet });
          break;
        case 'scan':
        case 'find':
          w = run(w, { kind: 'site', missionId: id });
          break;
        case 'meet': {
          const want = picks[id];
          const choice = step.card.choices.find((c) => (want ? c.label.startsWith(want) : true));
          if (!choice) throw new Error(`${id}: no choice "${want}"`);
          if (choice.needs?.cargo) w = { ...w, cargo: { ...w.cargo, [choice.needs.cargo.good]: choice.needs.cargo.tons } };
          expect(choiceBlock(w, data, choice, `story:${id}`), `${id}: choice "${choice.label}" is open`).toBeNull();
          w = run(w, { kind: 'card', missionId: id, outcomes: choice.outcomes });
          break;
        }
      }
    }
    return w;
  }

  return { take, run, choose, play };
}
