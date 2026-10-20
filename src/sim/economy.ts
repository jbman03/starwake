import type { GameData, PlanetDef } from '../data/schemas';
import { HIDDEN_LANE_FLAG, hopDistance } from './galaxy';
import { hasFlag } from './story';
import { hashString, mulberry32, pick, randInt } from './random';
import type { MarketEvent, WorldState } from './types';

export type Level = 'low' | 'med' | 'high';

export const LEVEL_MULT: Record<Level, number> = { low: 0.75, med: 1.0, high: 1.3 };
/** Pressure change per 10 t traded (buying raises, selling lowers). */
export const PRESSURE_PER_10T = 0.03;
export const PRESSURE_MIN = 0.7;
export const PRESSURE_MAX = 1.3;
/** Share of the gap to 1.0 that pressure recovers each day. */
export const PRESSURE_RECOVERY = 0.25;
export const EVENT_CHANCE = 0.35;
export const MAX_EVENTS = 4;
export const RUMOR_HOPS = 4;

const pressureKey = (portId: string, commodityId: string) => `${portId}:${commodityId}`;

/** Per-day price jitter in [0.94, 1.06], stable for (seed, port, good, day). */
export function dailyNoise(seed: number, portId: string, commodityId: string, day: number): number {
  return 0.94 + (hashString(seed, 'noise', portId, commodityId, day) / 4294967296) * 0.12;
}

/**
 * Event price multiplier: full strength for the first half of the event, then a linear fade back
 * to 1.0 at startDay + days. Multiple events at the same port+good multiply (none by construction).
 */
export function eventMult(world: WorldState, portId: string, commodityId: string): number {
  let m = 1;
  for (const e of world.events) {
    if (e.portId !== portId || e.commodityId !== commodityId) continue;
    const t = (world.day - e.startDay) / e.days;
    if (t < 0 || t >= 1) continue;
    const k = t <= 0.5 ? 1 : (1 - t) / 0.5;
    m *= 1 + (e.strength - 1) * k;
  }
  return m;
}

/** Current price at a port, or null if the port doesn't trade the good. */
export function priceOf(world: WorldState, data: GameData, portId: string, commodityId: string): number | null {
  const level = data.planets[portId]?.market?.[commodityId];
  const base = data.commodities[commodityId]?.basePrice;
  if (!level || base === undefined) return null;
  const pressure = world.pressure[pressureKey(portId, commodityId)] ?? 1;
  const noise = dailyNoise(world.seed, portId, commodityId, world.day);
  return Math.round(base * LEVEL_MULT[level] * eventMult(world, portId, commodityId) * pressure * noise);
}

export function displayLevel(price: number, basePrice: number): Level {
  const r = price / basePrice;
  if (r <= 0.85) return 'low';
  if (r >= 1.15) return 'high';
  return 'med';
}

/** Trading moves the local price: 3 % per 10 t bought (negative = sold), clamped to 0.70–1.30. */
export function applyPressure(world: WorldState, portId: string, commodityId: string, tonsBought: number): WorldState {
  const key = pressureKey(portId, commodityId);
  const p = (world.pressure[key] ?? 1) + (tonsBought / 10) * PRESSURE_PER_10T;
  const clamped = Math.min(PRESSURE_MAX, Math.max(PRESSURE_MIN, p));
  return { ...world, pressure: { ...world.pressure, [key]: clamped } };
}

/** One day of market life: pressure recovers, finished events expire, maybe a new one starts. */
export function economyDay(world: WorldState, data: GameData): WorldState {
  const pressure: Record<string, number> = {};
  for (const [key, p] of Object.entries(world.pressure)) {
    const next = p + (1 - p) * PRESSURE_RECOVERY;
    if (Math.abs(next - 1) >= 0.005) pressure[key] = next;
  }
  const events = world.events.filter((e) => world.day < e.startDay + e.days);
  const w: WorldState = { ...world, pressure, events };

  const rng = mulberry32(hashString(w.seed, 'event', w.day));
  if (rng() >= EVENT_CHANCE || events.length >= MAX_EVENTS) return w;
  const templates = Object.values(data.events);
  if (templates.length === 0) return w;
  const tpl = pick(rng, templates);
  const ports = Object.values(data.planets).filter(
    (p) =>
      p.market?.[tpl.commodity] &&
      (!data.systems[p.systemId]?.hidden || hasFlag(w, HIDDEN_LANE_FLAG)) &&
      !events.some((e) => e.portId === p.id && e.commodityId === tpl.commodity),
  );
  if (ports.length === 0) return w;
  const port = pick(rng, ports);
  const spawned: MarketEvent = {
    templateId: tpl.id,
    portId: port.id,
    commodityId: tpl.commodity,
    startDay: w.day,
    days: randInt(rng, tpl.days[0], tpl.days[1]),
    strength: tpl.strength,
  };
  return { ...w, events: [...events, spawned] };
}

const isActive = (world: WorldState, e: MarketEvent) => world.day >= e.startDay && world.day < e.startDay + e.days;
const fillPort = (text: string, port: PlanetDef) => text.replaceAll('{port}', port.name);

/** Text of an active event at this port, if any. */
export function localNews(world: WorldState, data: GameData, portId: string): string | null {
  const port = data.planets[portId];
  const e = world.events.find((ev) => ev.portId === portId && isActive(world, ev));
  const tpl = e && data.events[e.templateId];
  return port && tpl ? fillPort(tpl.text, port) : null;
}

/** Hearsay about an active event at another port within RUMOR_HOPS jumps; deterministic by day. */
export function rumor(world: WorldState, data: GameData, portId: string): string | null {
  const here = data.planets[portId];
  if (!here) return null;
  const near = world.events.filter((e) => {
    const there = data.planets[e.portId];
    return (
      there && e.portId !== portId && isActive(world, e) && hopDistance(data, here.systemId, there.systemId, world.flags) <= RUMOR_HOPS
    );
  });
  if (near.length === 0) return null;
  const e = pick(mulberry32(hashString(world.seed, 'rumor', portId, world.day)), near);
  const tpl = data.events[e.templateId];
  const good = data.commodities[e.commodityId]?.name ?? e.commodityId;
  const state = tpl?.effect === 'surplus' ? 'flooded with' : 'short of';
  return `Traders say ${data.planets[e.portId].name} is ${state} ${good}.`;
}
