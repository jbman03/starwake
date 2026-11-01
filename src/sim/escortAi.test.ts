import { describe, expect, it } from 'vitest';
import { testData } from '../data/testData';
import { fullHull, PLAYER_ID, type Combatant } from './combat';
import { escortAi, escortTargetId, STATION_RADIUS, type EscortView } from './escortAi';
import { ESCORT_ORDERS } from './escorts';
import { wrap } from './flight';
import type { EscortOrder } from './types';
import { angleOf, sub, type Vec2 } from './vec';

const data = testData();
const ENGAGE = data.combat.ai.patrol.engageRange;
const GUN = { 'light-blaster': 1 };
const comb = (id: string, government: string, x: number, y: number, heading = 0, outfits: Record<string, number> = {}): Combatant => ({
  id, government, radius: 12, outfits, hull: fullHull(70, 40),
  ship: { pos: { x, y }, vel: { x: 0, y: 0 }, heading, fuel: 0 },
});
const player = comb(PLAYER_ID, '', 0, 0);
const SLOT: Vec2 = { x: -90, y: 0 };
const view = (me: Combatant, over: Partial<EscortView> = {}): EscortView => ({
  me, player, slot: SLOT, order: 'follow', playerTargetId: null, attackers: new Set(), threats: new Set(), maxSpeed: 420, fireRange: 450, ...over,
});
const escort = (x = -90, y = 0, heading = 0) => comb('esc-1', '', x, y, heading, GUN);

describe('escortAi formation', () => {
  it('under follow, far from its slot, it flies toward the slot', () => {
    const me = escort(-900, 400);
    const d = escortAi(view(me), [player], data);
    expect(d.station).toBe(false);
    expect(d.targetId).toBeNull();
    expect(d.fire).toBe(false);
    const want = angleOf(sub(SLOT, me.ship.pos));
    expect(Math.abs(wrap(d.input.targetHeading! - want))).toBeLessThan(0.05);
    // Nose already on the slot: it burns toward it.
    const aligned = escortAi(view(escort(-900, 400, want)), [player], data);
    expect(aligned.input.thrust).toBe(true);
  });
  it('inside STATION_RADIUS of its slot it is on station', () => {
    const d = escortAi(view(escort(SLOT.x + STATION_RADIUS - 1, 0)), [player], data);
    expect(d.station).toBe(true);
    expect(d.input.thrust).toBe(false);
    expect(escortAi(view(escort(SLOT.x + STATION_RADIUS + 5, 0)), [player], data).station).toBe(false);
  });
});

describe('escortTargetId by order', () => {
  const me = escort();
  const attacker = comb('r1', 'raiders', 400, 0, Math.PI, GUN);
  const hostileRaider = comb('r2', 'raiders', 300, 100, 0, GUN);
  const peaceful = comb('r3', 'raiders', 200, 0);
  const trader = comb('t1', 'concord', 150, 0);

  it('follow targets an attacker in engageRange and a hostile raider, not a peaceful or demanding one, nor an untouched trader', () => {
    expect(escortTargetId(view(me, { attackers: new Set(['r1']) }), [player, attacker], data)).toBe('r1');
    expect(escortTargetId(view(me, { attackers: new Set(['r1']) }), [player, comb('r1', 'raiders', ENGAGE + 200, 0)], data)).toBeNull();
    expect(escortTargetId(view(me, { threats: new Set(['r2']) }), [player, hostileRaider], data)).toBe('r2');
    // A peaceful or demanding raider is not in `threats`, and a trader nobody fired on is left alone.
    expect(escortTargetId(view(me), [player, peaceful, trader], data)).toBeNull();
    // An attacker that is a trader is fair game.
    expect(escortTargetId(view(me, { attackers: new Set(['t1']) }), [player, trader], data)).toBe('t1');
  });
  it('attack takes the player\'s targeted trader first, even beyond engageRange', () => {
    const far = comb('t9', 'concord', ENGAGE + 500, 0);
    const v = view(me, { order: 'attack', playerTargetId: 't9', threats: new Set(['r2']) });
    expect(escortTargetId(v, [player, hostileRaider, far], data)).toBe('t9');
    // With no ship targeted it falls back to follow.
    expect(escortTargetId({ ...v, playerTargetId: null }, [player, hostileRaider, far], data)).toBe('r2');
    const d = escortAi(v, [player, hostileRaider, far], data);
    expect(d.mode).toBe('attack');
    expect(d.targetId).toBe('t9');
  });
  it('defend ignores a hostile raider that has not fired, and engages it once it is an attacker', () => {
    const v = view(me, { order: 'defend', threats: new Set(['r2']) });
    expect(escortTargetId(v, [player, hostileRaider], data)).toBeNull();
    expect(escortTargetId({ ...v, attackers: new Set(['r2']) }, [player, hostileRaider], data)).toBe('r2');
  });
  it('hold never thrusts, and fires only at an attacker within fireRange', () => {
    const hold = (m: Combatant, others: Combatant[], over: Partial<EscortView> = {}) => escortAi(view(m, { order: 'hold', ...over }), others, data);
    // Far from its slot and nothing near: it stays put.
    const idle = hold(escort(-900, 400), [player]);
    expect(idle.input.thrust).toBe(false);
    expect(idle.station).toBe(false);
    // A hostile raider that has not fired is ignored.
    expect(hold(me, [player, hostileRaider], { threats: new Set(['r2']) }).targetId).toBeNull();
    // An attacker beyond fireRange is ignored; inside it, the escort turns and fires without thrusting.
    expect(hold(me, [player, comb('r1', 'raiders', 700, 0)], { attackers: new Set(['r1']) }).targetId).toBeNull();
    const facing = comb('esc-1', '', -90, 0, 0, GUN);
    const d = hold(facing, [player, comb('r1', 'raiders', 200, 0)], { attackers: new Set(['r1']) });
    expect(d.targetId).toBe('r1');
    expect(d.input.thrust).toBe(false);
    expect(d.fire).toBe(true);
  });
  it('no order ever targets a player-side id', () => {
    const mate = comb('esc-2', '', 100, 0, 0, GUN);
    const ids = new Set([PLAYER_ID, 'esc-2']);
    for (const order of ESCORT_ORDERS as readonly EscortOrder[]) {
      const v = view(me, { order, playerTargetId: 'esc-2', attackers: ids, threats: ids });
      expect(escortTargetId(v, [player, mate], data)).toBeNull();
      expect(escortAi(v, [player, mate], data).targetId).toBeNull();
    }
  });
});
