import type { GameData, Outcome, StoryMissionDef, StoryStepDef } from '../data/schemas';
import { berthsFree, cargoFree } from './cargo';
import { applyOutcomes } from './encounters';
import { STORY_TYPE } from './missions';
import { hashString, mulberry32 } from './random';
import { SYSTEM_CENTER } from './rules';
import { STANDING_RANK as RANK, standingOf } from './standing';
import { systemOpen } from './galaxy';
import type { Mission, WorldState } from './types';
import { add, fromAngle, scale, type Vec2 } from './vec';

const NO_NPC = { npcName: '' };

export type StoryEvent =
  | { kind: 'arrived'; systemId: string }
  | { kind: 'landed'; planetId: string }
  | { kind: 'site'; missionId: string }
  | { kind: 'card'; missionId: string; outcomes: Outcome[] };

export type StoryAccept = { ok: true } | { ok: false; reason: 'cargo' | 'berths' | 'active' | 'unknown' };

export { standingOf };

/**
 * Story cargo and passengers ride in the hold as Mission entries of type STORY_TYPE. The exchange
 * only lists trade goods, so they can't be sold, and completeAt skips them: only the story rules unload them.
 */
const holdId = (missionId: string, step: number) => `${STORY_TYPE}:${missionId}:${step}`;
const isHeld = (m: Mission, missionId: string) => m.typeId === STORY_TYPE && m.id.startsWith(`${STORY_TYPE}:${missionId}:`);
const dropCargo = (w: WorldState, missionId: string): WorldState => ({ ...w, missions: w.missions.filter((m) => !isHeld(m, missionId)) });

/** A put-off mission is recorded as "id@day": hidden that day, offered again on any later one. */
const declinedKey = (id: string, day: number) => `${id}@${day}`;
const declinedToday = (w: WorldState, id: string) => w.story.declined.includes(declinedKey(id, w.day));

const hasLoad = (s: StoryStepDef): s is Extract<StoryStepDef, { kind: 'deliver' | 'ferry' }> => s.kind === 'deliver' || s.kind === 'ferry';

/** A deadline belongs to the step that declares it: it runs from the day that step becomes current. */
const deadlineOf = (step: StoryStepDef, day: number): number | null => (hasLoad(step) && step.deadlineDays !== undefined ? day + step.deadlineDays : null);

export function currentStep(world: WorldState, data: GameData, id: string): StoryStepDef | null {
  const a = world.story.active.find((x) => x.id === id);
  return (a && data.story[id]?.steps[a.step]) || null;
}

function offerable(world: WorldState, data: GameData, def: StoryMissionDef, portId: string): boolean {
  const port = data.planets[portId];
  const o = def.offer;
  if (!port || o.where !== 'bar') return false;
  const s = world.story;
  if (s.active.some((a) => a.id === def.id) || s.done.includes(def.id) || s.failed.includes(def.id)) return false;
  if (declinedToday(world, def.id)) return false;
  if (o.ports && !o.ports.includes(portId)) return false;
  if (o.systems && !o.systems.includes(port.systemId)) return false;
  if (o.minDay !== undefined && world.day < o.minDay) return false;
  if (o.requires?.some((f) => !world.flags.includes(f))) return false;
  if (o.notFlags?.some((f) => world.flags.includes(f))) return false;
  for (const [gov, level] of Object.entries(o.standing ?? {})) if (RANK[standingOf(world, gov)] < RANK[level]) return false;
  // One main mission at a time (its `requires` flags carry the order), and one per chain.
  const others = s.active.map((a) => data.story[a.id]).filter((d): d is StoryMissionDef => !!d);
  if (def.arc === 'main' && others.some((d) => d.arc === 'main')) return false;
  if (def.chain && others.some((d) => d.chain === def.chain)) return false;
  return true;
}

/** Story missions the bar at `portId` can offer today, in data order. */
export function storyOffersAt(world: WorldState, data: GameData, portId: string): StoryMissionDef[] {
  return Object.values(data.story).filter((d) => offerable(world, data, d, portId));
}

export function canAcceptStory(world: WorldState, data: GameData, id: string): StoryAccept {
  const def = data.story[id];
  if (!def) return { ok: false, reason: 'unknown' };
  if (world.story.active.some((a) => a.id === id)) return { ok: false, reason: 'active' };
  let tons = 0;
  let pax = 0;
  for (const s of def.steps) {
    if (s.kind === 'deliver') tons += s.cargo.tons;
    if (s.kind === 'ferry') pax += s.passengers;
  }
  if (tons > cargoFree(world, data)) return { ok: false, reason: 'cargo' };
  if (pax > berthsFree(world, data)) return { ok: false, reason: 'berths' };
  return { ok: true };
}

/** Take the mission, loading the cargo and passengers of every deliver or ferry step. Unchanged if it can't be taken. */
export function acceptStory(world: WorldState, data: GameData, id: string): WorldState {
  const def = data.story[id];
  if (!def || !canAcceptStory(world, data, id).ok) return world;
  const held: Mission[] = [];
  def.steps.forEach((s, i) => {
    if (!hasLoad(s)) return;
    held.push({
      id: holdId(id, i),
      typeId: STORY_TYPE,
      originId: s.planet,
      destId: s.planet,
      tons: s.kind === 'deliver' ? s.cargo.tons : 0,
      passengers: s.kind === 'ferry' ? s.passengers : 0,
      pay: 0,
      paidUpfront: false,
      deadlineDay: null,
      title: def.title,
      description: s.text,
      cargoName: s.kind === 'deliver' ? s.cargo.name : 'passengers',
    });
  });
  return {
    ...world,
    missions: [...world.missions, ...held],
    story: {
      ...world.story,
      active: [...world.story.active, { id, step: 0, deadlineDay: deadlineOf(def.steps[0], world.day) }],
      declined: world.story.declined.filter((d) => d.split('@')[0] !== id),
    },
  };
}

/** Put the mission off; it is offered again on a later day. */
export function declineStory(world: WorldState, id: string): WorldState {
  const declined = [...world.story.declined.filter((d) => d.split('@')[0] !== id), declinedKey(id, world.day)];
  return { ...world, story: { ...world.story, declined } };
}

function stepMatches(step: StoryStepDef, ev: StoryEvent, missionId: string): boolean {
  switch (ev.kind) {
    case 'arrived':
      return step.kind === 'go' && step.system === ev.systemId;
    case 'landed':
      return (step.kind === 'land' || hasLoad(step)) && step.planet === ev.planetId;
    case 'site':
      return (step.kind === 'scan' || step.kind === 'find') && ev.missionId === missionId;
    case 'card':
      return step.kind === 'meet' && ev.missionId === missionId;
  }
}

/** The system a step is played in. */
export function stepSystem(step: StoryStepDef, data: GameData): string | undefined {
  return 'system' in step ? step.system : data.planets[step.planet]?.systemId;
}

/**
 * The systems the current step of every active story mission points at, without repeats. Hidden
 * systems whose unlock flag is unset are left out, so a story target never reveals one early.
 * setRoute treats these like a job's destination: a course may use any lane to reach them.
 */
export function storyDestinations(world: WorldState, data: GameData): string[] {
  const out = new Set<string>();
  for (const a of world.story.active) {
    const step = currentStep(world, data, a.id);
    const id = step && stepSystem(step, data);
    const sys = id ? data.systems[id] : undefined;
    if (id && sys && systemOpen(sys, world.flags)) out.add(id);
  }
  return [...out];
}

/** A scan or find site lies this far from the system centre (px, min and spread). */
export const STORY_SITE_MIN = 600;
export const STORY_SITE_SPREAD = 400;
/** A find site shows (radar, map of the sky) only within this distance of the ship. */
export const FIND_SITE_REVEAL = 600;
/** A meet ship waits this far from the system centre (px, min and spread). */
const MEET_MIN = 250;
const MEET_SPREAD = 200;

function ringPos(world: WorldState, salt: string, missionId: string, systemId: string, min: number, spread: number): Vec2 {
  const r = mulberry32(hashString(world.seed, salt, missionId, systemId));
  return add(SYSTEM_CENTER, scale(fromAngle(r() * Math.PI * 2), min + r() * spread));
}

/** Where a mission's scan or find site lies in `systemId`: fixed by the seed, mission and system. */
export const storySitePos = (world: WorldState, missionId: string, systemId: string): Vec2 =>
  ringPos(world, 'storysite', missionId, systemId, STORY_SITE_MIN, STORY_SITE_SPREAD);

/** Where a mission's meet ship waits in `systemId`. */
export const storyHoldPos = (world: WorldState, missionId: string, systemId: string): Vec2 =>
  ringPos(world, 'storymeet', missionId, systemId, MEET_MIN, MEET_SPREAD);

/** Advance every active mission whose current step the event satisfies (one step each). */
export function advanceStory(
  world: WorldState,
  data: GameData,
  ev: StoryEvent,
): { world: WorldState; messages: string[]; completed: string[] } {
  let w = world;
  const messages: string[] = [];
  const completed: string[] = [];
  for (const a of world.story.active) {
    const def = data.story[a.id];
    const step = def?.steps[a.step];
    if (!def || !step || !stepMatches(step, ev, def.id)) continue;
    const source = `story:${def.id}`;
    // The step's own cargo or passengers are handed over here.
    w = { ...w, missions: w.missions.filter((m) => m.id !== holdId(def.id, a.step)) };
    if (ev.kind === 'card') {
      const r = applyOutcomes(w, data, ev.outcomes, source, NO_NPC);
      w = r.world;
      messages.push(...r.messages);
    }
    if (a.step + 1 >= def.steps.length) {
      const r = applyOutcomes(dropCargo(w, def.id), data, def.onComplete, source, NO_NPC);
      w = {
        ...r.world,
        story: {
          ...r.world.story,
          active: r.world.story.active.filter((x) => x.id !== def.id),
          done: [...r.world.story.done, def.id],
          doneDays: { ...r.world.story.doneDays, [def.id]: w.day },
        },
      };
      messages.push(...r.messages, `Story complete: ${def.title}.`);
      completed.push(def.id);
      continue;
    }
    const next = def.steps[a.step + 1];
    const deadlineDay = deadlineOf(next, w.day);
    w = { ...w, story: { ...w.story, active: w.story.active.map((x) => (x.id === def.id ? { ...x, step: a.step + 1, deadlineDay } : x)) } };
    messages.push(`${def.title}: ${next.text}`);
  }
  return { world: w, messages, completed };
}

/** Day-advance check. A late side mission fails (onFail, cargo lost); a late main mission goes back to the bar from tomorrow. */
export function checkStoryDeadlines(world: WorldState, data: GameData): { world: WorldState; messages: string[] } {
  let w = world;
  const messages: string[] = [];
  for (const a of world.story.active) {
    const def = data.story[a.id];
    if (!def || a.deadlineDay === null || w.day <= a.deadlineDay) continue;
    w = dropCargo(w, a.id);
    const active = w.story.active.filter((x) => x.id !== a.id);
    if (def.arc === 'main') {
      w = declineStory({ ...w, story: { ...w.story, active } }, a.id);
      messages.push(`${def.title}: the deadline passed and the cargo is lost. ${def.giver.name} will talk to you again.`);
      continue;
    }
    const failed = { ...w, story: { ...w.story, active, failed: [...w.story.failed, a.id] } };
    const r = applyOutcomes(failed, data, def.onFail ?? [], `story:${a.id}`, NO_NPC);
    w = r.world;
    messages.push(...r.messages, `Mission failed: ${def.title} — the deadline passed.`);
  }
  return { world: w, messages };
}

/** Give up a side mission: its cargo is dropped and nothing else changes. The main arc can't be abandoned. */
export function abandonStory(world: WorldState, data: GameData, id: string): WorldState {
  const def = data.story[id];
  if (!def || def.arc === 'main' || !world.story.active.some((a) => a.id === id)) return world;
  const w = dropCargo(world, id);
  return { ...w, story: { ...w.story, active: w.story.active.filter((a) => a.id !== id) } };
}

/** The first mission any bar can offer: the main arc, else the rest in data order. */
export function nextLead(world: WorldState, data: GameData): { portId: string; text: string } | null {
  const defs = Object.values(data.story);
  const ports = Object.values(data.planets);
  for (const def of [...defs.filter((d) => d.arc === 'main'), ...defs.filter((d) => d.arc !== 'main')]) {
    const port = ports.find((p) => offerable(world, data, def, p.id));
    if (port) return { portId: port.id, text: `Talk is that ${def.giver.title} ${def.giver.name} at ${port.name} wants a pilot.` };
  }
  return null;
}
