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
});

export const SystemSchema = z.object({
  id,
  name: z.string(),
  mapPos: vec2,
  jumpDistance: z.number().positive(),
  links: z.array(id),
  starRadius: z.number().positive(),
});

export const PlanetSchema = z.object({
  id,
  name: z.string(),
  systemId: id,
  pos: vec2,
  radius: z.number().positive(),
  techTier: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]),
  fuelPrice: z.number().nonnegative().optional(),
  description: z.string(),
  kind: z.enum(['planet', 'station']),
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
});

export type ShipDef = z.infer<typeof ShipSchema>;
export type SystemDef = z.infer<typeof SystemSchema>;
export type PlanetDef = z.infer<typeof PlanetSchema>;
export type GameConfig = z.infer<typeof ConfigSchema>;

export interface GameData {
  ships: Record<string, ShipDef>;
  systems: Record<string, SystemDef>;
  planets: Record<string, PlanetDef>;
  config: GameConfig;
}
