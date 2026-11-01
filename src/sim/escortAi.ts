import type { GameData } from '../data/schemas';
import { faceInput } from './assists';
import { aimPoint, aiProfile, engageInput, type AiDecision } from './ai';
import { isPlayerSide, type Combatant } from './combat';
import { wrap } from './flight';
import type { EscortOrder, FlightInput } from './types';
import { add, angleOf, dist, len, norm, scale, sub, type Vec2 } from './vec';

/** Within this many px of its slot an escort is on station and simply matches the player. */
export const STATION_RADIUS = 24;
/** Closing speed toward the slot per px of distance (1/s), capped at the escort's top speed. */
const CLOSE_GAIN = 1.5;
/** Below this velocity error (px/s) the escort coasts. */
const DV_DEADBAND = 5;
/** It burns once its nose is within this of the wanted heading. */
const ALIGN = (25 * Math.PI) / 180;

/** What one escort knows each tick (built by stepBattle). */
export interface EscortView {
  me: Combatant;
  player: Combatant;
  slot: Vec2;
  order: EscortOrder;
  playerTargetId: string | null;
  /** Ids that hit the player or any escort this visit and are still hostile to the player's side (not peaceful). */
  attackers: ReadonlySet<string>;
  /** Raiders that would fight the player (not peaceful, not demanding). */
  threats: ReadonlySet<string>;
  maxSpeed: number;
  fireRange: number;
}

/** The nearest of `pool` within `range` of `me`, or null. */
function nearest(me: Combatant, pool: readonly Combatant[], range: number): string | null {
  let best: string | null = null;
  let bestD = Infinity;
  for (const o of pool) {
    const d = dist(me.ship.pos, o.ship.pos);
    if (d <= range && d < bestD) {
      bestD = d;
      best = o.id;
    }
  }
  return best;
}

/**
 * Who this escort fights under its order; never a disabled ship and never the player's side.
 * Follow: attackers and raider threats in engage range. Attack: the player's target first, at any
 * range, else as Follow. Return fire (`defend`): attackers in engage range. Hold: attackers in fire range.
 */
export function escortTargetId(v: EscortView, others: readonly Combatant[], data: GameData): string | null {
  const live = others.filter((o) => !o.hull.disabled && !isPlayerSide(o.id));
  const engage = aiProfile(data, 'escort').engageRange;
  const attackers = live.filter((o) => v.attackers.has(o.id));
  if (v.order === 'hold') return nearest(v.me, attackers, v.fireRange);
  if (v.order === 'defend') return nearest(v.me, attackers, engage);
  if (v.order === 'attack' && v.playerTargetId && live.some((o) => o.id === v.playerTargetId)) return v.playerTargetId;
  return nearest(v.me, live.filter((o) => v.attackers.has(o.id) || v.threats.has(o.id)), engage);
}

/** Velocity-matching steering onto a slot that moves with the player. */
function formationInput(v: EscortView): FlightInput {
  const { me, player, slot } = v;
  const to = sub(slot, me.ship.pos);
  const want = add(player.ship.vel, scale(norm(to), Math.min(v.maxSpeed, len(to) * CLOSE_GAIN)));
  const dv = sub(want, me.ship.vel);
  if (len(dv) <= DV_DEADBAND) return { thrust: false, turn: 0, targetHeading: player.ship.heading };
  const targetHeading = angleOf(dv);
  return { thrust: Math.abs(wrap(targetHeading - me.ship.heading)) < ALIGN, turn: 0, targetHeading };
}

/**
 * One escort's choice this tick. With a target it fights it (Hold turns to face it but never
 * thrusts); with none it keeps station on its slot, or under Hold stays where it is. `station` is
 * true on the slot, where stepBattle copies the player's velocity and heading.
 */
export function escortAi(v: EscortView, others: readonly Combatant[], data: GameData): AiDecision & { station: boolean } {
  const { me } = v;
  const still: FlightInput = { thrust: false, turn: 0, targetHeading: me.ship.heading };
  if (me.hull.disabled) return { mode: 'errand', targetId: null, input: still, fire: false, fleeTo: null, station: false };

  const targetId = escortTargetId(v, others, data);
  const target = targetId ? others.find((o) => o.id === targetId) : undefined;
  if (target) {
    const range = dist(me.ship.pos, target.ship.pos);
    const e = engageInput(me, target, range, v.fireRange, aiProfile(data, 'escort'), data);
    const input = v.order === 'hold' ? { ...faceInput(me.ship, aimPoint(me, target, data)), thrust: false } : e.input;
    return { mode: 'attack', targetId: target.id, input, fire: e.fire, fleeTo: null, station: false };
  }
  if (v.order === 'hold') return { mode: 'errand', targetId: null, input: still, fire: false, fleeTo: null, station: false };
  if (dist(me.ship.pos, v.slot) <= STATION_RADIUS) {
    return { mode: 'errand', targetId: null, input: { thrust: false, turn: 0, targetHeading: v.player.ship.heading }, fire: false, fleeTo: null, station: true };
  }
  return { mode: 'errand', targetId: null, input: formationInput(v), fire: false, fleeTo: null, station: false };
}
