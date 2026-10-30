import type { GameData } from '../data/schemas';
import { faceInput } from './assists';
import { leadPoint, PLAYER_ID, type Combatant } from './combat';
import { wrap } from './flight';
import { hashString } from './random';
import type { FlightInput } from './types';
import { angleOf, dist, sub, type Vec2 } from './vec';
import { hasWeapon, weaponsOf } from './weapons';

/**
 * NPC combat AI. The tunables (flee fraction, engage and keep ranges, fire cone) live in
 * data/combat.json under `ai`, keyed by role, and are read through `data.combat.ai[role]`.
 */
export type NpcRole = 'trader' | 'patrol' | 'raider';
export type AiMode = 'errand' | 'attack' | 'flee';
export interface AiSelf {
  role: NpcRole;
  me: Combatant;
  peaceful: boolean;
  /** Ids that have attacked this NPC. */
  aggro: readonly string[];
  maxSpeed: number;
  fireRange: number;
}
export interface AiDecision { mode: AiMode; targetId: string | null; input: FlightInput; fire: boolean; fleeTo: Vec2 | null }

export const RAIDERS = 'raiders';
const DEG = Math.PI / 180;
/** Closer than this fraction of keepRange, the NPC turns away and thrusts. */
const BACK_OFF_FRACTION = 0.5;
/** Turn off the line to the target when closer than keepRange. */
const ORBIT_ANGLE = 60 * DEG;
/** Fallback shot speed for lead aiming when the ship carries no gun. */
const DEFAULT_SHOT_SPEED = 600;
/** A fleeing ship thrusts once its nose is within this of the escape point. */
const FLEE_ALIGN = 20 * DEG;

const IDLE: FlightInput = { thrust: false, turn: 0 };

export function isHostileTo(self: AiSelf, other: Combatant, angry: readonly string[]): boolean {
  if (other.id === self.me.id) return false;
  if (self.aggro.includes(other.id)) return true;
  if (self.role === 'raider') return !self.peaceful && other.government !== RAIDERS;
  if (self.role === 'patrol')
    return other.government === RAIDERS || (other.id === PLAYER_ID && angry.includes(self.me.government));
  return false;
}

export function decide(self: AiSelf, others: readonly Combatant[], angry: readonly string[], fleeTo: Vec2, data: GameData): AiDecision {
  const errand: AiDecision = { mode: 'errand', targetId: null, input: IDLE, fire: false, fleeTo: null };
  const { me } = self;
  if (me.hull.disabled) return errand;
  const profile = data.combat.ai[self.role];

  const flee = (): AiDecision => {
    const face = faceInput(me.ship, fleeTo);
    const aligned = Math.abs(wrap(face.targetHeading! - me.ship.heading)) < FLEE_ALIGN;
    return { mode: 'flee', targetId: null, input: { ...face, thrust: aligned }, fire: false, fleeTo };
  };

  const armorFrac = me.hull.maxArmor > 0 ? me.hull.armor / me.hull.maxArmor : 1;
  if (self.role !== 'patrol' && armorFrac < profile.flee) return flee();
  if (self.role === 'trader' && self.aggro.length > 0 && !hasWeapon(me.outfits, data)) return flee();

  let target: Combatant | null = null;
  let best = Infinity;
  for (const o of others) {
    if (o.hull.disabled || !isHostileTo(self, o, angry)) continue;
    const d = dist(me.ship.pos, o.ship.pos);
    if (d <= profile.engageRange && d < best) {
      best = d;
      target = o;
    }
  }
  if (!target) return errand;

  const shotSpeed = weaponsOf(me.outfits, data).guns[0]?.def.effect.speed ?? DEFAULT_SHOT_SPEED;
  const aim = leadPoint(me.ship.pos, shotSpeed, target.ship);
  const aimHeading = angleOf(sub(aim, me.ship.pos));
  let input: FlightInput;
  if (best > profile.keepRange) {
    input = { ...faceInput(me.ship, aim), thrust: true };
  } else if (best > profile.keepRange * BACK_OFF_FRACTION) {
    // Holding range: keep the nose on the lead point so the guns can fire, and coast.
    input = { ...faceInput(me.ship, aim), thrust: false };
  } else {
    // Much too close: swing round the target and burn to open the range.
    const side = hashString(me.id) % 2 === 0 ? 1 : -1;
    const bearing = angleOf(sub(target.ship.pos, me.ship.pos));
    input = { thrust: true, turn: 0, targetHeading: wrap(bearing + side * ORBIT_ANGLE) };
  }
  const offAim = Math.abs(wrap(aimHeading - me.ship.heading));
  const fire = hasWeapon(me.outfits, data) && best <= self.fireRange && offAim <= profile.fireCone * DEG;
  return { mode: 'attack', targetId: target.id, input, fire, fleeTo: null };
}
