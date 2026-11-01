import type { GameData } from '../data/schemas';
import { DISABLE_FRACTION, fullHull } from './combat';
import { shipStats } from './shipStats';
import type { Npc } from './traffic';
import type { Escort, ShipState } from './types';
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
