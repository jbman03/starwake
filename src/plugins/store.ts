import { createStore, del, get, keys, set } from 'idb-keyval';
import { PluginSchema, type Plugin } from './format';

type Store = ReturnType<typeof createStore>;

/** An installed plug-in: the file as imported, whether it is on, and when it came (plug-ins apply in that order). */
export interface StoredPlugin {
  plugin: Plugin;
  enabled: boolean;
  installedAt: number;
}

/** A database of its own, apart from pilots (idb-keyval keeps one object store per database). */
export const PLUGIN_DB = 'starwake-plugins';
export const PLUGIN_OBJECT_STORE = 'plugins';

let defaultStore: Store | undefined;
const pluginDb = (): Store => (defaultStore ??= createStore(PLUGIN_DB, PLUGIN_OBJECT_STORE));

export class PluginStore {
  private readonly store: Store;
  constructor(store?: Store) {
    this.store = store ?? pluginDb();
  }

  /** Every readable plug-in, in install order; an unreadable entry is skipped. */
  async list(): Promise<StoredPlugin[]> {
    const out: StoredPlugin[] = [];
    for (const k of await keys(this.store)) {
      const v = (await get(k, this.store)) as Partial<StoredPlugin> | undefined;
      const p = PluginSchema.safeParse(v?.plugin);
      if (p.success) out.push({ plugin: p.data, enabled: v?.enabled !== false, installedAt: Number(v?.installedAt) || 0 });
    }
    return out.sort((a, b) => a.installedAt - b.installedAt || a.plugin.id.localeCompare(b.plugin.id));
  }

  /** Install a plug-in, or update one with the same id (it keeps its place in the order). */
  async put(plugin: Plugin, enabled = true, now = Date.now()): Promise<void> {
    const old = (await get(plugin.id, this.store)) as StoredPlugin | undefined;
    await set(plugin.id, { plugin, enabled, installedAt: old?.installedAt ?? now }, this.store);
  }

  async setEnabled(id: string, enabled: boolean): Promise<void> {
    const old = (await get(id, this.store)) as StoredPlugin | undefined;
    if (old) await set(id, { ...old, enabled }, this.store);
  }

  async remove(id: string): Promise<void> {
    await del(id, this.store);
  }
}
