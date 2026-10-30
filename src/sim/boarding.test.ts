import { describe, expect, it } from 'vitest';
import { testData } from '../data/testData';
import { CombatSchema } from '../data/schemas';
import combatJson from '../../data/combat.json';
import { COMMAND_BLOCK_TEXT, canBoard, canTakeCommand, captureOdds, captureSucceeds, lootOf, prizeValue, sellPrize, takeAmmo, takeCargo, takeCommand, takeCredits } from './boarding';
import { fullHull } from './combat';
import { cargoUsed } from './cargo';
import { tradeInValue } from './shipyard';
import { npcLoadout } from './weapons';
import type { Npc } from './traffic';
import { newWorld } from './world';
import type { WorldState } from './types';

const data = testData();
const base = newWorld(data, 11);

function npc(shipId: string, over: Partial<Npc> = {}): Npc {
  const def = data.ships[shipId];
  return {
    id: `n-${shipId}`, name: 'Test Ship', shipId, government: 'concord', errand: 'pass',
    ship: { pos: { x: 30, y: 0 }, vel: { x: 0, y: 0 }, heading: 0, fuel: 100 },
    portId: null, phase: 'fly', phaseT: 0, thrusting: false, role: 'trader',
    hull: { ...fullHull(def.shields, def.armor), disabled: true }, outfits: npcLoadout(def),
    aggro: [], engaged: false, peaceful: false, demand: false, killCounted: false, ...over,
  } as Npc;
}
const at = (w: WorldState, x: number, y: number, vx = 0, vy = 0): WorldState => ({ ...w, ship: { ...w.ship, pos: { x, y }, vel: { x: vx, y: vy } } });

describe('combat.boarding data', () => {
  it('is strict and ordered', () => {
    expect(CombatSchema.safeParse(combatJson).success).toBe(true);
    const bad = { ...combatJson, boarding: { ...combatJson.boarding, creditsFraction: [0.5, 0.1] } };
    expect(CombatSchema.safeParse(bad).success).toBe(false);
    expect(CombatSchema.safeParse({ ...combatJson, boarding: { ...combatJson.boarding, extra: 1 } }).success).toBe(false);
  });
});

describe('canBoard', () => {
  it('needs disabled, 60 px and slow', () => {
    const w = at(base, 0, 0);
    const n = npc('mule');
    expect(canBoard(w, data, n)).toBe(true);
    expect(canBoard(w, data, { ...n, hull: { ...n.hull, disabled: false } })).toBe(false);
    expect(canBoard(w, data, { ...n, ship: { ...n.ship, pos: { x: 61, y: 0 } } })).toBe(false);
    expect(canBoard(at(w, 0, 0, 41, 0), data, n)).toBe(false);
    // relative speed, not absolute
    expect(canBoard(at(w, 0, 0, 200, 0), data, { ...n, ship: { ...n.ship, vel: { x: 200, y: 0 } } })).toBe(true);
  });
});

describe('lootOf', () => {
  it('is seeded and stable', () => {
    const n = npc('mule');
    const a = lootOf(base, data, n);
    expect(lootOf(base, data, n)).toEqual(a);
    expect(a.credits % 10).toBe(0);
    expect(a.credits).toBeGreaterThanOrEqual(Math.round(45000 * 0.02 / 10) * 10);
    expect(a.credits).toBeLessThanOrEqual(Math.round(45000 * 0.08 / 10) * 10);
    const tons = Object.values(a.cargo).reduce((x, y) => x + y, 0);
    expect(tons).toBeGreaterThanOrEqual(18);
    expect(tons).toBeLessThanOrEqual(60);
    expect(Object.keys(a.cargo).length).toBeLessThanOrEqual(2);
    for (const id of Object.keys(a.cargo)) expect(data.commodities[id]).toBeDefined();
  });
  it('raiders carry credits and ammo only', () => {
    const k = lootOf(base, data, npc('kestrel', { role: 'raider' }));
    expect(k.cargo).toEqual({});
    expect(k.ammo).toEqual({ rocket: 8 });
  });
});

describe('captureOdds', () => {
  it('shuttle vs mule = 0.17; warden vs kestrel = 0.85; floor 0.05', () => {
    expect(captureOdds(base, data, npc('mule'))).toBe(0.17);
    expect(captureOdds({ ...base, shipId: 'warden' }, data, npc('kestrel'))).toBe(0.85);
    expect(captureOdds(base, data, npc('bastion'))).toBe(0.05);
  });
  it('succeeds deterministically', () => {
    const n = npc('mule');
    expect(captureSucceeds(base, data, n)).toBe(captureSucceeds(base, data, n));
    expect(captureSucceeds({ ...base, shipId: 'warden' }, data, npc('kestrel'))).toBeTypeOf('boolean');
  });
});

describe('taking loot', () => {
  it('takeCredits moves the credits', () => {
    const r = takeCredits(base, { credits: 500, cargo: {}, ammo: {} });
    expect(r.world.credits).toBe(base.credits + 500);
    expect(r.loot.credits).toBe(0);
    expect(r.text.length).toBeGreaterThan(0);
  });
  it('takeCargo caps at free space, best goods first', () => {
    const ids = Object.keys(data.commodities).sort((a, b) => data.commodities[b].basePrice - data.commodities[a].basePrice);
    const [hi, lo] = [ids[0], ids[ids.length - 1]];
    const w = { ...base, cargo: {}, missions: [] };
    const free = data.ships[w.shipId].cargo;
    const r = takeCargo(w, data, { credits: 0, cargo: { [lo]: free, [hi]: 5 }, ammo: {} });
    expect(r.world.cargo[hi]).toBe(5);
    expect(r.world.cargo[lo]).toBe(free - 5);
    expect(cargoUsed(r.world)).toBe(free);
    expect(r.loot.cargo[lo]).toBe(5);
    expect(r.loot.cargo[hi] ?? 0).toBe(0);
  });
  it('takeAmmo only for owned launchers, capped', () => {
    const w = { ...base, outfits: { 'rocket-rack': 1, rocket: 5 } };
    const cap = data.outfits.rocket.category === 'ammo' ? data.outfits.rocket.max : 0;
    const r = takeAmmo(w, data, { credits: 0, cargo: {}, ammo: { rocket: 100, seeker: 4 } });
    expect(r.world.outfits.rocket).toBe(cap);
    expect(r.world.outfits.seeker).toBeUndefined();
    expect(r.loot.ammo.seeker).toBe(4);
    expect(r.loot.ammo.rocket).toBe(100 - (cap - 5));
  });
});

describe('takeCommand', () => {
  const w0: WorldState = { ...base, cargo: { food: 3 }, missions: [], shipName: 'Old', flags: [] };
  it('credits trade-in, swaps hull and outfits, keeps cargo, counts a capture', () => {
    const n = npc('mule', { outfits: { 'light-blaster': 1 } });
    const w = takeCommand(w0, data, n);
    expect(w.credits).toBe(w0.credits + tradeInValue(w0, data));
    expect(w.shipId).toBe('mule');
    expect(w.outfits).toEqual({ 'light-blaster': 1 });
    expect(w.cargo).toEqual({ food: 3 });
    expect(w.shipName).toBe('Test Ship');
    expect(w.stats.captures).toBe(w0.stats.captures + 1);
    expect(w.flags.some((f) => f.startsWith('bought:'))).toBe(false);
    expect(w.ship.fuel).toBeLessThanOrEqual(data.ships.mule.fuelCapacity);
  });
  it('clamps fuel to her tank', () => {
    const w = takeCommand({ ...w0, ship: { ...w0.ship, fuel: 9999 } }, data, npc('kestrel'));
    expect(w.ship.fuel).toBe(data.ships.kestrel.fuelCapacity);
  });
  it('canTakeCommand blocks when cargo or berths would not fit', () => {
    expect(canTakeCommand(w0, data, npc('mule'))).toEqual({ ok: true });
    const heavy = { ...w0, cargo: { food: 7 } }; // kestrel holds 5
    expect(canTakeCommand(heavy, data, npc('kestrel'))).toEqual({ ok: false, reason: 'cargo' });
    const pax = { ...w0, missions: [{ passengers: 3, tons: 0 }] } as unknown as WorldState;
    expect(canTakeCommand(pax, data, npc('kestrel'))).toEqual({ ok: false, reason: 'berths' });
    const over = npc('shuttle', { outfits: { 'light-blaster': 50 } });
    expect(canTakeCommand(w0, data, over)).toEqual({ ok: false, reason: 'space' });
    expect(COMMAND_BLOCK_TEXT.cargo).toBe("Her hold can't take your cargo");
    expect(COMMAND_BLOCK_TEXT.berths).toBe('Not enough berths for your passengers');
    expect(COMMAND_BLOCK_TEXT.space).toBe("Her outfits don't fit her hull");
  });
});

describe('prize', () => {
  it('is 30% of hull price', () => {
    expect(prizeValue(data, npc('mule'))).toBe(13500);
    expect(prizeValue(data, npc('courier'))).toBe(9000);
    const w = sellPrize(base, data, npc('mule'));
    expect(w.credits).toBe(base.credits + 13500);
    expect(w.stats.captures).toBe(base.stats.captures + 1);
  });
});
