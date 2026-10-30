import { describe, expect, it } from 'vitest';
import { testData } from '../data/testData';
import { decide, isHostileTo, type AiSelf, type NpcRole } from './ai';
import { fullHull, PLAYER_ID, type Combatant } from './combat';

const data = testData();
const deg = (d: number) => (d * Math.PI) / 180;
const comb = (id: string, government: string, x: number, y: number, heading = 0, outfits: Record<string, number> = {}): Combatant => ({
  id, government, radius: 10, outfits, hull: fullHull(10, 100),
  ship: { pos: { x, y }, vel: { x: 0, y: 0 }, heading, fuel: 0 },
});
const GUN = { 'light-blaster': 1 };
const selfOf = (role: NpcRole, me: Combatant, over: Partial<AiSelf> = {}): AiSelf =>
  ({ role, me, peaceful: false, aggro: [], maxSpeed: 200, fireRange: 450, ...over });
const FLEE_TO = { x: -5000, y: 0 };
const run = (s: AiSelf, others: Combatant[], angry: string[] = []) => decide(s, others, angry, FLEE_TO, data);
const player = (x: number, y: number) => comb(PLAYER_ID, '', x, y);

describe('npc ai', () => {
  it('raider attacks the player in range', () => {
    const d = run(selfOf('raider', comb('r1', 'raiders', 0, 0, 0, GUN)), [player(500, 0)]);
    expect(d.mode).toBe('attack');
    expect(d.targetId).toBe(PLAYER_ID);
    expect(d.input.thrust).toBe(true);
  });
  it('ignores targets beyond engage range', () => {
    expect(run(selfOf('raider', comb('r1', 'raiders', 0, 0, 0, GUN)), [player(1200, 0)]).mode).toBe('errand');
  });
  it('raider ignores other raiders', () => {
    const d = run(selfOf('raider', comb('r1', 'raiders', 0, 0, 0, GUN)), [comb('r2', 'raiders', 300, 0)]);
    expect(d.mode).toBe('errand');
  });
  it('peaceful raider does not attack', () => {
    const d = run(selfOf('raider', comb('r1', 'raiders', 0, 0, 0, GUN), { peaceful: true }), [player(300, 0)]);
    expect(d.mode).toBe('errand');
  });
  it('patrol attacks raiders, not the player unless angry', () => {
    const me = comb('p1', 'concord', 0, 0, 0, GUN);
    const s = selfOf('patrol', me);
    expect(run(s, [comb('r1', 'raiders', 400, 0)]).targetId).toBe('r1');
    expect(run(s, [player(400, 0)]).mode).toBe('errand');
    expect(run(s, [player(400, 0)], ['concord']).targetId).toBe(PLAYER_ID);
    expect(isHostileTo(s, player(400, 0), ['free-reach'])).toBe(false);
  });
  it('trader stays on errand until hit, then flees if unarmed', () => {
    const me = comb('t1', 'concord', 0, 0);
    expect(run(selfOf('trader', me), [comb('r1', 'raiders', 300, 0)]).mode).toBe('errand');
    const d = run(selfOf('trader', me, { aggro: ['r1'] }), [comb('r1', 'raiders', 300, 0)]);
    expect(d.mode).toBe('flee');
    expect(d.fleeTo).toEqual(FLEE_TO);
  });
  it('armed trader fires back at its attacker', () => {
    const me = comb('t1', 'concord', 0, 0, 0, GUN);
    const d = run(selfOf('trader', me, { aggro: ['r1'] }), [comb('r1', 'raiders', 300, 0)]);
    expect(d.mode).toBe('attack');
    expect(d.targetId).toBe('r1');
    expect(d.fire).toBe(true);
  });
  it('flees below 30% armor, but a patrol never does', () => {
    const hurt = (c: Combatant): Combatant => ({ ...c, hull: { ...c.hull, armor: 29 } });
    const foe = [player(300, 0)];
    expect(run(selfOf('raider', hurt(comb('r1', 'raiders', 0, 0, 0, GUN))), foe).mode).toBe('flee');
    expect(run(selfOf('patrol', hurt(comb('p1', 'concord', 0, 0, 0, GUN))), [comb('r2', 'raiders', 300, 0)]).mode).toBe('attack');
    const ok = { ...comb('r1', 'raiders', 0, 0, 0, GUN) };
    ok.hull = { ...ok.hull, armor: 31 };
    expect(run(selfOf('raider', ok), foe).mode).toBe('attack');
  });
  it('fires only when lined up and in range', () => {
    const me = (h: number) => selfOf('raider', comb('r1', 'raiders', 0, 0, h, GUN));
    expect(run(me(0), [player(400, 0)]).fire).toBe(true);
    expect(run(me(deg(30)), [player(400, 0)]).fire).toBe(false);
    expect(run(me(0), [player(600, 0)]).fire).toBe(false);
  });
  it('fires while holding inside keepRange', () => {
    const d = run(selfOf('raider', comb('r1', 'raiders', 0, 0, 0, GUN)), [player(150, 0)]);
    expect(d.mode).toBe('attack');
    expect(d.fire).toBe(true);
    expect(d.input.thrust).toBe(false);
  });
  it('turns away and thrusts when closer than half keepRange', () => {
    const d = run(selfOf('raider', comb('r1', 'raiders', 0, 0, 0, GUN)), [player(80, 0)]);
    expect(d.input.thrust).toBe(true);
    expect(Math.abs(Math.abs(d.input.targetHeading!) - deg(60))).toBeLessThan(1e-9);
  });
  it('an unarmed raider never fires', () => {
    const d = run(selfOf('raider', comb('r1', 'raiders', 0, 0, 0)), [player(400, 0)]);
    expect(d.mode).toBe('attack');
    expect(d.fire).toBe(false);
  });
  it('skips disabled ships and picks the nearest foe', () => {
    const dead = { ...player(100, 0), hull: { ...fullHull(0, 100), disabled: true } };
    const me = selfOf('raider', comb('r1', 'raiders', 0, 0, 0, GUN));
    expect(run(me, [dead]).mode).toBe('errand');
    expect(run(me, [player(700, 0), comb('t', 'concord', 0, 300)]).targetId).toBe('t');
  });
  it('reads its ranges from data', () => {
    const tweaked = { ...data, combat: { ...data.combat, ai: { ...data.combat.ai, raider: { ...data.combat.ai.raider, engageRange: 100 } } } };
    const s = selfOf('raider', comb('r1', 'raiders', 0, 0, 0, GUN));
    expect(decide(s, [player(500, 0)], [], FLEE_TO, tweaked).mode).toBe('errand');
  });
});
