import { describe, expect, it } from 'vitest';
import config from '../../data/config.json';
import planets from '../../data/planets.json';
import ships from '../../data/ships.json';
import systems from '../../data/systems.json';
import { parseGameData } from '../data/load';
import type { ActionId } from '../input/actions';
import type { FrameInput, SimEvent, WorldState } from './types';
import { applyRefuel, applyTow, departFrom, interruptAutopilot, newWorld, stepWorld } from './world';
import { dist, len } from './vec';

const data = parseGameData({ ships, systems, planets, config });
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
    w = stepWorld(w, data, frame(['nextTarget']), DT, OPTS).world;
    expect(w.targetPlanetId).toBe('halcyon');
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
    let w = at(newWorld(data), { x: 2100, y: 0 });
    const events: SimEvent[] = [];
    let arrival: WorldState | null = null;
    for (let i = 0; i < 180; i++) {
      const r = stepWorld(w, data, i < 30 ? frame(['jump'], ['jump']) : frame(), DT, OPTS);
      w = r.world;
      events.push(...r.events);
      if (!arrival && r.events.some((e) => e.type === 'jumped')) arrival = w;
    }
    expect(events.filter((e) => e.type === 'jumped')).toEqual([{ type: 'jumped', toSystemId: 'vesk' }]);
    expect(events.filter((e) => e.type === 'message')).toEqual([]);
    expect(w.ship.fuel).toBe(200);
    expect(w.systemId).toBe('vesk');
    expect(arrival).not.toBeNull();
    expect(len(arrival!.ship.pos)).toBeCloseTo(1800, 6);
    expect(len(arrival!.ship.vel)).toBeCloseTo(100, 6);
    expect(arrival!.jump).toBeNull();
  });

  it('jump takes 1 second', () => {
    let w = at(newWorld(data), { x: 2100, y: 0 });
    w = stepWorld(w, data, frame(['jump']), DT, OPTS).world;
    expect(w.jump).toEqual({ toSystemId: 'vesk', t: 0 });
    expect(w.ship.fuel).toBe(200);
    const done = run(w, 2, OPTS, (_x, ev) => ev.length > 0);
    expect(done.world.timeSec - w.timeSec).toBeCloseTo(1, 6);
  });

  it('actions are ignored while jumping', () => {
    let w = at(newWorld(data), { x: 2100, y: 0 });
    w = stepWorld(w, data, frame(['jump']), DT, OPTS).world;
    const r = stepWorld(w, data, frame(['autopilot', 'land'], ['thrust']), DT, OPTS);
    expect(r.world.assist).toEqual({ kind: 'none' });
    expect(len(r.world.ship.vel)).toBe(0);
    expect(r.events).toEqual([]);
  });

  it('too close → message', () => {
    const r = stepWorld(newWorld(data), data, frame(['jump']), DT, OPTS);
    expect(r.events).toEqual([{ type: 'message', text: 'Too close to the star to jump. Press G to autopilot out.' }]);
    expect(r.world.jump).toBeNull();
    expect(r.world.ship.fuel).toBe(300);
  });

  it('no fuel → message', () => {
    const w = at(newWorld(data), { x: 2100, y: 0 }, { fuel: 99 });
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
    const r = applyTow(w, data);
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
