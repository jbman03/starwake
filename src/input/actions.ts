/** Pure action identifiers, groups and labels. No DOM; key bindings live elsewhere. */

export const ACTION_IDS = [
  // flight
  'thrust',
  'turnLeft',
  'turnRight',
  'reverse',
  'autoStop',
  'firePrimary',
  'fireSecondary',
  'nextTarget',
  'nearestHostile',
  'faceTarget',
  'land',
  'jump',
  'autopilot',
  'map',
  'pause',
  // planet
  'refuel',
  'leave',
  // menus
  'back',
] as const;

export type ActionId = (typeof ACTION_IDS)[number];

export type ActionGroup = 'flight' | 'planet' | 'menus';

export const ACTION_GROUP: Record<ActionId, ActionGroup> = {
  thrust: 'flight',
  turnLeft: 'flight',
  turnRight: 'flight',
  reverse: 'flight',
  autoStop: 'flight',
  firePrimary: 'flight',
  fireSecondary: 'flight',
  nextTarget: 'flight',
  nearestHostile: 'flight',
  faceTarget: 'flight',
  land: 'flight',
  jump: 'flight',
  autopilot: 'flight',
  map: 'flight',
  pause: 'flight',
  refuel: 'planet',
  leave: 'planet',
  back: 'menus',
};

export const ACTION_LABEL: Record<ActionId, string> = {
  thrust: 'Thrust',
  turnLeft: 'Turn left',
  turnRight: 'Turn right',
  reverse: 'Reverse',
  autoStop: 'Auto-stop',
  firePrimary: 'Fire primary',
  fireSecondary: 'Fire secondary',
  nextTarget: 'Next target',
  nearestHostile: 'Nearest hostile',
  faceTarget: 'Face target',
  land: 'Land',
  jump: 'Hyperspace jump',
  autopilot: 'Autopilot',
  map: 'Star map',
  pause: 'Pause',
  refuel: 'Refuel',
  leave: 'Leave',
  back: 'Back',
};
