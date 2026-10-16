// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { Controller } from '../app/controller';
import { loadGameData } from '../data/load';
import { InputMode } from '../input/mode';
import type { PilotStore } from '../save/store';
import { DEFAULT_SETTINGS } from '../save/settings';
import { newWorld } from '../sim/world';
import type { UiContext } from './context';
import { showPlanetScreen } from './planetScreen';

async function setup(credits: number, fuel: number) {
  const data = await loadGameData();
  const settings = { ...DEFAULT_SETTINGS };
  const c = new Controller(data, settings, new EventTarget());
  const w = newWorld(data);
  c.beginSession({ ...w, credits, ship: { ...w.ship, fuel } }, { id: 'p', name: 'P' }, 'halcyon');
  const root = document.createElement('div');
  document.body.append(root);
  const ctx = {
    root,
    controller: c,
    store: {} as PilotStore,
    inputMode: new InputMode(new EventTarget(), () => settings.bindings, 'keyboard'),
    planetImage: () => null,
    mount: (node: HTMLElement) => root.replaceChildren(node),
    unmount: () => root.replaceChildren(),
    go: { mainMenu() {}, planet() {}, pause() {}, map() {} },
  } as UiContext;
  showPlanetScreen(ctx, 'halcyon');
  return { root, c };
}

describe('planet screen', () => {
  it('with credits below zero, Refuel is disabled and says why', async () => {
    const { root } = await setup(-400, 100);
    const refuel = [...root.querySelectorAll('button')].find((b) => b.textContent?.startsWith('Refuel'))!;
    expect(refuel.disabled).toBe(true);
    expect(root.querySelector('.sw-reason')?.textContent).toBe('Not enough credits to buy fuel.');
    expect(root.textContent).toContain('Credits: -400 cr');
  });

  it('shows singular fuel for one jump', async () => {
    const { root } = await setup(1000, 150);
    expect(root.textContent).toContain('Fuel: 1 jump');
    expect(root.textContent).not.toContain('1 jumps');
  });
});
