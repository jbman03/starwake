import { z } from 'zod';
import type { GameData } from '../data/schemas';
import type { WorldState } from '../sim/types';
import { revealOnArrival } from '../sim/galaxy';
import { hashString } from '../sim/random';
import { departFrom, newWorld } from '../sim/world';

export const CURRENT_SAVE_VERSION = 2;

export class SaveError extends Error {
  constructor(public readonly code: 'futureVersion' | 'invalid' | 'unknownContent', message?: string) {
    super(message ?? code);
    this.name = 'SaveError';
  }
}

const MissionSchema = z.object({
  id: z.string().min(1),
  typeId: z.string().min(1),
  originId: z.string().min(1),
  destId: z.string().min(1),
  tons: z.number().finite().nonnegative(),
  passengers: z.number().finite().nonnegative(),
  pay: z.number().finite(),
  paidUpfront: z.boolean(),
  deadlineDay: z.number().finite().nullable(),
  title: z.string(),
  description: z.string(),
  cargoName: z.string(),
});

const MarketEventSchema = z.object({
  templateId: z.string().min(1),
  portId: z.string().min(1),
  commodityId: z.string().min(1),
  startDay: z.number().finite(),
  days: z.number().finite(),
  strength: z.number().finite(),
});

export const PilotSaveSchema = z.object({
  version: z.literal(2),
  id: z.string().min(1),
  name: z.string(),
  /** May be negative: tow fees can put a pilot in debt (spec §7). */
  credits: z.number().finite(),
  shipId: z.string().min(1),
  fuel: z.number().finite().nonnegative(),
  systemId: z.string().min(1),
  planetId: z.string().min(1),
  gameTimeSec: z.number().finite().nonnegative(),
  savedAt: z.string(),
  // v2: the economy, hold, jobs and chart (WorldState fields of the same names).
  day: z.number().int().nonnegative(),
  seed: z.number().finite(),
  cargo: z.record(z.string(), z.number().finite().nonnegative()),
  missions: z.array(MissionSchema),
  route: z.array(z.string()),
  /** Empty in a freshly upgraded v1 save; worldFromPilot repairs it from game data. */
  known: z.array(z.string()),
  seen: z.array(z.string()),
  pressure: z.record(z.string(), z.number().finite()),
  events: z.array(MarketEventSchema),
  takenOffers: z.array(z.string()),
});

export type PilotSave = z.infer<typeof PilotSaveSchema>;

/** Keyed by the version being upgraded FROM; each returns the next version's shape. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const migrations: Record<number, (s: any) => any> = {
  // v1 -> v2. Data-free: `known` stays empty and worldFromPilot fills it (and `seen`) from game data.
  1: (s) => ({
    ...s,
    version: 2,
    day: 0,
    seed: hashString(String(s.id)),
    cargo: {},
    missions: [],
    route: [],
    known: [],
    seen: [],
    pressure: {},
    events: [],
    takenOffers: [],
  }),
};

export function upgradeSave(raw: unknown): PilotSave {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SaveError('invalid');
  let cur: unknown = raw;
  let version = (raw as { version?: unknown }).version;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) throw new SaveError('invalid');
  if (version > CURRENT_SAVE_VERSION) throw new SaveError('futureVersion');
  while (version < CURRENT_SAVE_VERSION) {
    const step = migrations[version];
    if (!step) throw new SaveError('invalid', `no migration from v${version}`);
    try {
      cur = step(cur);
    } catch {
      throw new SaveError('invalid');
    }
    version += 1;
  }
  const parsed = PilotSaveSchema.safeParse(cur);
  if (!parsed.success) throw new SaveError('invalid', parsed.error.message);
  return parsed.data;
}

export function pilotFromWorld(world: WorldState, planetId: string, meta: { id: string; name: string }): PilotSave {
  return {
    version: CURRENT_SAVE_VERSION,
    id: meta.id,
    name: meta.name,
    credits: world.credits,
    shipId: world.shipId,
    fuel: world.ship.fuel,
    systemId: world.systemId,
    planetId,
    gameTimeSec: world.timeSec,
    savedAt: new Date().toISOString(),
    day: world.day,
    seed: world.seed,
    cargo: { ...world.cargo },
    missions: world.missions.map((m) => ({ ...m })),
    route: [...world.route],
    known: [...world.known],
    seen: [...world.seen],
    pressure: { ...world.pressure },
    events: world.events.map((e) => ({ ...e })),
    takenOffers: [...world.takenOffers],
  };
}

export function worldFromPilot(p: PilotSave, data: GameData): WorldState {
  const planet = data.planets[p.planetId];
  if (!data.ships[p.shipId] || !data.systems[p.systemId] || !planet) throw new SaveError('invalid', 'unknown id');
  for (const id of Object.keys(p.cargo)) if (!data.commodities[id]) throw new SaveError('unknownContent', `unknown commodity "${id}"`);
  for (const m of p.missions) if (!data.planets[m.destId]) throw new SaveError('unknownContent', `unknown mission port "${m.destId}"`);
  // A v1 upgrade has no chart: start from the opening chart plus where the pilot is. Either way
  // `seen` is recomputed so it is exactly the unvisited neighbours of `known`.
  let known = p.known;
  if (known.length === 0) known = [...new Set([...data.config.knownAtStart, p.systemId])];
  let map = { known: [] as string[], seen: [] as string[] };
  for (const id of known) if (data.systems[id]) map = revealOnArrival(map.known, map.seen, data, id);
  map = revealOnArrival(map.known, map.seen, data, p.systemId);
  const base = newWorld(data, p.seed);
  const w: WorldState = {
    ...base,
    systemId: p.systemId,
    shipId: p.shipId,
    credits: p.credits,
    timeSec: p.gameTimeSec,
    ship: { ...base.ship, fuel: p.fuel },
    day: p.day,
    seed: p.seed,
    cargo: { ...p.cargo },
    missions: p.missions.map((m) => ({ ...m })),
    route: [...p.route],
    known: map.known,
    seen: map.seen,
    pressure: { ...p.pressure },
    events: p.events.map((e) => ({ ...e })),
    takenOffers: [...p.takenOffers],
  };
  return { ...departFrom(w, data, p.planetId), assist: { kind: 'none' }, jump: null, targetPlanetId: null };
}
