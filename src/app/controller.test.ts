import 'fake-indexeddb/auto';
import { createStore } from 'idb-keyval';
import { describe, expect, it } from 'vitest';
import { loadGameData } from '../data/load';
import { withoutPorts } from '../data/testData';
import type { PilotSave } from '../save/pilot';
import { worldFromPilot } from '../save/pilot';
import type { ActionId } from '../input/actions';
import { DEFAULT_SETTINGS } from '../save/settings';
import { PilotStore } from '../save/store';
import type { StoryMissionDef } from '../data/schemas';
import { canAccept } from '../sim/missions';
import { newWorld } from '../sim/world';
import { contextLabel } from '../ui/rails';
import { Controller, LANDING_FX_SEC, type ControllerEvent } from './controller';

/** Run `sec` of frames at 60 fps (the landing and take-off effects take time). */
function run(c: Controller, sec: number): void {
  for (let i = 0; i < Math.round(sec * 60); i++) c.update(1 / 60);
}

const keyEvent = (type: string, code: string) => Object.assign(new Event(type), { code, repeat: false });

/** `portless` names systems whose ports are removed (every port sells fuel, so that is how a test strands the ship). */
async function setup(portless: string[] = []) {
  const data = withoutPorts(await loadGameData(), ...portless);
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
    run(c, LANDING_FX_SEC + 0.05);
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

  it('the sound key flips mute and says so, flying and on a planet screen', async () => {
    const { c, target } = await setup();
    const messages: string[] = [];
    c.on('message', (e) => messages.push(e.text));
    c.startFlight();
    target.dispatchEvent(keyEvent('keydown', 'KeyV'));
    c.update(1 / 60);
    expect(c.settings.muted).toBe(true);
    expect(messages).toEqual(['Sound off']);
    target.dispatchEvent(keyEvent('keyup', 'KeyV'));
    c.pauseFlight();
    target.dispatchEvent(keyEvent('keydown', 'KeyV'));
    c.update(1 / 60); // no screen open: the key still works
    expect(c.settings.muted).toBe(false);
    expect(messages).toEqual(['Sound off', 'Sound on']);
  });

  it('the sound key works on a screen that listens only to the planet group, and hides other menu keys from it', async () => {
    const { c, target } = await setup();
    const seen: ActionId[][] = [];
    c.setUiInput(['planet'], (p) => seen.push([...p]));
    target.dispatchEvent(keyEvent('keydown', 'KeyV'));
    target.dispatchEvent(keyEvent('keydown', 'KeyH'));
    c.update(1 / 60);
    expect(c.settings.muted).toBe(true);
    expect(seen).toEqual([['howToPlay']]);
  });

  it('announces effects that have no event of their own', async () => {
    const { c } = await setup();
    const sfx: string[] = [];
    c.on('sfx', (e) => sfx.push(e.sfx));
    c.startFlight();
    c.doContextAction();
    run(c, LANDING_FX_SEC + 0.05);
    c.buy('food', 10);
    expect(sfx).toEqual(['trade']);
    c.sell('food', 0); // nothing sold: silent
    c.leavePlanet();
    expect(sfx).toEqual(['trade', 'takeoff']);
    c.forceEncounter(Object.keys(c.data.encounters)[0]);
    expect(sfx).toContain(c.pending!.kind);
  });

  it('the autopilotOut context action engages the autopilot to the jump point', async () => {
    const { c, events } = await setup();
    c.startFlight();
    c.world = { ...c.world, route: ['vesk'], ship: { ...c.world.ship, pos: { x: -1000, y: -1000 } } };
    c.update(1 / 60);
    expect(events).toContainEqual({ type: 'contextChanged', action: 'autopilotOut' });
    c.doContextAction();
    expect(c.world.assist).toEqual({ kind: 'autopilot', dest: { type: 'jumpPoint' }, autoLand: false });
    expect(events.at(-1)).toEqual({ type: 'contextChanged', action: 'takeControl' });
  });

  it('the plotCourse context action pauses flight and opens the star map', async () => {
    const { c, events } = await setup();
    c.startFlight();
    c.world = { ...c.world, ship: { ...c.world.ship, pos: { x: -1000, y: -1000 } } };
    c.update(1 / 60);
    expect(events).toContainEqual({ type: 'contextChanged', action: 'plotCourse' });
    c.doContextAction();
    expect(c.isFlying).toBe(false);
    expect(events).toContainEqual({ type: 'menu', action: 'map' });
    expect(events.at(-1)).toEqual({ type: 'contextChanged', action: null });
  });

  it('the map key is ignored during a jump', async () => {
    const { c, target, events } = await setup();
    c.startFlight();
    c.world = { ...c.world, jump: { toSystemId: 'vesk', t: 0 } };
    target.dispatchEvent(keyEvent('keydown', 'KeyM'));
    c.update(1 / 60);
    expect(c.isFlying).toBe(true);
    expect(events.some((e) => e.type === 'menu')).toBe(false);
    expect(c.world.jump).not.toBeNull();
  });

  it('Tab moves focus in menus but is kept by the game while flying', async () => {
    const { c, target } = await setup();
    const tab = () => {
      const e = Object.assign(new Event('keydown', { cancelable: true }), { code: 'Tab', repeat: false });
      target.dispatchEvent(e);
      return e.defaultPrevented;
    };
    expect(tab()).toBe(false); // not flying: main menu / planet screen
    c.startFlight();
    expect(tab()).toBe(true);
    c.pauseFlight();
    expect(tab()).toBe(false);
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
    run(c, LANDING_FX_SEC + 0.05);
    c.doContextAction();
    run(c, LANDING_FX_SEC + 0.05);
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
    run(c, LANDING_FX_SEC + 0.05);
    c.doContextAction();
    run(c, LANDING_FX_SEC + 0.05);
    await c.lastSave;
    expect(events).toContainEqual({ type: 'saved', ok: false, error: 'disk full' });
  });

  it('refuel buys fuel at the landed planet', async () => {
    const { c, data } = await setup();
    const w = newWorld(data, 1);
    c.beginSession({ ...w, ship: { ...w.ship, fuel: 100 } }, { id: 'p1', name: 'Ava' }, 'halcyon');
    expect(c.refuelQuote()).toEqual({ units: 200, cost: 400 });
    c.refuel();
    expect(c.world.ship.fuel).toBe(300);
    expect(c.world.credits).toBe(data.config.startCredits - 400);
    expect(c.refuelQuote()).toMatchObject({ units: 0, reason: 'full' });
  });

  it('callTow works while paused and lands at the tow destination', async () => {
    const { c, data, events } = await setup(['vesk']);
    const w = newWorld(data, 1);
    c.beginSession({ ...w, systemId: 'vesk', ship: { ...w.ship, fuel: 0 } }, { id: 'p1', name: 'Ava' }, 'halcyon');
    c.leavePlanet();
    c.world = { ...c.world, systemId: 'vesk' }; // leaving Halcyon put us in calder; strand us in the port-less vesk
    c.pauseFlight();
    expect(c.towDestination()).not.toBeNull();
    expect(c.callTow()).toBe(true);
    expect(events.some((e) => e.type === 'towed')).toBe(true);
    expect(c.isFlying).toBe(false);
    expect(c.landedPlanetId).toBe(c.lastPlanetId);
    expect(data.planets[c.landedPlanetId!].systemId).toBe('calder');
    expect(c.world.credits).toBe(data.config.startCredits - data.config.towFee);
  });

  const dueToday = (id: string, title: string) => ({
    id, typeId: 'delivery', originId: 'halcyon', destId: 'merrow', tons: 0, passengers: 0, pay: 500,
    paidUpfront: false, deadlineDay: 0, title, description: '', cargoName: 'x',
  });

  it('missions failed during a tow wait for the planet screen instead of the hidden HUD', async () => {
    const { c, data, events } = await setup(['vesk']);
    const w = newWorld(data, 1);
    c.beginSession({ ...w, systemId: 'vesk', ship: { ...w.ship, fuel: 0 }, missions: [dueToday('a', 'Job A'), dueToday('b', 'Job B')] },
      { id: 'p1', name: 'Ava' }, 'halcyon');
    c.leavePlanet();
    c.world = { ...c.world, systemId: 'vesk' }; // leaving Halcyon put us in calder; strand us in the port-less vesk
    expect(c.callTow()).toBe(true);
    expect(c.world.missions).toEqual([]);
    expect(events.filter((e) => e.type === 'message')).toEqual([]);
    expect(c.takeNotices()).toEqual([
      'Mission failed: Job A — the deadline passed.',
      'Mission failed: Job B — the deadline passed.',
    ]);
    expect(c.takeNotices()).toEqual([]);
  });

  it('several failures from one jump become a single HUD message', async () => {
    const { c, data, events } = await setup();
    const w = newWorld(data, 1);
    c.beginSession({ ...w, missions: [dueToday('a', 'Job A'), dueToday('b', 'Job B')] }, { id: 'p1', name: 'Ava' }, 'halcyon');
    c.leavePlanet();
    c.world = { ...c.world, jump: { toSystemId: 'vesk', t: 0.99 } };
    c.update(0.1);
    expect(events.filter((e) => e.type === 'jumped')).toHaveLength(1);
    expect(events.filter((e) => e.type === 'message')).toEqual([
      { type: 'message', text: 'Mission failed: Job A — the deadline passed. Mission failed: Job B — the deadline passed.' },
    ]);
    expect(c.takeNotices()).toEqual([]);
  });

  it('a tow into debt autosaves a valid pilot that loads back without the backup', async () => {
    const { c, data, events } = await setup(['vesk']);
    const store = new PilotStore(createStore('ctl-tow-debt', 'kv'));
    c.store = store;
    const w = newWorld(data, 1);
    c.beginSession({ ...w, credits: 100 }, { id: 'p1', name: 'Ava' }, 'halcyon');
    await c.save(); // a good earlier save, so a bad one would fall back to it
    c.world = { ...c.world, systemId: 'vesk', ship: { ...c.world.ship, pos: { x: -600, y: -700 }, fuel: 0 } };
    c.startFlight();
    expect(c.callTow()).toBe(true);
    await c.lastSave;
    expect(events).toContainEqual({ type: 'saved', ok: true });
    expect(c.world.credits).toBe(100 - data.config.towFee);
    expect(c.world.credits).toBeLessThan(0);

    const { pilot, usedBackup } = await store.load('p1');
    expect(usedBackup).toBe(false);
    expect(pilot).toEqual(c.snapshot() && { ...c.snapshot()!, savedAt: pilot.savedAt });
    expect(pilot.credits).toBe(100 - data.config.towFee);
    expect(pilot.planetId).toBe(c.landedPlanetId);
    expect(worldFromPilot(pilot, data).credits).toBe(pilot.credits);
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

    c.world = newWorld(data, 1);
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
    run(c, LANDING_FX_SEC + 0.05);
    expect(events).toContainEqual({ type: 'landed', planetId: 'halcyon' });
  });

  it('a mouse click on a planet only selects it; touch and pen taps select and land', async () => {
    const { c, events } = await setup();
    c.startFlight();
    c.tapPlanet('merrow', 'mouse');
    expect(c.world.targetPlanetId).toBe('merrow');
    c.update(1 / 60);
    expect(c.world.assist.kind).toBe('none');
    c.tapPlanet('halcyon', 'mouse');
    c.update(1 / 60);
    expect(c.world.targetPlanetId).toBe('halcyon');
    expect(c.isFlying).toBe(true);
    expect(events.some((e) => e.type === 'landed')).toBe(false);

    c.tapPlanet('halcyon', 'touch');
    run(c, LANDING_FX_SEC + 0.05);
    expect(events).toContainEqual({ type: 'landed', planetId: 'halcyon' });

    c.leavePlanet();
    run(c, LANDING_FX_SEC + 0.05);
    c.tapPlanet('merrow', 'pen');
    c.update(1 / 60);
    expect(c.world.assist).toMatchObject({ kind: 'autopilot', dest: { type: 'planet', id: 'merrow' } });
  });

  it('a mouse click mid-autopilot selects without taking over', async () => {
    const { c } = await setup();
    c.startFlight();
    c.tapPlanet('brigg-station', 'touch');
    c.update(1 / 60);
    c.tapPlanet('merrow', 'mouse');
    c.update(1 / 60);
    expect(c.world.targetPlanetId).toBe('merrow');
    expect(c.world.assist).toMatchObject({ kind: 'autopilot', dest: { type: 'planet', id: 'brigg-station' } });
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

describe('Controller landing and take-off effects', () => {
  it('the landed event fires only after LANDING_FX_SEC of updates, and landing work waits for it', async () => {
    const { c, events } = await setup();
    const saved: PilotSave[] = [];
    c.store = { save: async (p) => void saved.push(p) };
    c.beginSession(c.world, { id: 'p1', name: 'Ava' }, 'halcyon');
    c.leavePlanet();
    run(c, LANDING_FX_SEC + 0.05);
    events.length = 0;
    c.doContextAction();
    run(c, LANDING_FX_SEC - 0.1);
    expect(events.some((e) => e.type === 'landed')).toBe(false);
    expect(c.landedPlanetId).toBeNull();
    expect(c.isFlying).toBe(true);
    const mid = c.view().landingT;
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1);
    run(c, 0.15);
    expect(events).toContainEqual({ type: 'landed', planetId: 'halcyon' });
    expect(c.landedPlanetId).toBe('halcyon');
    expect(c.isFlying).toBe(false);
    expect(c.view().landingT).toBeNull();
    await c.lastSave;
    expect(saved).toHaveLength(1);
  });

  it('input is ignored while landing', async () => {
    const { c, target, events } = await setup();
    c.startFlight();
    c.doContextAction();
    c.update(1 / 60);
    expect(c.view().landingT).not.toBeNull();
    const t = c.world.timeSec;
    target.dispatchEvent(keyEvent('keydown', 'ArrowUp'));
    target.dispatchEvent(keyEvent('keydown', 'Escape'));
    run(c, 0.1);
    expect(events.some((e) => e.type === 'menu')).toBe(false);
    expect(c.world.timeSec).toBe(t);
    expect(c.world.ship.vel).toEqual({ x: 0, y: 0 });
    c.doContextAction();
    c.tapPlanet('merrow');
    expect(c.world.targetPlanetId).toBe('halcyon');
    run(c, LANDING_FX_SEC);
    expect(events.filter((e) => e.type === 'landed')).toHaveLength(1);
    expect(events.some((e) => e.type === 'menu')).toBe(false);
  });

  it('take-off runs the effect in reverse and ignores input until it ends', async () => {
    const { c, target } = await setup();
    c.beginSession(c.world, { id: 'p1', name: 'Ava' }, 'halcyon');
    c.leavePlanet();
    expect(c.view().landingT).toBe(1);
    target.dispatchEvent(keyEvent('keydown', 'ArrowUp'));
    run(c, 0.2);
    expect(c.view().landingT).toBeCloseTo(0.5, 1);
    expect(Math.hypot(c.world.ship.vel.x, c.world.ship.vel.y)).toBe(0);
    run(c, 0.25);
    expect(c.view().landingT).toBeNull();
    target.dispatchEvent(keyEvent('keyup', 'ArrowUp'));
    target.dispatchEvent(keyEvent('keydown', 'ArrowUp'));
    run(c, 0.2);
    expect(Math.hypot(c.world.ship.vel.x, c.world.ship.vel.y)).toBeGreaterThan(0);
    expect(c.view().thrusting).toBe(true);
  });
});

describe('Controller.plotRoute', () => {
  it('stores a course to a charted system and offers the jump to its first hop', async () => {
    const { c } = await setup();
    c.startFlight();
    c.world = { ...c.world, ship: { ...c.world.ship, pos: { x: 2100, y: 0 }, vel: { x: 0, y: 0 } } };
    expect(c.currentContext()).toBe('plotCourse'); // no destination yet
    expect(c.plotRoute('vesk')).toEqual({ ok: true });
    expect(c.world.route).toEqual(['vesk']);
    expect(c.currentContext()).toBe('jump');
  });

  it('refuses an uncharted system and keeps the old course', async () => {
    const { c } = await setup();
    c.plotRoute('vesk');
    expect(c.plotRoute('skerry')).toEqual({ ok: false, reason: 'noRoute' });
    expect(c.world.route).toEqual(['vesk']);
  });
});

describe('Controller flight events and input release', () => {
  it('emits flying on start and pause, only on change', async () => {
    const c = new Controller(await loadGameData(), { ...DEFAULT_SETTINGS }, new EventTarget());
    const seen: boolean[] = [];
    c.on('flying', (e) => seen.push(e.flying));
    c.startFlight();
    c.startFlight();
    c.pauseFlight();
    c.pauseFlight();
    expect(seen).toEqual([true, false]);
  });

  it('releaseInputs drops touch and keyboard holds', async () => {
    const c = new Controller(await loadGameData(), { ...DEFAULT_SETTINGS }, new EventTarget());
    c.touch.press('thrust');
    c.releaseInputs();
    expect(c.touch.poll('flight').actions.size).toBe(0);
  });
});

describe('Controller trade, missions and routes', () => {
  const deliver = (over = {}) => ({
    offerId: 'o1', typeId: 'delivery', originId: 'halcyon', destId: 'merrow', tons: 1, passengers: 0, pay: 700,
    paidUpfront: false, deadlineDay: null, title: 'T', description: '', cargoName: 'crates', ...over,
  });

  it('buy/sell update the world only when landed', async () => {
    const { c } = await setup();
    const before = c.world;
    expect(c.buy('food', 10)).toMatchObject({ tons: 0, reason: 'notTraded' });
    expect(c.sell('food', 10)).toMatchObject({ tons: 0, reason: 'notTraded' });
    expect(c.offers()).toEqual([]);
    expect(c.world).toBe(before);
    c.beginSession(c.world, { id: 'p1', name: 'Ava' }, 'halcyon');
    const b = c.buy('food', 10);
    expect(b.tons).toBeGreaterThan(0);
    expect(c.world.cargo.food).toBe(b.tons);
    expect(c.world.credits).toBe(before.credits - b.cost);
    const s = c.sell('food', b.tons);
    expect(s.tons).toBe(b.tons);
    expect(c.world.cargo.food ?? 0).toBe(0);
  });

  it('acceptMission uses current offers and reports a failed check', async () => {
    const { c, data } = await setup();
    c.beginSession(newWorld(data, 1), { id: 'p1', name: 'Ava' }, 'halcyon'); // fixed seed: same offers every run
    const offers = c.offers();
    expect(offers.length).toBeGreaterThanOrEqual(3);
    const pick = offers.find((o) => canAccept(c.world, c.data, o).ok)!;
    expect(pick).toBeDefined();
    expect(c.acceptMission('nope')).toMatchObject({ ok: false });
    c.world = { ...c.world, missions: Array.from({ length: 8 }, (_, i) => ({ ...deliver(), id: `x${i}` })) };
    expect(c.acceptMission(pick.offerId)).toEqual({ ok: false, reason: 'tooMany' });
    c.world = { ...c.world, missions: [] };
    expect(c.acceptMission(pick.offerId)).toEqual({ ok: true });
    expect(c.world.missions).toHaveLength(1);
    c.abandonMission(pick.offerId);
    expect(c.world.missions).toHaveLength(0);
  });

  it('landing at the destination emits missionsCompleted before the autosave, and the save has the pay', async () => {
    const { c } = await setup();
    const order: string[] = [];
    const saved: PilotSave[] = [];
    c.store = { save: async (p) => void (order.push('save'), saved.push(p)) };
    c.on('missionsCompleted', () => order.push('completed'));
    const done: { missions: unknown[]; pay: number }[] = [];
    c.on('missionsCompleted', (e) => done.push(e));
    c.beginSession(c.world, { id: 'p1', name: 'Ava' }, 'halcyon');
    const credits = c.world.credits;
    c.world = { ...c.world, missions: [{ ...deliver(), id: 'j1' }] };
    // Same path a landed or towed sim event takes (handleEvents -> landAt).
    (c as unknown as { landAt(id: string): void }).landAt('merrow');
    await c.lastSave;
    expect(order).toEqual(['completed', 'save']);
    expect(done[0].pay).toBe(700);
    expect(c.world.missions).toHaveLength(0);
    expect(saved[0].credits).toBe(credits + 700);
    expect(saved[0].missions).toEqual([]);
  });

  it('completing two missions on landing adds 2 to stats.jobsDone', async () => {
    const { c } = await setup();
    c.beginSession(c.world, { id: 'p1', name: 'Ava' }, 'halcyon');
    c.world = { ...c.world, missions: [{ ...deliver(), id: 'j1' }, { ...deliver(), id: 'j2' }] };
    (c as unknown as { landAt(id: string): void }).landAt('merrow');
    expect(c.world.stats.jobsDone).toBe(2);
  });

  it('plotRoute returns the setRoute result; clearRoute empties the course', async () => {
    const { c } = await setup();
    expect(c.plotRoute('vesk')).toEqual({ ok: true });
    expect(c.world.route).toEqual(['vesk']);
    c.clearRoute();
    expect(c.world.route).toEqual([]);
  });

  describe('targeting ships', () => {
    const tab = (target: EventTarget, c: Controller) => {
      target.dispatchEvent(keyEvent('keydown', 'Tab'));
      c.update(1 / 60);
      target.dispatchEvent(keyEvent('keyup', 'Tab'));
      c.update(1 / 60);
    };

    it('Tab cycles ships nearest first, then planets, then none', async () => {
      const { c, data, target } = await setup();
      const ports = Object.values(data.planets).filter((p) => p.systemId === c.world.systemId).length;
      expect(ports).toBeGreaterThanOrEqual(2);
      const fly = (id: string, dx: number) => ({
        ...c.traffic.npcs[0],
        id,
        ship: { ...c.traffic.npcs[0].ship, pos: { x: c.world.ship.pos.x + dx, y: c.world.ship.pos.y } },
      });
      expect(c.traffic.npcs.length).toBeGreaterThanOrEqual(1);
      c.traffic = { ...c.traffic, nextSpawnSec: 999, npcs: [fly('far', 900), fly('near', 300)] };
      c.startFlight();
      const seen: string[] = [];
      for (let i = 0; i < 3 + ports; i++) {
        tab(target, c);
        seen.push(c.traffic.targetId ?? c.world.targetPlanetId ?? 'none');
        if (c.traffic.targetId) expect(c.world.targetPlanetId).toBeNull();
      }
      expect(seen.slice(0, 2)).toEqual(['near', 'far']);
      expect(c.data.planets[seen[2]]).toBeDefined();
      expect(seen[2 + ports]).toBe('none');
      expect(c.traffic.targetId).toBeNull();
      expect(c.world.targetPlanetId).toBeNull();
    });

    it('targetShip targets a ship and clears the planet target; selectPlanet clears the ship', async () => {
      const { c } = await setup();
      const id = c.traffic.npcs[0].id;
      c.selectPlanet('halcyon');
      c.targetShip(id);
      expect(c.traffic.targetId).toBe(id);
      expect(c.world.targetPlanetId).toBeNull();
      c.selectPlanet('halcyon');
      expect(c.traffic.targetId).toBeNull();
      c.targetShip(id);
      c.targetShip(null);
      expect(c.traffic.targetId).toBeNull();
    });

    it('reseeds when the pilot arrives in a new system', async () => {
      const { c } = await setup();
      c.traffic = { ...c.traffic, systemId: 'elsewhere', npcs: [] };
      c.startFlight();
      c.update(1 / 60);
      expect(c.traffic.systemId).toBe(c.world.systemId);
    });
  });

  describe('encounters', () => {
    it('a hail lapses after 30 s', async () => {
      const { c } = await setup();
      c.startFlight();
      c.forceEncounter('stranded-passenger');
      expect(c.pending?.kind).toBe('hail');
      for (let i = 0; i < 4 * 29; i++) c.update(0.25);
      expect(c.pending).not.toBeNull();
      for (let i = 0; i < 8; i++) c.update(0.25);
      expect(c.pending).toBeNull();
    });

    it('leaving the system clears a pending encounter', async () => {
      const data = { ...(await loadGameData()) };
      const c = new Controller({ ...data, encounters: {} }, { ...DEFAULT_SETTINGS }, new EventTarget());
      c.startFlight();
      c.pending = { def: data.encounters['cargo-drift'], npcName: 'X', kind: 'site', pos: { x: 0, y: 0 } };
      c.world = { ...c.world, route: ['vesk'], jump: { toSystemId: 'vesk', t: 99 } };
      c.update(0.1);
      expect(c.world.systemId).toBe('vesk');
      expect(c.pending).toBeNull();
    });

    it('the interact key opens the card (flight pauses); the context button does too', async () => {
      const { c, target } = await setup();
      const seen: ControllerEvent[] = [];
      c.on('encounter', (e) => seen.push(e));
      c.startFlight();
      c.forceEncounter('stranded-passenger');
      target.dispatchEvent(keyEvent('keydown', 'KeyY'));
      c.update(0.1);
      expect(seen).toHaveLength(1);
      expect(c.isFlying).toBe(false);
      c.startFlight();
      c.doContextAction();
      c.update(0.1);
      expect(seen).toHaveLength(2);
    });

    it('a tow clears the pending encounter', async () => {
      const { c, data } = await setup(['vesk']);
      const w = newWorld(data, 1);
      c.beginSession({ ...w, systemId: 'vesk', ship: { ...w.ship, fuel: 0 } }, { id: 'p1', name: 'Ava' }, 'halcyon');
      c.leavePlanet();
      c.world = { ...c.world, systemId: 'vesk' };
      c.forceEncounter('stranded-passenger');
      expect(c.pending).not.toBeNull();
      c.pauseFlight();
      expect(c.callTow()).toBe(true);
      expect(c.pending).toBeNull();
      expect(c.traffic.systemId).toBe(c.world.systemId);
    });

    it('declining a hail clears it; a site stays', async () => {
      const { c } = await setup();
      c.startFlight();
      c.forceEncounter('stranded-passenger');
      c.declineEncounter();
      expect(c.pending).toBeNull();
      c.forceEncounter('cargo-drift');
      c.declineEncounter();
      expect(c.pending?.kind).toBe('site');
    });

    it('a hail cannot be answered while in hyperspace', async () => {
      const { c } = await setup();
      c.startFlight();
      c.forceEncounter('stranded-passenger');
      c.world = { ...c.world, jump: { toSystemId: 'vesk', t: 0.1 } };
      expect(c.openEncounter()).toBe(false);
      expect(c.isFlying).toBe(true);
    });

    it('pausing flight stops the engine flame', async () => {
      const { c, target } = await setup();
      c.startFlight();
      target.dispatchEvent(keyEvent('keydown', 'ArrowUp'));
      c.update(0.1);
      expect(c.view().thrusting).toBe(true);
      c.pauseFlight();
      expect(c.view().thrusting).toBe(false);
      c.startFlight();
      c.update(0.1);
      expect(c.view().thrusting).toBe(true);
      c.releaseInputs();
      expect(c.view().thrusting).toBe(false);
    });

    it('an offered encounter counts toward the no-two-days-in-a-row rule', async () => {
      const data = await loadGameData();
      let found = false;
      for (let day = 1; day < 200 && !found; day++) {
        const c = new Controller(data, { ...DEFAULT_SETTINGS }, new EventTarget());
        c.startFlight();
        c.world = { ...c.world, day, route: ['vesk'], jump: { toSystemId: 'vesk', t: 99 } };
        c.update(0.1);
        if (c.pending) {
          found = true;
          expect(c.world.lastEncounterDay).toBe(c.world.day);
        } else expect(c.world.lastEncounterDay).toBeNull();
      }
      expect(found).toBe(true);
    });

    it('choosing applies the outcome, clears the encounter and refuses a blocked choice', async () => {
      const { c } = await setup();
      c.forceEncounter('stranded-passenger');
      const before = c.world.missions.length;
      const r = c.chooseEncounter(0);
      expect(r?.messages.length).toBeGreaterThan(0);
      expect(c.world.missions).toHaveLength(before + 1);
      expect(c.pending).toBeNull();

      c.forceEncounter('cheap-goods-pedlar');
      c.world = { ...c.world, credits: 0 };
      const view = c.encounterView()!;
      expect(view.choices.some((x) => x.blocked !== null)).toBe(true);
      const idx = view.choices.findIndex((x) => x.blocked !== null);
      expect(c.chooseEncounter(idx)).toBeNull();
      expect(c.pending).not.toBeNull();
    });
  });
});

describe('Controller story steps in flight', () => {
  const card = {
    title: 'A signal',
    text: 'The ship hails you.',
    choices: [
      { label: 'Listen', outcomes: [{ type: 'flag' as const, flag: 'heard' }] },
      { label: 'Pay', outcomes: [], needs: { credits: 999999 } },
    ],
  };
  const mission = (id: string, steps: StoryMissionDef['steps']): StoryMissionDef => ({
    id,
    arc: 'side',
    title: `Story ${id}`,
    giver: { name: 'Ansel Voss', title: 'Dockmaster' },
    offer: { where: 'bar', ports: ['halcyon'] },
    text: 'offer',
    acceptText: 'ok',
    declinable: true,
    steps,
    onComplete: [],
  });
  const scan = mission('sc', [
    { kind: 'scan', system: 'calder', site: { label: 'Wreck' }, text: 'Scan the wreck.' },
    { kind: 'land', planet: 'halcyon', text: 'Land.' },
  ]);
  const find = mission('fi', [{ kind: 'find', system: 'calder', site: { label: 'Cache' }, text: 'Find the cache.' }]);
  const meet = mission('me', [
    { kind: 'meet', system: 'calder', ship: { name: 'Orrin Vale', shipId: 'courier', government: 'concord' }, card, text: 'Meet Orrin.' },
    { kind: 'land', planet: 'halcyon', text: 'Land.' },
  ]);

  /** A flying controller in calder with the given story missions taken. */
  async function flying(...defs: StoryMissionDef[]) {
    const data = { ...(await loadGameData()) };
    data.story = Object.fromEntries(defs.map((d) => [d.id, d]));
    const target = new EventTarget();
    const c = new Controller(data, { ...DEFAULT_SETTINGS }, target);
    c.beginSession(newWorld(data, 7), { id: 'p1', name: 'Ava' }, 'halcyon'); // fixed seed: random encounters must not vary the run
    for (const d of defs) c.acceptStory(d.id);
    c.leavePlanet();
    run(c, LANDING_FX_SEC + 0.1);
    return { c, data, target };
  }
  const jumpTo = (c: Controller, systemId: string) => {
    c.world = { ...c.world, route: [systemId], jump: { toSystemId: systemId, t: 99 } };
    c.update(0.1);
  };
  const gap = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);
  const press = (c: Controller, target: EventTarget, code: string) => {
    target.dispatchEvent(keyEvent('keydown', code));
    target.dispatchEvent(keyEvent('keyup', code));
    c.update(0.1);
  };

  it('places a scan site 600-1000 px from the centre', async () => {
    const { c } = await flying(scan);
    const site = c.storySite!;
    expect(site).toMatchObject({ missionId: 'sc', label: 'Wreck', hiddenUntilNear: false });
    const d = Math.hypot(site.pos.x, site.pos.y);
    expect(d).toBeGreaterThanOrEqual(600);
    expect(d).toBeLessThanOrEqual(1000);
    expect(c.sitePositions()).toContainEqual(site.pos);
  });

  it('leaving the system clears the story site and it returns on re-entry', async () => {
    const { c } = await flying(scan);
    const pos = c.storySite!.pos;
    jumpTo(c, 'vesk');
    expect(c.world.systemId).toBe('vesk');
    expect(c.storySite).toBeNull();
    expect(c.sitePositions().some((p) => p.x === pos.x && p.y === pos.y)).toBe(false);
    jumpTo(c, 'calder');
    expect(c.world.systemId).toBe('calder');
    expect(c.storySite?.pos).toEqual(pos);
  });

  it('a find site stays off radar until the ship is within 600 px', async () => {
    const { c } = await flying(find);
    const site = c.storySite!;
    expect(site.hiddenUntilNear).toBe(true);
    c.world = { ...c.world, ship: { ...c.world.ship, pos: { x: site.pos.x + 900, y: site.pos.y } } };
    expect(c.sitePositions()).toEqual([]);
    c.world = { ...c.world, ship: { ...c.world.ship, pos: { x: site.pos.x + 550, y: site.pos.y } } };
    expect(c.sitePositions()).toEqual([site.pos]);
  });

  it('interact at a site advances the step; too far away does not', async () => {
    const { c, target } = await flying(scan);
    const site = c.storySite!;
    const msgs: string[] = [];
    c.on('message', (e) => msgs.push(e.text));
    c.world = { ...c.world, ship: { ...c.world.ship, pos: { x: site.pos.x + 300, y: site.pos.y }, vel: { x: 0, y: 0 } } };
    press(c, target, 'KeyY');
    expect(c.world.story.active[0].step).toBe(0);
    c.world = { ...c.world, ship: { ...c.world.ship, pos: { ...site.pos }, vel: { x: 0, y: 0 } } };
    expect(c.currentContext()).toBe('openSite');
    expect(c.openSiteVerb()).toBe('Scan Wreck');
    press(c, target, 'KeyY');
    expect(c.world.story.active[0].step).toBe(1);
    expect(c.storySite).toBeNull();
    expect(msgs.join(' ')).toContain('Land.');
  });

  it('the context button fires a find site as Search', async () => {
    const { c } = await flying(find);
    const site = c.storySite!;
    c.world = { ...c.world, ship: { ...c.world.ship, pos: { ...site.pos }, vel: { x: 0, y: 0 } } };
    expect(c.openSiteVerb()).toBe('Search Cache');
    c.doContextAction();
    expect(c.world.story.done).toEqual(['fi']);
  });

  describe('site targets, autopilot, flyToSite and the objective', () => {
    const park = (c: Controller, x: number, y: number) => {
      c.world = { ...c.world, ship: { ...c.world.ship, pos: { x, y }, vel: { x: 0, y: 0 } }, targetPlanetId: null };
    };

    it('Tab targets the story site first, and the cycle ends with no target', async () => {
      const { c, target } = await flying(scan);
      press(c, target, 'Tab');
      expect(c.targetedSite()?.label).toBe('Wreck');
      expect(c.world.targetPlanetId).toBeNull();
      expect(c.traffic.targetId).toBeNull();
      const kinds: string[] = [];
      for (let i = 0; i < 30; i++) {
        press(c, target, 'Tab');
        const k = c.targetedSite() ? 'site' : c.traffic.targetId ? 'ship' : c.world.targetPlanetId ? 'planet' : 'none';
        kinds.push(k);
        if (k === 'none') break;
      }
      expect(kinds[kinds.length - 1]).toBe('none');
      expect(kinds.indexOf('site')).toBe(-1);
      expect(c.targetedSite()).toBeNull();
    });

    it('a find site is not targetable until revealed', async () => {
      const { c, target } = await flying(find);
      const site = c.storySite!;
      park(c, site.pos.x + 900, site.pos.y);
      expect(c.targetSites()).toEqual([]);
      press(c, target, 'Tab');
      expect(c.targetedSite()).toBeNull();
      park(c, site.pos.x + 500, site.pos.y);
      expect(c.targetSites().map((s) => s.label)).toEqual(['Cache']);
    });

    it('the pending encounter site is targetable too, sites nearest first', async () => {
      const { c, target } = await flying(scan);
      const enc = Object.values(c.data.encounters).find((e) => e.kind === 'site')!;
      park(c, 0, 0);
      c.forceEncounter(enc.id);
      const labels = c.targetSites().map((s) => s.label);
      expect(labels).toHaveLength(2);
      expect(labels).toContain(enc.title);
      press(c, target, 'Tab');
      const first = c.targetedSite()!;
      press(c, target, 'Tab');
      const second = c.targetedSite()!;
      expect(second.id).not.toBe(first.id);
      expect(Math.hypot(first.pos.x, first.pos.y)).toBeLessThanOrEqual(Math.hypot(second.pos.x, second.pos.y));
    });

    it('autopilot with a site targeted flies beside it and stops, ready to scan', async () => {
      const { c, target } = await flying(scan);
      const site = c.storySite!;
      park(c, 0, 0);
      press(c, target, 'Tab');
      expect(c.targetedSite()?.label).toBe('Wreck');
      press(c, target, 'KeyG');
      expect(c.world.assist.kind).toBe('autopilot');
      expect(c.world.assist).toMatchObject({ dest: { type: 'site', label: 'Wreck' } });
      for (let i = 0; i < 60 * 120 && c.world.assist.kind === 'autopilot'; i++) c.update(1 / 60);
      expect(c.world.assist.kind).toBe('none');
      expect(c.isFlying).toBe(true);
      expect(gap(c.world.ship.pos, site.pos)).toBeLessThan(60);
      expect(c.currentContext()).toBe('openSite');
      expect(c.openSiteVerb()).toBe('Scan Wreck');
    });

    it('the context button offers Fly to, engages the autopilot, then Scan', async () => {
      const { c } = await flying(scan);
      park(c, 0, 0);
      expect(c.currentContext()).toBe('flyToSite');
      expect(c.siteContextText()).toBe('Fly to Wreck');
      c.doContextAction();
      expect(c.targetedSite()?.label).toBe('Wreck');
      expect(c.world.assist.kind).toBe('autopilot');
      expect(c.currentContext()).toBe('takeControl');
      for (let i = 0; i < 60 * 120 && c.world.assist.kind === 'autopilot'; i++) c.update(1 / 60);
      expect(c.currentContext()).toBe('openSite');
      expect(c.siteContextText()).toBe('Scan Wreck');
      c.doContextAction();
      expect(c.world.story.active[0].step).toBe(1);
      expect(c.targetedSite()).toBeNull();
    });

    it('a targeted planet still wins over Fly to', async () => {
      const { c } = await flying(scan);
      park(c, 0, 0);
      c.selectPlanet('halcyon');
      expect(c.currentContext()).toBe('land');
    });

    it('a hidden find site offers no Fly to', async () => {
      const { c } = await flying(find);
      const site = c.storySite!;
      park(c, site.pos.x + 900, site.pos.y);
      expect(c.currentContext()).not.toBe('flyToSite');
      park(c, site.pos.x + 500, site.pos.y);
      expect(c.currentContext()).toBe('flyToSite');
      expect(c.siteContextText()).toBe('Fly to Cache');
    });

    it('the objective line names the site and its distance (or the system for a hidden one)', async () => {
      const { c } = await flying(scan);
      const site = c.storySite!;
      park(c, site.pos.x + 641, site.pos.y);
      expect(c.objectiveText()).toBe('Objective: scan the Wreck — out in space, 640 px');
      const f = await flying(find);
      const fs = f.c.storySite!;
      park(f.c, fs.pos.x + 900, fs.pos.y);
      expect(f.c.objectiveText()).toBe('Objective: search Calder for the Cache');
      park(f.c, fs.pos.x + 500, fs.pos.y);
      expect(f.c.objectiveText()).toBe('Objective: search the Cache — out in space, 500 px');
      const none = await flying(meet);
      expect(none.c.objectiveText()).toBeNull();
    });

    it('a find step landing notice says to fly around until the site shows on radar', async () => {
      const { c, target } = await flying(find);
      c.takeNotices();
      park(c, c.data.planets.halcyon.pos.x, c.data.planets.halcyon.pos.y - 5);
      c.selectPlanet('halcyon');
      press(c, target, 'KeyL');
      run(c, LANDING_FX_SEC + 0.2);
      expect(c.takeNotices().join(' ')).toContain('The Cache is out in space, not at this port. Fly around the system until it shows on the radar');
    });

    it('landing at a port in the site system leaves a notice that the site is out in space', async () => {
      const { c, target } = await flying(scan);
      c.takeNotices();
      park(c, c.data.planets.halcyon.pos.x, c.data.planets.halcyon.pos.y - 5);
      c.selectPlanet('halcyon');
      press(c, target, 'KeyL');
      run(c, LANDING_FX_SEC + 0.2);
      expect(c.landedPlanetId).toBe('halcyon');
      expect(c.takeNotices().join(' ')).toContain('The Wreck is out in space, not at this port. Target it with {nextTarget} and fly beside it.');
      expect(c.takeNotices()).toEqual([]);
    });
  });

  it('the meet ship waits at its hold position and never lands', async () => {
    const { c } = await flying(meet);
    expect(c.storyMeet).toMatchObject({ missionId: 'me' });
    const id = c.storyMeet!.npcId;
    for (let i = 0; i < 20 * 100; i++) c.update(0.05);
    const npc = c.traffic.npcs.find((n) => n.id === id)!;
    expect(npc).toBeDefined();
    expect(npc.name).toBe('Orrin Vale');
    expect(npc.phase).toBe('fly');
    expect(gap(npc.ship.pos, npc.hold!)).toBeLessThan(60);
    c.targetShip(id);
    expect(c.traffic.targetId).toBe(id);
  });

  it('a meet hail opens the card, and a card choice advances the step', async () => {
    const { c } = await flying(meet);
    expect(c.hailName()).toBe('Orrin Vale');
    const seen: ControllerEvent[] = [];
    c.on('encounter', (e) => seen.push(e));
    expect(c.openEncounter()).toBe(true);
    expect(seen).toHaveLength(1);
    expect(c.isFlying).toBe(false);
    const view = c.encounterView()!;
    expect(view.title).toBe('A signal');
    expect(view.choices.map((x) => x.blocked !== null)).toEqual([false, true]);
    expect(c.chooseEncounter(1)).toBeNull();
    const r = c.chooseEncounter(0)!;
    expect(r.messages.join(' ')).toContain('Land.');
    expect(c.world.flags).toContain('heard');
    expect(c.world.story.active[0].step).toBe(1);
    expect(c.storyMeet).toBeNull();
    expect(c.traffic.npcs.some((n) => n.name === 'Orrin Vale')).toBe(false);
  });

  it('declining a meet hail keeps it', async () => {
    const { c } = await flying(meet);
    c.openEncounter();
    c.declineEncounter();
    expect(c.storyMeet).not.toBeNull();
    expect(c.hailName()).toBe('Orrin Vale');
  });

  it('on a phone a meet hail is the context button only', async () => {
    const { c } = await flying(meet);
    expect(c.currentContext()).toBe('answerHail');
    expect(contextLabel('answerHail', c.world, c.data, c.openSiteVerb())).toBe('Answer hail');
    c.doContextAction();
    expect(c.isFlying).toBe(false);
    expect(c.encounterView()?.title).toBe('A signal');
  });

  const hailDef = (over: Partial<StoryMissionDef> = {}): StoryMissionDef => ({
    ...mission('hl', [
      { kind: 'go', system: 'tessaly', text: 'Go.' },
      { kind: 'land', planet: 'vanterre', text: 'Land.' },
    ]),
    offer: { where: 'hail', systems: ['tessaly'] },
    text: 'We saw you coming.',
    acceptText: 'Welcome in.',
    ...over,
  });
  /** Hailed in tessaly by a hail mission (flying() took it, so give it back first). */
  async function hailed(def: StoryMissionDef) {
    const f = await flying(def);
    f.c.world = { ...f.c.world, story: { ...f.c.world.story, active: [] }, missions: [] };
    jumpTo(f.c, 'tessaly');
    f.c.pending = null; // a random encounter may have rolled; these tests are about the story hail
    return f;
  }

  it('a hail mission that cannot be put off is taken on answering and shows its offer and accept text', async () => {
    const { c } = await hailed(hailDef({ declinable: false }));
    expect(c.storyHail).toBe('hl');
    expect(c.hailName()).toBe('Ansel Voss');
    expect(c.currentContext()).toBe('answerHail');
    expect(c.openEncounter()).toBe(true);
    expect(c.world.story.active.map((a) => a.id)).toEqual(['hl']);
    expect(c.world.story.active[0].step).toBe(1); // the arrival counted as the go step
    expect(c.storyHail).toBeNull();
    const view = c.encounterView()!;
    expect(view.text).toBe('We saw you coming. Welcome in.');
    expect(view.choices).toEqual([{ label: 'Understood', blocked: null }]);
    expect(view.noDecline).toBe(true);
    expect(c.chooseEncounter(0)).toEqual({ messages: [] });
    expect(c.encounterView()).toBeNull();
  });

  it('a declinable hail opens as an offer: Accept takes it', async () => {
    const { c } = await hailed(hailDef());
    expect(c.openEncounter()).toBe(true);
    expect(c.world.story.active).toEqual([]);
    const view = c.encounterView()!;
    expect(view.text).toBe('We saw you coming.');
    expect(view.choices).toEqual([{ label: 'Accept', blocked: null }]);
    expect(view.noDecline).toBeUndefined();
    const r = c.chooseEncounter(0)!;
    expect(r.messages[0]).toBe('Welcome in.');
    expect(c.world.story.active.map((a) => a.id)).toEqual(['hl']);
    expect(c.storyHail).toBeNull();
  });

  it('"Not now" on a story hail drops it below land on the context button, and a jump brings it back', async () => {
    const { c } = await hailed(hailDef());
    c.world = { ...c.world, targetPlanetId: null, assist: { kind: 'none' } };
    expect(c.currentContext()).toBe('answerHail');
    c.openEncounter();
    c.declineEncounter();
    expect(c.world.story.active).toEqual([]);
    expect(c.storyHail).toBe('hl'); // still hailing; the interact key can open it again
    expect(c.hailName()).toBe('Ansel Voss');
    expect(c.currentContext()).not.toBe('answerHail');
    const planet = Object.values(c.data.planets).find((p) => p.systemId === 'tessaly')!;
    c.world = { ...c.world, ship: { ...c.world.ship, pos: { x: planet.pos.x + 100, y: planet.pos.y } } };
    expect(c.currentContext()).toBe('land');
    c.world = { ...c.world, ship: { ...c.world.ship, pos: { x: 99999, y: 99999 } } };
    expect(c.currentContext()).toBe('plotCourse');
    c.startFlight(); // the card's close resumes flight
    expect(c.openEncounter()).toBe(true); // interact still answers it
    c.declineEncounter();
    c.startFlight();
    jumpTo(c, 'vesk');
    expect(c.storyHailQuiet).toBeNull();
  });

  it('a hail that cannot be taken says why and drops off the context button', async () => {
    const hold = Object.values((await loadGameData()).ships).find((x) => x.id === 'courier')!.cargo;
    const { c } = await hailed(
      hailDef({
        declinable: false,
        steps: [
          { kind: 'deliver', planet: 'vanterre', cargo: { name: 'Lead', tons: hold + 50 }, text: 'Carry.' },
        ],
      }),
    );
    const msgs: string[] = [];
    c.on('message', (e) => msgs.push(e.text));
    expect(c.openEncounter()).toBe(false);
    expect(msgs.join(' ')).toContain('Not enough free hold');
    expect(c.world.story.active).toEqual([]);
    expect(c.currentContext()).not.toBe('answerHail');
  });

  it('arrival advances a go step', async () => {
    const go = mission('go', [{ kind: 'go', system: 'vesk', text: 'Go to Vesk.' }, { kind: 'land', planet: 'halcyon', text: 'Back.' }]);
    const { c } = await flying(go);
    jumpTo(c, 'vesk');
    expect(c.world.story.active[0].step).toBe(1);
  });

  it('landing advances a land step and the message waits for the planet screen', async () => {
    const land = mission('ld', [{ kind: 'land', planet: 'halcyon', text: 'Land.' }]);
    const { c } = await flying(land);
    c.selectPlanet('halcyon');
    c.world = { ...c.world, assist: { kind: 'autopilot', dest: { type: 'planet', id: 'halcyon' }, autoLand: true } };
    for (let i = 0; i < 60 * 60 && c.landedPlanetId === null; i++) c.update(1 / 60);
    expect(c.landedPlanetId).toBe('halcyon');
    expect(c.world.story.done).toEqual(['ld']);
    expect(c.takeNotices().join(' ')).toContain('Story complete');
  });

  it('a missed deadline on a day advance shows as a message', async () => {
    const late = mission('late', [{ kind: 'deliver', planet: 'merrow', cargo: { name: 'Parcel', tons: 1 }, deadlineDays: 1, text: 'Deliver.' }]);
    const { c } = await flying(late);
    const msgs: string[] = [];
    c.on('message', (e) => msgs.push(e.text));
    c.world = { ...c.world, day: c.world.day + 5 };
    jumpTo(c, 'vesk');
    expect(msgs.join(' ')).toContain('Mission failed: Story late');
    expect(c.world.story.failed).toEqual(['late']);
  });

  it('loading a save mid-M3 at Brackwater brings the meet ship and its hail back', async () => {
    const data = await loadGameData();
    const target = new EventTarget();
    const c = new Controller(data, { ...DEFAULT_SETTINGS }, target);
    const w = newWorld(data, 7);
    c.beginSession(
      {
        ...w,
        systemId: 'brackwater',
        flags: ['core-cut'],
        story: { ...w.story, active: [{ id: 'm3-low-tide', step: 0, deadlineDay: null }] },
      },
      { id: 'p1', name: 'Ava' },
      'brackwater',
    );
    expect(c.storyMeet).toMatchObject({ missionId: 'm3-low-tide' });
    c.leavePlanet();
    run(c, LANDING_FX_SEC + 0.1);
    expect(c.traffic.npcs.some((n) => n.name === 'Low Tide')).toBe(true);
    expect(c.hailName()).toBe('Low Tide');
    expect(c.openEncounter()).toBe(true);
    expect(c.encounterView()?.title).toBe('The Low Tide');
  });

  it('a Concord pilot saved mid-C4 in Sootfall gets the meet ship and the hail back after loading', async () => {
    const data = await loadGameData();
    const store = new PilotStore(createStore('ctl-mid-c4', 'kv'));
    const first = new Controller(data, { ...DEFAULT_SETTINGS }, new EventTarget());
    first.store = store;
    const w = newWorld(data, 7);
    // Landed at Slagwater in Sootfall, Bram's system, with C4 taken and its meet step current.
    first.beginSession(
      {
        ...w,
        systemId: 'sootfall',
        day: 30,
        flags: ['core-cut', 'dimming-lane', 'side-concord', 'concord-1', 'concord-2', 'concord-3'],
        story: { ...w.story, active: [{ id: 'c4-brams-surrender', step: 0, deadlineDay: null }], done: ['m1-lights-out', 'm2-second-opinion', 'm3-low-tide', 'm4-past-the-charts', 'c1-lane-engineers', 'c2-lantern-cores', 'c3-three-lanterns'] },
      },
      { id: 'p1', name: 'Ava' },
      'slagwater',
    );
    await first.save();

    const { pilot } = await store.load('p1');
    expect(pilot.story.active).toEqual([{ id: 'c4-brams-surrender', step: 0, deadlineDay: null }]);
    const c = new Controller(data, { ...DEFAULT_SETTINGS }, new EventTarget());
    c.beginSession(worldFromPilot(pilot, data), { id: pilot.id, name: pilot.name }, pilot.planetId);
    expect(c.storyMeet).toMatchObject({ missionId: 'c4-brams-surrender' });
    c.leavePlanet();
    run(c, LANDING_FX_SEC + 0.1);
    expect(c.world.systemId).toBe('sootfall');
    expect(c.traffic.npcs.some((n) => n.name === 'Bram Kettle')).toBe(true);
    expect(c.hailName()).toBe('Bram Kettle');
    expect(c.openEncounter()).toBe(true);
    expect(c.encounterView()?.title).toBe('Bram Kettle');
  });
});
