/** Fuel display helpers shared by the desktop HUD, the touch rail HUD and the planet screen. */

/** Whole jumps a tank of `fuel` units allows at `perJump` units per jump. */
export function jumpsOf(fuel: number, perJump: number): number {
  return perJump > 0 ? Math.floor(fuel / perJump) : Infinity;
}

/** "Fuel: 1 jump", "Fuel: 3 jumps". */
export function fuelText(jumps: number): string {
  return `Fuel: ${jumps} ${jumps === 1 ? 'jump' : 'jumps'}`;
}
