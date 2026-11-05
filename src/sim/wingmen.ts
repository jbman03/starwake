import type { GameData, WingmanDef } from '../data/schemas';
import type { BattleEvent } from './battle';
import { escortMaxArmor, escortMaxFuel, nextEscortId } from './escorts';
import type { Escort, WorldState } from './types';
import { npcLoadout } from './weapons';

/** The wingman's data entry, or undefined for a plain escort (or a wingman since removed from data). */
export function wingmanDef(data: GameData, e: Pick<Escort, 'wingmanId'>): WingmanDef | undefined {
  return e.wingmanId ? data.fleet.wingmen.pilots.find((w) => w.id === e.wingmanId) : undefined;
}

/** True while a wingman who ejected is recovering (never spawned, never paid). */
export const isDown = (e: Pick<Escort, 'downUntilDay'>): boolean => e.downUntilDay !== undefined;

/** The rank for a takedown count: the highest whose threshold is met. */
export function wingmanRank(data: GameData, takedowns: number): { index: number; name: string; damageBonus: number } {
  const ranks = data.fleet.wingmen.ranks;
  let index = 0;
  for (let i = 0; i < ranks.length; i++) if (takedowns >= ranks[i].takedowns) index = i;
  return { index, name: ranks[index].name, damageBonus: ranks[index].damageBonus };
}

/** What an escort's shots deal, as a multiple of normal: 1 + the wingman's rank bonus; 1 for anyone else. */
export function damageMulOf(data: GameData, e: Pick<Escort, 'wingmanId' | 'takedowns'> | undefined): number {
  if (!e || !wingmanDef(data, e)) return 1;
  return 1 + wingmanRank(data, e.takedowns ?? 0).damageBonus;
}

/**
 * The wingman waiting at this port's bar, or null: the one whose home it is, once the pilot has the
 * kills they ask for, and only while they are not already in the group.
 */
export function wingmanOffer(world: WorldState, data: GameData, portId: string): WingmanDef | null {
  const port = data.planets[portId];
  if (!port || !port.services.includes('bar')) return null;
  const taken = new Set(world.escorts.map((e) => e.wingmanId).filter(Boolean));
  return data.fleet.wingmen.pilots.find((w) => w.homePort === portId && world.stats.kills >= w.requiresKills && !taken.has(w.id)) ?? null;
}

/** A new wingman escort: their hull's default fit, full armor and fuel, no takedowns. */
function freshWingman(data: GameData, w: WingmanDef, id: string): Escort {
  const outfits = { ...npcLoadout(data.ships[w.shipId]) };
  return {
    id,
    name: w.name,
    shipId: w.shipId,
    outfits,
    armor: escortMaxArmor(data, { shipId: w.shipId, outfits }),
    fuel: escortMaxFuel(data, { shipId: w.shipId, outfits }),
    hired: true,
    wage: w.wage,
    wingmanId: w.id,
    takedowns: 0,
  };
}

/** Recruit the wingman at this port's bar: their fee is paid and they join the group. */
export function recruitWingman(
  world: WorldState,
  data: GameData,
  portId: string,
  wingmanId: string,
): { world: WorldState; escort: Escort; line: string } | { error: 'full' | 'short' | 'gone' } {
  const w = wingmanOffer(world, data, portId);
  if (!w || w.id !== wingmanId) return { error: 'gone' };
  if (world.escorts.length >= data.escorts.maxEscorts) return { error: 'full' };
  if (world.credits < w.fee) return { error: 'short' };
  const escort = freshWingman(data, w, nextEscortId(world.escorts));
  return { world: { ...world, credits: world.credits - w.fee, escorts: [...world.escorts, escort] }, escort, line: w.lines.join };
}

/**
 * Each ship a wingman disables this tick is a takedown: the count goes up, they say a line, and a new
 * rank is announced ("<name> is now Seasoned.").
 */
export function creditWingmen(world: WorldState, data: GameData, events: readonly BattleEvent[]): { world: WorldState; messages: string[] } {
  const messages: string[] = [];
  let escorts = world.escorts;
  for (const ev of events) {
    if (ev.type !== 'disabled' || !ev.escortId) continue;
    const i = escorts.findIndex((e) => e.id === ev.escortId);
    const w = i >= 0 ? wingmanDef(data, escorts[i]) : undefined;
    if (!w) continue;
    const before = escorts[i].takedowns ?? 0;
    const after = before + 1;
    escorts = escorts.map((e, j) => (j === i ? { ...e, takedowns: after } : e));
    messages.push(`${w.name}: ${w.lines.takedown[before % w.lines.takedown.length]}`);
    const rank = wingmanRank(data, after);
    if (rank.index > wingmanRank(data, before).index) messages.push(`${w.name} is now ${rank.name}.`);
  }
  return escorts === world.escorts ? { world, messages } : { world: { ...world, escorts }, messages };
}

/**
 * Wingmen whose ships were destroyed this tick eject: they stay in the group, down (recovering) for
 * `recoverDays`, and say their eject line. Run before `escortLosses`, which then leaves them be.
 */
export function ejectWingmen(world: WorldState, data: GameData, events: readonly BattleEvent[]): { world: WorldState; messages: string[] } {
  const messages: string[] = [];
  let escorts = world.escorts;
  for (const ev of events) {
    if (ev.type !== 'destroyed') continue;
    const e = escorts.find((x) => x.id === ev.id);
    const w = e && wingmanDef(data, e);
    if (!e || !w || isDown(e)) continue;
    const { waiting: _waiting, ...rest } = e;
    const down: Escort = { ...rest, armor: 0, downUntilDay: world.day + data.fleet.wingmen.recoverDays };
    escorts = escorts.map((x) => (x.id === e.id ? down : x));
    messages.push(`${w.name}: ${w.lines.eject}`);
  }
  return escorts === world.escorts ? { world, messages } : { world: { ...world, escorts }, messages };
}

/** At a landing: each recovered wingman is back in a rebuilt ship (full armor and fuel, their hull's default fit). */
export function returnWingmen(world: WorldState, data: GameData): { world: WorldState; notices: string[] } {
  const notices: string[] = [];
  const escorts = world.escorts.map((e) => {
    const w = wingmanDef(data, e);
    if (!w || e.downUntilDay === undefined || world.day < e.downUntilDay) return e;
    const { downUntilDay: _d, ...rest } = e;
    const outfits = { ...npcLoadout(data.ships[e.shipId]) };
    notices.push(w.lines.back);
    return { ...rest, outfits, armor: escortMaxArmor(data, { shipId: e.shipId, outfits }), fuel: escortMaxFuel(data, { shipId: e.shipId, outfits }) };
  });
  return notices.length ? { world: { ...world, escorts }, notices } : { world, notices };
}
