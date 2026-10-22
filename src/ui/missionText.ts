import type { GameData } from '../data/schemas';
import { formatDate } from '../sim/calendar';
import type { Mission } from '../sim/types';
import { formatCredits } from './dom';

/** Why Accept is disabled, in the words shown to the pilot. */
export const ACCEPT_REASON = {
  tooMany: 'Mission log full (8 max)',
  noSpace: 'Not enough cargo space',
  noBerths: 'Not enough passenger berths',
  gone: 'No longer available',
} as const;

/** The part of a mission both screens describe (an offer has the same fields). */
export type JobInfo = Pick<Mission, 'destId' | 'tons' | 'passengers' | 'pay' | 'paidUpfront' | 'deadlineDay' | 'cargoName'>;

/** "14 Mar 3207 (5 days left)", "… (due today)", or "No deadline". */
export function deadlineText(job: Pick<JobInfo, 'deadlineDay'>, day: number, data: GameData): string {
  if (job.deadlineDay === null) return 'No deadline';
  const left = job.deadlineDay - day;
  const rest = left <= 0 ? 'due today' : left === 1 ? '1 day left' : `${left} days left`;
  return `${formatDate(job.deadlineDay, data.config)} (${rest})`;
}

/** "Halcyon Station, Halcyon system". */
export function destinationText(job: JobInfo, data: GameData): string {
  const p = data.planets[job.destId];
  if (!p) return job.destId;
  return `${p.name}, ${data.systems[p.systemId]?.name ?? p.systemId} system`;
}

/** Cargo and passenger needs, e.g. "12 t of mining tools · 2 passengers". */
export function loadText(job: JobInfo): string {
  const parts: string[] = [];
  if (job.tons > 0) parts.push(`${job.tons} t of ${job.cargoName}`);
  if (job.passengers > 0) parts.push(`${job.passengers} ${job.passengers === 1 ? 'passenger' : 'passengers'}`);
  return parts.length > 0 ? parts.join(' · ') : 'Nothing to carry';
}

export function payText(job: JobInfo): string {
  return job.paidUpfront ? `${formatCredits(job.pay)} (paid up front)` : formatCredits(job.pay);
}
