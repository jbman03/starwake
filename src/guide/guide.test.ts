import { describe, expect, it, vi } from 'vitest';
import { testData } from '../data/testData';
import { resetBindings, type Bindings } from '../input/bindings';
import type { WorldState } from '../sim/types';
import { newWorld } from '../sim/world';
import { Guide, type GuideHost } from './guide';
import type { GuideState } from './steps';
import { pickTarget } from './target';

const data = testData();

function memory(): Storage {
  const m = new Map<string, string>();
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k),
  } as Storage;
}
const label = (b: Bindings, a: keyof Bindings): string => (b[a][0] ?? '?').replace(/^Key/, '');

function setup(storage: Storage = memory(), mode: 'keyboard' | 'touch' = 'keyboard', bindings = resetBindings()) {
  const host: GuideHost = { world: newWorld(data, 1), landedPlanetId: 'halcyon', pilot: { id: 'p1' } };
  const make = () =>
    new Guide(host, data, { mode: () => mode, key: (a) => label(bindings, a), storage });
  return { host, make, guide: make() };
}
const state = (w: WorldState, screen: GuideState['screen'], landed: string | null = null): GuideState => ({
  screen,
  world: w,
  landedPlanetId: landed,
});
const found = pickTarget(newWorld(data, 1), data, 'halcyon');
if (!found) throw new Error('fixture: no target');
const target = found;
const moved = (w: WorldState, x: number): WorldState => ({ ...w, ship: { ...w.ship, pos: { x, y: 0 } } });

describe('Guide', () => {
  it('starts at step 1 with a chosen target and the right wording', () => {
    const { guide } = setup();
    expect(guide.start()).toBe(true);
    const c = guide.current();
    expect(c).toMatchObject({ step: 1, total: 11 });
    expect(c?.text).toContain('Commodity Exchange (C)');
    expect(guide.target()).toEqual(target);
  });

  it('walks the whole loop and reports profit', () => {
    const { guide, host } = setup();
    guide.start();
    let w: WorldState = host.world;
    guide.update(state(w, 'exchange', 'halcyon'));
    expect(guide.current()?.step).toBe(2);
    w = { ...w, cargo: { [target.good]: 10 }, credits: w.credits - 500 };
    guide.update(state(w, 'exchange', 'halcyon'));
    expect(guide.current()?.step).toBe(3);
    guide.update(state(w, 'missions', 'halcyon'));
    expect(guide.current()?.step).toBe(4);
    guide.update(state(w, 'planet', 'halcyon'));
    expect(guide.current()?.step).toBe(5);
    guide.update(state(w, 'flight'));
    expect(guide.current()?.step).toBe(6);
    guide.update(state(moved(w, 301), 'flight'));
    expect(guide.current()?.step).toBe(7);
    w = { ...w, route: [target.system] };
    guide.update(state(w, 'flight'));
    expect(guide.current()?.step).toBe(8);
    w = { ...w, route: [], systemId: target.system };
    guide.update(state(w, 'flight'));
    expect(guide.current()?.step).toBe(9);
    guide.update(state(w, 'planet', target.port));
    expect(guide.current()?.step).toBe(10);
    w = { ...w, cargo: {}, credits: w.credits + 700 };
    guide.update(state(w, 'exchange', target.port));
    expect(guide.current()?.step).toBe(11);
    expect(guide.current()?.text).toContain('Nice trade! You made 200 cr.');
  });

  it('records the start position the first time step 6 sees flight', () => {
    const { guide, host } = setup();
    guide.start();
    const w = { ...host.world, cargo: { [target.good]: 10 } };
    guide.update(state(w, 'exchange', 'halcyon'));
    guide.update(state(w, 'missions', 'halcyon'));
    guide.update(state(w, 'planet', 'halcyon'));
    guide.update(state(moved(w, 1000), 'flight'));
    expect(guide.current()?.step).toBe(6); // 1000 is where it started, not a distance
    guide.update(state(moved(w, 1299), 'flight'));
    expect(guide.current()?.step).toBe(6);
    guide.update(state(moved(w, 1300), 'flight'));
    expect(guide.current()?.step).toBe(7);
  });

  it('resumes at the same step after a reload', () => {
    const { guide, make, host } = setup();
    guide.start();
    const w = { ...host.world, cargo: { [target.good]: 10 } };
    guide.update(state(w, 'exchange', 'halcyon'));
    guide.update(state(w, 'missions', 'halcyon'));
    expect(guide.current()?.step).toBe(4);
    const again = make();
    expect(again.resumable()).toBe(true);
    expect(again.start()).toBe(true);
    expect(again.current()?.step).toBe(4);
    expect(again.target()).toEqual(target);
  });

  it('keeps the start position across a reload', () => {
    const { guide, make, host } = setup();
    guide.start();
    const w = { ...host.world, cargo: { [target.good]: 10 } };
    for (const s of ['exchange', 'missions', 'planet'] as const) guide.update(state(w, s, 'halcyon'));
    guide.update(state(w, 'flight'));
    const again = make();
    again.start();
    again.update(state(moved(w, 400), 'flight'));
    expect(again.current()?.step).toBe(7);
  });

  it('sold early: step 10 completes as soon as it is reached', () => {
    const { guide, host } = setup();
    guide.start();
    let w = { ...host.world, cargo: { [target.good]: 10 } };
    guide.update(state(w, 'exchange', 'halcyon'));
    expect(guide.current()?.step).toBe(3);
    w = { ...w, cargo: {} }; // sold before the mission steps
    guide.update(state(w, 'missions', 'halcyon'));
    guide.update(state(w, 'planet', 'halcyon'));
    guide.update(state(w, 'flight'));
    guide.update(state(moved(w, 500), 'flight'));
    guide.update(state({ ...w, systemId: target.system }, 'flight'));
    expect(guide.current()?.step).toBe(9);
    guide.update(state({ ...w, systemId: target.system }, 'planet', target.port));
    expect(guide.current()?.step).toBe(11);
  });

  it('jumping to a different system leaves step 8 waiting', () => {
    const { guide, host } = setup();
    guide.start();
    const w = { ...host.world, cargo: { [target.good]: 10 } };
    for (const s of ['exchange', 'missions', 'planet'] as const) guide.update(state(w, s, 'halcyon'));
    guide.update(state(w, 'flight'));
    guide.update(state(moved(w, 400), 'flight'));
    guide.update(state({ ...moved(w, 400), route: [target.system] }, 'flight'));
    expect(guide.current()?.step).toBe(8);
    const elsewhere = target.system === 'aurelle' ? 'quillon' : 'aurelle';
    guide.update(state({ ...moved(w, 400), route: [], systemId: elsewhere }, 'flight'));
    expect(guide.current()?.step).toBe(8);
    expect(guide.current()?.text).toContain(data.systems[target.system].name);
  });

  it('mission steps are optional: leaving at step 3 flows on to step 6 in flight', () => {
    const { guide, host } = setup();
    guide.start();
    const w = { ...host.world, cargo: { [target.good]: 10 } };
    guide.update(state(w, 'exchange', 'halcyon'));
    guide.update(state(w, 'planet', 'halcyon'));
    expect(guide.current()?.step).toBe(3); // Halcyon has a Mission Computer: still suggested
    guide.update(state(w, 'flight'));
    expect(guide.current()?.step).toBe(6);
    guide.update(state(moved(w, 400), 'flight'));
    expect(guide.current()?.step).toBe(7);
  });

  it('replay at a port without a Mission Computer (Merrow) skips steps 3 and 4', () => {
    const { host, make } = setup();
    host.landedPlanetId = 'merrow';
    const g = make();
    expect(g.start()).toBe(true);
    expect(g.current()?.step).toBe(1);
    const good = g.target()!.good;
    g.update(state(host.world, 'exchange', 'merrow'));
    expect(g.current()?.step).toBe(2);
    g.update(state({ ...host.world, cargo: { [good]: 10 } }, 'exchange', 'merrow'));
    expect(g.current()?.step).toBe(5);
    expect(g.current()?.text).toBe('Leave the planet (L).');
  });

  it('skip marks it done, persists, and hides the hint', () => {
    const { guide, make } = setup();
    guide.start();
    const fn = vi.fn();
    guide.on('change', fn);
    guide.skip();
    expect(guide.current()).toBeNull();
    expect(fn).toHaveBeenCalledTimes(1);
    const again = make();
    expect(again.resumable()).toBe(false);
    again.update(state(newWorld(data, 1), 'exchange', 'halcyon'));
    expect(again.current()).toBeNull();
  });

  it('start() after a finished guide begins afresh', () => {
    const { guide } = setup();
    guide.start();
    guide.skip();
    expect(guide.start()).toBe(true);
    expect(guide.current()?.step).toBe(1);
  });

  it('restart() discards progress', () => {
    const { guide, host } = setup();
    guide.start();
    guide.update(state(host.world, 'exchange', 'halcyon'));
    expect(guide.current()?.step).toBe(2);
    expect(guide.restart()).toBe(true);
    expect(guide.current()?.step).toBe(1);
  });

  it('change fires on step advance and can be unsubscribed', () => {
    const { guide, host } = setup();
    guide.start();
    const fn = vi.fn();
    const off = guide.on('change', fn);
    guide.update(state(host.world, 'exchange', 'halcyon'));
    expect(fn).toHaveBeenCalledTimes(1);
    guide.update(state(host.world, 'exchange', 'halcyon')); // nothing new
    expect(fn).toHaveBeenCalledTimes(1);
    off();
    guide.update(state({ ...host.world, cargo: { [target.good]: 10 } }, 'exchange', 'halcyon'));
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('text follows bindings and mode', () => {
    const b = resetBindings();
    b.openExchange = ['KeyQ', null];
    const rebound = setup(memory(), 'keyboard', b);
    rebound.guide.start();
    expect(rebound.guide.current()?.text).toContain('(Q)');
    const touch = setup(memory(), 'touch');
    touch.guide.start();
    expect(touch.guide.current()?.text).not.toContain('(C)');
  });

  it('works when storage throws', () => {
    const fail = (): never => {
      throw new Error('x');
    };
    const bad = { getItem: fail, setItem: fail, removeItem: fail } as unknown as Storage;
    const { guide, host } = setup(bad);
    expect(guide.start()).toBe(true);
    guide.update(state(host.world, 'exchange', 'halcyon'));
    expect(guide.current()?.step).toBe(2);
    guide.skip();
    expect(guide.current()).toBeNull();
  });

  it('freezes the final profit and says so neutrally when there is none', () => {
    const { guide, host } = setup();
    guide.start();
    const w = { ...host.world, cargo: { [target.good]: 10 } };
    for (const s of ['exchange', 'missions', 'planet'] as const) guide.update(state(w, s, 'halcyon'));
    guide.update(state(w, 'flight'));
    guide.update(state(moved(w, 500), 'flight'));
    guide.update(state({ ...w, route: [target.system] }, 'flight'));
    guide.update(state({ ...w, systemId: target.system }, 'flight'));
    guide.update(state({ ...w, systemId: target.system }, 'planet', target.port));
    guide.update(state({ ...w, systemId: target.system, cargo: {}, credits: w.credits - 40 }, 'exchange', target.port));
    expect(guide.current()?.step).toBe(11);
    expect(guide.current()?.text).toContain("You're set up to trade.");
    guide.update(state({ ...w, credits: w.credits + 9999, cargo: {} }, 'planet', target.port));
    expect(guide.current()?.text).toContain("You're set up to trade.");
  });

  it('clears a stale step-6 start when the player lands or jumps', () => {
    const { guide, host } = setup();
    guide.start();
    const w = { ...host.world, cargo: { [target.good]: 10 } };
    for (const s of ['exchange', 'missions', 'planet'] as const) guide.update(state(w, s, 'halcyon'));
    guide.update(state(moved(w, 0), 'flight')); // start recorded at x=0
    guide.update(state(w, 'planet', 'halcyon')); // landed again
    guide.update(state(moved(w, 900), 'flight')); // relaunched far away: new start
    expect(guide.current()?.step).toBe(6);
    guide.update(state({ ...moved(w, 900), systemId: 'aurelle' }, 'flight')); // jumped: new start again
    expect(guide.current()?.step).toBe(6);
    guide.update(state({ ...moved(w, 1300), systemId: 'aurelle' }, 'flight'));
    expect(guide.current()?.step).toBe(7);
  });

  describe('no trade at the current port', () => {
    it('starts at step 5 with the nearest port trade', () => {
      const { host, make } = setup();
      host.landedPlanetId = 'tollgate'; // no market
      host.world = { ...host.world, systemId: 'minster' };
      const g = make();
      expect(g.start()).toBe(true);
      expect(g.current()?.step).toBe(5);
      expect(g.target()).not.toBeNull();
    });
    it('fallback: step 10 is about checking prices, no silent completion, neutral ending', () => {
      const { host, make } = setup();
      host.landedPlanetId = 'tollgate';
      host.world = { ...host.world, systemId: 'minster' };
      const g = make();
      g.start();
      const tg = g.target();
      if (!tg) throw new Error('no target');
      const w = host.world;
      g.update(state(w, 'flight'));
      g.update(state(moved(w, 400), 'flight'));
      g.update(state({ ...moved(w, 400), route: [tg.system] }, 'flight'));
      g.update(state({ ...w, systemId: tg.system }, 'flight'));
      g.update(state({ ...w, systemId: tg.system }, 'planet', tg.port));
      expect(g.current()?.step).toBe(10); // empty hold must not auto-complete it
      expect(g.current()?.text).toContain('check the prices');
      g.update(state({ ...w, systemId: tg.system, credits: w.credits + 500 }, 'exchange', tg.port));
      expect(g.current()?.step).toBe(11);
      expect(g.current()?.text).toContain("You're set up to trade.");
    });
    it('returns false when no trade exists', () => {
      const { host, make } = setup();
      host.landedPlanetId = 'tollgate';
      host.world = { ...host.world, known: ['calder'] };
      expect(make().start()).toBe(false);
    });
    it('returns false with no pilot', () => {
      const { host, make } = setup();
      host.pilot = null;
      expect(make().start()).toBe(false);
    });
  });
});
