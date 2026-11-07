import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { testRaw } from '../data/testData';
import { applyPlugins, checkPlugins, readPlugin } from '../plugins/format';
import { parseGameData } from '../data/load';

describe('the sample plug-in (public/plugins/sample.starwake.json)', () => {
  it('reads, loads with the game, and adds Thornwick linked to Skerry', () => {
    const r = readPlugin(readFileSync(new URL('../../public/plugins/sample.starwake.json', import.meta.url), 'utf8'));
    if (!r.ok) throw new Error(r.issues.join('\n'));
    const raw = testRaw();
    expect(checkPlugins(raw, [r.plugin])).toBeNull();
    const d = parseGameData(applyPlugins(raw, [r.plugin]));
    expect(d.systems.thornwick.links).toEqual(['skerry']);
    expect(d.systems.skerry.links).toContain('thornwick');
    expect(d.planets['thornwick-landing'].systemId).toBe('thornwick');
    expect(d.ships.tern.name).toBe('Tern Skiff');
    expect(d.outfits['thorn-plating'].soldAt).toEqual(['thornwick-landing']);
  });
});
