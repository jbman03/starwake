/** Touch layout math and the touch input source. No DOM here; src/ui/rails.ts draws the controls. */
import type { Settings } from '../save/settings';
import { ACTION_GROUP, type ActionGroup, type ActionId } from './actions';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Safe-area insets in px (phone notch, rounded corners, home indicator). */
export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}
export const NO_INSETS: Insets = { top: 0, right: 0, bottom: 0, left: 0 };

export interface Layout {
  /** Where the game is drawn (the Phaser camera viewport). */
  view: Rect;
  /** The stick rail (HUD, Stop, joystick). On the left unless mirrored. */
  leftRail: Rect;
  /** The button rail (radar, Target, Missile, Fire). On the right unless mirrored. */
  rightRail: Rect;
  /** The part of the view no rail control may cover. */
  clear: Rect;
  /** True when the rails sit over the view's edges instead of beside it. */
  overlayRails: boolean;
  /** The insets this layout was computed with. Each rail rect already includes its edge's inset. */
  insets: Insets;
}

export type Steering = Settings['touch']['steering'];

/** Rails are at least this wide. */
export const MIN_RAIL_WIDTH = 120;
/** In overlay mode each rail covers this fraction of the screen width. */
export const OVERLAY_RAIL_FRACTION = 0.18;
/** Background opacity of overlay rails. */
export const OVERLAY_RAIL_OPACITY = 0.85;
/** Base button sizes (px) for the S/M/L setting. */
export const BUTTON_SIZES = { S: 44, M: 56, L: 68 } as const;
/** Fire is this much bigger than the other buttons. */
export const FIRE_SCALE = 1.4;
/** Smallest a button may shrink to on a short screen. */
export const MIN_BUTTON = 36;

const ASPECT = 16 / 9;

/**
 * Wider than 16:9: opaque rails beside a full-height view (each rail at least MIN_RAIL_WIDTH).
 * Otherwise: the view is the whole screen and the rails overlay its outer 18% strips.
 * `mirror` swaps the rails (for left-handed play).
 */
export function computeLayout(
  w: number,
  h: number,
  s: Pick<Settings['touch'], 'mirror'>,
  insets: Insets = NO_INSETS,
): Layout {
  let left: Rect, right: Rect, view: Rect, clear: Rect;
  // The rails grow by their edge's inset, so the view never sits under a notch or under a rail.
  const availW = Math.max(0, w - insets.left - insets.right);
  const overlayRails = !(availW / h > ASPECT);
  if (!overlayRails) {
    const railW = Math.min(availW / 2, Math.max(MIN_RAIL_WIDTH, (availW - h * ASPECT) / 2));
    const lw = railW + insets.left;
    const rw = railW + insets.right;
    view = { x: lw, y: 0, w: w - lw - rw, h };
    left = { x: 0, y: 0, w: lw, h };
    right = { x: w - rw, y: 0, w: rw, h };
    clear = { ...view };
  } else {
    const railW = availW * OVERLAY_RAIL_FRACTION;
    const lw = railW + insets.left;
    const rw = railW + insets.right;
    view = { x: 0, y: 0, w, h };
    left = { x: 0, y: 0, w: lw, h };
    right = { x: w - rw, y: 0, w: rw, h };
    clear = { x: lw, y: 0, w: w - lw - rw, h };
  }
  // Mirrored: the stick rail takes the right side. Rect widths stay tied to the physical edge.
  if (s.mirror) [left, right] = [right, left];
  return { view, leftRail: left, rightRail: right, clear, overlayRails, insets };
}

/** The safe-area inset on the screen edge a rail touches (rails on the left edge start at x = 0). */
export function railInset(rail: Rect, insets: Insets): number {
  return rail.x === 0 ? insets.left : insets.right;
}

/** True when the rectangles overlap with positive area (shared edges don't count). */
export function rectsIntersect(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

export interface RailMetrics {
  pad: number;
  gap: number;
  /** Size of the regular square buttons. */
  button: number;
  /** Size of the Fire button. */
  fire: number;
  radar: number;
  /** Height of the HUD block at the top of the stick rail. */
  hud: number;
  /** Joystick diameter. */
  stick: number;
  leftStackHeight: number;
  rightStackHeight: number;
}

const PAD = 8;
const GAP = 8;
const HUD_HEIGHT = 178; // room for the 44px Pause button, two bars, fuel, credits, cargo, target and a two-line course
const MAX_RADAR = 84;
const MAX_STICK = 140;

/**
 * Pixel sizes for the rail controls: the S/M/L base size, shrunk only as far as needed so both
 * stacks fit inside their rails (height and width).
 * Stick rail: HUD, Stop, joystick. Button rail: radar, Target, Missile, [Thrust], Fire.
 */
export function railMetrics(layout: Layout, s: Pick<Settings['touch'], 'buttonSize'>, steering: Steering): RailMetrics {
  const { insets } = layout;
  const h = layout.leftRail.h;
  // Each rail's inset side is padding, not usable width; top and bottom insets are padding too.
  const inner = Math.min(layout.leftRail.w - railInset(layout.leftRail, insets), layout.rightRail.w - railInset(layout.rightRail, insets)) - 2 * PAD;
  const usable = h - insets.top - insets.bottom - 2 * PAD;
  const plain = steering === 'classic' ? 3 : 2; // Target, Missile (+ Thrust)
  const rightGaps = (plain + 1) * GAP; // radar + plain + fire = plain + 2 items

  let radar = Math.min(MAX_RADAR, inner);
  let button = Math.min(BUTTON_SIZES[s.buttonSize], inner / FIRE_SCALE, (usable - rightGaps - radar) / (plain + FIRE_SCALE));
  if (button < MIN_BUTTON) {
    button = MIN_BUTTON;
    radar = Math.max(0, usable - rightGaps - button * (plain + FIRE_SCALE));
  }
  button = Math.floor(button);
  const fire = button * FIRE_SCALE;
  radar = Math.floor(radar);
  const stick = Math.floor(Math.max(0, Math.min(inner, MAX_STICK, usable - HUD_HEIGHT - button - 2 * GAP)));
  return {
    pad: PAD,
    gap: GAP,
    button,
    fire,
    radar,
    hud: HUD_HEIGHT,
    stick,
    leftStackHeight: HUD_HEIGHT + GAP + button + GAP + stick,
    rightStackHeight: radar + rightGaps + plain * button + fire,
  };
}

/** Joystick reading from the finger's offset (screen px, y down) from the stick center. */
export function stickFromOffset(dx: number, dy: number, radius: number): { angle: number; magnitude: number } {
  const d = Math.hypot(dx, dy);
  if (d === 0 || radius <= 0) return { angle: 0, magnitude: 0 };
  return { angle: Math.atan2(dy, dx), magnitude: Math.min(1, d / radius) };
}

export interface TouchPoll {
  actions: Set<ActionId>;
  pressed: Set<ActionId>;
  stick?: { angle: number; magnitude: number; mode: Steering };
}

/**
 * Held/pressed actions and the joystick from the on-screen controls. Same poll() shape as
 * KeyboardSource, plus `stick`. A press is remembered until the next poll, so a tap shorter
 * than one sim tick still counts.
 */
export class TouchSource {
  private held = new Set<ActionId>();
  private justPressed = new Set<ActionId>();
  private stick: { angle: number; magnitude: number } | null = null;

  constructor(private getSteering: () => Steering) {}

  press(id: ActionId): void {
    if (!this.held.has(id)) this.justPressed.add(id);
    this.held.add(id);
  }

  release(id: ActionId): void {
    this.held.delete(id);
  }

  setStick(angle: number, magnitude: number): void {
    this.stick = { angle, magnitude };
  }

  clearStick(): void {
    this.stick = null;
  }

  /** Let go of everything (controls hidden, page backgrounded). */
  releaseAll(): void {
    this.held.clear();
    this.justPressed.clear();
    this.stick = null;
  }

  poll(groups: ActionGroup | readonly ActionGroup[]): TouchPoll {
    const wanted: readonly ActionGroup[] = typeof groups === 'string' ? [groups] : groups;
    const pick = (set: Set<ActionId>) => new Set([...set].filter((id) => wanted.includes(ACTION_GROUP[id])));
    const out: TouchPoll = { actions: pick(this.held), pressed: pick(this.justPressed) };
    this.justPressed.clear();
    if (this.stick && wanted.includes('flight')) out.stick = { ...this.stick, mode: this.getSteering() };
    return out;
  }
}
