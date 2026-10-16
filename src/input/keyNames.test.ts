import { describe, expect, it } from 'vitest';
import { keyName } from './keyNames';

describe('keyName', () => {
  it('maps special keys', () => {
    expect(keyName('ArrowUp')).toBe('↑');
    expect(keyName('ArrowDown')).toBe('↓');
    expect(keyName('ArrowLeft')).toBe('←');
    expect(keyName('ArrowRight')).toBe('→');
    expect(keyName('Space')).toBe('Space');
    expect(keyName('ShiftLeft')).toBe('Left Shift');
    expect(keyName('ShiftRight')).toBe('Right Shift');
    expect(keyName('Escape')).toBe('Esc');
    expect(keyName('Tab')).toBe('Tab');
  });
  it('maps letters and digits, passes others through', () => {
    expect(keyName('KeyJ')).toBe('J');
    expect(keyName('Digit1')).toBe('1');
    expect(keyName('F5')).toBe('F5');
    expect(keyName('Numpad3')).toBe('Numpad3');
  });
});
