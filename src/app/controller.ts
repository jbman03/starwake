import type { EncounterDef, GameData, StoryMissionDef } from '../data/schemas';
import type { Guide } from '../guide/guide';
import { ACTION_GROUP, type ActionGroup, type ActionId } from '../input/actions';
import { KeyboardSource } from '../input/keyboard';
import { TouchSource } from '../input/touch';
import { pilotFromWorld, type PilotSave } from '../save/pilot';
import { saveSettings, type Settings } from '../save/settings';
import { contextAction, siteReachable, type ContextAction, type PendingHint } from '../sim/context';
import { applyChoice, choiceBlock, ENCOUNTER_BLOCK_TEXT, fillText, hubName, rollEncounter } from '../sim/encounters';
import { hashString, mulberry32 } from '../sim/random';
import { buy, sell, type BuyResult, type SellResult } from '../sim/cargo';
import { buyOutfit, outfitBuyCheck, sellOutfit, type BuyCheck, type SellCheck } from '../sim/outfitter';
import {
  abandon,
  accept,
  canAbandon,
  canAccept,
  completeAt,
  offersAt,
  type AbandonCheck,
  type AcceptCheck,
  type MissionOffer,
} from '../sim/missions';
import { buyShip, shipDisplayName, shipQuote, type ShipQuote } from '../sim/shipyard';
import { addNote, setFlag } from '../sim/story';
import {
  abandonStory,
  acceptStory,
  advanceStory,
  answerStoryHail,
  canAcceptStory,
  STORY_BLOCK_REASON,
  currentStep,
  declineStory,
  FIND_SITE_REVEAL,
  nextLead,
  storyHoldPos,
  storyOffersAt,
  storyHailAt,
  storySitePos,
  type StoryAccept,
} from '../sim/storyMissions';
import { refuelQuote, towDestination, type RefuelQuote } from '../sim/rules';
import { worldStats } from '../sim/shipStats';
import { FixedStepper } from '../sim/stepper';
import { objectiveText, siteNoticeText } from '../sim/siteText';
import { addStoryNpc, cycleTarget, isTargetable, seedTraffic, shipName, stepTraffic, targetedNpc, type Traffic } from '../sim/traffic';
import { dist, type Vec2 } from '../sim/vec';
import type { FrameInput, Mission, ShipState, SimEvent, SiteTarget, WorldState } from '../sim/types';
import {
  applyRefuel,
  applyTow,
  autopilotToJumpPoint,
  autopilotToSite,
  departFrom,
  interruptAutopilot,
  newWorld,
  setRoute,
  stepWorld,
} from '../sim/world';

/** How long a hail stays open (flight seconds). */
export const HAIL_SECONDS = 30;
/** How far from the arrival point a site lies (px, min and spread). */
const SITE_MIN_DIST = 500;
const SITE_SPREAD = 400;
/** The landing shrink-and-fade before the planet screen opens (also the take-off, reversed). */
export const LANDING_FX_SEC = 0.4;

/** The encounter waiting in this system: a hail that lapses, or a site to fly to. */
export type PendingEncounter =
  | { def: EncounterDef; npcName: string; kind: 'hail'; expiresSec: number }
  | { def: EncounterDef; npcName: string; kind: 'site'; pos: Vec2 };

/** A scan or find site placed in space for a story step. A find site is unseen until the ship is near. */
export interface StorySite {
  missionId: string;
  pos: Vec2;
  label: string;
  hiddenUntilNear: boolean;
}

/** The named ship a story meet step is waiting on (it sits in `traffic`). */
export interface StoryMeet {
  missionId: string;
  npcId: string;
}

/** What the encounter card shows. `blocked` is the reason a choice can't be taken, or null. */
export interface EncounterView {
  kind: 'hail' | 'site';
  title: string;
  text: string;
  choices: { label: string; blocked: string | null }[];
  /** True when the card can't be put off (no "Not now"). */
  noDecline?: boolean;
}

export type ControllerEvent =
  | SimEvent
  /** The player opened the pending encounter; flight is already paused. */
  | { type: 'encounter' }
  | { type: 'contextChanged'; action: ContextAction }
  /** Jobs finished by the landing that just happened; emitted before the autosave. */
  | { type: 'missionsCompleted'; missions: Mission[]; pay: number }
  /** A flight key asked for a menu; flight is already paused. */
  | { type: 'menu'; action: 'pause' | 'map' | 'missionLog' }
  /** Flight started or stopped (planet screen, menus, pause). */
  | { type: 'flying'; flying: boolean }
  /** Result of the autosave started by a landing. */
  | { type: 'saved'; ok: boolean; error?: string }
  /** A pilot session began (beginSession) or ended (endSession). */
  | { type: 'session'; active: boolean }
  /** The flight HUD or rail asked to skip the First Flight guide (the UI confirms). */
  | { type: 'guideSkip' }
  /** Something happened that has a sound but no event of its own (arrival, landing and pay have theirs). */
  | { type: 'sfx'; sfx: 'jump' | 'takeoff' | 'trade' | 'hail' | 'site' };

export type ControllerEventType = ControllerEvent['type'];
type EventOf<T extends ControllerEventType> = Extract<ControllerEvent, { type: T }>;

export interface FlightView {
  world: WorldState;
  /** Ship state before the most recent tick, for interpolation. */
  prevShip: ShipState;
  /** Interpolation factor between prevShip and world.ship, in [0,1). */
  alpha: number;
  data: GameData;
  /**
   * Landing progress for the scene: 0 to 1 while the ship shrinks and fades onto a planet, and 1
   * back to 0 on take-off; null in ordinary flight.
   */
  landingT: number | null;
  /** Whether the engine fired on the most recent tick (the flame). */
  thrusting: boolean;
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
  /** The landing (until the planet screen opens) or take-off effect in progress; input is ignored meanwhile. */
  private fx: { kind: 'land'; planetId: string; t: number } | { kind: 'takeoff'; t: number } | null = null;
  private thrusting = false;
  private uiInput: UiInput | null = null;
  readonly keyboard: KeyboardSource;
  /** On-screen touch controls feed this; merged with the keyboard every tick. */
  readonly touch: TouchSource;

  /** The NPC ships in this system (seeded on arrival, stepped while flying). */
  traffic: Traffic;
  /** The hail or site waiting in this system, or null. */
  pending: PendingEncounter | null = null;
  /** The scan or find site of a story step in this system, or null. */
  storySite: StorySite | null = null;
  /** Which site is targeted ('story' or 'encounter', see SiteTarget), or null. Use targetedSite(): it checks the site is still there. */
  private targetSiteId: string | null = null;
  /** The meet ship of a story step in this system (its hail stands until answered), or null. */
  storyMeet: StoryMeet | null = null;
  /** The story mission that is hailing the pilot in this system (answering takes it), or null. */
  storyHail: string | null = null;
  /** The hail mission whose offer the open card shows (it is already taken), or null. */
  private hailCard: string | null = null;
  /** The story hail the pilot put off ("Not now", or it could not be taken): the context button ignores it until a jump. */
  storyHailQuiet: string | null = null;
  /** Which card the open encounter screen shows: the pending encounter's, the story meet's or a story hail's. */
  private card: 'encounter' | 'story' | 'hail' | null = null;
  /** Planet the ship is sitting on (planet screen open), or null. */
  landedPlanetId: string | null = null;
  /** Most recent planet landed on this session; saves are landed snapshots taken there. */
  lastPlanetId: string | null = null;
  /** The pilot being played, or null on the main menu. */
  pilot: PilotMeta | null = null;
  /** Autosave target; null disables saving. */
  store: SaveSink | null = null;
  /** The First Flight guide for this session, set by the UI layer (src/ui/context.ts); null without a session. */
  guide: Guide | null = null;
  /**
   * Jobs finished by the landing that opened the planet screen, until that screen shows them
   * (it mounts after `missionsCompleted` fires, so it collects them with takeCompletion()).
   */
  private completion: { missions: Mission[]; pay: number } | null = null;
  /**
   * Messages raised while the ship was being towed (e.g. missions failed on the way). The HUD is
   * hidden behind the planet screen by then, so that screen collects them with takeNotices().
   */
  private notices: string[] = [];
  /** Settles when the most recent autosave finishes (never rejects). */
  lastSave: Promise<void> = Promise.resolve();

  constructor(
    readonly data: GameData,
    readonly settings: Settings,
    keyTarget: EventTarget = window,
    world: WorldState = newWorld(data),
  ) {
    this.world = world;
    this.traffic = seedTraffic(world, data, this.maxNpcs());
    this.prevShip = world.ship;
    this.keyboard = new KeyboardSource(
      keyTarget,
      () => this.settings.bindings,
      () => (this.flying ? { flying: true, groups: ['flight'] } : { flying: false, groups: this.uiInput?.groups ?? ['menus'] }),
    );
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
    this.thrusting = false;
    this.queued.clear();
    if (changed) this.emit({ type: 'flying', flying: false });
  }

  /** Let go of every held key and touch control (app backgrounded or window blurred). */
  releaseInputs(): void {
    this.keyboard.releaseAll();
    this.touch.releaseAll();
    this.thrusting = false;
  }

  get isFlying(): boolean {
    return this.flying;
  }

  // ---- session -------------------------------------------------------------

  /** Start playing `pilot`, landed at `planetId` (the planet screen comes next). */
  beginSession(world: WorldState, pilot: PilotMeta, planetId: string): void {
    this.world = world;
    this.traffic = seedTraffic(world, this.data, this.maxNpcs());
    this.pending = null;
    this.card = null;
    this.storySite = null;
    this.storyMeet = null;
    this.pilot = { ...pilot };
    // No autosave: a fresh load would only rotate away the older backup. New pilots call save().
    this.landAt(planetId, false);
    this.emit({ type: 'session', active: true });
  }

  /** Back to the main menu: forget the pilot and stop the sim. */
  endSession(): void {
    this.pauseFlight();
    this.pilot = null;
    this.fx = null;
    this.landedPlanetId = null;
    this.lastPlanetId = null;
    this.completion = null;
    this.notices = [];
    this.emit({ type: 'session', active: false });
  }

  /** Ask the UI to confirm skipping the guide (the HUD and rail have no dialogs of their own). */
  requestGuideSkip(): void {
    this.emit({ type: 'guideSkip' });
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
    this.refreshStory();
    this.fx = { kind: 'takeoff', t: 0 };
    this.startFlight();
    this.emit({ type: 'sfx', sfx: 'takeoff' });
  }

  /** What Refuel would buy at the current planet, or null when not landed. */
  refuelQuote(): RefuelQuote | null {
    const planet = this.landedPlanetId ? this.data.planets[this.landedPlanetId] : undefined;
    if (!planet) return null;
    return refuelQuote(this.world.ship.fuel, worldStats(this.world, this.data).fuelCapacity, planet, this.world.credits);
  }

  refuel(): RefuelQuote | null {
    if (!this.landedPlanetId) return null;
    const r = applyRefuel(this.world, this.data, this.landedPlanetId);
    this.world = r.world;
    return r.quote;
  }

  // ---- flight --------------------------------------------------------------

  view(): FlightView {
    const fx = this.fx;
    const landingT = !fx ? null : fx.kind === 'land' ? Math.min(1, fx.t / LANDING_FX_SEC) : Math.max(0, 1 - fx.t / LANDING_FX_SEC);
    return { world: this.world, prevShip: this.prevShip, alpha: this.alpha, data: this.data, landingT, thrusting: this.thrusting };
  }

  currentContext(): ContextAction {
    return contextAction(this.world, this.data, this.pendingHint(), this.canFlyToSite());
  }

  /**
   * Perform the context button's action (used by touch controls). No-op unless flying.
   * `plotCourse` opens the star map the way the map key does (flight pauses; closing resumes it).
   */
  doContextAction(): void {
    if (!this.flying || this.fx) return;
    const action = this.currentContext();
    if (action === 'plotCourse') {
      this.pauseFlight();
      this.emit({ type: 'menu', action: 'map' });
    } else if (action === 'answerHail' || action === 'openSite') this.openEncounter();
    else if (action === 'flyToSite') this.flyToStorySite();
    else if (action === 'takeControl') this.world = interruptAutopilot(this.world);
    else if (action === 'tow') this.callTow();
    else if (action === 'land') this.queued.add('land');
    else if (action === 'autopilotOut') this.world = autopilotToJumpPoint(this.world);
    else if (action === 'jump') this.queued.add('jump');
    this.checkContext();
  }

  /**
   * A planet was clicked or tapped. A mouse click only selects it (desktop players land with L).
   * A touch (or pen) tap selects it, then lands the way the context button does (lands at once
   * when close and slow, else autopilots there), taking over from any autopilot first so the
   * tapped planet wins instead of the landing autopilot's "next planet" cycling.
   */
  tapPlanet(id: string, pointerType: string = 'touch'): void {
    if (!this.flying || this.fx || this.world.jump) return;
    if (pointerType === 'mouse') {
      this.selectPlanet(id);
      return;
    }
    if (this.world.assist.kind === 'autopilot') this.world = interruptAutopilot(this.world);
    this.selectPlanet(id);
    this.queued.add('land');
    this.checkContext();
  }

  /** Planet a tow would take us to right now, or null when no tow is offered. */
  towDestination(): string | null {
    if (this.landedPlanetId || this.fx?.kind === 'land' || this.world.jump) return null;
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

  /** Plot a course (see setRoute; works landed or in flight). `ok` is false if there's no route. */
  plotRoute(systemId: string): { ok: boolean; reason?: 'noRoute' } {
    const r = setRoute(this.world, this.data, systemId);
    this.world = r.world;
    this.checkContext();
    return r.ok ? { ok: true } : { ok: false, reason: r.reason };
  }

  clearRoute(): void {
    this.world = { ...this.world, route: [] };
    this.checkContext();
  }

  /** The landing's completed jobs, once: the planet screen shows them and they are cleared. */
  takeCompletion(): { missions: Mission[]; pay: number } | null {
    const c = this.completion;
    this.completion = null;
    return c;
  }

  /** Messages from the tow that opened the planet screen, once (see `notices`). */
  takeNotices(): string[] {
    const n = this.notices;
    this.notices = [];
    return n;
  }

  // ---- trade and jobs (landed only; none of these save) -------------------

  buy(commodityId: string, tons: number): BuyResult {
    if (!this.landedPlanetId) return { world: this.world, tons: 0, cost: 0, reason: 'notTraded' };
    const r = buy(this.world, this.data, this.landedPlanetId, commodityId, tons);
    this.world = r.world;
    if (r.tons > 0) this.emit({ type: 'sfx', sfx: 'trade' });
    return r;
  }

  sell(commodityId: string, tons: number): SellResult {
    if (!this.landedPlanetId) return { world: this.world, tons: 0, revenue: 0, reason: 'notTraded' };
    const r = sell(this.world, this.data, this.landedPlanetId, commodityId, tons);
    this.world = r.world;
    if (r.tons > 0) this.emit({ type: 'sfx', sfx: 'trade' });
    return r;
  }

  /** Buy one outfit here (like exchange trades, this does not save). */
  buyOutfit(outfitId: string): BuyCheck {
    if (!this.landedPlanetId) return { ok: false, reason: 'notSold' };
    const r = buyOutfit(this.world, this.data, this.landedPlanetId, outfitId);
    this.world = r.world;
    return r.check;
  }

  /** Sell one fitted outfit for half its price (does not save). */
  sellOutfit(outfitId: string): SellCheck {
    if (!this.landedPlanetId) return { ok: false, reason: 'notOwned' };
    const r = sellOutfit(this.world, this.data, outfitId);
    this.world = r.world;
    return r.check;
  }

  /** What buying would do right now, without doing it. */
  outfitQuote(outfitId: string): BuyCheck {
    if (!this.landedPlanetId) return { ok: false, reason: 'notSold' };
    return outfitBuyCheck(this.world, this.data, this.landedPlanetId, outfitId);
  }

  /** Trade in the current ship for another here (like exchange trades, this does not save). */
  buyShip(shipId: string): ShipQuote {
    if (!this.landedPlanetId) return shipQuote(this.world, this.data, '', shipId);
    const r = buyShip(this.world, this.data, this.landedPlanetId, shipId);
    this.world = r.world;
    return r.quote;
  }

  /** Name the ship the pilot flies (the caller cleans the text first). */
  nameShip(name: string): void {
    this.world = { ...this.world, shipName: name };
  }

  /** The pilot has read the survey-ship rumour: remember it as a flag and a note. */
  noteRumour(text: string): void {
    this.world = addNote(setFlag(this.world, 'survey-rumour'), text);
  }

  /** What swapping to this ship would cost right now, without doing it. */
  shipQuote(shipId: string): ShipQuote {
    return shipQuote(this.world, this.data, this.landedPlanetId ?? '', shipId);
  }

  /** Story missions the bar here offers today; none when not landed. */
  storyOffers(): StoryMissionDef[] {
    return this.landedPlanetId ? storyOffersAt(this.world, this.data, this.landedPlanetId) : [];
  }

  /** Whether the story mission can be taken now, and why not. */
  storyAccept(id: string): StoryAccept {
    return canAcceptStory(this.world, this.data, id);
  }

  acceptStory(id: string): StoryAccept {
    const check = canAcceptStory(this.world, this.data, id);
    if (check.ok) {
      this.world = acceptStory(this.world, this.data, id);
      this.refreshStory();
    }
    return check;
  }

  /** Give up a side mission (the main arc can't be abandoned); its cargo is dropped. */
  abandonStory(id: string): void {
    this.world = abandonStory(this.world, this.data, id);
    this.refreshStory();
  }

  declineStory(id: string): void {
    this.world = declineStory(this.world, id);
  }

  /** The next bar that has a mission for us, as a rumour. */
  storyLead(): { portId: string; text: string } | null {
    return nextLead(this.world, this.data);
  }

  /** Today's jobs at the planet we're landed on; none when not landed. */
  offers(): MissionOffer[] {
    return this.landedPlanetId ? offersAt(this.world, this.data, this.landedPlanetId) : [];
  }

  acceptMission(offerId: string): AcceptCheck | { ok: false; reason: 'gone' } {
    const offer = this.offers().find((o) => o.offerId === offerId);
    if (!offer) return { ok: false, reason: 'gone' };
    const check = canAccept(this.world, this.data, offer);
    if (!check.ok) return check;
    this.world = accept(this.world, this.data, offer);
    return { ok: true };
  }

  /** Whether the job can be dropped now (an up-front advance must be refundable). */
  canAbandonMission(id: string): AbandonCheck {
    return canAbandon(this.world, id);
  }

  /** Drop a job; an up-front advance is handed back. No-op when canAbandonMission says no. */
  abandonMission(id: string): void {
    this.world = abandon(this.world, id);
  }

  selectPlanet(id: string | null): void {
    if (id !== null) this.targetSiteId = null;
    this.world = { ...this.world, targetPlanetId: id };
    this.traffic = { ...this.traffic, targetId: null };
  }

  /** Target an NPC ship (or clear the target with null). A ship target replaces any planet target. */
  targetShip(id: string | null): void {
    if (id !== null && !this.traffic.npcs.some((n) => n.id === id && isTargetable(n))) return;
    this.traffic = { ...this.traffic, targetId: id };
    if (id !== null) {
      this.world = { ...this.world, targetPlanetId: null };
      this.targetSiteId = null;
    }
  }

  private maxNpcs(): number {
    return this.settings.quality === 'low' ? 4 : 8;
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
      const keys = this.keyboard.poll(['flight', 'menus']);
      if (keys.pressed.delete('toggleSound')) this.toggleSound();
      const touch = this.touch.poll('flight');
      // Landing and take-off ignore input: it is polled (so it can't fire later) and dropped.
      const locked = this.fx !== null;
      if (this.fx?.kind === 'land') {
        this.queued.clear();
        this.thrusting = false;
        this.fx.t += dt;
        if (this.fx.t >= LANDING_FX_SEC - 1e-9) this.finishLanding(this.fx.planetId);
        return;
      }
      if (locked) this.queued.clear();
      const polled = locked
        ? { actions: new Set<ActionId>(), pressed: new Set<ActionId>() }
        : {
            actions: new Set([...keys.actions, ...touch.actions]),
            pressed: new Set([...keys.pressed, ...touch.pressed]),
          };
      // No star map in hyperspace: the course can't change mid-jump, so the press is ignored.
      const menu = polled.pressed.has('pause')
        ? 'pause'
        : polled.pressed.has('map') && !this.world.jump
          ? 'map'
          : polled.pressed.has('flightMissionLog')
            ? 'missionLog'
            : null;
      if (menu) {
        this.pauseFlight();
        this.emit({ type: 'menu', action: menu });
        return;
      }
      const pressed = new Set([...polled.pressed, ...this.queued]);
      this.queued.clear();
      if (pressed.delete('interact') && this.openEncounter()) return;
      if (pressed.delete('nextTarget')) {
        // Tab walks sites, then ships, then planets (the sim's own planet-only cycle is not used from here).
        const pick = cycleTarget(this.world, this.data, this.traffic, this.targetSites(), this.targetedSite()?.id ?? null);
        this.traffic = { ...this.traffic, targetId: pick.shipId };
        this.world = { ...this.world, targetPlanetId: pick.planetId };
        this.targetSiteId = pick.siteId;
      }
      // The autopilot key flies to a targeted site (the sim's own autopilot only knows planets and the jump point).
      if (pressed.has('autopilot') && this.world.assist.kind !== 'autopilot') {
        const site = this.targetedSite();
        if (site) {
          pressed.delete('autopilot');
          this.world = autopilotToSite(this.world, site);
        }
      }
      const input: FrameInput = touch.stick && !locked
        ? { actions: polled.actions, pressed, stick: touch.stick }
        : { actions: polled.actions, pressed };
      this.prevShip = this.world.ship;
      const wasJumping = this.world.jump !== null;
      const r = stepWorld(this.world, this.data, input, dt, {
        autoLandOnArrival: this.settings.autoLandOnArrival,
      });
      this.world = r.world;
      this.thrusting = r.thrusting ?? false;
      if (!wasJumping && this.world.jump) this.emit({ type: 'sfx', sfx: 'jump' });
      if (this.fx?.kind === 'takeoff') {
        this.fx.t += dt;
        if (this.fx.t >= LANDING_FX_SEC - 1e-9) this.fx = null;
      }
      this.handleEvents(r.events);
      this.stepTraffic(dt);
      this.lapseHail(dt);
      this.syncSiteTarget();
    });
    this.checkContext();
  }

  /** Advance the NPCs one tick; reseed on a new system and drop a target that is no longer there. */
  private stepTraffic(dt: number): void {
    if (this.traffic.systemId !== this.world.systemId) {
      this.traffic = seedTraffic(this.world, this.data, this.maxNpcs());
      this.refreshStory();
      return;
    }
    if (this.world.jump) return;
    let t = stepTraffic(this.traffic, this.world, this.data, dt, this.maxNpcs()).traffic;
    // A ship target that landed or left, or a planet the sim just targeted (landing autopilot), ends it.
    const alive = targetedNpc(t) !== undefined;
    if (!alive || this.world.targetPlanetId !== null) t = { ...t, targetId: null };
    this.traffic = t;
  }

  // ---- encounters ----------------------------------------------------------

  /** The encounter an arrival brings today, placed in space (sites) or on the air (hails), or null. */
  private rollPending(): PendingEncounter | null {
    const def = rollEncounter(this.world, this.data, { guideActive: (this.guide?.current() ?? null) !== null });
    if (!def) return null;
    const r = mulberry32(hashString(this.world.seed, 'encpos', this.world.systemId, this.world.day));
    const npcName = shipName(r, this.data);
    if (def.kind === 'hail') return { def, npcName, kind: 'hail', expiresSec: HAIL_SECONDS };
    const angle = r() * Math.PI * 2;
    const d = SITE_MIN_DIST + r() * SITE_SPREAD;
    const ship = this.world.ship.pos;
    return { def, npcName, kind: 'site', pos: { x: ship.x + Math.cos(angle) * d, y: ship.y + Math.sin(angle) * d } };
  }

  /** Where the pending site lies, or null (no site; a hail has no place). */
  sitePos(): Vec2 | null {
    return this.pending?.kind === 'site' ? this.pending.pos : null;
  }

  /** The story site as the ship can see it: a find site only shows within FIND_SITE_REVEAL px. */
  private visibleStorySite(): StorySite | null {
    const s = this.storySite;
    return s && (!s.hiddenUntilNear || dist(this.world.ship.pos, s.pos) <= FIND_SITE_REVEAL) ? s : null;
  }

  /** Every site to draw and show on radar: the encounter's and the story's visible one. */
  sitePositions(): Vec2[] {
    return [this.sitePos(), this.visibleStorySite()?.pos ?? null].filter((p): p is Vec2 => p !== null);
  }

  /** The sites a pilot can target (story first), as the Tab cycle sees them. */
  targetSites(): SiteTarget[] {
    const story = this.visibleStorySite();
    const enc = this.pending?.kind === 'site' ? this.pending : null;
    return [
      ...(story ? [{ id: 'story', pos: story.pos, label: story.label }] : []),
      ...(enc ? [{ id: 'encounter', pos: enc.pos, label: enc.def.title }] : []),
    ];
  }

  /** The targeted site, or null (also when a ship or planet is targeted, or the site is gone). */
  targetedSite(): SiteTarget | null {
    if (!this.targetSiteId || this.world.targetPlanetId !== null || this.traffic.targetId !== null) return null;
    return this.targetSites().find((s) => s.id === this.targetSiteId) ?? null;
  }

  /** Forget a site target that was replaced by a ship or planet target, or whose site is gone. */
  private syncSiteTarget(): void {
    if (this.targetSiteId && !this.targetedSite()) this.targetSiteId = null;
  }

  /** Is there a story site in view that the ship cannot open yet (the context button offers to fly there)? */
  private canFlyToSite(): boolean {
    const s = this.visibleStorySite();
    return s !== null && !siteReachable(this.world, s.pos);
  }

  /** The context button's `flyToSite`: target the story site and engage the autopilot. */
  private flyToStorySite(): void {
    const site = this.targetSites().find((s) => s.id === 'story');
    if (!site) return;
    this.selectPlanet(null);
    this.targetSiteId = site.id;
    this.world = autopilotToSite(this.world, site);
  }

  /**
   * The story objective for the HUD, or null: a scan or find step whose site is in this system.
   * PC text may hold an `{interact}` token (once the site is reachable); callers fill it with formatMessage.
   */
  objectiveText(touch = false): string | null {
    const s = this.storySite;
    if (!s) return null;
    const step = currentStep(this.world, this.data, s.missionId);
    if (!step || (step.kind !== 'scan' && step.kind !== 'find')) return null;
    const visible = this.visibleStorySite();
    return objectiveText({
      kind: step.kind,
      label: s.label,
      systemName: this.data.systems[this.world.systemId]?.name ?? this.world.systemId,
      distance: visible ? dist(this.world.ship.pos, s.pos) : null,
      reachable: visible !== null && siteReachable(this.world, s.pos),
    }, touch);
  }

  /** The name on the incoming hail (an encounter's or a story meet's), or null with no hail. */
  hailName(forButton = false): string | null {
    if (this.pending?.kind === 'hail') return this.pending.npcName;
    if (this.storyHail && !(forButton && this.storyHail === this.storyHailQuiet)) return this.data.story[this.storyHail]?.giver.name ?? null;
    const step = this.storyMeet ? currentStep(this.world, this.data, this.storyMeet.missionId) : null;
    return step?.kind === 'meet' ? step.ship.name : null;
  }

  /** What the context button knows of the encounter and story sites and hails here. */
  private pendingHint(): PendingHint {
    const sites = this.sitePositions();
    const near = sites.find((p) => siteReachable(this.world, p));
    if (near) return { kind: 'site', pos: near };
    if (this.hailName(true) !== null) return { kind: 'hail' };
    return sites[0] ? { kind: 'site', pos: sites[0] } : null;
  }

  /** "Scan Dead lantern" or "Search Cache" when the site the ship can open right now is a story one, else null (the generic label). */
  openSiteVerb(): string | null {
    const s = this.visibleStorySite();
    const enc = this.sitePos();
    if (!s || !siteReachable(this.world, s.pos) || (enc && siteReachable(this.world, enc))) return null;
    return `${currentStep(this.world, this.data, s.missionId)?.kind === 'find' ? 'Search' : 'Scan'} ${s.label}`;
  }

  /** The context button's text for a site action: "Scan Dead lantern" (openSite), "Fly to Dead lantern" (flyToSite), else null. */
  siteContextText(): string | null {
    const action = this.currentContext();
    if (action === 'openSite') return this.openSiteVerb();
    if (action === 'flyToSite') {
      const s = this.visibleStorySite();
      return s ? `Fly to ${s.label}` : null;
    }
    return null;
  }

  /**
   * Work out the story transients of this system from the current step of each active mission: its
   * scan or find site, and its meet ship (a pinned NPC in `traffic`). Safe to call at any time: the
   * same step gives the same place, and a ship that is already there is left flying.
   */
  private refreshStory(): void {
    const sys = this.world.systemId;
    let site: StorySite | null = null;
    let meet: StoryMeet | null = null;
    let spec: Parameters<typeof addStoryNpc>[1] | null = null;
    for (const a of this.world.story.active) {
      const step = currentStep(this.world, this.data, a.id);
      if (!step || !('system' in step) || step.system !== sys) continue;
      if ((step.kind === 'scan' || step.kind === 'find') && !site) {
        site = { missionId: a.id, pos: storySitePos(this.world, a.id, sys), label: step.site.label, hiddenUntilNear: step.kind === 'find' };
      } else if (step.kind === 'meet' && !meet) {
        meet = { missionId: a.id, npcId: `story-${a.id}-${a.step}` };
        spec = { id: meet.npcId, name: step.ship.name, shipId: step.ship.shipId, government: step.ship.government, holdPos: storyHoldPos(this.world, a.id, sys) };
      }
    }
    this.storySite = site;
    this.storyMeet = meet;
    this.storyHail = storyHailAt(this.world, this.data, sys)?.id ?? null;
    if (this.storyHail !== this.storyHailQuiet) this.storyHailQuiet = null;
    if (this.traffic.systemId !== sys) return; // the reseed that follows calls this again
    // Story ships left over from a finished step go; the current one stays where it is.
    const stale = (n: { id: string; hold?: Vec2 }) => n.hold !== undefined && n.id !== meet?.npcId;
    let t = this.traffic;
    if (t.npcs.some(stale)) {
      const target = t.npcs.find((n) => n.id === t.targetId);
      t = { ...t, npcs: t.npcs.filter((n) => !stale(n)), targetId: target && stale(target) ? null : t.targetId };
    }
    if (spec && !t.npcs.some((n) => n.id === spec.id)) t = addStoryNpc(t, spec);
    this.traffic = t;
  }

  /** Scan or search the story site: the step is done, flight goes on. */
  private useStorySite(site: StorySite): void {
    const r = advanceStory(this.world, this.data, { kind: 'site', missionId: site.missionId });
    this.world = r.world;
    this.refreshStory();
    this.emit({ type: 'sfx', sfx: 'site' });
    if (r.messages.length > 0) this.emit({ type: 'message', text: r.messages.join(' ') });
  }

  private lapseHail(dt: number): void {
    const p = this.pending;
    if (p?.kind !== 'hail') return;
    const left = p.expiresSec - dt;
    this.pending = left <= 1e-9 ? null : { ...p, expiresSec: left };
  }

  /** Test aid: make `id` the pending encounter (a hail now, or a site 200 px ahead). */
  forceEncounter(id: string): void {
    const def = this.data.encounters[id];
    if (!def) throw new Error(`forceEncounter: unknown encounter ${id}`);
    const npcName = shipName(mulberry32(hashString(this.world.seed, 'encforce', id)), this.data);
    const { pos, heading } = this.world.ship;
    this.pending =
      def.kind === 'hail'
        ? { def, npcName, kind: 'hail', expiresSec: HAIL_SECONDS }
        : { def, npcName, kind: 'site', pos: { x: pos.x + Math.cos(heading) * 200, y: pos.y + Math.sin(heading) * 200 } };
    this.emit({ type: 'sfx', sfx: this.pending.kind });
    this.checkContext();
  }

  /**
   * Answer the hail or open the site: flight pauses and the encounter card is asked for. A site
   * out of reach says so instead. False when nothing opened.
   */
  openEncounter(): boolean {
    const p = this.pending;
    if (!this.flying || this.fx || this.world.jump) return false;
    // A reachable site wins (the encounter's, then the story's), then a hail (the encounter's, then the story's).
    const story = this.visibleStorySite();
    if (p?.kind === 'site' && siteReachable(this.world, p.pos)) return this.openCard('encounter');
    if (story && siteReachable(this.world, story.pos)) {
      this.useStorySite(story);
      this.checkContext();
      return true;
    }
    if (p?.kind === 'hail') return this.openCard('encounter');
    if (this.storyHail) {
      const id = this.storyHail;
      const def = this.data.story[id];
      if (def && !def.declinable) {
        // A hail that can't be put off takes the mission at once; the card then shows its offer and accept text.
        const check = canAcceptStory(this.world, this.data, id);
        if (!check.ok) {
          this.storyHailQuiet = id;
          this.emit({ type: 'message', text: `${def.giver.name} has an offer, but: ${STORY_BLOCK_REASON[check.reason]}.` });
          this.checkContext();
          return false;
        }
        const r = answerStoryHail(this.world, this.data, id);
        this.world = r.world;
        if (r.messages.length > 0) this.emit({ type: 'message', text: r.messages.join(' ') });
      }
      // A hail that can be put off opens as an offer: Accept takes it, Not now leaves it.
      this.hailCard = id;
      this.refreshStory();
      return this.openCard('hail');
    }
    if (this.storyMeet) return this.openCard('story');
    if (p?.kind === 'site' || story) {
      this.emit({ type: 'message', text: 'Move closer to the site and slow down to open it.' });
    }
    return false;
  }

  private openCard(card: 'encounter' | 'story' | 'hail'): true {
    this.card = card;
    this.pauseFlight();
    this.emit({ type: 'encounter' });
    return true;
  }

  /** "Not now" on a hail: it lapses at once (a story hail stands). A site stays where it is. */
  declineEncounter(): void {
    if (this.card === 'story' || this.card === 'hail') {
      if (this.card === 'hail' && this.hailCard && !this.world.story.active.some((a) => a.id === this.hailCard)) {
        this.storyHailQuiet = this.hailCard;
      }
      this.card = null;
      this.hailCard = null;
      this.checkContext();
      return;
    }
    if (this.pending?.kind === 'hail') {
      this.pending = null;
      this.checkContext();
    }
  }

  /** The pending encounter as the card shows it (text filled in, blocked choices marked), or null. */
  encounterView(): EncounterView | null {
    const hail = this.card === 'hail' && this.hailCard ? this.data.story[this.hailCard] : undefined;
    if (hail) {
      const ctx = this.cardContext(hail.giver.name);
      if (this.world.story.active.some((a) => a.id === hail.id)) {
        return { kind: 'hail', title: hail.title, text: `${fillText(hail.text, ctx)} ${fillText(hail.acceptText, ctx)}`, choices: [{ label: 'Understood', blocked: null }], noDecline: true };
      }
      const check = canAcceptStory(this.world, this.data, hail.id);
      return { kind: 'hail', title: hail.title, text: fillText(hail.text, ctx), choices: [{ label: 'Accept', blocked: check.ok ? null : STORY_BLOCK_REASON[check.reason] }] };
    }
    const meet = this.card === 'story' && this.storyMeet ? currentStep(this.world, this.data, this.storyMeet.missionId) : null;
    if (meet?.kind === 'meet') {
      const ctx = this.cardContext(meet.ship.name);
      return {
        kind: 'hail',
        title: fillText(meet.card.title, ctx),
        text: fillText(meet.card.text, ctx),
        choices: meet.card.choices.map((c) => {
          const block = choiceBlock(this.world, this.data, c, `story:${this.storyMeet!.missionId}`);
          return { label: fillText(c.label, ctx), blocked: block ? ENCOUNTER_BLOCK_TEXT[block] : null };
        }),
      };
    }
    const p = this.pending;
    if (!p) return null;
    const ctx = this.cardContext(p.npcName);
    return {
      kind: p.kind,
      title: fillText(p.def.title, ctx),
      text: fillText(p.def.text, ctx),
      choices: p.def.choices.map((c) => {
        const block = choiceBlock(this.world, this.data, c, p.def.id);
        return { label: fillText(c.label, ctx), blocked: block ? ENCOUNTER_BLOCK_TEXT[block] : null };
      }),
    };
  }

  private cardContext(ship: string) {
    return { ship, system: this.data.systems[this.world.systemId]?.name ?? this.world.systemId, pilot: shipDisplayName(this.world.shipName, this.world.shipId, this.data), hub: hubName(this.data) };
  }

  /** Take choice `idx`: null if there is no encounter or the choice is blocked; else the outcome lines. */
  chooseEncounter(idx: number): { messages: string[] } | null {
    if (this.card === 'hail') {
      const id = this.hailCard;
      const def = id ? this.data.story[id] : undefined;
      if (idx !== 0 || !id || !def) return null;
      let messages: string[] = [];
      if (!this.world.story.active.some((a) => a.id === id)) {
        const r = answerStoryHail(this.world, this.data, id);
        if (r.world === this.world) return null; // it can't be taken (the choice shows why)
        this.world = r.world;
        messages = [fillText(def.acceptText, this.cardContext(def.giver.name)), ...r.messages];
      }
      this.card = null;
      this.hailCard = null;
      this.refreshStory();
      this.checkContext();
      return { messages };
    }
    if (this.card === 'story') return this.chooseStory(idx);
    const p = this.pending;
    const choice = p?.def.choices[idx];
    if (!p || !choice || choiceBlock(this.world, this.data, choice, p.def.id)) return null;
    const r = applyChoice(this.world, this.data, p.def, idx, { npcName: p.npcName });
    this.world = r.world;
    this.pending = null;
    this.checkContext();
    return { messages: [...r.messages, ...r.missions.map((m) => `New job: ${m.title}`)] };
  }

  /** A story meet card's choice: its outcomes go to the story rules, which advance the step. */
  private chooseStory(idx: number): { messages: string[] } | null {
    const meet = this.storyMeet;
    const step = meet ? currentStep(this.world, this.data, meet.missionId) : null;
    const choice = step?.kind === 'meet' ? step.card.choices[idx] : undefined;
    if (!meet || !choice || choiceBlock(this.world, this.data, choice, `story:${meet.missionId}`)) return null;
    const r = advanceStory(this.world, this.data, { kind: 'card', missionId: meet.missionId, outcomes: choice.outcomes });
    this.world = r.world;
    this.card = null;
    this.refreshStory();
    this.checkContext();
    return { messages: r.messages };
  }

  /** Flip mute, save it and say so (the HUD shows the message in flight, the planet screen while landed). */
  toggleSound(): void {
    this.settings.muted = !this.settings.muted;
    saveSettings(this.settings);
    this.emit({ type: 'message', text: this.settings.muted ? 'Sound off' : 'Sound on' });
  }

  /** One poll per frame for whichever screen is open; with none, stale presses are drained. */
  private updateUi(): void {
    const ui = this.uiInput;
    const { pressed } = this.keyboard.poll(ui ? [...new Set<ActionGroup>([...ui.groups, 'menus'])] : 'menus');
    this.touch.poll('flight'); // drain: a tap made while paused must not fire on resume
    // The sound key works on every screen, whatever groups the screen listens to.
    if (pressed.delete('toggleSound')) this.toggleSound();
    if (ui) {
      // The screen sees only the groups it asked for.
      for (const id of [...pressed]) if (!ui.groups.includes(ACTION_GROUP[id])) pressed.delete(id);
      if (pressed.size > 0) ui.handler(pressed);
    }
  }

  /**
   * Route one batch of sim events. Messages are gathered first: after a tow they become planet
   * screen notices (queued before `towed` opens that screen); otherwise they are joined into one
   * HUD message so several failures from one jump don't overwrite each other.
   */
  private handleEvents(events: SimEvent[]): void {
    const messages = events.flatMap((e) => (e.type === 'message' ? [e.text] : []));
    const towed = events.some((e) => e.type === 'towed');
    // Arriving may finish a story step (story deadlines were checked by the day advance).
    const arrival = events.find((e): e is Extract<SimEvent, { type: 'arrived' }> => e.type === 'arrived');
    if (arrival) {
      const r = advanceStory(this.world, this.data, { kind: 'arrived', systemId: arrival.systemId });
      this.world = r.world;
      messages.push(...r.messages);
    }
    if (towed) this.notices.push(...messages);
    for (const e of events) {
      if (e.type === 'message') continue;
      if (e.type === 'landed') {
        // The ship shrinks onto the planet first; finishLanding does what landing used to do at once.
        this.fx = { kind: 'land', planetId: e.planetId, t: 0 };
        this.prevShip = this.world.ship;
        continue;
      }
      if (e.type === 'towed') {
        this.pending = null;
        this.card = null;
        this.traffic = seedTraffic(this.world, this.data, this.maxNpcs());
        this.landAt(e.planetId);
      } else if (e.type === 'jumped') {
        this.pending = null;
        this.card = null;
        this.storySite = null;
        this.targetSiteId = null;
        this.storyMeet = null;
        this.storyHail = null;
        this.storyHailQuiet = null;
        this.prevShip = this.world.ship; // no interpolation across systems
        this.traffic = seedTraffic(this.world, this.data, this.maxNpcs());
      }
      if (e.type === 'arrived') {
        this.refreshStory();
        this.pending = this.rollPending();
        if (this.pending) this.world = { ...this.world, lastEncounterDay: this.world.day };
        this.emit(e);
        if (this.pending) this.emit({ type: 'sfx', sfx: this.pending.kind });
        continue;
      }
      this.emit(e);
    }
    if (!towed && messages.length > 0) this.emit({ type: 'message', text: messages.join(' ') });
  }

  /** The landing effect is over: complete jobs, autosave and hand over to the planet screen. */
  private finishLanding(planetId: string): void {
    this.landAt(planetId);
    this.emit({ type: 'landed', planetId });
  }

  private landAt(planetId: string, autosave = true): void {
    this.fx = null;
    this.thrusting = false;
    this.pauseFlight();
    this.landedPlanetId = planetId;
    this.lastPlanetId = planetId;
    this.prevShip = this.world.ship;
    this.alpha = 0;
    // Pay lands in the world first so the autosave below includes it.
    const done = completeAt(this.world, planetId);
    if (done.completed.length > 0) {
      this.world = { ...done.world, stats: { ...done.world.stats, jobsDone: done.world.stats.jobsDone + done.completed.length } };
      this.completion = { missions: done.completed, pay: done.pay };
      this.emit({ type: 'missionsCompleted', missions: done.completed, pay: done.pay });
    }
    if (autosave) {
      // A real landing (not loading a save) can finish a story step; its messages wait on the planet screen.
      const story = advanceStory(this.world, this.data, { kind: 'landed', planetId });
      this.world = story.world;
      this.notices.push(...story.messages);
    }
    this.refreshStory();
    // The scan or find site of a story step here is in open space, not at this port: say so.
    if (autosave && this.storySite) this.notices.push(siteNoticeText(this.storySite.label, this.storySite.hiddenUntilNear));
    if (autosave) this.autosave();
  }

  private checkContext(): void {
    const c = this.flying && !this.fx ? this.currentContext() : null;
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
