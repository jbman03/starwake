import 'fake-indexeddb/auto';
import { createStore, set } from 'idb-keyval';
import { describe, expect, it } from 'vitest';
import type { Plugin } from './format';
import { PluginStore } from './store';

let n = 0;
const mk = () => new PluginStore(createStore(`plugins-${n++}`, 'kv'));
const p = (id: string, name = id): Plugin => ({ format: 'starwake-plugin', formatVersion: 1, id, name, version: '1', author: '', description: '', data: {} });

describe('PluginStore', () => {
  it('lists in install order; an update keeps its place', async () => {
    const s = mk();
    await s.put(p('b'), true, 2);
    await s.put(p('a'), true, 1);
    expect((await s.list()).map((x) => x.plugin.id)).toEqual(['a', 'b']);
    await s.put(p('a', 'A v2'), true, 9);
    const l = await s.list();
    expect(l.map((x) => x.plugin.id)).toEqual(['a', 'b']);
    expect(l[0].plugin.name).toBe('A v2');
  });

  it('turns plug-ins off and on, and removes them', async () => {
    const s = mk();
    await s.put(p('a'));
    await s.setEnabled('a', false);
    expect((await s.list())[0].enabled).toBe(false);
    await s.setEnabled('a', true);
    expect((await s.list())[0].enabled).toBe(true);
    await s.remove('a');
    expect(await s.list()).toEqual([]);
  });

  it('skips an unreadable entry', async () => {
    const db = createStore(`plugins-${n++}`, 'kv');
    await set('junk', { plugin: { nope: 1 } }, db);
    const s = new PluginStore(db);
    await s.put(p('ok'));
    expect((await s.list()).map((x) => x.plugin.id)).toEqual(['ok']);
  });
});
