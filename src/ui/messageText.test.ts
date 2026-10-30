import { describe, expect, it } from 'vitest';
import { MSG_DISABLED, MSG_TOW_READY } from '../app/controller';
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

describe('formatMessage: site tokens', () => {
  const keys = (a: string) => ({ nextTarget: 'Tab', interact: 'Y' } as Record<string, string>)[a] ?? null;
  it('fills nextTarget and interact with the bound keys, or phone wording', () => {
    expect(formatMessage('Target it with {nextTarget}, then press {interact}.', keys, false)).toBe('Target it with Tab, then press Y.');
    expect(formatMessage('Target it with {nextTarget}, then press {interact}.', keys, true)).toBe(
      'Target it with the TGT button, then press the bottom button.',
    );
    expect(formatMessage('with {nextTarget}', () => null, false)).toBe('with the next-target key');
  });
});

describe('formatMessage: the tow token', () => {
  it('names the pause key on a keyboard and the CALL TOW button on a phone', () => {
    expect(formatMessage(MSG_DISABLED, defaults, false)).toBe('Your ship is disabled. When no enemy is near, you can call a tow: press Esc, then Call for tow.');
    expect(formatMessage(MSG_TOW_READY, defaults, false)).toBe('No enemy near. You can call a tow now: press Esc, then Call for tow.');
    expect(formatMessage(MSG_TOW_READY, defaults, true)).toBe('No enemy near. You can call a tow now: tap CALL TOW.');
    expect(formatMessage(MSG_TOW_READY, (a) => (a === 'pause' ? 'P' : null), false)).toContain('press P, then Call for tow.');
    expect(formatMessage(MSG_TOW_READY, none, false)).toContain('open the pause menu, then Call for tow.');
  });
});
