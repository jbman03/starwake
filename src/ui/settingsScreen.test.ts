// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { Controller } from '../app/controller';
import { loadGameData } from '../data/load';
import { InputMode } from '../input/mode';
import { DEFAULT_SETTINGS } from '../save/settings';
import type { PilotStore } from '../save/store';
import type { UiContext } from './context';
import { showSettings } from './settingsScreen';

async function open() {
  const data = await loadGameData();
  const settings = { ...DEFAULT_SETTINGS, touch: { ...DEFAULT_SETTINGS.touch } };
  const c = new Controller(data, settings, new EventTarget());
  const root = document.createElement('div');
  const cleanups: (() => void)[] = [];
  const ctx = {
    root,
    controller: c,
    store: {} as PilotStore,
    inputMode: new InputMode(new EventTarget(), () => settings.bindings, 'touch'),
    planetImage: () => null,
    mount: (node: HTMLElement, o?: { cleanup?: () => void }) => {
      root.replaceChildren(node);
      if (o?.cleanup) cleanups.push(o.cleanup);
    },
    unmount: () => root.replaceChildren(),
    go: { mainMenu() {}, planet() {}, pause() {}, map() {} },
  } as unknown as UiContext;
  showSettings(ctx, { mode: 'touch' });
  const general = [...root.querySelectorAll('button')].find((b) => b.textContent === 'General');
  general?.click();
  return { c, root, cleanups };
}

describe('settings screen', () => {
  it('labels graphics quality as applying after a restart', async () => {
    const { root } = await open();
    expect(root.textContent).toContain('Graphics quality (applies after restart)');
  });

  it('the mute checkbox follows the V key while the screen is open, and stops listening once closed', async () => {
    const { c, root, cleanups } = await open();
    const label = [...root.querySelectorAll('label')].find((l) => l.textContent === 'Mute sound (V)')!;
    const mute = label.querySelector('input') as HTMLInputElement;
    expect(mute.checked).toBe(false);
    c.toggleSound();
    expect(mute.checked).toBe(true);
    c.toggleSound();
    expect(mute.checked).toBe(false);
    for (const f of cleanups) f();
    c.toggleSound();
    expect(mute.checked).toBe(false);
  });
});
