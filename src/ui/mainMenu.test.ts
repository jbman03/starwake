// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { Controller } from '../app/controller';
import { loadGameData } from '../data/load';
import { DEFAULT_SETTINGS } from '../save/settings';
import { pilotFromWorld } from '../save/pilot';
import { newWorld } from '../sim/world';
import type { UiContext } from './context';
import { showMainMenu } from './mainMenu';

afterEach(() => document.body.replaceChildren());

describe('main menu (review C1)', () => {
  it('loads a pilot saved at a story-opened port, whatever galaxy the previous session left behind', async () => {
    const data = await loadGameData();
    const c = new Controller(data, DEFAULT_SETTINGS, new EventTarget());
    // A previous pilot destroyed Merrow and quit; the next is saved at Freehold Light, which only their flag opens.
    c.world = { ...c.world, galaxy: { governments: {}, destroyed: ['merrow'] } };
    const save = pilotFromWorld({ ...newWorld(data, 1), flags: ['navy-freehold'], systemId: 'hollis' }, 'freehold-light', { id: 'b', name: 'Bea' });
    const root = document.createElement('div');
    document.body.append(root);
    const planets: string[] = [];
    const store = {
      list: async () => [{ id: 'b', name: 'Bea', savedAt: save.savedAt, save }],
      load: async () => ({ pilot: save, usedBackup: false }),
      loadLegacy: async () => ({ arcsDone: [] }),
    };
    const ctx = {
      root,
      controller: c,
      store,
      planetImage: () => null,
      mount: (node: HTMLElement) => root.replaceChildren(node),
      unmount: () => root.replaceChildren(),
      go: { mainMenu() {}, planet: (id: string) => planets.push(id), pause() {}, map() {} },
    } as unknown as UiContext;
    showMainMenu(ctx);
    for (let i = 0; i < 20 && !root.querySelector('button[data-action="load"], .sw-pilots button'); i++) await new Promise((r) => setTimeout(r, 5));
    const load = [...root.querySelectorAll('button')].find((b) => /^Load/.test(b.textContent ?? ''))!;
    expect(load).toBeTruthy();
    load.click();
    for (let i = 0; i < 20 && planets.length === 0; i++) await new Promise((r) => setTimeout(r, 5));
    expect(planets).toEqual(['freehold-light']);
    expect(c.landedPlanetId).toBe('freehold-light');
  });
});
