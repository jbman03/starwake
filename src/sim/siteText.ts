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
 * The story objective line. PC: "Objective: scan the Dead lantern — out in space, 640 px", and once the site
 * is `reachable` "Objective: scan the Dead lantern — press {interact} to scan" (the token is filled with the
 * bound key by formatMessage). A find site not yet seen (`distance` null) names the system to search instead.
 * Phone (`touch`): short enough for two rail lines: "Scan Dead lantern · 640 px", "Tap Scan",
 * "Search Skerry for the Cache".
 */
/** A hidden find site's signal, from how far away it really is: warmer or colder as the pilot sweeps (playtest). */
export function signalOf(distance: number): 'strong' | 'growing' | 'faint' {
  return distance <= 1000 ? 'strong' : distance <= 1800 ? 'growing' : 'faint';
}

export function objectiveText(
  o: { kind: 'scan' | 'find'; label: string; systemName: string; distance: number | null; reachable?: boolean; hiddenDistance?: number },
  touch = false,
): string {
  const verb = o.kind === 'find' ? 'search' : 'scan';
  const Verb = o.kind === 'find' ? 'Search' : 'Scan';
  const signal = o.distance === null && o.hiddenDistance !== undefined ? ` · signal ${signalOf(o.hiddenDistance)}` : '';
  if (touch) {
    if (o.distance === null) return signal ? `${Verb} ${o.systemName}${signal}` : `${Verb} ${o.systemName} for the ${o.label}`;
    if (o.reachable) return `Tap ${Verb}`;
    return `${Verb} ${o.label} · ${roundDistance(o.distance)} px`;
  }
  if (o.distance === null) return `Objective: ${verb} ${o.systemName} for the ${o.label}${signal}`;
  if (o.reachable) return `Objective: ${verb} the ${o.label} — press {interact} to ${verb}`;
  return `Objective: ${verb} the ${o.label} — out in space, ${roundDistance(o.distance)} px`;
}

/** Appended to a scan or find step's text in the mission log. `{nextTarget}` and `{interact}` are filled with the pilot's keys (src/ui/messageText.ts). */
export const siteStepHint = (find: boolean, touch = false): string =>
  touch
    ? find
      ? "It's out in space, not at a port: fly around the system until it shows on the radar. Tap the bottom button to fly there, then tap it again to search."
      : "It's out in space, not at a port. Tap the bottom button to fly there, then tap it again to scan."
    : find
    ? "It's out in space, not at a port: fly around the system until it shows on the radar, then target it ({nextTarget}), fly beside it slowly and press {interact}."
    : "It's out in space, not at a port: target it ({nextTarget}), fly beside it slowly, then press {interact}.";

/** "The Dead lantern", but "Pell Darrow's courier" as it is: a possessive or a label with its own article takes no "The" (playtest bug 24). */
export const theLabel = (label: string): string => (/^(the|a|an) /i.test(label) || /'s\b/.test(label) ? label : `The ${label}`);

/** Shown on the planet screen when a port is landed at in the system of a story scan or find step (`hidden`: a find site not yet seen). */
export const siteNoticeText = (label: string, hidden = false): string =>
  hidden
    ? `${theLabel(label)} is out in space, not at this port. Fly around the system until it shows on the radar, then target it with {nextTarget}.`
    : `${theLabel(label)} is out in space, not at this port. Target it with {nextTarget} and fly beside it.`;
