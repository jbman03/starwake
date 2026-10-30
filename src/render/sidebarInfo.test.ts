import { describe, expect, it } from 'vitest';
import { testData } from '../data/testData';
import { worldStats } from '../sim/shipStats';
import type { WorldState } from '../sim/types';
import { fullHull } from '../sim/combat';
import { npcLabel, type Npc, type Traffic } from '../sim/traffic';
import { newWorld } from '../sim/world';
import { fitText, radarBlips, radarHeadingTip, RADAR_RANGE, sidebarInfo } from './sidebarInfo';

const data = testData();
const base = (): WorldState => newWorld(data);
const npcAt = (id: string, x: number, y: number, government = 'free-reach'): Npc => ({
  id,
  name: 'Brass Heron',
  shipId: 'meridian',
  government,
  errand: 'pass',
  ship: { pos: { x, y }, vel: { x: 0, y: 0 }, heading: 0, fuel: 100 },
  portId: null,
  phase: 'fly',
  phaseT: 0,
  thrusting: false,
  role: 'trader',
  hull: fullHull(10, 10),
  outfits: {},
  aggro: [],
  engaged: false,
  peaceful: false,
  demand: false,
});
const trafficOf = (npcs: Npc[], targetId: string | null = null): Traffic => ({ systemId: base().systemId, npcs, spawnCount: 0, nextSpawnSec: 99, targetId });
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

  it('a targeted ship shows its label and distance', () => {
    const w = base();
    const npc = npcAt('a', w.ship.pos.x + 500, w.ship.pos.y);
    const i = sidebarInfo(w, data, trafficOf([npc], 'a'));
    expect(i.target).toBe(npcLabel(npc, data));
    expect(i.target).toContain('— Free Meridian (trader)');
    expect(i.targetDetail).toBe('Ship · 500');
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

describe('radarBlips with sites', () => {
  it('draws one blip per site, from a single position or a list', () => {
    const w = base();
    const sites = [{ x: 10, y: 20 }, { x: -30, y: 5 }];
    expect(radarBlips(w, data, 50, null, sites).filter((x) => x.kind === 'site')).toHaveLength(2);
    expect(radarBlips(w, data, 50, null, sites[0]).filter((x) => x.kind === 'site')).toHaveLength(1);
    expect(radarBlips(w, data, 50, null, []).filter((x) => x.kind === 'site')).toHaveLength(0);
  });
});

describe('radarBlips with traffic', () => {
  it('adds an NPC dot in the government colour and flags the targeted one', () => {
    const w = base();
    const a = npcAt('a', w.ship.pos.x + 250, w.ship.pos.y, 'concord');
    const b = npcAt('b', w.ship.pos.x, w.ship.pos.y - 250, 'free-reach');
    const blips = radarBlips(w, data, 50, trafficOf([a, b], 'b'));
    const npcs = blips.filter((x) => x.kind === 'npc');
    expect(npcs).toHaveLength(2);
    expect(npcs[0].color).toBe(data.governments.concord.color);
    expect(npcs[0].x).toBeCloseTo(250 * (50 / RADAR_RANGE));
    expect(npcs[1].color).toBe(data.governments['free-reach'].color);
    expect(npcs.map((x) => x.targeted)).toEqual([false, true]);
  });

  it('skips ships that are landing or gone', () => {
    const w = base();
    const landing = { ...npcAt('a', 0, 0), phase: 'land' as const };
    expect(radarBlips(w, data, 50, trafficOf([landing])).filter((x) => x.kind === 'npc')).toHaveLength(0);
  });
});

describe('radarHeadingTip', () => {
  it('points along the heading', () => {
    const e = radarHeadingTip(0, 9);
    expect(e.x).toBeCloseTo(9);
    expect(e.y).toBeCloseTo(0);
    const s = radarHeadingTip(Math.PI / 2, 9);
    expect(s.x).toBeCloseTo(0);
    expect(s.y).toBeCloseTo(9);
  });
});

describe('fitText', () => {
  it('keeps short text and ellipsises long text within the limit', () => {
    expect(fitText('Vesk', 10)).toBe('Vesk');
    expect(fitText('A very long system name', 10)).toBe('A very lo…');
  });
});

describe('sidebarInfo: site target', () => {
  it('shows the site as the target with its distance', () => {
    const w = at(base(), 0, 0);
    const info = sidebarInfo(w, data, null, { id: 'story', pos: { x: 640, y: 0 }, label: 'Dead lantern' });
    expect(info.target).toBe('Dead lantern — 640 px');
    expect(info.targetDetail).toBe('Site');
  });
});
