import type { UiContext } from './context';
import { button, el, hotkeyFor } from './dom';

/**
 * The card after the player's ship is destroyed. With an escape pod the pilot wakes at a port;
 * without, the last save loads (or the main menu shows when there is none). It cannot be put off.
 */
export function showDestroyedCard(ctx: UiContext, view: { pod: boolean }): void {
  const { controller } = ctx;
  let busy = false;
  const go = async () => {
    if (busy) return;
    busy = true;
    await controller.continueAfterDeath();
    if (controller.pilot === null) ctx.go.mainMenu();
    else if (controller.landedPlanetId === null) ctx.unmount();
  };
  const label = view.pod ? 'Wake up' : 'Load last save';
  const primary = button(label, () => void go(), { class: 'sw-btn-primary', hotkey: hotkeyFor(controller.settings.bindings, 'encounterChoice1') });
  primary.dataset.testid = 'destroyed-continue';
  const screen = el('div', { class: 'sw-screen sw-overlay', attrs: { 'data-testid': 'destroyed-card' } }, [
    el('div', { class: 'sw-panel sw-enc' }, [
      el('h1', { class: 'sw-title', text: 'Ship destroyed' }),
      el('div', { class: 'sw-enc-body' }, [
        el('p', { class: 'sw-enc-text', text: 'Your ship is destroyed.' }),
        el('p', { class: 'sw-enc-text', text: view.pod ? 'Your escape pod got you clear.' : 'Your ship is lost.' }),
      ]),
      el('div', { class: 'sw-ex-actions' }, [primary]),
    ]),
  ]);
  ctx.mount(screen, {
    groups: ['menus'],
    onPress: (pressed) => {
      if (pressed.has('encounterChoice1')) void go();
    },
  });
  primary.focus();
}
