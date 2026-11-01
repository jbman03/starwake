import { describe, expect, it } from 'vitest';
import { testData } from '../data/testData';
import { escortNpc, escortSlot, SLOT_SPREAD } from './escortNpcs';
import { escortMaxArmor } from './escorts';
import { shipStats } from './shipStats';
import { inFlight, isTargetable } from './traffic';
import type { Escort, ShipState } from './types';
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
