import { describe, expect, it } from 'vitest';
import { loadGameData } from '../data/load';
import { DEFAULT_SETTINGS } from '../save/settings';
import { Controller, type ControllerEvent } from './controller';

const keyEvent = (type: string, code: string) => Object.assign(new Event(type), { code, repeat: false });

async function setup() {
  const data = await loadGameData();
  const target = new EventTarget();
  const c = new Controller(data, { ...DEFAULT_SETTINGS }, target);
  const events: ControllerEvent[] = [];
  for (const t of ['landed', 'jumped', 'message', 'towed', 'contextChanged'] as const) c.on(t, (e) => events.push(e));
  return { c, data, target, events };
}

describe('Controller', () => {
  it('does not step until flight starts, then advances in fixed steps', async () => {
    const { c } = await setup();
    c.update(0.5);
    expect(c.world.timeSec).toBe(0);
    c.startFlight();
    c.update(0.1);
    expect(c.world.timeSec).toBeCloseTo(0.1, 5);
  });

  it('thrust key builds speed', async () => {
    const { c, target } = await setup();
    c.startFlight();
    target.dispatchEvent(keyEvent('keydown', 'ArrowUp'));
    for (let i = 0; i < 4; i++) c.update(0.25);
    const v = c.world.ship.vel;
    expect(Math.hypot(v.x, v.y)).toBeGreaterThan(100);
  });

  it('landing pauses flight and emits landed; land press departs and resumes', async () => {
    const { c, target, events } = await setup();
    c.startFlight();
    c.update(1 / 60);
    expect(events).toContainEqual({ type: 'contextChanged', action: 'land' });
    c.doContextAction();
    c.update(1 / 60);
    expect(events).toContainEqual({ type: 'landed', planetId: 'halcyon' });
    expect(c.isFlying).toBe(false);
    expect(c.landedPlanetId).toBe('halcyon');
    const t = c.world.timeSec;
    c.update(0.5);
    expect(c.world.timeSec).toBe(t);

    target.dispatchEvent(keyEvent('keydown', 'KeyL'));
    c.update(1 / 60);
    expect(c.isFlying).toBe(true);
    expect(c.landedPlanetId).toBeNull();
  });

  it('selectPlanet sets the target', async () => {
    const { c } = await setup();
    c.selectPlanet('merrow');
    expect(c.world.targetPlanetId).toBe('merrow');
  });

  it('forwards message events; on() returns an unsubscribe', async () => {
    const { c, target } = await setup();
    let n = 0;
    const off = c.on('message', () => n++);
    c.startFlight();
    target.dispatchEvent(keyEvent('keydown', 'KeyJ')); // too close to the star
    c.update(1 / 60);
    expect(n).toBe(1);
    off();
    target.dispatchEvent(keyEvent('keyup', 'KeyJ'));
    target.dispatchEvent(keyEvent('keydown', 'KeyJ'));
    c.update(1 / 60);
    expect(n).toBe(1);
  });
});
