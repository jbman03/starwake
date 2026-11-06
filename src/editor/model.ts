import type { RawGameData } from '../data/load';
import { checkPlugins, LIST_KEYS, PluginSchema, type ListKey, type Plugin } from '../plugins/format';

export type Rec = Record<string, unknown> & { id: string };

/** Labels for the record types, in the Editor's list. */
export const TYPE_LABEL: Record<ListKey, string> = {
  ships: 'Ships', outfits: 'Outfits', commodities: 'Goods', systems: 'Systems', planets: 'Ports', governments: 'Governments',
  events: 'Market events', missionTypes: 'Mission types', encounters: 'Encounters', story: 'Story missions',
};

export const DRAFT_KEY = 'starwake-editor-draft';

export const newDraft = (): Plugin => ({
  format: 'starwake-plugin', formatVersion: 1, id: 'my-plugin', name: 'My plug-in', version: '1.0.0', author: '', description: '', data: {},
});

/** The base game's records of a type (story missions live under story.missions). */
export function baseRecords(raw: RawGameData, type: ListKey): Rec[] {
  return (type === 'story' ? (raw.story as { missions: Rec[] }).missions : (raw[type] as Rec[])) ?? [];
}

export const recordsOf = (p: Plugin, type: ListKey): Rec[] => (p.data[type] as Rec[] | undefined) ?? [];

/** Put a record in (replacing one with the same id), or rename one: `oldId` is the id it had before the edit. */
export function upsert(p: Plugin, type: ListKey, rec: Rec, oldId = rec.id): Plugin {
  const list = recordsOf(p, type).filter((r) => r.id !== oldId && r.id !== rec.id);
  const at = recordsOf(p, type).findIndex((r) => r.id === oldId);
  const next = [...list];
  next.splice(at < 0 ? next.length : Math.min(at, next.length), 0, rec);
  return { ...p, data: { ...p.data, [type]: next } };
}

export function removeRecord(p: Plugin, type: ListKey, id: string): Plugin {
  const next = recordsOf(p, type).filter((r) => r.id !== id);
  const data = { ...p.data, [type]: next };
  if (next.length === 0) delete data[type];
  return { ...p, data };
}

/** A copy of a base record with a fresh id that is in neither the base nor the plug-in: "kestrel-2", "kestrel-3", ... */
export function copyOf(raw: RawGameData, p: Plugin, type: ListKey, id: string): Rec | null {
  const src = baseRecords(raw, type).find((r) => r.id === id) ?? recordsOf(p, type).find((r) => r.id === id);
  if (!src) return null;
  const taken = new Set([...baseRecords(raw, type), ...recordsOf(p, type)].map((r) => r.id));
  let n = 2;
  while (taken.has(`${id}-${n}`)) n++;
  return { ...(JSON.parse(JSON.stringify(src)) as Rec), id: `${id}-${n}` };
}

/** Everything wrong with the draft: its own format first, then the game's checks with it applied. Empty when it would load. */
export function problems(raw: RawGameData, p: Plugin): string[] {
  const r = PluginSchema.safeParse(p);
  if (!r.success) return r.error.issues.map((i) => `${i.path.join('.') || 'plug-in'}: ${i.message}`);
  return checkPlugins(raw, [r.data]) ?? [];
}

export const recordCount = (p: Plugin): number => LIST_KEYS.reduce((n, k) => n + recordsOf(p, k).length, 0);

/** The draft from browser storage, or a new one (storage can be missing or hold junk). */
export function loadDraft(storage: Pick<Storage, 'getItem'> | null): Plugin {
  try {
    const text = storage?.getItem(DRAFT_KEY);
    if (!text) return newDraft();
    const r = PluginSchema.safeParse(JSON.parse(text));
    return r.success ? r.data : newDraft();
  } catch {
    return newDraft();
  }
}

export function saveDraft(storage: Pick<Storage, 'setItem'> | null, p: Plugin): void {
  try {
    storage?.setItem(DRAFT_KEY, JSON.stringify(p));
  } catch {
    // Storage full or unavailable: the draft still lives in this page.
  }
}
