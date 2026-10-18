import { z } from 'zod';

const vec2 = z.object({ x: z.number(), y: z.number() });
const id = z.string().min(1);

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
});

export const SystemSchema = z.object({
  id,
  name: z.string(),
  mapPos: vec2,
  jumpDistance: z.number().positive(),
  government: id,
  links: z.array(id),
  starRadius: z.number().positive(),
  hazards: z.array(z.string()).optional(),
});

export const PlanetSchema = z.object({
  id,
  name: z.string(),
  systemId: id,
  pos: vec2,
  radius: z.number().positive(),
  techTier: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]),
  fuelPrice: z.number().nonnegative(),
  description: z.string(),
  kind: z.enum(['planet', 'station']),
  services: z.array(z.enum(['exchange', 'missions', 'shipyard', 'outfitter'])),
  market: z.record(z.string(), z.enum(['low', 'med', 'high'])).optional(),
  dumpSite: z.boolean().optional(),
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
});

export type ShipDef = z.infer<typeof ShipSchema>;
export type SystemDef = z.infer<typeof SystemSchema>;
export type PlanetDef = z.infer<typeof PlanetSchema>;
export type GovernmentDef = z.infer<typeof GovernmentSchema>;
export type CommodityDef = z.infer<typeof CommoditySchema>;
export type EventDef = z.infer<typeof EventSchema>;
export type MissionTypeDef = z.infer<typeof MissionTypeSchema>;
export type GameConfig = z.infer<typeof ConfigSchema>;

export interface GameData {
  ships: Record<string, ShipDef>;
  systems: Record<string, SystemDef>;
  planets: Record<string, PlanetDef>;
  governments: Record<string, GovernmentDef>;
  commodities: Record<string, CommodityDef>;
  events: Record<string, EventDef>;
  missionTypes: Record<string, MissionTypeDef>;
  config: GameConfig;
}
