import type { GameData } from '../data/schemas';
import { DISABLE_FRACTION, fullHull } from './combat';
import { escortMaxArmor } from './escorts';
import { shipStats } from './shipStats';
import type { Npc, Traffic } from './traffic';
import type { Escort, ShipState, WorldState } from './types';
import { add, fromAngle, scale, type Vec2 } from './vec';

/** Radians between neighbouring slots on the arc behind the player. */
export const SLOT_SPREAD = 0.6;

/** Escort `index` of `count`: on an arc `followDistance` behind the player's heading, centred on the line astern. */
export function escortSlot(player: ShipState, index: number, count: number, followDistance: number): Vec2 {
  const offset = (index - (count - 1) / 2) * SLOT_SPREAD;
  return add(player.pos, scale(fromAngle(player.heading + Math.PI + offset), followDistance));
}

/** The traffic NPC for an escort in the list: shields full, armor from the list (disabled below the disable line). */
export function escortNpc(e: Escort, data: GameData, at: { pos: Vec2; heading: number; vel?: Vec2 }): Npc {
  const outfits = { ...e.outfits };
  const st = shipStats(e.shipId, outfits, data);
  const armor = Math.max(0, Math.min(st.armor, e.armor));
  return {
    id: e.id,
    name: e.name,
    shipId: e.shipId,
    government: '',
    errand: 'pass',
    ship: { pos: { ...at.pos }, vel: at.vel ? { ...at.vel } : { x: 0, y: 0 }, heading: at.heading, fuel: e.fuel * data.config.fuelPerJump },
    portId: null,
    phase: 'fly',
    phaseT: 0,
    thrusting: false,
    role: 'escort',
    hull: { ...fullHull(st.shields, st.armor), armor, disabled: armor < DISABLE_FRACTION * st.armor },
    outfits,
    aggro: [],
    engaged: true,
    peaceful: false,
    demand: false,
    killCounted: false,
  };
}

/** The escort NPCs in `t` (one per escort that came along). */
export function presentEscorts(t: Traffic): Npc[] {
  return t.npcs.filter((n) => n.role === 'escort');
}

/** `t` with every escort NPC dropped. */
export function withoutEscorts(t: Traffic): Traffic {
  return { ...t, npcs: t.npcs.filter((n) => n.role !== 'escort') };
}

/** Drop every escort NPC, then spawn each escort that is not waiting on the arc behind `around`, at rest. */
export function withEscorts(t: Traffic, world: WorldState, data: GameData, around: { pos: Vec2; heading: number }): Traffic {
  const going = world.escorts.filter((e) => !e.waiting);
  const lead: ShipState = { pos: around.pos, vel: { x: 0, y: 0 }, heading: around.heading, fuel: 0 };
  const spawned = going.map((e, i) => escortNpc(e, data, { pos: escortSlot(lead, i, going.length, data.escorts.followDistance), heading: around.heading }));
  const rest = withoutEscorts(t);
  return { ...rest, npcs: [...rest.npcs, ...spawned] };
}

/** Write the armor and outfits (spent ammo) of each escort NPC in `t` back to the list. A waiting escort is left alone. */
export function syncEscorts(world: WorldState, data: GameData, t: Traffic): WorldState {
  void data;
  const byId = new Map(presentEscorts(t).map((n) => [n.id, n]));
  if (byId.size === 0) return world;
  const escorts = world.escorts.map((e) => {
    const n = byId.get(e.id);
    return !n || e.waiting ? e : { ...e, armor: n.hull.armor, outfits: { ...n.outfits } };
  });
  return { ...world, escorts };
}

/**
 * The player jumps out of `t`'s system: escorts sync, then each uses a jump of fuel, or waits (for the next
 * landing) when its tank is empty or it is disabled. A waiting escort stays waiting.
 */
export function escortsJump(world: WorldState, data: GameData, t: Traffic): WorldState {
  const synced = syncEscorts(world, data, t);
  const byId = new Map(presentEscorts(t).map((n) => [n.id, n]));
  const escorts = synced.escorts.map((e): Escort => {
    if (e.waiting) return e;
    const n = byId.get(e.id);
    const disabled = n ? n.hull.disabled : e.armor < DISABLE_FRACTION * escortMaxArmor(data, e);
    return disabled || e.fuel <= 0 ? { ...e, waiting: true } : { ...e, fuel: e.fuel - 1 };
  });
  return { ...synced, escorts };
}
