import { z } from 'zod';
import type { MoodId } from '../audio/moods';

const vec2 = z.object({ x: z.number(), y: z.number() });
const id = z.string().min(1);
const tier = z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]);

export const StandingLevelSchema = z.enum(['cool', 'neutral', 'friend']);
export type StandingLevel = z.infer<typeof StandingLevelSchema>;
const StandingReqSchema = z.object({ government: id, level: StandingLevelSchema });
const RankReqSchema = z.object({ government: id, rank: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]) });

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
  requiresRank: RankReqSchema.optional(), // faction rank needed before it is offered
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
  requiresRank: RankReqSchema.optional(), // faction rank needed before it is offered
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
  z.object({ ...outfitBase, category: z.literal('scrambler'), effect: effect('scramble') }), // blunts patrol cargo scans
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
  illegalIn: z.array(id).min(1).refine((a) => new Set(a).size === a.length, 'duplicate government').optional(), // governments that outlaw it
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

/** Jump timings (seconds unless named): the align, charge, burn, flash and arrive phases of a hyperspace jump. */
export const JumpConfigSchema = z
  .object({
    alignMaxSec: z.number().positive(),
    alignToleranceDeg: z.number().positive(),
    chargeSec: z.number().positive(),
    burnSec: z.number().positive(),
    burnThrustMul: z.number().positive(),
    flashSec: z.number().positive(),
    arriveSec: z.number().positive(),
    arriveSpeedMul: z.number().positive(),
  })
  .strict();
export type JumpConfig = z.infer<typeof JumpConfigSchema>;

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
  jump: JumpConfigSchema,
});

const heat = z.number().nonnegative();
const unit = z.number().min(0).max(1);

/** Law tunables: heat thresholds and crime values, fines, bribes, decay and contraband scans. */
export const LawSchema = z
  .object({
    thresholds: z.object({ suspect: z.number().positive(), wanted: z.number().positive(), hunted: z.number().positive() }).strict()
      .refine((t) => t.suspect < t.wanted && t.wanted < t.hunted && t.hunted <= 100, { message: 'expected 0 < suspect < wanted < hunted <= 100' }),
    crimes: z.object({ hit: heat, disable: heat, destroy: heat, contraband: heat, run: heat, board: heat }).strict(),
    refuseHeat: heat,
    decayPerDay: heat,
    fineRate: z.number().nonnegative(), // cr per heat point
    bribeMul: z.number().positive(), // bribe cost = bribeMul x fine
    bribeChance: unit,
    bribeFailHeat: heat,
    hailRange: z.number().positive(), // px
    scanRange: z.number().positive(), // px
    catchChance: unit,
    scramblerCut: unit, // fraction taken off catchChance by a scrambler
    contrabandFine: z.number().nonnegative(), // cr per ton confiscated
  })
  .strict();
export type LawDef = z.infer<typeof LawSchema>;

const PerkSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('title') }).strict(),
  z.object({ kind: z.literal('discount'), pct: z.number().positive().max(100) }).strict(),
  z.object({ kind: z.literal('salary'), cr: z.number().positive() }).strict(),
  z.object({ kind: z.literal('unlock'), missionPayPct: z.number().nonnegative() }).strict(),
  z.object({ kind: z.literal('discountSalary'), pct: z.number().positive().max(100), cr: z.number().positive() }).strict(),
]);
export type Perk = z.infer<typeof PerkSchema>;

const RankSchema = z.object({ title: z.string().min(1), points: z.number().int().positive(), perk: PerkSchema }).strict();

export const FactionSchema = z
  .object({
    ranks: z
      .array(RankSchema)
      .length(5)
      .refine((r) => r.every((x, i) => i === 0 || x.points > r[i - 1].points), { message: 'rank points must strictly increase' }),
    hub: id, // planet id
    rivals: z.array(id),
  })
  .strict();
/** factions.json is an object keyed by government id. */
export const FactionsSchema = z.record(id, FactionSchema);
export type FactionDef = z.infer<typeof FactionSchema>;
export type RankReq = z.infer<typeof RankReqSchema>;

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
    twoGoodsChance: chance, // a trader with 2 t or more carries two goods instead of one
    twoGoodsSplit: fractionRange, // the first good's share of the tons when there are two
    scuttleSec: z.number().positive(), // a ship that drove off a boarding party blows up this long after the card closes
    commandArmorFraction: z.number().positive().max(1), // take command patches the new hull to this much armor, no shields
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

/** Combat jobs: ports of these governments post them (government ids). */
const CombatMissionsSchema = z.object({ offerGovernments: z.array(z.string()).min(1) }).strict();

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
    missions: CombatMissionsSchema,
    tow: TowSchema,
  })
  .strict();
export type CombatDef = z.infer<typeof CombatSchema>;
export type AiProfile = z.infer<typeof AiProfileSchema>;

/**
 * Every sound effect id. `thrust` and `beam` are voices, not recipes. The guns' bolts play `shot`
 * (blaster chirp) or `cannon` (cannon thud), as `gunVoices` says; rockets play `missile` and seekers `seeker`.
 */
export const SFX_IDS = [
  'thrust', 'land', 'takeoff', 'trade', 'paid', 'hail', 'site', 'shot', 'cannon', 'missile', 'seeker',
  'beam', 'shieldHit', 'armorHit', 'explosion', 'disabled', 'alarm',
  'jumpCharge', 'jumpWhoosh', 'jumpArrive', 'uiClick',
] as const;
export type SfxId = (typeof SFX_IDS)[number];
export type RecipeId = Exclude<SfxId, 'thrust' | 'beam'>;
/** The voices a gun's bolts can play. */
export const GUN_VOICES = ['shot', 'cannon'] as const;
export type GunVoice = (typeof GUN_VOICES)[number];

const layerCommon = {
  dur: z.number().positive(),
  gain: z.number().nonnegative(),
  at: z.number().nonnegative().optional(),
  /** Seconds to swell to `gain` (default: a quick 20 ms or a quarter of `dur`); it then decays by `dur`. */
  attack: z.number().positive().optional(),
};
/**
 * One layer of a sound: a pitched tone sliding f0 to f1, or lowpass/highpass/bandpass noise sweeping c0
 * to c1 (with an optional filter Q). Each rises to `gain` over `attack`, then decays to silence at `dur`.
 */
export const SoundLayerSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('tone'),
      wave: z.enum(['sine', 'square', 'sawtooth', 'triangle']),
      f0: z.number().positive(),
      f1: z.number().positive().optional(),
      ...layerCommon,
    })
    .strict(),
  z
    .object({
      kind: z.literal('noise'),
      filter: z.enum(['lowpass', 'highpass', 'bandpass']),
      c0: z.number().positive(),
      c1: z.number().positive().optional(),
      q: z.number().positive().optional(),
      ...layerCommon,
    })
    .strict(),
]);
export type SoundLayer = z.infer<typeof SoundLayerSchema>;

const recipe = z
  .object({
    layers: z
      .array(SoundLayerSchema)
      .min(1)
      .superRefine((layers, ctx) =>
        layers.forEach((l, i) => {
          if (l.attack !== undefined && l.attack >= l.dur) ctx.addIssue({ code: 'custom', path: [i, 'attack'], message: 'attack must be shorter than dur' });
        }),
      ),
  })
  .strict();

const chordLen = z.number().min(8).max(20);
/** One music mood: a root and scale, a filtered pad, a drone, an optional melody and (combat only) a pulse. */
export const MoodSchema = z
  .object({
    /** Hz of the drone; the pad sits an octave up and the melody two. */
    root: z.number().positive(),
    /** Semitone offsets from the root, ascending; chords stack every other degree. */
    scale: z
      .array(z.number().int().min(0).max(11))
      .min(5)
      .refine((s) => s[0] === 0 && s.every((v, i) => i === 0 || v > s[i - 1]), 'scale must start at 0 and ascend'),
    /** Seconds per chord: [min, max], within 8–20. */
    chordSec: z.tuple([chordLen, chordLen]).refine(([lo, hi]) => lo <= hi, 'chordSec min must not exceed max'),
    pad: z
      .object({
        waves: z.array(z.enum(['sine', 'triangle', 'sawtooth'])).min(1).max(3),
        cutoff: z.number().positive(),
        gain: z.number().nonnegative(),
      })
      .strict(),
    drone: z.object({ gain: z.number().nonnegative() }).strict(),
    melody: z.object({ chance: z.number().min(0).max(1), gain: z.number().nonnegative() }).strict().nullable(),
    pulse: z.object({ bpm: z.number().min(30).max(240), gain: z.number().nonnegative() }).strict().nullable(),
    level: z.number().min(0).max(1),
  })
  .strict();
export type MoodDef = z.infer<typeof MoodSchema>;
const calmMood = MoodSchema.refine((m) => m.pulse === null, 'only combat has a pulse');

export const AudioSchema = z
  .object({
    sfx: z
      .object({
        land: recipe,
        takeoff: recipe,
        trade: recipe,
        paid: recipe,
        hail: recipe,
        site: recipe,
        shot: recipe,
        cannon: recipe,
        missile: recipe,
        seeker: recipe,
        shieldHit: recipe,
        armorHit: recipe,
        explosion: recipe,
        disabled: recipe,
        alarm: recipe,
        jumpCharge: recipe,
        jumpWhoosh: recipe,
        jumpArrive: recipe,
        uiClick: recipe,
      })
      .strict(),
    voices: z
      .object({
        /** The engine hum: noise low-passed at `f` (the rumble) under a filtered tone, both at `gain` overall. */
        hum: z
          .object({
            gain: z.number().nonnegative(),
            rampSec: z.number().positive(),
            f: z.number().positive(),
            /** The tone: `wave` at `f` Hz, low-passed at `cutoff`, mixed at `gain` against the rumble's 1. */
            tone: z
              .object({
                wave: z.enum(['sine', 'square', 'sawtooth', 'triangle']),
                f: z.number().positive(),
                cutoff: z.number().positive(),
                gain: z.number().nonnegative(),
              })
              .strict(),
          })
          .strict(),
        beam: z
          .object({
            gain: z.number().nonnegative(),
            holdSec: z.number().positive(),
            fadeSec: z.number().positive(),
            /** The buzz: `wave` at `f` Hz, low-passed at `cutoff`. */
            wave: z.enum(['sine', 'square', 'sawtooth', 'triangle']),
            f: z.number().positive(),
            cutoff: z.number().positive(),
          })
          .strict(),
      })
      .strict(),
    /** Gun or turret outfit id → the voice its bolts play; a gun not named plays `shot`. */
    gunVoices: z.record(z.string(), z.enum(GUN_VOICES)),
    moods: z
      .object({ core: calmMood, fringe: calmMood, docked: calmMood, hyperspace: calmMood, combat: MoodSchema })
      .strict(),
  })
  .strict();
export type AudioDef = z.infer<typeof AudioSchema>;
/** Compile-time check: audio.json has a recipe for exactly the ids in RecipeId. */
export type AudioRecipesMatch = AudioDef['sfx'] extends Record<RecipeId, unknown> ? (keyof AudioDef['sfx'] extends RecipeId ? true : never) : never;
/** Compile-time check: audio.json has a mood for exactly the ids in MoodId. */
const audioMoodsMatch: [keyof AudioDef['moods']] extends [MoodId] ? ([MoodId] extends [keyof AudioDef['moods']] ? true : never) : never = true;
void audioMoodsMatch;

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
  audio: AudioDef;
  law: LawDef;
  factions: Record<string, FactionDef>;
}
