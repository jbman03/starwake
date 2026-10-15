// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { DEFAULT_BINDINGS } from './bindings';
import { KeyboardSource } from './keyboard';

function setup() {
  const target = new EventTarget();
  const src = new KeyboardSource(target, () => DEFAULT_BINDINGS);
  const key = (type: string, code: string, extra: KeyboardEventInit = {}) => {
    const e = new KeyboardEvent(type, { code, cancelable: true, ...extra });
    target.dispatchEvent(e);
    return e;
  };
  return { src, key };
}

describe('KeyboardSource', () => {
  it('reports held and pressed once', () => {
    const { src, key } = setup();
    key('keydown', 'ArrowUp');
    const first = src.poll('flight');
    expect(first.actions.has('thrust')).toBe(true);
    expect(first.pressed.has('thrust')).toBe(true);
    const second = src.poll('flight');
    expect(second.actions.has('thrust')).toBe(true);
    expect(second.pressed.has('thrust')).toBe(false);
  });

  it('counts a tap between polls as pressed', () => {
    const { src, key } = setup();
    key('keydown', 'KeyM');
    key('keyup', 'KeyM');
    const p = src.poll('flight');
    expect(p.pressed.has('map')).toBe(true);
    expect(p.actions.has('map')).toBe(false);
  });

  it('only reports actions in the polled group', () => {
    const { src, key } = setup();
    key('keydown', 'KeyR');
    expect(src.poll('planet').actions.has('refuel')).toBe(true);
    expect(src.poll('flight').actions.has('refuel')).toBe(false);
  });

  it('ignores auto-repeat for pressed', () => {
    const { src, key } = setup();
    key('keydown', 'Space');
    src.poll('flight');
    key('keydown', 'Space', { repeat: true });
    expect(src.poll('flight').pressed.has('firePrimary')).toBe(false);
  });

  it('prevents default on bound keys only', () => {
    const { key } = setup();
    expect(key('keydown', 'Tab').defaultPrevented).toBe(true);
    expect(key('keydown', 'KeyQ').defaultPrevented).toBe(false);
  });

  it('releases held keys on blur and stops on dispose', () => {
    const { src, key } = setup();
    key('keydown', 'ArrowUp');
    window.dispatchEvent(new Event('blur'));
    expect(src.poll('flight').actions.has('thrust')).toBe(false);
    src.dispose();
    key('keydown', 'ArrowUp');
    expect(src.poll('flight').actions.size).toBe(0);
  });
});
