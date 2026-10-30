import { describe, expect, it } from 'vitest';
import { testData } from '../data/testData';
import type { WorldState } from '../sim/types';
import { newWorld } from '../sim/world';
import { newBattle } from '../sim/battle';
import { hudInfo, objectiveText, routeBannerText, secondaryShort, siteTargetText } from './hudInfo';

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

describe('hudInfo nextHop', () => {
  it('is null with no course and names the next hop with the jumps left on a course', () => {
    const w = newWorld(data);
    expect(hudInfo(w, data).nextHop).toBeNull();
    expect(hudInfo({ ...w, route: ['vesk', 'lastlight'] }, data).nextHop).toBe('Course: Vesk (2 jumps)');
    expect(hudInfo({ ...w, route: ['tessaly'] }, data).nextHop).toBe('Course: Tessaly (1 jump)');
  });
});

describe('hudInfo credits and cargo', () => {
  it('shows credits with a thousands separator and cargo free over hold size', () => {
    const w = newWorld(data);
    const info = hudInfo({ ...w, credits: 9290 }, data);
    expect(info.credits).toBe('Credits: 9,290 cr');
    expect(info.cargo).toBe(`Cargo: 20/${data.ships[w.shipId].cargo} t`);
    expect(hudInfo({ ...w, credits: -400, cargo: { ...w.cargo, [Object.keys(data.commodities)[0]]: 10 } }, data).cargo).toBe('Cargo: 10/20 t');
    expect(hudInfo({ ...w, credits: -400 }, data).credits).toBe('Credits: -400 cr');
  });
});

describe('site targets and the objective line', () => {
  const site = { id: 'story', pos: { x: 640, y: 0 }, label: 'Dead lantern' };
  const w = { ...newWorld(data), ship: { ...newWorld(data).ship, pos: { x: 0, y: 0 } } };

  it('the target line names the site with its distance rounded to 10', () => {
    expect(siteTargetText(site, { x: 3, y: 0 })).toBe('Dead lantern — 640 px');
    expect(siteTargetText(site, { x: 0, y: 0 })).toBe('Dead lantern — 640 px');
    expect(siteTargetText(site, { x: -5, y: 0 })).toBe('Dead lantern — 650 px');
    expect(hudInfo(w, data, null, site).target).toBe('Target: Dead lantern — 640 px');
  });

  it('objective text for a scan, a search and a hidden find site', () => {
    expect(objectiveText({ kind: 'scan', label: 'Dead lantern', systemName: 'Skerry', distance: 640 })).toBe(
      'Objective: scan the Dead lantern — out in space, 640 px',
    );
    expect(objectiveText({ kind: 'find', label: 'Cache', systemName: 'Calder', distance: 380 })).toBe(
      'Objective: search the Cache — out in space, 380 px',
    );
    expect(objectiveText({ kind: 'find', label: 'Cache', systemName: 'Calder', distance: null })).toBe('Objective: search Calder for the Cache');
    expect(objectiveText({ kind: 'scan', label: 'Dead lantern', systemName: 'Skerry', distance: 20, reachable: true })).toBe(
      'Objective: scan the Dead lantern — press {interact} to scan',
    );
  });

  it('phone wording is short enough for two rail lines', () => {
    const o = { label: 'Dead lantern', systemName: 'Skerry', distance: 640 };
    expect(objectiveText({ kind: 'scan', ...o }, true)).toBe('Scan Dead lantern · 640 px');
    expect(objectiveText({ kind: 'scan', ...o, reachable: true }, true)).toBe('Tap Scan');
    expect(objectiveText({ kind: 'find', ...o, reachable: true }, true)).toBe('Tap Search');
    expect(objectiveText({ kind: 'find', ...o, distance: null }, true)).toBe('Search Skerry for the Dead lantern');
  });
});

describe('routeBannerText: site', () => {
  it('names the site', () => {
    const w: WorldState = { ...newWorld(data), assist: { kind: 'autopilot', dest: { type: 'site', pos: { x: 1, y: 2 }, label: 'Dead lantern' }, autoLand: false } };
    expect(routeBannerText(w, data)).toBe('Autopilot → Dead lantern');
  });
});

describe('hudInfo: hull', () => {
  it('hudInfo hull fractions', () => {
    const w = newWorld(data);
    const b = newBattle(w, data);
    expect(hudInfo(w, data, null, null, b).hull).toEqual({ shields: 1, armor: 1 });
    const hit = { ...b, player: { ...b.player, shields: 0, armor: b.player.maxArmor * 0.3 } };
    const h = hudInfo(w, data, null, null, hit).hull;
    expect(h.shields).toBe(0);
    expect(h.armor).toBeCloseTo(0.3, 6);
  });

  it('names the selected launcher short with its ammo, or a dash with none', () => {
    const w: WorldState = { ...newWorld(data), outfits: { ...newWorld(data).outfits, 'seeker-launcher': 1, seeker: 6 } };
    expect(secondaryShort(w, data, newBattle(w, data).secondary)).toBe('Seeker 6');
    expect(secondaryShort(newWorld(data), data, null)).toBe('—');
  });
});
