import { describe, expect, it } from 'vitest';
import { testRaw } from '../data/testData';
import { parseGameData } from '../data/load';
import { applyPlugins, checkPlugins, pluginSummary, readPlugin, type Plugin } from './format';

const raw = testRaw();
const kestrel = (raw.ships as { id: string }[]).find((s) => s.id === 'kestrel')!;

const plugin = (data: Plugin['data'], over: Partial<Plugin> = {}): Plugin => ({
  format: 'starwake-plugin', formatVersion: 1, id: 'test-pack', name: 'Test pack', version: '1.0.0', author: 'T', description: '', data, ...over,
});

describe('readPlugin', () => {
  it('reads a valid file', () => {
    const r = readPlugin(JSON.stringify(plugin({ ships: [{ ...kestrel, id: 'kestrel-mk2' }] })));
    expect(r.ok).toBe(true);
  });
  it('refuses non-JSON, a wrong format, a newer format version, a bad id, unknown lists and records without ids', () => {
    expect(readPlugin('not json')).toEqual({ ok: false, issues: ['This is not a JSON file.'] });
    for (const bad of [
      { ...plugin({}), format: 'other' },
      { ...plugin({}), formatVersion: 2 },
      { ...plugin({}), id: 'Bad Id' },
      { ...plugin({}), data: { config: [] } },
      { ...plugin({}), data: { ships: [{ name: 'no id' }] } },
    ]) expect(readPlugin(JSON.stringify(bad)).ok, JSON.stringify(bad).slice(0, 80)).toBe(false);
    const newer = readPlugin(JSON.stringify({ ...plugin({}), formatVersion: 2 }));
    expect(newer.ok === false && newer.issues.join(' ')).toContain('newer Starwake');
  });
});

describe('applyPlugins', () => {
  it('adds new records and replaces ones with the same id, in order, without touching the base', () => {
    const before = JSON.stringify(raw);
    const a = plugin({ ships: [{ ...kestrel, id: 'kestrel-mk2', name: 'Kestrel Mk II' }, { ...kestrel, name: 'Kestrel (A)' }] });
    const b = plugin({ ships: [{ ...kestrel, name: 'Kestrel (B)' }] }, { id: 'b' });
    const out = applyPlugins(raw, [a, b]);
    const ships = out.ships as { id: string; name: string }[];
    expect(ships.find((s) => s.id === 'kestrel-mk2')?.name).toBe('Kestrel Mk II');
    expect(ships.find((s) => s.id === 'kestrel')?.name).toBe('Kestrel (B)');
    expect(ships.filter((s) => s.id === 'kestrel')).toHaveLength(1);
    expect(JSON.stringify(raw)).toBe(before);
  });

  it('story missions go into story.missions', () => {
    const m = (raw.story as { missions: { id: string }[] }).missions[0];
    const out = applyPlugins(raw, [plugin({ story: [{ ...m, title: 'Changed' }] })]);
    expect((out.story as { missions: { id: string; title: string }[] }).missions.find((x) => x.id === m.id)?.title).toBe('Changed');
  });
});

describe('checkPlugins', () => {
  it('a good plug-in loads, and its ship is in the game', () => {
    const p = plugin({ ships: [{ ...kestrel, id: 'kestrel-mk2', name: 'Kestrel Mk II', price: 90000 }] });
    expect(checkPlugins(raw, [p])).toBeNull();
    expect(parseGameData(applyPlugins(raw, [p])).ships['kestrel-mk2'].name).toBe('Kestrel Mk II');
  });
  it('a broken record is refused with the file and path', () => {
    const issues = checkPlugins(raw, [plugin({ ships: [{ ...kestrel, id: 'broken', maxSpeed: -5 }] })]);
    expect(issues).not.toBeNull();
    expect(issues!.join('\n')).toContain('ships.json');
  });
  it('a dangling reference is refused (a planet in a system that does not exist)', () => {
    const port = (raw.planets as { id: string }[])[0];
    const issues = checkPlugins(raw, [plugin({ planets: [{ ...port, id: 'nowhere-port', systemId: 'no-such-system' }] })]);
    expect(issues).not.toBeNull();
  });
});

describe('pluginSummary', () => {
  it('counts what a plug-in adds and replaces', () => {
    expect(pluginSummary(raw, plugin({ ships: [{ ...kestrel, id: 'x1' }, { ...kestrel, id: 'x2' }, kestrel] }))).toBe('adds 2 ships, replaces 1 ship');
    expect(pluginSummary(raw, plugin({}))).toBe('changes nothing');
  });
});
