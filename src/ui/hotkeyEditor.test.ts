// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { resetBindings } from '../input/bindings';
import { DEFAULT_SETTINGS } from '../save/settings';
import type { UiContext } from './context';
import { createHotkeyEditor } from './hotkeyEditor';

function setup() {
  const settings = { ...DEFAULT_SETTINGS, bindings: resetBindings() };
  const ctx = { root: document.body, controller: { settings } } as unknown as UiContext;
  const ed = createHotkeyEditor(ctx);
  document.body.append(ed.node);
  return { ed, settings };
}
const press = (code: string) => window.dispatchEvent(new KeyboardEvent('keydown', { code, bubbles: true, cancelable: true }));
const slot = (id: string) => document.querySelector<HTMLButtonElement>(`[data-testid="${id}"]`)!;

describe('hotkey editor Escape invariant errors', () => {
  it('shows an inline error when capture would remove Escape from pause', () => {
    const { ed, settings } = setup();
    slot('slot-pause-0').click();
    press('KeyQ');
    expect(ed.node.querySelector('.sw-error')!.textContent).toMatch(/pause.*Escape/);
    expect(settings.bindings.pause[0]).toBe('Escape');
    ed.dispose();
    document.body.replaceChildren();
  });

  it('shows an inline error when a swap would remove Escape from pause', () => {
    const { ed, settings } = setup();
    slot('slot-pause-0').click();
    press('KeyX'); // conflicts with Auto-stop
    [...document.querySelectorAll('button')].find((b) => b.textContent === 'Swap')!.click();
    expect(ed.node.querySelector('.sw-error')!.textContent).toMatch(/pause.*Escape/);
    expect(settings.bindings.pause[0]).toBe('Escape');
    ed.dispose();
    document.body.replaceChildren();
  });
});
