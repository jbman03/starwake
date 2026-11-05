import type { GameData } from '../data/schemas';
import { fullHull } from './combat';
import { hashString, mulberry32 } from './random';
import { shipStats } from './shipStats';
import { addNote, setFlag } from './story';
import type { Npc, Traffic } from './traffic';
import type { WorldState } from './types';
import { add, fromAngle, scale, type Vec2 } from './vec';
import { npcLoadout } from './weapons';

/** The nemesis NPC's id (there is only ever one). */
export const NEMESIS_ID = 'nemesis';

export interface NemesisState {
  /** Duels won by the pilot so far. */
  defeats: number;
  /** The first day the rival may appear again. */
  nextDay: number;
  /** Finished for good after the final duel. */
  done: boolean;
}

export const NEW_NEMESIS: NemesisState = { defeats: 0, nextDay: 0, done: false };

const pickLine = (lines: readonly string[], ...seed: (string | number)[]): string => lines[Math.floor(mulberry32(hashString(...seed))() * lines.length)];

/**
 * Does the rival jump in on this arrival? Only once the pilot has the kills, between duels, away from the
 * start system, with no guide running and no calm test flag, and on a seeded roll (seed, day, system).
 */
export function nemesisDue(world: WorldState, data: GameData, opts: { guideActive: boolean; calm: boolean }): boolean {
  const cfg = data.fleet.nemesis;
  const n = world.nemesis;
  if (n.done || opts.guideActive || opts.calm || world.systemId === data.config.startSystemId) return false;
  if (world.stats.kills < cfg.requiresKills || world.day < n.nextDay) return false;
  return mulberry32(hashString(world.seed, 'nemesis', world.day, world.systemId))() < cfg.chance;
}

/** The rival's ship for the next duel: the level's hull and extra outfits, hostile to the pilot from the start. */
export function nemesisNpc(world: WorldState, data: GameData, pos: Vec2, heading: number): Npc {
  const cfg = data.fleet.nemesis;
  const level = cfg.levels[Math.min(world.nemesis.defeats, cfg.levels.length - 1)];
  const outfits = { ...npcLoadout(data.ships[level.shipId]) };
  for (const [id, n] of Object.entries(level.outfits)) outfits[id] = (outfits[id] ?? 0) + n;
  const st = shipStats(level.shipId, outfits, data);
  return {
    id: NEMESIS_ID,
    name: cfg.name,
    shipId: level.shipId,
    government: 'raiders',
    errand: 'pass',
    ship: { pos: { ...pos }, vel: { x: 0, y: 0 }, heading, fuel: 0 },
    portId: null,
    phase: 'fly',
    phaseT: 0,
    thrusting: false,
    role: 'raider',
    hull: fullHull(st.shields, st.armor),
    outfits,
    aggro: ['player'],
    engaged: true,
    peaceful: false,
    demand: false,
    killCounted: false,
    nemesis: true,
  };
}

/** Add the rival `spawnDistance` from where the jump ends, on a seeded bearing; the HUD line he hails with. */
export function spawnNemesis(world: WorldState, data: GameData, t: Traffic, around: Vec2): { traffic: Traffic; line: string } {
  const cfg = data.fleet.nemesis;
  const r = mulberry32(hashString(world.seed, 'nemesisPos', world.day, world.systemId));
  const bearing = r() * Math.PI * 2;
  const pos = add(around, scale(fromAngle(bearing), cfg.spawnDistance));
  const npc = nemesisNpc(world, data, pos, bearing + Math.PI);
  const line = pickLine(cfg.lines.arrive, world.seed, 'nemesisLine', world.day, world.nemesis.defeats);
  return { traffic: { ...t, npcs: [...t.npcs.filter((n) => n.id !== NEMESIS_ID), npc] }, line: `${cfg.name}: ${line}` };
}

export const nemesisPresent = (t: Pick<Traffic, 'npcs'>): boolean => t.npcs.some((n) => n.id === NEMESIS_ID);

/**
 * The rival is disabled: he ejects and his ship is gone. A duel won by the pilot's side pays the level's reward;
 * the last level's is final (reward, flag, log note, done). Either way he stays away for `cooldownDays`.
 */
export function defeatNemesis(world: WorldState, data: GameData, t: Traffic, byPlayerSide: boolean): { world: WorldState; traffic: Traffic; messages: string[] } {
  const cfg = data.fleet.nemesis;
  const traffic = { ...t, npcs: t.npcs.filter((n) => n.id !== NEMESIS_ID), targetId: t.targetId === NEMESIS_ID ? null : t.targetId };
  const away = { ...world.nemesis, nextDay: world.day + cfg.cooldownDays };
  if (!byPlayerSide) return { world: { ...world, nemesis: away }, traffic, messages: [`${cfg.name} ejects and is gone.`] };
  const level = cfg.levels[Math.min(world.nemesis.defeats, cfg.levels.length - 1)];
  const defeats = world.nemesis.defeats + 1;
  if (defeats >= cfg.levels.length) {
    let w: WorldState = { ...world, credits: world.credits + level.reward + cfg.finalReward, nemesis: { ...away, defeats, done: true } };
    w = addNote(setFlag(w, cfg.finalFlag), `${cfg.name}, ${cfg.title}, beaten for good.`);
    return { world: w, traffic, messages: [cfg.lines.final, `You collect ${level.reward + cfg.finalReward} cr.`] };
  }
  const line = pickLine(cfg.lines.escape, world.seed, 'nemesisEscape', defeats);
  return {
    world: { ...world, credits: world.credits + level.reward, nemesis: { ...away, defeats } },
    traffic,
    messages: [`${cfg.name}: ${line}`, ...(level.reward > 0 ? [`You collect ${level.reward} cr for driving him off.`] : [])],
  };
}

/** The pilot lost (towed or rescued) with the rival in the system: he gloats and stays away a while. */
export function nemesisWins(world: WorldState, data: GameData): { world: WorldState; message: string } {
  return { world: { ...world, nemesis: { ...world.nemesis, nextDay: world.day + data.fleet.nemesis.cooldownDays } }, message: data.fleet.nemesis.lines.gloat };
}
