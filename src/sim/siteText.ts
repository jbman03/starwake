/** Wording for sites in open space (story scan/find sites and encounter sites); pure, shared by every HUD. */
import type { SiteTarget } from './types';
import { dist, type Vec2 } from './vec';

/** A distance in px rounded to the nearest 10, so a moving ship does not make the number flicker. */
export const roundDistance = (d: number): number => Math.round(d / 10) * 10;

/** "Dead lantern — 640 px": a targeted site and how far off it is. */
export function siteTargetText(site: SiteTarget, from: Vec2): string {
  return `${site.label} — ${roundDistance(dist(site.pos, from))} px`;
}

/**
 * The story objective line: "Objective: scan the Dead lantern — out in space, 640 px". A find site
 * not yet seen (`distance` null) names the system to search instead.
 */
export function objectiveText(o: { kind: 'scan' | 'find'; label: string; systemName: string; distance: number | null }): string {
  const verb = o.kind === 'find' ? 'search' : 'scan';
  if (o.distance === null) return `Objective: ${verb} ${o.systemName} for the ${o.label}`;
  return `Objective: ${verb} the ${o.label} — out in space, ${roundDistance(o.distance)} px`;
}

/** Appended to a scan or find step's text in the mission log. `{nextTarget}` and `{interact}` are filled with the pilot's keys (src/ui/messageText.ts). */
export const siteStepHint = (find: boolean): string =>
  find
    ? "It's out in space, not at a port: fly around the system until it shows on the radar, then target it ({nextTarget}), fly beside it slowly and press {interact}."
    : "It's out in space, not at a port: target it ({nextTarget}), fly beside it slowly, then press {interact}.";

/** Shown on the planet screen when a port is landed at in the system of a story scan or find step (`hidden`: a find site not yet seen). */
export const siteNoticeText = (label: string, hidden = false): string =>
  hidden
    ? `The ${label} is out in space, not at this port. Fly around the system until it shows on the radar, then target it with {nextTarget}.`
    : `The ${label} is out in space, not at this port. Target it with {nextTarget} and fly beside it.`;
