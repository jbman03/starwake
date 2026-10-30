import { z } from 'zod';

const vec2 = z.object({ x: z.number(), y: z.number() });
const id = z.string().min(1);
const tier = z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]);

export const StandingLevelSchema = z.enum(['cool', 'neutral', 'friend']);
export type StandingLevel = z.infer<typeof StandingLevelSchema>;
const StandingReqSchema = z.object({ government: id, level: StandingLevelSchema });

export const ShipSchema = z.object({
  id,
  name: z.string(),
  turnRate: z.number().positive(), // degrees per second
  acceleration: z.number().positive(),
  maxSpeed: z.number().positive(),
  fuelCapacity: z.number().positive(),
  radius: z.number().positive(),
  cargo: z.number().int().nonnegative(), // tons
  passengers: z.number().int().nonnegative(), // berths
  price: z.number().int().nonnegative(),
  techTier: tier,
  shields: z.number().int().nonnegative(),
  armor: z.number().int().nonnegative(),
  outfitSpace: z.number().int().nonnegative(), // tons available for outfits
  role: z.enum([
    'starter',
    'courier',
    'scout',
    'freighter',
    'heavyFreighter',
    'liner',
    'interceptor',
    'corvette',
    'trader',
    'carrier',
  ]),
  hull: z.enum(['pod', 'dart', 'wedge', 'hauler', 'liner', 'carrier']),
  description: z.string(),
  soldBy: z.array(id).optional(), // government ids; absent = sold anywhere the tier allows
  soldAt: z.array(id).optional(), // port ids; absent = any port the tier and government allow
  unique: z.boolean().optional(), // a one-off hull, sold once
  requiresFlag: z.string().min(1).optional(), // story flag needed before it is offered
  requiresStanding: StandingReqSchema.optional(), // government standing needed before it is offered
  hiddenByFlag: z.string().min(1).optional(), // once this flag is set the yard no longer lists the hull
  teaser: z.string().min(1).optional(), // caption on the locked silhouette tile; absent = a neutral default
  chartJumps: z.number().int().positive().optional(), // built-in chart: reveals this many jumps on arrival
  crew: z.number().int().positive(), // NPC crew: sizes the fallback loadout and the boarding prize
  loadout: z.record(id, z.number().int().positive()).optional(), // NPC-only fit: outfit id -> count
});

const outfitBase = {
  id,
  name: z.string(),
  description: z.string(),
  price: z.number().int().nonnegative(),
  techTier: tier,
  space: z.number().int().nonnegative(),
  max: z.number().int().positive(),
  soldBy: z.array(id).optional(),
  soldAt: z.array(id).optional(), // port ids; absent = any port the tier and government allow
  unique: z.boolean().optional(), // a one-off, sold once
  requiresFlag: z.string().min(1).optional(), // story flag needed before it is offered
  requiresStanding: StandingReqSchema.optional(),
};

const effect = <K extends string>(key: K) => z.object({ [key]: z.number().positive() } as Record<K, z.ZodNumber>).strict();

const pos = z.number().positive();
const nonneg = z.number().nonnegative();

export const OutfitSchema = z.discriminatedUnion('category', [
  z.object({ ...outfitBase, category: z.literal('cargo'), effect: effect('cargo') }),
  z.object({ ...outfitBase, category: z.literal('fuel'), effect: effect('fuel') }),
  z.object({ ...outfitBase, category: z.literal('armor'), effect: effect('armor') }),
  z.object({ ...outfitBase, category: z.literal('shields'), effect: effect('shields') }),
  z.object({ ...outfitBase, category: z.literal('map'), effect: effect('mapJumps') }),
  z.object({ ...outfitBase, category: z.literal('scoop'), effect: effect('fuelPerMin') }),
  // Weapons. Spread and assist are degrees, rate is shots per second, turnRate is degrees per second (0 = unguided).
  z.object({
    ...outfitBase,
    category: z.literal('gun'),
    effect: z.object({ damage: pos, rate: pos, speed: pos, range: pos, spread: nonneg, assist: nonneg }).strict(),
  }),
  z.object({
    ...outfitBase,
    category: z.literal('turret'),
    effect: z.object({ damage: pos, rate: pos, speed: pos, range: pos }).strict(),
  }),
  z.object({ ...outfitBase, category: z.literal('launcher'), effect: z.object({ ammo: id, rate: pos }).strict() }),
  z.object({
    ...outfitBase,
    category: z.literal('ammo'),
    effect: z.object({ damage: pos, speed: pos, range: pos, turnRate: nonneg }).strict(),
  }),
  z.object({ ...outfitBase, category: z.literal('beam'), effect: z.object({ dps: pos, range: pos }).strict() }),
  z.object({ ...outfitBase, category: z.literal('pod'), effect: z.object({ pods: z.literal(1) }).strict() }),
]);

export const SystemSchema = z.object({
  id,
  name: z.string(),
  mapPos: vec2,
  jumpDistance: z.number().positive(),
  government: id,
  links: z.array(id),
  starRadius: z.number().positive(),
  hazards: z.array(z.string()).optional(),
  hiddenLinks: z.array(id).optional(), // lanes that stay out of sight until a story flag opens them
  hidden: z.boolean().optional(), // never charted by local maps or routing until its lane is opened
  unlockFlag: id.optional(), // the story flag that opens a hidden system (required when hidden)
  traffic: z.tuple([z.number().int().nonnegative(), z.number().int().nonnegative()]).optional(), // [min, max] NPC ships
});

export const PlanetSchema = z.object({
  id,
  name: z.string(),
  systemId: id,
  pos: vec2,
  radius: z.number().positive(),
  techTier: tier,
  fuelPrice: z.number().nonnegative(),
  description: z.string(),
  kind: z.enum(['planet', 'station']),
  services: z.array(z.enum(['exchange', 'missions', 'shipyard', 'outfitter', 'bar'])),
  market: z.record(z.string(), z.enum(['low', 'med', 'high'])).optional(),
  dumpSite: z.boolean().optional(),
  hub: z.boolean().optional(), // tech hub: sells everything its tier and government allow
});

export const GovernmentSchema = z.object({
  id,
  name: z.string(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'expected #rrggbb color'),
  description: z.string(),
});

export const CommoditySchema = z.object({
  id,
  name: z.string(),
  basePrice: z.number().positive(),
  description: z.string(),
  origin: id.optional(), // port id for unique goods
});

const range = z
  .tuple([z.number().nonnegative(), z.number().nonnegative()])
  .refine(([a, b]) => a <= b, { message: 'expected [min, max] with min <= max' });

export const EventSchema = z.object({
  id,
  text: z.string().includes('{port}'),
  commodity: id,
  effect: z.enum(['surplus', 'shortage']),
  strength: z.number().positive(),
  /** Event length is drawn with randInt, so whole days only, at least 1. */
  days: z
    .tuple([z.number().int().positive(), z.number().int().positive()])
    .refine(([a, b]) => a <= b, { message: 'expected [min, max] with min <= max' }),
});

export const MissionTypeSchema = z.object({
  id,
  name: z.string(),
  hops: range,
  tons: range,
  passengers: range,
  deadline: z.object({ perHop: z.number().nonnegative(), plus: z.number().nonnegative() }).nullable(),
  basePay: z.number().nonnegative(),
  perHop: z.number().nonnegative(),
  perTon: z.number().nonnegative(),
  perPassenger: z.number().nonnegative(),
  urgency: z.number().positive(),
  paidUpfront: z.boolean(),
  toDumpSite: z.boolean(),
  titleTemplate: z.string(),
  textTemplate: z.string(),
  combat: z
    .object({
      kind: z.enum(['bounty', 'clear']),
      count: range.optional(), // clear: raiders to disable or destroy
      perRaider: z.number().nonnegative().optional(), // clear: pay added per raider
      hullPayDivisor: z.number().positive().optional(), // bounty: pay is scaled by max(1, hull price / this)
      minTier: z.number().int().positive().optional(), // bounty: lowest hull tech tier the target may fly
    })
    .optional(),
});

export const NamesSchema = z.object({
  first: z.array(z.string().min(1)).min(1),
  second: z.array(z.string().min(1)).min(1),
});

const count = z.number().int();

export const OutcomeSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('credits'), n: count }),
  z.object({ type: z.literal('cargo'), good: id, tons: z.number().int().refine((n) => n !== 0, 'expected a non-zero count') }), // negative hands cargo over
  z.object({ type: z.literal('fuel'), n: count }),
  z.object({ type: z.literal('mission'), missionType: id, toSystem: id.optional() }),
  z.object({ type: z.literal('reveal'), systems: z.array(id).optional(), jumps: z.number().int().positive().optional() }),
  z.object({ type: z.literal('rumour'), text: z.string().min(1) }),
  z.object({ type: z.literal('flag'), flag: id }),
  z.object({ type: z.literal('message'), text: z.string().min(1) }),
  z.object({ type: z.literal('standing'), government: id, level: StandingLevelSchema }),
  z.object({ type: z.literal('unlock'), flag: id }),
]);

const EncounterChoiceSchema = z.object({
  label: z.string().min(1),
  needs: z
    .object({
      fuel: z.number().nonnegative().optional(),
      credits: z.number().nonnegative().optional(),
      cargoSpace: z.number().nonnegative().optional(),
      cargo: z.object({ good: id, tons: z.number().int().positive() }).optional(), // trade goods that must be in the hold
      flag: id.optional(), // a story flag that must be set
    })
    .optional(),
  outcomes: z.array(OutcomeSchema),
});

/** A card: title, text and 1-3 choices (the encounter card UI's shape). */
export const EncounterCardSchema = z.object({
  title: z.string().min(1),
  text: z.string().min(1),
  choices: z.array(EncounterChoiceSchema).min(1).max(3),
});

export const EncounterSchema = z.object({
  id,
  kind: z.enum(['hail', 'site']),
  weight: z.number().positive(),
  once: z.boolean().optional(),
  title: z.string().min(1),
  text: z.string().min(1), // may use {ship}, {system} and {pilot}
  when: z
    .object({
      minDay: z.number().int().nonnegative().optional(),
      governments: z.array(id).optional(),
      tiers: z.array(tier).optional(),
      systems: z.array(id).optional(),
      requiresFlag: id.optional(),
      notFlag: id.optional(),
    })
    .optional(),
  choices: EncounterCardSchema.shape.choices,
});

const flagList = z.array(id);
const text = z.string().min(1);
const site = z.object({ label: text });

export const StoryStepSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('go'), system: id, text }),
  z.object({ kind: z.literal('land'), planet: id, text }),
  z.object({
    kind: z.literal('deliver'),
    planet: id,
    cargo: z.object({ name: text, tons: z.number().int().positive() }),
    deadlineDays: z.number().int().positive().optional(),
    text,
  }),
  z.object({
    kind: z.literal('ferry'),
    planet: id,
    passengers: z.number().int().positive(),
    deadlineDays: z.number().int().positive().optional(),
    text,
  }),
  z.object({ kind: z.literal('scan'), system: id, site, text }),
  z.object({ kind: z.literal('find'), system: id, site, text }),
  z.object({
    kind: z.literal('meet'),
    system: id,
    ship: z.object({ name: text, shipId: id, government: id }),
    card: EncounterCardSchema,
    text,
  }),
]);

export const StoryMissionSchema = z.object({
  id,
  arc: z.enum(['main', 'concord', 'reach', 'side']),
  chain: id.optional(),
  title: text,
  giver: z.object({ name: text, title: text }),
  offer: z.object({
    where: z.enum(['bar', 'hail']),
    ports: z.array(id).optional(),
    systems: z.array(id).optional(),
    requires: flagList.optional(),
    notFlags: flagList.optional(),
    minDay: z.number().int().nonnegative().optional(),
    standing: z.record(id, StandingLevelSchema).optional(),
  }),
  text, // the offer
  acceptText: text,
  declinable: z.boolean(), // main-arc missions can be put off, never lost
  steps: z.array(StoryStepSchema).min(1),
  onComplete: z.array(OutcomeSchema),
  onFail: z.array(OutcomeSchema).optional(),
  onLate: z.literal('retry').optional(), // a late mission is offered again from the next day instead of failing
  combatLater: z.string().optional(), // the note for the combat cycle
});

export const ConfigSchema = z.object({
  startSystemId: id,
  startPlanetId: id,
  startShipId: id,
  startCredits: z.number().nonnegative(),
  towFee: z.number().nonnegative(),
  landingSpeed: z.number().positive(),
  landingMargin: z.number().nonnegative(),
  arrivalRadius: z.number().positive(),
  fuelPerJump: z.number().nonnegative(),
  knownAtStart: z.array(id), // system ids
  startYear: z.number().int(),
  startMonth: z.number().int().min(1).max(12),
  startDay: z.number().int().min(1).max(31),
  startOutfits: z.record(id, z.number().int().positive()), // outfit id -> count a new pilot starts with
});

export type ShipDef = z.infer<typeof ShipSchema>;
export type OutfitDef = z.infer<typeof OutfitSchema>;
export type SystemDef = z.infer<typeof SystemSchema>;
export type PlanetDef = z.infer<typeof PlanetSchema>;
export type GovernmentDef = z.infer<typeof GovernmentSchema>;
export type CommodityDef = z.infer<typeof CommoditySchema>;
export type EventDef = z.infer<typeof EventSchema>;
export type MissionTypeDef = z.infer<typeof MissionTypeSchema>;
export type Outcome = z.infer<typeof OutcomeSchema>;
export type EncounterDef = z.infer<typeof EncounterSchema>;
export type StoryStepDef = z.infer<typeof StoryStepSchema>;
export type StoryMissionDef = z.infer<typeof StoryMissionSchema>;
export type GameConfig = z.infer<typeof ConfigSchema>;

/** How one NPC role fights. `flee` is the armor fraction below which it runs (0 never flees). */
const AiProfileSchema = z
  .object({
    flee: z.number().min(0).max(1),
    engageRange: z.number().positive(),
    keepRange: z.number().positive(),
    fireCone: z.number().positive().max(180), // degrees
  })
  .strict();

const chance = z.number().min(0).max(1);

/** Who spawns where. Chance keys are government ids (plus "fringe" for systems whose ports are all tier 1). */
const SpawnSchema = z
  .object({
    raiderChance: z.record(z.string(), chance),
    patrolChance: z.record(z.string(), chance),
    clearBoost: chance, // raider chance in the system of an active clear job
    maxHostileRaiders: z.number().int().nonnegative(),
    raiderHulls: z.record(z.string(), z.number().positive()), // ship id -> weight
    patrolHulls: z.array(z.string()).min(1),
  })
  .strict();

const fractionRange = z
  .tuple([chance, chance])
  .refine(([lo, hi]) => lo <= hi, 'expected min <= max');

/** Boarding and capture tunables. */
const BoardingSchema = z
  .object({
    range: z.number().positive(),
    maxSpeed: z.number().positive(), // relative speed
    creditsFraction: fractionRange, // of the hull price
    cargoFraction: fractionRange, // of the hull's cargo tons (traders)
    captureBase: chance,
    captureMin: chance,
    captureMax: chance,
    prizeFraction: chance, // of the hull price
  })
  .strict()
  .refine((b) => b.captureMin <= b.captureMax, { message: 'expected captureMin <= captureMax', path: ['captureMin'] });

/** A raider's demand: pay credits or dump cargo, or it attacks. */
const DemandSchema = z
  .object({
    creditsFraction: chance, // of the pilot's credits
    minCredits: z.number().int().nonnegative(),
    cargoTons: z.number().positive(),
    lapseSec: z.number().positive(), // flight seconds before an unanswered demand turns into an attack
    chance, // of a new raider hailing first
  })
  .strict();

/** Where a bounty target appears: this far (px) from the player on arrival. */
const BountySchema = z
  .object({ spawnMin: z.number().positive(), spawnMax: z.number().positive() })
  .strict()
  .refine((b) => b.spawnMin <= b.spawnMax, { message: 'expected spawnMin <= spawnMax', path: ['spawnMin'] });

/**
 * A disabled pilot's tow. Besides the spec's wait (no threatening hostile within range for a few
 * seconds), a tow is offered once the player has taken no hit for `quietSec`, so a hostile that
 * sits near but never fires can't strand the pilot.
 */
const TowSchema = z.object({ quietSec: z.number().positive() }).strict();

export const CombatSchema = z
  .object({
    ai: z.object({ trader: AiProfileSchema, patrol: AiProfileSchema, raider: AiProfileSchema }).strict(),
    spawn: SpawnSchema,
    boarding: BoardingSchema,
    demand: DemandSchema,
    bounty: BountySchema,
    tow: TowSchema,
  })
  .strict();
export type CombatDef = z.infer<typeof CombatSchema>;
export type AiProfile = z.infer<typeof AiProfileSchema>;

export interface GameData {
  ships: Record<string, ShipDef>;
  outfits: Record<string, OutfitDef>;
  systems: Record<string, SystemDef>;
  planets: Record<string, PlanetDef>;
  governments: Record<string, GovernmentDef>;
  commodities: Record<string, CommodityDef>;
  events: Record<string, EventDef>;
  missionTypes: Record<string, MissionTypeDef>;
  names: { first: string[]; second: string[] };
  encounters: Record<string, EncounterDef>;
  story: Record<string, StoryMissionDef>;
  config: GameConfig;
  combat: CombatDef;
}
