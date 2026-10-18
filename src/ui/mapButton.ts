import type { UiContext } from './context';
import { button, hotkeyFor } from './dom';

/**
 * The fixed "Map" button in the top-right corner of a landed screen's panel (the panel is
 * positioned by `.sw-panel`'s `.sw-map-corner` rule). It opens the star map; closing the map runs
 * `reopen`, which rebuilds the screen the player was on.
 */
export function mapCornerButton(ctx: UiContext, reopen: () => void): HTMLButtonElement {
  const hotkey = hotkeyFor(ctx.controller.settings.bindings, 'openMap');
  return button('Map', () => ctx.go.map({ onClose: reopen }), { class: 'sw-map-corner', hotkey });
}
