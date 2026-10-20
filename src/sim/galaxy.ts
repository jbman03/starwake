import type { GameConfig, GameData } from '../data/schemas';

/**
 * Fewest-hops route over lanes. Returns the hops after `fromId`, ending at `toId`; [] when
 * already there; null when no route exists. Intermediate systems must satisfy `allowed`.
 */
export function routeBetween(
  data: GameData,
  fromId: string,
  toId: string,
  allowed: (id: string) => boolean,
): string[] | null {
  if (fromId === toId) return [];
  const prev = new Map<string, string>();
  const visited = new Set([fromId]);
  let frontier = [fromId];
  while (frontier.length > 0) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const n of data.systems[id]?.links ?? []) {
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
): { known: string[]; seen: string[] } {
  const k = new Set(known);
  k.add(systemId);
  const s = new Set(seen);
  for (const n of data.systems[systemId]?.links ?? []) s.add(n);
  for (const id of k) s.delete(id);
  return { known: [...k], seen: [...s] };
}

/** Systems within `jumps` hops of `fromSystemId` over all lanes, including the system itself. */
export function systemsWithin(data: GameData, fromSystemId: string, jumps: number): string[] {
  if (!data.systems[fromSystemId]) return [];
  const visited = new Set([fromSystemId]);
  let frontier = [fromSystemId];
  for (let d = 0; d < jumps && frontier.length > 0; d++) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const n of data.systems[id]?.links ?? []) {
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
): { known: string[]; seen: string[] } {
  const k = new Set(known);
  const s = new Set(seen);
  for (const id of systemsWithin(data, fromSystemId, jumps)) {
    k.add(id);
    for (const n of data.systems[id]?.links ?? []) s.add(n);
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

/** Hops between two systems over all lanes; Infinity if unreachable. */
export function hopDistance(data: GameData, a: string, b: string): number {
  if (a === b) return 0;
  const visited = new Set([a]);
  let frontier = [a];
  for (let dist = 1; frontier.length > 0; dist++) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const n of data.systems[id]?.links ?? []) {
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
