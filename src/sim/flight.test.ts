import { describe, it, expect } from 'vitest';
import type { ShipDef } from '../data/schemas';
import type { ShipState } from './types';
import { stepShip, turnToward } from './flight';
import { len } from './vec';

const def: ShipDef = {
  id: 't', name: 't', turnRate: 180, acceleration: 150, maxSpeed: 300, fuelCapacity: 100, radius: 10, cargo: 20, passengers: 4,
  price: 0, techTier: 1, shields: 0, armor: 0, outfitSpace: 0, role: 'starter', hull: 'pod', description: '', crew: 2,
};
const rest = (): ShipState => ({ pos: { x: 0, y: 0 }, vel: { x: 0, y: 0 }, heading: 0, fuel: 100 });
const run = (s: ShipState, input: Parameters<typeof stepShip>[2], secs: number, dt = 1 / 60) => {
  const n = Math.round(secs / dt);
  for (let i = 0; i < n; i++) s = stepShip(s, def, input, dt);
  return s;
};

describe('stepShip', () => {
  it('thrust 1s from rest gives vel.x ~ 150', () => {
    expect(run(rest(), { thrust: true, turn: 0 }, 1).vel.x).toBeCloseTo(150, 6);
  });
  it('clamps speed to maxSpeed', () => {
    expect(len(run(rest(), { thrust: true, turn: 0 }, 10).vel)).toBeCloseTo(300, 9);
  });
  it('drifts with no input', () => {
    const s = { ...rest(), vel: { x: 10, y: -4 } };
    const n = stepShip(s, def, { thrust: false, turn: 0 }, 0.5);
    expect(n.vel).toEqual({ x: 10, y: -4 });
    expect(n.pos.x).toBeCloseTo(5);
    expect(n.pos.y).toBeCloseTo(-2);
  });
  it('turn +1 for 0.5s changes heading by pi/2', () => {
    expect(run(rest(), { thrust: false, turn: 1 }, 0.5, 0.5 / 30).heading).toBeCloseTo(Math.PI / 2, 9);
  });
  it('targetHeading overrides turn', () => {
    const s = run(rest(), { thrust: false, turn: -1, targetHeading: 1 }, 2);
    expect(s.heading).toBeCloseTo(1, 9);
  });
  it('thrustMul scales the push and maxSpeed overrides the cap', () => {
    expect(stepShip(rest(), def, { thrust: true, turn: 0 }, 1, { thrustMul: 3 }).vel.x).toBeCloseTo(300, 9);
    const fast = { ...rest(), vel: { x: 300, y: 0 } };
    expect(stepShip(fast, def, { thrust: true, turn: 0 }, 1, { thrustMul: 3, maxSpeed: Infinity }).vel.x).toBeCloseTo(750, 9);
    expect(stepShip(fast, def, { thrust: true, turn: 0 }, 1, { thrustMul: 3 }).vel.x).toBeCloseTo(300, 9);
  });
  it('does not mutate input', () => {
    const s = rest();
    stepShip(s, def, { thrust: true, turn: 1 }, 0.1);
    expect(s).toEqual(rest());
  });
});

describe('turnToward', () => {
  it('limits to maxDelta', () => expect(turnToward(0, 3, 0.1)).toBeCloseTo(0.1, 12));
  it('no overshoot', () => expect(turnToward(0.05, 0, 0.1)).toBe(0));
  it('crosses the seam the short way', () => {
    const r = turnToward(3.1, -3, 0.1);
    expect(r).toBeCloseTo(3.2 - 2 * Math.PI, 9);
    expect(r).toBeGreaterThan(-Math.PI);
  });
  it('normalizes into (-pi, pi]', () => {
    expect(turnToward(3.1, 3.1, 0.1)).toBeCloseTo(3.1, 12);
    expect(turnToward(-3.1, -3.1 - 2 * Math.PI, 1)).toBeCloseTo(-3.1, 9);
  });
});
