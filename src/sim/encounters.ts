import type { EncounterDef, GameData, Outcome } from '../data/schemas';
import { cargoFree } from './cargo';
import { HIDDEN_LANE_FLAG, hopDistance, revealOnArrival, revealWithin } from './galaxy';
import { accept, buildOffer } from './missions';
import { hashString, mulberry32, pick } from './random';
import { worldStats } from './shipStats';
import { addNote, hasFlag, setFlag } from './story';
import type { Mission, WorldState } from './types';

/** Chance that an arrival brings an encounter, when nothing is guaranteed. */
export const ENCOUNTER_CHANCE = 0.25;

type Choice = EncounterDef['choices'][number];

const onceFlag = (id: string) => `enc:${id}`;

/** Does the template's `when` allow it at the pilot's current system and day? */
function conditionsMet(world: WorldState, data: GameData, def: EncounterDef): boolean {
  const when = def.when;
  if (def.once && hasFlag(world, onceFlag(def.id))) return false;
  if (!when) return true;
  const system = data.systems[world.systemId];
  if (!system) return false;
  if (when.minDay !== undefined && world.day < when.minDay) return false;
  if (when.governments && !when.governments.includes(system.government)) return false;
  if (when.tiers && !Object.values(data.planets).some((p) => p.systemId === world.systemId && when.tiers!.includes(p.techTier))) return false;
  if (when.systems && !when.systems.includes(world.systemId)) return false;
  if (when.requiresFlag && !hasFlag(world, when.requiresFlag)) return false;
  if (when.notFlag && hasFlag(world, when.notFlag)) return false;
  return true;
}

/** Story encounters that always fire when their conditions hold (no roll, no not-twice rule). */
function guaranteed(world: WorldState, data: GameData): EncounterDef | null {
  const ids: string[] = [];
  if (world.systemId === 'skerry' && hasFlag(world, 'survey-rumour') && !hasFlag(world, HIDDEN_LANE_FLAG)) ids.push('survey-beacon');
  if (world.systemId === 'hushwater') ids.push('long-patience');
  for (const id of ids) {
    const def = data.encounters[id];
    if (def && conditionsMet(world, data, def)) return def;
  }
  return null;
}

/** The encounter waiting on arrival at `world.systemId` today, or null. Deterministic per (seed, system, day). */
export function rollEncounter(world: WorldState, data: GameData, opts: { guideActive: boolean }): EncounterDef | null {
  if (opts.guideActive) return null;
  const sure = guaranteed(world, data);
  if (sure) return sure;
  if (world.lastEncounterDay === world.day - 1) return null;
  const r = mulberry32(hashString(world.seed, 'enc', world.systemId, world.day));
  if (r() >= ENCOUNTER_CHANCE) return null;
  const eligible = Object.values(data.encounters).filter((d) => conditionsMet(world, data, d));
  if (eligible.length === 0) return null;
  let roll = r() * eligible.reduce((sum, d) => sum + d.weight, 0);
  for (const d of eligible) {
    roll -= d.weight;
    if (roll < 0) return d;
  }
  return eligible[eligible.length - 1];
}

/** Net fuel change a choice's outcomes ask for. */
function fuelDelta(choice: Choice): number {
  let n = 0;
  for (const o of choice.outcomes) if (o.type === 'fuel') n += o.n;
  return n;
}

/** Why the pilot can't pick this choice right now, or null. */
export type Block = 'fuel' | 'credits' | 'cargoSpace' | 'missions';

/** Short reasons for the encounter card to show beside a blocked choice. */
export const ENCOUNTER_BLOCK_TEXT: Record<Block, string> = {
  fuel: 'Not enough fuel to spare',
  credits: 'Not enough credits',
  cargoSpace: 'Not enough room in the hold',
  missions: 'No room for another job',
};

export function choiceBlock(world: WorldState, data: GameData, choice: Choice, defId: string): Block | null {
  const needs = choice.needs;
  if (needs?.fuel !== undefined && world.ship.fuel < needs.fuel) return 'fuel';
  if (needs?.credits !== undefined && world.credits < needs.credits) return 'credits';
  if (needs?.cargoSpace !== undefined && cargoFree(world, data) < needs.cargoSpace) return 'cargoSpace';
  // Giving fuel away must leave enough for one jump.
  const delta = fuelDelta(choice);
  if (delta < 0 && world.ship.fuel + delta < data.config.fuelPerJump) return 'fuel';
  let spend = 0;
  for (const o of choice.outcomes) if (o.type === 'credits') spend += o.n;
  if (spend < 0 && world.credits + spend < 0) return 'credits';
  // A job the pilot couldn't take (or that has nowhere to go): dry-run the very code applyChoice uses.
  if (choice.outcomes.some((o) => o.type === 'mission') && runChoice(world, data, defId, false, choice, { npcName: '' }).refused) return 'missions';
  return null;
}

/** Fill {ship}, {system} and {pilot} in encounter text. */
export function fillText(text: string, ctx: { ship: string; system: string; pilot: string }): string {
  return text.replace(/\{(ship|system|pilot)\}/g, (_, k: 'ship' | 'system' | 'pilot') => ctx[k]);
}

/** A mission of `typeId` from a port here to `toSystem`'s first port, or to a known port 1-3 jumps away. */
function buildEncounterMission(world: WorldState, data: GameData, defId: string, idx: number, typeId: string, toSystem?: string) {
  const type = data.missionTypes[typeId];
  const origin = Object.values(data.planets).find((p) => p.systemId === world.systemId);
  if (!type || !origin) return null;
  const r = mulberry32(hashString(world.seed, 'encm', defId, world.day, idx));
  let dest: { portId: string; hops: number } | undefined;
  if (toSystem) {
    const port = Object.values(data.planets).find((p) => p.systemId === toSystem);
    if (port) dest = { portId: port.id, hops: hopDistance(data, world.systemId, toSystem, world.flags) };
  } else {
    const pool = Object.values(data.planets)
      .filter((p) => world.known.includes(p.systemId) && (!type.toDumpSite || p.dumpSite))
      .map((p) => ({ portId: p.id, hops: hopDistance(data, world.systemId, p.systemId, world.flags) }))
      .filter((d) => d.hops >= 1 && d.hops <= 3);
    if (pool.length > 0) dest = pick(r, pool);
  }
  if (!dest || !Number.isFinite(dest.hops)) return null;
  const names = Object.values(data.commodities).filter((c) => !c.origin).map((c) => c.name);
  return buildOffer(world, data, type, origin.id, dest, r, names, `enc:${defId}:${world.day}:${idx}`);
}

/**
 * Apply the chosen option's outcomes in order. Cargo is capped at the free hold, fuel stays within
 * the tank, and a `once` template is marked done only if the choice did something beyond talking.
 */
export function applyChoice(
  world: WorldState,
  data: GameData,
  def: EncounterDef,
  choiceIdx: number,
  ctx: { npcName: string },
): { world: WorldState; messages: string[]; missions: Mission[] } {
  const choice = def.choices[choiceIdx];
  if (!choice) throw new Error(`Encounter ${def.id} has no choice ${choiceIdx}`);
  const { refused, ...result } = runChoice(world, data, def.id, def.once === true, choice, ctx);
  return result;
}

function runChoice(
  world: WorldState,
  data: GameData,
  defId: string,
  once: boolean,
  choice: Choice,
  ctx: { npcName: string },
): { world: WorldState; messages: string[]; missions: Mission[]; refused: boolean } {
  let refused = false;
  const text = { ship: ctx.npcName, system: data.systems[world.systemId]?.name ?? world.systemId, pilot: world.shipName };
  const messages: string[] = [];
  const missions: Mission[] = [];
  let w = world;
  const apply = (o: Outcome, idx: number) => {
    switch (o.type) {
      case 'credits':
        w = { ...w, credits: w.credits + o.n };
        break;
      case 'cargo': {
        const tons = Math.min(o.tons, cargoFree(w, data));
        if (tons > 0) w = { ...w, cargo: { ...w.cargo, [o.good]: (w.cargo[o.good] ?? 0) + tons } };
        break;
      }
      case 'fuel': {
        const cap = worldStats(w, data).fuelCapacity;
        w = { ...w, ship: { ...w.ship, fuel: Math.min(cap, Math.max(0, w.ship.fuel + o.n)) } };
        break;
      }
      case 'mission': {
        const offer = buildEncounterMission(w, data, defId, idx, o.missionType, o.toSystem);
        const next = offer ? accept(w, data, offer) : w;
        if (next === w) {
          refused = true;
          break;
        }
        w = next;
        missions.push(next.missions[next.missions.length - 1]);
        break;
      }
      case 'reveal': {
        let { known, seen } = w;
        if (o.jumps !== undefined) ({ known, seen } = revealWithin(known, seen, data, w.systemId, o.jumps, w.flags));
        for (const id of o.systems ?? []) if (data.systems[id]) ({ known, seen } = revealOnArrival(known, seen, data, id, w.flags));
        w = { ...w, known, seen };
        break;
      }
      case 'rumour':
        w = addNote(w, fillText(o.text, text));
        break;
      case 'flag':
        w = setFlag(w, o.flag);
        if (o.flag === HIDDEN_LANE_FLAG) w = { ...w, ...revealOnArrival(w.known, w.seen, data, w.systemId, w.flags) };
        break;
      case 'message':
        messages.push(fillText(o.text, text));
        break;
    }
  };
  choice.outcomes.forEach(apply);
  if (once && choice.outcomes.some((o) => o.type !== 'message')) w = setFlag(w, onceFlag(defId));
  return { world: { ...w, lastEncounterDay: world.day }, messages, missions, refused };
}
