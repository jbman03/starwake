import { describe, expect, it } from 'vitest';
import { testData, withoutPorts } from '../data/testData';
import { contextAction } from './context';
import type { WorldState } from './types';
import { autopilotToJumpPoint, newWorld, stepWorld } from './world';
import { jumpPoint } from './rules';
import { dist } from './vec';

const data = testData();
const at = (w: WorldState, pos: { x: number; y: number }, fuel = w.ship.fuel): WorldState => ({
  ...w,
  ship: { ...w.ship, pos, fuel },
});

describe('contextAction', () => {
  it('takeControl while autopilot is active (highest priority)', () => {
    const w: WorldState = { ...newWorld(data), assist: { kind: 'autopilot', dest: { type: 'jumpPoint' }, autoLand: false } };
    expect(contextAction(w, data)).toBe('takeControl');
  });

  it('tow when stranded', () => {
    const w = at({ ...newWorld(data), systemId: 'vesk' }, { x: -600, y: -700 }, 0);
    expect(contextAction(w, withoutPorts(data, 'vesk'))).toBe('tow');
  });

  it('land near halcyon', () => {
    expect(contextAction(newWorld(data), data)).toBe('land');
  });

  it('land at 600 px but not at 601 px', () => {
    const h = data.planets.halcyon;
    expect(contextAction(at(newWorld(data), { x: h.pos.x, y: h.pos.y - 600 }), data)).toBe('land');
    expect(contextAction(at(newWorld(data), { x: h.pos.x, y: h.pos.y - 601 }), data)).toBe('plotCourse');
    expect(contextAction(at({ ...newWorld(data), route: ['vesk'] }, { x: h.pos.x, y: h.pos.y - 601 }), data)).toBe('autopilotOut');
  });

  it('jump when outside the jump distance with fuel and a destination', () => {
    expect(contextAction(at({ ...newWorld(data), route: ['vesk'] }, { x: -2100, y: 0 }), data)).toBe('jump');
  });

  it('no jump without a destination: plot a course instead (Calder has 4 links)', () => {
    expect(contextAction(at(newWorld(data), { x: -2100, y: 0 }), data)).toBe('plotCourse');
  });

  it('autopilotOut in empty space too close to jump, with fuel and a destination', () => {
    expect(contextAction(at({ ...newWorld(data), route: ['vesk'] }, { x: -1000, y: -1000 }), data)).toBe('autopilotOut');
  });

  it('plotCourse beats autopilotOut when no destination can be chosen', () => {
    expect(contextAction(at(newWorld(data), { x: -1000, y: -1000 }), data)).toBe('plotCourse');
    // A stale course whose next hop isn't linked from here counts as no destination.
    expect(contextAction(at({ ...newWorld(data), route: ['skerry'] }, { x: -1000, y: -1000 }), data)).toBe('plotCourse');
  });

  it('no plotCourse with a single link (it is the destination), near a planet, or with an assist or jump', () => {
    const w = at(newWorld(data), { x: -1000, y: -1000 });
    const oneLink = { ...data, systems: { ...data.systems, calder: { ...data.systems.calder, links: ['vesk'] } } };
    expect(contextAction(w, oneLink)).toBe('autopilotOut');
    const h = data.planets.halcyon;
    expect(contextAction(at(newWorld(data), { x: h.pos.x, y: h.pos.y - 600 }), data)).toBe('land');
    expect(contextAction({ ...w, assist: { kind: 'autoStop' } }, data)).toBeNull();
    expect(contextAction({ ...w, assist: { kind: 'face' } }, data)).toBeNull();
    expect(contextAction({ ...w, jump: { toSystemId: 'vesk', phase: 'charge', t: 0.2 } }, data)).toBe('skipJump'); // mid-jump the button only skips
  });

  it('land beats autopilotOut when a planet is in range', () => {
    const h = data.planets.halcyon;
    expect(contextAction(at(newWorld(data), { x: h.pos.x, y: h.pos.y - 600 }), data)).toBe('land');
  });

  it('no autopilotOut without fuel for a jump, without links, or with another assist active', () => {
    const w = at({ ...newWorld(data), route: ['vesk'] }, { x: -1000, y: -1000 });
    expect(contextAction({ ...w, ship: { ...w.ship, fuel: data.config.fuelPerJump - 1 } }, data)).toBeNull();
    const noLinks = { ...data, systems: { ...data.systems, calder: { ...data.systems.calder, links: [] } } };
    expect(contextAction(w, noLinks)).toBeNull();
    expect(contextAction({ ...w, assist: { kind: 'autoStop' } }, data)).toBeNull();
    expect(contextAction({ ...w, assist: { kind: 'face' } }, data)).toBeNull();
  });

  it('the jump-point autopilot without a destination flies radially out (plotCourse is offered)', () => {
    let w = at(newWorld(data), { x: -1000, y: -1000 });
    expect(contextAction(w, data)).toBe('plotCourse');
    w = autopilotToJumpPoint(w);
    const input = { actions: new Set<never>(), pressed: new Set<never>() };
    for (let i = 0; i < 60 * 120 && w.assist.kind === 'autopilot'; i++) {
      w = stepWorld(w, data, input, 1 / 60, { autoLandOnArrival: true }).world;
    }
    expect(w.assist.kind).toBe('none');
    expect(dist(w.ship.pos, { x: 0, y: 0 })).toBeGreaterThanOrEqual(data.systems.calder.jumpDistance);
    expect(Math.atan2(w.ship.pos.y, w.ship.pos.x)).toBeCloseTo(Math.atan2(-1000, -1000), 1);
    expect(contextAction(w, data)).toBe('plotCourse');
    expect(contextAction({ ...w, route: ['vesk'] }, data)).toBe('jump');
  });

  it('executing autopilotOut flies the ship out until a jump is offered', () => {
    let w = autopilotToJumpPoint(at({ ...newWorld(data), route: ['vesk'] }, { x: -1000, y: -1000 }));
    expect(w.assist).toEqual({ kind: 'autopilot', dest: { type: 'jumpPoint' }, autoLand: false });
    expect(contextAction(w, data)).toBe('takeControl');
    const input = { actions: new Set<never>(), pressed: new Set<never>() };
    for (let i = 0; i < 60 * 120 && w.assist.kind === 'autopilot'; i++) {
      w = stepWorld(w, data, input, 1 / 60, { autoLandOnArrival: true }).world;
    }
    expect(w.assist.kind).toBe('none');
    expect(dist(w.ship.pos, jumpPoint(w, data))).toBeLessThan(data.config.arrivalRadius);
    expect(contextAction(w, data)).toBe('jump');
  });

  it('a targeted planet means land at any range (same as pressing L)', () => {
    const far = at({ ...newWorld(data), targetPlanetId: 'halcyon' }, { x: -2100, y: 0 });
    expect(contextAction(far, data)).toBe('land');
    // Even with a course set and the jump available.
    expect(contextAction({ ...far, route: ['vesk'] }, data)).toBe('land');
    // takeControl and tow still win.
    const auto: WorldState = { ...far, assist: { kind: 'autopilot', dest: { type: 'jumpPoint' }, autoLand: false } };
    expect(contextAction(auto, data)).toBe('takeControl');
    const stranded = at({ ...newWorld(data), systemId: 'vesk', targetPlanetId: 'halcyon' }, { x: -600, y: -700 }, 0);
    expect(contextAction(stranded, withoutPorts(data, 'vesk'))).toBe('tow');
  });

  it('executing land on a far targeted planet autopilots in and lands, like the L key', () => {
    let w = at({ ...newWorld(data), targetPlanetId: 'halcyon' }, { x: -2100, y: 0 });
    const input = { actions: new Set<never>(), pressed: new Set(['land']) as never };
    const none = { actions: new Set<never>(), pressed: new Set<never>() };
    let landed = false;
    for (let i = 0; i < 60 * 240 && !landed; i++) {
      const r = stepWorld(w, data, i === 0 ? input : none, 1 / 60, { autoLandOnArrival: true });
      w = r.world;
      landed = r.events.some((e) => e.type === 'landed' && e.planetId === 'halcyon');
    }
    expect(landed).toBe(true);
  });

  it('a course set with no target leaves instead of offering land near a planet', () => {
    const h = data.planets.halcyon;
    const near = at({ ...newWorld(data), route: ['vesk'] }, { x: h.pos.x, y: h.pos.y - 300 });
    expect(contextAction(near, data)).toBe('autopilotOut');
    expect(contextAction(at({ ...newWorld(data), route: ['vesk'] }, { x: -2100, y: 0 }), data)).toBe('jump');
    // Without fuel for a jump the course cannot be flown: fall back to land.
    const dry = at({ ...newWorld(data), route: ['vesk'] }, { x: h.pos.x, y: h.pos.y - 300 }, 0);
    expect(contextAction(dry, data)).toBe('land');
    // With another assist running the old proximity rule applies.
    expect(contextAction({ ...near, assist: { kind: 'autoStop' } }, data)).toBe('land');
  });

  it('skipJump while the jump can still be skipped (align, charge, burn), then null (flash, arrive)', () => {
    const base = at(newWorld(data), { x: 2100, y: 0 });
    for (const phase of ['align', 'charge', 'burn'] as const) {
      expect(contextAction({ ...base, jump: { toSystemId: 'vesk', phase, t: 0.1 } }, data), phase).toBe('skipJump');
    }
    for (const phase of ['flash', 'arrive'] as const) {
      expect(contextAction({ ...base, jump: { toSystemId: 'vesk', phase, t: 0.1 } }, data), phase).toBeNull();
    }
    // Nothing outranks the skip mid-jump, not even a hail.
    expect(contextAction({ ...base, jump: { toSystemId: 'vesk', phase: 'burn', t: 0 } }, data, { kind: 'hail' })).toBe('skipJump');
  });

  describe('encounters', () => {
    const site = { kind: 'site' as const, pos: { x: 100, y: 100 } };
    const near = (speed: number, gap: number) => ({
      ...newWorld(data),
      ship: { ...newWorld(data).ship, pos: { x: 100 + gap, y: 100 }, vel: { x: speed, y: 0 } },
    });

    it('a plotted jump or autopilot-out outranks a hail; without a course the hail shows', () => {
      const hail = { kind: 'hail' as const };
      const jumpable = at({ ...newWorld(data), route: ['vesk'] }, { x: -2100, y: 0 });
      expect(contextAction(jumpable, data, hail)).toBe('jump');
      const h = data.planets.halcyon;
      const close = at({ ...newWorld(data), route: ['vesk'] }, { x: h.pos.x, y: h.pos.y - 601 });
      expect(contextAction(close, data, hail)).toBe('autopilotOut');
      expect(contextAction(newWorld(data), data, hail)).toBe('answerHail');
    });

    it('answerHail while a hail is pending', () => {
      expect(contextAction(newWorld(data), data, { kind: 'hail' })).toBe('answerHail');
    });

    it('openSite only within 60 px and below 40 speed', () => {
      expect(contextAction(near(0, 60), data, site)).toBe('openSite');
      expect(contextAction(near(39, 0), data, site)).toBe('openSite');
      expect(contextAction(near(0, 61), data, site)).not.toBe('openSite');
      expect(contextAction(near(40, 0), data, site)).not.toBe('openSite');
    });

    it('takeControl and tow still win over an encounter', () => {
      const w: WorldState = { ...newWorld(data), assist: { kind: 'autopilot', dest: { type: 'jumpPoint' }, autoLand: false } };
      expect(contextAction(w, data, { kind: 'hail' })).toBe('takeControl');
    });
  });
});

describe('contextAction: flyToSite', () => {
  const far = { x: 4000, y: 4000 };
  const w0 = (): WorldState => at(newWorld(data), { x: -400, y: 300 });

  it('is offered when a story site is out of reach and nothing outranks it', () => {
    // Near Halcyon (land in range) it still wins over nearby land and plotCourse.
    expect(contextAction(w0(), data, { kind: 'site', pos: far }, true)).toBe('flyToSite');
    expect(contextAction(w0(), data, null, false)).not.toBe('flyToSite');
  });

  it('ranks below a targeted planet, a plotted jump and autopilot-out, above nearby land and plotCourse', () => {
    expect(contextAction({ ...w0(), targetPlanetId: 'halcyon' }, data, { kind: 'site', pos: far }, true)).toBe('land');
    expect(contextAction(at({ ...newWorld(data), route: ['vesk'] }, { x: -2100, y: 0 }), data, { kind: 'site', pos: far }, true)).toBe('jump');
    expect(contextAction(at({ ...newWorld(data), route: ['vesk'] }, { x: 0, y: -800 }), data, { kind: 'site', pos: far }, true)).toBe('autopilotOut');
    expect(contextAction(at(newWorld(data), { x: 0, y: -1500 }), data, { kind: 'site', pos: far }, true)).toBe('flyToSite');
  });

  it('openSite still wins when the site is reachable; takeControl and tow outrank it', () => {
    const w = at(newWorld(data), far);
    expect(contextAction(w, data, { kind: 'site', pos: far }, true)).toBe('openSite');
    const auto: WorldState = { ...w0(), assist: { kind: 'autopilot', dest: { type: 'jumpPoint' }, autoLand: false } };
    expect(contextAction(auto, data, { kind: 'site', pos: far }, true)).toBe('takeControl');
  });
});

describe('contextAction: combat', () => {
  const board = { board: true, disabledCalm: false, disabled: false };
  it('board outranks land and hail', () => {
    const w = newWorld(data); // near halcyon: land
    expect(contextAction(w, data)).toBe('land');
    expect(contextAction(w, data, null, false, board)).toBe('board');
    expect(contextAction(w, data, { kind: 'hail' }, false, board)).toBe('board');
    expect(contextAction({ ...w, targetPlanetId: 'halcyon' }, data, null, true, board)).toBe('board');
    // Only taking control of the autopilot outranks it.
    const auto: WorldState = { ...w, assist: { kind: 'autopilot', dest: { type: 'jumpPoint' }, autoLand: false } };
    expect(contextAction(auto, data, null, false, board)).toBe('takeControl');
    expect(contextAction(w, data, null, false, { ...board, board: false })).toBe('land');
  });

  it('disabled player: callTow when calm, nothing otherwise', () => {
    const w = newWorld(data);
    const calm = { board: false, disabledCalm: true, disabled: true };
    expect(contextAction(w, data, null, false, calm)).toBe('callTow');
    expect(contextAction(w, data, { kind: 'hail' }, true, { ...calm, disabledCalm: false })).toBeNull();
    expect(contextAction({ ...w, targetPlanetId: 'halcyon' }, data, null, false, { ...calm, disabledCalm: false })).toBeNull();
    // Board is not offered to a disabled ship either.
    expect(contextAction(w, data, null, false, { ...calm, board: true, disabledCalm: false })).toBeNull();
    // Calm only matters while disabled.
    expect(contextAction(w, data, null, false, { board: false, disabledCalm: true, disabled: false })).toBe('land');
  });
});
