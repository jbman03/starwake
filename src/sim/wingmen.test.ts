import { describe, expect, it } from 'vitest';
import { testData } from '../data/testData';
import type { BattleEvent } from './battle';
import { escortLosses, payWages, repairCost } from './escorts';
import { escortsJump, escortNpc, withEscorts } from './escortNpcs';
import type { Traffic } from './traffic';
import type { WorldState } from './types';
import { newWorld } from './world';
import { creditWingmen, damageMulOf, ejectWingmen, isDown, recruitWingman, returnWingmen, wingmanOffer, wingmanRank } from './wingmen';

const data = testData();
const wren = data.fleet.wingmen.pilots.find((w) => w.id === 'wren')!;
const juno = data.fleet.wingmen.pilots.find((w) => w.id === 'juno')!;
const base: WorldState = { ...newWorld(data, 3), credits: 100_000 };

function recruited(world: WorldState = base): WorldState {
  const r = recruitWingman(world, data, wren.homePort, wren.id);
  if ('error' in r) throw new Error(r.error);
  return r.world;
}

const emptyTraffic = (w: WorldState): Traffic => ({ systemId: w.systemId, npcs: [], spawnCount: 0, nextSpawnSec: 0, targetId: null });

describe('wingman offers', () => {
  it('a wingman waits at their home bar once the pilot has the kills', () => {
    expect(wingmanOffer(base, data, wren.homePort)?.id).toBe('wren');
    expect(wingmanOffer(base, data, juno.homePort)).toBeNull();
    expect(wingmanOffer({ ...base, stats: { ...base.stats, kills: juno.requiresKills } }, data, juno.homePort)?.id).toBe('juno');
    expect(wingmanOffer(base, data, 'halcyon')).toBeNull();
  });

  it('not while already in the group', () => {
    expect(wingmanOffer(recruited(), data, wren.homePort)).toBeNull();
  });
});

describe('recruiting', () => {
  it('pays the fee and joins with the hull default fit, full armor and fuel, no takedowns', () => {
    const r = recruitWingman(base, data, wren.homePort, wren.id);
    if ('error' in r) throw new Error(r.error);
    expect(r.world.credits).toBe(base.credits - wren.fee);
    expect(r.escort).toMatchObject({ name: wren.name, shipId: wren.shipId, hired: true, wage: wren.wage, wingmanId: 'wren', takedowns: 0 });
    expect(r.escort.id).toMatch(/^esc-/);
    expect(r.line).toBe(wren.lines.join);
  });

  it('is refused when full, short or not on offer', () => {
    const full = { ...base, escorts: [1, 2, 3].map((n) => ({ id: `esc-${n}`, name: `E${n}`, shipId: 'courier', outfits: {}, armor: 40, fuel: 1, hired: true, wage: 10 })) };
    expect(recruitWingman(full, data, wren.homePort, wren.id)).toEqual({ error: 'full' });
    expect(recruitWingman({ ...base, credits: 5 }, data, wren.homePort, wren.id)).toEqual({ error: 'short' });
    expect(recruitWingman(base, data, juno.homePort, juno.id)).toEqual({ error: 'gone' });
    expect(recruitWingman(base, data, wren.homePort, 'juno')).toEqual({ error: 'gone' });
  });
});

describe('ranks and takedowns', () => {
  it('ranks follow the takedown thresholds', () => {
    expect(wingmanRank(data, 0).name).toBe('Green');
    expect(wingmanRank(data, 3).name).toBe('Seasoned');
    expect(wingmanRank(data, 7).name).toBe('Seasoned');
    expect(wingmanRank(data, 8).name).toBe('Veteran');
    expect(wingmanRank(data, 99).name).toBe('Ace');
  });

  it('damage multiplier: 1 for plain escorts, 1 + bonus for wingmen', () => {
    expect(damageMulOf(data, undefined)).toBe(1);
    expect(damageMulOf(data, {})).toBe(1);
    expect(damageMulOf(data, { wingmanId: 'wren', takedowns: 0 })).toBe(1);
    expect(damageMulOf(data, { wingmanId: 'wren', takedowns: 8 })).toBeCloseTo(1.2);
    expect(damageMulOf(data, { wingmanId: 'gone', takedowns: 8 })).toBe(1);
  });

  it('each disable by a wingman is a takedown with a line, and a new rank is announced', () => {
    let w = recruited();
    const id = w.escorts[0].id;
    w = { ...w, escorts: w.escorts.map((e) => ({ ...e, takedowns: 2 })) };
    const ev: BattleEvent[] = [{ type: 'disabled', id: 'r1', byPlayer: false, byEscort: true, escortId: id }];
    const r = creditWingmen(w, data, ev);
    expect(r.world.escorts[0].takedowns).toBe(3);
    expect(r.messages).toEqual([`${wren.name}: ${wren.lines.takedown[2]}`, `${wren.name} is now Seasoned.`]);
  });

  it('disables by the player or plain escorts count nothing', () => {
    const w = recruited();
    const ev: BattleEvent[] = [
      { type: 'disabled', id: 'r1', byPlayer: true },
      { type: 'disabled', id: 'r2', byPlayer: false, byEscort: true, escortId: 'esc-9' },
      { type: 'destroyed', id: 'r3', byPlayer: false, byEscort: true, escortId: w.escorts[0].id, pos: { x: 0, y: 0 } },
    ];
    const r = creditWingmen(w, data, ev);
    expect(r.world).toBe(w);
    expect(r.messages).toEqual([]);
  });
});

describe('ejecting and returning', () => {
  it('a destroyed wingman ejects instead of leaving the group', () => {
    const w = { ...recruited(), day: 10 };
    const id = w.escorts[0].id;
    const npc = escortNpc(w.escorts[0], data, { pos: { x: 0, y: 0 }, heading: 0 });
    const before: Traffic = { ...emptyTraffic(w), npcs: [npc] };
    const ev: BattleEvent[] = [{ type: 'destroyed', id, byPlayer: false, pos: { x: 0, y: 0 } }];
    const ej = ejectWingmen(w, data, ev);
    expect(ej.messages).toEqual([`${wren.name}: ${wren.lines.eject}`]);
    expect(ej.world.escorts[0].downUntilDay).toBe(10 + data.fleet.wingmen.recoverDays);
    const lost = escortLosses(ej.world, before, ev);
    expect(lost.world.escorts).toHaveLength(1);
    expect(lost.messages).toEqual([]);
  });

  it('while down: not spawned, no wages, no repair cost, does not jump', () => {
    const w = { ...recruited(), escorts: recruited().escorts.map((e) => ({ ...e, armor: 0, downUntilDay: 5 })) };
    expect(withEscorts(emptyTraffic(w), w, data, { pos: { x: 0, y: 0 }, heading: 0 }).npcs).toHaveLength(0);
    expect(payWages(w, data).credits).toBe(w.credits);
    expect(repairCost(w, data)).toBe(0);
    expect(escortsJump(w, data, emptyTraffic(w)).escorts[0]).toEqual(w.escorts[0]);
    expect(isDown(w.escorts[0])).toBe(true);
  });

  it('back at the first landing on or after the day, rebuilt; takedowns kept', () => {
    const w0 = recruited();
    const down = { ...w0, escorts: w0.escorts.map((e) => ({ ...e, armor: 0, outfits: {}, takedowns: 4, downUntilDay: 5 })) };
    expect(returnWingmen({ ...down, day: 4 }, data).notices).toEqual([]);
    const r = returnWingmen({ ...down, day: 5 }, data);
    expect(r.notices).toEqual([wren.lines.back]);
    const e = r.world.escorts[0];
    expect(e.downUntilDay).toBeUndefined();
    expect(e.takedowns).toBe(4);
    expect(e.armor).toBe(w0.escorts[0].armor);
    expect(e.outfits).toEqual(w0.escorts[0].outfits);
  });
});
