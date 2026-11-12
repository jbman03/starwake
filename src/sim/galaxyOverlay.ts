import type { GameData } from '../data/schemas';
import type { WorldState } from './types';

/**
 * The galaxy as the story has changed it (cycle 7): systems that changed flag, ports destroyed, and ports that
 * appear only once their `appearsFlag` is set. Every reader takes its `GameData` from here (the controller's
 * `data`), so a story map change reaches the map, traffic, law, bars and HUD without per-site edits.
 * Returns `base` itself when nothing applies; otherwise one memoised copy per base and set of changes.
 */
export function applyGalaxy(base: GameData, world: Pick<WorldState, 'galaxy' | 'flags'>): GameData {
  const { governments, destroyed } = world.galaxy;
  const appearing = Object.values(base.planets).filter((p) => p.appearsFlag !== undefined);
  const hidden = new Set([...destroyed, ...appearing.filter((p) => !world.flags.includes(p.appearsFlag!)).map((p) => p.id)]);
  const govs = Object.entries(governments).filter(([sid, g]) => base.systems[sid] && base.systems[sid].government !== g);
  const dropped = [...hidden].filter((id) => id in base.planets).sort();
  if (govs.length === 0 && dropped.length === 0) return base;
  const key = JSON.stringify([govs.sort(), dropped]);
  let byKey = memo.get(base);
  if (!byKey) memo.set(base, (byKey = new Map()));
  const hit = byKey.get(key);
  if (hit) return hit;
  const systems = govs.length ? { ...base.systems } : base.systems;
  for (const [sid, g] of govs) systems[sid] = { ...base.systems[sid], government: g };
  const planets = dropped.length ? Object.fromEntries(Object.entries(base.planets).filter(([id]) => !hidden.has(id))) : base.planets;
  const view: GameData = { ...base, systems, planets };
  byKey.set(key, view);
  return view;
}

const memo = new WeakMap<GameData, Map<string, GameData>>();
