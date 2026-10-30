import { turnToward, wrap } from './flight';
import type { ShipState } from './types';
import { add, angleOf, dist, fromAngle, len, scale, sub, type Vec2 } from './vec';
import type { AmmoDef, GunDef } from './weapons';

export const DISABLE_FRACTION = 0.1;
export const SHIELD_REGEN_PER_SEC = 0.05; // of max
export const SHIELD_REGEN_DELAY = 2; // s after the last hit
export const DISABLED_STOP_SEC = 8; // drift slows to rest over this
export const LOW_ARMOR_FRACTION = 0.25;
export const PLAYER_ID = 'player';

const DEG = Math.PI / 180;
/** Fraction of speed left after DISABLED_STOP_SEC of drifting; below REST_SPEED it snaps to rest. */
const DRIFT_LEFT = 0.01;
const REST_SPEED = 0.5;

export interface Hull { shields: number; armor: number; maxShields: number; maxArmor: number; disabled: boolean; lastHitSec: number }
export interface Combatant { id: string; government: string; ship: ShipState; radius: number; hull: Hull; outfits: Record<string, number> }
export type ShotKind = 'bolt' | 'rocket' | 'seeker';
export interface Projectile { id: number; ownerId: string; targetId: string | null; kind: ShotKind; pos: Vec2; vel: Vec2; damage: number; ttl: number; turnRate: number }
export interface BeamShot { ownerId: string; from: Vec2; to: Vec2; hitId: string | null }
export interface DamageResult { hull: Hull; shieldHit: boolean; disabledNow: boolean; destroyed: boolean }

export function fullHull(maxShields: number, maxArmor: number): Hull {
  return { shields: maxShields, armor: maxArmor, maxShields, maxArmor, disabled: false, lastHitSec: -Infinity };
}

/** Shields soak first; only the overflow reaches armor. A healthy hull disables (never destroys) in one hit. */
export function applyDamage(h: Hull, dmg: number, nowSec: number): DamageResult {
  const soaked = Math.min(h.shields, dmg);
  const overflow = dmg - soaked;
  const armor = Math.max(0, h.armor - overflow);
  const disabled = h.disabled || armor < DISABLE_FRACTION * h.maxArmor;
  const hull: Hull = { ...h, shields: h.shields - soaked, armor, disabled, lastHitSec: nowSec };
  return {
    hull,
    shieldHit: soaked > 0,
    disabledNow: disabled && !h.disabled,
    destroyed: h.disabled && overflow > 0 && armor <= 0,
  };
}

export function rechargeHull(h: Hull, dt: number, nowSec: number): Hull {
  if (h.disabled || nowSec - h.lastHitSec < SHIELD_REGEN_DELAY || h.shields >= h.maxShields) return h;
  return { ...h, shields: Math.min(h.maxShields, h.shields + h.maxShields * SHIELD_REGEN_PER_SEC * dt) };
}

/** A disabled ship takes no input: it coasts and its velocity decays to rest over about DISABLED_STOP_SEC. */
export function driftShip(ship: ShipState, dt: number): ShipState {
  let vel = scale(ship.vel, Math.pow(DRIFT_LEFT, dt / DISABLED_STOP_SEC));
  if (len(vel) < REST_SPEED) vel = { x: 0, y: 0 };
  return { pos: add(ship.pos, scale(vel, dt)), vel, heading: ship.heading, fuel: ship.fuel };
}

/** Where to aim a shot of `shotSpeed` fired from `from` to meet a moving target; falls back to its position. */
export function leadPoint(from: Vec2, shotSpeed: number, target: { pos: Vec2; vel: Vec2 }): Vec2 {
  const d = sub(target.pos, from);
  const v = target.vel;
  const a = v.x * v.x + v.y * v.y - shotSpeed * shotSpeed;
  const b = 2 * (d.x * v.x + d.y * v.y);
  const c = d.x * d.x + d.y * d.y;
  let t = -1;
  if (Math.abs(a) < 1e-9) {
    if (Math.abs(b) > 1e-9) t = -c / b;
  } else {
    const disc = b * b - 4 * a * c;
    if (disc >= 0) {
      const sq = Math.sqrt(disc);
      const t1 = (-b - sq) / (2 * a);
      const t2 = (-b + sq) / (2 * a);
      const ts = [t1, t2].filter((x) => x > 0);
      if (ts.length) t = Math.min(...ts);
    }
  }
  return t > 0 ? add(target.pos, scale(v, t)) : { ...target.pos };
}

/** Ship heading, bent onto the lead point when it lies within the gun's assist cone, plus random spread. */
export function gunHeading(shooter: ShipState, target: Combatant | null, gun: GunDef, r: () => number): number {
  const fx = gun.effect as { speed: number; spread?: number; assist?: number };
  let h = shooter.heading;
  if (target) {
    const aim = angleOf(sub(leadPoint(shooter.pos, fx.speed, target.ship), shooter.pos));
    if (Math.abs(wrap(aim - shooter.heading)) <= (fx.assist ?? 0) * DEG) h = aim;
  }
  const spread = fx.spread ?? 0;
  if (spread > 0) h += (r() * 2 - 1) * spread * DEG;
  return wrap(h);
}

/** Heading to the target's lead point, or null when there is no target or it is out of range. */
export function turretHeading(shooter: ShipState, target: Combatant | null, gun: GunDef): number | null {
  if (!target) return null;
  const fx = gun.effect;
  if (dist(shooter.pos, target.ship.pos) > fx.range) return null;
  return angleOf(sub(leadPoint(shooter.pos, fx.speed, target.ship), shooter.pos));
}

/** A bolt from a gun or turret; it flies at the gun's speed on `heading` and lives range / speed seconds. */
export function spawnBolt(id: number, ownerId: string, targetId: string | null, shooter: ShipState, heading: number, gun: GunDef): Projectile {
  const fx = gun.effect;
  return { id, ownerId, targetId, kind: 'bolt', pos: { ...shooter.pos }, vel: scale(fromAngle(heading), fx.speed), damage: fx.damage, ttl: fx.range / fx.speed, turnRate: 0 };
}

/** A rocket or seeker fired along the shooter's heading. */
export function spawnAmmo(id: number, ownerId: string, targetId: string | null, shooter: ShipState, kind: 'rocket' | 'seeker', ammo: AmmoDef): Projectile {
  const fx = ammo.effect;
  return { id, ownerId, targetId, kind, pos: { ...shooter.pos }, vel: scale(fromAngle(shooter.heading), fx.speed), damage: fx.damage, ttl: fx.range / fx.speed, turnRate: fx.turnRate };
}

export function stepProjectile(p: Projectile, target: Combatant | undefined, dt: number): Projectile {
  let vel = p.vel;
  if (p.turnRate > 0 && target) {
    const speed = len(vel);
    const want = angleOf(sub(target.ship.pos, p.pos));
    const h = turnToward(angleOf(vel), want, p.turnRate * DEG * dt);
    vel = scale(fromAngle(h), speed);
  }
  return { ...p, vel, pos: add(p.pos, scale(vel, dt)), ttl: p.ttl - dt };
}

export function hitTest(p: Projectile, c: Combatant): boolean {
  return dist(p.pos, c.ship.pos) <= c.radius;
}

/** Instant ray: the nearest circle along it within range, else the ray's end. */
export function beamTrace(from: Vec2, heading: number, range: number, candidates: Combatant[]): { to: Vec2; hitId: string | null } {
  const dir = fromAngle(heading);
  let best = range;
  let hitId: string | null = null;
  for (const c of candidates) {
    const m = sub(c.ship.pos, from);
    const along = m.x * dir.x + m.y * dir.y;
    const perp2 = m.x * m.x + m.y * m.y - along * along;
    const r2 = c.radius * c.radius;
    if (perp2 > r2) continue;
    const t = Math.max(0, along - Math.sqrt(r2 - perp2));
    if (along + Math.sqrt(r2 - perp2) < 0 || t > best) continue;
    if (t < best || hitId === null) { best = t; hitId = c.id; }
  }
  return { to: add(from, scale(dir, best)), hitId };
}
