import { HullClassSchema, PlanetSchema, ShipSchema } from '../data/schemas';
import type { RawGameData } from '../data/load';
import type { ListKey, Plugin } from '../plugins/format';
import { el } from '../ui/dom';
import { baseRecords, recordsOf, type Rec } from './model';

/** Fields that name another record, and which list they pick from (base records plus the plug-in's own). */
const REF_FIELDS: Record<string, ListKey> = {
  systemId: 'systems',
  government: 'governments',
  shipId: 'ships',
  homePort: 'planets',
  origin: 'planets',
  commodity: 'commodities',
};

/** Fields with a fixed set of values, by record type. */
const ENUM_FIELDS: Partial<Record<ListKey, Record<string, readonly string[]>>> = {
  ships: { role: ShipSchema.shape.role.options, hull: HullClassSchema.options },
  planets: { kind: PlanetSchema.shape.kind.options },
};

/** The ids a reference field can take: the base game's and the plug-in's, sorted. */
export function refOptions(raw: RawGameData, p: Plugin, list: ListKey): string[] {
  return [...new Set([...baseRecords(raw, list), ...recordsOf(p, list)].map((r) => r.id))].sort();
}

/** How a field is edited in the form (anything nested stays in the JSON view). */
export type FieldKind = { kind: 'text' | 'longText' | 'number' | 'bool' | 'json' } | { kind: 'choice'; options: readonly string[] };

export function fieldKind(type: ListKey, key: string, value: unknown, raw: RawGameData, p: Plugin): FieldKind {
  const enums = ENUM_FIELDS[type]?.[key];
  if (enums && typeof value === 'string') return { kind: 'choice', options: enums };
  if (REF_FIELDS[key] && typeof value === 'string') return { kind: 'choice', options: refOptions(raw, p, REF_FIELDS[key]) };
  if (typeof value === 'number') return { kind: 'number' };
  if (typeof value === 'boolean') return { kind: 'bool' };
  if (typeof value === 'string') return { kind: key === 'description' || key === 'text' || value.length > 60 ? 'longText' : 'text' };
  return { kind: 'json' };
}

/**
 * A form for one record (editor spec §6): every simple field as an input, references and fixed choices as dropdowns,
 * and nested parts (lists, positions, loadouts) left to the JSON view. `onChange` gets the edited record.
 */
export function recordForm(type: ListKey, rec: Rec, raw: RawGameData, p: Plugin, onChange: (next: Rec) => void): HTMLElement {
  const rows = Object.entries(rec).map(([key, value]) => {
    const k = fieldKind(type, key, value, raw, p);
    const set = (v: unknown) => onChange({ ...rec, [key]: v } as Rec);
    let input: HTMLElement;
    if (k.kind === 'choice') {
      const s = el('select', { class: 'sw-ed-select', attrs: { 'aria-label': key, 'data-field': key } }, k.options.map((o) => el('option', { text: o, attrs: { value: o } })));
      if (!k.options.includes(value as string)) s.append(el('option', { text: `${String(value)} (unknown)`, attrs: { value: String(value) } }));
      s.value = String(value);
      s.addEventListener('change', () => set(s.value));
      input = s;
    } else if (k.kind === 'number') {
      const i = el('input', { class: 'sw-ed-input', attrs: { type: 'number', step: 'any', 'aria-label': key, 'data-field': key } });
      i.value = String(value);
      i.addEventListener('input', () => {
        if (i.value !== '' && Number.isFinite(Number(i.value))) set(Number(i.value));
      });
      input = i;
    } else if (k.kind === 'bool') {
      const i = el('input', { attrs: { type: 'checkbox', 'aria-label': key, 'data-field': key } });
      i.checked = value === true;
      i.addEventListener('change', () => set(i.checked));
      input = i;
    } else if (k.kind === 'text' || k.kind === 'longText') {
      const i = el(k.kind === 'longText' ? 'textarea' : 'input', { class: 'sw-ed-input', attrs: { 'aria-label': key, 'data-field': key } }) as HTMLInputElement;
      i.value = String(value);
      i.addEventListener('input', () => set(i.value));
      input = i;
    } else {
      input = el('span', { class: 'sw-reason', text: `${Array.isArray(value) ? `${value.length} item${value.length === 1 ? '' : 's'}` : 'details'}: edit in JSON` });
    }
    return el('label', { class: 'sw-ed-field' }, [el('span', { text: key }), input]);
  });
  return el('div', { class: 'sw-ed-form', attrs: { 'data-testid': 'editor-form' } }, rows);
}
