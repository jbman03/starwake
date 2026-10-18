// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { Controller } from '../app/controller';
import { loadGameData } from '../data/load';
import { InputMode } from '../input/mode';
import { DEFAULT_SETTINGS } from '../save/settings';
import type { PilotStore } from '../save/store';
import { newWorld } from '../sim/world';
import type { UiContext } from './context';
import { showExchange } from './exchange';
import { mapCornerButton } from './mapButton';
import { showMissionComputer } from './missionComputer';
import { showMissionLog } from './missionLog';
import { showOutfitter } from './outfitter';
import { showPlanetScreen } from './planetScreen';
import { showShipyard } from './shipyard';

async function setup(portId: string) {
  const data = await loadGameData();
  const c = new Controller(data, { ...DEFAULT_SETTINGS }, new EventTarget());
  c.beginSession({ ...newWorld(data), credits: 50000 }, { id: 'p', name: 'P' }, portId);
  const root = document.createElement('div');
  document.body.replaceChildren(root);
  const maps: { onClose?: () => void }[] = [];
  const ctx = {
    root,
    controller: c,
    store: {} as PilotStore,
    inputMode: new InputMode(new EventTarget(), () => DEFAULT_SETTINGS.bindings, 'keyboard'),
    planetImage: () => null,
    mount: (node: HTMLElement) => root.replaceChildren(node),
    unmount: () => root.replaceChildren(),
    go: { mainMenu() {}, planet: (id: string) => showPlanetScreen(ctx, id), pause() {}, map: (o?: { onClose?: () => void }) => maps.push(o ?? {}) },
  } as UiContext;
  return { ctx, root, maps, data };
}

describe('mapCornerButton', () => {
  it('is labelled Map with the openMap hotkey and opens the map with the reopen callback', async () => {
    const { ctx, maps } = await setup('halcyon');
    let reopened = 0;
    const b = mapCornerButton(ctx, () => reopened++);
    expect(b.classList.contains('sw-map-corner')).toBe(true);
    expect(b.textContent).toBe('MapN');
    b.click();
    expect(maps).toHaveLength(1);
    maps[0].onClose!();
    expect(reopened).toBe(1);
  });
});

describe('every landed screen has the corner Map button, and closing the map returns to the screen', () => {
  const screens: [string, string, (ctx: UiContext, done: () => void) => void][] = [
    ['planet', 'halcyon', (ctx) => showPlanetScreen(ctx, 'halcyon')],
    ['exchange', 'halcyon', (ctx, d) => showExchange(ctx, 'halcyon', d)],
    ['mission computer', 'halcyon', (ctx, d) => showMissionComputer(ctx, 'halcyon', d)],
    ['mission log', 'halcyon', (ctx, d) => showMissionLog(ctx, d)],
    ['outfitter', 'halcyon', (ctx, d) => showOutfitter(ctx, 'halcyon', d)],
  ];
  for (const [name, port, open] of screens) {
    it(name, async () => {
      const { ctx, root, maps } = await setup(port);
      open(ctx, () => {});
      const before = root.firstElementChild!;
      const b = root.querySelector<HTMLButtonElement>('.sw-panel > .sw-map-corner');
      expect(b).not.toBeNull();
      b!.click();
      expect(maps).toHaveLength(1);
      root.replaceChildren(); // the map replaces the screen
      maps[0].onClose!();
      const after = root.firstElementChild!;
      expect(after).not.toBe(before);
      expect(after.getAttribute('data-testid')).toBe(before.getAttribute('data-testid'));
      expect(after.querySelector('.sw-map-corner')).not.toBeNull();
    });
  }

  it('shipyard', async () => {
    const { ctx, root, maps } = await setup('vanterre');
    showShipyard(ctx, 'vanterre', () => {});
    root.querySelector<HTMLButtonElement>('.sw-panel > .sw-map-corner')!.click();
    root.replaceChildren();
    maps[0].onClose!();
    expect(root.querySelector('[data-testid="shipyard"]')).not.toBeNull();
    expect(root.querySelector('.sw-map-corner')).not.toBeNull();
  });
});
