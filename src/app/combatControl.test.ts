import { describe, expect, it } from 'vitest';
import { testData } from '../data/testData';
import type { ActionId } from '../input/actions';
import { fullHull, type Projectile } from '../sim/combat';
import { worldStats } from '../sim/shipStats';
import type { Npc, Traffic } from '../sim/traffic';
import type { FrameInput, WorldState } from '../sim/types';
import { newWorld } from '../sim/world';
import { CALM_RANGE, CALM_SEC, CombatControl, hostileAhead } from './combatControl';

const data = testData();
const DT = 1 / 60;
const frame = (held: ActionId[] = [], pressed: ActionId[] = [], stick?: FrameInput['stick']): FrameInput =>
  stick ? { actions: new Set(held), pressed: new Set(pressed), stick } : { actions: new Set(held), pressed: new Set(pressed) };
const FIRE = frame(['firePrimary']);
const IDLE = frame();

const mkWorld = (over: Partial<WorldState> = {}): WorldState => {
  const w = newWorld(data, 11);
  return { ...w, ship: { ...w.ship, pos: { x: 0, y: 0 }, vel: { x: 0, y: 0 }, heading: 0 }, ...over };
};
const mkNpc = (id: string, x: number, y: number, over: Partial<Npc> = {}): Npc => ({
  id,
  name: id,
  shipId: 'shuttle',
  government: 'concord',
  errand: 'pass',
  ship: { pos: { x, y }, vel: { x: 0, y: 0 }, heading: 0, fuel: 0 },
  portId: null,
  phase: 'fly',
  phaseT: 0,
  thrusting: false,
  role: 'trader',
  hull: fullHull(60, 40),
  outfits: {},
  aggro: [],
  engaged: false,
  peaceful: true,
  demand: false,
  killCounted: false,
  ...over,
});
const mkTraffic = (npcs: Npc[], targetId: string | null = null): Traffic => ({ systemId: 'calder', npcs, spawnCount: 0, nextSpawnSec: 999, targetId });
const wreck = (id: string, x: number, y: number, over: Partial<Npc> = {}) => mkNpc(id, x, y, { hull: { ...fullHull(60, 40), armor: 1, disabled: true }, ...over });
const raider = (id: string, x: number, y: number) => mkNpc(id, x, y, { government: 'raiders', role: 'raider', peaceful: false });

function disable(c: CombatControl): void {
  c.battle = { ...c.battle, player: { ...c.battle.player, armor: 1, shields: 0, disabled: true } };
}

describe('CombatControl', () => {
  it('firing fills projectiles', () => {
    const w = mkWorld();
    const c = new CombatControl(data, w);
    expect(c.battle.projectiles).toEqual([]);
    const r = c.tick(w, mkTraffic([]), FIRE, DT);
    expect(c.battle.projectiles.length).toBeGreaterThan(0);
    expect(r.events.some((e) => e.type === 'shot' && e.ownerId === 'player')).toBe(true);
  });

  it('clears battle on jump and landing', () => {
    const w = mkWorld();
    const c = new CombatControl(data, w);
    c.tick(w, mkTraffic([]), FIRE, DT);
    const bolt: Projectile = { ...c.battle.projectiles[0] };
    c.battle = {
      ...c.battle,
      projectiles: [...c.battle.projectiles, bolt],
      beams: [{ ownerId: 'x', from: { x: 0, y: 0 }, to: { x: 1, y: 1 }, hitId: null }],
      player: { ...c.battle.player, shields: 0, armor: 2, disabled: true },
      angry: ['concord'],
    };
    c.disabledCalmSec = 3;
    // Arriving in another system (or landing) starts a fresh battle with a full hull.
    const there = { ...w, systemId: 'vesk' };
    c.reset(there);
    const st = worldStats(there, data);
    expect(c.battle.projectiles).toEqual([]);
    expect(c.battle.beams).toEqual([]);
    expect(c.battle.angry).toEqual([]);
    expect(c.battle.systemId).toBe('vesk');
    expect(c.battle.player).toEqual(fullHull(st.shields, st.armor));
    expect(c.playerDisabled()).toBe(false);
    expect(c.disabledCalmSec).toBe(0);
  });

  it('disabled player input is ignored', () => {
    const w = mkWorld({ assist: { kind: 'autopilot', dest: { type: 'jumpPoint' }, autoLand: false } });
    const c = new CombatControl(data, w);
    disable(c);
    expect(c.playerDisabled()).toBe(true);
    const held: ActionId[] = ['thrust', 'turnLeft', 'reverse', 'firePrimary', 'fireSecondary'];
    const pressed: ActionId[] = ['jump', 'land', 'autopilot', 'autoStop', 'faceTarget', 'map', 'pause', 'flightMissionLog', 'nextTarget'];
    const f = c.flightInput(w, frame(held, pressed, { angle: 0, magnitude: 1, mode: 'point' }), DT);
    expect([...f.input.actions]).toEqual([]);
    expect(f.input.stick).toBeUndefined();
    expect([...f.input.pressed].sort()).toEqual(['flightMissionLog', 'map', 'nextTarget', 'pause']);
    expect(f.world.assist).toEqual({ kind: 'none' });
    c.tick(w, mkTraffic([]), FIRE, DT);
    expect(c.battle.projectiles).toEqual([]);
    // A healthy ship's input passes through untouched.
    const ok = new CombatControl(data, w);
    const input = frame(held, pressed);
    expect(ok.flightInput(w, input, DT)).toEqual({ world: w, input });
  });

  it('a disabled ship drifts to rest', () => {
    const w = mkWorld({ ship: { pos: { x: 0, y: 0 }, vel: { x: 100, y: 0 }, heading: 0, fuel: 100 } });
    const c = new CombatControl(data, w);
    disable(c);
    const f = c.flightInput(w, IDLE, DT);
    expect(f.world.ship.vel.x).toBeLessThan(100);
    expect(f.world.ship.pos).toEqual(w.ship.pos); // stepWorld moves it
  });

  it('boardable needs a disabled NPC in reach', () => {
    const w = mkWorld();
    const c = new CombatControl(data, w);
    expect(c.boardable(w, mkTraffic([mkNpc('live', 30, 0)]))).toBeNull();
    expect(c.boardable(w, mkTraffic([wreck('far', 200, 0)]))).toBeNull();
    expect(c.boardable(w, mkTraffic([wreck('fast', 30, 0, { ship: { pos: { x: 30, y: 0 }, vel: { x: 80, y: 0 }, heading: 0, fuel: 0 } })]))).toBeNull();
    expect(c.boardable(w, mkTraffic([wreck('near', 30, 0)]))?.id).toBe('near');
    // The targeted wreck wins over a nearer one; else the nearest.
    const two = [wreck('a', 20, 0), wreck('b', 50, 0)];
    expect(c.boardable(w, mkTraffic(two))?.id).toBe('a');
    expect(c.boardable(w, mkTraffic(two, 'b'))?.id).toBe('b');
    expect(c.boardable(w, mkTraffic([...two, wreck('c', 900, 0)], 'c'))?.id).toBe('a');
    // A disabled player can't board.
    disable(c);
    expect(c.boardable(w, mkTraffic(two))).toBeNull();
  });

  it('disabledCalmSec counts while disabled with no hostile in range', () => {
    const w = mkWorld();
    const c = new CombatControl(data, w);
    c.tick(w, mkTraffic([]), IDLE, DT);
    expect(c.disabledCalmSec).toBe(0);
    disable(c);
    const near = mkTraffic([raider('r', CALM_RANGE - 10, 0)]);
    for (let i = 0; i < 10; i++) c.tick(w, near, IDLE, DT);
    expect(c.disabledCalmSec).toBe(0);
    const far = mkTraffic([raider('r', CALM_RANGE + 400, 0), mkNpc('trader', 50, 0)]);
    for (let i = 0; i < Math.round(CALM_SEC * 60) - 1; i++) c.tick(w, far, IDLE, DT);
    expect(c.disabledCalm()).toBe(false);
    c.tick(w, far, IDLE, DT);
    expect(c.disabledCalm()).toBe(true);
    // A hostile coming back in range starts the wait again.
    c.tick(w, near, IDLE, DT);
    expect(c.disabledCalmSec).toBe(0);
  });

  it('hostileAhead adds an engaged raider 400 px ahead', () => {
    const w = mkWorld({ ship: { pos: { x: 100, y: 0 }, vel: { x: 0, y: 0 }, heading: Math.PI / 2, fuel: 100 } });
    const r = hostileAhead(w, mkTraffic([]), data, 'kestrel');
    const n = r.traffic.npcs.find((x) => x.id === r.id)!;
    expect(n).toMatchObject({ role: 'raider', government: 'raiders', engaged: true, demand: false, peaceful: false, shipId: 'kestrel', phase: 'fly' });
    expect(n.ship.pos.x).toBeCloseTo(100);
    expect(n.ship.pos.y).toBeCloseTo(400);
    expect(n.hull.disabled).toBe(false);
    expect(n.hull.armor).toBe(n.hull.maxArmor);
    expect(Object.keys(n.outfits).length).toBeGreaterThan(0);
    expect(hostileAhead(w, r.traffic, data).id).not.toBe(r.id);
  });
});
