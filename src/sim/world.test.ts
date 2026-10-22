import { describe, expect, it } from 'vitest';
import { onlyPorts, testData, withoutPorts } from '../data/testData';
import type { ActionId } from '../input/actions';
import type { FrameInput, SimEvent, WorldState } from './types';
import type { GameData } from '../data/schemas';
import { hopDistance } from './galaxy';
import { accept, offersAt } from './missions';
import {
  advanceDays,
  applyRefuel,
  applyTow,
  departFrom,
  interruptAutopilot,
  JUMP_ARRIVAL_INSET,
  JUMP_DURATION,
  jumpHeading,
  MSG_NO_DESTINATION,
  MSG_TOO_CLOSE,
  MSG_ROUTE_BROKEN,
  newWorld,
  setRoute,
  stepWorld,
} from './world';
import { dist, len } from './vec';

const data = testData();
const DT = 1 / 60;
const OPTS = { autoLandOnArrival: true };

const frame = (pressed: ActionId[] = [], held: ActionId[] = [], stick?: FrameInput['stick']): FrameInput => ({
  actions: new Set(held),
  pressed: new Set(pressed),
  stick,
});

const at = (w: WorldState, pos: { x: number; y: number }, extra: Partial<WorldState['ship']> = {}): WorldState => ({
  ...w,
  ship: { ...w.ship, pos, vel: { x: 0, y: 0 }, ...extra },
});

/** A fresh world with a course plotted to vesk (calder's neighbour). */
const toVesk = (): WorldState => ({ ...newWorld(data, 1), route: ['vesk'] });

/** Steps with no input until `until` returns true or maxSec elapses. */
function run(w: WorldState, maxSec: number, opts = OPTS, until?: (w: WorldState, ev: SimEvent[]) => boolean) {
  const events: SimEvent[] = [];
  for (let i = 0; i < maxSec / DT; i++) {
    const r = stepWorld(w, data, frame(), DT, opts);
    w = r.world;
    events.push(...r.events);
    if (until?.(w, events)) break;
  }
  return { world: w, events };
}

describe('newWorld', () => {
  it('starts parked at the start planet with full fuel and start credits', () => {
    const w = newWorld(data);
    expect(w.systemId).toBe('calder');
    expect(w.shipId).toBe('shuttle');
    expect(w.ship.fuel).toBe(300);
    expect(w.credits).toBe(10000);
    expect(len(w.ship.vel)).toBe(0);
    const h = data.planets.halcyon;
    expect(dist(w.ship.pos, h.pos)).toBeCloseTo(h.radius + data.ships.shuttle.radius, 6);
    expect(w.assist).toEqual({ kind: 'none' });
    expect(w.jump).toBeNull();
  });
});

describe('stepWorld: landing', () => {
  it('land near a slow planet lands immediately', () => {
    const r = stepWorld(newWorld(data), data, frame(['land']), DT, OPTS);
    expect(r.events).toEqual([{ type: 'landed', planetId: 'halcyon' }]);
  });

  it('land far away engages autopilot and emits exactly one landed event', () => {
    let w = at(newWorld(data), { x: 0, y: -1500 });
    const r1 = stepWorld(w, data, frame(['land']), DT, OPTS);
    w = r1.world;
    expect(r1.events).toEqual([]);
    expect(w.assist).toMatchObject({ kind: 'autopilot', autoLand: true, dest: { type: 'planet' } });
    const target = w.targetPlanetId;
    expect(target).not.toBeNull();
    const done = run(w, 60);
    const landed = done.events.filter((e) => e.type === 'landed');
    expect(landed).toEqual([{ type: 'landed', planetId: target }]);
    expect(done.world.assist).toEqual({ kind: 'none' });
  });

  it('pressing land again during the landing autopilot retargets to another planet', () => {
    let w = at(newWorld(data), { x: 0, y: -1500 });
    w = stepWorld(w, data, frame(['land']), DT, OPTS).world;
    const first = w.targetPlanetId;
    w = stepWorld(w, data, frame(), DT, OPTS).world;
    w = stepWorld(w, data, frame(['land']), DT, OPTS).world;
    expect(w.targetPlanetId).not.toBeNull();
    expect(w.targetPlanetId).not.toBe(first);
    expect(w.assist).toMatchObject({ kind: 'autopilot', autoLand: true, dest: { type: 'planet', id: w.targetPlanetId } });
  });
});

describe('stepWorld: autopilot', () => {
  it('to a planet with autoLandOnArrival off arrives stopped with no landed event', () => {
    const opts = { autoLandOnArrival: false };
    let w = newWorld(data);
    w = { ...w, targetPlanetId: 'merrow' };
    w = stepWorld(w, data, frame(['autopilot']), DT, opts).world;
    expect(w.assist).toEqual({ kind: 'autopilot', dest: { type: 'planet', id: 'merrow' }, autoLand: false });
    const done = run(w, 60, opts, (x) => x.assist.kind === 'none');
    expect(done.world.assist).toEqual({ kind: 'none' });
    expect(len(done.world.ship.vel)).toBe(0);
    expect(dist(done.world.ship.pos, data.planets.merrow.pos)).toBeLessThan(data.config.arrivalRadius);
    expect(done.events.filter((e) => e.type === 'landed')).toEqual([]);
  });

  it('with no target flies to the jump point and stops there', () => {
    let w = newWorld(data);
    w = stepWorld(w, data, frame(['autopilot']), DT, OPTS).world;
    expect(w.assist).toEqual({ kind: 'autopilot', dest: { type: 'jumpPoint' }, autoLand: false });
    const done = run(w, 60, OPTS, (x) => x.assist.kind === 'none');
    expect(done.world.assist).toEqual({ kind: 'none' });
    expect(len(done.world.ship.pos)).toBeGreaterThanOrEqual(2000);
    expect(done.events).toEqual([]);
  });

  it('pressing autopilot again cancels it', () => {
    let w = newWorld(data);
    w = stepWorld(w, data, frame(['autopilot']), DT, OPTS).world;
    w = stepWorld(w, data, frame(['autopilot']), DT, OPTS).world;
    expect(w.assist).toEqual({ kind: 'none' });
  });

  it('thrust input cancels autopilot', () => {
    let w = newWorld(data);
    w = stepWorld(w, data, frame(['autopilot']), DT, OPTS).world;
    w = stepWorld(w, data, frame([], ['thrust']), DT, OPTS).world;
    expect(w.assist).toEqual({ kind: 'none' });
  });

  it('a stick beyond the deadzone cancels autopilot; a tiny one does not', () => {
    let w = newWorld(data);
    w = stepWorld(w, data, frame(['autopilot']), DT, OPTS).world;
    w = stepWorld(w, data, frame([], [], { angle: 0, magnitude: 0.2, mode: 'point' }), DT, OPTS).world;
    expect(w.assist.kind).toBe('autopilot');
    w = stepWorld(w, data, frame([], [], { angle: 0, magnitude: 0.3, mode: 'classic' }), DT, OPTS).world;
    expect(w.assist).toEqual({ kind: 'none' });
  });

  it('interruptAutopilot clears the assist', () => {
    let w = newWorld(data);
    w = stepWorld(w, data, frame(['autopilot']), DT, OPTS).world;
    expect(interruptAutopilot(w).assist).toEqual({ kind: 'none' });
  });
});

describe('stepWorld: manual flight and assists', () => {
  it('held thrust accelerates along the heading', () => {
    let w = newWorld(data);
    for (let i = 0; i < 60; i++) w = stepWorld(w, data, frame([], ['thrust']), DT, OPTS).world;
    expect(len(w.ship.vel)).toBeGreaterThan(100);
  });

  it('point stick turns toward the stick angle and thrusts above 0.6', () => {
    let w = at(newWorld(data), { x: 0, y: -1500 }, { heading: 0 });
    for (let i = 0; i < 60; i++) {
      w = stepWorld(w, data, frame([], [], { angle: Math.PI / 2, magnitude: 1, mode: 'point' }), DT, OPTS).world;
    }
    expect(w.ship.heading).toBeCloseTo(Math.PI / 2, 6);
    expect(w.ship.vel.y).toBeGreaterThan(0);
  });

  it('classic stick right turns +1; held thrust still thrusts', () => {
    let w = at(newWorld(data), { x: 0, y: -1500 }, { heading: 0 });
    w = stepWorld(w, data, frame([], ['thrust'], { angle: 0, magnitude: 1, mode: 'classic' }), DT, OPTS).world;
    expect(w.ship.heading).toBeGreaterThan(0);
    expect(len(w.ship.vel)).toBeGreaterThan(0);
  });

  it('touch stick, point mode: angle π/2 at magnitude 0.7 turns toward π/2 and thrusts', () => {
    const w0 = at(newWorld(data), { x: 0, y: -1500 }, { heading: 0 });
    const stick = { angle: Math.PI / 2, magnitude: 0.7, mode: 'point' as const };
    const w1 = stepWorld(w0, data, frame([], [], stick), DT, OPTS).world;
    expect(w1.ship.heading).toBeGreaterThan(0);
    expect(len(w1.ship.vel)).toBeGreaterThan(0);
    let w = w1;
    for (let i = 0; i < 60; i++) w = stepWorld(w, data, frame([], [], stick), DT, OPTS).world;
    expect(w.ship.heading).toBeCloseTo(Math.PI / 2, 6);
  });

  it('touch stick, point mode: magnitude 0.5 turns but does not thrust', () => {
    const w0 = at(newWorld(data), { x: 0, y: -1500 }, { heading: 0 });
    const w = stepWorld(w0, data, frame([], [], { angle: Math.PI / 2, magnitude: 0.5, mode: 'point' }), DT, OPTS).world;
    expect(w.ship.heading).toBeGreaterThan(0);
    expect(len(w.ship.vel)).toBe(0);
  });

  it('touch stick, classic mode: angle 0 at magnitude 0.7 turns +1 without thrust', () => {
    const w0 = at(newWorld(data), { x: 0, y: -1500 }, { heading: 0 });
    const right = stepWorld(w0, data, frame([], [], { angle: 0, magnitude: 0.7, mode: 'classic' }), DT, OPTS).world;
    const keyRight = stepWorld(w0, data, frame([], ['turnRight']), DT, OPTS).world;
    expect(right.ship.heading).toBeGreaterThan(0);
    expect(right.ship.heading).toBeCloseTo(keyRight.ship.heading, 9);
    expect(len(right.ship.vel)).toBe(0);
  });

  it('autoStop brings the ship to exactly zero and clears the assist', () => {
    let w = at(newWorld(data), { x: 0, y: -1500 }, { vel: { x: 200, y: 0 } });
    w = { ...w, ship: { ...w.ship, vel: { x: 200, y: 0 } } };
    w = stepWorld(w, data, frame(['autoStop']), DT, OPTS).world;
    expect(w.assist).toEqual({ kind: 'autoStop' });
    const done = run(w, 10, OPTS, (x) => x.assist.kind === 'none');
    expect(done.world.assist).toEqual({ kind: 'none' });
    expect(done.world.ship.vel).toEqual({ x: 0, y: 0 });
  });

  it('holding reverse sets the reverse assist and cancels autopilot', () => {
    let w = newWorld(data);
    w = stepWorld(w, data, frame(['autopilot']), DT, OPTS).world;
    w = stepWorld(w, data, frame(['reverse'], ['reverse']), DT, OPTS).world;
    expect(w.assist).toEqual({ kind: 'reverse' });
    w = stepWorld(w, data, frame(), DT, OPTS).world;
    expect(w.assist).toEqual({ kind: 'none' });
  });

  it('nextTarget cycles planets by distance', () => {
    let w = newWorld(data); // at halcyon
    w = stepWorld(w, data, frame(['nextTarget']), DT, OPTS).world;
    expect(w.targetPlanetId).toBe('halcyon');
    w = stepWorld(w, data, frame(['nextTarget']), DT, OPTS).world;
    const second = w.targetPlanetId;
    expect(second).not.toBe('halcyon');
    w = stepWorld(w, data, frame(['nextTarget']), DT, OPTS).world;
    expect([second, 'halcyon']).not.toContain(w.targetPlanetId);
    // After the last planet the target clears, so a phone player can get back to Jump.
    w = stepWorld(w, data, frame(['nextTarget']), DT, OPTS).world;
    expect(w.targetPlanetId).toBeNull();
    w = stepWorld(w, data, frame(['nextTarget']), DT, OPTS).world;
    expect(w.targetPlanetId).toBe('halcyon');
  });

  it('plotting a course clears the planet target', () => {
    let w = newWorld(data);
    w = stepWorld(w, data, frame(['nextTarget']), DT, OPTS).world;
    expect(w.targetPlanetId).toBe('halcyon');
    const r = setRoute(w, data, 'vesk');
    expect(r.ok).toBe(true);
    expect(r.world.targetPlanetId).toBeNull();
    // A failed plot leaves the target alone.
    const bad = setRoute(w, data, 'no-such-system');
    expect(bad.ok).toBe(false);
    expect(bad.world.targetPlanetId).toBe('halcyon');
  });

  it('faceTarget turns toward the target', () => {
    let w = at(newWorld(data), { x: 0, y: 0 }, { heading: Math.PI });
    w = { ...w, targetPlanetId: 'halcyon' };
    w = stepWorld(w, data, frame(['faceTarget']), DT, OPTS).world;
    expect(w.assist).toEqual({ kind: 'face' });
    for (let i = 0; i < 120; i++) w = stepWorld(w, data, frame(), DT, OPTS).world;
    expect(w.ship.heading).toBeCloseTo(Math.atan2(-200, 700), 3);
  });

  it('fire and nearestHostile are accepted and ignored', () => {
    const w = newWorld(data);
    const r = stepWorld(w, data, frame(['firePrimary', 'fireSecondary', 'nearestHostile']), DT, OPTS);
    expect(r.events).toEqual([]);
    expect(r.world.assist).toEqual({ kind: 'none' });
  });
});

describe('stepWorld: jumping', () => {
  it('30 consecutive jump presses cost fuel once and emit one jumped event', () => {
    let w = at(toVesk(), { x: 2100, y: 0 });
    const events: SimEvent[] = [];
    for (let i = 0; i < 180; i++) {
      const r = stepWorld(w, data, i < 30 ? frame(['jump'], ['jump']) : frame(), DT, OPTS);
      w = r.world;
      events.push(...r.events);
    }
    expect(events.filter((e) => e.type === 'jumped')).toEqual([{ type: 'jumped', toSystemId: 'vesk' }]);
    expect(events.filter((e) => e.type === 'message')).toEqual([]);
    expect(w.ship.fuel).toBe(200);
    expect(w.systemId).toBe('vesk');
  });

  it('jump pressed on every tick for 90 ticks (through arrival) costs fuel once, one jumped event', () => {
    let w = at(toVesk(), { x: 2100, y: 0 });
    const events: SimEvent[] = [];
    for (let i = 0; i < 90; i++) {
      const r = stepWorld(w, data, frame(['jump'], ['jump']), DT, OPTS);
      w = r.world;
      events.push(...r.events);
    }
    expect(events.filter((e) => e.type === 'jumped')).toEqual([{ type: 'jumped', toSystemId: 'vesk' }]);
    expect(w.ship.fuel).toBe(200);
    expect(w.jump).toBeNull();
    expect(w.systemId).toBe('vesk');
    // Post-arrival presses are refused as too close, never as a second jump.
    for (const e of events.filter((x) => x.type === 'message')) {
      expect(e).toEqual({ type: 'message', text: MSG_TOO_CLOSE });
    }
  });

  it('arrives inside the jump boundary on the side toward the origin, facing the center at 100 px/s', () => {
    let w = at(toVesk(), { x: 2100, y: 0 });
    let arrival: WorldState | null = null;
    for (let i = 0; i < 90 && !arrival; i++) {
      const r = stepWorld(w, data, i === 0 ? frame(['jump']) : frame(), DT, OPTS);
      w = r.world;
      if (r.events.some((e) => e.type === 'jumped')) arrival = w;
    }
    expect(arrival).not.toBeNull();
    const a = arrival!;
    const calder = data.systems.calder.mapPos;
    const vesk = data.systems.vesk.mapPos;
    expect(len(a.ship.pos)).toBeCloseTo(data.systems.vesk.jumpDistance - JUMP_ARRIVAL_INSET, 6);
    expect(len(a.ship.pos)).toBeLessThan(data.systems.vesk.jumpDistance);
    expect(Math.atan2(a.ship.pos.y, a.ship.pos.x)).toBeCloseTo(Math.atan2(calder.y - vesk.y, calder.x - vesk.x), 6);
    expect(a.ship.heading).toBeCloseTo(Math.atan2(-a.ship.pos.y, -a.ship.pos.x), 6);
    expect(len(a.ship.vel)).toBeCloseTo(100, 6);
    expect(a.jump).toBeNull();
    // The very next tick cannot start another jump.
    const next = stepWorld(a, data, frame(['jump']), DT, OPTS);
    expect(next.world.jump).toBeNull();
    expect(next.world.ship.fuel).toBe(200);
  });

  it('jump takes 1 second', () => {
    let w = at(toVesk(), { x: 2100, y: 0 });
    w = stepWorld(w, data, frame(['jump']), DT, OPTS).world;
    expect(w.jump).toEqual({ toSystemId: 'vesk', t: 0 });
    expect(w.ship.fuel).toBe(200);
    const done = run(w, 2, OPTS, (_x, ev) => ev.length > 0);
    expect(done.world.timeSec - w.timeSec).toBeCloseTo(1, 6);
  });

  it('while jumping the ship turns to face the destination at its turn rate', () => {
    const calder = data.systems.calder.mapPos;
    const vesk = data.systems.vesk.mapPos;
    const want = Math.atan2(vesk.y - calder.y, vesk.x - calder.x);
    // Start a quarter turn off the destination.
    let w = at(toVesk(), { x: 2100, y: 0 }, { heading: want - Math.PI / 2 });
    expect(jumpHeading(w, data, 'vesk')).toBeCloseTo(want, 9);
    w = stepWorld(w, data, frame(['jump']), DT, OPTS).world;
    const maxStep = (data.ships[w.shipId].turnRate * Math.PI) / 180 * DT;
    let prev = w.ship.heading;
    let faced = false;
    for (let i = 0; i < 60 && w.jump; i++) {
      w = stepWorld(w, data, frame(), DT, OPTS).world;
      if (!w.jump) break;
      const step = Math.abs(Math.atan2(Math.sin(w.ship.heading - prev), Math.cos(w.ship.heading - prev)));
      expect(step).toBeLessThanOrEqual(maxStep + 1e-9);
      prev = w.ship.heading;
      if (Math.abs(Math.atan2(Math.sin(w.ship.heading - want), Math.cos(w.ship.heading - want))) < 1e-6) faced = true;
    }
    // 90° at the shuttle's turn rate fits inside the 1 s jump.
    expect(90 / data.ships[w.shipId].turnRate).toBeLessThan(JUMP_DURATION);
    expect(faced).toBe(true);
  });

  it('actions are ignored while jumping', () => {
    let w = at(toVesk(), { x: 2100, y: 0 });
    w = stepWorld(w, data, frame(['jump']), DT, OPTS).world;
    const r = stepWorld(w, data, frame(['autopilot', 'land'], ['thrust']), DT, OPTS);
    expect(r.world.assist).toEqual({ kind: 'none' });
    expect(len(r.world.ship.vel)).toBe(0);
    expect(r.events).toEqual([]);
  });

  it('too close → message', () => {
    const r = stepWorld(newWorld(data), data, frame(['jump']), DT, OPTS);
    expect(r.events).toEqual([{ type: 'message', text: MSG_TOO_CLOSE }]);
    expect(r.world.jump).toBeNull();
    expect(r.world.ship.fuel).toBe(300);
  });

  it('no fuel → message', () => {
    const w = at(toVesk(), { x: 2100, y: 0 }, { fuel: 99 });
    const r = stepWorld(w, data, frame(['jump']), DT, OPTS);
    expect(r.events).toEqual([{ type: 'message', text: 'Not enough fuel to jump.' }]);
    expect(r.world.jump).toBeNull();
  });
});

describe('refuel, tow, depart', () => {
  it('applyRefuel buys fuel and charges credits', () => {
    const w = { ...newWorld(data), ship: { ...newWorld(data).ship, fuel: 100 } };
    const r = applyRefuel(w, data, 'halcyon');
    expect(r.quote).toEqual({ units: 200, cost: 400 });
    expect(r.world.ship.fuel).toBe(300);
    expect(r.world.credits).toBe(9600);
  });

  it('applyRefuel from a fractional tank ends exactly at capacity with whole credits', () => {
    const w = { ...newWorld(data), ship: { ...newWorld(data).ship, fuel: 287.3333 } };
    const r = applyRefuel(w, data, 'halcyon');
    expect(r.world.ship.fuel).toBe(300);
    expect(Number.isInteger(r.quote.cost)).toBe(true);
    expect(Number.isInteger(r.world.credits)).toBe(true);
  });

  it('applyRefuel with negative credits buys nothing', () => {
    const w = { ...newWorld(data), credits: -300, ship: { ...newWorld(data).ship, fuel: 0 } };
    const r = applyRefuel(w, data, 'halcyon');
    expect(r.quote).toEqual({ units: 0, cost: 0, reason: 'noCredits' });
    expect(r.world.ship.fuel).toBe(0);
    expect(r.world.credits).toBe(-300);
  });

  it('applyTow moves a stranded ship to a fuel planet and charges the fee', () => {
    const w: WorldState = {
      ...newWorld(data), systemId: 'vesk', credits: 200, targetPlanetId: 'tallow-rock',
      ship: { pos: { x: 0, y: 0 }, vel: { x: 5, y: 5 }, heading: 0, fuel: 0 },
    };
    const r = applyTow(w, withoutPorts(data, 'vesk'));
    expect(r.events).toEqual([{ type: 'towed', planetId: 'halcyon' }]);
    expect(r.world.systemId).toBe('calder');
    expect(r.world.credits).toBe(-300);
    expect(r.world.targetPlanetId).toBeNull();
    expect(len(r.world.ship.vel)).toBe(0);
  });

  it('applyTow does nothing when not stranded', () => {
    const w = newWorld(data);
    expect(applyTow(w, data)).toEqual({ world: w, events: [] });
  });

  it('departFrom places the ship at the planet edge at rest', () => {
    const w = at(newWorld(data), { x: 5000, y: 5000 }, { vel: { x: 50, y: 0 } });
    const d = departFrom({ ...w, assist: { kind: 'autoStop' } }, data, 'merrow');
    const m = data.planets.merrow;
    expect(dist(d.ship.pos, m.pos)).toBeCloseTo(m.radius + data.ships.shuttle.radius, 6);
    expect(d.ship.vel).toEqual({ x: 0, y: 0 });
    expect(d.assist).toEqual({ kind: 'none' });
    expect(d.systemId).toBe('calder');
  });
});

describe('newWorld: world state v2', () => {
  it('starts on day 0 with empty cargo, missions, route, pressure and events', () => {
    const w = newWorld(data, 42);
    expect(w.seed).toBe(42);
    expect(w.day).toBe(0);
    expect(w.cargo).toEqual({});
    expect(w.missions).toEqual([]);
    expect(w.route).toEqual([]);
    expect(w.pressure).toEqual({});
    expect(w.events).toEqual([]);
  });

  it('knows the core systems and the start system; sees their neighbours, never both', () => {
    const w = newWorld(data, 1);
    expect(new Set(w.known)).toEqual(new Set([...data.config.knownAtStart, 'calder']));
    const neighbours = new Set(w.known.flatMap((id) => data.systems[id].links));
    for (const id of w.known) neighbours.delete(id);
    expect(new Set(w.seen)).toEqual(neighbours);
    expect(w.seen).toContain('vesk');
    expect(w.seen).not.toContain('skerry');
  });

  it('picks a seed when none is given', () => {
    expect(Number.isInteger(newWorld(data).seed)).toBe(true);
  });
});

/** Fly a jump from just outside the current system's jump distance; returns the arrival world and events. */
function jumpOnce(w: WorldState, d: GameData = data) {
  const sys = d.systems[w.systemId];
  w = { ...w, ship: { ...w.ship, pos: { x: sys.jumpDistance + 100, y: 0 }, vel: { x: 0, y: 0 } } };
  const events: SimEvent[] = [];
  for (let i = 0; i < 90; i++) {
    const r = stepWorld(w, d, i === 0 ? frame(['jump']) : frame(), DT, OPTS);
    w = r.world;
    events.push(...r.events);
    if (r.events.some((e) => e.type === 'jumped')) break;
  }
  return { world: w, events };
}

describe('stepWorld: destinations and routes', () => {
  it('no route and several links: noDestination message, no jump, no fuel', () => {
    const w0: WorldState = { ...newWorld(data, 1), systemId: 'mirren' };
    expect(data.systems.mirren.links).toHaveLength(2);
    const w = at(w0, { x: data.systems.mirren.jumpDistance + 100, y: 0 });
    const r = stepWorld(w, data, frame(['jump']), DT, OPTS);
    expect(r.events).toEqual([{ type: 'message', text: MSG_NO_DESTINATION }]);
    expect(MSG_NO_DESTINATION).toBe('Choose a destination on the star map{map}.');
    expect(r.world.jump).toBeNull();
    expect(r.world.ship.fuel).toBe(300);
  });

  it('route [vesk] from calder: arrives in vesk on day 1, route cleared, vesk known, its neighbours seen', () => {
    const { world: w, events } = jumpOnce(toVesk());
    expect(w.systemId).toBe('vesk');
    expect(w.day).toBe(1);
    expect(w.route).toEqual([]);
    expect(w.known).toContain('vesk');
    expect(w.seen).not.toContain('vesk');
    for (const n of data.systems.vesk.links) if (!w.known.includes(n)) expect(w.seen).toContain(n);
    expect(w.seen).toContain('lastlight');
    expect(w.ship.fuel).toBe(200);
    expect(events.filter((e) => e.type === 'jumped' || e.type === 'arrived')).toEqual([
      { type: 'jumped', toSystemId: 'vesk' },
      { type: 'arrived', systemId: 'vesk', day: 1 },
    ]);
  });

  it('a 3-hop route is followed by three jumps, advancing one hop and one day each', () => {
    const r = setRoute(newWorld(data, 1), data, 'corvana');
    expect(r.ok).toBe(true);
    const route = r.world.route;
    expect(route).toHaveLength(3);
    expect(route[2]).toBe('corvana');
    let w = r.world;
    for (let i = 0; i < 3; i++) {
      w = jumpOnce(w).world;
      expect(w.systemId).toBe(route[i]);
      expect(w.day).toBe(i + 1);
      expect(w.route).toEqual(route.slice(i + 1));
    }
    expect(w.systemId).toBe('corvana');
    expect(w.ship.fuel).toBe(0);
  });

  it('stale route (next hop not linked): route cleared with a message, no jump, no fuel', () => {
    const w = at({ ...newWorld(data, 1), route: ['skerry', 'redwater'] }, { x: 2100, y: 0 });
    const r = stepWorld(w, data, frame(['jump']), DT, OPTS);
    expect(r.events).toEqual([{ type: 'message', text: MSG_ROUTE_BROKEN }]);
    expect(MSG_ROUTE_BROKEN).toBe('Course no longer valid — plot a new one on the star map.');
    expect(r.world.route).toEqual([]);
    expect(r.world.jump).toBeNull();
    expect(r.world.ship.fuel).toBe(300);
    expect(r.world.day).toBe(0);
  });

  it('with a single link and no route, jumps there', () => {
    const one = { ...data, systems: { ...data.systems, mirren: { ...data.systems.mirren, links: ['vesk'] } } };
    const { world: w } = jumpOnce({ ...newWorld(data, 1), systemId: 'mirren' }, one);
    expect(w.systemId).toBe('vesk');
    expect(w.day).toBe(1);
  });
});

describe('setRoute', () => {
  it('plots a fewest-hop route to a seen neighbour', () => {
    const r = setRoute(newWorld(data, 1), data, 'vesk');
    expect(r).toMatchObject({ ok: true });
    expect(r.world.route).toEqual(['vesk']);
  });

  it('routes only through known or seen systems', () => {
    const w = newWorld(data, 1);
    const r = setRoute(w, data, 'brannock'); // seen (corvana's neighbour)
    expect(r.ok).toBe(true);
    const allowed = new Set([...w.known, ...w.seen]);
    for (const id of r.world.route) expect(allowed.has(id)).toBe(true);
    expect(r.world.route.at(-1)).toBe('brannock');
  });

  it('refuses an unknown-and-unseen destination with noRoute and leaves the world alone', () => {
    const w = { ...newWorld(data, 1), route: ['vesk'] };
    const r = setRoute(w, data, 'skerry');
    expect(r).toEqual({ world: w, ok: false, reason: 'noRoute' });
  });

  it('refuses a destination reachable only through unexplored systems', () => {
    // Only calder known and thistle seen: every path to thistle crosses unknown systems.
    const w = { ...newWorld(data, 1), known: ['calder'], seen: ['thistle'] };
    expect(setRoute(w, data, 'thistle')).toEqual({ world: w, ok: false, reason: 'noRoute' });
  });

  it('a route to the current system is empty', () => {
    const r = setRoute({ ...newWorld(data, 1), route: ['vesk'] }, data, 'calder');
    expect(r.ok).toBe(true);
    expect(r.world.route).toEqual([]);
  });
});

describe('applyTow: time and routes', () => {
  /** Only halcyon (calder) has a port, so a tow from brackwater travels 3 hops. */
  const dry: GameData = onlyPorts(data, 'halcyon');
  const stranded = (p: Partial<WorldState> = {}): WorldState => ({
    ...newWorld(data, 1),
    systemId: 'brackwater',
    ship: { pos: { x: 0, y: 0 }, vel: { x: 0, y: 0 }, heading: 0, fuel: 0 },
    ...p,
  });

  it('a tow from a fringe system 3 hops away advances 3 days and explores the destination', () => {
    const r = applyTow(stranded({ day: 5 }), dry);
    expect(r.events).toEqual([{ type: 'towed', planetId: 'halcyon' }]);
    expect(r.world.systemId).toBe('calder');
    expect(r.world.day).toBe(8);
    expect(r.world.known).toContain('calder');
  });

  it('a one-hop tow still advances one day', () => {
    const w: WorldState = { ...stranded(), systemId: 'vesk' };
    expect(applyTow(w, withoutPorts(data, 'vesk')).world.day).toBe(1);
  });

  it('clears a route whose next hop is not linked from the tow system', () => {
    expect(applyTow(stranded({ route: ['skerry', 'redwater'] }), dry).world.route).toEqual([]);
  });

  it('clears a route that ends in the tow system', () => {
    expect(applyTow(stranded({ route: ['lastlight', 'vesk', 'calder'] }), dry).world.route).toEqual([]);
  });

  it('keeps the rest of a route that passes through the tow system', () => {
    const r = applyTow(stranded({ route: ['lastlight', 'vesk', 'calder', 'tessaly'] }), dry);
    expect(r.world.route).toEqual(['tessaly']);
  });

  it('a tow into an unexplored system marks it known and its neighbours seen', () => {
    const fuelOnlyAtSkerry: GameData = onlyPorts(data, 'skerry-light');
    const r = applyTow(stranded(), fuelOnlyAtSkerry);
    expect(r.world.systemId).toBe('skerry');
    expect(r.world.known).toContain('skerry');
    expect(r.world.seen).toContain('redwater');
  });
});

describe('advanceDays', () => {
  it('owns the date: n days advance day by n', () => {
    const w = { ...newWorld(data, 1), day: 4 };
    const r = advanceDays(w, data, 3);
    expect(r.world.day).toBe(w.day + 3);
    expect(r.events).toEqual([]);
    expect(advanceDays(w, data, 0).world.day).toBe(4);
  });

  it('runs the story deadline check: a late side mission fails with a message', () => {
    const story = {
      id: 'late', arc: 'side', title: 'Late job', giver: { name: 'G', title: 'T' }, offer: { where: 'bar' as const, ports: ['halcyon'] },
      text: 'x', acceptText: 'y', declinable: true, onComplete: [],
      steps: [{ kind: 'deliver' as const, planet: 'merrow', cargo: { name: 'Parcel', tons: 1 }, deadlineDays: 1, text: 'd' }],
    };
    const d = { ...data, story: { late: story } } as typeof data;
    const w0 = newWorld(d, 1);
    const w = { ...w0, story: { ...w0.story, active: [{ id: 'late', step: 0, deadlineDay: w0.day + 1 }] } };
    const r = advanceDays(w, d, 3);
    expect(r.world.story.failed).toEqual(['late']);
    expect(r.events.some((e) => e.type === 'message' && e.text.includes('Mission failed: Late job'))).toBe(true);
  });

  it("a jump's arrived event carries the post-advance day", () => {
    const first = jumpOnce(toVesk());
    expect(first.events.find((e) => e.type === 'arrived')).toEqual({ type: 'arrived', systemId: 'vesk', day: 1 });
    expect(first.world.day).toBe(1);
  });

  it('a 3-hop tow ends 3 days later and emits towed', () => {
    const dry: GameData = onlyPorts(data, 'halcyon');
    const w: WorldState = {
      ...newWorld(data, 1),
      systemId: 'brackwater',
      ship: { pos: { x: 0, y: 0 }, vel: { x: 0, y: 0 }, heading: 0, fuel: 0 },
    };
    const r = applyTow(w, dry);
    expect(r.world.day).toBe(w.day + 3);
    expect(r.events).toEqual([{ type: 'towed', planetId: 'halcyon' }]);
  });
});

describe('setRoute to a mission destination', () => {
  /** Seed 1, day 0: Halcyon posts a garbage run to The Midden in Brackwater, which starts uncharted. */
  const garbage = () => {
    const w = newWorld(data, 1);
    const o = offersAt(w, data, 'halcyon').find((x) => x.typeId === 'dump' && sysOfPlanet(x.destId) === 'brackwater')!;
    return { w, o };
  };
  const sysOfPlanet = (id: string) => data.planets[id].systemId;

  it('accepting a job to an uncharted system lets you plot a course there', () => {
    const { w, o } = garbage();
    expect(o).toBeDefined();
    expect(w.known.includes('brackwater') || w.seen.includes('brackwater')).toBe(false);
    expect(setRoute(w, data, 'brackwater').ok).toBe(false);
    const taken = accept(w, data, o);
    const r = setRoute(taken, data, 'brackwater');
    expect(r.ok).toBe(true);
    expect(r.world.route.at(-1)).toBe('brackwater');
    expect(r.world.route.length).toBe(hopDistance(data, w.systemId, 'brackwater', []));
  });

  it('routes through any lane only for an active mission target', () => {
    // Only calder known and thistle seen: every path to thistle crosses unknown systems.
    const w = { ...newWorld(data, 1), known: ['calder'], seen: ['thistle'] };
    expect(setRoute(w, data, 'thistle').ok).toBe(false);
    const port = Object.values(data.planets).find((p) => p.systemId === 'thistle')!;
    const m = { id: 'm', typeId: 'delivery', originId: 'halcyon', destId: port.id, tons: 0, passengers: 0, pay: 1,
      paidUpfront: false, deadlineDay: null, title: '', description: '', cargoName: '' };
    const r = setRoute({ ...w, missions: [m] }, data, 'thistle');
    expect(r.ok).toBe(true);
    expect(r.world.route.at(-1)).toBe('thistle');
  });

  it('newWorld starts with empty story fields and the start ship name', () => {
    const w = newWorld(data, 1);
    expect(w).toMatchObject({ flags: [], notes: [], stats: { jobsDone: 0 }, lastEncounterDay: null });
    expect(w.shipName).toBe(data.ships[data.config.startShipId].name);
  });
});
