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

/** What a press on an NPC ship sprite acts on. */
export type ShipPress = { kind: 'ship'; id: string } | { kind: 'planet'; id: string };

/**
 * A press landed on an NPC ship sprite, which draws above the planets and so takes the press first.
 * A touch or pen tap on a planet means "land there" (phones have TGT for targeting), so when a
 * planet's tap circle is also under the finger, the planet wins: ships launching from or arriving
 * at a port sit on top of it and would otherwise swallow the tap. A mouse click still targets the ship.
 */
export function resolveShipPress(shipId: string, planetsUnder: readonly string[], pointerType: string): ShipPress {
  if (pointerType !== 'mouse' && planetsUnder.length > 0) return { kind: 'planet', id: planetsUnder[0] };
  return { kind: 'ship', id: shipId };
}
