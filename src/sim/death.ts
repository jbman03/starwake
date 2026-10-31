import type { GameData } from '../data/schemas';
import { revealOnArrival, hopDistance } from './galaxy';
import { jobMissions, STORY_TYPE } from './missions';
import { shipStats } from './shipStats';
import { standingOf } from './standing';
import { currentStep, returnToGiver } from './storyMissions';
import type { WorldState } from './types';
import { dist } from './vec';
import { departFrom } from './world';

export const POD_ID = 'escape-pod';

export function hasPod(world: WorldState): boolean {
  return (world.outfits[POD_ID] ?? 0) > 0;
}

/** The nearest port by lane hops (then map distance, then id) whose government isn't cool toward the pilot (Wanted or Hunted counts as cool); else the start planet. */
export function rescuePort(world: WorldState, data: GameData): string {
  const here = data.systems[world.systemId];
  let best: { id: string; hops: number; d: number } | null = null;
  for (const p of Object.values(data.planets)) {
    const sys = data.systems[p.systemId];
    if (!sys || standingOf(world, sys.government, data) === 'cool') continue;
    const hops = hopDistance(data, world.systemId, p.systemId, world.flags);
    if (!Number.isFinite(hops)) continue;
    const d = here ? dist(here.mapPos, sys.mapPos) : 0;
    if (!best || hops < best.hops || (hops === best.hops && (d < best.d || (d === best.d && p.id < best.id)))) best = { id: p.id, hops, d };
  }
  return best?.id ?? data.config.startPlanetId;
}

/** The ship is lost but the pod works: the pilot wakes docked at the rescue port in the starting ship, with the job and story cargo gone. */
export function podRescue(world: WorldState, data: GameData): { world: WorldState; planetId: string; messages: string[] } {
  const planetId = rescuePort(world, data);
  const planet = data.planets[planetId];
  const messages = [`Your escape pod reaches ${planet.name}.`];

  let w: WorldState = world;
  for (const a of world.story.active) {
    const kind = currentStep(w, data, a.id)?.kind;
    if (kind === 'deliver' || kind === 'ferry') {
      w = returnToGiver(w, data, a.id);
      messages.push(`${data.story[a.id].title}: the cargo or passengers are lost. ${data.story[a.id].giver.name} will talk to you again.`);
    }
  }
  const lost = jobMissions(w).filter((m) => m.tons > 0 || m.passengers > 0);
  for (const m of lost) messages.push(`Job lost: ${m.title}`);
  const missions = w.missions.filter((m) => m.typeId !== STORY_TYPE && !lost.includes(m));

  const { startShipId, startOutfits } = data.config;
  const outfits = { ...startOutfits };
  const map = revealOnArrival(w.known, w.seen, data, planet.systemId, w.flags);
  w = {
    ...w,
    shipId: startShipId,
    outfits,
    cargo: {},
    missions,
    shipName: '',
    known: map.known,
    seen: map.seen,
    targetPlanetId: planetId,
    route: [],
    ship: { ...w.ship, fuel: shipStats(startShipId, outfits, data).fuelCapacity },
  };
  return { world: { ...departFrom(w, data, planetId), targetPlanetId: planetId }, planetId, messages };
}
