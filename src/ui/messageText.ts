import type { ActionId } from '../input/actions';

/**
 * Fills the `{autopilot}` / `{map}` / `{nextTarget}` / `{interact}` / `{callTow}` tokens in sim messages with the player's current key
 * (or touch wording). `keyLabel` returns the label of an action's first bound key, or null.
 */
export function formatMessage(text: string, keyLabel: (a: ActionId) => string | null, touch: boolean): string {
  const auto = keyLabel('autopilot');
  const map = keyLabel('map');
  const pause = keyLabel('pause');
  return text
    .replace(/\{autopilot\}/g, touch ? 'Tap the bottom button' : auto ? `Use autopilot (${auto})` : 'Use autopilot')
    .replace(/\{nextTarget\}/g, touch ? 'the TGT button' : keyLabel('nextTarget') ?? 'the next-target key')
    .replace(/\{interact\}/g, touch ? 'the bottom button' : keyLabel('interact') ?? 'the interact key')
    .replace(/\{map\}/g, touch ? ' (tap Map)' : map ? ` (${map})` : '')
    .replace(/\{callTow\}/g, touch ? 'tap CALL TOW' : `${pause ? `press ${pause}` : 'open the pause menu'}, then Call for tow`);
}
