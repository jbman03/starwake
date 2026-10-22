import { describe, expect, it } from 'vitest';
import { testData } from '../data/testData';
import type { GameData } from '../data/schemas';
import { HIDDEN_LANE_FLAG, lanesOf } from './galaxy';
import { addStoryNpc, npcLabel, npcLanes, seedTraffic, stepTraffic, trafficLevel, isTargetable, type Traffic } from './traffic';
import { newWorld } from './world';
import type { WorldState } from './types';

const data = testData();
const DT = 0.1;

const worldIn = (systemId: string, seed = 7, day = 0): WorldState => ({ ...newWorld(data, seed), systemId, day });

function run(w: WorldState, d: GameData, seconds: number, max = 8, onStep?: (t: Traffic, time: number) => void) {
  let t = seedTraffic(w, d, max);
  const events: string[] = [];
  for (let time = 0; time < seconds; time += DT) {
    const r = stepTraffic(t, w, d, DT, max);
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
    expect(seedTraffic(w, data, 8).npcs).toHaveLength(0);
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
    expect(seedTraffic(w, data, 8)).toEqual(seedTraffic(w, data, 8));
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
        expect(seedTraffic(w, data, max).npcs.length).toBeLessThanOrEqual(Math.min(hi, max));
        run(w, data, 200, max, (t) => expect(t.npcs.length).toBeLessThanOrEqual(Math.min(hi, max)));
      }
    }
  });

  it('seeds at least the level minimum, mid-errand', () => {
    const s = allSystems.find((x) => trafficLevel(data, x)[0] >= 3)!;
    const t = seedTraffic(worldIn(s), data, 8);
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
      let t = seedTraffic(w, data, 8);
      const born = new Map<string, number>(t.npcs.map((n) => [n.id, 0]));
      const ended = new Set<string>();
      for (let time = 0; time < 600; time += DT) {
        const r = stepTraffic(t, w, data, DT, 8);
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
    const npc = { ...seedTraffic(w, data, 8).npcs[0], shipId: 'mule', government: 'concord', name: 'Brass Heron' };
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
    const t = addStoryNpc(seedTraffic(worldIn('calder'), data, 8), { ...spec, shipId });
    const n = t.npcs.find((x) => x.id === spec.id)!;
    expect(n.name).toBe('Orrin Vale');
    expect(isTargetable(n)).toBe(true);
    expect(npcLabel(n, data)).toMatch(/^Orrin Vale — Concord Swiftwing/);
  });

  it('flies to its hold position, waits there, and never lands or jumps', () => {
    const w = worldIn('calder');
    let t = addStoryNpc({ systemId: 'calder', npcs: [], spawnCount: 0, nextSpawnSec: 1e9, targetId: null }, { ...spec, shipId });
    const events: string[] = [];
    for (let time = 0; time < 400; time += DT) {
      const r = stepTraffic(t, w, data, DT, 8);
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
    let t = addStoryNpc({ systemId: 'calder', npcs: [], spawnCount: 0, nextSpawnSec: 0, targetId: null }, { ...spec, shipId });
    t = stepTraffic(t, w, data, DT, 8).traffic;
    expect(t.npcs.length).toBeGreaterThan(1);
  });
});
