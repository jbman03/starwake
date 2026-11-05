import type { GameData, OutfitDef } from '../data/schemas';
import type { NpcRole } from './ai';
import type { BattleEvent } from './battle';
import { fullHull, PLAYER_ID } from './combat';
import { shipStats } from './shipStats';
import type { Npc, Traffic } from './traffic';
import type { ShipState, WorldState } from './types';
import { npcLoadout } from './weapons';

export type BayDef = Extract<OutfitDef, { category: 'bay' }>;

/** Player fighters' ids start with this (so the player's side, `esc-`, includes them). */
export const PLAYER_FIGHTER_PREFIX = 'esc-f';

/** The bays among a set of outfits, in id order. */
export function baysOf(outfits: Record<string, number>, data: GameData): { def: BayDef; count: number }[] {
  const out: { def: BayDef; count: number }[] = [];
  for (const id of Object.keys(outfits).sort()) {
    const def = data.outfits[id];
    if (def && def.category === 'bay' && outfits[id] > 0) out.push({ def, count: outfits[id] });
  }
  return out;
}

/** How many of a fighter the ship can carry: its `max` times the bays that launch it. */
export function fighterCap(outfits: Record<string, number>, fighterId: string, data: GameData): number {
  const f = data.outfits[fighterId];
  if (!f || f.category !== 'fighter') return 0;
  return f.max * baysOf(outfits, data).reduce((n, b) => n + (b.def.effect.fighter === fighterId ? b.count : 0), 0);
}

/** Fighters docked aboard: those of a kind some fitted bay launches. */
export function dockedCount(outfits: Record<string, number>, data: GameData): number {
  const kinds = new Set(baysOf(outfits, data).map((b) => b.def.effect.fighter));
  let n = 0;
  for (const k of kinds) n += outfits[k] ?? 0;
  return n;
}

export const isFighter = (n: Npc): boolean => n.fighter !== undefined;

/** The player's fighters out in space. */
export function playerFighters(t: Pick<Traffic, 'npcs'>): Npc[] {
  return t.npcs.filter((n) => n.fighter?.carrierId === PLAYER_ID);
}

/** A fighter launched from `carrier`: at its position and speed, shields and armor full. */
export function fighterNpc(
  id: string,
  outfitId: string,
  carrier: { id: string; government: string; role: NpcRole; ship: ShipState; aggro: string[] },
  data: GameData,
): Npc {
  const f = data.outfits[outfitId];
  const shipId = f && f.category === 'fighter' ? f.effect.shipId : outfitId;
  const def = data.ships[shipId];
  const outfits = { ...npcLoadout(def) };
  const st = shipStats(shipId, outfits, data);
  return {
    id,
    name: def.name,
    shipId,
    government: carrier.government,
    errand: 'pass',
    ship: { pos: { ...carrier.ship.pos }, vel: { ...carrier.ship.vel }, heading: carrier.ship.heading, fuel: 0 },
    portId: null,
    phase: 'fly',
    phaseT: 0,
    thrusting: false,
    role: carrier.role,
    hull: fullHull(st.shields, st.armor),
    outfits,
    aggro: [...carrier.aggro],
    engaged: true,
    peaceful: false,
    demand: false,
    killCounted: false,
    fighter: { outfitId, carrierId: carrier.id },
  };
}

/** One fighter back aboard: its outfit count goes up, never past the bays' room. */
export function dockOne(outfits: Record<string, number>, outfitId: string, data: GameData): Record<string, number> {
  const n = Math.min(fighterCap(outfits, outfitId, data), (outfits[outfitId] ?? 0) + 1);
  return n > 0 ? { ...outfits, [outfitId]: n } : outfits;
}

/**
 * Leaving the system (jump, landing, tow, rescue): every player fighter that can still fly docks; a
 * disabled one is lost. Returns the world with the fighters back in its outfits and traffic without them.
 */
export function dockFighters(world: WorldState, data: GameData, t: Traffic): { world: WorldState; traffic: Traffic; lost: number } {
  const out = playerFighters(t);
  if (out.length === 0) return { world, traffic: t, lost: 0 };
  let outfits = world.outfits;
  let lost = 0;
  for (const n of out) {
    if (n.hull.disabled) lost++;
    else outfits = dockOne(outfits, n.fighter!.outfitId, data);
  }
  return { world: { ...world, outfits }, traffic: { ...t, npcs: t.npcs.filter((n) => n.fighter?.carrierId !== PLAYER_ID) }, lost };
}

/** "A Wasp Fighter is lost." for each player fighter destroyed this tick. */
export function fighterLosses(before: Pick<Traffic, 'npcs'>, events: readonly BattleEvent[]): string[] {
  const out: string[] = [];
  for (const ev of events) {
    if (ev.type !== 'destroyed') continue;
    const n = before.npcs.find((x) => x.id === ev.id);
    if (n?.fighter?.carrierId === PLAYER_ID) out.push(`A ${n.name} is lost.`);
  }
  return out;
}

export const FIGHTER_TEXT: Record<'launched' | 'recalled' | 'docked', string> = {
  launched: 'Fighters launched.',
  recalled: 'Fighters recalled.',
  docked: 'Fighters docked.',
};
