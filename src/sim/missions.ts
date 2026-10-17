import type { GameData, MissionTypeDef } from '../data/schemas';
import { berthsFree, cargoFree } from './cargo';
import { hopDistance } from './galaxy';
import { hashString, mulberry32, pick, randInt } from './random';
import type { Mission, WorldState } from './types';

/** Most missions the pilot can hold at once. */
export const MAX_MISSIONS = 8;
const MIN_OFFERS = 3;
const MAX_OFFERS = 7;

/** A job on the mission computer: a Mission not yet taken. `offerId` becomes the mission id. */
export type MissionOffer = Omit<Mission, 'id'> & { offerId: string };

export type AcceptCheck = { ok: true } | { ok: false; reason: 'tooMany' | 'noSpace' | 'noBerths' };

/** Rounded to the nearest 10 credits. */
function roundPay(x: number): number {
  return Math.round(x / 10) * 10;
}

/** Fill a template's {placeholders}; unknown ones are left as written. */
function fill(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}

/** Ports a type may send the pilot to from `originId`, each with its hop count. */
function destinations(data: GameData, originId: string, type: MissionTypeDef): { portId: string; hops: number }[] {
  const origin = data.planets[originId];
  const out: { portId: string; hops: number }[] = [];
  for (const p of Object.values(data.planets)) {
    if (p.id === originId) continue;
    if (type.toDumpSite && !p.dumpSite) continue;
    const hops = hopDistance(data, origin.systemId, p.systemId);
    if (!Number.isFinite(hops) || hops < type.hops[0] || hops > type.hops[1]) continue;
    if (hops >= 1 && p.systemId === origin.systemId) continue;
    out.push({ portId: p.id, hops });
  }
  return out;
}

function cargoNameFor(type: MissionTypeDef, r: () => number, names: string[]): string {
  if (type.id === 'rush') return 'priority parcels';
  if (type.id === 'ferry') return 'passengers';
  if (type.toDumpSite) return 'waste';
  return names.length > 0 ? pick(r, names).toLowerCase() : 'goods';
}

/** Jobs at `portId` today: 3–7, identical for the same (seed, port, day) and fresh each day. */
export function offersAt(world: WorldState, data: GameData, portId: string): MissionOffer[] {
  const r = mulberry32(hashString(world.seed, portId, world.day));
  const types = Object.values(data.missionTypes);
  const names = Object.values(data.commodities).filter((c) => !c.origin).map((c) => c.name);
  const want = randInt(r, MIN_OFFERS, MAX_OFFERS);
  const offers: MissionOffer[] = [];
  for (let index = 0; index < want; index++) {
    // Start at a random type and take the first one with somewhere to go.
    const start = Math.floor(r() * types.length);
    let made: MissionOffer | null = null;
    for (let k = 0; k < types.length && !made; k++) {
      const type = types[(start + k) % types.length];
      const dests = destinations(data, portId, type);
      if (dests.length === 0) continue;
      let pool = dests;
      if (type.toDumpSite) {
        const nearest = Math.min(...dests.map((d) => d.hops));
        pool = dests.filter((d) => d.hops === nearest);
      }
      const dest = pick(r, pool);
      const tons = randInt(r, type.tons[0], type.tons[1]);
      const passengers = randInt(r, type.passengers[0], type.passengers[1]);
      const cargoName = cargoNameFor(type, r, names);
      const pay = roundPay(
        (type.basePay + type.perHop * dest.hops + type.perTon * tons + type.perPassenger * passengers) * type.urgency,
      );
      const days = type.deadline ? type.deadline.perHop * dest.hops + type.deadline.plus : null;
      const target = data.planets[dest.portId];
      const vars = {
        dest: target.name,
        system: data.systems[target.systemId].name,
        cargo: cargoName,
        pay: pay.toLocaleString('en-US'),
        tons,
        pax: passengers,
        days: days ?? '',
      };
      made = {
        offerId: `${portId}:${world.day}:${index}`,
        typeId: type.id,
        originId: portId,
        destId: dest.portId,
        tons,
        passengers,
        pay,
        paidUpfront: type.paidUpfront,
        deadlineDay: days === null ? null : world.day + days,
        title: fill(type.titleTemplate, vars),
        description: fill(type.textTemplate, vars),
        cargoName,
      };
    }
    if (!made) break; // no type has a destination from here
    offers.push(made);
  }
  const taken = new Set([...world.missions.map((m) => m.id), ...world.takenOffers]);
  return offers.filter((o) => !taken.has(o.offerId));
}

export function canAccept(world: WorldState, data: GameData, offer: MissionOffer): AcceptCheck {
  if (world.missions.length >= MAX_MISSIONS) return { ok: false, reason: 'tooMany' };
  if (offer.tons > cargoFree(world, data)) return { ok: false, reason: 'noSpace' };
  if (offer.passengers > berthsFree(world, data)) return { ok: false, reason: 'noBerths' };
  return { ok: true };
}

/**
 * Take the job: reserves hold space and berths; pays now when the job is paid up front. The
 * destination's system is charted as seen (unless already known) so the star map can show it.
 */
export function accept(world: WorldState, data: GameData, offer: MissionOffer): WorldState {
  if (world.takenOffers.includes(offer.offerId) || world.missions.some((m) => m.id === offer.offerId)) return world;
  if (!canAccept(world, data, offer).ok) return world;
  const { offerId, ...rest } = offer;
  const destSystem = data.planets[offer.destId]?.systemId;
  const charts = destSystem !== undefined && !world.known.includes(destSystem) && !world.seen.includes(destSystem);
  return {
    ...world,
    seen: charts ? [...world.seen, destSystem] : world.seen,
    credits: world.credits + (offer.paidUpfront ? offer.pay : 0),
    missions: [...world.missions, { id: offerId, ...rest }],
    takenOffers: [...world.takenOffers, offerId],
  };
}

/** Deliver every mission bound for `portId` that is not overdue; pays the ones not paid up front. */
export function completeAt(world: WorldState, portId: string): { world: WorldState; completed: Mission[]; pay: number } {
  const done = (m: Mission) => m.destId === portId && (m.deadlineDay === null || world.day <= m.deadlineDay);
  const completed = world.missions.filter(done);
  if (completed.length === 0) return { world, completed, pay: 0 };
  const pay = completed.reduce((sum, m) => sum + (m.paidUpfront ? 0 : m.pay), 0);
  return {
    world: { ...world, credits: world.credits + pay, missions: world.missions.filter((m) => !done(m)) },
    completed,
    pay,
  };
}

/** Drop missions whose deadline has passed; no pay. */
export function failOverdue(world: WorldState): { world: WorldState; failed: Mission[] } {
  const late = (m: Mission) => m.deadlineDay !== null && world.day > m.deadlineDay;
  const failed = world.missions.filter(late);
  if (failed.length === 0) return { world, failed };
  return { world: { ...world, missions: world.missions.filter((m) => !late(m)) }, failed };
}

/** Give up a mission: cargo and berths are freed, nothing is paid, upfront pay is kept. */
export function abandon(world: WorldState, missionId: string): WorldState {
  if (!world.missions.some((m) => m.id === missionId)) return world;
  return { ...world, missions: world.missions.filter((m) => m.id !== missionId) };
}
