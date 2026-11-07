import { z } from 'zod';
import { DataError, parseGameData, type RawGameData } from '../data/load';

/** The record lists a plug-in may add to or replace (spec §2). Tunables are never touched. */
export const LIST_KEYS = ['ships', 'outfits', 'commodities', 'systems', 'planets', 'governments', 'events', 'missionTypes', 'encounters', 'story'] as const;
export type ListKey = (typeof LIST_KEYS)[number];

export const PLUGIN_FORMAT = 'starwake-plugin';
export const PLUGIN_FORMAT_VERSION = 1;

const record = z.record(z.string(), z.unknown()).refine((r) => typeof r.id === 'string' && r.id.length > 0, { message: 'every record needs an "id"' });

/** A plug-in file. Records are checked against the game's own schemas when the plug-in is applied (`checkPlugin`). */
export const PluginSchema = z
  .object({
    format: z.literal(PLUGIN_FORMAT),
    formatVersion: z.number().int().min(1),
    id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,47}$/, 'lowercase letters, digits and dashes, up to 48'),
    name: z.string().min(1).max(60),
    version: z.string().min(1).max(20),
    author: z.string().max(60).default(''),
    description: z.string().max(500).default(''),
    data: z.object(Object.fromEntries(LIST_KEYS.map((k) => [k, z.array(record).optional()])) as Record<ListKey, z.ZodOptional<z.ZodArray<typeof record>>>).strict(),
  })
  .strict()
  .refine((p) => p.formatVersion <= PLUGIN_FORMAT_VERSION, { message: 'made for a newer Starwake', path: ['formatVersion'] });
export type Plugin = z.infer<typeof PluginSchema>;

/** Read a plug-in file's text: the plug-in, or the reasons it can't be one. */
export function readPlugin(text: string): { ok: true; plugin: Plugin } | { ok: false; issues: string[] } {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, issues: ['This is not a JSON file.'] };
  }
  const r = PluginSchema.safeParse(json);
  if (!r.success) return { ok: false, issues: r.error.issues.map((i) => `${i.path.join('.') || 'file'}: ${i.message}`) };
  return { ok: true, plugin: r.data };
}

type RawList = { id: string }[];
const listOf = (raw: RawGameData, k: ListKey): RawList => (k === 'story' ? (raw.story as { missions: RawList }).missions : (raw[k] as RawList));

/** The raw data with each plug-in's records added or put in place of the record with the same id, in order. */
export function applyPlugins(raw: RawGameData, plugins: readonly Plugin[]): RawGameData {
  const out: RawGameData = { ...raw, story: { ...(raw.story as object), missions: [...listOf(raw, 'story')] } };
  for (const k of LIST_KEYS) if (k !== 'story') (out as Record<string, unknown>)[k] = [...listOf(raw, k)];
  for (const p of plugins) {
    for (const k of LIST_KEYS) {
      const recs = p.data[k];
      if (!recs?.length) continue;
      const list = listOf(out, k);
      for (const rec of recs) {
        const i = list.findIndex((r) => r.id === rec.id);
        if (i >= 0) list[i] = rec as { id: string };
        else list.push(rec as { id: string });
      }
    }
  }
  return out;
}

/** Apply plug-ins and validate the whole game: null when it loads, else the issues (each "file: path: problem"). */
export function checkPlugins(raw: RawGameData, plugins: readonly Plugin[]): string[] | null {
  try {
    parseGameData(applyPlugins(raw, plugins));
    return null;
  } catch (e) {
    if (e instanceof DataError) return e.issues.length ? e.issues : [e.message];
    return [e instanceof Error ? e.message : String(e)];
  }
}

const NOUNS: Record<ListKey, string> = {
  ships: 'ships', outfits: 'outfits', commodities: 'commodities', systems: 'systems', planets: 'ports', governments: 'governments',
  events: 'market events', missionTypes: 'mission types', encounters: 'encounters', story: 'story missions',
};

/** "adds 2 ships, replaces 1 system" from the base data, for the Plug-ins screen. */
export function pluginSummary(raw: RawGameData, p: Plugin): string {
  const parts: string[] = [];
  for (const k of LIST_KEYS) {
    const recs = p.data[k];
    if (!recs?.length) continue;
    const base = new Set(listOf(raw, k).map((r) => r.id));
    const replaced = recs.filter((r) => base.has(r.id as string)).length;
    const added = recs.length - replaced;
    const plural = NOUNS[k];
    const noun = (n: number) => (n === 1 ? plural.replace(/(ies|s)$/, (m) => (m === 'ies' ? 'y' : '')) : plural);
    if (added) parts.push(`adds ${added} ${noun(added)}`);
    if (replaced) parts.push(`replaces ${replaced} ${noun(replaced)}`);
  }
  return parts.length ? parts.join(', ') : 'changes nothing';
}
