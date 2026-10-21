import { createStore, del, get, keys, set } from 'idb-keyval';
import { PilotSaveSchema, SaveError, upgradeSave, type PilotSave } from './pilot';

type Entry = { current: PilotSave; backup?: PilotSave };
type Store = ReturnType<typeof createStore>;

const PREFIX = 'pilot:';
const keyOf = (id: string) => `${PREFIX}${id}`;

function tryUpgrade(raw: unknown): PilotSave | null {
  try {
    return upgradeSave(raw);
  } catch {
    return null;
  }
}

/** Starwake's own IndexedDB database, so pilots never share idb-keyval's default store. */
export const PILOT_DB = 'starwake';
export const PILOT_OBJECT_STORE = 'pilots';

let defaultStore: Store | undefined;
/** Created lazily so importing this module never touches IndexedDB. */
function pilotDb(): Store {
  return (defaultStore ??= createStore(PILOT_DB, PILOT_OBJECT_STORE));
}

export class PilotStore {
  private readonly store: Store;
  constructor(store?: Store) {
    this.store = store ?? pilotDb();
  }

  private rawGet(id: string): Promise<{ current?: unknown; backup?: unknown } | undefined> {
    return get(keyOf(id), this.store);
  }

  /** One row per readable pilot; `save` is the full upgraded save, for the main menu's pilot card. */
  async list(): Promise<{ id: string; name: string; savedAt: string; save: PilotSave }[]> {
    const out: { id: string; name: string; savedAt: string; save: PilotSave }[] = [];
    for (const k of await keys(this.store)) {
      if (typeof k !== 'string' || !k.startsWith(PREFIX)) continue;
      const entry = await get(k, this.store);
      const p = tryUpgrade(entry?.current) ?? tryUpgrade(entry?.backup);
      if (p) out.push({ id: p.id, name: p.name, savedAt: p.savedAt, save: p });
    }
    return out;
  }

  /** Validates `p` first: an invalid pilot rejects with SaveError and the store is untouched. */
  async save(p: PilotSave): Promise<void> {
    const parsed = PilotSaveSchema.safeParse(p);
    if (!parsed.success) throw new SaveError('invalid', `refusing to save an invalid pilot: ${parsed.error.message}`);
    p = parsed.data;
    const prev = await this.rawGet(p.id);
    const prevGood = tryUpgrade(prev?.current);
    const entry: Entry = prevGood ? { current: p, backup: prevGood } : { current: p };
    if (!prevGood) {
      const oldBackup = tryUpgrade(prev?.backup);
      if (oldBackup) entry.backup = oldBackup;
    }
    await set(keyOf(p.id), entry, this.store);
  }

  async load(id: string): Promise<{ pilot: PilotSave; usedBackup: boolean }> {
    const entry = await this.rawGet(id);
    if (!entry) throw new SaveError('invalid', `no pilot ${id}`);
    const current = tryUpgrade(entry.current);
    if (current) return { pilot: current, usedBackup: false };
    const backup = tryUpgrade(entry.backup);
    if (backup) return { pilot: backup, usedBackup: true };
    throw new SaveError('invalid', `pilot ${id} is unreadable`);
  }

  async rename(id: string, name: string): Promise<void> {
    const { pilot } = await this.load(id);
    await this.save({ ...pilot, name });
  }

  async remove(id: string): Promise<void> {
    await del(keyOf(id), this.store);
  }
}
