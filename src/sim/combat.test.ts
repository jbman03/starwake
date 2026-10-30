import { describe, expect, it } from 'vitest';
import type { AmmoDef, GunDef } from './weapons';
import type { ShipState } from './types';
import {
  applyDamage, beamTrace, DISABLED_STOP_SEC, driftShip, fullHull, gunHeading, hitTest, leadPoint, rechargeHull,
  spawnAmmo, spawnBolt, stepProjectile, turretHeading, type Combatant, type Projectile,
} from './combat';

const deg = (d: number) => (d * Math.PI) / 180;
const ship = (x: number, y: number, heading = 0, vx = 0, vy = 0): ShipState => ({ pos: { x, y }, vel: { x: vx, y: vy }, heading, fuel: 0 });
const comb = (id: string, s: ShipState, radius = 10): Combatant => ({ id, government: 'g', ship: s, radius, hull: fullHull(10, 10), outfits: {} });
const gun = (over: Partial<GunDef['effect']> = {}, category: 'gun' | 'turret' = 'gun') =>
  ({ id: 'g', name: 'G', category, tier: 1, price: 1, space: 1, effect: { damage: 6, rate: 4, speed: 500, range: 600, spread: 0, assist: 6, ...over } }) as unknown as GunDef;

describe('hull damage', () => {
  it('damage hits shields then overflows to armor', () => {
    const r = applyDamage(fullHull(10, 50), 15, 1);
    expect(r.hull.shields).toBe(0);
    expect(r.hull.armor).toBe(45);
    expect(r.shieldHit).toBe(true);
    expect(r.hull.lastHitSec).toBe(1);
  });
  it('disables below 10% armor', () => {
    const r = applyDamage({ ...fullHull(0, 100) }, 91, 1);
    expect(r.hull.armor).toBe(9);
    expect(r.disabledNow).toBe(true);
    expect(r.hull.disabled).toBe(true);
    expect(r.destroyed).toBe(false);
    expect(applyDamage(fullHull(0, 100), 50, 1).disabledNow).toBe(false);
  });
  it('a big hit on a healthy ship disables at armor 0, never destroys', () => {
    const r = applyDamage(fullHull(5, 50), 500, 1);
    expect(r.hull.armor).toBe(0);
    expect(r.hull.disabled).toBe(true);
    expect(r.disabledNow).toBe(true);
    expect(r.destroyed).toBe(false);
  });
  it('damage to a disabled ship to 0 destroys', () => {
    const d = applyDamage(fullHull(0, 100), 95, 1).hull;
    const r = applyDamage(d, 10, 2);
    expect(r.destroyed).toBe(true);
    expect(r.disabledNow).toBe(false);
    expect(applyDamage(d, 2, 2).destroyed).toBe(false);
  });
  it('no recharge within 2 s of a hit; 5%/s after', () => {
    const h = applyDamage(fullHull(100, 50), 60, 10).hull; // shields 40
    expect(rechargeHull(h, 1, 11.5).shields).toBe(40);
    expect(rechargeHull(h, 1, 12).shields).toBeCloseTo(45);
    expect(rechargeHull({ ...h, shields: 98 }, 1, 20).shields).toBe(100);
  });
  it('no recharge while disabled', () => {
    const h = applyDamage(fullHull(100, 50), 160, 0).hull;
    expect(h.disabled).toBe(true);
    expect(rechargeHull(h, 1, 50).shields).toBe(h.shields);
  });
});

describe('driftShip', () => {
  it('stops in about 8 s', () => {
    let s = ship(0, 0, 1, 100, 0);
    const dt = 1 / 60;
    for (let i = 0; i < DISABLED_STOP_SEC * 60; i++) s = driftShip(s, dt);
    expect(Math.hypot(s.vel.x, s.vel.y)).toBeLessThan(2);
    expect(s.pos.x).toBeGreaterThan(0);
    expect(s.heading).toBe(1);
    for (let i = 0; i < 120; i++) s = driftShip(s, dt);
    expect(s.vel).toEqual({ x: 0, y: 0 });
  });
});

describe('aiming', () => {
  it('leadPoint intercepts a crossing target', () => {
    const t = { pos: { x: 100, y: 0 }, vel: { x: 0, y: 50 } };
    const p = leadPoint({ x: 0, y: 0 }, 100, t);
    const time = Math.hypot(p.x, p.y) / 100;
    expect(p.x).toBeCloseTo(100);
    expect(p.y).toBeCloseTo(50 * time);
  });
  it('gun assist bends inside 6° and not outside', () => {
    const inside = comb('t', ship(1000 * Math.cos(deg(4)), 1000 * Math.sin(deg(4))));
    const outside = comb('t', ship(1000 * Math.cos(deg(9)), 1000 * Math.sin(deg(9))));
    expect(gunHeading(ship(0, 0, 0), inside, gun(), () => 0.5)).toBeCloseTo(deg(4));
    expect(gunHeading(ship(0, 0, 0), outside, gun(), () => 0.5)).toBe(0);
    expect(gunHeading(ship(0, 0, 0.3), null, gun(), () => 0.5)).toBe(0.3);
  });
  it('spread stays within ±spread', () => {
    const g = gun({ spread: 3, assist: 0 });
    expect(gunHeading(ship(0, 0, 0), null, g, () => 0)).toBeCloseTo(deg(-3));
    expect(gunHeading(ship(0, 0, 0), null, g, () => 1)).toBeCloseTo(deg(3));
    for (const v of [0.1, 0.4, 0.9]) expect(Math.abs(gunHeading(ship(0, 0, 0), null, g, () => v))).toBeLessThanOrEqual(deg(3) + 1e-9);
  });
  it('turret aims at the lead point; null out of range', () => {
    const t = comb('t', ship(0, 300, 0, 0, 0));
    const tg = gun({ range: 400 }, 'turret');
    expect(turretHeading(ship(0, 0, 0), t, tg)).toBeCloseTo(Math.PI / 2);
    expect(turretHeading(ship(0, 0, 0), comb('t', ship(0, 500)), tg)).toBeNull();
    expect(turretHeading(ship(0, 0, 0), null, tg)).toBeNull();
    const moving = comb('t', ship(300, 0, 0, 0, 100));
    expect(turretHeading(ship(0, 0, 0), moving, tg)).toBeGreaterThan(0.1);
  });
});

describe('projectiles', () => {
  const ammo = (turnRate: number) => ({ id: 'a', name: 'A', category: 'ammo', tier: 1, price: 1, space: 0, max: 5, effect: { damage: 40, speed: 100, range: 500, turnRate } }) as unknown as AmmoDef;
  it('projectile ttl = range / speed', () => {
    const b = spawnBolt(1, 'p', null, ship(0, 0, 0), 0, gun());
    expect(b.ttl).toBeCloseTo(600 / 500);
    expect(b.vel.x).toBeCloseTo(500);
    expect(b.kind).toBe('bolt');
    expect(spawnAmmo(2, 'p', 't', ship(0, 0, 0), 'rocket', ammo(0)).ttl).toBeCloseTo(5);
  });
  it('seeker turns toward its target at turnRate; rocket flies straight', () => {
    const target = comb('t', ship(0, 1000));
    const seeker = spawnAmmo(1, 'p', 't', ship(0, 0, 0), 'seeker', ammo(90));
    const s1 = stepProjectile(seeker, target, 0.5);
    expect(Math.atan2(s1.vel.y, s1.vel.x)).toBeCloseTo(deg(45));
    expect(Math.hypot(s1.vel.x, s1.vel.y)).toBeCloseTo(100);
    expect(s1.ttl).toBeCloseTo(seeker.ttl - 0.5);
    const rocket = spawnAmmo(2, 'p', 't', ship(0, 0, 0), 'rocket', ammo(0));
    const r1 = stepProjectile(rocket, target, 0.5);
    expect(r1.vel).toEqual({ x: 100, y: 0 });
    expect(r1.pos.x).toBeCloseTo(50);
    expect(stepProjectile(seeker, undefined, 0.5).vel).toEqual(seeker.vel);
  });
  it('hitTest is a circle check', () => {
    const p = { pos: { x: 9, y: 0 } } as Projectile;
    expect(hitTest(p, comb('t', ship(0, 0), 10))).toBe(true);
    expect(hitTest(p, comb('t', ship(0, 0), 8))).toBe(false);
  });
});

describe('beams', () => {
  it('beamTrace hits the nearest circle only, within range', () => {
    const near = comb('near', ship(100, 0), 10);
    const far = comb('far', ship(200, 0), 10);
    const off = comb('off', ship(50, 100), 10);
    const r = beamTrace({ x: 0, y: 0 }, 0, 500, [far, off, near]);
    expect(r.hitId).toBe('near');
    expect(r.to.x).toBeCloseTo(90);
    const miss = beamTrace({ x: 0, y: 0 }, 0, 150, [far, off]);
    expect(miss.hitId).toBeNull();
    expect(miss.to.x).toBeCloseTo(150);
    expect(beamTrace({ x: 0, y: 0 }, Math.PI, 500, [near]).hitId).toBeNull();
  });
});
