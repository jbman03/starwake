import { describe, expect, it } from 'vitest';
import { ACTION_GROUP, ACTION_IDS } from './actions';
import { DEFAULT_BINDINGS, findConflict, rebind, resetBindings, swapBinding } from './bindings';

describe('bindings', () => {
  it('every action has a default with at least one key', () => {
    for (const id of ACTION_IDS) {
      const [a, b] = DEFAULT_BINDINGS[id];
      expect(a !== null || b !== null).toBe(true);
    }
  });

  it('has no conflicts within any group in defaults', () => {
    for (const id of ACTION_IDS) {
      for (const code of DEFAULT_BINDINGS[id]) {
        if (code === null) continue;
        expect(findConflict(DEFAULT_BINDINGS, id, code)).toBeNull();
      }
    }
  });

  it('allows R in both flight and planet', () => {
    expect(DEFAULT_BINDINGS.nearestHostile).toContain('KeyR');
    expect(DEFAULT_BINDINGS.refuel).toContain('KeyR');
    expect(ACTION_GROUP.nearestHostile).not.toBe(ACTION_GROUP.refuel);
  });

  it('reports a conflict when binding J to land', () => {
    expect(findConflict(DEFAULT_BINDINGS, 'land', 'KeyJ')).toBe('jump');
  });

  it('swap moves J to land and land old key to jump', () => {
    const b = swapBinding(DEFAULT_BINDINGS, 'land', 0, 'KeyJ');
    expect(b.land[0]).toBe('KeyJ');
    expect(b.jump[0]).toBe('KeyL');
    expect(DEFAULT_BINDINGS.land[0]).toBe('KeyL');
  });

  it('throws when Escape is removed from pause or back', () => {
    expect(() => rebind(DEFAULT_BINDINGS, 'pause', 0, null)).toThrow();
    expect(() => rebind(DEFAULT_BINDINGS, 'back', 0, 'KeyQ')).toThrow();
    const b = rebind(DEFAULT_BINDINGS, 'pause', 1, 'KeyP');
    expect(b.pause).toEqual(['Escape', 'KeyP']);
    expect(() => swapBinding(DEFAULT_BINDINGS, 'pause', 0, 'KeyJ')).toThrow();
  });

  it('rebind null clears a slot and reset returns defaults', () => {
    const b = rebind(DEFAULT_BINDINGS, 'thrust', 0, null);
    expect(b.thrust[0]).toBeNull();
    expect(resetBindings()).toEqual(DEFAULT_BINDINGS);
  });
});
