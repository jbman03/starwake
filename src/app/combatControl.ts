import type { GameData } from '../data/schemas';
import type { ActionId } from '../input/actions';
import { angerGovernment, isHostileToPlayer, nearestHostile, newBattle, stepBattle, type Battle, type BattleEvent } from '../sim/battle';
import {
  canBoard,
  canTakeCommand,
  captureOdds,
  captureSucceeds,
  COMMAND_BLOCK_TEXT,
  lootOf,
  prizeValue,
  sellPrize,
  takeAmmo,
  takeCargo,
  takeCommand,
  takeCredits,
  type Loot,
} from '../sim/boarding';
import { driftShip, fullHull } from '../sim/combat';
import { shipStats, worldStats } from '../sim/shipStats';
import { governmentShortName } from '../sim/standing';
import { isTargetable, targetedNpc, type Npc, type Traffic } from '../sim/traffic';
import type { FrameInput, WorldState } from '../sim/types';
import { add, dist, fromAngle, scale } from '../sim/vec';
import { demandTerms, dumpCargo, payCredits, type DemandTerms } from '../sim/raiders';
import { npcLoadout } from '../sim/weapons';
import { newWorld } from '../sim/world';

/** A disabled pilot may call a tow once no hostile has been this close (px)... */
export const CALM_RANGE = 1500;
/** ...for this long (s). */
export const CALM_SEC = 5;
/** How far ahead of the ship the test hook puts a raider (px). */
export const SPAWN_AHEAD = 400;

/** What a disabled ship can't do: steer, fire, use an assist, land or jump. Menus, targeting and cycling still work. */
const DISABLED_BLOCKED: ReadonlySet<ActionId> = new Set<ActionId>([
  'thrust',
  'turnLeft',
  'turnRight',
  'reverse',
  'autoStop',
  'firePrimary',
  'fireSecondary',
  'faceTarget',
  'land',
  'jump',
  'autopilot',
]);

const allowed = (s: ReadonlySet<ActionId>): Set<ActionId> => new Set([...s].filter((a) => !DISABLED_BLOCKED.has(a)));

/** The player is out of the fight for this long (s) before the Destroyed card. */
export const DESTROYED_DELAY_SEC = 2;
/** A ship that drove off a boarding party is scuttled this long (s) after the card closes. */
export const SCUTTLE_SEC = 3;
/** Take command patches the new hull to this fraction of its armor, with no shields. */
export const COMMAND_ARMOR_FRACTION = 0.25;

export type BoardingChoice = 'credits' | 'cargo' | 'ammo' | 'capture' | 'command' | 'prize' | 'leave';

/** What the boarding card shows. */
export interface BoardingView {
  shipLabel: string;
  stage: 'loot' | 'captured';
  rows: { id: 'credits' | 'cargo' | 'ammo' | 'capture'; label: string; blocked: string | null; used: boolean }[];
  commandBlocked: string | null;
  prize: number;
}

/** One ship's boarding so far; it outlives the card, so a take is used once however often she is boarded. */
interface BoardingSession {
  npcId: string;
  /** What was aboard when the party came over (labels). */
  loot: Loot;
  /** What is still aboard. */
  left: Loot;
  used: Set<'credits' | 'cargo' | 'ammo'>;
  stage: 'loot' | 'captured';
  /** The capture was tried and failed: boarding is over and she scuttles when the card closes. */
  failed: boolean;
  tried: boolean;
}

/** A raider's open demand. */
export interface DemandOffer {
  npcId: string;
  npcName: string;
  terms: DemandTerms;
}

/**
 * The fight in the current system, beside the controller's traffic. It is transient: reset on
 * arrival, landing, take-off and load (a landed ship is repaired and saves happen only landed).
 */
export class CombatControl {
  battle: Battle;
  /** Seconds the player has been disabled with no hostile within CALM_RANGE; 0 otherwise. */
  disabledCalmSec = 0;
  /** Raiders whose demand has been put to the player (once each). */
  private readonly offered = new Set<string>();
  private readonly sessions = new Map<string, BoardingSession>();
  /** The ship whose boarding card is open, or null. */
  boardingId: string | null = null;
  /** Ships scuttled by their crews, with the seconds until each is destroyed. */
  private scuttling: { id: string; sec: number }[] = [];
  /** Seconds since the player was destroyed, or null. */
  private destroyedSec: number | null = null;

  constructor(
    private readonly data: GameData,
    world: WorldState = newWorld(data),
  ) {
    this.battle = newBattle(world, data);
  }

  /** A fresh fight for `world`'s system: full hull, no shots in flight, nobody angry. */
  reset(world: WorldState): void {
    this.battle = newBattle(world, this.data);
    this.disabledCalmSec = 0;
    this.offered.clear();
    this.sessions.clear();
    this.boardingId = null;
    this.scuttling = [];
    this.destroyedSec = null;
  }

  playerDisabled(): boolean {
    return this.battle.player.disabled;
  }

  /** Disabled long enough with no hostile near to call a tow. */
  disabledCalm(): boolean {
    return this.playerDisabled() && !this.battle.playerDestroyed && this.disabledCalmSec >= CALM_SEC - 1e-9;
  }

  /**
   * The world and input stepWorld should see this tick. A disabled ship gets no flight, fire,
   * assist, landing or jump input, and it drifts to rest (stepWorld then coasts it).
   */
  flightInput(world: WorldState, input: FrameInput, dt: number): { world: WorldState; input: FrameInput } {
    if (!this.playerDisabled() || world.jump) return { world, input };
    const vel = driftShip(world.ship, dt).vel;
    return {
      world: { ...world, assist: { kind: 'none' }, ship: { ...world.ship, vel } },
      input: { actions: allowed(input.actions), pressed: allowed(input.pressed) },
    };
  }

  /** One fight tick, after stepWorld. Returns the new world and traffic and this tick's events. */
  tick(world: WorldState, traffic: Traffic, input: FrameInput, dt: number): { world: WorldState; traffic: Traffic; events: BattleEvent[]; lost: boolean } {
    if (this.battle.systemId !== world.systemId) this.reset(world);
    const r = stepBattle(this.battle, world, traffic, input, this.data, dt);
    this.battle = r.battle;
    if (!this.playerDisabled()) this.disabledCalmSec = 0;
    else if (this.hostileWithin(r.world, r.traffic, CALM_RANGE)) this.disabledCalmSec = 0;
    else this.disabledCalmSec += dt;
    let t = r.traffic;
    const events = [...r.events];
    // A scuttled ship blows up at its own position when the time is up.
    const due: string[] = [];
    this.scuttling = this.scuttling.map((x) => ({ ...x, sec: x.sec - dt })).filter((x) => (x.sec <= 1e-9 ? (due.push(x.id), false) : true));
    for (const id of due) {
      const n = t.npcs.find((x) => x.id === id);
      if (!n) continue;
      events.push({ type: 'destroyed', id, byPlayer: false, pos: { ...n.ship.pos } });
      t = { ...t, npcs: t.npcs.filter((x) => x.id !== id), targetId: t.targetId === id ? null : t.targetId };
    }
    let lost = false;
    if (this.battle.playerDestroyed && this.destroyedSec === null) this.destroyedSec = 0;
    else if (this.destroyedSec !== null) {
      const before = this.destroyedSec;
      this.destroyedSec += dt;
      lost = before < DESTROYED_DELAY_SEC - 1e-9 && this.destroyedSec >= DESTROYED_DELAY_SEC - 1e-9;
    }
    return { world: r.world, traffic: t, events, lost };
  }

  // ---- boarding -------------------------------------------------------------

  /** Open the boarding of the ship in reach (a new session, or the one already begun); null with none. */
  startBoarding(world: WorldState, traffic: Traffic): Npc | null {
    const npc = this.boardable(world, traffic);
    if (!npc) return null;
    if (!this.sessions.has(npc.id)) {
      const loot = lootOf(world, this.data, npc);
      this.sessions.set(npc.id, { npcId: npc.id, loot, left: loot, used: new Set(), stage: 'loot', failed: false, tried: false });
    }
    this.boardingId = npc.id;
    return npc;
  }

  boardingView(world: WorldState, traffic: Traffic): BoardingView | null {
    const s = this.boardingId ? this.sessions.get(this.boardingId) : undefined;
    const npc = s && traffic.npcs.find((n) => n.id === s.npcId);
    if (!s || !npc) return null;
    const cargoT = Object.values(s.loot.cargo).reduce((a, b) => a + b, 0);
    const ammoN = Object.values(s.loot.ammo).reduce((a, b) => a + b, 0);
    const done = s.failed || s.tried;
    const check = canTakeCommand(world, this.data, npc);
    return {
      shipLabel: `${npc.name} (${this.data.ships[npc.shipId].name})`,
      stage: s.stage,
      rows: [
        { id: 'credits', label: `Take credits (${s.loot.credits} cr)`, blocked: s.loot.credits <= 0 ? 'Nothing aboard' : null, used: s.used.has('credits') || s.tried },
        { id: 'cargo', label: `Take cargo (${cargoT} t)`, blocked: cargoT <= 0 ? 'No cargo aboard' : null, used: s.used.has('cargo') || s.tried },
        { id: 'ammo', label: `Take ammo (${ammoN})`, blocked: ammoN <= 0 ? 'No ammo aboard' : null, used: s.used.has('ammo') || s.tried },
        { id: 'capture', label: `Attempt capture (${Math.round(captureOdds(world, this.data, npc) * 100)}%)`, blocked: null, used: done },
      ],
      commandBlocked: check.ok ? null : COMMAND_BLOCK_TEXT[check.reason],
      prize: prizeValue(this.data, npc),
    };
  }

  /** Take a row, try the capture, take command or sell; null when it can't be done. Leave is `leaveBoarding`. */
  boardChoose(world: WorldState, traffic: Traffic, choice: Exclude<BoardingChoice, 'leave'>): { world: WorldState; traffic: Traffic; messages: string[]; ended: boolean } | null {
    const s = this.boardingId ? this.sessions.get(this.boardingId) : undefined;
    const npc = s && traffic.npcs.find((n) => n.id === s.npcId);
    if (!s || !npc || s.failed) return null;
    const rows = this.boardingView(world, traffic)?.rows ?? [];
    const keep = (w: WorldState, messages: string[]) => ({ world: w, traffic, messages, ended: false });
    if (s.stage === 'loot') {
      if (choice === 'credits' || choice === 'cargo' || choice === 'ammo') {
        const row = rows.find((r) => r.id === choice);
        if (!row || row.used || row.blocked || s.tried) return null;
        const t = choice === 'credits' ? takeCredits(world, s.left) : choice === 'cargo' ? takeCargo(world, this.data, s.left) : takeAmmo(world, this.data, s.left);
        s.left = t.loot;
        s.used.add(choice);
        return keep(t.world, [t.text]);
      }
      if (choice !== 'capture' || s.tried) return null;
      s.tried = true;
      if (!captureSucceeds(world, this.data, npc)) {
        s.failed = true;
        return keep(world, ['The crew drives your party off.']);
      }
      s.stage = 'captured';
      const a = angerGovernment(world, this.battle, npc, true);
      this.battle = a.battle;
      const messages = ['Your party takes the bridge. The ship is yours.'];
      if (a.angered) messages.push(`The ${governmentShortName(npc.government, this.data)} will remember that.`);
      return keep(a.world, messages);
    }
    const gone = (): Traffic => ({ ...traffic, npcs: traffic.npcs.filter((n) => n.id !== npc.id), targetId: traffic.targetId === npc.id ? null : traffic.targetId });
    if (choice === 'prize') {
      const w = sellPrize(world, this.data, npc);
      this.endBoarding(npc.id);
      return { world: w, traffic: gone(), messages: [`You sell ${npc.name} as a prize for ${prizeValue(this.data, npc)} credits.`], ended: true };
    }
    if (choice === 'command') {
      if (!canTakeCommand(world, this.data, npc).ok) return null;
      const w = takeCommand(world, this.data, npc);
      const st = worldStats(w, this.data);
      const hull = fullHull(st.shields, st.armor);
      // Patched up: a quarter of the armor and no shields. Infinity keeps the shields from recharging until the next landing.
      this.battle = {
        ...this.battle,
        player: { ...hull, armor: hull.maxArmor * COMMAND_ARMOR_FRACTION, shields: 0, lastHitSec: Infinity },
        secondary: newBattle(w, this.data).secondary,
        cooldowns: {},
      };
      this.endBoarding(npc.id);
      return { world: w, traffic: gone(), messages: [`You take command of ${npc.name}. She is patched up but not yet sound.`], ended: true };
    }
    return null;
  }

  /** Close the boarding card. A ship that drove the party off is scuttled 3 s later. */
  leaveBoarding(): void {
    const s = this.boardingId ? this.sessions.get(this.boardingId) : undefined;
    this.boardingId = null;
    if (s?.failed && !this.scuttling.some((x) => x.id === s.npcId)) this.scuttling.push({ id: s.npcId, sec: SCUTTLE_SEC });
  }

  private endBoarding(id: string): void {
    this.sessions.delete(id);
    this.boardingId = null;
  }

  /** The ship Board would board: the target if it can be boarded, else the nearest that can; null when disabled. */
  boardable(world: WorldState, traffic: Traffic): Npc | null {
    if (this.playerDisabled() || world.jump) return null;
    const ok = (n: Npc) => isTargetable(n) && !this.sessions.get(n.id)?.failed && canBoard(world, this.data, n);
    const target = targetedNpc(traffic);
    if (target && ok(target)) return target;
    let best: Npc | null = null;
    for (const n of traffic.npcs) {
      if (ok(n) && (!best || dist(n.ship.pos, world.ship.pos) < dist(best.ship.pos, world.ship.pos))) best = n;
    }
    return best;
  }

  /**
   * Put a new demand to the player: the first raider with `demand` not yet offered makes it. When
   * `busy` (an encounter, story hail or another demand is pending) it, and any other new demander,
   * drops the demand and attacks instead, so nothing pending is overwritten.
   */
  checkDemands(world: WorldState, traffic: Traffic, busy: boolean): { traffic: Traffic; offer: DemandOffer | null } {
    let offer: DemandOffer | null = null;
    let changed = false;
    const npcs = traffic.npcs.map((n) => {
      if (!n.demand || this.offered.has(n.id) || n.hull.disabled) return n;
      this.offered.add(n.id);
      if (busy || offer) {
        changed = true;
        return { ...n, demand: false, engaged: true };
      }
      offer = { npcId: n.id, npcName: n.name, terms: demandTerms(world, this.data) };
      return n;
    });
    return { traffic: changed ? { ...traffic, npcs } : traffic, offer };
  }

  /**
   * The player's answer. Pay or dump: the raider stands down and leaves; null if that can't be done
   * (short of credits, no cargo). Refuse: it attacks at once. A raider no longer there just ends.
   */
  resolveDemand(world: WorldState, traffic: Traffic, offer: DemandOffer, answer: 'pay' | 'dump' | 'refuse'): { world: WorldState; traffic: Traffic; messages: string[] } | null {
    const raider = traffic.npcs.find((n) => n.id === offer.npcId);
    if (answer !== 'refuse' && (!raider || raider.hull.disabled || raider.phase === 'gone')) {
      return { world, traffic, messages: [`${offer.npcName}'s hail goes quiet.`] };
    }
    if (answer === 'refuse' && (!raider || raider.hull.disabled)) {
      return { world, traffic, messages: [`${offer.npcName}'s hail goes quiet.`] };
    }
    let next: WorldState | null = world;
    if (answer === 'pay') next = payCredits(world, offer.terms);
    else if (answer === 'dump') next = dumpCargo(world, offer.terms);
    if (!next) return null;
    const npcs = traffic.npcs.map((n) =>
      n.id !== offer.npcId
        ? n
        : answer === 'refuse'
          ? { ...n, demand: false, engaged: true, peaceful: false }
          : { ...n, demand: false, peaceful: true, engaged: false, errand: 'pass' as const, portId: null },
    );
    const messages =
      answer === 'pay' ? [`You pay ${offer.terms.credits} cr. ${offer.npcName} leaves.`] : answer === 'dump' ? [`You dump the cargo. ${offer.npcName} leaves.`] : [`${offer.npcName} attacks.`];
    return { world: next, traffic: { ...traffic, npcs }, messages };
  }

  /** Whether `n` would fight the player in this battle. */
  isHostile(n: Npc, world: WorldState): boolean {
    return isHostileToPlayer(n, world, this.battle);
  }

  private hostileWithin(world: WorldState, traffic: Traffic, range: number): boolean {
    const id = nearestHostile(world, traffic, this.battle);
    const n = id ? traffic.npcs.find((x) => x.id === id) : undefined;
    return n !== undefined && dist(n.ship.pos, world.ship.pos) <= range;
  }
}

/** Test support: an engaged raider in a `shipId` hull, SPAWN_AHEAD px ahead of the ship. */
export function hostileAhead(world: WorldState, traffic: Traffic, data: GameData, shipId = 'kestrel'): { traffic: Traffic; id: string } {
  const def = data.ships[shipId];
  if (!def) throw new Error(`hostileAhead: unknown ship ${shipId}`);
  let k = 1;
  while (traffic.npcs.some((n) => n.id === `test-raider-${k}`)) k++;
  const id = `test-raider-${k}`;
  const outfits = { ...npcLoadout(def) };
  const st = shipStats(def.id, outfits, data);
  const npc: Npc = {
    id,
    name: `Test Raider ${k}`,
    shipId: def.id,
    government: 'raiders',
    errand: 'pass',
    ship: { pos: add(world.ship.pos, scale(fromAngle(world.ship.heading), SPAWN_AHEAD)), vel: { x: 0, y: 0 }, heading: world.ship.heading + Math.PI, fuel: def.fuelCapacity },
    portId: null,
    phase: 'fly',
    phaseT: 0,
    thrusting: false,
    role: 'raider',
    hull: fullHull(st.shields, st.armor),
    outfits,
    aggro: [],
    engaged: true,
    peaceful: false,
    demand: false,
    killCounted: false,
  };
  return { traffic: { ...traffic, npcs: [...traffic.npcs, npc] }, id };
}
