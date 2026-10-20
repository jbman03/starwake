import type { Vec2 } from '../sim/vec';
import type { GuideTarget } from './target';

/** One pilot's place in the First Flight guide. Stored outside the save. */
export interface Progress {
  /** Current step, 1-based. */
  step: number;
  /** Finished or skipped. */
  done: boolean;
  target: GuideTarget;
  /** Credits when the guide started, for the profit shown at the end. */
  startCredits: number;
  /** Where the ship was when step 6 first saw it flying. */
  startPos?: Vec2;
  /** System the ship was in when startPos was recorded. */
  startSystem?: string;
  /** Started without a buy-low port (steps 1-4 skipped): the trade is only a destination. */
  fallback?: boolean;
  /** Profit frozen when the last step is reached. */
  profit?: number;
  /**
   * Port the good is bought at (step 1's port). Missing in fallback, and in progress saved before
   * it existed (the guide then works it out from the target, or falls back).
   */
  buyPort?: string;
  /** Price per ton when the good was bought; a better selling port must beat it. */
  paid?: number;
}

export const STEP_COUNT = 11;
const keyFor = (pilotId: string): string => `starwake.guide.${pilotId}`;

function defaultStorage(): Storage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

const isStr = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function parse(raw: string): Progress | null {
  const v = JSON.parse(raw) as Record<string, unknown> | null;
  if (!v || typeof v !== 'object') return null;
  const t = v.target as Record<string, unknown> | undefined;
  if (!Number.isInteger(v.step) || (v.step as number) < 1 || (v.step as number) > STEP_COUNT) return null;
  if (typeof v.done !== 'boolean' || !t || !isStr(t.good) || !isStr(t.system) || !isStr(t.port)) return null;
  if (!isNum(v.startCredits)) return null;
  const p: Progress = {
    step: v.step as number,
    done: v.done,
    target: { good: t.good, system: t.system, port: t.port },
    startCredits: v.startCredits,
  };
  const pos = v.startPos as Record<string, unknown> | undefined;
  if (pos && isNum(pos.x) && isNum(pos.y)) p.startPos = { x: pos.x, y: pos.y };
  if (isStr(v.startSystem)) p.startSystem = v.startSystem;
  if (v.fallback === true) p.fallback = true;
  if (isNum(v.profit)) p.profit = v.profit;
  if (isStr(v.buyPort)) p.buyPort = v.buyPort;
  if (isNum(v.paid)) p.paid = v.paid;
  return p;
}

/** Saved progress for a pilot, or null when none, unreadable or malformed. Never throws. */
export function loadProgress(pilotId: string, storage: Storage | undefined = defaultStorage()): Progress | null {
  try {
    const raw = storage?.getItem(keyFor(pilotId));
    return raw ? parse(raw) : null;
  } catch {
    return null;
  }
}

/** Persist progress. Returns false (never throws) when storage is unavailable or full. */
export function saveProgress(pilotId: string, p: Progress, storage: Storage | undefined = defaultStorage()): boolean {
  try {
    if (!storage) return false;
    storage.setItem(keyFor(pilotId), JSON.stringify(p));
    return true;
  } catch {
    return false;
  }
}

export function clearProgress(pilotId: string, storage: Storage | undefined = defaultStorage()): void {
  try {
    storage?.removeItem(keyFor(pilotId));
  } catch {
    /* nothing to clear */
  }
}
