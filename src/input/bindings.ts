import { ACTION_GROUP, ACTION_IDS, type ActionId } from './actions';

export type Slot = string | null;
export type Bindings = Record<ActionId, [Slot, Slot]>;

export const DEFAULT_BINDINGS: Bindings = {
  thrust: ['ArrowUp', null],
  turnLeft: ['ArrowLeft', null],
  turnRight: ['ArrowRight', null],
  reverse: ['ArrowDown', null],
  autoStop: ['KeyX', null],
  firePrimary: ['Space', null],
  fireSecondary: ['ShiftLeft', 'ShiftRight'],
  nextTarget: ['Tab', null],
  nearestHostile: ['KeyR', null],
  faceTarget: ['KeyF', null],
  land: ['KeyL', null],
  jump: ['KeyJ', null],
  autopilot: ['KeyG', null],
  map: ['KeyN', 'KeyM'],
  flightMissionLog: ['KeyK', null],
  pause: ['Escape', null],
  interact: ['KeyY', null],
  openExchange: ['KeyC', null],
  openMissions: ['KeyM', null],
  openShipyard: ['KeyY', null],
  openOutfitter: ['KeyO', null],
  refuel: ['KeyR', null],
  openMap: ['KeyN', null],
  missionLog: ['KeyK', null],
  howToPlay: ['KeyH', null],
  leave: ['KeyL', 'Escape'],
  buyGoods: ['KeyB', null],
  sellGoods: ['KeyS', null],
  shopBuy: ['KeyB', null],
  shopSell: ['KeyS', null],
  shopPrevPage: ['PageUp', 'BracketLeft'],
  shopNextPage: ['PageDown', 'BracketRight'],
  back: ['Escape', null],
  menuHowToPlay: ['KeyH', null],
  encounterChoice1: ['Digit1', null],
  encounterChoice2: ['Digit2', null],
  encounterChoice3: ['Digit3', null],
  toggleSound: ['KeyV', null],
};

export const MUST_KEEP_ESCAPE: readonly ActionId[] = ['pause', 'back'];

export function resetBindings(): Bindings {
  const out = {} as Bindings;
  for (const id of ACTION_IDS) out[id] = [...DEFAULT_BINDINGS[id]];
  return out;
}

/** Restore the default entry for any must-keep-Escape action that lost Escape. */
export function ensureEscapeInvariant(b: Bindings): Bindings {
  const out = clone(b);
  for (const id of MUST_KEEP_ESCAPE) {
    if (!out[id].includes('Escape')) out[id] = [...DEFAULT_BINDINGS[id]];
  }
  return out;
}

function clone(b: Bindings): Bindings {
  const out = {} as Bindings;
  for (const id of ACTION_IDS) out[id] = [...b[id]];
  return out;
}

function assertEscape(b: Bindings): void {
  for (const id of MUST_KEEP_ESCAPE) {
    if (!b[id].includes('Escape')) throw new Error(`"${id}" must keep Escape bound`);
  }
}

/** Another action in the same group already using `code`, or null. */
export function findConflict(b: Bindings, action: ActionId, code: string): ActionId | null {
  const group = ACTION_GROUP[action];
  for (const id of ACTION_IDS) {
    if (id === action || ACTION_GROUP[id] !== group) continue;
    if (b[id].includes(code)) return id;
  }
  return null;
}

export function rebind(b: Bindings, action: ActionId, slot: 0 | 1, code: string | null): Bindings {
  const out = clone(b);
  out[action][slot] = code;
  assertEscape(out);
  return out;
}

/** Bind `code` to the slot; any same-group action holding `code` receives the slot's old key. */
export function swapBinding(b: Bindings, action: ActionId, slot: 0 | 1, code: string): Bindings {
  const out = clone(b);
  const old = out[action][slot];
  const other = findConflict(b, action, code);
  if (other) {
    const idx = out[other].indexOf(code) as 0 | 1;
    out[other][idx] = old;
  }
  out[action][slot] = code;
  assertEscape(out);
  return out;
}
