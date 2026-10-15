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

  it('reports a shared key press in whichever group polls first', () => {
    const { src, key } = setup();
    key('keydown', 'KeyR');
    key('keyup', 'KeyR');
    expect(src.poll('planet').pressed.has('refuel')).toBe(true);
  });

  it('does not carry a flight-time tap into the planet poll', () => {
    const { src, key } = setup();
    key('keydown', 'KeyL');
    key('keyup', 'KeyL');
    expect(src.poll('flight').pressed.has('land')).toBe(true);
    expect(src.poll('planet').pressed.has('leave')).toBe(false);
  });

  it('drains unbound taps so they never show up later', () => {
    const { src, key } = setup();
    key('keydown', 'KeyL');
    key('keyup', 'KeyL');
    src.poll('menus');
    expect(src.poll('planet').pressed.has('leave')).toBe(false);
    expect(src.poll('flight').pressed.size).toBe(0);
  });

  it('polls several groups at once', () => {
    const { src, key } = setup();
    key('keydown', 'KeyM');
    key('keydown', 'Escape');
    const p = src.poll(['flight', 'menus']);
    expect(p.pressed.has('map')).toBe(true);
    expect(p.pressed.has('back')).toBe(true);
    expect(p.pressed.has('leave')).toBe(false);
  });

  it('ignores keys typed into text fields and does not block them', () => {
    const target = document.createElement('div');
    const input = document.createElement('input');
    target.appendChild(input);
    const src = new KeyboardSource(target, () => DEFAULT_BINDINGS);
    const e = new KeyboardEvent('keydown', { code: 'KeyL', cancelable: true, bubbles: true });
    input.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(false);
    expect(src.poll('flight').pressed.size).toBe(0);
  });

  it('does not block keys on focused buttons but still reports them', () => {
    const target = document.createElement('div');
    const button = document.createElement('button');
    target.appendChild(button);
    const src = new KeyboardSource(target, () => DEFAULT_BINDINGS);
    const e = new KeyboardEvent('keydown', { code: 'Space', cancelable: true, bubbles: true });
    button.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(false);
    expect(src.poll('flight').pressed.has('firePrimary')).toBe(true);
  });
});
