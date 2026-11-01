import { describe, expect, it } from 'vitest';
import { testData } from '../data/testData';
import { escortNpc, escortsJump, escortSlot, presentEscorts, SLOT_SPREAD, syncEscorts, withEscorts, withoutEscorts } from './escortNpcs';
import { escortMaxArmor } from './escorts';
import { shipStats } from './shipStats';
import { inFlight, isTargetable, type Traffic } from './traffic';
import type { Escort, ShipState, WorldState } from './types';
import { newWorld } from './world';
import { angleOf, dist, sub } from './vec';
import { wrap } from './flight';

const data = testData();
const FOLLOW = data.escorts.followDistance;
const esc = (over: Partial<Escort> = {}): Escort => ({
  id: 'esc-1', name: 'Ansel Vorne', shipId: 'courier', outfits: { 'light-blaster': 1 }, armor: 20, fuel: 2, hired: true, wage: 9, ...over,
});

describe('escortSlot', () => {
  const player: ShipState = { pos: { x: 100, y: -50 }, vel: { x: 0, y: 0 }, heading: Math.PI / 3, fuel: 0 };
  const behind = wrap(player.heading + Math.PI);
  const bearing = (p: { x: number; y: number }) => wrap(angleOf(sub(p, player.pos)) - behind);

  it('one escort sits followDistance straight behind the heading', () => {
    const s = escortSlot(player, 0, 1, FOLLOW);
    expect(dist(s, player.pos)).toBeCloseTo(FOLLOW, 6);
    expect(bearing(s)).toBeCloseTo(0, 6);
  });
  it('two and three escorts spread SLOT_SPREAD apart on the arc behind', () => {
    for (const count of [2, 3]) {
      const slots = Array.from({ length: count }, (_, i) => escortSlot(player, i, count, FOLLOW));
      for (const s of slots) expect(dist(s, player.pos)).toBeCloseTo(FOLLOW, 6);
      const angles = slots.map(bearing);
      for (let i = 1; i < count; i++) expect(angles[i] - angles[i - 1]).toBeCloseTo(SLOT_SPREAD, 6);
      // Centred on the line straight behind.
      expect(angles[0] + angles[count - 1]).toBeCloseTo(0, 6);
    }
  });
});

describe('escortNpc', () => {
  const at = { pos: { x: 10, y: 20 }, heading: 1 };
  it('spawns an escort-role ship with full shields and the list armor', () => {
    const n = escortNpc(esc(), data, at);
    const st = shipStats('courier', { 'light-blaster': 1 }, data);
    expect(n).toMatchObject({ id: 'esc-1', name: 'Ansel Vorne', shipId: 'courier', role: 'escort', government: '', phase: 'fly', engaged: true });
    expect(n.hull).toMatchObject({ shields: st.shields, maxShields: st.shields, armor: 20, maxArmor: escortMaxArmor(data, esc()), disabled: false });
    expect(n.outfits).toEqual({ 'light-blaster': 1 });
    expect(n.ship).toMatchObject({ pos: { x: 10, y: 20 }, vel: { x: 0, y: 0 }, heading: 1 });
    expect(escortNpc(esc(), data, { ...at, vel: { x: 5, y: 0 } }).ship.vel).toEqual({ x: 5, y: 0 });
    expect(inFlight(n)).toBe(true);
    expect(isTargetable(n)).toBe(false);
  });
  it('spawns disabled below 10 % armor', () => {
    const max = escortMaxArmor(data, esc());
    expect(escortNpc(esc({ armor: max * 0.09 }), data, at).hull.disabled).toBe(true);
    expect(escortNpc(esc({ armor: max * 0.11 }), data, at).hull.disabled).toBe(false);
  });
});

const traffic = (npcs: Traffic['npcs'] = []): Traffic => ({ systemId: 'calder', npcs, spawnCount: 0, nextSpawnSec: 0, targetId: null });
const worldWith = (escorts: Escort[]): WorldState => ({ ...newWorld(data, 7), escorts });
const around = { pos: { x: 300, y: -200 }, heading: 0.5 };
const aroundShip: ShipState = { ...around, vel: { x: 0, y: 0 }, fuel: 0 };

describe('withEscorts', () => {
  it('spawns every escort that is not waiting on escortSlot, in list order', () => {
    const w = worldWith([esc({ id: 'esc-1' }), esc({ id: 'esc-2', waiting: true }), esc({ id: 'esc-3', name: 'Brass Heron' })]);
    const t = withEscorts(traffic(), w, data, around);
    const present = presentEscorts(t);
    expect(present.map((n) => n.id)).toEqual(['esc-1', 'esc-3']);
    present.forEach((n, i) => {
      const slot = escortSlot(aroundShip, i, 2, FOLLOW);
      expect(n.ship.pos.x).toBeCloseTo(slot.x, 6);
      expect(n.ship.pos.y).toBeCloseTo(slot.y, 6);
      expect(n.ship.heading).toBe(around.heading);
    });
  });
  it('run twice still gives one NPC per escort, and keeps the other traffic', () => {
    const w = worldWith([esc({ id: 'esc-1' }), esc({ id: 'esc-2' })]);
    const other = { ...escortNpc(esc({ id: 'x' }), data, around), role: 'trader' as const, id: 'npc-1' };
    const t = withEscorts(withEscorts(traffic([other]), w, data, around), w, data, around);
    expect(t.npcs.map((n) => n.id).sort()).toEqual(['esc-1', 'esc-2', 'npc-1']);
    expect(withoutEscorts(t).npcs.map((n) => n.id)).toEqual(['npc-1']);
  });
});

describe('syncEscorts', () => {
  it('writes armor and spent ammo back, and leaves a waiting escort alone', () => {
    const outfits = { 'light-blaster': 1, 'rocket-rack': 1, rocket: 4 };
    const w = worldWith([esc({ id: 'esc-1', outfits }), esc({ id: 'esc-2', waiting: true, armor: 15 })]);
    const t = withEscorts(traffic(), w, data, around);
    const hurt: Traffic = { ...t, npcs: t.npcs.map((n) => ({ ...n, hull: { ...n.hull, armor: 7 }, outfits: { ...n.outfits, rocket: 1 } })) };
    // A stray NPC with the waiting escort's id must not touch it.
    hurt.npcs.push({ ...escortNpc(esc({ id: 'esc-2' }), data, around), hull: { ...hurt.npcs[0].hull, armor: 1 } });
    const s = syncEscorts(w, data, hurt);
    expect(s.escorts[0]).toMatchObject({ armor: 7, outfits: { ...outfits, rocket: 1 } });
    expect(s.escorts[1]).toEqual(w.escorts[1]);
  });
});

describe('escortsJump', () => {
  it('uses a jump of fuel, or waits when empty or disabled; a waiting escort stays waiting', () => {
    const max = escortMaxArmor(data, esc());
    const w = worldWith([
      esc({ id: 'esc-1', fuel: 2 }),
      esc({ id: 'esc-2', fuel: 0 }),
      esc({ id: 'esc-3', fuel: 2 }),
      esc({ id: 'esc-4', fuel: 2, waiting: true }),
    ]);
    const t = withEscorts(traffic(), w, data, around);
    const disabled = { ...t, npcs: t.npcs.map((n) => (n.id === 'esc-3' ? { ...n, hull: { ...n.hull, armor: max * 0.05, disabled: true } } : n)) };
    const j = escortsJump(w, data, disabled).escorts;
    expect(j[0]).toMatchObject({ fuel: 1 });
    expect(j[0].waiting).toBeUndefined();
    expect(j[1]).toMatchObject({ fuel: 0, waiting: true });
    expect(j[2]).toMatchObject({ fuel: 2, waiting: true, armor: max * 0.05 });
    expect(j[3]).toMatchObject({ fuel: 2, waiting: true });
  });
});
