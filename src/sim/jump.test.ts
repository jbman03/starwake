import { describe, expect, it } from 'vitest';
import { testData } from '../data/testData';
import type { GameData } from '../data/schemas';
import type { ActionId } from '../input/actions';
import type { FrameInput, JumpPhase, SimEvent, WorldState } from './types';
import { canJump } from './rules';
import { JUMP_ARRIVAL_INSET, JUMP_ARRIVAL_SPEED, jumpEndPos, jumpFixedSec, jumpHeading, jumpProgress, newWorld, stepWorld } from './world';
import { len } from './vec';

const data = testData();
const J = data.config.jump;
const DT = 1 / 60;
const OPTS = { autoLandOnArrival: true };

const frame = (pressed: ActionId[] = [], held: ActionId[] = [], stick?: FrameInput['stick']): FrameInput => ({
  actions: new Set(held),
  pressed: new Set(pressed),
  stick,
});

/** Just outside calder's jump boundary with a course to vesk, at rest, facing `heading` (default: the destination). */
function ready(d: GameData = data, extra: Partial<WorldState['ship']> = {}): WorldState {
  const w0: WorldState = { ...newWorld(d, 1), route: ['vesk'] };
  const w = { ...w0, ship: { ...w0.ship, pos: { x: 2100, y: 0 }, vel: { x: 0, y: 0 } } };
  return { ...w, ship: { ...w.ship, heading: jumpHeading(w, d, 'vesk'), ...extra } };
}

type Tick = { world: WorldState; events: SimEvent[] };

/** Press jump on tick 0, then step with `inputAt(i)` until the jump ends (or maxTicks). Returns every tick. */
function fly(w: WorldState, d: GameData = data, inputAt: (i: number, w: WorldState) => FrameInput = () => frame(), maxTicks = 600): Tick[] {
  const ticks: Tick[] = [];
  for (let i = 0; i < maxTicks; i++) {
    const r = stepWorld(w, d, i === 0 ? frame(['jump']) : inputAt(i, w), DT, OPTS);
    w = r.world;
    ticks.push({ world: w, events: r.events });
    if (i > 0 && !w.jump) break;
  }
  return ticks;
}

const phases = (events: SimEvent[]): JumpPhase[] => events.flatMap((e) => (e.type === 'jumpPhase' ? [e.phase] : []));
const allEvents = (ticks: Tick[]) => ticks.flatMap((t) => t.events);
const firstTick = (ticks: Tick[], phase: JumpPhase) => ticks.findIndex((t) => phases(t.events).includes(phase));
const speed = (w: WorldState) => len(w.ship.vel);

describe('the phased jump', () => {
  it('phases run align → charge → burn → flash → arrive in order, each jumpPhase emitted once', () => {
    const ticks = fly(ready(data, { heading: 0 }));
    const events = allEvents(ticks);
    expect(phases(events)).toEqual(['align', 'charge', 'burn', 'flash', 'arrive']);
    expect(ticks[ticks.length - 1].world.jump).toBeNull();
    // At the system change: jumped, the day's events, arrived, then the arrive phase.
    const at = ticks[firstTick(ticks, 'arrive')].events.map((e) => e.type);
    expect(at[0]).toBe('jumped');
    expect(at.slice(-2)).toEqual(['arrived', 'jumpPhase']);
    expect(events.filter((e) => e.type === 'jumped')).toHaveLength(1);
    expect(events.filter((e) => e.type === 'arrived')).toHaveLength(1);
    // Each phase holds the world's jump state while it runs.
    for (const t of ticks.slice(0, -1)) expect(t.world.jump).not.toBeNull();
    for (const t of ticks.slice(firstTick(ticks, 'arrive'))) expect(t.world.systemId).toBe('vesk');
    for (const t of ticks.slice(0, firstTick(ticks, 'arrive'))) expect(t.world.systemId).toBe('calder');
  });

  it('align ends at once when already facing', () => {
    const ticks = fly(ready());
    expect(phases(ticks[0].events)).toEqual(['align']);
    expect(ticks[0].world.jump).toMatchObject({ toSystemId: 'vesk', phase: 'align', t: 0 });
    expect(phases(ticks[1].events)).toEqual(['charge']);
    expect(ticks[1].world.jump?.phase).toBe('charge');
    expect(ticks[1].world.jump?.t).toBeCloseTo(DT, 9);
  });

  it('align gives up after alignMaxSec', () => {
    const slow = { ...data, ships: { ...data.ships, shuttle: { ...data.ships.shuttle, turnRate: 30 } } };
    const w = ready(slow);
    const ticks = fly({ ...w, ship: { ...w.ship, heading: w.ship.heading + Math.PI } }, slow);
    const i = firstTick(ticks, 'charge');
    // Tick 0 starts the jump; align then runs alignMaxSec of ticks.
    expect(Math.abs(i * DT - J.alignMaxSec)).toBeLessThanOrEqual(DT + 1e-9);
    const off = Math.abs(Math.atan2(Math.sin(ticks[i].world.ship.heading - jumpHeading(w, slow, 'vesk')), Math.cos(ticks[i].world.ship.heading - jumpHeading(w, slow, 'vesk'))));
    expect(off).toBeGreaterThan((J.alignToleranceDeg * Math.PI) / 180);
    expect(phases(allEvents(ticks))).toEqual(['align', 'charge', 'burn', 'flash', 'arrive']);
  });

  it('charge coasts with no thrust; burn speeds the ship past def.maxSpeed', () => {
    const def = data.ships.shuttle;
    const w = ready();
    const h = w.ship.heading;
    const ticks = fly({ ...w, ship: { ...w.ship, vel: { x: Math.cos(h) * def.maxSpeed, y: Math.sin(h) * def.maxSpeed } } });
    const charge = ticks.filter((t) => t.world.jump?.phase === 'charge');
    expect(charge.length).toBeGreaterThan(0);
    for (const t of charge) expect(speed(t.world)).toBeCloseTo(def.maxSpeed, 9);
    expect(ticks.some((t) => t.world.jump?.phase === 'burn')).toBe(true);
    // The first flash tick finishes the burn, then coasts.
    const end = ticks[firstTick(ticks, 'flash')].world;
    expect(speed(end)).toBeGreaterThan(def.maxSpeed);
    expect(speed(end)).toBeCloseTo(def.maxSpeed + def.acceleration * J.burnThrustMul * J.burnSec, 6);
  });

  it('one big step runs every phase in order', () => {
    const w = ready(data, { heading: 0 });
    const start = stepWorld(w, data, frame(['jump']), DT, OPTS);
    const small = fly(w).slice(1);
    const big = stepWorld(start.world, data, frame(), 5, OPTS);
    expect(big.events).toEqual(allEvents(small));
    expect(phases(big.events)).toEqual(['charge', 'burn', 'flash', 'arrive']);
    expect(big.world.jump).toBeNull();
    const end = small[small.length - 1].world;
    expect(big.world.ship.pos.x).toBeCloseTo(end.ship.pos.x, 6);
    expect(big.world.ship.pos.y).toBeCloseTo(end.ship.pos.y, 6);
    expect(big.world.ship.vel.x).toBeCloseTo(end.ship.vel.x, 6);
    expect(big.world.ship.vel.y).toBeCloseTo(end.ship.vel.y, 6);
    expect(big.world.day).toBe(end.day);
  });

  it('skip during align, charge or burn goes straight to flash', () => {
    for (const skipIn of ['align', 'charge', 'burn'] as const) {
      const w = ready();
      // Point away so align lasts a few ticks.
      const start = skipIn === 'align' ? { ...w, ship: { ...w.ship, heading: w.ship.heading + Math.PI / 2 } } : w;
      let skipped = false;
      const ticks = fly(start, data, (_i, cur) => {
        if (!skipped && cur.jump?.phase === skipIn && cur.jump.t > 0) {
          skipped = true;
          return frame(['jump'], ['jump']);
        }
        return frame();
      });
      expect(skipped).toBe(true);
      const at = ticks.findIndex((t, i) => i > 0 && t.world.jump?.phase === 'flash');
      expect(ticks[at - 1].world.jump?.phase).toBe(skipIn);
      expect(phases(ticks[at].events)).toEqual(['flash']);
      expect(ticks[at].world.jump!.t).toBeLessThanOrEqual(DT + 1e-9);
      const order: JumpPhase[] = ['align', 'charge', 'burn'];
      expect(phases(allEvents(ticks))).toEqual([...order.slice(0, order.indexOf(skipIn) + 1), 'flash', 'arrive']);
      expect(ticks[ticks.length - 1].world.jump).toBeNull();
      expect(ticks[ticks.length - 1].world.systemId).toBe('vesk');
    }
  });

  it('skip during flash or arrive does nothing', () => {
    const plain = fly(ready());
    const pressing = fly(ready(), data, (_i, cur) => (cur.jump?.phase === 'flash' || cur.jump?.phase === 'arrive' ? frame(['jump'], ['jump']) : frame()));
    const events = allEvents(pressing);
    expect(events.filter((e) => e.type === 'jumped')).toHaveLength(1);
    expect(events.filter((e) => e.type === 'arrived')).toHaveLength(1);
    expect(events).toEqual(allEvents(plain));
    expect(pressing.map((t) => t.world)).toEqual(plain.map((t) => t.world));
  });

  it('arrive starts at arriveSpeedMul × maxSpeed and ends at today\'s arrival point and speed', () => {
    const def = data.ships.shuttle;
    const ticks = fly(ready());
    const i = firstTick(ticks, 'arrive');
    const first = ticks[i].world;
    const v0 = J.arriveSpeedMul * def.maxSpeed;
    const tIn = first.jump!.t;
    expect(speed(first)).toBeCloseTo(v0 + ((JUMP_ARRIVAL_SPEED - v0) * tIn) / J.arriveSec, 6);
    expect(speed(first)).toBeGreaterThan(v0 - ((v0 - JUMP_ARRIVAL_SPEED) * DT) / J.arriveSec - 1e-6);
    // Speed falls through the phase, along a fixed heading toward the centre.
    let prev = speed(first);
    for (const t of ticks.slice(i + 1)) {
      expect(speed(t.world)).toBeLessThan(prev);
      prev = speed(t.world);
      expect(t.world.ship.heading).toBeCloseTo(first.ship.heading, 12);
    }
    expect(first.ship.heading).toBeCloseTo(Math.atan2(-first.ship.pos.y, -first.ship.pos.x), 9);
    const end = ticks[ticks.length - 1].world;
    const calder = data.systems.calder.mapPos;
    const vesk = data.systems.vesk.mapPos;
    const r = data.systems.vesk.jumpDistance - JUMP_ARRIVAL_INSET;
    const a = Math.atan2(calder.y - vesk.y, calder.x - vesk.x);
    expect(Math.hypot(end.ship.pos.x - Math.cos(a) * r, end.ship.pos.y - Math.sin(a) * r)).toBeLessThan(1);
    expect(speed(end)).toBeCloseTo(JUMP_ARRIVAL_SPEED, 9);
    expect(end.ship.heading).toBeCloseTo(Math.atan2(-end.ship.pos.y, -end.ship.pos.x), 9);
    expect(end.jump).toBeNull();
  });

  it('input other than skip is ignored during the jump', () => {
    const noisy = frame(['autopilot', 'land', 'nextTarget', 'faceTarget', 'autoStop', 'map', 'firePrimary'], ['thrust', 'turnLeft', 'reverse'], {
      angle: 1,
      magnitude: 1,
      mode: 'point',
    });
    const ticks = fly(ready(data, { heading: 0 }));
    const during = ticks.slice(0, -1);
    expect(new Set(during.map((t) => t.world.jump!.phase)).size).toBe(5);
    for (const t of during) {
      const a = stepWorld(t.world, data, frame(), DT, OPTS);
      const b = stepWorld(t.world, data, noisy, DT, OPTS);
      expect(b.world).toEqual(a.world);
      expect(b.events).toEqual(a.events);
    }
  });

  it('fuel and day change exactly as before', () => {
    const w = ready();
    expect(w.ship.fuel).toBe(300);
    const ticks = fly(w);
    const i = firstTick(ticks, 'arrive');
    for (const t of ticks) expect(t.world.ship.fuel).toBe(300 - data.config.fuelPerJump);
    for (const t of ticks.slice(0, i)) expect(t.world.day).toBe(0);
    for (const t of ticks.slice(i)) expect(t.world.day).toBe(1);
    expect(ticks[i].events).toContainEqual({ type: 'arrived', systemId: 'vesk', day: 1 });
    expect(ticks[ticks.length - 1].world.route).toEqual([]);
  });

  it('a jump can\'t start while one is running', () => {
    const ticks = fly(ready());
    const seen = new Set<JumpPhase>();
    for (const t of ticks.slice(0, -1)) {
      seen.add(t.world.jump!.phase);
      expect(canJump(t.world, data)).toEqual({ ok: false, reason: 'jumping' });
    }
    expect([...seen]).toEqual(['align', 'charge', 'burn', 'flash', 'arrive']);
  });

  it('jumpProgress runs 0–1 within each phase; jumpFixedSec sums the fixed phases', () => {
    expect(jumpFixedSec(data)).toBeCloseTo(J.chargeSec + J.burnSec + J.flashSec + J.arriveSec, 12);
    expect(jumpProgress({ toSystemId: 'vesk', phase: 'align', t: J.alignMaxSec / 2 }, data)).toBeCloseTo(0.5, 12);
    expect(jumpProgress({ toSystemId: 'vesk', phase: 'charge', t: 0 }, data)).toBe(0);
    expect(jumpProgress({ toSystemId: 'vesk', phase: 'burn', t: J.burnSec }, data)).toBe(1);
    expect(jumpProgress({ toSystemId: 'vesk', phase: 'flash', t: 99 }, data)).toBe(1);
    expect(jumpProgress({ toSystemId: 'vesk', phase: 'arrive', t: J.arriveSec / 4 }, data)).toBeCloseTo(0.25, 12);
    // A facing jump takes exactly the fixed phases.
    const w = ready();
    const ticks = fly(w);
    const dur = ticks[ticks.length - 1].world.timeSec - ticks[0].world.timeSec;
    expect(Math.abs(dur - jumpFixedSec(data))).toBeLessThanOrEqual(DT + 1e-9);
  });

  it('jumpEndPos is where the arrive phase will end (the ship itself otherwise)', () => {
    const ticks = fly(ready());
    const end = ticks[ticks.length - 1].world.ship.pos;
    for (const t of ticks.slice(firstTick(ticks, 'arrive'))) {
      const p = jumpEndPos(t.world, data);
      expect(p.x).toBeCloseTo(end.x, 6);
      expect(p.y).toBeCloseTo(end.y, 6);
    }
    const before = ticks[firstTick(ticks, 'burn')].world;
    expect(jumpEndPos(before, data)).toEqual(before.ship.pos);
  });
});
