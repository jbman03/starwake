/** Sidebar HUD data, free of Phaser so it is unit-tested. */
import type { GameData } from '../data/schemas';
import { formatDate } from '../sim/calendar';
import { cargoFree } from '../sim/cargo';
import { jumpPoint, SYSTEM_CENTER } from '../sim/rules';
import { isTargetable, npcLabel, targetedNpc, type Traffic } from '../sim/traffic';
import { worldStats } from '../sim/shipStats';
import type { WorldState } from '../sim/types';
import { dist, type Vec2 } from '../sim/vec';
import { fuelJumps } from './hudInfo';

/** World distance from the radar's centre to its edge (same as the touch rail radar). */
export const RADAR_RANGE = 2500;

export interface SidebarInfo {
  shields: number;
  armor: number;
  /** Fuel as a 0..1 fraction of the tank. */
  fuelFrac: number;
  jumps: number;
  nav: string;
  secondary: string;
  target: string | null;
  targetDetail: string | null;
  /** "10/20 t" (free / hold size). */
  cargoFree: string;
  credits: string;
  date: string;
}

export function sidebarInfo(world: WorldState, data: GameData, traffic: Traffic | null = null): SidebarInfo {
  const stats = worldStats(world, data);
  const next = world.route[0];
  const n = world.route.length;
  const t = world.targetPlanetId ? data.planets[world.targetPlanetId] : undefined;
  const hasTarget = t !== undefined && t.systemId === world.systemId;
  const ship = targetedNpc(traffic);
  return {
    shields: stats.shields,
    armor: stats.armor,
    fuelFrac: stats.fuelCapacity > 0 ? Math.max(0, Math.min(1, world.ship.fuel / stats.fuelCapacity)) : 0,
    jumps: fuelJumps(world, data),
    nav: next === undefined ? 'No course' : `${data.systems[next]?.name ?? next} · ${n} ${n === 1 ? 'jump' : 'jumps'}`,
    secondary: 'None',
    target: ship ? npcLabel(ship, data) : hasTarget ? t.name : null,
    targetDetail: ship
      ? `Ship · ${Math.round(dist(ship.ship.pos, world.ship.pos)).toLocaleString('en-US')}`
      : hasTarget
        ? `${t.kind === 'station' ? 'Station' : 'Planet'} · ${Math.round(dist(t.pos, world.ship.pos)).toLocaleString('en-US')}`
        : null,
    cargoFree: `${cargoFree(world, data)}/${stats.cargo} t`,
    credits: `${Math.round(world.credits).toLocaleString('en-US')} cr`,
    date: formatDate(world.day, data.config),
  };
}

export interface RadarBlip {
  x: number;
  y: number;
  kind: 'star' | 'planet' | 'target' | 'jumpRing' | 'npc' | 'site';
  /** NPC dots: the government's colour (#rrggbb). */
  color?: string;
  /** NPC dots: this is the targeted ship. */
  targeted?: boolean;
}

/** Blips relative to the radar centre (the ship), north up, clamped to `radius`. */
export function radarBlips(world: WorldState, data: GameData, radius: number, traffic: Traffic | null = null, sites: Vec2 | readonly Vec2[] | null = null): RadarBlip[] {
  const k = radius / RADAR_RANGE;
  const ship = world.ship.pos;
  const place = (p: { x: number; y: number }, kind: RadarBlip['kind']): RadarBlip => {
    let x = (p.x - ship.x) * k;
    let y = (p.y - ship.y) * k;
    const d = Math.hypot(x, y);
    if (d > radius) {
      x *= radius / d;
      y *= radius / d;
    }
    return { x, y, kind };
  };
  const out: RadarBlip[] = [place(SYSTEM_CENTER, 'star')];
  for (const p of Object.values(data.planets)) {
    if (p.systemId !== world.systemId) continue;
    out.push(place(p.pos, p.id === world.targetPlanetId ? 'target' : 'planet'));
  }
  out.push(place(jumpPoint(world, data), 'jumpRing'));
  for (const n of traffic?.npcs ?? []) {
    if (!isTargetable(n)) continue;
    out.push({
      ...place(n.ship.pos, 'npc'),
      color: data.governments[n.government]?.color ?? '#9fb4cc',
      targeted: n.id === traffic?.targetId,
    });
  }
  for (const s of sites === null ? [] : 'x' in sites ? [sites] : sites) out.push(place(s, 'site'));
  return out;
}

/** Where the ship's nose points on the radar: `len` px from the centre along the heading (y down). */
export function radarHeadingTip(heading: number, len: number): { x: number; y: number } {
  return { x: Math.cos(heading) * len, y: Math.sin(heading) * len };
}

/** `text` cut to at most `max` characters, ending in an ellipsis when it was shortened. */
export function fitText(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, Math.max(0, max - 1))}…`;
}
