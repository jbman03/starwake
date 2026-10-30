import type { GameData, StandingLevel } from '../data/schemas';
import type { AiSelf } from './ai';
import { decide, isHostileTo, RAIDERS } from './ai';
import {
  applyDamage,
  beamTrace,
  driftShip,
  fullHull,
  gunHeading,
  hitTest,
  LOW_ARMOR_FRACTION,
  PLAYER_ID,
  rechargeHull,
  spawnAmmo,
  spawnBolt,
  stepProjectile,
  turretHeading,
  type BeamShot,
  type Combatant,
  type Hull,
  type Projectile,
  type ShotKind,
} from './combat';
import { stepShip } from './flight';
import { hashString, mulberry32 } from './random';
import { JUMP_POINT_MARGIN, SYSTEM_CENTER } from './rules';
import { worldStats } from './shipStats';
import { STANDING_RANK, standingOf } from './standing';
import { isTargetable, type Npc, type Traffic } from './traffic';
import type { FrameInput, ShipState, WorldState } from './types';
import { add, dist, fromAngle, norm, scale, sub, type Vec2 } from './vec';
import { weaponsOf } from './weapons';

export interface Battle {
  systemId: string;
  player: Hull;
  projectiles: Projectile[];
  /** This tick's beams, for drawing. */
  beams: BeamShot[];
  /** `${ownerId}:${outfitId}` -> seconds until the next shot. */
  cooldowns: Record<string, number>;
  /** The selected launcher outfit id. */
  secondary: string | null;
  /** Governments hostile to the player this visit. */
  angry: string[];
  nextShotId: number;
}

export type BattleEvent =
  | { type: 'shot'; ownerId: string; kind: ShotKind | 'beam' }
  | { type: 'hit'; targetId: string; shield: boolean; pos: Vec2 }
  | { type: 'disabled'; id: string; byPlayer: boolean }
  | { type: 'destroyed'; id: string; byPlayer: boolean; pos: Vec2 }
  | { type: 'playerDisabled' }
  | { type: 'playerDestroyed'; pos: Vec2 }
  | { type: 'lowArmor' }
  | { type: 'angered'; government: string }
  | { type: 'fled'; id: string };

const STANDING_BY_RANK: StandingLevel[] = ['cool', 'neutral', 'friend'];
/** Held-weapon names the controller may add before the action list does. */
const CYCLE_SECONDARY = 'cycleSecondary';

const hasAmmo = (outfits: Record<string, number>, launcherAmmo: string): boolean => (outfits[launcherAmmo] ?? 0) > 0;

/** Launcher outfit ids, in id order, that have ammo to fire. */
function loadedLaunchers(outfits: Record<string, number>, data: GameData): string[] {
  return weaponsOf(outfits, data).launchers.filter((l) => hasAmmo(outfits, l.def.effect.ammo)).map((l) => l.def.id);
}

export function newBattle(world: WorldState, data: GameData): Battle {
  const st = worldStats(world, data);
  return {
    systemId: world.systemId,
    player: fullHull(st.shields, st.armor),
    projectiles: [],
    beams: [],
    cooldowns: {},
    secondary: loadedLaunchers(world.outfits, data)[0] ?? null,
    angry: [],
    nextShotId: 1,
  };
}

/** The next launcher that has ammo, in id order, wrapping round; null with none. */
export function cycleSecondary(b: Battle, world: WorldState, data: GameData): Battle {
  const ready = loadedLaunchers(world.outfits, data);
  if (ready.length === 0) return b.secondary === null ? b : { ...b, secondary: null };
  const i = b.secondary ? ready.indexOf(b.secondary) : -1;
  const next = i < 0 ? ready[0] : ready[(i + 1) % ready.length];
  return next === b.secondary ? b : { ...b, secondary: next };
}

export const playerTargetId = (traffic: Traffic): string | null => traffic.targetId;

const isRaider = (n: Npc): boolean => n.role === 'raider' || n.government === RAIDERS;

function combatantOf(n: Npc, data: GameData): Combatant {
  return { id: n.id, government: n.government, ship: n.ship, radius: data.ships[n.shipId].radius, hull: n.hull, outfits: n.outfits };
}

function playerCombatant(b: Battle, world: WorldState, data: GameData): Combatant {
  return { id: PLAYER_ID, government: '', ship: world.ship, radius: data.ships[world.shipId].radius, hull: b.player, outfits: world.outfits };
}

/** The furthest an NPC's guns and beams reach; launchers count only when it has nothing else. */
function fireRangeOf(outfits: Record<string, number>, data: GameData): number {
  const w = weaponsOf(outfits, data);
  const direct = [...w.guns.map((g) => g.def.effect.range), ...w.beams.map((x) => x.def.effect.range)];
  if (direct.length) return Math.max(...direct);
  const ammo = w.launchers.map((l) => data.outfits[l.def.effect.ammo]).filter((a) => a && a.category === 'ammo');
  return Math.max(0, ...ammo.map((a) => (a.category === 'ammo' ? a.effect.range : 0)));
}

function aiSelfOf(n: Npc, me: Combatant, data: GameData): AiSelf {
  return {
    role: n.role,
    me,
    peaceful: n.peaceful || n.demand,
    aggro: n.aggro,
    maxSpeed: data.ships[n.shipId].maxSpeed,
    fireRange: fireRangeOf(n.outfits, data),
  };
}

/** Nearest targetable, active NPC that is hostile to the player (a stood-down raider is not). */
export function nearestHostile(world: WorldState, traffic: Traffic, b: Battle): string | null {
  const player: Combatant = { id: PLAYER_ID, government: '', ship: world.ship, radius: 0, hull: b.player, outfits: world.outfits };
  let best: string | null = null;
  let bestD = Infinity;
  for (const n of traffic.npcs) {
    if (!isTargetable(n) || n.hull.disabled) continue;
    const me: Combatant = { id: n.id, government: n.government, ship: n.ship, radius: 0, hull: n.hull, outfits: n.outfits };
    const self: AiSelf = { role: n.role, me, peaceful: n.peaceful, aggro: n.aggro, maxSpeed: 0, fireRange: 0 };
    if (!isHostileTo(self, player, b.angry)) continue;
    const d = dist(world.ship.pos, n.ship.pos);
    if (d < bestD) {
      bestD = d;
      best = n.id;
    }
  }
  return best;
}

/** A hit queued this tick: damage from `ownerId` on `targetId` at `pos`. */
interface Hit { ownerId: string; targetId: string; damage: number; pos: Vec2 }

/** Mutable scratch for one tick; stepBattle copies its inputs into it and hands back fresh objects. */
interface Tick {
  cooldowns: Record<string, number>;
  nextShotId: number;
  projectiles: Projectile[];
  beams: BeamShot[];
  hits: Hit[];
  events: BattleEvent[];
  prevBeamOwners: Set<string>;
  seed: number;
  dt: number;
}

interface Triggers { guns: boolean; turrets: boolean; beams: boolean }

const ready = (t: Tick, key: string): boolean => (t.cooldowns[key] ?? 0) <= 0;

/** Fire the primary mounts of one ship: guns, turrets and beams. */
function firePrimary(
  t: Tick,
  c: Combatant,
  target: Combatant | null,
  turretTarget: Combatant | null,
  on: Triggers,
  victims: Combatant[],
  data: GameData,
): void {
  const w = weaponsOf(c.outfits, data);
  for (const { def, count } of w.guns) {
    const isTurret = def.category === 'turret';
    if (isTurret ? !on.turrets : !on.guns) continue;
    const key = `${c.id}:${def.id}`;
    if (!ready(t, key)) continue;
    const aimTurret = isTurret ? turretHeading(c.ship, turretTarget, def) : null;
    if (isTurret && aimTurret === null) continue;
    for (let i = 0; i < count; i++) {
      const id = t.nextShotId++;
      const heading = aimTurret ?? gunHeading(c.ship, target, def, mulberry32(hashString(t.seed, 'spread', id)));
      // Several mounts of one kind leave from points spread across the nose.
      const across = count > 1 ? (i / (count - 1) - 0.5) * 2 : 0;
      const origin = add(c.ship.pos, scale(fromAngle(c.ship.heading + Math.PI / 2), across * (c.radius / 2)));
      t.projectiles.push(spawnBolt(id, c.id, target?.id ?? null, { ...c.ship, pos: origin }, heading, def));
    }
    t.cooldowns[key] = 1 / def.effect.rate;
    t.events.push({ type: 'shot', ownerId: c.id, kind: 'bolt' });
  }
  if (!on.beams) return;
  for (const { def, count } of w.beams) {
    const r = beamTrace(c.ship.pos, c.ship.heading, def.effect.range, victims);
    t.beams.push({ ownerId: c.id, from: { ...c.ship.pos }, to: r.to, hitId: r.hitId });
    if (r.hitId) t.hits.push({ ownerId: c.id, targetId: r.hitId, damage: def.effect.dps * count * t.dt, pos: r.to });
    if (!t.prevBeamOwners.has(c.id)) t.events.push({ type: 'shot', ownerId: c.id, kind: 'beam' });
    t.prevBeamOwners.add(c.id);
  }
}

/** Fire one launcher round, if the cooldown and ammo allow. Returns the outfits after the ammo is spent. */
function fireLauncher(t: Tick, c: Combatant, launcherId: string, target: Combatant | null, outfits: Record<string, number>, data: GameData): Record<string, number> {
  const def = data.outfits[launcherId];
  if (!def || def.category !== 'launcher' || (outfits[launcherId] ?? 0) <= 0) return outfits;
  const ammoId = def.effect.ammo;
  const ammo = data.outfits[ammoId];
  const key = `${c.id}:${launcherId}`;
  if (!ammo || ammo.category !== 'ammo' || !hasAmmo(outfits, ammoId) || !ready(t, key)) return outfits;
  const kind = ammo.effect.turnRate > 0 ? 'seeker' : 'rocket';
  t.projectiles.push(spawnAmmo(t.nextShotId++, c.id, target?.id ?? null, c.ship, kind, ammo));
  t.cooldowns[key] = 1 / def.effect.rate;
  t.events.push({ type: 'shot', ownerId: c.id, kind });
  const left = { ...outfits, [ammoId]: outfits[ammoId] - 1 };
  if (left[ammoId] <= 0) delete left[ammoId];
  return left;
}

/** The nearest point on the system's jump boundary, outward from the centre through the ship. */
function fleePoint(ship: ShipState, jumpDistance: number): Vec2 {
  const d = norm(sub(ship.pos, SYSTEM_CENTER));
  const dir = d.x === 0 && d.y === 0 ? { x: 1, y: 0 } : d;
  return add(SYSTEM_CENTER, scale(dir, jumpDistance + JUMP_POINT_MARGIN));
}

export function stepBattle(
  b: Battle,
  world: WorldState,
  traffic: Traffic,
  input: FrameInput,
  data: GameData,
  dt: number,
): { battle: Battle; traffic: Traffic; world: WorldState; events: BattleEvent[] } {
  const now = world.timeSec;
  const events: BattleEvent[] = [];
  const t: Tick = {
    cooldowns: {},
    nextShotId: b.nextShotId,
    projectiles: [],
    beams: [],
    hits: [],
    events,
    prevBeamOwners: new Set(b.beams.map((x) => x.ownerId)),
    seed: world.seed,
    dt,
  };
  for (const [k, v] of Object.entries(b.cooldowns)) if (v - dt > 0) t.cooldowns[k] = v - dt;

  // 1. Recharge every hull.
  let playerHull = rechargeHull(b.player, dt, now);
  let battle: Battle = { ...b, player: playerHull };
  let npcs: Npc[] = traffic.npcs.map((n) => (isTargetable(n) ? { ...n, hull: rechargeHull(n.hull, dt, now) } : n));
  let outfits = world.outfits;

  /** A destroyed player hull is marked with armor -1 (applyDamage alone would report `destroyed` again on every later hit). */
  const alive = (h: Hull) => h.armor >= 0;
  const playerC = (): Combatant => playerCombatant({ ...battle, player: playerHull }, world, data);
  /** Who can be hit right now: the player and every targetable NPC that is not already wrecked. */
  const combatants = (): Combatant[] => [
    ...(alive(playerHull) ? [playerC()] : []),
    ...npcs.filter((n) => isTargetable(n) && alive(n.hull)).map((n) => combatantOf(n, data)),
  ];
  const targetNpc = npcs.find((n) => n.id === traffic.targetId && isTargetable(n) && alive(n.hull));

  // 2. Player fire.
  if ((input.pressed as ReadonlySet<string>).has(CYCLE_SECONDARY)) battle = cycleSecondary(battle, world, data);
  if (!world.jump && !playerHull.disabled && alive(playerHull)) {
    const me = playerC();
    const victims = combatants().filter((c) => c.id !== PLAYER_ID);
    const target = targetNpc ? combatantOf(targetNpc, data) : null;
    if (input.actions.has('firePrimary')) {
      const nearId = target ? null : nearestHostile(world, { ...traffic, npcs }, { ...battle, player: playerHull });
      const near = nearId ? victims.find((c) => c.id === nearId) ?? null : null;
      firePrimary(t, me, target, target ?? near, { guns: true, turrets: true, beams: true }, victims, data);
    }
    if (input.actions.has('fireSecondary') && battle.secondary) outfits = fireLauncher(t, me, battle.secondary, target, outfits, data);
  }

  // 3. NPC decisions.
  const sys = data.systems[world.systemId];
  const flee: string[] = [];
  const next: Npc[] = [];
  const all = combatants();
  for (const n of npcs) {
    if (!isTargetable(n)) {
      next.push(n);
      continue;
    }
    if (n.hull.disabled) {
      next.push({ ...n, ship: driftShip(n.ship, dt), thrusting: false });
      continue;
    }
    const def = data.ships[n.shipId];
    const me = combatantOf(n, data);
    const others = all.filter((c) => c.id !== n.id);
    const d = decide(aiSelfOf(n, me, data), others, battle.angry, fleePoint(n.ship, sys.jumpDistance), data);
    if (d.mode === 'flee') {
      if (!n.fled) flee.push(n.id);
      next.push({ ...n, engaged: false, errand: 'pass', portId: null, fled: true });
    } else if (d.mode === 'errand') {
      next.push(n.engaged ? { ...n, engaged: false } : n);
    } else {
      const ship = stepShip(n.ship, def, d.input, dt);
      const moved: Npc = { ...n, ship, thrusting: d.input.thrust, engaged: true, fled: false };
      const mc = combatantOf(moved, data);
      const target = others.find((c) => c.id === d.targetId) ?? null;
      firePrimary(t, mc, target, target, { guns: d.fire, turrets: true, beams: d.fire }, others, data);
      let spent = moved.outfits;
      if (d.fire && target) {
        for (const l of weaponsOf(spent, data).launchers) {
          const ammo = data.outfits[l.def.effect.ammo];
          if (!ammo || ammo.category !== 'ammo' || dist(ship.pos, target.ship.pos) > ammo.effect.range * 0.9) continue;
          const after = fireLauncher(t, mc, l.def.id, target, spent, data);
          if (after !== spent) {
            spent = after;
            break;
          }
        }
      }
      next.push(spent === moved.outfits ? moved : { ...moved, outfits: spent });
    }
  }
  npcs = next;
  for (const id of flee) events.push({ type: 'fled', id });

  // 4. Move projectiles and hit-test them against everyone but their owner.
  const targets = combatants();
  const survivors: Projectile[] = [];
  for (const p0 of [...b.projectiles, ...t.projectiles]) {
    const homing = p0.targetId ? targets.find((c) => c.id === p0.targetId) : undefined;
    const p = stepProjectile(p0, homing, dt);
    let hit: Combatant | null = null;
    let hitD = Infinity;
    for (const c of targets) {
      if (c.id === p.ownerId || !hitTest(p, c)) continue;
      const dd = dist(p.pos, c.ship.pos);
      if (dd < hitD) {
        hitD = dd;
        hit = c;
      }
    }
    if (hit) t.hits.push({ ownerId: p.ownerId, targetId: hit.id, damage: p.damage, pos: { ...p.pos } });
    else if (p.ttl > 0) survivors.push(p);
  }

  // 5 and 6. Damage, standing, kills and events.
  let stats = world.stats;
  let standing = world.standing;
  const angry = [...battle.angry];
  const dead = new Set<string>();
  const byId = new Map(npcs.map((n) => [n.id, n]));
  for (const h of t.hits) {
    const byPlayer = h.ownerId === PLAYER_ID;
    if (h.targetId === PLAYER_ID) {
      if (!alive(playerHull)) continue;
      const before = playerHull;
      const r = applyDamage(before, h.damage, now);
      playerHull = r.hull;
      events.push({ type: 'hit', targetId: PLAYER_ID, shield: r.shieldHit, pos: h.pos });
      if (before.maxArmor > 0 && before.armor / before.maxArmor >= LOW_ARMOR_FRACTION && r.hull.armor / r.hull.maxArmor < LOW_ARMOR_FRACTION) events.push({ type: 'lowArmor' });
      if (r.disabledNow) events.push({ type: 'playerDisabled' });
      if (r.destroyed) {
        playerHull = { ...playerHull, armor: -1 };
        events.push({ type: 'playerDestroyed', pos: h.pos });
      }
      continue;
    }
    const n = byId.get(h.targetId);
    if (!n || dead.has(n.id)) continue;
    const r = applyDamage(n.hull, h.damage, now);
    let updated: Npc = { ...n, hull: r.hull, aggro: n.aggro.includes(h.ownerId) ? n.aggro : [...n.aggro, h.ownerId] };
    events.push({ type: 'hit', targetId: n.id, shield: r.shieldHit, pos: h.pos });
    if (byPlayer && !isRaider(n)) {
      if (!angry.includes(n.government)) {
        angry.push(n.government);
        const rank = STANDING_RANK[standingOf({ standing }, n.government)];
        standing = { ...standing, [n.government]: STANDING_BY_RANK[Math.max(0, rank - 1)] };
        events.push({ type: 'angered', government: n.government });
      }
      if (n.role === 'patrol' && (r.disabledNow || r.destroyed)) standing = { ...standing, [n.government]: 'cool' };
    }
    if (r.disabledNow) events.push({ type: 'disabled', id: n.id, byPlayer });
    if (r.destroyed) {
      events.push({ type: 'destroyed', id: n.id, byPlayer, pos: h.pos });
      dead.add(n.id);
    }
    if (byPlayer && (r.disabledNow || r.destroyed) && !updated.killCounted) {
      stats = { ...stats, kills: stats.kills + 1 };
      updated = { ...updated, killCounted: true };
    }
    byId.set(n.id, updated);
  }

  const finalNpcs = npcs.filter((n) => !dead.has(n.id)).map((n) => byId.get(n.id) ?? n);
  const nextWorld: WorldState = { ...world, outfits, stats, standing };
  return {
    battle: { ...battle, player: playerHull, projectiles: survivors, beams: t.beams, cooldowns: t.cooldowns, angry, nextShotId: t.nextShotId },
    traffic: { ...traffic, npcs: finalNpcs, targetId: traffic.targetId && dead.has(traffic.targetId) ? null : traffic.targetId },
    world: nextWorld,
    events,
  };
}
