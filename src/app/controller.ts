import type { GameData } from '../data/schemas';
import type { ActionGroup, ActionId } from '../input/actions';
import { KeyboardSource } from '../input/keyboard';
import { TouchSource } from '../input/touch';
import { pilotFromWorld, type PilotSave } from '../save/pilot';
import type { Settings } from '../save/settings';
import { contextAction, type ContextAction } from '../sim/context';
import { refuelQuote, towDestination, type RefuelQuote } from '../sim/rules';
import { FixedStepper } from '../sim/stepper';
import type { FrameInput, ShipState, SimEvent, WorldState } from '../sim/types';
import { applyRefuel, applyTow, autopilotToJumpPoint, departFrom, interruptAutopilot, newWorld, stepWorld } from '../sim/world';

export type ControllerEvent =
  | SimEvent
  | { type: 'contextChanged'; action: ContextAction }
  /** A flight key asked for a menu; flight is already paused. */
  | { type: 'menu'; action: 'pause' | 'map' }
  /** Flight started or stopped (planet screen, menus, pause). */
  | { type: 'flying'; flying: boolean }
  /** Result of the autosave started by a landing. */
  | { type: 'saved'; ok: boolean; error?: string };

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

export interface PilotMeta {
  id: string;
  name: string;
}

/** Where pilots are written. PilotStore satisfies this. */
export interface SaveSink {
  save(p: PilotSave): Promise<void>;
}

type UiInput = { groups: readonly ActionGroup[]; handler: (pressed: Set<ActionId>) => void };

/** Glue between input, the fixed-step sim, saves and the renderer. Owns the current WorldState. */
export class Controller {
  world: WorldState;
  private prevShip: ShipState;
  private alpha = 0;
  private stepper = new FixedStepper();
  private flying = false;
  private queued = new Set<ActionId>();
  private listeners = new Map<ControllerEventType, Set<(e: ControllerEvent) => void>>();
  private lastContext: ContextAction = null;
  private uiInput: UiInput | null = null;
  readonly keyboard: KeyboardSource;
  /** On-screen touch controls feed this; merged with the keyboard every tick. */
  readonly touch: TouchSource;

  /** Planet the ship is sitting on (planet screen open), or null. */
  landedPlanetId: string | null = null;
  /** Most recent planet landed on this session; saves are landed snapshots taken there. */
  lastPlanetId: string | null = null;
  /** The pilot being played, or null on the main menu. */
  pilot: PilotMeta | null = null;
  /** Autosave target; null disables saving. */
  store: SaveSink | null = null;
  /** Settles when the most recent autosave finishes (never rejects). */
  lastSave: Promise<void> = Promise.resolve();

  constructor(
    readonly data: GameData,
    readonly settings: Settings,
    keyTarget: EventTarget = window,
    world: WorldState = newWorld(data),
  ) {
    this.world = world;
    this.prevShip = world.ship;
    this.keyboard = new KeyboardSource(keyTarget, () => this.settings.bindings);
    this.touch = new TouchSource(() => this.settings.touch.steering);
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
    const changed = !this.flying;
    this.flying = true;
    this.landedPlanetId = null;
    if (changed) this.emit({ type: 'flying', flying: true });
  }

  /** Stop stepping the sim. Pending context actions are dropped so they can't fire on resume. */
  pauseFlight(): void {
    const changed = this.flying;
    this.flying = false;
    this.queued.clear();
    if (changed) this.emit({ type: 'flying', flying: false });
  }

  /** Let go of every held key and touch control (app backgrounded or window blurred). */
  releaseInputs(): void {
    this.keyboard.releaseAll();
    this.touch.releaseAll();
  }

  get isFlying(): boolean {
    return this.flying;
  }

  // ---- session -------------------------------------------------------------

  /** Start playing `pilot`, landed at `planetId` (the planet screen comes next). */
  beginSession(world: WorldState, pilot: PilotMeta, planetId: string): void {
    this.world = world;
    this.pilot = { ...pilot };
    // No autosave: a fresh load would only rotate away the older backup. New pilots call save().
    this.landAt(planetId, false);
  }

  /** Back to the main menu: forget the pilot and stop the sim. */
  endSession(): void {
    this.pauseFlight();
    this.pilot = null;
    this.landedPlanetId = null;
    this.lastPlanetId = null;
  }

  /** The pilot as of the most recent landing, or null with no session. */
  snapshot(): PilotSave | null {
    if (!this.pilot || !this.lastPlanetId) return null;
    const p = pilotFromWorld(this.world, this.lastPlanetId, this.pilot);
    // Saves are landed snapshots: keep the system consistent with the planet even after a jump.
    return { ...p, systemId: this.data.planets[this.lastPlanetId].systemId };
  }

  /** Save the pilot (a landed snapshot at the last planet). Rejects if the store fails. */
  async save(): Promise<void> {
    const p = this.snapshot();
    if (p && this.store) await this.store.save(p);
  }

  private autosave(): void {
    if (!this.pilot || !this.store) return;
    this.lastSave = this.save().then(
      () => this.emit({ type: 'saved', ok: true }),
      (err: unknown) => this.emit({ type: 'saved', ok: false, error: err instanceof Error ? err.message : String(err) }),
    );
  }

  // ---- planet --------------------------------------------------------------

  /** Depart from the planet we're landed on, with no target selected, and resume flight. */
  leavePlanet(): void {
    if (!this.landedPlanetId) return;
    this.world = { ...departFrom(this.world, this.data, this.landedPlanetId), targetPlanetId: null };
    this.prevShip = this.world.ship;
    this.startFlight();
  }

  /** What Refuel would buy at the current planet, or null when not landed. */
  refuelQuote(): RefuelQuote | null {
    const planet = this.landedPlanetId ? this.data.planets[this.landedPlanetId] : undefined;
    if (!planet) return null;
    return refuelQuote(this.world.ship.fuel, this.data.ships[this.world.shipId], planet, this.world.credits);
  }

  refuel(): RefuelQuote | null {
    if (!this.landedPlanetId) return null;
    const r = applyRefuel(this.world, this.data, this.landedPlanetId);
    this.world = r.world;
    return r.quote;
  }

  // ---- flight --------------------------------------------------------------

  view(): FlightView {
    return { world: this.world, prevShip: this.prevShip, alpha: this.alpha, data: this.data };
  }

  currentContext(): ContextAction {
    return contextAction(this.world, this.data);
  }

  /** Perform the context button's action (used by touch controls). No-op unless flying. */
  doContextAction(): void {
    if (!this.flying) return;
    const action = this.currentContext();
    if (action === 'takeControl') this.world = interruptAutopilot(this.world);
    else if (action === 'tow') this.callTow();
    else if (action === 'land') this.queued.add('land');
    else if (action === 'autopilotOut') this.world = autopilotToJumpPoint(this.world);
    else if (action === 'jump') this.queued.add('jump');
    this.checkContext();
  }

  /**
   * A planet was tapped: select it, then land the way the context button does (lands at once
   * when close and slow, else autopilots there). Takes over from any autopilot first so the
   * tapped planet wins instead of the landing autopilot's "next planet" cycling.
   */
  tapPlanet(id: string): void {
    if (!this.flying || this.world.jump) return;
    if (this.world.assist.kind === 'autopilot') this.world = interruptAutopilot(this.world);
    this.selectPlanet(id);
    this.queued.add('land');
    this.checkContext();
  }

  /** Planet a tow would take us to right now, or null when no tow is offered. */
  towDestination(): string | null {
    if (this.landedPlanetId || this.world.jump) return null;
    return towDestination(this.world, this.data);
  }

  /** Call for a tow (works while paused). Lands at the destination; false if none is offered. */
  callTow(): boolean {
    if (!this.towDestination()) return false;
    const r = applyTow(this.world, this.data);
    this.world = r.world;
    this.prevShip = r.world.ship;
    this.handleEvents(r.events);
    this.checkContext();
    return true;
  }

  selectPlanet(id: string | null): void {
    this.world = { ...this.world, targetPlanetId: id };
  }

  /**
   * While not flying, poll `groups` once per frame and pass any presses to `handler`
   * (the open menu or planet screen). Replaces any previous handler; returns a remover.
   */
  setUiInput(groups: readonly ActionGroup[], handler: (pressed: Set<ActionId>) => void): () => void {
    const entry: UiInput = { groups, handler };
    this.uiInput = entry;
    return () => {
      if (this.uiInput === entry) this.uiInput = null;
    };
  }

  /** Advance by real elapsed seconds. Called once per render frame. */
  update(elapsedSec: number): void {
    if (!this.flying) {
      this.updateUi();
      this.checkContext();
      return;
    }
    this.alpha = this.stepper.advance(elapsedSec, (dt) => {
      if (!this.flying) return; // a landing or menu earlier in this frame paused flight
      const keys = this.keyboard.poll('flight');
      const touch = this.touch.poll('flight');
      const polled = {
        actions: new Set([...keys.actions, ...touch.actions]),
        pressed: new Set([...keys.pressed, ...touch.pressed]),
      };
      const menu = polled.pressed.has('pause') ? 'pause' : polled.pressed.has('map') ? 'map' : null;
      if (menu) {
        this.pauseFlight();
        this.emit({ type: 'menu', action: menu });
        return;
      }
      const pressed = new Set([...polled.pressed, ...this.queued]);
      this.queued.clear();
      const input: FrameInput = touch.stick
        ? { actions: polled.actions, pressed, stick: touch.stick }
        : { actions: polled.actions, pressed };
      this.prevShip = this.world.ship;
      const r = stepWorld(this.world, this.data, input, dt, {
        autoLandOnArrival: this.settings.autoLandOnArrival,
      });
      this.world = r.world;
      this.handleEvents(r.events);
    });
    this.checkContext();
  }

  /** One poll per frame for whichever screen is open; with none, stale presses are drained. */
  private updateUi(): void {
    const ui = this.uiInput;
    const { pressed } = this.keyboard.poll(ui?.groups ?? 'menus');
    this.touch.poll('flight'); // drain: a tap made while paused must not fire on resume
    if (ui && pressed.size > 0) ui.handler(pressed);
  }

  private handleEvents(events: SimEvent[]): void {
    for (const e of events) {
      if (e.type === 'landed' || e.type === 'towed') this.landAt(e.planetId);
      else if (e.type === 'jumped') this.prevShip = this.world.ship; // no interpolation across systems
      this.emit(e);
    }
  }

  private landAt(planetId: string, autosave = true): void {
    this.pauseFlight();
    this.landedPlanetId = planetId;
    this.lastPlanetId = planetId;
    this.prevShip = this.world.ship;
    this.alpha = 0;
    if (autosave) this.autosave();
  }

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
    this.uiInput = null;
  }
}
