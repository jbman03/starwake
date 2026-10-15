import type { ShipDef } from '../data/schemas';
import { wrap } from './flight';
import type { FlightInput, ShipState } from './types';
import { angleOf, len, norm, scale, sub, type Vec2 } from './vec';

const ALIGN = (10 * Math.PI) / 180;

/** Turn to face opposite the velocity (or hold heading if stopped). No thrust. */
export function reverseInput(ship: ShipState): FlightInput {
  const stopped = len(ship.vel) < 1e-6;
  return {
    thrust: false,
    turn: 0,
    targetHeading: stopped ? ship.heading : angleOf(scale(ship.vel, -1)),
  };
}

/** Retro-burn to a stop. `done` when speed < 1; caller then zeroes velocity. */
export function autoStopInput(ship: ShipState, _def: ShipDef): { input: FlightInput; done: boolean } {
  if (len(ship.vel) < 1) return { input: reverseInput(ship), done: true };
  const targetHeading = angleOf(scale(ship.vel, -1));
  const aligned = Math.abs(wrap(targetHeading - ship.heading)) < ALIGN;
  return { input: { thrust: aligned, turn: 0, targetHeading }, done: false };
}

export function faceInput(ship: ShipState, targetPos: Vec2): FlightInput {
  return { thrust: false, turn: 0, targetHeading: angleOf(sub(targetPos, ship.pos)) };
}

/** Velocity-matching steering toward dest; arrives when inside radius and slow. */
export function autopilotInput(
  ship: ShipState,
  def: ShipDef,
  dest: Vec2,
  arrivalRadius: number,
  arriveSpeed: number,
): { input: FlightInput; arrived: boolean } {
  const toDest = sub(dest, ship.pos);
  const d = len(toDest);
  const speed = len(ship.vel);
  if (d < arrivalRadius && speed < arriveSpeed) {
    return { input: { thrust: false, turn: 0, targetHeading: ship.heading }, arrived: true };
  }
  // Safety factor 0.7 (brief: 0.9) - 0.9 overshot because turn-around time is not modelled.
  const vMag = Math.min(
    def.maxSpeed,
    Math.sqrt(2 * def.acceleration * Math.max(d - arrivalRadius * 0.5, 0)) * 0.7,
  );
  const dv = sub(scale(norm(toDest), vMag), ship.vel);
  const targetHeading = angleOf(dv);
  const thrust = len(dv) > 5 && Math.abs(wrap(targetHeading - ship.heading)) < ALIGN;
  return { input: { thrust, turn: 0, targetHeading }, arrived: false };
}
