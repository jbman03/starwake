import type { GameData } from '../data/schemas';
import type { ActionId } from '../input/actions';
import { priceOf } from '../sim/economy';
import type { WorldState } from '../sim/types';
import { clearProgress, loadProgress, saveProgress, STEP_COUNT, type Progress } from './progress';
import { BUY_TONS, STEPS, type GuideState } from './steps';
import { bestSellPort, pickTarget, pickTargetNear, type GuideTarget } from './target';

/** The slice of Controller the guide reads. Controller satisfies it. */
export interface GuideHost {
  world: WorldState;
  landedPlanetId: string | null;
  pilot: { id: string } | null;
}

export interface GuideDeps {
  mode(): 'keyboard' | 'touch';
  /** Label of the player's key for an action (e.g. hotkeyFor); keeps this module UI-free. */
  key(action: ActionId): string;
  /** Defaults to localStorage; storage failures never break the guide. */
  storage?: Storage;
}

const LEAVE_STEP = 5;

/** A hint as Guide.current() returns it. */
export type GuideHint = { text: string; step: number; total: number };

/** True on the last ("Nice trade") card, which is dismissed rather than skipped. */
export const isFinalStep = (c: GuideHint | null | undefined): boolean => !!c && c.step === c.total;

/** Label of every hint's skip control: "Dismiss" on the final card, else "Skip guide". */
export const skipLabel = (c: GuideHint | null | undefined): string => (isFinalStep(c) ? 'Dismiss' : 'Skip guide');

/**
 * Runtime for the First Flight walkthrough. It never subscribes to anything: the UI layer calls
 * update() with a fresh snapshot whenever something changes. It never acts for the player.
 */
export class Guide {
  private p: Progress | null = null;
  private last: GuideState | null = null;
  private lastLanded: string | null = null;
  private listeners = new Set<() => void>();

  constructor(
    private readonly host: GuideHost,
    private readonly data: GameData,
    private readonly deps: GuideDeps,
  ) {}

  private saved(): Progress | null {
    const id = this.host.pilot?.id;
    const p = id ? loadProgress(id, this.deps.storage) : null;
    if (!p) return null;
    const t = p.target;
    if (!this.data.commodities[t.good] || !this.data.systems[t.system] || !this.data.planets[t.port]) return null;
    if (p.buyPort && !this.data.planets[p.buyPort]) p.buyPort = undefined;
    if (!p.fallback && !p.buyPort) {
      // Saved before buyPort was stored: the port this trade is picked from, if we can tell.
      const same = (g: GuideTarget | null) => !!g && g.good === t.good && g.system === t.system && g.port === t.port;
      const ports = [this.host.landedPlanetId, this.data.config.startPlanetId];
      const port = ports.find((pid) => pid && same(pickTarget(this.host.world, this.data, pid)));
      if (port) p.buyPort = port;
      else p.fallback = true;
    }
    return p;
  }

  /**
   * Keep the guide honest about the hold: guide progress is saved every step but the pilot only on
   * landing, so a reload (or a sale) can leave steps 3–9 without the good. Back at the buy port the
   * guide rewinds to Buy; anywhere else it switches to fallback (check prices at {port}).
   */
  private reconcile(world: WorldState, landedPlanetId: string | null): boolean {
    const p = this.p;
    if (!p || p.done || p.fallback || p.step < 3 || p.step > 9) return false;
    if ((world.cargo[p.target.good] ?? 0) >= BUY_TONS) return false;
    if (p.buyPort && landedPlanetId === p.buyPort) {
      p.step = 2;
      p.startPos = undefined;
      p.startSystem = undefined;
    } else {
      p.fallback = true;
    }
    return true;
  }

  /** True when this pilot has an unfinished guide saved. */
  resumable(): boolean {
    const p = this.saved();
    return !!p && !p.done;
  }

  /**
   * Resume the pilot's unfinished guide, or begin a fresh one: step 1 when the port you are on
   * has a guided trade, else step 5 (Leave) with the trade from the nearest port that has one.
   * False when there is no pilot or the galaxy offers no trade at all.
   */
  start(): boolean {
    if (!this.host.pilot) return false;
    const saved = this.saved();
    if (saved && !saved.done) {
      this.p = saved;
      this.reconcile(this.host.world, this.host.landedPlanetId);
      this.persist();
      this.emit();
      return true;
    }
    const w = this.host.world;
    const landed = this.host.landedPlanetId;
    const here = landed ? pickTarget(w, this.data, landed) : null;
    const target = here ?? pickTargetNear(w, this.data);
    if (!target) return false;
    this.p = { step: here ? 1 : LEAVE_STEP, done: false, target, startCredits: w.credits };
    if (here && landed) this.p.buyPort = landed;
    else this.p.fallback = true;
    this.persist();
    this.emit();
    return true;
  }

  /** Throw away any saved progress and begin again (Settings → Replay first flight). */
  restart(): boolean {
    const id = this.host.pilot?.id;
    if (id) clearProgress(id, this.deps.storage);
    this.p = null;
    return this.start();
  }

  /** Mark the guide finished (also how the final "Nice trade" card is dismissed). */
  skip(): void {
    if (!this.p || this.p.done) return;
    this.p.done = true;
    this.persist();
    this.emit();
  }

  /**
   * Feed the latest snapshot; advances through every step it already satisfies. Call it on every
   * screen change (and whenever the world changes), or steps will lag.
   */
  update(state: GuideState): void {
    this.last = state;
    const p = this.p;
    if (!p || p.done) return;
    const before = p.step;
    let changed = this.sold(state);
    if (!changed) changed = this.retarget(state);
    this.lastLanded = state.landedPlanetId;
    if (!changed) changed = this.reconcile(state.world, state.landedPlanetId);
    while (p.step < STEP_COUNT) {
      if (p.step === 6) {
        // A start position left over from an earlier flight (landed, or jumped) is stale.
        if (p.startPos && (state.screen !== 'flight' || p.startSystem !== state.world.systemId)) {
          p.startPos = undefined;
          p.startSystem = undefined;
          changed = true;
        }
        if (!p.startPos && state.screen === 'flight') {
          p.startPos = { x: state.world.ship.pos.x, y: state.world.ship.pos.y };
          p.startSystem = state.world.systemId;
          changed = true;
        }
      }
      if (!STEPS[p.step - 1].done({ ...state, startPos: p.startPos }, p.target, p, this.data)) break;
      if (p.step === 2 && p.buyPort) p.paid = priceOf(state.world, this.data, p.buyPort, p.target.good) ?? undefined;
      p.step++;
      changed = true;
    }
    if (p.step === STEP_COUNT && before < STEP_COUNT && !p.fallback) p.profit = state.world.credits - p.startCredits;
    if (changed) {
      this.persist();
      this.emit();
    }
  }

  /** Selling the guide good for a profit anywhere, once under way, completes the sell step. */
  private sold(state: GuideState): boolean {
    const p = this.p;
    if (!p || p.fallback || p.step < LEAVE_STEP || p.step >= STEP_COUNT) return false;
    const land = state.landedPlanetId;
    if (!land || land === p.target.port || (state.world.cargo[p.target.good] ?? 0) > 0) return false;
    const profit = state.world.credits - p.startCredits;
    if (profit <= 0) return false;
    p.step = STEP_COUNT;
    p.profit = profit;
    return true;
  }

  /** On each new landing, aim at the nearest known port that now pays more than the pilot paid. */
  private retarget(state: GuideState): boolean {
    const p = this.p;
    const land = state.landedPlanetId;
    if (!p || p.fallback || p.paid === undefined || p.step < 3 || p.step > 9) return false;
    if (!land || land === this.lastLanded || land === p.target.port || land === p.buyPort) return false;
    const best = bestSellPort(state.world, this.data, p.target.good, p.paid);
    if (!best || (best.port === p.target.port && best.system === p.target.system)) return false;
    p.target = { good: p.target.good, system: best.system, port: best.port };
    return true;
  }

  /** The hint to show, or null when not started or finished/skipped. */
  current(): GuideHint | null {
    const p = this.p;
    if (!p || p.done) return null;
    const landed = this.last ? this.last.landedPlanetId : this.host.landedPlanetId;
    const world = this.last?.world ?? this.host.world;
    const sys = p.target.system;
    const text = STEPS[p.step - 1].text({
      target: p.target,
      mode: this.deps.mode(),
      key: (a) => this.deps.key(a),
      profit: p.profit,
      fallback: p.fallback,
      data: this.data,
      planetName: this.data.planets[landed ?? this.data.config.startPlanetId]?.name,
      screen: this.last?.screen ?? (landed ? 'planet' : 'flight'),
      landedPlanetId: landed,
      buyPort: p.buyPort,
      routeOk: world.route[world.route.length - 1] === sys || (world.jump ? world.jump.toSystemId === sys : world.systemId === sys),
    });
    return { text, step: p.step, total: STEP_COUNT };
  }

  /** The chosen trade, once started. */
  target(): GuideTarget | null {
    return this.p?.target ?? null;
  }

  on(_type: 'change', fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    this.listeners.forEach((fn) => fn());
  }

  private persist(): void {
    const id = this.host.pilot?.id;
    if (id && this.p) saveProgress(id, this.p, this.deps.storage);
  }
}
