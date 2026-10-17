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

async function setup(credits: number, fuel: number, bindings = DEFAULT_SETTINGS.bindings) {
  const data = await loadGameData();
  const settings = { ...DEFAULT_SETTINGS, bindings };
  const c = new Controller(data, settings, new EventTarget());
  const w = newWorld(data);
  c.beginSession({ ...w, credits, ship: { ...w.ship, fuel } }, { id: 'p', name: 'P' }, 'halcyon');
  const root = document.createElement('div');
  document.body.append(root);
  const calls: { map: { onClose?: () => void }[]; planet: string[]; onPress?: (p: Set<string>) => void } = { map: [], planet: [] };
  const ctx = {
    root,
    controller: c,
    store: {} as PilotStore,
    inputMode: new InputMode(new EventTarget(), () => settings.bindings, 'keyboard'),
    planetImage: () => null,
    mount: (node: HTMLElement, opts: { onPress?: (p: Set<string>) => void } = {}) => {
      root.replaceChildren(node);
      calls.onPress = opts.onPress;
    },
    unmount: () => root.replaceChildren(),
    go: {
      mainMenu() {},
      planet: (id: string) => calls.planet.push(id),
      pause() {},
      map: (opts?: { onClose?: () => void }) => calls.map.push(opts ?? {}),
    },
  } as UiContext;
  showPlanetScreen(ctx, 'halcyon');
  return { root, c, calls };
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

  it('Star Map (button or N) opens the map, which returns to this planet screen', async () => {
    const { root, calls } = await setup(1000, 300);
    const map = [...root.querySelectorAll('button')].find((b) => b.textContent?.startsWith('Star Map'))!;
    expect(map.textContent).toBe('Star MapN');
    const labels = [...root.querySelectorAll('button')].map((b) => b.querySelector('.sw-btn-label')?.textContent);
    expect(labels.indexOf('Star Map')).toBe(labels.indexOf('Leave') - 1);
    map.click();
    expect(calls.map).toHaveLength(1);
    calls.map[0].onClose!();
    expect(calls.planet).toEqual(['halcyon']);
    calls.onPress!(new Set(['openMap']));
    expect(calls.map).toHaveLength(2);
  });

  it('an unbound Star Map action shows no key chip', async () => {
    const { root } = await setup(1000, 300, { ...DEFAULT_SETTINGS.bindings, openMap: [null, null] });
    const map = [...root.querySelectorAll('button')].find((b) => b.textContent?.startsWith('Star Map'))!;
    expect(map.textContent).toBe('Star Map');
    expect(map.querySelector('.sw-key')).toBeNull();
  });
});
