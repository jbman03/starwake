import { describe, expect, it } from 'vitest';
import { testData } from '../data/testData';
import type { GameData } from '../data/schemas';
import { HIDDEN_LANE_FLAG, lanesOf } from './galaxy';
import { npcLoadout } from './weapons';
import { shipStats } from './shipStats';
import { addStoryNpc, cycleTarget, npcLabel, npcLanes, seedTraffic, stepTraffic, trafficLevel, isTargetable, raiderChance, patrolChance, addBountyNpc, type Traffic, type TrafficOpts } from './traffic';
import { newWorld } from './world';
import type { WorldState } from './types';

const data = testData();
const DT = 0.1;
const o = (maxNpcs = 8, extra: Partial<TrafficOpts> = {}): TrafficOpts => ({ maxNpcs, guideActive: false, startSystem: 'calder', ...extra });

const worldIn = (systemId: string, seed = 7, day = 0): WorldState => ({ ...newWorld(data, seed), systemId, day });

function run(w: WorldState, d: GameData, seconds: number, max = 8, onStep?: (t: Traffic, time: number) => void) {
  let t = seedTraffic(w, d, o(max));
  const events: string[] = [];
  for (let time = 0; time < seconds; time += DT) {
    const r = stepTraffic(t, w, d, DT, o(max));
    t = r.traffic;
    for (const e of r.events) events.push(e.type);
    onStep?.(t, time);
  }
  return { t, events };
}

const hubSystems = new Set(Object.values(data.planets).filter((p) => p.hub).map((p) => p.systemId));
const allSystems = Object.keys(data.systems);

describe('trafficLevel', () => {
  it('uses the government defaults', () => {
    const concord = allSystems.find(
      (s) =>
        data.systems[s].government === 'concord' &&
        !data.systems[s].traffic &&
        Object.values(data.planets).some((p) => p.systemId === s && p.techTier > 1),
    )!;
    expect(trafficLevel(data, concord)).toEqual([3, 5]);
  });

  it('gives low-tier systems [0, 2]', () => {
    const low = allSystems.find(
      (s) => !data.systems[s].traffic && Object.values(data.planets).filter((p) => p.systemId === s).every((p) => p.techTier <= 1),
    );
    if (low) expect(trafficLevel(data, low)).toEqual([0, 2]);
  });

  it('honours the data override (Hushwater)', () => {
    expect(trafficLevel(data, 'hushwater')).toEqual(data.systems.hushwater.traffic);
    const w = worldIn('hushwater');
    expect(seedTraffic(w, data, o(8)).npcs).toHaveLength(0);
    expect(run(w, data, 120).t.npcs).toHaveLength(0);
  });

  it('a [0, 1] override caps the system at one ship', () => {
    const d: GameData = { ...data, systems: { ...data.systems, calder: { ...data.systems.calder, traffic: [0, 1] } } };
    expect(trafficLevel(d, 'calder')).toEqual([0, 1]);
    run(worldIn('calder'), d, 300, 8, (t) => expect(t.npcs.length).toBeLessThanOrEqual(1));
  });
});

describe('traffic simulation', () => {
  it('is deterministic', () => {
    const w = worldIn('calder');
    expect(run(w, data, 90).t).toEqual(run(w, data, 90).t);
    expect(seedTraffic(w, data, o(8))).toEqual(seedTraffic(w, data, o(8)));
  });

  it('differs between seeds', () => {
    const a = run(worldIn('calder', 1), data, 60).t;
    const b = run(worldIn('calder', 2), data, 60).t;
    expect(a).not.toEqual(b);
  });

  it('keeps the count within the level and the cap', () => {
    for (const s of allSystems) {
      for (const max of [4, 8]) {
        const [, hi] = trafficLevel(data, s);
        const w = worldIn(s);
        expect(seedTraffic(w, data, o(max)).npcs.length).toBeLessThanOrEqual(Math.min(hi, max));
        run(w, data, 200, max, (t) => expect(t.npcs.length).toBeLessThanOrEqual(Math.min(hi, max)));
      }
    }
  });

  it('seeds at least the level minimum, mid-errand', () => {
    const s = allSystems.find((x) => trafficLevel(data, x)[0] >= 3)!;
    const t = seedTraffic(worldIn(s), data, o(8));
    expect(t.npcs.length).toBe(Math.min(trafficLevel(data, s)[0], 8));
    expect(t.npcs.every((n) => n.phase === 'fly')).toBe(true);
  });

  it('spawns new ships over time', () => {
    const s = allSystems.find((x) => trafficLevel(data, x)[0] >= 3)!;
    const { t, events } = run(worldIn(s), data, 120);
    expect(t.spawnCount).toBeGreaterThan(trafficLevel(data, s)[0]);
    expect(events.length).toBeGreaterThan(0);
  });

  it('never spawns a carrier outside a hub system, and does in a hub system', () => {
    let carriersInHubs = 0;
    for (const s of allSystems) {
      for (let day = 0; day < 6; day++) {
        const seen = new Set<string>();
        run(worldIn(s, 3, day), data, 150, 8, (t) => t.npcs.forEach((n) => seen.add(n.shipId)));
        if (hubSystems.has(s)) {
          if (seen.has('bastion')) carriersInHubs++;
        } else expect(seen.has('bastion')).toBe(false);
      }
    }
    expect(carriersInHubs).toBeGreaterThan(0);
  });

  it('never spawns a unique hull', () => {
    for (const s of allSystems) {
      for (let day = 0; day < 6; day++) {
        run(worldIn(s, 11, day), data, 150, 8, (t) => {
          for (const n of t.npcs) expect(data.ships[n.shipId].unique).toBeFalsy();
        });
      }
    }
  });

  it('only picks hulls the best port tier allows', () => {
    for (const s of allSystems) {
      const best = Math.max(1, ...Object.values(data.planets).filter((p) => p.systemId === s).map((p) => p.techTier));
      run(worldIn(s, 5), data, 150, 8, (t) => {
        for (const n of t.npcs) expect(data.ships[n.shipId].techTier).toBeLessThanOrEqual(best);
      });
    }
  });

  it('every errand finishes within 180 simulated seconds', () => {
    for (const s of allSystems) {
      const w = worldIn(s, 21);
      let t = seedTraffic(w, data, o(8));
      const born = new Map<string, number>(t.npcs.map((n) => [n.id, 0]));
      const ended = new Set<string>();
      for (let time = 0; time < 600; time += DT) {
        const r = stepTraffic(t, w, data, DT, o(8));
        t = r.traffic;
        const live = new Set(t.npcs.map((n) => n.id));
        for (const n of t.npcs) if (!born.has(n.id)) born.set(n.id, time);
        for (const [id, at] of born) {
          if (!live.has(id) && !ended.has(id)) {
            ended.add(id);
            expect(time - at).toBeLessThanOrEqual(180);
          }
        }
      }
      for (const [id, at] of born) if (live(t, id)) expect(600 - at).toBeLessThanOrEqual(180);
    }
  });

  it('arrivals land at a port and the events say so', () => {
    const s = allSystems.find((x) => trafficLevel(data, x)[0] >= 3)!;
    const { events } = run(worldIn(s), data, 400);
    expect(events).toContain('npcLanded');
    expect(events).toContain('npcJumpOut');
  });
});

const live = (t: Traffic, id: string) => t.npcs.some((n) => n.id === id);

describe('npcLabel', () => {
  it('names the ship, government and role', () => {
    const w = worldIn('calder');
    const npc = { ...seedTraffic(w, data, o(8)).npcs[0], shipId: 'mule', government: 'concord', name: 'Brass Heron' };
    expect(npcLabel(npc, data)).toBe('Brass Heron — Concord Mule (freighter)');
  });
});

describe('hidden systems', () => {
  it('NPC lanes include a hidden system only once its own flag is set', () => {
    const w = worldIn('oxbow');
    expect(npcLanes(w, data)).not.toContain('gloam');
    expect(npcLanes({ ...w, flags: [HIDDEN_LANE_FLAG] }, data)).not.toContain('gloam');
    const open = { ...w, flags: ['dimming-lane'] };
    expect(lanesOf(data, 'oxbow', open.flags)).toContain('gloam');
    expect(npcLanes(open, data)).toContain('gloam');
    expect(npcLanes(open, data).length).toBeGreaterThan(1);
    expect(npcLanes({ ...worldIn('skerry'), flags: [HIDDEN_LANE_FLAG] }, data)).toContain('hushwater');
  });
  it('Unlit Holdings systems run sparse traffic, [0, 2]', () => {
    for (const s of Object.values(data.systems).filter((x) => x.government === 'unlit')) expect(trafficLevel(data, s.id)).toEqual([0, 2]);
  });
});

describe('addStoryNpc', () => {
  const spec = { id: 'story-m1-0', name: 'Orrin Vale', shipId: 'courier', government: 'concord', holdPos: { x: 300, y: 200 } };
  const shipId = Object.keys(data.ships).find((id) => data.ships[id].role === 'courier') ?? Object.keys(data.ships)[0];

  it('adds a targetable named ship with the usual label', () => {
    const t = addStoryNpc(seedTraffic(worldIn('calder'), data, o(8)), { ...spec, shipId }, data);
    const n = t.npcs.find((x) => x.id === spec.id)!;
    expect(n.name).toBe('Orrin Vale');
    expect(isTargetable(n)).toBe(true);
    expect(npcLabel(n, data)).toMatch(/^Orrin Vale — Concord Swiftwing/);
  });

  it('flies to its hold position, waits there, and never lands or jumps', () => {
    const w = worldIn('calder');
    let t = addStoryNpc({ systemId: 'calder', npcs: [], spawnCount: 0, nextSpawnSec: 1e9, targetId: null }, { ...spec, shipId }, data);
    const events: string[] = [];
    for (let time = 0; time < 400; time += DT) {
      const r = stepTraffic(t, w, data, DT, o(8));
      t = r.traffic;
      for (const e of r.events) events.push(e.type);
    }
    const n = t.npcs.find((x) => x.id === spec.id)!;
    expect(n).toBeDefined();
    expect(n.phase).toBe('fly');
    expect(Math.hypot(n.ship.pos.x - 300, n.ship.pos.y - 200)).toBeLessThan(60);
    expect(events).toEqual([]);
  });

  it('does not count toward the wanted number of ordinary ships', () => {
    const w = worldIn('calder');
    let t = addStoryNpc({ systemId: 'calder', npcs: [], spawnCount: 0, nextSpawnSec: 0, targetId: null }, { ...spec, shipId }, data);
    t = stepTraffic(t, w, data, DT, o(8)).traffic;
    expect(t.npcs.length).toBeGreaterThan(1);
  });
});

describe('cycleTarget with sites', () => {
  const w0 = newWorld(data);
  const site = (id: string, x: number, y: number) => ({ id, pos: { x, y }, label: id });
  const near = site('story', 300, 0);
  const far = site('encounter', 900, 0);
  const t0 = (): Traffic => ({ ...seedTraffic(w0, data, o(8)), targetId: null });

  it('walks sites nearest first, then ships, then planets, then nothing', () => {
    const w = { ...w0, ship: { ...w0.ship, pos: { x: 0, y: 0 } }, targetPlanetId: null as string | null };
    let t = t0();
    const nShips = t.npcs.filter(isTargetable).length;
    const nPlanets = Object.values(data.planets).filter((p) => p.systemId === w0.systemId).length;
    const seen: string[] = [];
    let siteId: string | null = null;
    let world: WorldState = w;
    for (let i = 0; i < 40; i++) {
      const p = cycleTarget(world, data, t, [far, near], siteId);
      if (!p.siteId && !p.shipId && !p.planetId) break;
      siteId = p.siteId;
      t = { ...t, targetId: p.shipId };
      world = { ...world, targetPlanetId: p.planetId };
      seen.push(p.siteId ? `site:${p.siteId}` : p.shipId ? 'ship' : 'planet');
    }
    expect(seen).toEqual([
      'site:story',
      'site:encounter',
      ...Array<string>(nShips).fill('ship'),
      ...Array<string>(nPlanets).fill('planet'),
    ]);
  });

  it('with no target picks the nearest site first, and no sites behaves as before', () => {
    const w = { ...w0, ship: { ...w0.ship, pos: { x: 0, y: 0 } }, targetPlanetId: null };
    expect(cycleTarget(w, data, t0(), [far, near]).siteId).toBe('story');
    expect(cycleTarget(w, data, t0()).siteId).toBeNull();
  });

  it('after the last planet the cycle clears everything, including a site target', () => {
    const last = Object.values(data.planets).filter((p) => p.systemId === w0.systemId);
    const pos = w0.ship.pos;
    last.sort((a, b) => Math.hypot(a.pos.x - pos.x, a.pos.y - pos.y) - Math.hypot(b.pos.x - pos.x, b.pos.y - pos.y));
    const w = { ...w0, targetPlanetId: last[last.length - 1].id };
    expect(cycleTarget(w, data, { ...t0(), npcs: [] }, [near])).toEqual({ shipId: null, planetId: null, siteId: null });
  });
});

const sysOf = (gov: string) => allSystems.find((s) => data.systems[s].government === gov && s !== 'calder')!;
const fringeSys = allSystems.find(
  (s) => data.systems[s].government !== 'unlit' && Object.values(data.planets).filter((p) => p.systemId === s).every((p) => p.techTier <= 1),
);
const spawn = data.combat.spawn;

describe('raiderChance / patrolChance', () => {
  it('raider chance by system class', () => {
    expect(raiderChance(data, sysOf('concord'), o())).toBe(0.05);
    expect(raiderChance(data, sysOf('free-reach'), o())).toBe(0.2);
    expect(raiderChance(data, sysOf('unlit'), o())).toBe(0.4);
    const ind = sysOf('independent');
    expect(raiderChance(data, ind, o())).toBe(Object.values(data.planets).filter((p) => p.systemId === ind).every((p) => p.techTier <= 1) ? 0.4 : 0.3);
    if (fringeSys) expect(raiderChance(data, fringeSys, o())).toBe(Math.max(0.4, spawn.raiderChance[data.systems[fringeSys].government] ?? 0));
  });

  it('reads the data, not constants', () => {
    const d: GameData = { ...data, combat: { ...data.combat, spawn: { ...spawn, raiderChance: { ...spawn.raiderChance, unlit: 0.77 } } } };
    expect(raiderChance(d, sysOf('unlit'), o())).toBe(0.77);
  });

  it('no raiders while the guide runs or in the start system', () => {
    expect(raiderChance(data, sysOf('unlit'), o(8, { guideActive: true }))).toBe(0);
    expect(raiderChance(data, 'gloam', o(8, { startSystem: 'gloam' }))).toBe(0);
    expect(raiderChance(data, 'gloam', o(8, { guideActive: true, clearBoost: 'gloam' }))).toBe(0);
  });

  it('no raiders anywhere with the calm test option, even with a clear job', () => {
    expect(raiderChance(data, sysOf('unlit'), o(8, { noRaiders: true }))).toBe(0);
    if (fringeSys) expect(raiderChance(data, fringeSys, o(8, { noRaiders: true, clearBoost: fringeSys }))).toBe(0);
  });

  it('clear job raises the raider chance to 60%', () => {
    expect(raiderChance(data, sysOf('concord'), o(8, { clearBoost: sysOf('concord') }))).toBe(0.6);
    expect(raiderChance(data, sysOf('concord'), o(8, { clearBoost: 'elsewhere' }))).toBe(0.05);
  });

  it('patrols only in Concord and Free Reach space', () => {
    for (const s of allSystems) {
      const g = data.systems[s].government;
      expect(patrolChance(data, s)).toBe(g === 'concord' || g === 'free-reach' ? 0.15 : 0);
    }
  });
});

describe('roles, hulls and safe spawning', () => {
  const hostile = (t: Traffic) => t.npcs.filter((n) => n.role === 'raider' && !n.peaceful).length;

  it('NPCs spawn with full hull and their loadout', () => {
    for (const s of allSystems) {
      const { t } = run(worldIn(s, 3), data, 120);
      for (const n of t.npcs.filter((x) => !x.hold)) {
        const loadout = npcLoadout(data.ships[n.shipId]);
        expect(n.outfits).toEqual(loadout);
        const st = shipStats(n.shipId, loadout, data);
        expect(n.hull).toMatchObject({ shields: st.shields, armor: st.armor, maxShields: st.shields, maxArmor: st.armor, disabled: false });
        expect(n.engaged).toBe(false);
        expect(n.aggro).toEqual([]);
      }
    }
  });

  it('raiders fly the raiders flag from the pool, patrols the system flag in kestrel or warden', () => {
    const seen = { raider: 0, patrol: 0 };
    for (let seed = 1; seed < 40; seed++) {
      for (const s of [sysOf('unlit'), sysOf('concord'), sysOf('free-reach')]) {
        const { t } = run(worldIn(s, seed), data, 200);
        for (const n of t.npcs) {
          if (n.role === 'raider') {
            seen.raider++;
            expect(n.government).toBe('raiders');
            expect(Object.keys(spawn.raiderHulls)).toContain(n.shipId);
            expect(data.ships[n.shipId].techTier).toBeLessThanOrEqual(Math.max(1, ...Object.values(data.planets).filter((p) => p.systemId === s).map((p) => p.techTier)));
          } else if (n.role === 'patrol') {
            seen.patrol++;
            expect(n.government).toBe(data.systems[s].government);
            expect(spawn.patrolHulls).toContain(n.shipId);
          }
        }
      }
    }
    expect(seen.raider).toBeGreaterThan(0);
    expect(seen.patrol).toBeGreaterThan(0);
  });

  it('no raiders in the start system or during the guide', () => {
    for (let seed = 1; seed < 30; seed++) {
      expect(run(worldIn('calder', seed), data, 150).t.npcs.some((n) => n.role === 'raider')).toBe(false);
      let t = seedTraffic(worldIn(sysOf('unlit'), seed), data, o(8, { guideActive: true }));
      for (let i = 0; i < 1500; i++) t = stepTraffic(t, worldIn(sysOf('unlit'), seed), data, DT, o(8, { guideActive: true })).traffic;
      expect(t.npcs.some((n) => n.role === 'raider')).toBe(false);
    }
  });

  it('at most 3 hostile raiders', () => {
    const d: GameData = { ...data, combat: { ...data.combat, spawn: { ...spawn, raiderChance: { ...spawn.raiderChance, unlit: 1, fringe: 1 } } } };
    const sys = sysOf('unlit');
    const dd: GameData = { ...d, systems: { ...d.systems, [sys]: { ...d.systems[sys], traffic: [8, 8] } } };
    let peak = 0;
    for (let seed = 1; seed < 6; seed++)
      run(worldIn(sys, seed), dd, 300, 8, (t) => {
        peak = Math.max(peak, hostile(t));
        expect(hostile(t)).toBeLessThanOrEqual(3);
      });
    expect(peak).toBe(3);
  });

  it('same seed, same roles', () => {
    const w = worldIn(sysOf('unlit'), 9);
    const roles = () => run(w, data, 200).t.npcs.map((n) => [n.id, n.role, n.shipId]);
    expect(roles()).toEqual(roles());
  });

  it('a disabled NPC never despawns by errand', () => {
    const w = worldIn(sysOf('concord'), 4);
    let t = seedTraffic(w, data, o());
    const victim = t.npcs[0];
    t = { ...t, nextSpawnSec: 1e9, npcs: t.npcs.map((n) => (n.id === victim.id ? { ...n, hull: { ...n.hull, disabled: true } } : n)) };
    for (let time = 0; time < 200; time += DT) t = stepTraffic(t, w, data, DT, o()).traffic;
    const after = t.npcs.find((n) => n.id === victim.id)!;
    expect(after).toBeDefined();
    expect(after.phase).toBe('fly');
    expect(after.ship.pos).toEqual(victim.ship.pos);
  });

  it('an engaged NPC is not moved by traffic', () => {
    const w = worldIn(sysOf('concord'), 4);
    let t = seedTraffic(w, data, o());
    const victim = t.npcs[0];
    t = { ...t, nextSpawnSec: 1e9, npcs: t.npcs.map((n) => (n.id === victim.id ? { ...n, engaged: true } : n)) };
    for (let time = 0; time < 100; time += DT) t = stepTraffic(t, w, data, DT, o()).traffic;
    expect(t.npcs.find((n) => n.id === victim.id)!.ship).toEqual(victim.ship);
  });

  it('story ships are traders with full hulls and are never engaged', () => {
    const t = addStoryNpc({ systemId: 'calder', npcs: [], spawnCount: 0, nextSpawnSec: 1e9, targetId: null }, { id: 's', name: 'S', shipId: 'mule', government: 'concord', holdPos: { x: 0, y: 0 } }, data);
    const n = t.npcs[0];
    const st = shipStats('mule', npcLoadout(data.ships.mule), data);
    expect(n).toMatchObject({ role: 'trader', engaged: false, peaceful: false, demand: false });
    expect(n.hull).toMatchObject({ shields: st.shields, armor: st.armor });
    expect(n.outfits).toEqual(npcLoadout(data.ships.mule));
  });

  it('addBountyNpc adds a raider that never demands and is never peaceful', () => {
    const t = addBountyNpc({ systemId: 'calder', npcs: [], spawnCount: 0, nextSpawnSec: 1e9, targetId: null }, { id: 'b', name: 'B', shipId: 'kestrel', missionId: 'm1', pos: { x: 100, y: 100 } }, data);
    expect(t.npcs[0]).toMatchObject({ role: 'raider', government: 'raiders', peaceful: false, demand: false, missionId: 'm1' });
    expect(t.npcs[0].ship.pos).toEqual({ x: 100, y: 100 });
  });
});
