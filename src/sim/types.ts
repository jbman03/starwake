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

export interface WorldState {
  systemId: string;
  ship: ShipState;
  shipId: string;
  credits: number;
  targetPlanetId: string | null;
  assist: Assist;
  jump: { toSystemId: string; t: number } | null;
  timeSec: number;
}

export type SimEvent =
  | { type: 'landed'; planetId: string }
  | { type: 'jumped'; toSystemId: string }
  | { type: 'message'; text: string }
  | { type: 'towed'; planetId: string };

export interface FrameInput {
  /** Actions currently held. */
  actions: ReadonlySet<ActionId>;
  /** Actions that went down this tick. */
  pressed: ReadonlySet<ActionId>;
  stick?: { angle: number; magnitude: number; mode: 'point' | 'classic' };
}
