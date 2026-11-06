import { describe, expect, it } from 'vitest';
import { testRaw } from '../data/testData';
import { copyOf, loadDraft, newDraft, problems, recordCount, recordsOf, removeRecord, saveDraft, upsert } from './model';

const raw = testRaw();

describe('editor model', () => {
  it('copies a base record under a fresh id, adds it, and the draft loads', () => {
    let p = newDraft();
    const ship = copyOf(raw, p, 'ships', 'kestrel')!;
    expect(ship.id).toBe('kestrel-2');
    p = upsert(p, 'ships', { ...ship, name: 'Kestrel Two' });
    expect(recordsOf(p, 'ships').map((r) => r.id)).toEqual(['kestrel-2']);
    expect(copyOf(raw, p, 'ships', 'kestrel')!.id).toBe('kestrel-3');
    expect(problems(raw, p)).toEqual([]);
    expect(recordCount(p)).toBe(1);
  });

  it('renaming a record keeps its place; deleting empties the type', () => {
    let p = newDraft();
    p = upsert(p, 'ships', copyOf(raw, p, 'ships', 'kestrel')!);
    p = upsert(p, 'ships', copyOf(raw, p, 'ships', 'warden')!);
    p = upsert(p, 'ships', { ...recordsOf(p, 'ships')[0], id: 'renamed' }, 'kestrel-2');
    expect(recordsOf(p, 'ships').map((r) => r.id)).toEqual(['renamed', 'warden-2']);
    p = removeRecord(removeRecord(p, 'ships', 'renamed'), 'ships', 'warden-2');
    expect(p.data.ships).toBeUndefined();
  });

  it('reports a broken record with its path, and a bad plug-in id', () => {
    let p = upsert(newDraft(), 'ships', { ...copyOf(raw, newDraft(), 'ships', 'kestrel')!, maxSpeed: -1 });
    expect(problems(raw, p).join('\n')).toContain('ships.json');
    p = { ...newDraft(), id: 'Bad Id' };
    expect(problems(raw, p)[0]).toContain('id');
  });

  it('the draft survives a reload, and junk storage gives a new draft', () => {
    const mem = new Map<string, string>();
    const storage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) };
    const p = { ...newDraft(), name: 'Saved' };
    saveDraft(storage, p);
    expect(loadDraft(storage).name).toBe('Saved');
    mem.set('starwake-editor-draft', '{broken');
    expect(loadDraft(storage).name).toBe('My plug-in');
    expect(loadDraft(null).id).toBe('my-plugin');
  });
});
