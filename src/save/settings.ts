import { ACTION_IDS, type ActionId } from '../input/actions';
import { ensureEscapeInvariant, findConflict, resetBindings, type Bindings, type Slot } from '../input/bindings';

export interface Settings {
  bindings: Bindings;
  touch: {
    mirror: boolean;
    buttonSize: 'S' | 'M' | 'L';
    opacity: number; // 0.3-1
    steering: 'point' | 'classic';
    vibration: boolean;
  };
  volume: number; // 0-1
  muted: boolean;
  quality: 'low' | 'high';
  autoLandOnArrival: boolean;
}

const KEY = 'starwake.settings';

export const DEFAULT_SETTINGS: Settings = {
  bindings: resetBindings(),
  touch: { mirror: false, buttonSize: 'M', opacity: 0.85, steering: 'point', vibration: true },
  volume: 0.8,
  muted: false,
  quality: 'high',
  autoLandOnArrival: true,
};

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const bool = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : d);
const num = (v: unknown, d: number, lo: number, hi: number) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d;
function oneOf<T extends string>(v: unknown, allowed: readonly T[], d: T): T {
  return allowed.includes(v as T) ? (v as T) : d;
}

const isSlot = (v: unknown): v is Slot => v === null || typeof v === 'string';

function mergeBindings(raw: unknown): Bindings {
  const out = resetBindings();
  if (!isObj(raw)) return out;
  const fresh: ActionId[] = [];
  for (const id of ACTION_IDS) {
    const v = raw[id];
    if (Array.isArray(v) && v.length === 2 && isSlot(v[0]) && isSlot(v[1])) out[id] = [v[0], v[1]];
    else fresh.push(id);
  }
  // Actions added since these settings were saved keep their default keys only where the pilot
  // hasn't already put that key on another action in the same group.
  for (const id of fresh) {
    out[id] = out[id].map((code) => (code !== null && findConflict(out, id, code) ? null : code)) as [Slot, Slot];
  }
  return ensureEscapeInvariant(out);
}

function merge(raw: unknown): Settings {
  const d = DEFAULT_SETTINGS;
  if (!isObj(raw)) return { ...d, bindings: resetBindings(), touch: { ...d.touch } };
  const t = isObj(raw.touch) ? raw.touch : {};
  return {
    bindings: mergeBindings(raw.bindings),
    touch: {
      mirror: bool(t.mirror, d.touch.mirror),
      buttonSize: oneOf(t.buttonSize, ['S', 'M', 'L'] as const, d.touch.buttonSize),
      opacity: num(t.opacity, d.touch.opacity, 0.3, 1),
      steering: oneOf(t.steering, ['point', 'classic'] as const, d.touch.steering),
      vibration: bool(t.vibration, d.touch.vibration),
    },
    volume: num(raw.volume, d.volume, 0, 1),
    muted: bool(raw.muted, d.muted),
    quality: oneOf(raw.quality, ['low', 'high'] as const, d.quality),
    autoLandOnArrival: bool(raw.autoLandOnArrival, d.autoLandOnArrival),
  };
}

export function loadSettings(): Settings {
  try {
    const text = localStorage.getItem(KEY);
    return merge(text === null ? null : JSON.parse(text));
  } catch {
    return merge(null);
  }
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // storage unavailable or full: settings stay in memory for this session
  }
}
