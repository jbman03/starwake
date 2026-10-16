import { z } from 'zod';
import type { GameData } from '../data/schemas';
import type { WorldState } from '../sim/types';
import { departFrom, newWorld } from '../sim/world';

export const CURRENT_SAVE_VERSION = 1;

export class SaveError extends Error {
  constructor(public readonly code: 'futureVersion' | 'invalid', message?: string) {
    super(message ?? code);
    this.name = 'SaveError';
  }
}

export const PilotSaveSchema = z.object({
  version: z.literal(1),
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
});

export type PilotSave = z.infer<typeof PilotSaveSchema>;

/** Keyed by the version being upgraded FROM; each returns the next version's shape. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const migrations: Record<number, (s: any) => any> = {};

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
  };
}

export function worldFromPilot(p: PilotSave, data: GameData): WorldState {
  const planet = data.planets[p.planetId];
  if (!data.ships[p.shipId] || !data.systems[p.systemId] || !planet) throw new SaveError('invalid', 'unknown id');
  const base = newWorld(data);
  const w: WorldState = {
    ...base,
    systemId: p.systemId,
    shipId: p.shipId,
    credits: p.credits,
    timeSec: p.gameTimeSec,
    ship: { ...base.ship, fuel: p.fuel },
  };
  return { ...departFrom(w, data, p.planetId), assist: { kind: 'none' }, jump: null, targetPlanetId: null };
}
