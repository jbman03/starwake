import type { GameData, StoryMissionDef } from '../data/schemas';
import { chosenArc } from './arcs';
import { formatDate } from './calendar';
import { systemOpen } from './galaxy';
import { conditionsMet, offerable, stepSystem } from './storyMissions';
import type { WorldState } from './types';

/**
 * One line of the Leads log (cycle 7): where the next story step is and why. `active` is a mission under way,
 * `offer` a mission some bar or hail would give now (or from a date), `arc` an arc not yet taken.
 */
export type Lead = { kind: 'active' | 'offer' | 'arc'; text: string; why: string; systemId: string | null };

/** Order offers by thread: the main story, the arcs, the Concord and Reach chains, then side jobs. */
const order = (d: StoryMissionDef, data: GameData) => (d.arc === 'main' ? 0 : d.arc in data.arcs ? 1 : d.arc === 'side' ? 3 : 2);

/** Every story thread's next step: active missions, then offers (one per chain), then arcs still open to take. */
export function leads(world: WorldState, data: GameData): Lead[] {
  const out: Lead[] = [];
  const visible = (sid: string | undefined) => (sid && data.systems[sid] && systemOpen(data.systems[sid], world.flags) ? sid : null);

  for (const a of world.story.active) {
    const def = data.story[a.id];
    const step = def?.steps[a.step];
    if (!def || !step) continue;
    out.push({ kind: 'active', text: `${def.title}: ${step.text}`, why: `for ${def.giver.name}`, systemId: visible(stepSystem(step, data)) });
  }

  const arcTaken = chosenArc(world, data) !== null;
  const entries = new Set(Object.values(data.arcs).map((a) => a.entry.mission));
  const chains = new Set<string>();
  const ports = Object.values(data.planets);
  for (const def of Object.values(data.story).sort((x, y) => order(x, data) - order(y, data))) {
    if (!arcTaken && entries.has(def.id)) continue; // shown below as the arc's own lead
    if (def.chain && chains.has(def.chain)) continue;
    // Waiting only on a day count: say from when, rather than going quiet.
    const from = def.offer.minDay !== undefined && world.day < def.offer.minDay ? def.offer.minDay : null;
    const w = from === null ? world : { ...world, day: from };
    const why = from === null ? def.giver.title : `From ${formatDate(from, data.config)}`;
    if (def.offer.where === 'bar') {
      const port = ports.find((p) => offerable(w, data, def, p.id));
      if (!port) continue;
      out.push({ kind: 'offer', text: `${def.giver.name} at ${port.name}: ${def.title}`, why, systemId: visible(port.systemId) });
    } else {
      const sid = def.offer.systems?.find((s) => visible(s));
      if (!sid || !conditionsMet(w, data, def)) continue;
      out.push({ kind: 'offer', text: `${def.giver.name} hails in ${data.systems[sid].name}: ${def.title}`, why, systemId: sid });
    }
    if (def.chain) chains.add(def.chain);
  }

  if (!arcTaken)
    for (const arc of Object.values(data.arcs)) {
      const entry = data.story[arc.entry.mission];
      if (!entry || !conditionsMet(world, data, entry)) continue;
      const port = ports.find((p) => offerable(world, data, entry, p.id));
      out.push({ kind: 'arc', text: arc.entry.lead, why: `Story arc: ${arc.title}. Taking it closes the other arcs.`, systemId: port ? visible(port.systemId) : null });
    }
  return out;
}
