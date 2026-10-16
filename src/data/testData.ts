import commodities from '../../data/commodities.json';
import config from '../../data/config.json';
import events from '../../data/events.json';
import governments from '../../data/governments.json';
import missionTypes from '../../data/missionTypes.json';
import planets from '../../data/planets.json';
import ships from '../../data/ships.json';
import systems from '../../data/systems.json';
import { parseGameData } from './load';
import type { GameData } from './schemas';

let cached: GameData | null = null;

/** The shipped game data, parsed once and shared. For tests; treat it as read-only. */
export function testData(): GameData {
  cached ??= parseGameData({ ships, systems, planets, config, governments, commodities, events, missionTypes });
  return cached;
}
