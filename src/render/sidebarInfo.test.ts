import { describe, expect, it } from 'vitest';
import { testData } from '../data/testData';
import { worldStats } from '../sim/shipStats';
import type { WorldState } from '../sim/types';
import { newWorld } from '../sim/world';
import { radarBlips, RADAR_RANGE, sidebarInfo } from './sidebarInfo';

const data = testData();
const base = (): WorldState => newWorld(data);
const at = (w: WorldState, x: number, y: number): WorldState => ({ ...w, ship: { ...w.ship, pos: { x, y } } });

describe('sidebarInfo', () => {
  it('nav says "No course" with an empty route', () => {
    expect(sidebarInfo({ ...base(), route: [] }, data).nav).toBe('No course');
  });

  it('nav names the next system and the jumps left', () => {
    expect(sidebarInfo({ ...base(), route: ['vesk', 'halcyon'] }, data).nav).toBe('Vesk · 2 jumps');
    expect(sidebarInfo({ ...base(), route: ['vesk'] }, data).nav).toBe('Vesk · 1 jump');
  });

  it('secondary is None', () => {
    expect(sidebarInfo(base(), data).secondary).toBe('None');
  });

  it('target is null without a target', () => {
    const i = sidebarInfo({ ...base(), targetPlanetId: null }, data);
    expect(i.target).toBeNull();
    expect(i.targetDetail).toBeNull();
  });

  it('target shows name and kind with a rounded distance', () => {
    const p = Object.values(data.planets).find((q) => q.systemId === base().systemId)!;
    const w = at({ ...base(), targetPlanetId: p.id }, p.pos.x - 1234.4, p.pos.y);
    const i = sidebarInfo(w, data);
    expect(i.target).toBe(p.name);
    expect(i.targetDetail).toBe(`${p.kind === 'station' ? 'Station' : 'Planet'} · 1,234`);
  });

  it('shields and armor equal the ship maxima', () => {
    const w = base();
    const i = sidebarInfo(w, data);
    expect(i.shields).toBe(worldStats(w, data).shields);
    expect(i.armor).toBe(worldStats(w, data).armor);
  });
});

describe('radarBlips', () => {
  it('puts the star at the centre, offset from the ship', () => {
    const k = 50 / RADAR_RANGE;
    const blips = radarBlips(at({ ...base(), targetPlanetId: null }, 100, -200), data, 50);
    const star = blips.find((b) => b.kind === 'star')!;
    expect(star.x).toBeCloseTo(-100 * k);
    expect(star.y).toBeCloseTo(200 * k);
  });

  it('clamps a far planet to the edge and tags the target', () => {
    const w = base();
    const p = Object.values(data.planets).find((q) => q.systemId === w.systemId)!;
    const far = at({ ...w, targetPlanetId: p.id }, p.pos.x + 100000, p.pos.y);
    const blips = radarBlips(far, data, 50);
    const t = blips.find((b) => b.kind === 'target')!;
    expect(Math.hypot(t.x, t.y)).toBeCloseTo(50);
    expect(blips.filter((b) => b.kind === 'planet').length).toBe(
      Object.values(data.planets).filter((q) => q.systemId === w.systemId).length - 1,
    );
    for (const b of blips) expect(Math.hypot(b.x, b.y)).toBeLessThanOrEqual(50 + 1e-9);
  });
});
