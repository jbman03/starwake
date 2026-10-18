import type { UiContext } from './context';
import { button, dialogOpen, hotkeyFor } from './dom';

/**
 * The fixed "Map" button in the top-right corner of a landed screen's panel (the panel is
 * positioned by `.sw-panel`'s `.sw-map-corner` rule). It opens the star map; closing the map runs
 * `reopen`, which rebuilds the screen the player was on.
 */
export function mapCornerButton(ctx: UiContext, reopen: () => void): HTMLButtonElement {
  const hotkey = hotkeyFor(ctx.controller.settings.bindings, 'openMap');
  return button('Map', () => ctx.go.map({ onClose: reopen }), { class: 'sw-map-corner', hotkey });
}

/**
 * Makes the corner button's key chip true on screens that don't poll the `planet` group (which
 * would also switch on Leave and the other planet keys): a keydown matching any `openMap`
 * binding opens the map. Ignored while a dialog is open or a text field has focus. Returns a
 * dispose function for the screen's cleanup. The planet screen has its own path; don't use it there.
 */
export function mapCornerKey(ctx: UiContext, reopen: () => void): () => void {
  const onKey = (e: KeyboardEvent) => {
    if (e.repeat || e.ctrlKey || e.metaKey || e.altKey || dialogOpen()) return;
    const t = e.target;
    if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement) return;
    if (!ctx.controller.settings.bindings.openMap.includes(e.code)) return;
    e.preventDefault();
    ctx.go.map({ onClose: reopen });
  };
  window.addEventListener('keydown', onKey);
  return () => window.removeEventListener('keydown', onKey);
}
