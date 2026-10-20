import type { GameData, PlanetDef } from '../data/schemas';
import { autopilotInput, autoStopInput, faceInput, reverseInput } from './assists';
import { stepShip } from './flight';
import { economyDay } from './economy';
import { hopDistance, revealOnArrival, routeBetween } from './galaxy';
import { failOverdue } from './missions';
import { hashString } from './random';
import {
  canJump,
  canLand,
  jumpDestination,
  jumpPoint,
  pickLandTarget,
  planetsByDistance,
  refuelQuote,
  routeBroken,
  SYSTEM_CENTER,
  towDestination,
  type RefuelQuote,
} from './rules';
import { worldStats } from './shipStats';
import type { Assist, FlightInput, FrameInput, ShipState, SimEvent, WorldState } from './types';
import { add, angleOf, fromAngle, len, norm, scale, sub, type Vec2 } from './vec';

/** Autopilot considers itself arrived below this speed (px/s). */
export const AUTOPILOT_ARRIVE_SPEED = 20;
/** Seconds spent in hyperspace. */
export const JUMP_DURATION = 1.0;
/** Speed on arrival in the destination system (px/s). */
export const JUMP_ARRIVAL_SPEED = 100;
/** Arrive this far inside the jump boundary so an immediate re-jump is refused. */
export const JUMP_ARRIVAL_INSET = 50;
/** Stick magnitude above which the stick counts as manual input. */
export const STICK_DEADZONE = 0.25;
/** Point-mode stick magnitude above which the ship thrusts. */
export const STICK_THRUST = 0.6;

export const MSG_TOO_CLOSE = 'Too close to the star to jump. {autopilot} to fly out.';
export const MSG_NO_FUEL = 'Not enough fuel to jump.';
export const MSG_NO_DESTINATION = 'Choose a destination on the star map{map}.';
export const MSG_ROUTE_BROKEN = 'Course no longer valid — plot a new one on the star map.';

const NONE: Assist = { kind: 'none' };
const ZERO: Vec2 = { x: 0, y: 0 };

/** A position on the planet's edge, on the side away from the star, facing outward. */
function parkAt(world: WorldState, data: GameData, planet: PlanetDef): ShipState {
  let dir = norm(sub(planet.pos, SYSTEM_CENTER));
  if (len(dir) === 0) dir = { x: 1, y: 0 };
  const r = planet.radius + data.ships[world.shipId].radius;
  return { pos: add(planet.pos, scale(dir, r)), vel: { ...ZERO }, heading: angleOf(dir), fuel: world.ship.fuel };
}

/**
 * A fresh pilot's world at the start planet on day 0. The core systems and the start system are
 * known and their neighbours seen. `seed` defaults to the clock: the one non-deterministic input.
 */
export function newWorld(data: GameData, seed: number = hashString(Date.now())): WorldState {
  const { startSystemId, startPlanetId, startShipId, startCredits, knownAtStart } = data.config;
  const def = data.ships[startShipId];
  let map = { known: [] as string[], seen: [] as string[] };
  for (const id of new Set([...knownAtStart, startSystemId])) map = revealOnArrival(map.known, map.seen, data, id);
  const base: WorldState = {
    systemId: startSystemId,
    shipId: startShipId,
    ship: { pos: { ...ZERO }, vel: { ...ZERO }, heading: 0, fuel: def.fuelCapacity },
    credits: startCredits,
    targetPlanetId: null,
    assist: NONE,
    jump: null,
    timeSec: 0,
    day: 0,
    seed,
    cargo: {},
    missions: [],
    route: [],
    known: map.known,
    seen: map.seen,
    pressure: {},
    events: [],
    takenOffers: [],
    outfits: {},
    flags: [],
    notes: [],
    shipName: def.name,
    stats: { jobsDone: 0 },
    lastEncounterDay: null,
  };
  return { ...base, ship: parkAt(base, data, data.planets[startPlanetId]) };
}

/**
 * Let `n` days pass (one per jump, the hop count per tow): each day bumps `world.day`, then
 * applies that day's effects. This is the only place the date moves; the economy and mission
 * deadlines hook into the per-day step.
 */
export function advanceDays(world: WorldState, data: GameData, n: number): { world: WorldState; events: SimEvent[] } {
  const events: SimEvent[] = [];
  let w = world;
  for (let i = 0; i < n; i++) {
    w = { ...w, day: w.day + 1 };
    w = economyDay(w, data);
    const day = w.day;
    w = { ...w, takenOffers: w.takenOffers.filter((id) => Number(id.split(':').slice(-2)[0]) >= day) };
    const overdue = failOverdue(w);
    w = overdue.world;
    for (const m of overdue.failed) {
      events.push({ type: 'message', text: `Mission failed: ${m.title} — the deadline passed.` });
    }
  }
  return { world: w, events };
}

/**
 * Plot a course to `toSystemId`: fewest hops, through known or seen systems only. The destination
 * must itself be known or seen. Exception: when it is the destination system of an active
 * mission, the course may use any lane (the job's client supplies the charts). On failure the
 * world is returned unchanged.
 */
export function setRoute(
  world: WorldState,
  data: GameData,
  toSystemId: string,
): { world: WorldState; ok: boolean; reason?: 'noRoute' } {
  const charted = new Set([...world.known, ...world.seen]);
  const missionTarget = world.missions.some((m) => data.planets[m.destId]?.systemId === toSystemId);
  const route = missionTarget
    ? routeBetween(data, world.systemId, toSystemId, () => true)
    : charted.has(toSystemId)
      ? routeBetween(data, world.systemId, toSystemId, (id) => charted.has(id))
      : null;
  if (!route) return { world, ok: false, reason: 'noRoute' };
  // Setting a course means leaving: drop the planet target so the context button offers Jump.
  return { world: { ...world, route, targetPlanetId: null }, ok: true };
}

/** Enter `systemId`: it becomes known and its neighbours seen. The date is advanceDays' job. */
function enterSystem(world: WorldState, data: GameData, systemId: string): WorldState {
  return { ...world, ...revealOnArrival(world.known, world.seen, data, systemId) };
}

export function interruptAutopilot(world: WorldState): WorldState {
  return { ...world, assist: NONE };
}

/** Engage the autopilot toward the current system's jump point (the `autopilotOut` context action). */
export function autopilotToJumpPoint(world: WorldState): WorldState {
  return { ...world, assist: { kind: 'autopilot', dest: { type: 'jumpPoint' }, autoLand: false } };
}

/** Leave a planet: in its system, parked at its edge, at rest, no assist. */
export function departFrom(world: WorldState, data: GameData, planetId: string): WorldState {
  const planet = data.planets[planetId];
  const w = { ...world, systemId: planet.systemId };
  return { ...w, ship: parkAt(w, data, planet), assist: NONE, jump: null };
}

export function applyRefuel(
  world: WorldState,
  data: GameData,
  planetId: string,
): { world: WorldState; quote: RefuelQuote } {
  const capacity = worldStats(world, data).fuelCapacity;
  const quote = refuelQuote(world.ship.fuel, capacity, data.planets[planetId], world.credits);
  if (quote.units === 0) return { world, quote };
  return {
    world: {
      ...world,
      credits: world.credits - quote.cost,
      ship: { ...world.ship, fuel: Math.min(capacity, world.ship.fuel + quote.units) },
    },
    quote,
  };
}

/**
 * Tow a stranded ship to the nearest fuel planet, charging the tow fee (credits may go negative).
 * The tow takes a day per hop (at least one). A route through the tow system keeps its remaining
 * hops; one whose next hop isn't linked from there is cleared.
 */
export function applyTow(world: WorldState, data: GameData): { world: WorldState; events: SimEvent[] } {
  const planetId = towDestination(world, data);
  if (!planetId) return { world, events: [] };
  const toSystemId = data.planets[planetId].systemId;
  const days = Math.max(1, hopDistance(data, world.systemId, toSystemId));
  const moved = departFrom(
    { ...world, credits: world.credits - data.config.towFee, targetPlanetId: null },
    data,
    planetId,
  );
  let route = moved.route.slice(moved.route.indexOf(toSystemId) + 1); // indexOf -1 keeps it whole
  if (route.length > 0 && !data.systems[toSystemId].links.includes(route[0])) route = [];
  const entered = enterSystem({ ...moved, route }, data, toSystemId);
  const after = advanceDays(entered, data, days);
  return { world: after.world, events: [{ type: 'towed', planetId }, ...after.events] };
}

/** Heading toward the destination system's map position (the jump point's direction). */
export function jumpHeading(world: WorldState, data: GameData, toSystemId: string): number {
  const from = data.systems[world.systemId];
  const to = data.systems[toSystemId];
  const dir = from && to ? sub(to.mapPos, from.mapPos) : ZERO;
  return len(dir) === 0 ? world.ship.heading : angleOf(dir);
}

function arriveFromJump(world: WorldState, data: GameData, toSystemId: string): WorldState {
  const from = data.systems[world.systemId];
  const to = data.systems[toSystemId];
  // EV-style: arrive from the direction we came, on the side toward the origin's map position,
  // just inside the jump boundary so the player must fly out again before the next jump.
  let dir = norm(sub(from.mapPos, to.mapPos));
  if (len(dir) === 0) dir = { x: 1, y: 0 };
  const pos = add(SYSTEM_CENTER, scale(dir, to.jumpDistance - JUMP_ARRIVAL_INSET));
  const heading = angleOf(sub(SYSTEM_CENTER, pos));
  return {
    ...world,
    systemId: toSystemId,
    ship: { ...world.ship, pos, heading, vel: scale(fromAngle(heading), JUMP_ARRIVAL_SPEED) },
    jump: null,
    assist: NONE,
    targetPlanetId: null,
  };
}

function nextTargetId(world: WorldState, data: GameData): string | null {
  const sorted = planetsByDistance(world, data);
  if (sorted.length === 0) return null;
  const idx = sorted.findIndex((p) => p.id === world.targetPlanetId);
  // No target → nearest; past the last planet → no target, so phones can clear it (the
  // context button only offers Jump/Autopilot when nothing is targeted).
  return idx === sorted.length - 1 ? null : sorted[idx + 1].id;
}

function currentTarget(world: WorldState, data: GameData): PlanetDef | null {
  const p = world.targetPlanetId ? data.planets[world.targetPlanetId] : undefined;
  return p && p.systemId === world.systemId ? p : null;
}

const isLandingAutopilot = (a: Assist) => a.kind === 'autopilot' && a.dest.type === 'planet' && a.autoLand;

/** Manual flight input from held keys and the stick, or null if the player isn't flying manually. */
function manualInput(world: WorldState, input: FrameInput): FlightInput | null {
  const held = input.actions;
  const stick = input.stick && input.stick.magnitude > STICK_DEADZONE ? input.stick : undefined;
  const keyTurn = (held.has('turnRight') ? 1 : 0) - (held.has('turnLeft') ? 1 : 0);
  const anyKey = held.has('thrust') || held.has('reverse') || keyTurn !== 0;
  if (!anyKey && !stick) return null;

  let thrust = held.has('thrust');
  if (held.has('reverse')) return { ...reverseInput(world.ship), thrust };

  let turn = keyTurn as -1 | 0 | 1;
  let targetHeading: number | undefined;
  if (stick?.mode === 'point') {
    targetHeading = stick.angle;
    thrust ||= stick.magnitude > STICK_THRUST;
  } else if (stick?.mode === 'classic' && turn === 0) {
    const x = Math.cos(stick.angle) * stick.magnitude;
    if (Math.abs(x) > STICK_DEADZONE) turn = x > 0 ? 1 : -1;
  }
  return targetHeading === undefined ? { thrust, turn } : { thrust, turn, targetHeading };
}

function destPos(world: WorldState, data: GameData, a: Extract<Assist, { kind: 'autopilot' }>): Vec2 | null {
  if (a.dest.type === 'jumpPoint') return jumpPoint(world, data);
  const p = data.planets[a.dest.id];
  return p && p.systemId === world.systemId ? p.pos : null;
}

export function stepWorld(
  world: WorldState,
  data: GameData,
  input: FrameInput,
  dt: number,
  opts: { autoLandOnArrival: boolean },
): { world: WorldState; events: SimEvent[] } {
  const def = data.ships[world.shipId];
  const events: SimEvent[] = [];
  let w: WorldState = { ...world, timeSec: world.timeSec + dt };

  // In hyperspace: coast while turning to face the destination at the ship's turn rate;
  // ignore every action.
  if (w.jump) {
    const t = w.jump.t + dt;
    const face: FlightInput = { thrust: false, turn: 0, targetHeading: jumpHeading(w, data, w.jump.toSystemId) };
    const coasted = { ...w, ship: stepShip(w.ship, def, face, dt) };
    if (t >= JUMP_DURATION - 1e-9) {
      const toSystemId = w.jump.toSystemId;
      events.push({ type: 'jumped', toSystemId });
      let arrived = arriveFromJump(coasted, data, toSystemId);
      if (arrived.route[0] === toSystemId) arrived = { ...arrived, route: arrived.route.slice(1) };
      arrived = enterSystem(arrived, data, toSystemId);
      const after = advanceDays(arrived, data, 1);
      events.push(...after.events, { type: 'arrived', systemId: toSystemId, day: after.world.day });
      return { world: after.world, events };
    }
    return { world: { ...coasted, jump: { ...w.jump, t } }, events };
  }

  const pressed = input.pressed;

  if (pressed.has('nextTarget')) w = { ...w, targetPlanetId: nextTargetId(w, data) };

  if (pressed.has('land')) {
    if (isLandingAutopilot(w.assist)) {
      const id = pickLandTarget(w, data, true);
      if (id) w = { ...w, targetPlanetId: id, assist: { kind: 'autopilot', dest: { type: 'planet', id }, autoLand: true } };
    } else {
      const id = pickLandTarget(w, data, false);
      if (id && canLand(w, data, id)) {
        events.push({ type: 'landed', planetId: id });
        return { world: { ...w, targetPlanetId: id, assist: NONE, ship: { ...w.ship, vel: { ...ZERO } } }, events };
      }
      if (id) w = { ...w, targetPlanetId: id, assist: { kind: 'autopilot', dest: { type: 'planet', id }, autoLand: true } };
    }
  }

  if (pressed.has('autopilot')) {
    if (w.assist.kind === 'autopilot') {
      w = { ...w, assist: NONE };
    } else {
      const target = currentTarget(w, data);
      w = {
        ...w,
        assist: target
          ? { kind: 'autopilot', dest: { type: 'planet', id: target.id }, autoLand: opts.autoLandOnArrival }
          : { kind: 'autopilot', dest: { type: 'jumpPoint' }, autoLand: false },
      };
    }
  }

  if (pressed.has('faceTarget') && currentTarget(w, data)) w = { ...w, assist: { kind: 'face' } };
  if (pressed.has('autoStop')) w = { ...w, assist: { kind: 'autoStop' } };

  if (pressed.has('jump')) {
    const check = canJump(w, data);
    const toSystemId = jumpDestination(w, data);
    if (routeBroken(w, data)) {
      // Stale course (e.g. after a data change): drop it rather than jump somewhere unplanned.
      w = { ...w, route: [] };
      events.push({ type: 'message', text: MSG_ROUTE_BROKEN });
    } else if (check.ok && toSystemId) {
      w = {
        ...w,
        assist: NONE,
        jump: { toSystemId, t: 0 },
        ship: { ...w.ship, fuel: w.ship.fuel - data.config.fuelPerJump },
      };
    } else if (!check.ok && check.reason === 'tooClose') {
      events.push({ type: 'message', text: MSG_TOO_CLOSE });
    } else if (!check.ok && check.reason === 'noFuel') {
      events.push({ type: 'message', text: MSG_NO_FUEL });
    } else if (!check.ok && check.reason === 'noDestination') {
      events.push({ type: 'message', text: MSG_NO_DESTINATION });
    }
  }
  // firePrimary, fireSecondary, nearestHostile: accepted and ignored for now.

  // Manual flight cancels any assist; holding reverse *is* the reverse assist.
  const manual = manualInput(w, input);
  if (manual) w = { ...w, assist: input.actions.has('reverse') ? { kind: 'reverse' } : NONE };
  else if (w.assist.kind === 'reverse') w = { ...w, assist: NONE };

  let flight: FlightInput = manual ?? { thrust: false, turn: 0 };
  const a = w.assist;
  if (!manual && a.kind === 'autoStop') {
    const r = autoStopInput(w.ship, def);
    flight = r.input;
    if (r.done) w = { ...w, assist: NONE, ship: { ...w.ship, vel: { ...ZERO } } };
  } else if (!manual && a.kind === 'face') {
    const target = currentTarget(w, data);
    if (target) flight = faceInput(w.ship, target.pos);
    else w = { ...w, assist: NONE };
  } else if (!manual && a.kind === 'autopilot') {
    const dest = destPos(w, data, a);
    if (!dest) {
      w = { ...w, assist: NONE };
    } else {
      const r = autopilotInput(w.ship, def, dest, data.config.arrivalRadius, AUTOPILOT_ARRIVE_SPEED);
      if (r.arrived) {
        w = { ...w, assist: NONE, ship: { ...w.ship, vel: { ...ZERO } } };
        if (a.dest.type === 'planet' && a.autoLand) {
          events.push({ type: 'landed', planetId: a.dest.id });
          return { world: w, events };
        }
      }
      flight = r.input;
    }
  }

  // A jump started this tick: no thrust, the ship coasts and starts turning toward the destination.
  const jumpFlight: FlightInput | null = w.jump
    ? { thrust: false, turn: 0, targetHeading: jumpHeading(w, data, w.jump.toSystemId) }
    : null;
  let ship = stepShip(w.ship, def, jumpFlight ?? flight, dt);
  // A fuel scoop trickles fuel back in while flying (never while jumping).
  if (!w.jump) {
    const stats = worldStats(w, data);
    if (stats.fuelPerMin > 0) {
      ship = { ...ship, fuel: Math.min(stats.fuelCapacity, ship.fuel + (stats.fuelPerMin * dt) / 60) };
    }
  }
  return { world: { ...w, ship }, events };
}
