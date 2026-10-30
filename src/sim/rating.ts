/** Combat rating from kills and captures (spec §13). A capture counts double. Pure. */
const TIERS: [number, string][] = [
  [150, 'Legend'],
  [75, 'Ace'],
  [30, 'Veteran'],
  [10, 'Steady'],
  [1, 'Green'],
];

export function combatRating(stats: { kills: number; captures: number }): string {
  const score = stats.kills + 2 * stats.captures;
  return TIERS.find(([min]) => score >= min)?.[1] ?? 'Harmless';
}
