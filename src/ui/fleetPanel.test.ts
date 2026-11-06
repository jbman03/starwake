import { describe, expect, it } from 'vitest';
import { testData } from '../data/testData';
import { escortNpc } from '../sim/escortNpcs';
import type { Traffic } from '../sim/traffic';
import type { Escort, WorldState } from '../sim/types';
import { newWorld } from '../sim/world';
import { fleetRows } from './fleetPanel';

const data = testData();
const esc = (over: Partial<Escort>): Escort => ({ id: 'esc-1', name: 'Ansel Vorne', shipId: 'courier', outfits: {}, armor: 40, fuel: 2, hired: true, wage: 9, ...over });

describe('fleetRows (playtest: escorts and Wasps vanished with no trace)', () => {
  it('says where every escort is and why', () => {
    const flying = esc({ id: 'esc-1' });
    const left = esc({ id: 'esc-2', name: 'Mirah Teague', waiting: true });
    const down = esc({ id: 'esc-3', name: 'Wren Halloway', shipId: 'kestrel', wingmanId: 'wren', takedowns: 3, downUntilDay: 9 });
    const w: WorldState = { ...newWorld(data, 1), escorts: [flying, left, down] };
    const npc = escortNpc(flying, data, { pos: { x: 0, y: 0 }, heading: 0 });
    const t: Traffic = { systemId: w.systemId, npcs: [{ ...npc, hull: { ...npc.hull, armor: npc.hull.maxArmor / 2 } }], spawnCount: 0, nextSpawnSec: 0, targetId: null };
    const v = fleetRows(w, data, t);
    expect(v.rows.map((r) => r.status)).toEqual([
      'Flying with you · armor 50%',
      'Left behind: rejoins at your next landing',
      expect.stringMatching(/^Ejected: back from .* at a landing · Seasoned wingman$/),
    ]);
    expect(v.fighters).toBeNull();
    expect(v.order).toBe('Order: Follow');
  });

  it('counts fighters aboard and out for a carrier', () => {
    const w: WorldState = { ...newWorld(data, 1), shipId: 'bastion', outfits: { 'fighter-bay': 1, 'wasp-fighter': 3 } };
    expect(fleetRows(w, data, null).fighters).toBe('Fighters: 3 aboard, 0 out');
  });
});
