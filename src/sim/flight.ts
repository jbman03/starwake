import type { ShipDef } from '../data/schemas';
import type { FlightInput, ShipState } from './types';
import { add, fromAngle, len, scale } from './vec';

const TAU = Math.PI * 2;

/** Normalize an angle into (-PI, PI]. */
export const wrap = (a: number): number => {
  let r = a % TAU;
  if (r > Math.PI) r -= TAU;
  else if (r <= -Math.PI) r += TAU;
  return r;
};

/** Rotate heading toward target the short way by at most maxDelta, never overshooting. */
export function turnToward(heading: number, target: number, maxDelta: number): number {
  const diff = wrap(target - heading);
  if (Math.abs(diff) <= maxDelta) return wrap(target);
  return wrap(heading + Math.sign(diff) * maxDelta);
}

export function stepShip(ship: ShipState, def: ShipDef, input: FlightInput, dt: number): ShipState {
  const maxTurn = (def.turnRate * Math.PI / 180) * dt;
  const heading =
    input.targetHeading !== undefined
      ? turnToward(ship.heading, input.targetHeading, maxTurn)
      : wrap(ship.heading + input.turn * maxTurn);

  let vel = ship.vel;
  if (input.thrust) {
    vel = add(vel, scale(fromAngle(heading), def.acceleration * dt));
    const speed = len(vel);
    if (speed > def.maxSpeed) vel = scale(vel, def.maxSpeed / speed);
  }
  return { pos: add(ship.pos, scale(vel, dt)), vel: { ...vel }, heading, fuel: ship.fuel };
}
