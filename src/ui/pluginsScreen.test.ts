import { describe, expect, it } from 'vitest';
import type { StoredPlugin } from '../plugins/store';
import { pluginStatus } from './pluginsScreen';

const sp = (id: string, enabled: boolean): StoredPlugin => ({
  plugin: { format: 'starwake-plugin', formatVersion: 1, id, name: id, version: '1', author: '', description: '', data: {} },
  enabled,
  installedAt: 0,
});

describe('pluginStatus', () => {
  it('says whether each plug-in is loaded, waiting for a restart, or refused and why', () => {
    expect(pluginStatus(sp('a', true), ['a'], {})).toBe('Active');
    expect(pluginStatus(sp('a', false), ['a'], {})).toBe('Off: restart to unload it');
    expect(pluginStatus(sp('a', false), [], {})).toBe('Off');
    expect(pluginStatus(sp('a', true), [], {})).toBe('On: restart to load it');
    expect(pluginStatus(sp('a', true), [], { a: ['ships.json: kestrel2.maxSpeed: too small'] })).toBe('Not loaded: ships.json: kestrel2.maxSpeed: too small');
    expect(pluginStatus(sp('a', true), [], { combined: ['x'] })).toBe('Not loaded: it clashes with another plug-in');
  });
});
