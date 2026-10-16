import { describe, expect, it } from 'vitest';
import { loadGameData } from '../data/load';
import type { PilotSave } from '../save/pilot';
import { DEFAULT_SETTINGS } from '../save/settings';
import { newWorld } from '../sim/world';
import { Controller, type ControllerEvent } from './controller';

const keyEvent = (type: string, code: string) => Object.assign(new Event(type), { code, repeat: false });

async function setup() {
  const data = await loadGameData();
  const target = new EventTarget();
  const c = new Controller(data, { ...DEFAULT_SETTINGS }, target);
  const events: ControllerEvent[] = [];
  for (const t of ['landed', 'jumped', 'message', 'towed', 'contextChanged', 'menu', 'saved'] as const) c.on(t, (e) => events.push(e));
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

  it('landing pauses flight and emits landed; leavePlanet departs and resumes', async () => {
    const { c, events } = await setup();
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

    c.leavePlanet();
    expect(c.isFlying).toBe(true);
    expect(c.landedPlanetId).toBeNull();
    expect(c.world.targetPlanetId).toBeNull();
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

  it('doContextAction does nothing while not flying, so a stale land cannot re-land after leaving', async () => {
    const { c, events } = await setup();
    c.beginSession(c.world, { id: 'p1', name: 'Ava' }, 'halcyon');
    c.doContextAction(); // on the planet screen: must not queue 'land'
    c.leavePlanet();
    c.update(1 / 60);
    expect(c.isFlying).toBe(true);
    expect(events.filter((e) => e.type === 'landed')).toHaveLength(0);
  });

  it('pausing flight clears queued context actions', async () => {
    const { c, events } = await setup();
    c.startFlight();
    c.doContextAction(); // queues 'land'
    c.pauseFlight();
    c.startFlight();
    c.update(1 / 60);
    expect(events.filter((e) => e.type === 'landed')).toHaveLength(0);
  });

  it('pause and map keys stop the sim and emit menu events', async () => {
    const { c, target, events } = await setup();
    c.startFlight();
    target.dispatchEvent(keyEvent('keydown', 'Escape'));
    c.update(1 / 60);
    expect(c.isFlying).toBe(false);
    expect(events).toContainEqual({ type: 'menu', action: 'pause' });
    const t = c.world.timeSec;
    c.update(0.2);
    expect(c.world.timeSec).toBe(t);

    c.startFlight();
    target.dispatchEvent(keyEvent('keydown', 'KeyM'));
    c.update(1 / 60);
    expect(c.isFlying).toBe(false);
    expect(events).toContainEqual({ type: 'menu', action: 'map' });
  });

  it('routes presses to the UI input handler while not flying, one poll per frame', async () => {
    const { c, target } = await setup();
    const seen: string[][] = [];
    const off = c.setUiInput(['menus', 'flight'], (p) => seen.push([...p].sort()));
    target.dispatchEvent(keyEvent('keydown', 'Escape'));
    target.dispatchEvent(keyEvent('keydown', 'KeyM'));
    c.update(1 / 60);
    expect(seen).toEqual([['back', 'map', 'pause']]);
    off();
    target.dispatchEvent(keyEvent('keydown', 'KeyL'));
    c.update(1 / 60);
    expect(seen).toHaveLength(1);
  });

  it('beginSession lands at the planet; landing autosaves at the most recent planet', async () => {
    const { c, events } = await setup();
    const saved: PilotSave[] = [];
    c.store = { save: async (p) => void saved.push(p) };
    c.beginSession(newWorld(c.data), { id: 'p1', name: 'Ava' }, 'halcyon');
    expect(c.isFlying).toBe(false);
    expect(c.landedPlanetId).toBe('halcyon');
    expect(c.lastPlanetId).toBe('halcyon');
    expect(c.pilot).toEqual({ id: 'p1', name: 'Ava' });

    c.leavePlanet();
    c.update(1 / 60);
    c.doContextAction();
    c.update(1 / 60);
    expect(c.landedPlanetId).toBe('halcyon');
    await c.lastSave;
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ id: 'p1', name: 'Ava', planetId: 'halcyon', systemId: 'calder' });
    expect(events).toContainEqual({ type: 'saved', ok: true });
  });

  it('save() after flying away is still a landed snapshot at the last planet', async () => {
    const { c } = await setup();
    const saved: PilotSave[] = [];
    c.store = { save: async (p) => void saved.push(p) };
    c.beginSession(newWorld(c.data), { id: 'p1', name: 'Ava' }, 'halcyon');
    c.leavePlanet();
    for (let i = 0; i < 10; i++) c.update(1 / 60);
    await c.save();
    expect(saved[0].planetId).toBe('halcyon');
    expect(c.snapshot()?.planetId).toBe('halcyon');
    c.world = { ...c.world, systemId: 'vesk' }; // as if we had jumped away since landing
    expect(c.snapshot()).toMatchObject({ planetId: 'halcyon', systemId: 'calder' });
  });

  it('a failed autosave emits saved {ok:false}', async () => {
    const { c, events } = await setup();
    c.store = { save: async () => Promise.reject(new Error('disk full')) };
    c.beginSession(newWorld(c.data), { id: 'p1', name: 'Ava' }, 'halcyon');
    c.leavePlanet();
    c.update(1 / 60);
    c.doContextAction();
    c.update(1 / 60);
    await c.lastSave;
    expect(events).toContainEqual({ type: 'saved', ok: false, error: 'disk full' });
  });

  it('refuel buys fuel at the landed planet', async () => {
    const { c, data } = await setup();
    const w = newWorld(data);
    c.beginSession({ ...w, ship: { ...w.ship, fuel: 100 } }, { id: 'p1', name: 'Ava' }, 'halcyon');
    expect(c.refuelQuote()).toEqual({ units: 200, cost: 400 });
    c.refuel();
    expect(c.world.ship.fuel).toBe(300);
    expect(c.world.credits).toBe(data.config.startCredits - 400);
    expect(c.refuelQuote()).toMatchObject({ units: 0, reason: 'full' });
  });

  it('callTow works while paused and lands at the tow destination', async () => {
    const { c, data, events } = await setup();
    const w = newWorld(data);
    c.beginSession({ ...w, systemId: 'vesk', ship: { ...w.ship, fuel: 0 } }, { id: 'p1', name: 'Ava' }, 'tallow-rock');
    c.leavePlanet();
    c.pauseFlight();
    expect(c.towDestination()).not.toBeNull();
    expect(c.callTow()).toBe(true);
    expect(events.some((e) => e.type === 'towed')).toBe(true);
    expect(c.isFlying).toBe(false);
    expect(c.landedPlanetId).toBe(c.lastPlanetId);
    expect(data.planets[c.landedPlanetId!].systemId).toBe('calder');
    expect(c.world.credits).toBe(data.config.startCredits - data.config.towFee);
  });

  it('endSession forgets the pilot', async () => {
    const { c } = await setup();
    c.beginSession(c.world, { id: 'p1', name: 'Ava' }, 'halcyon');
    c.endSession();
    expect(c.pilot).toBeNull();
    expect(c.landedPlanetId).toBeNull();
    expect(c.snapshot()).toBeNull();
    expect(c.isFlying).toBe(false);
  });
  it('touch presses and the touch stick merge into the flight input', async () => {
    const { c, data } = await setup();
    c.startFlight();
    c.touch.press('autoStop');
    c.touch.release('autoStop');
    c.world = { ...c.world, ship: { ...c.world.ship, pos: { x: 0, y: -1500 }, vel: { x: 300, y: 0 } } };
    c.update(1 / 60);
    expect(c.world.assist.kind).toBe('autoStop');

    c.world = newWorld(data);
    c.world = { ...c.world, ship: { ...c.world.ship, pos: { x: 0, y: -1500 }, heading: 0 } };
    c.touch.setStick(Math.PI / 2, 1);
    for (let i = 0; i < 30; i++) c.update(1 / 60);
    expect(c.world.ship.heading).toBeGreaterThan(0.5);
    expect(c.world.ship.vel.y).toBeGreaterThan(0);
  });

  it('a touch pause or map press opens the menu like the keys do', async () => {
    const { c, events } = await setup();
    c.startFlight();
    c.touch.press('map');
    c.touch.release('map');
    c.update(1 / 60);
    expect(c.isFlying).toBe(false);
    expect(events).toContainEqual({ type: 'menu', action: 'map' });
  });

  it('touch presses made while paused are dropped, not replayed on resume', async () => {
    const { c, events } = await setup();
    c.touch.press('pause');
    c.touch.release('pause');
    c.update(1 / 60);
    c.startFlight();
    c.update(1 / 60);
    expect(events.filter((e) => e.type === 'menu')).toHaveLength(0);
  });

  it('tapPlanet selects the planet and lands through the context path', async () => {
    const { c, events } = await setup();
    c.startFlight();
    c.tapPlanet('halcyon');
    expect(c.world.targetPlanetId).toBe('halcyon');
    c.update(1 / 60);
    expect(events).toContainEqual({ type: 'landed', planetId: 'halcyon' });
  });

  it('tapPlanet on a far planet autopilots there (even mid-autopilot), and is ignored when not flying', async () => {
    const { c } = await setup();
    c.tapPlanet('merrow');
    expect(c.world.targetPlanetId).toBeNull();
    c.startFlight();
    c.tapPlanet('brigg-station');
    c.update(1 / 60);
    expect(c.world.assist).toMatchObject({ kind: 'autopilot', dest: { type: 'planet', id: 'brigg-station' } });
    c.tapPlanet('merrow');
    c.update(1 / 60);
    expect(c.world.assist).toMatchObject({ kind: 'autopilot', dest: { type: 'planet', id: 'merrow' } });
  });
});
