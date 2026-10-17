import { describe, expect, it } from 'vitest';
import { testData } from '../data/testData';
import { resetBindings } from '../input/bindings';
import type { WorldState } from '../sim/types';
import { newWorld } from '../sim/world';
import type { Progress } from './progress';
import { STEPS, type GuideState, type TextCtx } from './steps';

const data = testData();
const t = { good: 'food', system: 'tessaly', port: 'vanterre' };
const p: Progress = { step: 1, done: false, target: t, startCredits: 10000 };
const base = newWorld(data, 1);
const st = (over: Partial<GuideState> & { w?: Partial<WorldState> } = {}): GuideState => ({
  screen: 'planet',
  world: { ...base, ...over.w },
  landedPlanetId: 'halcyon',
  ...over,
});
const done = (i: number, s: GuideState): boolean => STEPS[i - 1].done(s, t, p);

describe('step completion predicates', () => {
  it('has 11 steps', () => expect(STEPS).toHaveLength(11));

  it('1 exchange opened', () => {
    expect(done(1, st({ screen: 'exchange' }))).toBe(true);
    expect(done(1, st())).toBe(false);
  });
  it('2 holds >= 10 t', () => {
    expect(done(2, st({ w: { cargo: { food: 10 } } }))).toBe(true);
    expect(done(2, st({ w: { cargo: { food: 9 } } }))).toBe(false);
    expect(done(2, st({ w: { cargo: { metal: 50 } } }))).toBe(false);
  });
  it('3 mission computer opened', () => {
    expect(done(3, st({ screen: 'missions' }))).toBe(true);
    expect(done(3, st({ screen: 'exchange' }))).toBe(false);
  });
  it('4 mission computer closed', () => {
    expect(done(4, st({ screen: 'planet' }))).toBe(true);
    expect(done(4, st({ screen: 'missions' }))).toBe(false);
  });
  it('5 in flight', () => {
    expect(done(5, st({ screen: 'flight' }))).toBe(true);
    expect(done(5, st())).toBe(false);
  });
  it('6 moved >= 300 px from the start position', () => {
    const at = (x: number, startPos?: { x: number; y: number }): GuideState =>
      st({ screen: 'flight', startPos, w: { ship: { ...base.ship, pos: { x, y: 0 } } } });
    expect(done(6, at(300, { x: 0, y: 0 }))).toBe(true);
    expect(done(6, at(299, { x: 0, y: 0 }))).toBe(false);
    expect(done(6, at(1000))).toBe(false);
    expect(done(6, { ...at(1000, { x: 0, y: 0 }), screen: 'planet' })).toBe(false);
  });
  it('7 route ends in the target system', () => {
    expect(done(7, st({ w: { route: ['x', 'tessaly'] } }))).toBe(true);
    expect(done(7, st({ w: { route: ['tessaly', 'x'] } }))).toBe(false);
    expect(done(7, st({ w: { route: [] } }))).toBe(false);
    expect(done(7, st({ w: { systemId: 'tessaly', route: [] } }))).toBe(true);
  });
  it('8 arrived in the target system', () => {
    expect(done(8, st({ w: { systemId: 'tessaly' } }))).toBe(true);
    expect(done(8, st({ w: { systemId: 'aurelle' } }))).toBe(false);
    expect(done(8, st({ w: { systemId: 'tessaly', jump: { toSystemId: 'calder', t: 0.1 } } }))).toBe(false);
  });
  it('9 landed at the port', () => {
    expect(done(9, st({ landedPlanetId: 'vanterre' }))).toBe(true);
    expect(done(9, st({ landedPlanetId: 'pell' }))).toBe(false);
    expect(done(9, st({ landedPlanetId: null }))).toBe(false);
  });
  it('10 hold has none of the good', () => {
    expect(done(10, st({ w: { cargo: {} } }))).toBe(true);
    expect(done(10, st({ w: { cargo: { food: 0 } } }))).toBe(true);
    expect(done(10, st({ w: { cargo: { food: 10 } } }))).toBe(false);
  });
  it('11 only ends when dismissed', () => {
    expect(done(11, st({ screen: 'exchange' }))).toBe(false);
  });
});

describe('step text', () => {
  const ctx = (over: Partial<TextCtx> = {}): TextCtx => {
    const b = resetBindings();
    return { target: t, mode: 'keyboard', key: (a) => b[a][0] ?? '?', data, ...over };
  };
  it('names the good, system and port from data', () => {
    expect(STEPS[1].text(ctx())).toContain('Food');
    expect(STEPS[6].text(ctx())).toContain('Tessaly');
    expect(STEPS[8].text(ctx())).toContain('Vanterre');
  });
  it('uses the supplied key labels', () => {
    expect(STEPS[1].text(ctx({ key: (a) => (a === 'buyGoods' ? 'Q' : '?') }))).toContain('(Q)');
  });
  it('switches to phone wording', () => {
    const c = ctx({ mode: 'touch' });
    expect(STEPS[5].text(c)).toBe('Push the stick to fly, STOP to brake.');
    expect(STEPS[6].text(c)).toContain('Tap the radar or PLOT COURSE');
    expect(STEPS[7].text(c)).toContain('bottom button');
    expect(STEPS[8].text(c)).toBe('Tap Vanterre to land.');
    for (const s of STEPS) expect(s.text(c)).not.toMatch(/\(\S{1,6}\)/);
  });
  it('reports profit, or a neutral line when not positive', () => {
    expect(STEPS[10].text(ctx({ profit: 1234 }))).toContain('Nice trade! You made 1,234 cr.');
    expect(STEPS[10].text(ctx({ profit: 0 }))).toContain("You're set up to trade.");
    expect(STEPS[10].text(ctx({ profit: -50 }))).toContain("You're set up to trade.");
    expect(STEPS[10].text(ctx({ profit: -50 }))).not.toContain('Nice trade');
  });
});
