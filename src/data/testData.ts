import commodities from '../../data/commodities.json';
import config from '../../data/config.json';
import events from '../../data/events.json';
import governments from '../../data/governments.json';
import missionTypes from '../../data/missionTypes.json';
import outfits from '../../data/outfits.json';
import planets from '../../data/planets.json';
import ships from '../../data/ships.json';
import systems from '../../data/systems.json';
import { parseGameData } from './load';
import type { GameData } from './schemas';

let cached: GameData | null = null;

/** The shipped game data, parsed once and shared. For tests; treat it as read-only. */
export function testData(): GameData {
  cached ??= parseGameData({ ships, systems, planets, config, governments, commodities, events, missionTypes, outfits });
  return cached;
}

/** The shipped data with every port in the given systems removed (every port sells fuel, so this is how tests strand a ship). */
export function withoutPorts(data: GameData, ...systemIds: string[]): GameData {
  return {
    ...data,
    planets: Object.fromEntries(Object.entries(data.planets).filter(([, p]) => !systemIds.includes(p.systemId))),
  };
}

/** The shipped data with only the named ports left, to push a tow several hops. */
export function onlyPorts(data: GameData, ...planetIds: string[]): GameData {
  return { ...data, planets: Object.fromEntries(Object.entries(data.planets).filter(([id]) => planetIds.includes(id))) };
}
