/** Friendly display names for KeyboardEvent.code values. Pure; no DOM. */

const NAMES: Record<string, string> = {
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
  Space: 'Space',
  ShiftLeft: 'Left Shift',
  ShiftRight: 'Right Shift',
  Escape: 'Esc',
  Tab: 'Tab',
};

export function keyName(code: string): string {
  if (NAMES[code]) return NAMES[code];
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit\d$/.test(code)) return code.slice(5);
  return code;
}
