import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../save/settings';
import { InputMode } from './mode';

const pointer = (pointerType: string) => Object.assign(new Event('pointerdown'), { pointerType });
const key = (code: string) => Object.assign(new Event('keydown'), { code });

describe('InputMode', () => {
  it('switches to touch on a touch pointerdown and to keyboard on a bound key, emitting each change once', () => {
    const target = new EventTarget();
    const m = new InputMode(target, () => DEFAULT_SETTINGS.bindings, 'keyboard');
    const seen: string[] = [];
    m.onChange((mode) => seen.push(mode));
    expect(m.mode).toBe('keyboard');

    target.dispatchEvent(pointer('mouse'));
    expect(m.mode).toBe('keyboard');
    target.dispatchEvent(pointer('touch'));
    expect(m.mode).toBe('touch');
    target.dispatchEvent(pointer('touch'));

    target.dispatchEvent(key('F13')); // not bound
    expect(m.mode).toBe('touch');
    target.dispatchEvent(key('ArrowUp'));
    expect(m.mode).toBe('keyboard');
    expect(seen).toEqual(['touch', 'keyboard']);
  });

  it('unsubscribe and dispose stop listening', () => {
    const target = new EventTarget();
    const m = new InputMode(target, () => DEFAULT_SETTINGS.bindings, 'keyboard');
    let n = 0;
    const off = m.onChange(() => n++);
    off();
    target.dispatchEvent(pointer('touch'));
    expect(n).toBe(0);
    m.dispose();
    target.dispatchEvent(key('ArrowUp'));
    expect(m.mode).toBe('touch');
  });
});
