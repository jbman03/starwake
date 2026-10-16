import { describe, expect, it } from 'vitest';
import { testData } from '../data/testData';
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
    expect(contextAction(w, data)).toBe('tow');
  });

  it('land near halcyon', () => {
    expect(contextAction(newWorld(data), data)).toBe('land');
  });

  it('land at 600 px but not at 601 px', () => {
    const h = data.planets.halcyon;
    expect(contextAction(at(newWorld(data), { x: h.pos.x, y: h.pos.y - 600 }), data)).toBe('land');
    expect(contextAction(at(newWorld(data), { x: h.pos.x, y: h.pos.y - 601 }), data)).toBe('autopilotOut');
  });

  it('jump when outside the jump distance with fuel and a destination', () => {
    expect(contextAction(at({ ...newWorld(data), route: ['vesk'] }, { x: -2100, y: 0 }), data)).toBe('jump');
  });

  it('no jump without a destination', () => {
    expect(contextAction(at(newWorld(data), { x: -2100, y: 0 }), data)).toBeNull();
  });

  it('autopilotOut in empty space too close to jump, with fuel', () => {
    expect(contextAction(at(newWorld(data), { x: -1000, y: -1000 }), data)).toBe('autopilotOut');
  });

  it('land beats autopilotOut when a planet is in range', () => {
    const h = data.planets.halcyon;
    expect(contextAction(at(newWorld(data), { x: h.pos.x, y: h.pos.y - 600 }), data)).toBe('land');
  });

  it('no autopilotOut without fuel for a jump, without links, or with another assist active', () => {
    const w = at(newWorld(data), { x: -1000, y: -1000 });
    expect(contextAction({ ...w, ship: { ...w.ship, fuel: data.config.fuelPerJump - 1 } }, data)).toBeNull();
    const noLinks = { ...data, systems: { ...data.systems, calder: { ...data.systems.calder, links: [] } } };
    expect(contextAction(w, noLinks)).toBeNull();
    expect(contextAction({ ...w, assist: { kind: 'autoStop' } }, data)).toBeNull();
    expect(contextAction({ ...w, assist: { kind: 'face' } }, data)).toBeNull();
  });

  it('autopilotOut is offered without a destination; it flies radially out', () => {
    let w = at(newWorld(data), { x: -1000, y: -1000 });
    expect(contextAction(w, data)).toBe('autopilotOut');
    w = autopilotToJumpPoint(w);
    const input = { actions: new Set<never>(), pressed: new Set<never>() };
    for (let i = 0; i < 60 * 120 && w.assist.kind === 'autopilot'; i++) {
      w = stepWorld(w, data, input, 1 / 60, { autoLandOnArrival: true }).world;
    }
    expect(w.assist.kind).toBe('none');
    expect(dist(w.ship.pos, { x: 0, y: 0 })).toBeGreaterThanOrEqual(data.systems.calder.jumpDistance);
    expect(Math.atan2(w.ship.pos.y, w.ship.pos.x)).toBeCloseTo(Math.atan2(-1000, -1000), 1);
    expect(contextAction(w, data)).toBeNull();
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

  it('null while jumping', () => {
    const w = { ...at(newWorld(data), { x: 2100, y: 0 }), jump: { toSystemId: 'vesk', t: 0.5 } };
    expect(contextAction(w, data)).toBeNull();
  });
});
