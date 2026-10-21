import { describe, expect, it } from 'vitest';
import { MSG_NO_DESTINATION, MSG_TOO_CLOSE } from '../sim/world';
import { DEFAULT_BINDINGS } from '../input/bindings';
import { hotkeyFor } from './dom';
import { formatMessage } from './messageText';
import type { ActionId } from '../input/actions';

const defaults = (a: ActionId) => hotkeyFor(DEFAULT_BINDINGS, a) ?? null;
const none = () => null;

describe('formatMessage', () => {
  it('uses default bindings', () => {
    expect(formatMessage(MSG_TOO_CLOSE, defaults, false)).toBe('Too close to the star to jump. Use autopilot (G) to fly out.');
    expect(formatMessage(MSG_NO_DESTINATION, defaults, false)).toBe('Choose a destination on the star map (N).');
  });
  it('follows a rebound key', () => {
    const k = (a: ActionId) => (a === 'autopilot' ? 'P' : a === 'map' ? 'N' : null);
    expect(formatMessage(MSG_TOO_CLOSE, k, false)).toContain('Use autopilot (P) to fly out.');
    expect(formatMessage(MSG_NO_DESTINATION, k, false)).toBe('Choose a destination on the star map (N).');
  });
  it('handles unbound keys', () => {
    expect(formatMessage(MSG_TOO_CLOSE, none, false)).toBe('Too close to the star to jump. Use autopilot to fly out.');
    expect(formatMessage(MSG_NO_DESTINATION, none, false)).toBe('Choose a destination on the star map.');
  });
  it('uses touch wording', () => {
    expect(formatMessage(MSG_TOO_CLOSE, defaults, true)).toBe('Too close to the star to jump. Tap the bottom button to fly out.');
    expect(formatMessage(MSG_NO_DESTINATION, defaults, true)).toBe('Choose a destination on the star map (tap Map).');
  });
  it('leaves token-free text unchanged', () => {
    expect(formatMessage('Not enough fuel to jump.', defaults, false)).toBe('Not enough fuel to jump.');
  });
});
