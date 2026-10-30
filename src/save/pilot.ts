import { z } from 'zod';
import { StandingLevelSchema, type GameData } from '../data/schemas';
import type { WorldState } from '../sim/types';
import { revealOnArrival } from '../sim/galaxy';
import { hashString } from '../sim/random';
import { departFrom, newWorld } from '../sim/world';

export const CURRENT_SAVE_VERSION = 6;

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
  // v6: combat jobs.
  combat: z
    .object({
      kind: z.enum(['bounty', 'clear']),
      systemId: z.string().min(1),
      shipId: z.string().min(1).optional(),
      targetName: z.string().optional(),
      needed: z.number().int().positive(),
      done: z.number().int().nonnegative(),
    })
    .optional(),
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
  version: z.literal(6),
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
  // v3: owned outfits (outfit id -> count).
  outfits: z.record(z.string(), z.number().int().positive()),
  // v4: story flags, captain's log, ship name, stats, last encounter.
  flags: z.array(z.string()),
  notes: z.array(z.object({ day: z.number().finite(), text: z.string() })).max(20),
  shipName: z.string(),
  // v6 adds kills and captures to stats.
  stats: z.object({
    jobsDone: z.number().int().nonnegative(),
    kills: z.number().int().nonnegative(),
    captures: z.number().int().nonnegative(),
  }),
  lastEncounterDay: z.number().finite().nullable(),
  // v5: story missions and government standing.
  story: z.object({
    active: z.array(
      z.object({ id: z.string().min(1), step: z.number().int().nonnegative(), deadlineDay: z.number().finite().nullable() }),
    ),
    done: z.array(z.string()),
    doneDays: z.record(z.string(), z.number().finite()).optional(),
    failed: z.array(z.string()),
    declined: z.array(z.string()),
  }),
  standing: z.record(z.string(), StandingLevelSchema),
});

export type PilotSave = z.infer<typeof PilotSaveSchema>;

/** Fixed facts for the v5 -> v6 migration, which must not read game data. */
const SHUTTLE_SPACE = 10;
const STARTER_GUN_SPACE = 3;
/** The space (t) of every outfit that existed before v6. An id not listed here skips the gift. */
const STARTER_ERA_SPACE: Record<string, number> = {
  'cargo-pod': 5,
  'fuel-tank': 3,
  'local-chart': 0,
  'armor-plate': 5,
  'shield-booster': 4,
  'fuel-scoop': 6,
  'cargo-bay': 15,
  'extended-tank': 8,
  'salvage-tank': 6,
  'frontier-rack': 5,
  'reinforced-plating': 6,
  'heavy-armor': 10,
  'shield-array': 8,
  'surveyors-folio': 0,
  'house-rack': 5,
  'cold-hold': 8,
  'keepers-lens': 0,
};

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
  // v2 -> v3: no outfits owned.
  2: (s) => ({ ...s, version: 3, outfits: {} }),
  // v3 -> v4. Data-free: shipName starts empty, which means "use the hull's name" wherever it is shown.
  3: (s) => ({
    ...s,
    version: 4,
    flags: [],
    notes: [],
    shipName: '',
    stats: { jobsDone: 0 },
    lastEncounterDay: null,
  }),
  // v4 -> v5. Data-free: no story under way, every standing neutral.
  4: (s) => ({
    ...s,
    version: 5,
    story: { active: [], done: [], failed: [], declined: [] },
    standing: {},
  }),
  // v5 -> v6. Data-free: the shuttle's 10 t and the starter-era outfit spaces are hard-coded here.
  // A shuttle pilot gets the starter gun only if the space is known and has 3 t free.
  5: (s) => {
    const outfits: Record<string, number> = { ...(s.outfits ?? {}) };
    if (s.shipId === 'shuttle') {
      let used = 0;
      let known = true;
      for (const [id, n] of Object.entries(outfits)) {
        const space = STARTER_ERA_SPACE[id];
        if (space === undefined) known = false;
        else used += space * Number(n);
      }
      if (known && used + STARTER_GUN_SPACE <= SHUTTLE_SPACE) outfits['light-blaster'] = 1;
    }
    return { ...s, version: 6, outfits, stats: { ...s.stats, kills: 0, captures: 0 } };
  },
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
    missions: world.missions.map((m) => ({ ...m, ...(m.combat ? { combat: { ...m.combat } } : {}) })),
    route: [...world.route],
    known: [...world.known],
    seen: [...world.seen],
    pressure: { ...world.pressure },
    events: world.events.map((e) => ({ ...e })),
    takenOffers: [...world.takenOffers],
    outfits: { ...world.outfits },
    flags: [...world.flags],
    notes: world.notes.map((n) => ({ ...n })),
    shipName: world.shipName,
    stats: { ...world.stats },
    lastEncounterDay: world.lastEncounterDay,
    story: {
      active: world.story.active.map((a) => ({ ...a })),
      done: [...world.story.done],
      ...(world.story.doneDays ? { doneDays: { ...world.story.doneDays } } : {}),
      failed: [...world.story.failed],
      declined: [...world.story.declined],
    },
    standing: { ...world.standing },
  };
}

export function worldFromPilot(p: PilotSave, data: GameData): WorldState {
  const planet = data.planets[p.planetId];
  if (!data.ships[p.shipId] || !data.systems[p.systemId] || !planet) throw new SaveError('invalid', 'unknown id');
  for (const id of Object.keys(p.cargo)) if (!data.commodities[id]) throw new SaveError('unknownContent', `unknown commodity "${id}"`);
  for (const id of Object.keys(p.outfits)) if (!data.outfits[id]) throw new SaveError('unknownContent', `unknown outfit "${id}"`);
  for (const m of p.missions) if (!data.planets[m.destId]) throw new SaveError('unknownContent', `unknown mission port "${m.destId}"`);
  // A combat job whose system, or a bounty whose target hull, is not in the data (a hand-edited save,
  // or a hull since removed) could not spawn its target, so it is dropped and the rest of the save loads.
  const combatOk = ({ combat }: PilotSave['missions'][number]): boolean =>
    !combat || (!!data.systems[combat.systemId] && (combat.kind !== 'bounty' || !!data.ships[combat.shipId ?? '']));
  // A v1 upgrade has no chart: start from the opening chart plus where the pilot is. Either way
  // `seen` is recomputed so it is exactly the unvisited neighbours of `known`.
  let known = p.known;
  if (known.length === 0) known = [...new Set([...data.config.knownAtStart, p.systemId])];
  let map = { known: [] as string[], seen: [] as string[] };
  for (const id of known) if (data.systems[id]) map = revealOnArrival(map.known, map.seen, data, id, p.flags);
  map = revealOnArrival(map.known, map.seen, data, p.systemId, p.flags);
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
    missions: p.missions.filter(combatOk).map((m) => ({ ...m, ...(m.combat ? { combat: { ...m.combat } } : {}) })),
    route: [...p.route],
    known: map.known,
    seen: map.seen,
    pressure: { ...p.pressure },
    events: p.events.map((e) => ({ ...e })),
    takenOffers: [...p.takenOffers],
    // Charts are one-time map reveals, never fitted gear: a crafted save can't hold them.
    outfits: Object.fromEntries(Object.entries(p.outfits).filter(([id]) => data.outfits[id].category !== 'map')),
    flags: [...p.flags],
    notes: p.notes.map((n) => ({ ...n })),
    // '' (a migrated v3 save, or never named) stays as is; shipDisplayName resolves it for display.
    shipName: p.shipName,
    stats: { ...p.stats },
    lastEncounterDay: p.lastEncounterDay,
    story: {
      active: p.story.active.map((a) => ({ ...a })),
      done: [...p.story.done],
      ...(p.story.doneDays ? { doneDays: { ...p.story.doneDays } } : {}),
      failed: [...p.story.failed],
      declined: [...p.story.declined],
    },
    standing: { ...p.standing },
  };
  return { ...departFrom(w, data, p.planetId), assist: { kind: 'none' }, jump: null, targetPlanetId: null };
}
