import type { GameData } from '../data/schemas';
import type { ActionId } from '../input/actions';
import type { Bindings } from '../input/bindings';
import type { WorldState } from '../sim/types';
import { clearProgress, loadProgress, saveProgress, STEP_COUNT, type Progress } from './progress';
import { STEPS, type GuideState } from './steps';
import { pickTarget, pickTargetNear, type GuideTarget } from './target';

/** The slice of Controller the guide reads. Controller satisfies it. */
export interface GuideHost {
  world: WorldState;
  landedPlanetId: string | null;
  pilot: { id: string } | null;
}

export interface GuideDeps {
  mode(): 'keyboard' | 'touch';
  /** The player's bindings (the UI layer's `key` is usually built from these). */
  bindings(): Bindings;
  /** Label of the player's key for an action (e.g. hotkeyFor); keeps this module UI-free. */
  key(action: ActionId): string;
  /** Defaults to localStorage; storage failures never break the guide. */
  storage?: Storage;
}

const LEAVE_STEP = 5;

/**
 * Runtime for the First Flight walkthrough. It never subscribes to anything: the UI layer calls
 * update() with a fresh snapshot whenever something changes. It never acts for the player.
 */
export class Guide {
  private p: Progress | null = null;
  private last: GuideState | null = null;
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
    return this.data.commodities[t.good] && this.data.systems[t.system] && this.data.planets[t.port] ? p : null;
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
      this.emit();
      return true;
    }
    const w = this.host.world;
    const landed = this.host.landedPlanetId;
    const here = landed ? pickTarget(w, this.data, landed) : null;
    const target = here ?? pickTargetNear(w, this.data);
    if (!target) return false;
    this.p = { step: here ? 1 : LEAVE_STEP, done: false, target, startCredits: w.credits };
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

  /** Feed the latest snapshot; advances through every step it already satisfies. */
  update(state: GuideState): void {
    this.last = state;
    const p = this.p;
    if (!p || p.done) return;
    const before = p.step;
    let changed = false;
    while (p.step < STEP_COUNT) {
      if (p.step === 6 && state.screen === 'flight' && !p.startPos) {
        p.startPos = { x: state.world.ship.pos.x, y: state.world.ship.pos.y };
        changed = true;
      }
      if (!STEPS[p.step - 1].done({ ...state, startPos: p.startPos }, p.target, p)) break;
      p.step++;
      changed = true;
    }
    if (p.step === STEP_COUNT && before < STEP_COUNT) p.profit = state.world.credits - p.startCredits;
    if (changed) {
      this.persist();
      this.emit();
    }
  }

  /** The hint to show, or null when not started or finished/skipped. */
  current(): { text: string; step: number; total: number } | null {
    const p = this.p;
    if (!p || p.done) return null;
    const planetId = this.last?.landedPlanetId ?? this.host.landedPlanetId;
    const text = STEPS[p.step - 1].text({
      target: p.target,
      mode: this.deps.mode(),
      key: (a) => this.deps.key(a),
      profit: p.profit,
      data: this.data,
      planetName: this.data.planets[planetId ?? this.data.config.startPlanetId]?.name,
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
