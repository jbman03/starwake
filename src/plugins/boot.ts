import { loadRawGameData, parseGameData, type RawGameData } from '../data/load';
import type { GameData } from '../data/schemas';
import { applyPlugins, checkPlugins } from './format';
import type { PluginStore, StoredPlugin } from './store';

/** What the game booted with: kept for the Plug-ins screen. */
export interface PluginBoot {
  /** The data files before any plug-in. */
  raw: RawGameData;
  installed: StoredPlugin[];
  /** Ids of the plug-ins that are actually loaded. */
  active: string[];
  /** Why an enabled plug-in could not be loaded, by id; `combined` when each loads alone but not together. */
  problems: Record<string, string[]>;
}

let current: PluginBoot | null = null;
/** The plug-in state of this session (null before boot, or in tests that never booted). */
export const pluginBoot = (): PluginBoot | null => current;

/**
 * The game data with the enabled plug-ins applied (spec §3). If they don't load, the plain game boots and
 * `problems` says why; the base game always loads. A store that can't be read (private browsing) means no plug-ins.
 */
export async function bootData(store: PluginStore | null, override: Partial<RawGameData> = {}): Promise<{ data: GameData; boot: PluginBoot }> {
  const raw = { ...(await loadRawGameData()), ...override } as RawGameData;
  let installed: StoredPlugin[] = [];
  try {
    installed = store ? await store.list() : [];
  } catch {
    installed = [];
  }
  const enabled = installed.filter((p) => p.enabled).map((p) => p.plugin);
  const problems: Record<string, string[]> = {};
  let active: string[] = [];
  let data: GameData | null = null;
  if (enabled.length) {
    const all = checkPlugins(raw, enabled);
    if (all === null) {
      data = parseGameData(applyPlugins(raw, enabled));
      active = enabled.map((p) => p.id);
    } else {
      for (const p of enabled) {
        const alone = checkPlugins(raw, [p]);
        if (alone) problems[p.id] = alone;
      }
      if (Object.keys(problems).length === 0) problems.combined = all;
    }
  }
  const boot: PluginBoot = { raw, installed, active, problems };
  current = boot;
  return { data: data ?? parseGameData(raw), boot };
}
