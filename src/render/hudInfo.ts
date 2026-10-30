/** HUD text and colors, free of Phaser so the HTML touch HUD (src/ui/rails.ts) can share it. */
import type { GameData } from '../data/schemas';
import { cargoFree } from '../sim/cargo';
import { fuelText, jumpsOf } from '../sim/fuel';
import { objectiveText, roundDistance, siteTargetText } from '../sim/siteText';
import { jumpDestination } from '../sim/rules';
import type { Battle } from '../sim/battle';
import { worldStats } from '../sim/shipStats';
import { hullBars } from './combatFx';
import { npcLabel, targetedNpc, type Traffic } from '../sim/traffic';
import type { SiteTarget, WorldState } from '../sim/types';
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
  /** The player's shields and armor as 0–1 fractions (full with no fight). */
  hull: { shields: number; armor: number };
}

/** The player's hull bars: from the fight when there is one, else full (no shield bar without shields). */
export function playerHull(world: WorldState, data: GameData, battle: Battle | null): { shields: number; armor: number } {
  if (battle) return hullBars(battle.player);
  return { shields: worldStats(world, data).shields > 0 ? 1 : 0, armor: 1 };
}

/** The selected launcher's ammo: its name and how many are aboard, or null with none selected. */
export function secondaryAmmo(world: WorldState, data: GameData, secondary: string | null): { name: string; count: number } | null {
  const l = secondary ? data.outfits[secondary] : undefined;
  if (!l || l.category !== 'launcher') return null;
  const ammo = data.outfits[l.effect.ammo];
  return { name: ammo?.name ?? l.name, count: world.outfits[l.effect.ammo] ?? 0 };
}

/** The phone label under MSL: the ammo's first word and count ("Seeker 6"), or a dash with no launcher. */
export function secondaryShort(world: WorldState, data: GameData, secondary: string | null): string {
  const a = secondaryAmmo(world, data, secondary);
  return a ? `${a.name.split(' ')[0]} ${a.count}` : '—';
}

/** HUD line for a plotted course: the next hop and the jumps left to its end, or null. */
export function nextHopText(world: WorldState, data: GameData): string | null {
  const next = world.route[0];
  if (next === undefined) return null;
  const n = world.route.length;
  return `Course: ${data.systems[next]?.name ?? next} (${n} ${n === 1 ? 'jump' : 'jumps'})`;
}

export { objectiveText, roundDistance, siteTargetText };

/** HUD text shared by the desktop panel and the touch-mode rail HUD. A targeted site replaces ship and planet targets. */
export function hudInfo(world: WorldState, data: GameData, traffic: Traffic | null = null, site: SiteTarget | null = null, battle: Battle | null = null): HudInfo {
  const jumps = fuelJumps(world, data);
  const t = world.targetPlanetId ? data.planets[world.targetPlanetId] : undefined;
  const ship = targetedNpc(traffic);
  return {
    system: data.systems[world.systemId]?.name ?? world.systemId,
    fuel: fuelText(jumps),
    fuelColor: fuelColor(jumps),
    credits: `Credits: ${Math.round(world.credits).toLocaleString('en-US')} cr`,
    cargo: `Cargo: ${cargoFree(world, data)}/${worldStats(world, data).cargo} t`,
    target: site
      ? `Target: ${siteTargetText(site, world.ship.pos)}`
      : ship
      ? `Target: ${npcLabel(ship, data)}  ${Math.round(dist(ship.ship.pos, world.ship.pos))}`
      : t && t.systemId === world.systemId ? `Target: ${t.name}  ${Math.round(dist(t.pos, world.ship.pos))}` : 'Target: none',
    nextHop: nextHopText(world, data),
    hull: playerHull(world, data, battle),
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
  if (a.dest.type === 'site') return `Autopilot → ${a.dest.label}`;
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
