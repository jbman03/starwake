import { describe, expect, it } from 'vitest';
import type { ActionId } from '../input/actions';
import { testData } from '../data/testData';
import { fullHull, PLAYER_ID, type Projectile } from './combat';
import { cycleSecondary, newBattle, nearestHostile, playerTargetId, stepBattle, type Battle, type BattleEvent } from './battle';
import { worldStats } from './shipStats';
import type { Npc, Traffic } from './traffic';
import type { FrameInput, WorldState } from './types';
import { newWorld } from './world';

const data = testData();
const DT = 1 / 60;
const frame = (held: ActionId[] = [], pressed: ActionId[] = []): FrameInput => ({ actions: new Set(held), pressed: new Set(pressed) });
const FIRE = frame(['firePrimary']);
const IDLE = frame();

const mkWorld = (over: Partial<WorldState> = {}): WorldState => {
  const w = newWorld(data, 11);
  return { ...w, ship: { ...w.ship, pos: { x: 0, y: 0 }, heading: 0 }, ...over };
};
const mkNpc = (id: string, government: string, x: number, y: number, over: Partial<Npc> = {}): Npc => ({
  id,
  name: id,
  shipId: 'shuttle',
  government,
  errand: 'pass',
  ship: { pos: { x, y }, vel: { x: 0, y: 0 }, heading: 0, fuel: 0 },
  portId: null,
  phase: 'fly',
  phaseT: 0,
  thrusting: false,
  role: government === 'raiders' ? 'raider' : 'trader',
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
const hullAt = (armor: number, shields = 0) => ({ ...fullHull(60, 40), shields, armor });

interface Sim { b: Battle; w: WorldState; t: Traffic; events: BattleEvent[] }
const begin = (w: WorldState, t: Traffic): Sim => ({ b: newBattle(w, data), w, t, events: [] });
function tick(s: Sim, input: FrameInput = IDLE, n = 1): Sim {
  let { b, w, t } = s;
  const events = [...s.events];
  for (let i = 0; i < n; i++) {
    const r = stepBattle(b, w, t, input, data, DT);
    b = r.battle; w = r.world; t = r.traffic;
    events.push(...r.events);
    w = { ...w, timeSec: w.timeSec + DT };
  }
  return { b, w, t, events };
}
const count = (s: Sim, type: BattleEvent['type']) => s.events.filter((e) => e.type === type).length;
const npc = (s: Sim, id: string) => s.t.npcs.find((n) => n.id === id)!;
const bolt = (over: Partial<Projectile> = {}): Projectile => ({
  id: 900, ownerId: PLAYER_ID, targetId: null, kind: 'bolt', pos: { x: 0, y: 0 }, vel: { x: 0, y: 0 }, damage: 6, ttl: 1, turnRate: 0, ...over,
});

describe('battle setup', () => {
  it('newBattle starts at full hull with the first loaded launcher selected', () => {
    const st = worldStats(mkWorld(), data);
    const b = newBattle(mkWorld(), data);
    expect(b.player).toMatchObject({ shields: st.shields, armor: st.armor, disabled: false });
    expect(b.secondary).toBeNull();
    const w = mkWorld({ outfits: { 'light-blaster': 1, 'rocket-rack': 1, rocket: 3, 'seeker-launcher': 1 } });
    expect(newBattle(w, data).secondary).toBe('rocket-rack');
  });
  it('playerTargetId reads the traffic target', () => {
    expect(playerTargetId({ ...mkTraffic([]), targetId: 'x' })).toBe('x');
  });
});

describe('player fire', () => {
  it('primary fires every gun on cooldown', () => {
    const w = mkWorld({ outfits: { 'light-blaster': 2, 'rapid-cannon': 1 } });
    let s = tick(begin(w, mkTraffic([])), FIRE);
    expect(s.b.projectiles).toHaveLength(3);
    expect(s.events.filter((e) => e.type === 'shot')).toHaveLength(2);
    // The two blasters leave from points either side of the nose.
    const ys = s.b.projectiles.filter((p) => p.damage === 6).map((p) => p.pos.y);
    expect(Math.abs(ys[0] - ys[1])).toBeGreaterThan(1);
    s = tick(s, FIRE);
    expect(s.b.projectiles.length).toBe(3); // all on cooldown, none of the new bolts yet
    s = tick(s, FIRE, 20); // 0.33 s: the cannon (10/s) has fired again, the blaster (4/s) once at most
    expect(s.b.projectiles.length).toBeGreaterThan(3);
  });
  it('secondary spends ammo and stops at 0', () => {
    const w = mkWorld({ outfits: { 'light-blaster': 1, 'rocket-rack': 1, rocket: 2 } });
    let s = begin(w, mkTraffic([]));
    expect(s.b.secondary).toBe('rocket-rack');
    s = tick(s, frame(['fireSecondary']), 130); // 2+ s: rate 1/s
    expect(s.w.outfits.rocket).toBeUndefined();
    expect('rocket' in s.w.outfits).toBe(false);
    expect(s.b.projectiles.filter((p) => p.kind === 'rocket').length).toBeLessThanOrEqual(2);
    expect(s.events.filter((e) => e.type === 'shot' && e.kind === 'rocket')).toHaveLength(2);
    s = tick(s, frame(['fireSecondary']), 130);
    expect(s.events.filter((e) => e.type === 'shot' && e.kind === 'rocket')).toHaveLength(2);
  });
  it('cycleSecondary skips empty launchers', () => {
    const w = mkWorld({ outfits: { 'rocket-rack': 1, rocket: 2, 'seeker-launcher': 1, seeker: 0 } });
    const b = newBattle(w, data);
    expect(b.secondary).toBe('rocket-rack');
    expect(cycleSecondary(b, w, data).secondary).toBe('rocket-rack');
    const w2 = mkWorld({ outfits: { 'rocket-rack': 1, rocket: 2, 'seeker-launcher': 1, seeker: 4 } });
    const b2 = newBattle(w2, data);
    expect(cycleSecondary(b2, w2, data).secondary).toBe('seeker-launcher');
    expect(cycleSecondary(cycleSecondary(b2, w2, data), w2, data).secondary).toBe('rocket-rack');
    expect(cycleSecondary(b2, mkWorld({ outfits: { 'light-blaster': 1 } }), data).secondary).toBeNull();
  });
  it('the cycleSecondary action cycles during a step', () => {
    const w = mkWorld({ outfits: { 'rocket-rack': 1, rocket: 2, 'seeker-launcher': 1, seeker: 4 } });
    const s = tick(begin(w, mkTraffic([])), frame([], ['cycleSecondary' as ActionId]));
    expect(s.b.secondary).toBe('seeker-launcher');
  });
  it('disabled player cannot fire; neither can a jumping one', () => {
    const w = mkWorld();
    const s0 = begin(w, mkTraffic([]));
    const dis = tick({ ...s0, b: { ...s0.b, player: { ...s0.b.player, disabled: true, armor: 1 } } }, FIRE, 5);
    expect(dis.b.projectiles).toHaveLength(0);
    const jumping = tick(begin({ ...w, jump: { toSystemId: 'x', t: 0 } }, mkTraffic([])), FIRE, 5);
    expect(jumping.b.projectiles).toHaveLength(0);
  });
  it('a lance beam traces instantly and hurts what it hits', () => {
    const w = mkWorld({ outfits: { 'lance-beam': 1 } });
    const s = tick(begin(w, mkTraffic([mkNpc('t1', 'concord', 100, 0)])), FIRE);
    expect(s.b.beams).toHaveLength(1);
    expect(s.b.beams[0].hitId).toBe('t1');
    expect(npc(s, 't1').hull.shields).toBeCloseTo(60 - 30 * DT, 5);
  });
});

describe('kills', () => {
  const raiderTraffic = (hull = hullAt(5)) => mkTraffic([mkNpc('r1', 'raiders', 120, 0, { hull })], 'r1');
  it('player bolt disables a raider and counts one kill', () => {
    const s = tick(begin(mkWorld(), raiderTraffic()), FIRE, 14);
    expect(npc(s, 'r1').hull.disabled).toBe(true);
    expect(npc(s, 'r1').killCounted).toBe(true);
    expect(s.w.stats.kills).toBe(1);
    expect(s.events.find((e) => e.type === 'disabled')).toEqual({ type: 'disabled', id: 'r1', byPlayer: true });
  });
  it('destroying a disabled raider does not count again', () => {
    let s = tick(begin(mkWorld(), raiderTraffic()), FIRE, 14);
    expect(s.w.stats.kills).toBe(1);
    s = tick(s, FIRE, 300);
    expect(count(s, 'destroyed')).toBe(1);
    expect(s.t.npcs.find((n) => n.id === 'r1')).toBeUndefined();
    expect(s.t.targetId).toBeNull();
    expect(s.w.stats.kills).toBe(1);
  });
  it('raiders cost no standing', () => {
    const s = tick(begin(mkWorld(), raiderTraffic()), FIRE, 400);
    expect(s.w.standing).toEqual({});
    expect(s.b.angry).toEqual([]);
    expect(count(s, 'angered')).toBe(0);
  });
});

describe('standing', () => {
  const trader = () => mkTraffic([mkNpc('c1', 'concord', 120, 0)], 'c1');
  it('hitting a Concord trader angers the Concord once per visit and drops standing one level', () => {
    const w = mkWorld({ standing: { concord: 'friend' } });
    let s = tick(begin(w, trader()), FIRE, 30);
    expect(count(s, 'hit')).toBeGreaterThan(1);
    expect(s.b.angry).toEqual(['concord']);
    expect(s.w.standing.concord).toBe('neutral');
    expect(s.events.filter((e) => e.type === 'angered')).toEqual([{ type: 'angered', government: 'concord' }]);
    expect(npc(s, 'c1').aggro).toContain(PLAYER_ID);
    s = tick(s, FIRE, 60);
    expect(count(s, 'angered')).toBe(1);
    expect(s.w.standing.concord).toBe('neutral');
  });
  it('standing floors at cool', () => {
    const w = mkWorld({ standing: { concord: 'cool' } });
    const s = tick(begin(w, trader()), FIRE, 30);
    expect(s.w.standing.concord).toBe('cool');
  });
  it('an absent standing counts as neutral', () => {
    const s = tick(begin(mkWorld(), trader()), FIRE, 30);
    expect(s.w.standing.concord).toBe('cool');
  });
  it('disabling a patrol sets standing cool', () => {
    const w = mkWorld({ standing: { concord: 'friend' } });
    const t = mkTraffic([mkNpc('p1', 'concord', 120, 0, { role: 'patrol', hull: hullAt(5) })], 'p1');
    const s = tick(begin(w, t), FIRE, 14);
    expect(npc(s, 'p1').hull.disabled).toBe(true);
    expect(s.w.standing.concord).toBe('cool');
  });
});

describe('npc fire and the player hull', () => {
  const raider = (over: Partial<Npc> = {}) =>
    mkNpc('r1', 'raiders', 300, 0, { peaceful: false, outfits: { 'light-blaster': 2 }, ship: { pos: { x: 300, y: 0 }, vel: { x: 0, y: 0 }, heading: Math.PI, fuel: 0 }, ...over });
  it('NPC fire damages the player; playerDisabled then playerDestroyed', () => {
    const s0 = begin(mkWorld(), mkTraffic([raider()]));
    let s = { ...s0, b: { ...s0.b, player: { ...s0.b.player, shields: 0, armor: 12, maxArmor: 40 } } };
    s = tick(s, IDLE, 240);
    expect(count(s, 'playerDisabled')).toBe(1);
    expect(s.b.player.disabled).toBe(true);
    expect(count(s, 'lowArmor')).toBe(1);
    // The raider keeps shooting the disabled hull until it is destroyed, and that is announced once.
    s = tick(s, IDLE, 600);
    expect(count(s, 'playerDestroyed')).toBe(1);
    expect(s.b.playerDestroyed).toBe(true);
    expect(s.b.player.armor).toBe(0);
  });
  it('a hostile NPC engages and fires', () => {
    const s = tick(begin(mkWorld(), mkTraffic([raider()])), IDLE, 30);
    expect(npc(s, 'r1').engaged).toBe(true);
    expect(s.events.some((e) => e.type === 'shot' && e.ownerId === 'r1')).toBe(true);
  });
  it('a 4/s gun fires exactly 40 shots in 10 s', () => {
    const s = tick(begin(mkWorld(), mkTraffic([])), FIRE, 600);
    expect(s.events.filter((e) => e.type === 'shot')).toHaveLength(40);
  });
  it('a hit on a raider waiting on its demand ends the demand, and it fights back', () => {
    const waiting = raider({ demand: true, ship: { pos: { x: 120, y: 0 }, vel: { x: 0, y: 0 }, heading: Math.PI, fuel: 0 } });
    let s = tick(begin(mkWorld(), mkTraffic([waiting], 'r1')), IDLE, 30);
    expect(s.events.some((e) => e.type === 'shot' && e.ownerId === 'r1')).toBe(false); // silent while it waits
    s = tick(s, FIRE, 20);
    expect(count(s, 'hit')).toBeGreaterThan(0);
    expect(npc(s, 'r1')).toMatchObject({ demand: false, engaged: true });
    s = tick(s, IDLE, 60);
    expect(s.events.some((e) => e.type === 'shot' && e.ownerId === 'r1')).toBe(true);
  });
  it('a demanding raider is not picked by nearestHostile', () => {
    const w = mkWorld();
    const t = mkTraffic([mkNpc('r1', 'raiders', 100, 0, { peaceful: false, demand: true })]);
    expect(nearestHostile(w, t, newBattle(w, data))).toBeNull();
  });
  it('an NPC does not hit itself and projectiles never hit their owner', () => {
    const s = tick(begin(mkWorld(), mkTraffic([mkNpc('t1', 'concord', 500, 500)])), IDLE);
    const owned = { ...s, b: { ...s.b, projectiles: [bolt({ ownerId: 't1', pos: { x: 500, y: 500 } })] } };
    const after = tick(owned, IDLE);
    expect(npc(after, 't1').hull.shields).toBe(60);
  });
  it('a hurt trader flees: errand pass, no port, fled once', () => {
    const t = mkNpc('t1', 'concord', 300, 0, { errand: 'arrive', portId: 'x', aggro: ['r9'], hull: hullAt(10), peaceful: false });
    const r9 = mkNpc('r9', 'raiders', 350, 0, { peaceful: false });
    let s = tick(begin(mkWorld(), mkTraffic([t, r9])), IDLE, 5);
    expect(npc(s, 't1')).toMatchObject({ engaged: false, errand: 'pass', portId: null });
    expect(count(s, 'fled')).toBe(1);
    s = tick(s, IDLE, 5);
    expect(count(s, 'fled')).toBe(1);
  });
  it('ships in the jumpOut phase are never damaged', () => {
    const t = mkNpc('t1', 'concord', 100, 0, { phase: 'jumpOut' });
    const s = tick(begin(mkWorld(), mkTraffic([t])), FIRE, 30);
    expect(npc(s, 't1').hull.shields).toBe(60);
    expect(count(s, 'hit')).toBe(0);
  });
  it('a disabled NPC drifts to rest', () => {
    const t = mkNpc('t1', 'concord', 1000, 1000, { hull: { ...hullAt(1), disabled: true }, ship: { pos: { x: 1000, y: 1000 }, vel: { x: 100, y: 0 }, heading: 0, fuel: 0 } });
    const s = tick(begin(mkWorld(), mkTraffic([t])), IDLE, 60);
    expect(npc(s, 't1').ship.pos.x).toBeGreaterThan(1000);
    expect(npc(s, 't1').ship.vel.x).toBeLessThan(100);
  });
});

describe('nearestHostile', () => {
  it('picks the closest hostile only', () => {
    const w = mkWorld();
    const t = mkTraffic([
      mkNpc('c1', 'concord', 50, 0), // closer, not hostile
      mkNpc('r2', 'raiders', 800, 0, { peaceful: false }),
      mkNpc('r1', 'raiders', 400, 0, { peaceful: false }),
      mkNpc('r3', 'raiders', 100, 0, { peaceful: true }), // stood down
      mkNpc('r4', 'raiders', 60, 0, { peaceful: false, phase: 'land' }), // not targetable
    ]);
    const b = newBattle(w, data);
    expect(nearestHostile(w, t, b)).toBe('r1');
    expect(nearestHostile(w, mkTraffic([mkNpc('c1', 'concord', 50, 0)]), b)).toBeNull();
    expect(nearestHostile(w, mkTraffic([mkNpc('p1', 'concord', 50, 0, { role: 'patrol', peaceful: false })]), { ...b, angry: ['concord'] })).toBe('p1');
  });
});

describe('determinism', () => {
  it('stepBattle is deterministic', () => {
    const run = () => {
      const w = mkWorld({ outfits: { 'light-blaster': 1, 'rapid-cannon': 1, 'rocket-rack': 1, rocket: 5 } });
      const t = mkTraffic([
        mkNpc('r1', 'raiders', 300, 100, { peaceful: false, outfits: { 'rapid-cannon': 1 } }),
        mkNpc('c1', 'concord', -200, 50, { aggro: ['r1'], outfits: { 'light-blaster': 1 } }),
      ], 'r1');
      return tick(begin(w, t), frame(['firePrimary', 'fireSecondary']), 600);
    };
    expect(run()).toEqual(run());
  });
});
