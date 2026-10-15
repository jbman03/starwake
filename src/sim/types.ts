import type { Vec2 } from './vec';

export type ShipState = { pos: Vec2; vel: Vec2; heading: number; fuel: number };
export type FlightInput = { thrust: boolean; turn: -1 | 0 | 1; targetHeading?: number };
