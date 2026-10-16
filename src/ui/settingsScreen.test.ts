// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { Controller } from '../app/controller';
import { loadGameData } from '../data/load';
import { InputMode } from '../input/mode';
import { DEFAULT_SETTINGS } from '../save/settings';
import type { PilotStore } from '../save/store';
import type { UiContext } from './context';
import { showSettings } from './settingsScreen';

describe('settings screen', () => {
  it('labels graphics quality as applying after a restart', async () => {
    const data = await loadGameData();
    const settings = { ...DEFAULT_SETTINGS, touch: { ...DEFAULT_SETTINGS.touch } };
    const c = new Controller(data, settings, new EventTarget());
    const root = document.createElement('div');
    const ctx = {
      root,
      controller: c,
      store: {} as PilotStore,
      inputMode: new InputMode(new EventTarget(), () => settings.bindings, 'touch'),
      planetImage: () => null,
      mount: (node: HTMLElement) => root.replaceChildren(node),
      unmount: () => root.replaceChildren(),
      go: { mainMenu() {}, planet() {}, pause() {}, map() {} },
    } as UiContext;
    showSettings(ctx, { mode: 'touch' });
    const general = [...root.querySelectorAll('button')].find((b) => b.textContent === 'General');
    general?.click();
    expect(root.textContent).toContain('Graphics quality (applies after restart)');
  });
});
