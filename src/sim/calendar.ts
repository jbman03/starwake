import type { GameConfig } from '../data/schemas';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "14 Mar 3207" for a day count since the configured start date. Timezone-independent. */
export function formatDate(day: number, cfg: GameConfig): string {
  const d = new Date(Date.UTC(cfg.startYear, cfg.startMonth - 1, cfg.startDay + day));
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}
