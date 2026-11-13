import type { GameData } from '../data/schemas';
import { addNote, setFlag } from './story';
import type { WorldState } from './types';

/** Story arcs (data/arcs.json): taking one's first mission sets `arc:<id>`, which closes every other arc. */
export const arcFlag = (arcId: string) => `arc:${arcId}`;
export const arcRankFlag = (arcId: string, k: number) => `${arcId}-rank-${k}`;
export const arcDoneFlag = (arcId: string) => `arcdone:${arcId}`;

/** The arc this pilot has taken, or null. */
export function chosenArc(world: Pick<WorldState, 'flags'>, data: GameData): string | null {
  return Object.keys(data.arcs).find((id) => world.flags.includes(arcFlag(id))) ?? null;
}

/** True when another arc has been taken, so this one is closed. */
export function arcLocked(world: Pick<WorldState, 'flags'>, data: GameData, arcId: string): boolean {
  const chosen = chosenArc(world, data);
  return chosen !== null && chosen !== arcId;
}

/** Index into the arc's ranks reached by its points (0 = the first rank). */
export function arcRank(world: Pick<WorldState, 'arcPoints'>, data: GameData, arcId: string): number {
  const ranks = data.arcs[arcId]?.ranks ?? [];
  const pts = world.arcPoints[arcId] ?? 0;
  let k = 0;
  ranks.forEach((r, i) => {
    if (pts >= r.points) k = i;
  });
  return k;
}

/** Add arc points; each rank reached sets its flag and a note. `promoted` is the highest new rank title, or null. */
export function addArcPoints(world: WorldState, data: GameData, arcId: string, n: number): { world: WorldState; promoted: string | null } {
  const arc = data.arcs[arcId];
  if (!arc) return { world, promoted: null };
  const before = arcRank(world, data, arcId);
  let w: WorldState = { ...world, arcPoints: { ...world.arcPoints, [arcId]: (world.arcPoints[arcId] ?? 0) + n } };
  const after = arcRank(w, data, arcId);
  let promoted: string | null = null;
  for (let k = before + 1; k <= after; k++) {
    w = setFlag(w, arcRankFlag(arcId, k));
    promoted = arc.ranks[k].title;
    w = addNote(w, `Promoted to ${promoted} (${arc.title})`);
  }
  return { world: w, promoted };
}

/**
 * Switch sides: leave the taken arc for `to`, carrying half its points (the cost); the old arc's points stay as they
 * were. Ranks the carried points reach in `to` set their flags and notes. With no arc taken it just takes `to`; a
 * switch to the arc already taken changes nothing.
 */
export function switchArc(world: WorldState, data: GameData, to: string): { world: WorldState; promoted: string | null } {
  const target = data.arcs[to];
  const from = chosenArc(world, data);
  if (!target || from === to) return { world, promoted: null };
  let w: WorldState = { ...world, flags: world.flags.filter((f) => f !== (from ? arcFlag(from) : '')) };
  w = setFlag(w, arcFlag(to));
  w = addNote(w, `You have gone over to ${target.title}.`);
  const carried = from ? Math.floor((world.arcPoints[from] ?? 0) / 2) : 0;
  return carried > 0 ? addArcPoints(w, data, to, carried) : { world: w, promoted: null };
}

/** The pilot card's line for the taken arc: "<arc title>: <rank>", "(struck off)" once exposed. Null with no arc. */
export function arcRankLine(world: Pick<WorldState, 'flags' | 'arcPoints'>, data: GameData): string | null {
  const id = chosenArc(world, data);
  if (!id) return null;
  const arc = data.arcs[id];
  const title = arc.ranks[arcRank(world, data, id)].title;
  return `${arc.title}: ${title}${world.flags.includes(`${id}-exposed`) ? ' (struck off)' : ''}`;
}

/**
 * Part 1 saves (cycle 7 part 2): a Navy pilot who exposed the Navy but hadn't finished its old defector ending carries
 * on into Free Reach Rising, as the new N5 choice now does. Applied on load; a second run changes nothing.
 */
export function movePart1Defector(world: WorldState, data: GameData): WorldState {
  const f = world.flags;
  if (!data.arcs.rising || !f.includes(arcFlag('navy')) || !f.includes('navy-exposed') || f.includes('navy-done')) return world;
  return setFlag(switchArc(world, data, 'rising').world, 'rising-defector');
}
