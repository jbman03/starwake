import { describe, expect, it } from 'vitest';
import { testData } from '../data/testData';
import type { ActionId } from '../input/actions';
import { newBattle, stepBattle, type Battle, type BattleEvent } from './battle';
import { fullHull, isPlayerSide } from './combat';
import { dockedCount, dockFighters, fighterCap, fighterLosses, fighterNpc, playerFighters } from './fighters';
import type { Npc, Traffic } from './traffic';
import type { FrameInput, WorldState } from './types';
import { newWorld } from './world';

const data = testData();
const DT = 1 / 60;
const frame = (pressed: ActionId[] = []): FrameInput => ({ actions: new Set(), pressed: new Set(pressed) });
const LAUNCH = frame(['launchFighters']);
const IDLE = frame();

const carrierWorld = (over: Partial<WorldState> = {}): WorldState => {
  const w = newWorld(data, 11);
  return { ...w, shipId: 'bastion', outfits: { 'fighter-bay': 1, 'wasp-fighter': 4 }, ship: { ...w.ship, pos: { x: 0, y: 0 }, vel: { x: 0, y: 0 }, heading: 0 }, ...over };
};
const mkTraffic = (npcs: Npc[] = []): Traffic => ({ systemId: 'calder', npcs, spawnCount: 0, nextSpawnSec: 999, targetId: null });

interface Sim { b: Battle; w: WorldState; t: Traffic; events: BattleEvent[] }
const begin = (w: WorldState, t: Traffic = mkTraffic()): Sim => ({ b: newBattle(w, data), w, t, events: [] });
function tick(s: Sim, input: FrameInput = IDLE, n = 1): Sim {
  let { b, w, t } = s;
  const events = [...s.events];
  for (let i = 0; i < n; i++) {
    const r = stepBattle(b, w, t, i === 0 ? input : IDLE, data, DT);
    b = r.battle; w = r.world; t = r.traffic;
    events.push(...r.events);
    w = { ...w, timeSec: w.timeSec + DT };
  }
  return { b, w, t, events };
}
const fighters = (s: Sim) => playerFighters(s.t);

describe('bays and capacity', () => {
  it('a bay holds its fighter max; fighters count as docked only with a bay', () => {
    expect(fighterCap({ 'fighter-bay': 2 }, 'wasp-fighter', data)).toBe(8);
    expect(fighterCap({}, 'wasp-fighter', data)).toBe(0);
    expect(dockedCount({ 'fighter-bay': 1, 'wasp-fighter': 3 }, data)).toBe(3);
    expect(dockedCount({ 'wasp-fighter': 3 }, data)).toBe(0);
  });

  it('the shipped Bastion NPC fit carries a bay and four Wasps', () => {
    expect(data.ships.bastion.loadout).toMatchObject({ 'fighter-bay': 1, 'wasp-fighter': 4 });
  });
});

describe('player fighters', () => {
  it('one press launches every docked fighter, one a second, as player-side escort NPCs', () => {
    let s = tick(begin(carrierWorld()), LAUNCH);
    expect(s.events.filter((e) => e.type === 'fighters')).toEqual([{ type: 'fighters', what: 'launched' }]);
    expect(fighters(s)).toHaveLength(1);
    s = tick(s, IDLE, 4 * 60);
    expect(fighters(s)).toHaveLength(4);
    expect(s.w.outfits['wasp-fighter']).toBeUndefined();
    for (const f of fighters(s)) {
      expect(f.role).toBe('escort');
      expect(isPlayerSide(f.id)).toBe(true);
    }
  });

  it('a second press recalls them: they fly home and dock, back in the outfit count', () => {
    let s = tick(begin(carrierWorld()), LAUNCH);
    s = tick(s, IDLE, 5 * 60);
    expect(fighters(s)).toHaveLength(4);
    s = tick(s, LAUNCH);
    expect(s.events.some((e) => e.type === 'fighters' && e.what === 'recalled')).toBe(true);
    s = tick(s, IDLE, 10 * 60);
    expect(fighters(s)).toHaveLength(0);
    expect(s.w.outfits['wasp-fighter']).toBe(4);
    expect(s.events.some((e) => e.type === 'fighters' && e.what === 'docked')).toBe(true);
    expect(s.b.recall).toBe(false);
  });

  it('a press with no fighters aboard does nothing', () => {
    const s = tick(begin(carrierWorld({ outfits: { 'fighter-bay': 1 } })), LAUNCH);
    expect(s.events.filter((e) => e.type === 'fighters')).toEqual([]);
    expect(fighters(s)).toHaveLength(0);
  });

  it('leaving the system docks every fighter that can fly; a disabled one is lost', () => {
    const w = carrierWorld({ outfits: { 'fighter-bay': 1, 'wasp-fighter': 1 } });
    const a = fighterNpc('esc-f1', 'wasp-fighter', { id: 'player', government: '', role: 'escort', ship: w.ship, aggro: [] }, data);
    const b = { ...fighterNpc('esc-f2', 'wasp-fighter', { id: 'player', government: '', role: 'escort', ship: w.ship, aggro: [] }, data), hull: { ...fullHull(30, 30), armor: 1, disabled: true } };
    const r = dockFighters(w, data, mkTraffic([a, b]));
    expect(r.world.outfits['wasp-fighter']).toBe(2);
    expect(r.lost).toBe(1);
    expect(r.traffic.npcs).toEqual([]);
  });

  it('a destroyed player fighter is announced as lost', () => {
    const w = carrierWorld();
    const f = fighterNpc('esc-f1', 'wasp-fighter', { id: 'player', government: '', role: 'escort', ship: w.ship, aggro: [] }, data);
    expect(fighterLosses(mkTraffic([f]), [{ type: 'destroyed', id: 'esc-f1', byPlayer: false, pos: { x: 0, y: 0 } }])).toEqual(['A Wasp Fighter is lost.']);
  });
});

describe('NPC carriers', () => {
  it('a carrier in a fight launches its fighters with its government and role', () => {
    const carrier: Npc = {
      id: 'c1', name: 'Big', shipId: 'bastion', government: 'raiders', errand: 'pass',
      ship: { pos: { x: 400, y: 0 }, vel: { x: 0, y: 0 }, heading: Math.PI, fuel: 0 }, portId: null, phase: 'fly', phaseT: 0, thrusting: false,
      role: 'raider', hull: fullHull(600, 600), outfits: { ...data.ships.bastion.loadout }, aggro: ['player'], engaged: true, peaceful: false, demand: false, killCounted: false,
    };
    let s = begin({ ...newWorld(data, 11), systemId: 'vesk', ship: { pos: { x: 0, y: 0 }, vel: { x: 0, y: 0 }, heading: 0, fuel: 100 } }, { ...mkTraffic([carrier]), systemId: 'vesk' });
    s = { ...s, b: { ...s.b, player: { ...s.b.player, shields: 1e6, maxShields: 1e6 } } };
    s = tick(s, IDLE, 2 * 60);
    const out = s.t.npcs.filter((n) => n.fighter?.carrierId === 'c1');
    expect(out.length).toBeGreaterThanOrEqual(1);
    expect(out[0]).toMatchObject({ government: 'raiders', role: 'raider', shipId: 'wasp' });
    expect(s.t.npcs.find((n) => n.id === 'c1')!.outfits['wasp-fighter']).toBe(4 - out.length);
  });
});

describe('outfitter', () => {
  it('a bay fits only a carrier; fighters need a bay and stop at its room', async () => {
    const { outfitBuyCheck } = await import('./outfitter');
    const rich = { credits: 10_000_000 };
    expect(outfitBuyCheck({ ...carrierWorld({ outfits: {} }), ...rich, shipId: 'warden' }, data, 'vanterre', 'fighter-bay')).toEqual({ ok: false, reason: 'hull' });
    expect(outfitBuyCheck({ ...carrierWorld({ outfits: {} }), ...rich }, data, 'vanterre', 'fighter-bay')).toEqual({ ok: true });
    expect(outfitBuyCheck({ ...carrierWorld({ outfits: {} }), ...rich }, data, 'vanterre', 'wasp-fighter')).toEqual({ ok: false, reason: 'noBay' });
    expect(outfitBuyCheck({ ...carrierWorld({ outfits: { 'fighter-bay': 1, 'wasp-fighter': 3 } }), ...rich }, data, 'vanterre', 'wasp-fighter')).toEqual({ ok: true });
    expect(outfitBuyCheck({ ...carrierWorld(), ...rich }, data, 'vanterre', 'wasp-fighter')).toEqual({ ok: false, reason: 'max' });
  });
});
