import 'fake-indexeddb/auto';
import { createStore } from 'idb-keyval';
import { describe, expect, it } from 'vitest';
import { testRaw } from '../data/testData';
import { bootData, pluginBoot } from './boot';
import type { Plugin } from './format';
import { PluginStore } from './store';

let n = 0;
const raw = testRaw();
const kestrel = (raw.ships as { id: string }[]).find((s) => s.id === 'kestrel')!;
const p = (id: string, ships: unknown[]): Plugin => ({ format: 'starwake-plugin', formatVersion: 1, id, name: id, version: '1', author: '', description: '', data: { ships: ships as never } });

describe('bootData', () => {
  it('applies enabled plug-ins only', async () => {
    const s = new PluginStore(createStore(`boot-${n++}`, 'kv'));
    await s.put(p('on', [{ ...kestrel, id: 'mk2', name: 'Mk2' }]), true, 1);
    await s.put(p('off', [{ ...kestrel, id: 'mk3', name: 'Mk3' }]), false, 2);
    const { data, boot } = await bootData(s);
    expect(data.ships.mk2?.name).toBe('Mk2');
    expect(data.ships.mk3).toBeUndefined();
    expect(boot.active).toEqual(['on']);
    expect(pluginBoot()?.active).toEqual(['on']);
  });

  it('a broken plug-in boots the plain game and says why', async () => {
    const s = new PluginStore(createStore(`boot-${n++}`, 'kv'));
    await s.put(p('good', [{ ...kestrel, id: 'mk2' }]), true, 1);
    await s.put(p('bad', [{ ...kestrel, id: 'mk4', maxSpeed: -1 }]), true, 2);
    const { data, boot } = await bootData(s);
    expect(data.ships.mk2).toBeUndefined();
    expect(boot.active).toEqual([]);
    expect(Object.keys(boot.problems)).toEqual(['bad']);
  });

  it('every enabled plug-in that fails is named; none is loaded', async () => {
    const s = new PluginStore(createStore(`boot-${n++}`, 'kv'));
    // A hull cheaper than the starter breaks a data rule, so each of these fails on its own.
    await s.put(p('a', [{ ...kestrel, id: 'cheap-a', price: 5 }]), true, 1);
    await s.put(p('b', [{ ...kestrel, id: 'cheap-b', price: 5 }]), true, 2);
    const { boot } = await bootData(s);
    expect(boot.active).toEqual([]);
    expect(Object.keys(boot.problems).sort()).toEqual(['a', 'b']);
  });

  it('no store means the plain game', async () => {
    const { data, boot } = await bootData(null);
    expect(boot.installed).toEqual([]);
    expect(Object.keys(data.ships)).toContain('shuttle');
  });
});
