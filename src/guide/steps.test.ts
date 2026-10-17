import { describe, expect, it } from 'vitest';
import { testData } from '../data/testData';
import { resetBindings } from '../input/bindings';
import type { WorldState } from '../sim/types';
import { newWorld } from '../sim/world';
import type { Progress } from './progress';
import { STEPS, TOUCH_HINT_MAX_CHARS, type GuideState, type TextCtx } from './steps';

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
const done = (i: number, s: GuideState): boolean => STEPS[i - 1].done(s, t, p, data);

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
  it('3 mission computer opened, or skipped: in flight, or at a port without one', () => {
    expect(done(3, st({ screen: 'missions' }))).toBe(true);
    expect(done(3, st({ screen: 'exchange' }))).toBe(false);
    expect(done(3, st({ screen: 'planet' }))).toBe(false);
    expect(done(3, st({ screen: 'flight', landedPlanetId: null }))).toBe(true);
    expect(done(3, st({ screen: 'exchange', landedPlanetId: 'merrow' }))).toBe(true); // no missions service
    expect(done(3, st({ screen: 'planet', landedPlanetId: 'pell' }))).toBe(true);
  });
  it('4 mission computer closed', () => {
    expect(done(4, st({ screen: 'planet' }))).toBe(true);
    expect(done(4, st({ screen: 'flight', landedPlanetId: null }))).toBe(true);
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
    return {
      target: t,
      mode: 'keyboard',
      key: (a) => b[a][0] ?? '?',
      data,
      screen: 'planet',
      landedPlanetId: 'halcyon',
      buyPort: 'halcyon',
      routeOk: true,
      ...over,
    };
  };
  const flying = { screen: 'flight', landedPlanetId: null } as const;
  it('names the good, system and port from data', () => {
    expect(STEPS[1].text(ctx())).toContain('Food');
    expect(STEPS[6].text(ctx())).toContain('Tessaly');
    expect(STEPS[8].text(ctx())).toContain('Vanterre');
  });
  it('uses the supplied key labels', () => {
    expect(STEPS[1].text(ctx({ screen: 'exchange', key: (a) => (a === 'buyGoods' ? 'Q' : '?') }))).toContain('(Q)');
  });
  it('switches to phone wording', () => {
    const c = ctx({ mode: 'touch', ...flying });
    expect(STEPS[5].text(c)).toBe('Push the stick to fly, STOP to brake.');
    expect(STEPS[6].text(c)).toBe('Tap the radar. Set course to Tessaly.');
    expect(STEPS[7].text(c)).toBe('To Tessaly: fly clear, tap Jump. Repeat.');
    expect(STEPS[8].text(c)).toBe('Tap Vanterre to land.');
    for (const s of STEPS) expect(s.text(c)).not.toMatch(/\(\S{1,6}\)/);
  });
  it('every touch hint the rail can show fits its 3 lines, even with the longest names in the data', () => {
    const longest = (rec: Record<string, { id: string; name: string }>) =>
      Object.values(rec).reduce((a, b) => (b.name.length > a.name.length ? b : a));
    const good = longest(data.commodities);
    const system = longest(data.systems);
    const port = longest(data.planets);
    const target = { good: good.id, system: system.id, port: port.id };
    const screens = ['planet', 'exchange', 'missions', 'map', 'flight', 'other'] as const;
    for (const fallback of [false, true])
      for (const screen of screens)
        for (const landedPlanetId of [port.id, 'halcyon', null])
          for (const routeOk of [true, false]) {
            const c = ctx({ mode: 'touch', target, fallback, planetName: port.name, profit: 1_234_567, screen, landedPlanetId, routeOk, buyPort: port.id });
            for (const s of STEPS.slice(0, 10)) {
              const text = s.text(c);
              expect(text.length, `${s.id} (${screen}, ${landedPlanetId}): "${text}"`).toBeLessThanOrEqual(TOUCH_HINT_MAX_CHARS);
            }
          }
    // The key facts lead: the destination is in the step 7 and 8 rail text.
    const c = ctx({ mode: 'touch', target, ...flying });
    expect(STEPS[6].text(c)).toContain(system.name);
    expect(STEPS[7].text(c)).toContain(system.name);
    expect(STEPS[8].text(c)).toContain(port.name);
  });

  describe('follows the screen and route', () => {
    it('step 2 on the exchange: the good is cheap here, buy it', () => {
      expect(STEPS[1].text(ctx({ screen: 'exchange' }))).toBe('Food is cheap here. Buy 10 t (KeyB).');
      expect(STEPS[1].text(ctx({ screen: 'exchange', mode: 'touch' }))).toBe('Food is cheap here. Buy 10 t.');
    });
    it('step 2 off the exchange at the buy port: open the exchange first', () => {
      expect(STEPS[1].text(ctx())).toBe('Open the exchange (KeyC) and buy 10 t of Food.');
      expect(STEPS[1].text(ctx({ mode: 'touch' }))).toBe('Exchange: buy 10 t of Food.');
    });
    it('step 2 away from the buy port names it', () => {
      for (const where of [{ landedPlanetId: 'merrow' }, flying]) {
        expect(STEPS[1].text(ctx(where))).toBe('Open the exchange and buy 10 t of Food at Halcyon.');
        expect(STEPS[1].text(ctx({ mode: 'touch', ...where }))).toBe('Buy Food at Halcyon.');
      }
    });
    it('step 3 only says to close the exchange while it is open (on the planet Esc is Leave)', () => {
      expect(STEPS[2].text(ctx({ screen: 'exchange' }))).toBe('Close the exchange (Escape) and open the Mission Computer (KeyM).');
      expect(STEPS[2].text(ctx())).toBe('Open the Mission Computer (KeyM).');
      expect(STEPS[2].text(ctx({ screen: 'exchange', mode: 'touch' }))).toBe('Tap Done, then Mission Computer.');
      expect(STEPS[2].text(ctx({ mode: 'touch' }))).toBe('Tap Mission Computer.');
    });
    it('step 7 on a phone: Star Map button on the planet screen, the radar in flight', () => {
      expect(STEPS[6].text(ctx({ mode: 'touch' }))).toBe('Tap Star Map. Set course to Tessaly.');
      expect(STEPS[6].text(ctx({ mode: 'touch', ...flying }))).toBe('Tap the radar. Set course to Tessaly.');
    });
    it('step 8 without a course to the target shows the plotting text again', () => {
      for (const mode of ['keyboard', 'touch'] as const) {
        const off = ctx({ mode, ...flying, routeOk: false });
        expect(STEPS[7].text(off)).toBe(STEPS[6].text(off));
        expect(STEPS[7].text(ctx({ mode, ...flying }))).toMatch(/Jump/);
      }
    });
    it('trade wording never contradicts the live Low/Med/High', () => {
      const all = [
        STEPS[1].text(ctx({ screen: 'exchange' })),
        STEPS[1].text(ctx({ screen: 'exchange', mode: 'touch' })),
        STEPS[6].text(ctx(flying)),
        STEPS[9].text(ctx({ fallback: true })),
        STEPS[9].text(ctx({ fallback: true, mode: 'touch' })),
      ];
      for (const text of all) expect(text).not.toMatch(/\b(Low|High)\b/);
      expect(STEPS[6].text(ctx(flying))).toBe('Open the Star Map (KeyM) and set a course to Tessaly. Food pays well there.');
      expect(STEPS[9].text(ctx({ fallback: true }))).toContain('Food pays well here');
      expect(STEPS[9].text(ctx({ fallback: true, mode: 'touch' }))).toBe('Exchange: Food pays well.');
    });
  });

  it('reports profit, or a neutral line when not positive', () => {
    expect(STEPS[10].text(ctx({ profit: 1234 }))).toContain('Nice trade! You made 1,234 cr.');
    expect(STEPS[10].text(ctx({ profit: 0 }))).toContain("You're set up to trade.");
    expect(STEPS[10].text(ctx({ profit: -50 }))).toContain("You're set up to trade.");
    expect(STEPS[10].text(ctx({ profit: -50 }))).not.toContain('Nice trade');
  });
});
