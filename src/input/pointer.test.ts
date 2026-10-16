import { describe, expect, it } from 'vitest';
import { pointerTypeOf } from './pointer';

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
