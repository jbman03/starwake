import type { GameData, PlanetDef, ShipDef } from '../data/schemas';
import { autopilotInput } from './assists';
import type { NpcRole } from './ai';
import { fullHull, type Hull } from './combat';
import { shipStats } from './shipStats';
import { npcLoadout } from './weapons';
import { stepShip } from './flight';
import { lanesOf, systemOpen } from './galaxy';
import { hashString, mulberry32, pick, randInt } from './random';
import { JUMP_POINT_MARGIN, SYSTEM_CENTER } from './rules';
import type { ShipState, SiteTarget, WorldState } from './types';
import { add, angleOf, dist, norm, scale, sub, type Vec2 } from './vec';
import { AUTOPILOT_ARRIVE_SPEED, JUMP_ARRIVAL_INSET } from './world';

export type Errand = 'arrive' | 'depart' | 'pass';
export type NpcPhase = 'jumpIn' | 'fly' | 'land' | 'jumpOut' | 'gone';

export interface Npc {
  id: string;
  name: string;
  shipId: string;
  government: string;
  errand: Errand;
  ship: ShipState;
  portId: string | null;
  phase: NpcPhase;
  phaseT: number;
  thrusting: boolean;
  /** A story ship: it flies here and waits (never lands or jumps). */
  hold?: Vec2;
  role: NpcRole;
  hull: Hull;
  /** Its loadout; ammo counts go down as it fires. */
  outfits: Record<string, number>;
  /** Ids (npc ids or the player's) that have attacked this ship; it fights back at them. */
  aggro: string[];
  /** Battle is moving this ship, so traffic leaves it alone. */
  engaged: boolean;
  /** A raider that has stood down (or any ship that won't fight). */
  peaceful: boolean;
  /** A raider that will hail first and demand a payment. */
  demand: boolean;
  /** The bounty mission this ship is the target of. */
  missionId?: string;
}

export interface TrafficOpts {
  maxNpcs: number;
  guideActive: boolean;
  startSystem: string;
  /** The system of an active clear job, where raiders are likelier. */
  clearBoost?: string;
}

export interface Traffic {
  systemId: string;
  npcs: Npc[];
  spawnCount: number;
  nextSpawnSec: number;
  targetId: string | null;
}

export type TrafficEvent = { type: 'npcJumpIn' | 'npcJumpOut' | 'npcLanded' | 'npcTookOff'; id: string };

const JUMP_SEC = 1.0;
const LAND_SEC = 0.4;
/** A ship still flying after this long finishes its errand where it is (safety net). */
const FLY_TIMEOUT_SEC = 150;
const EXIT_RADIUS = 60;
/** A story ship counts as arrived within this many px of its hold position. */
const HOLD_RADIUS = 30;
/** Where a story ship starts, relative to its hold position, when none is given. */
const HOLD_APPROACH: Vec2 = { x: 600, y: 0 };
const ZERO: Vec2 = { x: 0, y: 0 };

/** Chance weight by hull role. */
const ROLE_WEIGHT: Record<ShipDef['role'], number> = {
  starter: 2,
  courier: 3,
  scout: 2,
  freighter: 5,
  heavyFreighter: 2,
  liner: 3,
  interceptor: 1,
  corvette: 1,
  trader: 3,
  carrier: 1,
};

const portsOf = (data: GameData, systemId: string): PlanetDef[] =>
  Object.values(data.planets).filter((p) => p.systemId === systemId);

/** [min, max] ships wanted in a system. The system's own `traffic` field wins. */
export function trafficLevel(data: GameData, systemId: string): [number, number] {
  const sys = data.systems[systemId];
  if (sys.traffic) return [sys.traffic[0], sys.traffic[1]];
  if (sys.government === 'unlit') return [0, 2];
  if (portsOf(data, systemId).every((p) => p.techTier <= 1)) return [0, 2];
  return sys.government === 'concord' ? [3, 5] : [2, 3];
}

const isFringe = (data: GameData, systemId: string): boolean => portsOf(data, systemId).every((p) => p.techTier <= 1);

/** Chance that a spawn in this system is a raider. */
export function raiderChance(data: GameData, systemId: string, opts: TrafficOpts): number {
  if (opts.guideActive || systemId === opts.startSystem) return 0;
  const sp = data.combat.spawn;
  if (opts.clearBoost === systemId) return sp.clearBoost;
  const byGov = sp.raiderChance[data.systems[systemId].government] ?? 0;
  return isFringe(data, systemId) ? Math.max(byGov, sp.raiderChance.fringe ?? 0) : byGov;
}

/** Chance that a spawn in this system is a patrol. */
export const patrolChance = (data: GameData, systemId: string): number => data.combat.spawn.patrolChance[data.systems[systemId].government] ?? 0;

/** A weighted pick of `ids` (tier-limited, falling back to all of them), from the seeded stream. */
function pickFrom(data: GameData, weights: Record<string, number>, bestTier: number, r: () => number): ShipDef {
  const all = Object.entries(weights).filter(([id]) => data.ships[id]);
  const fit = all.filter(([id]) => data.ships[id].techTier <= bestTier);
  const pool = fit.length ? fit : all;
  const total = pool.reduce((sum, [, w]) => sum + w, 0);
  let x = r() * total;
  for (const [id, w] of pool) {
    x -= w;
    if (x < 0) return data.ships[id];
  }
  return data.ships[pool[pool.length - 1][0]];
}

const combatState = (def: ShipDef, data: GameData) => {
  const outfits = { ...npcLoadout(def) };
  const st = shipStats(def.id, outfits, data);
  return { outfits, hull: fullHull(st.shields, st.armor) };
};

function pickHull(data: GameData, systemId: string, r: () => number): ShipDef {
  const ports = portsOf(data, systemId);
  const bestTier = Math.max(1, ...ports.map((p) => p.techTier));
  const hub = ports.some((p) => p.hub);
  const pool = Object.values(data.ships).filter(
    (s) => !s.unique && s.techTier <= bestTier && (s.role !== 'carrier' || hub),
  );
  const total = pool.reduce((sum, s) => sum + ROLE_WEIGHT[s.role], 0);
  let x = r() * total;
  for (const s of pool) {
    x -= ROLE_WEIGHT[s.role];
    if (x < 0) return s;
  }
  return pool[pool.length - 1];
}

/** The lanes NPCs travel: into a hidden system only once its flag is set (lanesOf already requires it). */
export function npcLanes(world: WorldState, data: GameData): string[] {
  return lanesOf(data, world.systemId, world.flags).filter((l) => data.systems[l] && systemOpen(data.systems[l], world.flags));
}

/** The lane an NPC uses to enter or leave, chosen from its id so it never needs storing. */
function laneDir(world: WorldState, data: GameData, id: string, salt: string): { dir: Vec2; toId: string | null } {
  const sys = data.systems[world.systemId];
  const lanes = npcLanes(world, data);
  if (lanes.length === 0) return { dir: { x: 1, y: 0 }, toId: null };
  const toId = lanes[hashString(world.seed, salt, id) % lanes.length];
  const d = norm(sub(data.systems[toId].mapPos, sys.mapPos));
  return { dir: d.x === 0 && d.y === 0 ? { x: 1, y: 0 } : d, toId };
}

const entryPos = (world: WorldState, data: GameData, id: string): Vec2 =>
  add(SYSTEM_CENTER, scale(laneDir(world, data, id, 'npcin').dir, data.systems[world.systemId].jumpDistance - JUMP_ARRIVAL_INSET));

const exitPos = (world: WorldState, data: GameData, id: string): Vec2 =>
  add(SYSTEM_CENTER, scale(laneDir(world, data, id, 'npcout').dir, data.systems[world.systemId].jumpDistance + JUMP_POINT_MARGIN));

/** A pilot's name for a ship, from the name lists. */
export const shipName = (r: () => number, data: GameData): string => `${pick(r, data.names.first)} ${pick(r, data.names.second)}`;

function spawnNpc(t: Traffic, world: WorldState, data: GameData, opts: TrafficOpts, midErrand: boolean): { npc: Npc; event: TrafficEvent | null } {
  const r = mulberry32(hashString(world.seed, 'npc', t.systemId, world.day, t.spawnCount));
  let def = pickHull(data, t.systemId, r);
  const ports = portsOf(data, t.systemId);
  const roll = r();
  const errand: Errand = ports.length === 0 || roll >= 0.7 ? 'pass' : roll < 0.4 ? 'arrive' : 'depart';
  const port = errand === 'pass' ? null : pick(r, ports);
  const name = shipName(r, data);
  const id = `npc-${t.systemId}-${world.day}-${t.spawnCount}`;
  const frac = 0.15 + r() * 0.7;

  const from = port && errand === 'depart' ? port.pos : entryPos(world, data, id);
  const to = port && errand === 'arrive' ? port.pos : exitPos(world, data, id);
  const pos = midErrand ? add(from, scale(sub(to, from), frac)) : from;
  // Arrivals and pass-throughs fly the flag of the system they came from.
  const origin = errand === 'depart' ? null : laneDir(world, data, id, 'npcin').toId;
  let government = origin ? data.systems[origin].government : data.systems[t.systemId].government;

  // The role comes last so the draws above stay where they were.
  const bestTier = Math.max(1, ...ports.map((p) => p.techTier));
  const rr = raiderChance(data, t.systemId, opts);
  const pr = patrolChance(data, t.systemId);
  const x = r();
  const hostile = t.npcs.filter((n) => n.role === 'raider' && !n.peaceful).length;
  let role: NpcRole = x < rr ? 'raider' : x < rr + pr ? 'patrol' : 'trader';
  if (role === 'raider' && hostile >= data.combat.spawn.maxHostileRaiders) role = 'trader';
  let demand = false;
  if (role === 'raider') {
    def = pickFrom(data, data.combat.spawn.raiderHulls, bestTier, r);
    government = 'raiders';
    demand = r() < 0.5;
  } else if (role === 'patrol') {
    def = pickFrom(data, Object.fromEntries(data.combat.spawn.patrolHulls.map((h) => [h, 1])), bestTier, r);
    government = data.systems[t.systemId].government;
  }

  const npc: Npc = {
    id,
    name,
    shipId: def.id,
    government,
    errand,
    ship: { pos, vel: { ...ZERO }, heading: angleOf(sub(to, from)), fuel: def.fuelCapacity },
    portId: port ? port.id : null,
    phase: midErrand || errand === 'depart' ? 'fly' : 'jumpIn',
    phaseT: 0,
    thrusting: false,
    role,
    ...combatState(def, data),
    aggro: [],
    engaged: false,
    peaceful: false,
    demand,
  };
  const event: TrafficEvent | null = midErrand ? null : { type: errand === 'depart' ? 'npcTookOff' : 'npcJumpIn', id };
  return { npc, event };
}

const nextWait = (world: WorldState, systemId: string, spawnCount: number): number =>
  8 + mulberry32(hashString(world.seed, 'npcwait', systemId, world.day, spawnCount))() * 12;

/** How many ships this system wants right now (drawn once per system and day). */
function wantedCount(world: WorldState, data: GameData, systemId: string, maxNpcs: number): number {
  const [lo, hi] = trafficLevel(data, systemId);
  const n = randInt(mulberry32(hashString(world.seed, 'npclevel', systemId, world.day)), lo, hi);
  return Math.min(n, maxNpcs);
}

/** A system's traffic when the pilot arrives: the level minimum, spread mid-errand. */
export function seedTraffic(world: WorldState, data: GameData, opts: TrafficOpts): Traffic {
  let t: Traffic = { systemId: world.systemId, npcs: [], spawnCount: 0, nextSpawnSec: 0, targetId: null };
  const n = Math.min(trafficLevel(data, world.systemId)[0], opts.maxNpcs);
  for (let i = 0; i < n; i++) {
    const { npc } = spawnNpc(t, world, data, opts, true);
    t = { ...t, npcs: [...t.npcs, npc], spawnCount: t.spawnCount + 1 };
  }
  return { ...t, nextSpawnSec: nextWait(world, world.systemId, t.spawnCount) };
}

function stepNpc(npc: Npc, world: WorldState, data: GameData, dt: number, events: TrafficEvent[]): Npc {
  const def = data.ships[npc.shipId];
  const phaseT = npc.phaseT + dt;
  if (npc.phase === 'jumpIn') return phaseT >= JUMP_SEC ? { ...npc, phase: 'fly', phaseT: 0 } : { ...npc, phaseT };
  if (npc.phase === 'land') return phaseT >= LAND_SEC ? { ...npc, phase: 'gone', phaseT: 0 } : { ...npc, phaseT };
  if (npc.phase === 'jumpOut') {
    const ship = stepShip(npc.ship, def, { thrust: false, turn: 0 }, dt);
    return phaseT >= JUMP_SEC ? { ...npc, ship, phase: 'gone', phaseT: 0 } : { ...npc, ship, phaseT };
  }
  if (npc.phase === 'gone') return npc;
  // Battle moves an engaged or disabled ship; its errand is on hold (no timeout either).
  if (npc.engaged || npc.hull.disabled) return npc;

  if (npc.hold) {
    const r = autopilotInput(npc.ship, def, npc.hold, HOLD_RADIUS, AUTOPILOT_ARRIVE_SPEED);
    if (r.arrived) return { ...npc, ship: { ...npc.ship, vel: { ...ZERO } }, phaseT, thrusting: false };
    return { ...npc, ship: stepShip(npc.ship, def, r.input, dt), phaseT, thrusting: r.input.thrust };
  }

  const port = npc.errand === 'arrive' && npc.portId ? data.planets[npc.portId] : null;
  const dest = port ? port.pos : exitPos(world, data, npc.id);
  const radius = port ? port.radius + def.radius + data.config.arrivalRadius : EXIT_RADIUS;
  const r = autopilotInput(npc.ship, def, dest, radius, AUTOPILOT_ARRIVE_SPEED);
  const finished = r.arrived || phaseT >= FLY_TIMEOUT_SEC || (!port && dist(npc.ship.pos, dest) < EXIT_RADIUS);
  if (finished) {
    if (port) {
      events.push({ type: 'npcLanded', id: npc.id });
      return { ...npc, ship: { ...npc.ship, vel: { ...ZERO } }, phase: 'land', phaseT: 0, thrusting: false };
    }
    events.push({ type: 'npcJumpOut', id: npc.id });
    return { ...npc, phase: 'jumpOut', phaseT: 0, thrusting: false };
  }
  return { ...npc, ship: stepShip(npc.ship, def, r.input, dt), phaseT, thrusting: r.input.thrust };
}

export function stepTraffic(
  t: Traffic,
  world: WorldState,
  data: GameData,
  dt: number,
  opts: TrafficOpts,
): { traffic: Traffic; events: TrafficEvent[] } {
  const events: TrafficEvent[] = [];
  const npcs = t.npcs.map((n) => stepNpc(n, world, data, dt, events)).filter((n) => n.phase !== 'gone');
  let next: Traffic = { ...t, npcs, nextSpawnSec: t.nextSpawnSec - dt };
  if (next.nextSpawnSec <= 0) {
    const want = wantedCount(world, data, t.systemId, opts.maxNpcs);
    const ordinary = npcs.filter((n) => !n.hold).length;
    if (ordinary < want && ordinary < opts.maxNpcs) {
      const { npc, event } = spawnNpc(next, world, data, opts, false);
      if (event) events.push(event);
      next = { ...next, npcs: [...npcs, npc], spawnCount: next.spawnCount + 1 };
    }
    next = { ...next, nextSpawnSec: nextWait(world, t.systemId, next.spawnCount) };
  }
  return { traffic: next, events };
}

/** Add a named story ship that flies to `holdPos` and waits there. It is targetable like any other ship. */
export function addStoryNpc(
  t: Traffic,
  spec: { id: string; name: string; shipId: string; government: string; holdPos: Vec2; from?: Vec2 },
  data: GameData,
): Traffic {
  const from = spec.from ?? add(spec.holdPos, HOLD_APPROACH);
  const npc: Npc = {
    id: spec.id,
    name: spec.name,
    shipId: spec.shipId,
    government: spec.government,
    errand: 'pass',
    ship: { pos: from, vel: { ...ZERO }, heading: angleOf(sub(spec.holdPos, from)), fuel: 0 },
    portId: null,
    phase: 'fly',
    phaseT: 0,
    thrusting: false,
    hold: spec.holdPos,
    role: 'trader',
    ...combatState(data.ships[spec.shipId], data),
    aggro: [],
    engaged: false,
    peaceful: false,
    demand: false,
  };
  return { ...t, npcs: [...t.npcs.filter((n) => n.id !== spec.id), npc] };
}

/** Add a bounty target: a raider that waits at `pos`, is never peaceful and never makes a demand. */
export function addBountyNpc(
  t: Traffic,
  spec: { id: string; name: string; shipId: string; missionId: string; pos: Vec2 },
  data: GameData,
): Traffic {
  const npc: Npc = {
    id: spec.id,
    name: spec.name,
    shipId: spec.shipId,
    government: 'raiders',
    errand: 'pass',
    ship: { pos: spec.pos, vel: { ...ZERO }, heading: 0, fuel: 0 },
    portId: null,
    phase: 'fly',
    phaseT: 0,
    thrusting: false,
    hold: spec.pos,
    role: 'raider',
    ...combatState(data.ships[spec.shipId], data),
    aggro: [],
    engaged: false,
    peaceful: false,
    demand: false,
    missionId: spec.missionId,
  };
  return { ...t, npcs: [...t.npcs.filter((n) => n.id !== spec.id), npc] };
}

/** "Brass Heron — Concord Mule (freighter)": name, government's first word, hull's first word, role. */
export function npcLabel(npc: Npc, data: GameData): string {
  const def = data.ships[npc.shipId];
  const gov = (data.governments[npc.government]?.name ?? npc.government).split(' ')[0];
  const role = def.role.replace(/([A-Z])/g, ' $1').toLowerCase();
  return `${npc.name} — ${gov} ${def.name.split(' ')[0]} (${role})`;
}

/** Ships a pilot can target: flying (or just arrived), not landing or leaving. */
export const isTargetable = (n: Npc): boolean => n.phase === 'fly' || n.phase === 'jumpIn';

/** The targeted NPC, if it is still there and targetable. */
export const targetedNpc = (t: Traffic | null): Npc | undefined =>
  t?.targetId ? t.npcs.find((n) => n.id === t.targetId && isTargetable(n)) : undefined;

export interface TargetPick {
  /** Targeted NPC id, or null. */
  shipId: string | null;
  /** Targeted planet id, or null. */
  planetId: string | null;
  /** Targeted site id (see SiteTarget), or null. At most one of the three is set. */
  siteId: string | null;
}

/**
 * The next target after the current one: sites nearest first, then ships nearest first, then planets
 * nearest first, then nothing (so a phone player can clear it). With no target it picks the nearest
 * site, else the nearest ship, else the nearest planet. `siteId` is the site targeted now, if any.
 */
export function cycleTarget(world: WorldState, data: GameData, t: Traffic, sites: readonly SiteTarget[] = [], siteId: string | null = null): TargetPick {
  const pos = world.ship.pos;
  const byDist = <T>(items: readonly T[], at: (x: T) => Vec2) => [...items].sort((a, b) => dist(pos, at(a)) - dist(pos, at(b)));
  const ships = byDist(t.npcs.filter(isTargetable), (n) => n.ship.pos);
  const planets = byDist(Object.values(data.planets).filter((p) => p.systemId === world.systemId), (p) => p.pos);
  const order: TargetPick[] = [
    ...byDist(sites, (s) => s.pos).map((s) => ({ shipId: null, planetId: null, siteId: s.id })),
    ...ships.map((n) => ({ shipId: n.id, planetId: null, siteId: null })),
    ...planets.map((p) => ({ shipId: null, planetId: p.id, siteId: null })),
  ];
  const idx = order.findIndex((o) =>
    siteId ? o.siteId === siteId : t.targetId ? o.shipId === t.targetId : o.planetId !== null && o.planetId === world.targetPlanetId,
  );
  return idx + 1 < order.length ? order[idx + 1] : { shipId: null, planetId: null, siteId: null };
}
