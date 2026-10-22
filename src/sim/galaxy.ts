import type { GameConfig, GameData, SystemDef } from '../data/schemas';

/** The story flag that opens the hidden lane from Skerry to Hushwater. */
export const HIDDEN_LANE_FLAG = 'hushwater-lane';

/** A system the player can know of: not hidden, or hidden with its own unlock flag set. */
export function systemOpen(sys: Pick<SystemDef, 'hidden' | 'unlockFlag'>, flags: readonly string[]): boolean {
  return !sys.hidden || (sys.unlockFlag !== undefined && flags.includes(sys.unlockFlag));
}

/**
 * Lanes leaving `id`: its links, its hidden lanes and the reverse of any hidden lane that ends at
 * it. A lane to or from a hidden system exists only once that system's own unlock flag is set.
 */
export function lanesOf(data: GameData, id: string, flags: readonly string[]): string[] {
  const sys = data.systems[id];
  if (!sys || !systemOpen(sys, flags)) return [];
  const out = new Set([...sys.links, ...(sys.hiddenLinks ?? []), ...(hiddenSources(data).get(id) ?? [])]);
  return [...out].filter((n) => data.systems[n] && systemOpen(data.systems[n], flags));
}

const sourceCache = new WeakMap<GameData['systems'], Map<string, string[]>>();

/** For each system, the systems whose hiddenLinks point at it (the reverse of a hidden lane). Cached per galaxy. */
function hiddenSources(data: GameData): Map<string, string[]> {
  let m = sourceCache.get(data.systems);
  if (!m) {
    m = new Map();
    for (const s of Object.values(data.systems))
      for (const t of s.hiddenLinks ?? []) m.set(t, [...(m.get(t) ?? []), s.id]);
    sourceCache.set(data.systems, m);
  }
  return m;
}

/** Systems the player can know of: the non-hidden ones, plus each hidden one whose lane is open. */
export function visibleSystems(data: GameData, flags: readonly string[]) {
  return Object.values(data.systems).filter((s) => systemOpen(s, flags));
}

/** How many systems the pilot card counts (hidden ones only after their lane opens). */
export function visibleSystemCount(data: GameData, flags: readonly string[]): number {
  return visibleSystems(data, flags).length;
}

/**
 * Fewest-hops route over lanes. Returns the hops after `fromId`, ending at `toId`; [] when
 * already there; null when no route exists. Intermediate systems must satisfy `allowed`.
 */
export function routeBetween(
  data: GameData,
  fromId: string,
  toId: string,
  allowed: (id: string) => boolean,
  flags: readonly string[],
): string[] | null {
  if (fromId === toId) return [];
  const prev = new Map<string, string>();
  const visited = new Set([fromId]);
  let frontier = [fromId];
  while (frontier.length > 0) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const n of lanesOf(data, id, flags)) {
        if (visited.has(n)) continue;
        if (n !== toId && !allowed(n)) continue;
        visited.add(n);
        prev.set(n, id);
        if (n === toId) {
          const path = [toId];
          for (let cur = id; cur !== fromId; cur = prev.get(cur) as string) path.unshift(cur);
          return path;
        }
        next.push(n);
      }
    }
    frontier = next;
  }
  return null;
}

/** Arriving at a system makes it known and shows its neighbours as seen (never both). */
export function revealOnArrival(
  known: readonly string[],
  seen: readonly string[],
  data: GameData,
  systemId: string,
  flags: readonly string[],
): { known: string[]; seen: string[] } {
  const k = new Set(known);
  k.add(systemId);
  const s = new Set(seen);
  for (const n of lanesOf(data, systemId, flags)) s.add(n);
  for (const id of k) s.delete(id);
  return { known: [...k], seen: [...s] };
}

/** Systems within `jumps` hops of `fromSystemId` over all lanes, including the system itself. */
export function systemsWithin(data: GameData, fromSystemId: string, jumps: number, flags: readonly string[]): string[] {
  if (!data.systems[fromSystemId]) return [];
  const visited = new Set([fromSystemId]);
  let frontier = [fromSystemId];
  for (let d = 0; d < jumps && frontier.length > 0; d++) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const n of lanesOf(data, id, flags)) {
        if (visited.has(n)) continue;
        visited.add(n);
        next.push(n);
      }
    }
    frontier = next;
  }
  return [...visited];
}

/** Charts every system within `jumps` hops as known; their neighbours become seen (never both). */
export function revealWithin(
  known: readonly string[],
  seen: readonly string[],
  data: GameData,
  fromSystemId: string,
  jumps: number,
  flags: readonly string[],
): { known: string[]; seen: string[] } {
  const k = new Set(known);
  const s = new Set(seen);
  for (const id of systemsWithin(data, fromSystemId, jumps, flags)) {
    k.add(id);
    for (const n of lanesOf(data, id, flags)) s.add(n);
  }
  for (const id of k) s.delete(id);
  return { known: [...k], seen: [...s] };
}

/** Fuel needed for `hops` jumps, what the ship has, and how many hops it covers. */
export function fuelCheck(
  fuel: number,
  hops: number,
  cfg: GameConfig,
): { needed: number; have: number; reachable: number } {
  const per = cfg.fuelPerJump;
  return { needed: hops * per, have: fuel, reachable: per > 0 ? Math.floor(fuel / per) : Infinity };
}

/** Hops between two systems over the lanes the pilot can use (hidden ones only with the flag); Infinity if unreachable. */
export function hopDistance(data: GameData, a: string, b: string, flags: readonly string[]): number {
  if (a === b) return 0;
  const visited = new Set([a]);
  let frontier = [a];
  for (let dist = 1; frontier.length > 0; dist++) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const n of lanesOf(data, id, flags)) {
        if (visited.has(n)) continue;
        if (n === b) return dist;
        visited.add(n);
        next.push(n);
      }
    }
    frontier = next;
  }
  return Infinity;
}
