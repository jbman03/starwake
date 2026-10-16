import { describe, expect, it } from 'vitest';
import { testData } from '../data/testData';
import type { WorldState } from '../sim/types';
import { newWorld } from '../sim/world';
import { hudInfo, routeBannerText } from './hudInfo';

const data = testData();
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
    const w: WorldState = {
      ...newWorld(data),
      route: ['vesk'],
      assist: { kind: 'autopilot', dest: { type: 'jumpPoint' }, autoLand: false },
    };
    expect(routeBannerText(w, data)).toBe('Autopilot → Vesk · fuel after: 2 jumps');
    expect(routeBannerText(withFuel(w, 200), data)).toBe('Autopilot → Vesk · fuel after: 1 jump');
    expect(routeBannerText(withFuel(w, 50), data)).toBe('Autopilot → Vesk · fuel after: 0 jumps');
    // No course plotted: the autopilot flies out radially to a plain jump point.
    expect(routeBannerText({ ...w, route: [] }, data)).toBe('Autopilot → jump point · fuel after: 2 jumps');
  });
});

describe('hudInfo', () => {
  it('uses singular fuel text for one jump', () => {
    expect(hudInfo(withFuel(newWorld(data), 100), data).fuel).toBe('Fuel: 1 jump');
    expect(hudInfo(newWorld(data), data).fuel).toBe('Fuel: 3 jumps');
  });
});
