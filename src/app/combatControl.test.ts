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

/** Disabled by a hit at `atSec` (the world's clock; the test worlds start at 0). */
function disable(c: CombatControl, atSec = 0): void {
  c.battle = { ...c.battle, player: { ...c.battle.player, armor: 1, shields: 0, disabled: true, lastHitSec: atSec } };
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

  it('a jump clears the fight but keeps the hull; a landing repairs it', () => {
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
    const hurt = c.battle.player;
    // Arriving in another system starts a fresh battle, but jumping out keeps the damage (spec §7).
    const there = { ...w, systemId: 'vesk' };
    c.reset(there, { keepHull: true });
    expect(c.battle.projectiles).toEqual([]);
    expect(c.battle.beams).toEqual([]);
    expect(c.battle.angry).toEqual([]);
    expect(c.battle.systemId).toBe('vesk');
    expect(c.battle.player).toEqual(hurt);
    expect(c.playerDisabled()).toBe(true);
    expect(c.disabledCalmSec).toBe(0);
    // A tick in a new system without the controller's reset keeps the hull too.
    const third = { ...w, systemId: 'calder' };
    c.tick(third, mkTraffic([]), IDLE, DT);
    expect(c.battle.systemId).toBe('calder');
    expect(c.battle.player.armor).toBe(2);
    // Landing repairs the ship: a full hull.
    c.reset(there);
    const st = worldStats(there, data);
    expect(c.battle.player).toEqual(fullHull(st.shields, st.armor));
    expect(c.playerDisabled()).toBe(false);
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

  it('a fled raider holding station does not block the tow', () => {
    // The bounty case: hurt below its flee line, it has a hold point and sits there, silent, 800 px off.
    const w = mkWorld();
    const c = new CombatControl(data, w);
    disable(c);
    const hurt = { ...fullHull(60, 40), shields: 0, armor: 5, lastHitSec: 0 };
    const fled = mkNpc('bounty', 800, 0, { government: 'raiders', role: 'raider', peaceful: false, fled: true, hold: { x: 800, y: 0 }, hull: hurt, outfits: { 'light-blaster': 1 } });
    let t = mkTraffic([fled]);
    let world = w;
    for (let i = 0; i < Math.round(CALM_SEC * 60); i++) {
      const r = c.tick(world, t, IDLE, DT);
      t = r.traffic;
      world = { ...r.world, timeSec: r.world.timeSec + DT };
    }
    expect(t.npcs[0].fled).toBe(true);
    expect(c.battle.player.armor).toBe(1); // it never fired
    expect(c.disabledCalm()).toBe(true);
  });

  it('a quiet spell with no hits makes a tow available even with a hostile near', () => {
    // A hostile in range that holds fire (here a raider waiting out of its engage range) would block the tow
    // forever; after the quiet spell (combat.tow.quietSec) with no hit, the tow comes anyway.
    const w = mkWorld();
    const c = new CombatControl(data, w);
    disable(c);
    const near = mkTraffic([raider('r', CALM_RANGE - 10, 0)]);
    const quiet = data.combat.tow.quietSec;
    let world = w;
    const until = (sec: number) => {
      while (world.timeSec < sec - 1e-9) {
        c.tick(world, near, IDLE, DT);
        world = { ...world, timeSec: world.timeSec + DT };
      }
    };
    until(quiet - 0.5);
    expect(c.disabledCalm()).toBe(false);
    until(quiet + 0.1);
    expect(c.disabledCalm()).toBe(true);
    // A new hit ends the quiet spell, and the hostile near blocks the tow again.
    disable(c, world.timeSec);
    c.tick(world, near, IDLE, DT);
    expect(c.disabledCalm()).toBe(false);
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

describe('raider demands', () => {
  const demander = (id = 'd1') => mkNpc(id, 500, 0, { government: 'raiders', role: 'raider', peaceful: false, demand: true });
  const find = (t: Traffic, id: string) => t.npcs.find((n) => n.id === id)!;

  it('a newly arrived demanding raider makes an offer and stays peaceful for the AI', () => {
    const c = new CombatControl(data, mkWorld({ credits: 2000 }));
    const w = mkWorld({ credits: 2000 });
    const r = c.checkDemands(w, mkTraffic([demander()]), false);
    expect(r.offer).toMatchObject({ npcId: 'd1', terms: { credits: 300 } });
    expect(find(r.traffic, 'd1').demand).toBe(true);
    // Not offered twice.
    expect(c.checkDemands(w, r.traffic, true).offer).toBeNull();
    expect(find(c.checkDemands(w, r.traffic, true).traffic, 'd1').demand).toBe(true);
  });

  it('demand hail resolves to peace on pay', () => {
    const w = mkWorld({ credits: 2000 });
    const c = new CombatControl(data, w);
    const r = c.checkDemands(w, mkTraffic([demander()]), false);
    const p = c.resolveDemand(w, r.traffic, r.offer!, 'pay')!;
    expect(p.world.credits).toBe(2000 - r.offer!.terms.credits);
    expect(find(p.traffic, 'd1')).toMatchObject({ peaceful: true, demand: false, engaged: false, errand: 'pass', portId: null });
    expect(c.isHostile(find(p.traffic, 'd1'), p.world)).toBe(false);
  });

  it('dump takes cargo and refuses without any; pay refuses when short', () => {
    const empty = mkWorld({ credits: 100 });
    const c = new CombatControl(data, empty);
    const r = c.checkDemands(empty, mkTraffic([demander()]), false);
    expect(c.resolveDemand(empty, r.traffic, r.offer!, 'pay')).toBeNull();
    expect(c.resolveDemand(empty, r.traffic, r.offer!, 'dump')).toBeNull();
    const good = Object.keys(data.commodities)[0];
    const full = mkWorld({ cargo: { [good]: 12 } });
    const c2 = new CombatControl(data, full);
    const r2 = c2.checkDemands(full, mkTraffic([demander()]), false);
    const d = c2.resolveDemand(full, r2.traffic, r2.offer!, 'dump')!;
    expect(d.world.cargo[good]).toBe(2);
    expect(find(d.traffic, 'd1').peaceful).toBe(true);
  });

  it('refuse or 15 s lapse -> attack', () => {
    const w = mkWorld({ credits: 2000 });
    const c = new CombatControl(data, w);
    const r = c.checkDemands(w, mkTraffic([demander()]), false);
    const x = c.resolveDemand(w, r.traffic, r.offer!, 'refuse')!;
    expect(find(x.traffic, 'd1')).toMatchObject({ demand: false, engaged: true, peaceful: false });
    expect(x.world).toBe(w);
    expect(c.isHostile(find(x.traffic, 'd1'), w)).toBe(true);
    expect(data.combat.demand.lapseSec).toBe(15);
  });

  it('raider skips demand when a hail is pending', () => {
    const w = mkWorld();
    const c = new CombatControl(data, w);
    const r = c.checkDemands(w, mkTraffic([demander()]), true);
    expect(r.offer).toBeNull();
    expect(find(r.traffic, 'd1')).toMatchObject({ demand: false, engaged: true });
    // A second demander while one offer is open also just attacks.
    const c2 = new CombatControl(data, w);
    const a = c2.checkDemands(w, mkTraffic([demander('a')]), false);
    const b = c2.checkDemands(w, { ...a.traffic, npcs: [...a.traffic.npcs, demander('b')] }, true);
    expect(find(b.traffic, 'a').demand).toBe(true);
    expect(find(b.traffic, 'b')).toMatchObject({ demand: false, engaged: true });
  });

  it('a disabled raider is not paid', () => {
    const w = mkWorld({ credits: 2000 });
    const c = new CombatControl(data, w);
    const r = c.checkDemands(w, mkTraffic([demander()]), false);
    const hurt = { ...r.traffic, npcs: r.traffic.npcs.map((n) => ({ ...n, hull: { ...n.hull, disabled: true } })) };
    const x = c.resolveDemand(w, hurt, r.offer!, 'pay')!;
    expect(x.world.credits).toBe(2000);
    expect(x.messages[0]).toContain('goes quiet');
  });

  it('a waiting raider closes to keep range without firing or leaving', () => {
    const w = mkWorld();
    const c = new CombatControl(data, w);
    let t = c.checkDemands(w, mkTraffic([demander()]), false).traffic;
    let world = w;
    for (let i = 0; i < 60 * 20; i++) {
      const r = c.tick(world, t, IDLE, DT);
      world = r.world;
      t = r.traffic;
      expect(r.events.some((e) => e.type === 'shot')).toBe(false);
    }
    const n = t.npcs.find((x) => x.id === 'd1')!;
    expect(n.engaged).toBe(true);
    expect(Math.hypot(n.ship.pos.x, n.ship.pos.y)).toBeLessThan(data.combat.ai.raider.keepRange * 1.5);
    expect(world.credits).toBe(w.credits);
  });
});
