import type { GameData } from '../data/schemas';
import type { ActionId } from '../input/actions';
import { isHostileToPlayer, nearestHostile, newBattle, stepBattle, type Battle, type BattleEvent } from '../sim/battle';
import { canBoard } from '../sim/boarding';
import { driftShip, fullHull } from '../sim/combat';
import { shipStats } from '../sim/shipStats';
import { isTargetable, targetedNpc, type Npc, type Traffic } from '../sim/traffic';
import type { FrameInput, WorldState } from '../sim/types';
import { add, dist, fromAngle, scale } from '../sim/vec';
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

/**
 * The fight in the current system, beside the controller's traffic. It is transient: reset on
 * arrival, landing, take-off and load (a landed ship is repaired and saves happen only landed).
 */
export class CombatControl {
  battle: Battle;
  /** Seconds the player has been disabled with no hostile within CALM_RANGE; 0 otherwise. */
  disabledCalmSec = 0;

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
  }

  playerDisabled(): boolean {
    return this.battle.player.disabled;
  }

  /** Disabled long enough with no hostile near to call a tow. */
  disabledCalm(): boolean {
    return this.playerDisabled() && this.disabledCalmSec >= CALM_SEC - 1e-9;
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
  tick(world: WorldState, traffic: Traffic, input: FrameInput, dt: number): { world: WorldState; traffic: Traffic; events: BattleEvent[] } {
    if (this.battle.systemId !== world.systemId) this.reset(world);
    const r = stepBattle(this.battle, world, traffic, input, this.data, dt);
    this.battle = r.battle;
    if (!this.playerDisabled()) this.disabledCalmSec = 0;
    else if (this.hostileWithin(r.world, r.traffic, CALM_RANGE)) this.disabledCalmSec = 0;
    else this.disabledCalmSec += dt;
    return { world: r.world, traffic: r.traffic, events: r.events };
  }

  /** The ship Board would board: the target if it can be boarded, else the nearest that can; null when disabled. */
  boardable(world: WorldState, traffic: Traffic): Npc | null {
    if (this.playerDisabled() || world.jump) return null;
    const ok = (n: Npc) => isTargetable(n) && canBoard(world, this.data, n);
    const target = targetedNpc(traffic);
    if (target && ok(target)) return target;
    let best: Npc | null = null;
    for (const n of traffic.npcs) {
      if (ok(n) && (!best || dist(n.ship.pos, world.ship.pos) < dist(best.ship.pos, world.ship.pos))) best = n;
    }
    return best;
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
