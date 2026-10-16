import { describe, expect, it } from 'vitest';
import config from '../../data/config.json';
import governments from '../../data/governments.json';
import commodities from '../../data/commodities.json';
import events from '../../data/events.json';
import missionTypes from '../../data/missionTypes.json';
import planets from '../../data/planets.json';
import ships from '../../data/ships.json';
import systems from '../../data/systems.json';
import { parseGameData } from '../data/load';
import type { WorldState } from '../sim/types';
import { newWorld } from '../sim/world';
import { hudInfo, routeBannerText } from './hudInfo';

const data = parseGameData({ ships, systems, planets, config, governments, commodities, events, missionTypes });
const withFuel = (w: WorldState, fuel: number): WorldState => ({ ...w, ship: { ...w.ship, fuel } });

describe('routeBannerText', () => {
  it('is null unless the autopilot is on', () => {
    const w = newWorld(data);
    expect(routeBannerText(w, data)).toBeNull();
    expect(routeBannerText({ ...w, assist: { kind: 'autoStop' } }, data)).toBeNull();
  });

  it('names the planet and keeps the current fuel', () => {
    const w: WorldState = { ...newWorld(data), assist: { kind: 'autopilot', dest: { type: 'planet', id: 'merrow' }, autoLand: true } };
    expect(routeBannerText(w, data)).toBe('Autopilot → Merrow · fuel after: 3 jumps');
    expect(routeBannerText(withFuel(w, 100), data)).toBe('Autopilot → Merrow · fuel after: 1 jump');
  });

  it('names the destination system for the jump point and counts the jump', () => {
    const w: WorldState = { ...newWorld(data), assist: { kind: 'autopilot', dest: { type: 'jumpPoint' }, autoLand: false } };
    expect(routeBannerText(w, data)).toBe('Autopilot → Vesk · fuel after: 2 jumps');
    expect(routeBannerText(withFuel(w, 200), data)).toBe('Autopilot → Vesk · fuel after: 1 jump');
    expect(routeBannerText(withFuel(w, 50), data)).toBe('Autopilot → Vesk · fuel after: 0 jumps');
  });
});

describe('hudInfo', () => {
  it('uses singular fuel text for one jump', () => {
    expect(hudInfo(withFuel(newWorld(data), 100), data).fuel).toBe('Fuel: 1 jump');
    expect(hudInfo(newWorld(data), data).fuel).toBe('Fuel: 3 jumps');
  });
});
