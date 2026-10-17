/** HUD text and colors, free of Phaser so the HTML touch HUD (src/ui/rails.ts) can share it. */
import type { GameData } from '../data/schemas';
import { cargoFree } from '../sim/cargo';
import { fuelText, jumpsOf } from '../sim/fuel';
import { jumpDestination } from '../sim/rules';
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
  /** "Credits: 9,290 cr" */
  credits: string;
  /** "Cargo: 10/20 t" (free / hold size). */
  cargo: string;
  target: string;
  /** "Course: Vesk (2 jumps)" while a course is plotted, else null. */
  nextHop: string | null;
}

/** HUD line for a plotted course: the next hop and the jumps left to its end, or null. */
export function nextHopText(world: WorldState, data: GameData): string | null {
  const next = world.route[0];
  if (next === undefined) return null;
  const n = world.route.length;
  return `Course: ${data.systems[next]?.name ?? next} (${n} ${n === 1 ? 'jump' : 'jumps'})`;
}

/** HUD text shared by the desktop panel and the touch-mode rail HUD. */
export function hudInfo(world: WorldState, data: GameData): HudInfo {
  const jumps = fuelJumps(world, data);
  const t = world.targetPlanetId ? data.planets[world.targetPlanetId] : undefined;
  return {
    system: data.systems[world.systemId]?.name ?? world.systemId,
    fuel: fuelText(jumps),
    fuelColor: fuelColor(jumps),
    credits: `Credits: ${Math.round(world.credits).toLocaleString('en-US')} cr`,
    cargo: `Cargo: ${cargoFree(world, data)}/${data.ships[world.shipId].cargo} t`,
    target: t && t.systemId === world.systemId ? `Target: ${t.name}  ${Math.round(dist(t.pos, world.ship.pos))}` : 'Target: none',
    nextHop: nextHopText(world, data),
  };
}

/**
 * Autopilot route banner ("Autopilot → Halcyon · fuel after: 3 jumps"), or null when the
 * autopilot is off. Fuel after is the jumps left once the planned trip is done: unchanged for a
 * planet, one less for the jump point (never below zero).
 */
export function routeBannerText(world: WorldState, data: GameData): string | null {
  const a = world.assist;
  if (a.kind !== 'autopilot') return null;
  const jumps = fuelJumps(world, data);
  let name: string;
  let after: number;
  if (a.dest.type === 'planet') {
    name = data.planets[a.dest.id]?.name ?? a.dest.id;
    after = jumps;
  } else {
    const to = jumpDestination(world, data);
    name = to ? (data.systems[to]?.name ?? to) : 'jump point';
    after = Math.max(0, jumps - 1);
  }
  return `Autopilot → ${name} · fuel after: ${after} ${after === 1 ? 'jump' : 'jumps'}`;
}
