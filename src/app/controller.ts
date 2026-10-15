import type { GameData } from '../data/schemas';
import type { ActionId } from '../input/actions';
import { KeyboardSource } from '../input/keyboard';
import type { Settings } from '../save/settings';
import { contextAction, type ContextAction } from '../sim/context';
import { FixedStepper } from '../sim/stepper';
import type { FrameInput, ShipState, SimEvent, WorldState } from '../sim/types';
import { applyTow, departFrom, interruptAutopilot, newWorld, stepWorld } from '../sim/world';

export type ControllerEvent =
  | SimEvent
  | { type: 'contextChanged'; action: ContextAction };

export type ControllerEventType = ControllerEvent['type'];
type EventOf<T extends ControllerEventType> = Extract<ControllerEvent, { type: T }>;

export interface FlightView {
  world: WorldState;
  /** Ship state before the most recent tick, for interpolation. */
  prevShip: ShipState;
  /** Interpolation factor between prevShip and world.ship, in [0,1). */
  alpha: number;
  data: GameData;
}

/** Glue between input, the fixed-step sim and the renderer. Owns the current WorldState. */
export class Controller {
  world: WorldState;
  private prevShip: ShipState;
  private alpha = 0;
  private stepper = new FixedStepper();
  private flying = false;
  private queued = new Set<ActionId>();
  private listeners = new Map<ControllerEventType, Set<(e: ControllerEvent) => void>>();
  private lastContext: ContextAction = null;
  readonly keyboard: KeyboardSource;

  /**
   * TEMPORARY (until Task 9's planet screen): planet the ship is sitting on after a
   * `landed`/`towed` event. While set, flight is paused and the next `land` press departs.
   */
  landedPlanetId: string | null = null;

  constructor(
    readonly data: GameData,
    readonly settings: Settings,
    keyTarget: EventTarget = window,
    world: WorldState = newWorld(data),
  ) {
    this.world = world;
    this.prevShip = world.ship;
    this.keyboard = new KeyboardSource(keyTarget, () => this.settings.bindings);
  }

  on<T extends ControllerEventType>(type: T, fn: (e: EventOf<T>) => void): () => void {
    let set = this.listeners.get(type);
    if (!set) this.listeners.set(type, (set = new Set()));
    const f = fn as (e: ControllerEvent) => void;
    set.add(f);
    return () => set.delete(f);
  }

  private emit(e: ControllerEvent): void {
    this.listeners.get(e.type)?.forEach((fn) => fn(e));
  }

  startFlight(): void {
    this.flying = true;
    this.landedPlanetId = null;
  }

  pauseFlight(): void {
    this.flying = false;
  }

  get isFlying(): boolean {
    return this.flying;
  }

  view(): FlightView {
    return { world: this.world, prevShip: this.prevShip, alpha: this.alpha, data: this.data };
  }

  currentContext(): ContextAction {
    return contextAction(this.world, this.data);
  }

  /** Perform the context button's action (used by touch controls). */
  doContextAction(): void {
    const action = this.currentContext();
    if (action === 'takeControl') this.world = interruptAutopilot(this.world);
    else if (action === 'tow') {
      const r = applyTow(this.world, this.data);
      this.world = r.world;
      this.prevShip = r.world.ship;
      this.handleEvents(r.events);
    } else if (action === 'land') this.queued.add('land');
    else if (action === 'jump') this.queued.add('jump');
    this.checkContext();
  }

  selectPlanet(id: string | null): void {
    this.world = { ...this.world, targetPlanetId: id };
  }

  /** Advance by real elapsed seconds. Called once per render frame. */
  update(elapsedSec: number): void {
    if (!this.flying) {
      this.updateLanded();
      this.checkContext();
      return;
    }
    this.alpha = this.stepper.advance(elapsedSec, (dt) => {
      if (!this.flying) return; // a landing earlier in this frame paused flight
      const polled = this.keyboard.poll('flight');
      const pressed = new Set([...polled.pressed, ...this.queued]);
      this.queued.clear();
      const input: FrameInput = { actions: polled.actions, pressed };
      this.prevShip = this.world.ship;
      const r = stepWorld(this.world, this.data, input, dt, {
        autoLandOnArrival: this.settings.autoLandOnArrival,
      });
      this.world = r.world;
      this.handleEvents(r.events);
    });
    this.checkContext();
  }

  private handleEvents(events: SimEvent[]): void {
    for (const e of events) {
      if (e.type === 'landed' || e.type === 'towed') this.land(e.planetId);
      else if (e.type === 'jumped') this.prevShip = this.world.ship; // no interpolation across systems
      this.emit(e);
    }
  }

  private land(planetId: string): void {
    this.pauseFlight();
    this.landedPlanetId = planetId;
    this.prevShip = this.world.ship;
    this.alpha = 0;
  }

  // ---- TEMPORARY landed handling (replaced by Task 9's planet screen) ----
  private updateLanded(): void {
    if (!this.landedPlanetId) return;
    const { pressed } = this.keyboard.poll('flight');
    if (pressed.has('land')) this.leavePlanet();
  }

  /** Depart from the planet we're landed on and resume flight. */
  leavePlanet(): void {
    if (!this.landedPlanetId) return;
    this.world = departFrom(this.world, this.data, this.landedPlanetId);
    this.prevShip = this.world.ship;
    this.startFlight();
  }
  // ------------------------------------------------------------------------

  private checkContext(): void {
    const c = this.flying ? this.currentContext() : null;
    if (c !== this.lastContext) {
      this.lastContext = c;
      this.emit({ type: 'contextChanged', action: c });
    }
  }

  dispose(): void {
    this.keyboard.dispose();
    this.listeners.clear();
  }
}
