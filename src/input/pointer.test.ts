import { describe, expect, it } from 'vitest';
import { pointerTypeOf, resolveShipPress } from './pointer';

describe('pointerTypeOf', () => {
  it("prefers the event's own pointerType", () => {
    expect(pointerTypeOf({ pointerType: 'mouse' }, true)).toBe('mouse');
    expect(pointerTypeOf({ pointerType: 'touch' }, false)).toBe('touch');
    expect(pointerTypeOf({ pointerType: 'pen' }, false)).toBe('pen');
  });
  it('falls back to touch vs mouse from the Phaser pointer', () => {
    expect(pointerTypeOf({}, true)).toBe('touch');
    expect(pointerTypeOf({}, false)).toBe('mouse');
    expect(pointerTypeOf(undefined, false)).toBe('mouse');
    expect(pointerTypeOf({ pointerType: '' }, true)).toBe('touch');
  });
});

describe('resolveShipPress', () => {
  it('a touch or pen tap on a ship over a planet lands on the planet', () => {
    expect(resolveShipPress('npc-1', ['halcyon'], 'touch')).toEqual({ kind: 'planet', id: 'halcyon' });
    expect(resolveShipPress('npc-1', ['halcyon'], 'pen')).toEqual({ kind: 'planet', id: 'halcyon' });
  });
  it('a mouse click on a ship over a planet still targets the ship', () => {
    expect(resolveShipPress('npc-1', ['halcyon'], 'mouse')).toEqual({ kind: 'ship', id: 'npc-1' });
  });
  it('a tap on a ship clear of every planet targets the ship', () => {
    expect(resolveShipPress('npc-1', [], 'touch')).toEqual({ kind: 'ship', id: 'npc-1' });
    expect(resolveShipPress('npc-1', [], 'mouse')).toEqual({ kind: 'ship', id: 'npc-1' });
  });
});
