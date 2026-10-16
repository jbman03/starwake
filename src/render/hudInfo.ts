/** HUD text and colors, free of Phaser so the HTML touch HUD (src/ui/rails.ts) can share it. */
import type { GameData } from '../data/schemas';
import { fuelText, jumpsOf } from '../sim/fuel';
import type { WorldState } from '../sim/types';
import { dist } from '../sim/vec';

export const FUEL_COLORS = { normal: '#9fe7a0', low: '#ffb347', empty: '#ff5a4f' } as const;

export function fuelJumps(world: WorldState, data: GameData): number {
  return jumpsOf(world.ship.fuel, data.config.fuelPerJump);
}

export function fuelColor(jumps: number): string {
  return jumps >= 2 ? FUEL_COLORS.normal : jumps === 1 ? FUEL_COLORS.low : FUEL_COLORS.empty;
}

export interface HudInfo {
  system: string;
  fuel: string;
  fuelColor: string;
  target: string;
}

/** HUD text shared by the desktop panel and the touch-mode rail HUD. */
export function hudInfo(world: WorldState, data: GameData): HudInfo {
  const jumps = fuelJumps(world, data);
  const t = world.targetPlanetId ? data.planets[world.targetPlanetId] : undefined;
  return {
    system: data.systems[world.systemId]?.name ?? world.systemId,
    fuel: fuelText(jumps),
    fuelColor: fuelColor(jumps),
    target: t && t.systemId === world.systemId ? `Target: ${t.name}  ${Math.round(dist(t.pos, world.ship.pos))}` : 'Target: none',
  };
}
