import type { GameData, MissionTypeDef, ShipDef } from '../data/schemas';
import { hopDistance, systemOpen } from './galaxy';
import { fill, roundPay, type MissionOffer } from './missions';
import { hashString, mulberry32, randInt } from './random';
import { shipName } from './traffic';
import type { Mission, WorldState } from './types';
import { hasWeapon } from './weapons';
import { add, fromAngle, scale, type Vec2 } from './vec';

/** Combat jobs are offered at ports of the governments in combat.missions (Concord and Free Reach), and only to a pilot who owns a weapon. */
export function combatOffersOk(world: WorldState, data: GameData, portId: string): boolean {
  const port = data.planets[portId];
  if (!port) return false;
  return data.combat.missions.offerGovernments.includes(data.systems[port.systemId]?.government ?? '') && hasWeapon(world.outfits, data);
}

/**
 * Systems a combat job from `portId` may name, with hops: within the type's hop range, open, not
 * the origin or the start system, and not Concord-governed (the quiet core).
 */
export function combatTargets(world: WorldState, data: GameData, type: MissionTypeDef, portId: string): { systemId: string; hops: number }[] {
  const from = data.planets[portId].systemId;
  const out: { systemId: string; hops: number }[] = [];
  for (const s of Object.values(data.systems)) {
    if (s.id === from || s.id === data.config.startSystemId || s.government === 'concord' || !systemOpen(s, world.flags)) continue;
    const hops = hopDistance(data, from, s.id, world.flags);
    if (Number.isFinite(hops) && hops >= type.hops[0] && hops <= type.hops[1]) out.push({ systemId: s.id, hops });
  }
  return out;
}

/** The bounty target's hull: a weighted pick from the raider hull pool, not below the type's tier. */
function pickBountyHull(data: GameData, type: MissionTypeDef, r: () => number): ShipDef {
  const minTier = type.combat?.minTier ?? 1;
  const all = Object.entries(data.combat.spawn.raiderHulls).filter(([id]) => data.ships[id]);
  const fit = all.filter(([id]) => data.ships[id].techTier >= minTier);
  const pool = fit.length > 0 ? fit : all;
  let x = r() * pool.reduce((sum, [, w]) => sum + w, 0);
  for (const [id, w] of pool) {
    x -= w;
    if (x < 0) return data.ships[id];
  }
  return data.ships[pool[pool.length - 1][0]];
}

/**
 * One combat offer from `portId` against `systemId`, `hops` away. Draws from `r`: the target's hull
 * and name for a bounty, the raider count for a clear job. The job is collected back at `portId`.
 */
export function buildCombatOffer(
  world: WorldState,
  data: GameData,
  type: MissionTypeDef,
  portId: string,
  systemId: string,
  hops: number,
  r: () => number,
  offerId: string,
): MissionOffer {
  const c = type.combat;
  if (!c) throw new Error(`mission type ${type.id} is not a combat job`);
  let combat: NonNullable<Mission['combat']>;
  let base = type.basePay + type.perHop * hops;
  if (c.kind === 'bounty') {
    const hull = pickBountyHull(data, type, r);
    combat = { kind: 'bounty', systemId, shipId: hull.id, targetName: shipName(r, data), needed: 1, done: 0 };
    if (c.hullPayDivisor) base *= Math.max(1, hull.price / c.hullPayDivisor);
  } else {
    const range = c.count ?? [1, 1];
    const needed = randInt(r, range[0], range[1]);
    combat = { kind: 'clear', systemId, needed, done: 0 };
    base += (c.perRaider ?? 0) * needed;
  }
  const pay = roundPay(base * type.urgency);
  const days = type.deadline ? type.deadline.perHop * hops + type.deadline.plus : null;
  const vars = {
    system: data.systems[systemId].name,
    target: combat.targetName ?? '',
    count: combat.needed,
    pay: pay.toLocaleString('en-US'),
    days: days ?? '',
  };
  return {
    offerId,
    typeId: type.id,
    originId: portId,
    destId: portId,
    tons: 0,
    passengers: 0,
    pay,
    paidUpfront: type.paidUpfront,
    deadlineDay: days === null ? null : world.day + days,
    title: fill(type.titleTemplate, vars),
    description: fill(type.textTemplate, vars),
    cargoName: type.id === 'bounty' ? 'bounty' : 'raiders',
    combat,
  };
}

/** The system to fly to while the job is not done; null once it is (or for an ordinary job). */
export function combatTargetSystem(m: Pick<Mission, 'combat'>): string | null {
  return m.combat && m.combat.done < m.combat.needed ? m.combat.systemId : null;
}

/** The system a job points the pilot at: its combat target until done, else the system of `destId`. */
export function missionSystem(m: Pick<Mission, 'combat' | 'destId'>, data: GameData): string | undefined {
  return combatTargetSystem(m) ?? data.planets[m.destId]?.systemId;
}

/**
 * Credit the player's kill (a ship disabled, or destroyed without having been disabled) of `npc` in
 * `systemId`. A bounty counts the ship carrying its mission id; a clear job counts any raider in its system.
 */
export function recordKill(world: WorldState, systemId: string, npc: { role: string; missionId?: string }): WorldState {
  let changed = false;
  const missions = world.missions.map((m) => {
    const c = m.combat;
    if (!c || c.done >= c.needed) return m;
    const hit = c.kind === 'bounty' ? npc.missionId === m.id : c.systemId === systemId && npc.role === 'raider';
    if (!hit) return m;
    changed = true;
    return { ...m, combat: { ...c, done: c.done + 1 } };
  });
  return changed ? { ...world, missions } : world;
}

/** Bounty missions still to do whose target lives in `systemId`. */
export function bountyToSpawn(world: WorldState, systemId: string): Mission[] {
  return world.missions.filter((m) => m.combat?.kind === 'bounty' && m.combat.systemId === systemId && m.combat.done < m.combat.needed);
}

/** The id of a bounty target's ship in traffic. */
export const bountyNpcId = (m: Mission): string => `bounty-${m.id}`;

/** Where a bounty target appears: spawnMin to spawnMax px from `from`, in a direction fixed by the seed and mission. */
export function bountySpawnPos(world: WorldState, data: GameData, m: Mission, from: Vec2): Vec2 {
  const r = mulberry32(hashString(world.seed, 'bountypos', m.id));
  const { spawnMin, spawnMax } = data.combat.bounty;
  return add(from, scale(fromAngle(r() * Math.PI * 2), spawnMin + r() * (spawnMax - spawnMin)));
}

/** The system of the first active clear job (raiders are likelier there), or undefined. */
export function clearBoostSystem(world: WorldState): string | undefined {
  return world.missions.find((m) => m.combat?.kind === 'clear' && m.combat.done < m.combat.needed)?.combat?.systemId;
}
