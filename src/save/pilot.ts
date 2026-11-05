import { z } from 'zod';
import { StandingLevelSchema, type GameData } from '../data/schemas';
import { ESCORT_ID_PREFIX } from '../sim/combat';
import type { Escort, WorldState } from '../sim/types';
import { ESCORT_ORDERS, escortMaxArmor, escortMaxFuel } from '../sim/escorts';
import { revealOnArrival } from '../sim/galaxy';
import { hashString } from '../sim/random';
import { departFrom, newWorld } from '../sim/world';

export const CURRENT_SAVE_VERSION = 10;

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

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
function tolerantRecord<T>(fix: (entry: Record<string, unknown>) => T) {
  return z
    .record(z.string(), z.unknown())
    .transform((rec): Record<string, T> => {
      const out: Record<string, T> = {};
      for (const [k, v] of Object.entries(rec)) if (typeof v === 'object' && v !== null && !Array.isArray(v)) out[k] = fix(v as Record<string, unknown>);
      return out;
    });
}

interface SavedEscort {
  id: string;
  name: string;
  shipId: string;
  outfits: Record<string, number>;
  armor: number;
  fuel: number;
  hired: boolean;
  wage: number;
  leaving: boolean;
  // v9: wingman fields; worldFromPilot drops them when the wingman is unknown.
  wingmanId?: string;
  takedowns?: number;
  downUntilDay?: number;
}

function fixEscort(e: Record<string, unknown>): SavedEscort {
  const outfits: Record<string, number> = {};
  if (typeof e.outfits === 'object' && e.outfits !== null && !Array.isArray(e.outfits)) {
    for (const [k, v] of Object.entries(e.outfits)) if (typeof v === 'number' && Number.isInteger(v) && v > 0) outfits[k] = v;
  }
  return {
    id: typeof e.id === 'string' ? e.id : '',
    name: typeof e.name === 'string' ? e.name : '',
    shipId: typeof e.shipId === 'string' ? e.shipId : '',
    outfits,
    armor: num(e.armor),
    fuel: num(e.fuel),
    hired: e.hired === true,
    wage: Math.max(0, num(e.wage)),
    leaving: e.leaving === true,
    ...(typeof e.wingmanId === 'string' && e.wingmanId ? { wingmanId: e.wingmanId } : {}),
    ...(e.takedowns !== undefined ? { takedowns: Math.max(0, Math.floor(num(e.takedowns))) } : {}),
    ...(typeof e.downUntilDay === 'number' && Number.isFinite(e.downUntilDay) ? { downUntilDay: Math.max(0, Math.floor(e.downUntilDay)) } : {}),
  };
}

export const PilotSaveSchema = z.object({
  version: z.literal(10),
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
  // v7: law heat and rank records, per government. Corrupt values never fail the load: an entry that is
  // not an object is dropped, a non-finite or non-number field becomes 0, and the range clamps
  // (salaryDay keeps its -1 "never paid" floor). A law or ranks that is missing or not a record loads as empty.
  law: tolerantRecord((e) => ({ heat: clamp(num(e.heat), 0, 100) })).catch({}),
  ranks: tolerantRecord((e) => ({ points: Math.max(0, num(e.points)), salaryDay: Math.max(-1, num(e.salaryDay)) })).catch({}),
  // v8: hired escorts and the group order. Corrupt values never fail the load: a missing or non-array
  // list is empty, an entry that is not an object is dropped, a non-finite or non-number field becomes 0
  // and a non-boolean flag false. worldFromPilot checks the entries against game data.
  escorts: z
    .unknown()
    .transform((v): SavedEscort[] =>
      Array.isArray(v)
        ? v.filter((e) => typeof e === 'object' && e !== null && !Array.isArray(e)).map((e) => fixEscort(e as Record<string, unknown>))
        : [],
    )
    .catch([]),
  escortOrder: z.enum(ESCORT_ORDERS).catch('follow'),
  // v9: crew aboard. -1 (a migrated save, or a corrupt value) means a full complement; worldFromPilot resolves it.
  crew: z
    .unknown()
    .transform((v) => (typeof v === 'number' && Number.isFinite(v) ? v : -1))
    .catch(-1),
  // v10: the rival's record. A corrupt value loads as a fresh rival (no duels yet).
  nemesis: z
    .object({ defeats: z.number().int().nonnegative(), nextDay: z.number().finite().nonnegative(), done: z.boolean() })
    .catch({ defeats: 0, nextDay: 0, done: false }),
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
  // v6 -> v7. Data-free: no heat with any government, no rank points.
  6: (s) => ({ ...s, version: 7, law: {}, ranks: {} }),
  // v7 -> v8. Data-free: no escorts hired, the group follows.
  7: (s) => ({ ...s, version: 8, escorts: [], escortOrder: 'follow' }),
  // v8 -> v9. Data-free: the crew is full (-1, resolved against the hull on load); no wingmen yet.
  8: (s) => ({ ...s, version: 9, crew: -1 }),
  // v9 -> v10. Data-free: the rival has not appeared yet.
  9: (s) => ({ ...s, version: 10, nemesis: { defeats: 0, nextDay: 0, done: false } }),
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
    law: Object.fromEntries(Object.entries(world.law).map(([g, l]) => [g, { ...l }])),
    ranks: Object.fromEntries(Object.entries(world.ranks).map(([g, r]) => [g, { ...r }])),
    // `waiting` is not saved: a save is a landed snapshot, and landing rejoins every escort left behind.
    escorts: world.escorts.map((e) => ({
      id: e.id,
      name: e.name,
      shipId: e.shipId,
      outfits: { ...e.outfits },
      armor: e.armor,
      fuel: e.fuel,
      hired: e.hired,
      wage: e.wage,
      leaving: e.leaving === true,
      ...(e.wingmanId ? { wingmanId: e.wingmanId, takedowns: e.takedowns ?? 0 } : {}),
      ...(e.downUntilDay !== undefined ? { downUntilDay: e.downUntilDay } : {}),
    })),
    escortOrder: world.escortOrder,
    crew: world.crew,
    nemesis: { ...world.nemesis },
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
    // A corrupt value clamps rather than failing the load: heat to 0-100, points to 0 or more.
    law: Object.fromEntries(Object.entries(p.law).map(([g, l]) => [g, { heat: Math.min(100, Math.max(0, l.heat)) }])),
    ranks: Object.fromEntries(Object.entries(p.ranks).map(([g, r]) => [g, { ...r, points: Math.max(0, r.points) }])),
    escorts: escortsFromSave(p.escorts, data),
    escortOrder: p.escortOrder,
    // -1 is a full complement (a migrated save); otherwise a whole number within the hull's berths.
    crew: p.crew < 0 ? data.ships[p.shipId].crew : clamp(Math.floor(p.crew), 0, data.ships[p.shipId].crew),
    // More duels than the data has levels (a shortened rival) clamps to the last one.
    nemesis: { ...p.nemesis, defeats: Math.min(p.nemesis.defeats, data.fleet.nemesis.levels.length) },
  };
  return { ...departFrom(w, data, p.planetId), assist: { kind: 'none' }, jump: null, targetPlanetId: null };
}

/**
 * Repairs saved escorts against game data: unknown hulls and outfits go, numbers clamp, ids stay unique
 * and keep the `esc-` prefix (the player's side is known by it).
 */
function escortsFromSave(saved: PilotSave['escorts'], data: GameData): Escort[] {
  const out: Escort[] = [];
  const ids = new Set<string>();
  let n = 0;
  const freshId = (): string => {
    do n += 1;
    while (ids.has(`esc-${n}`) || saved.some((e) => e.id === `esc-${n}`));
    return `esc-${n}`;
  };
  const wingmen = new Set<string>();
  // A known wingman, once: their takedowns and recovery come too. Otherwise the entry is a plain escort.
  const wingmanFields = (s: SavedEscort): Pick<Escort, 'wingmanId' | 'takedowns' | 'downUntilDay'> => {
    if (!s.wingmanId || wingmen.has(s.wingmanId) || !data.fleet.wingmen.pilots.some((w) => w.id === s.wingmanId)) return {};
    wingmen.add(s.wingmanId);
    return { wingmanId: s.wingmanId, takedowns: s.takedowns ?? 0, ...(s.downUntilDay !== undefined ? { downUntilDay: s.downUntilDay } : {}) };
  };
  for (const s of saved) {
    const hull = data.ships[s.shipId];
    if (!hull) continue;
    const outfits = Object.fromEntries(Object.entries(s.outfits).filter(([id]) => data.outfits[id]));
    const id = s.id.startsWith(ESCORT_ID_PREFIX) && !ids.has(s.id) ? s.id : freshId();
    ids.add(id);
    out.push({
      id,
      name: s.name || hull.name,
      shipId: s.shipId,
      outfits,
      armor: clamp(s.armor, 0, escortMaxArmor(data, { shipId: s.shipId, outfits })),
      fuel: clamp(s.fuel, 0, escortMaxFuel(data, { shipId: s.shipId, outfits })),
      hired: s.hired,
      wage: s.hired ? s.wage : 0,
      ...(s.leaving ? { leaving: true as const } : {}),
      ...wingmanFields(s),
    });
  }
  return out.slice(0, data.escorts.maxEscorts);
}
