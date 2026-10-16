/**
 * The kind of pointer behind a Phaser pointer event: the DOM event's `pointerType` when it has
 * one (PointerEvent), else 'touch' for touch events and 'mouse' for mouse events (Phaser listens
 * to mouse and touch events separately, and a MouseEvent carries no pointerType).
 */
export function pointerTypeOf(event: unknown, wasTouch: boolean): string {
  const t = (event as { pointerType?: unknown } | null | undefined)?.pointerType;
  if (typeof t === 'string' && t !== '') return t;
  return wasTouch ? 'touch' : 'mouse';
}
