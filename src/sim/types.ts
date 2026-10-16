import type { ActionId } from '../input/actions';
import type { Vec2 } from './vec';

export type ShipState = { pos: Vec2; vel: Vec2; heading: number; fuel: number };
export type FlightInput = { thrust: boolean; turn: -1 | 0 | 1; targetHeading?: number };

export type AutopilotDest = { type: 'planet'; id: string } | { type: 'jumpPoint' };

export type Assist =
  | { kind: 'none' }
  | { kind: 'reverse' }
  | { kind: 'autoStop' }
  | { kind: 'face' }
  | { kind: 'autopilot'; dest: AutopilotDest; autoLand: boolean };

export type Level = 'low' | 'med' | 'high';

/** A temporary market swing at one port for one good. */
export interface MarketEvent {
  templateId: string;
  portId: string;
  commodityId: string;
  startDay: number;
  days: number;
  strength: number;
}

export interface Mission {
  id: string;
  typeId: string;
  originId: string;
  destId: string;
  tons: number;
  passengers: number;
  pay: number;
  paidUpfront: boolean;
  /** Last day the mission can be completed, or null for no deadline. */
  deadlineDay: number | null;
  title: string;
  description: string;
  cargoName: string;
}

export interface WorldState {
  systemId: string;
  ship: ShipState;
  shipId: string;
  credits: number;
  targetPlanetId: string | null;
  assist: Assist;
  jump: { toSystemId: string; t: number } | null;
  timeSec: number;
  /** In-game day; day 0 is 1 Mar 3207. Advances only on jumps and tows. */
  day: number;
  /** Seed for all sim randomness (src/sim/random.ts). */
  seed: number;
  /** Trade goods in the hold: commodity id → tons. */
  cargo: Record<string, number>;
  missions: Mission[];
  /** Planned course: the systems still to jump to, next hop first. Empty when none is plotted. */
  route: string[];
  /** Visited (or charted) systems. */
  known: string[];
  /** Neighbours of known systems; never also in `known`. */
  seen: string[];
  /** Market pressure by "port:commodity"; an absent key means 1. */
  pressure: Record<string, number>;
  events: MarketEvent[];
}

export type SimEvent =
  | { type: 'landed'; planetId: string }
  | { type: 'jumped'; toSystemId: string }
  | { type: 'message'; text: string }
  | { type: 'towed'; planetId: string }
  | { type: 'arrived'; systemId: string; day: number };

export interface FrameInput {
  /** Actions currently held. */
  actions: ReadonlySet<ActionId>;
  /** Actions that went down this tick. */
  pressed: ReadonlySet<ActionId>;
  stick?: { angle: number; magnitude: number; mode: 'point' | 'classic' };
}
