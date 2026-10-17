import { z } from 'zod';
import {
  CommoditySchema,
  ConfigSchema,
  EventSchema,
  GovernmentSchema,
  MissionTypeSchema,
  PlanetSchema,
  ShipSchema,
  SystemSchema,
  type GameConfig,
  type GameData,
} from './schemas';

export class DataError extends Error {
  constructor(
    public readonly file: string,
    public readonly issues: string[],
  ) {
    super(`Invalid game data in ${file}:\n  ${issues.join('\n  ')}`);
    this.name = 'DataError';
  }
}

function describeIssue(issue: z.core.$ZodIssue): string {
  if (issue.code === 'invalid_type') return `expected ${issue.expected}`;
  return issue.message;
}

const fmt = (file: string, path: string, msg: string) =>
  path ? `${file} → ${path}: ${msg}` : `${file} → ${msg}`;

function zodIssues(file: string, prefix: string, err: z.ZodError): string[] {
  return err.issues.map((i) => {
    const p = [prefix, ...i.path.map(String)].filter(Boolean).join('.');
    return fmt(file, p, describeIssue(i));
  });
}

/** Files are JSON arrays of objects, each with an `id`; result is keyed by id. */
function parseList<T extends { id: string }>(
  file: string,
  schema: z.ZodType<T>,
  value: unknown,
): Record<string, T> {
  if (!Array.isArray(value)) throw new DataError(file, [fmt(file, '', 'expected array')]);
  const out: Record<string, T> = {};
  const issues: string[] = [];
  value.forEach((item, idx) => {
    const rawId = (item as { id?: unknown } | null)?.id;
    const label = typeof rawId === 'string' && rawId ? rawId : `[${idx}]`;
    const r = schema.safeParse(item);
    if (!r.success) {
      issues.push(...zodIssues(file, label, r.error));
      return;
    }
    if (r.data.id in out) {
      issues.push(fmt(file, `${r.data.id}.id`, 'duplicate id'));
      return;
    }
    out[r.data.id] = r.data;
  });
  if (issues.length) throw new DataError(file, issues);
  return out;
}

const KEYS = [
  'ships',
  'systems',
  'planets',
  'config',
  'governments',
  'commodities',
  'events',
  'missionTypes',
] as const;

export function parseGameData(raw: Record<(typeof KEYS)[number], unknown>): GameData {
  const ships = parseList('ships.json', ShipSchema, raw.ships);
  const systems = parseList('systems.json', SystemSchema, raw.systems);
  const planets = parseList('planets.json', PlanetSchema, raw.planets);
  const governments = parseList('governments.json', GovernmentSchema, raw.governments);
  const commodities = parseList('commodities.json', CommoditySchema, raw.commodities);
  const events = parseList('events.json', EventSchema, raw.events);
  const missionTypes = parseList('missionTypes.json', MissionTypeSchema, raw.missionTypes);

  const cfg = ConfigSchema.safeParse(raw.config);
  if (!cfg.success) throw new DataError('config.json', zodIssues('config.json', '', cfg.error));
  const config: GameConfig = cfg.data;

  const sysIssues: string[] = [];
  for (const s of Object.values(systems)) {
    s.links.forEach((l, i) => {
      if (!(l in systems))
        sysIssues.push(fmt('systems.json', `${s.id}.links.${i}`, `unknown system "${l}"`));
    });
    if (!(s.government in governments))
      sysIssues.push(fmt('systems.json', `${s.id}.government`, `unknown government "${s.government}"`));
    // Lanes are two-way: if A lists B, B must list A.
    for (const l of s.links) {
      if (l in systems && !systems[l].links.includes(s.id))
        sysIssues.push(fmt('systems.json', `${s.id}.links`, `link to ${l} is not mirrored`));
    }
  }
  // The lane graph must be connected (walk from the start system).
  if (config.startSystemId in systems) {
    const seen = new Set([config.startSystemId]);
    const queue = [config.startSystemId];
    while (queue.length) {
      const cur = systems[queue.shift()!];
      for (const l of cur.links) {
        if (l in systems && !seen.has(l)) {
          seen.add(l);
          queue.push(l);
        }
      }
    }
    for (const s of Object.values(systems)) {
      if (!seen.has(s.id))
        sysIssues.push(fmt('systems.json', s.id, `unreachable from ${config.startSystemId}`));
    }
  }
  if (sysIssues.length) throw new DataError('systems.json', sysIssues);

  const planetIssues: string[] = [];
  for (const p of Object.values(planets)) {
    if (!(p.systemId in systems))
      planetIssues.push(fmt('planets.json', `${p.id}.systemId`, `unknown system "${p.systemId}"`));
    for (const g of Object.keys(p.market ?? {})) {
      if (!(g in commodities))
        planetIssues.push(fmt('planets.json', `${p.id}.market.${g}`, 'unknown commodity'));
    }
    const hasRefuel = p.services.includes('refuel');
    const hasExchange = p.services.includes('exchange');
    const hasMarket = Object.keys(p.market ?? {}).length > 0;
    if (hasRefuel !== (p.fuelPrice !== undefined))
      planetIssues.push(
        fmt('planets.json', `${p.id}.services`, '"refuel" must be listed exactly when fuelPrice is set'),
      );
    if (hasExchange !== hasMarket)
      planetIssues.push(
        fmt('planets.json', `${p.id}.services`, '"exchange" must be listed exactly when market is non-empty'),
      );
  }
  if (planetIssues.length) throw new DataError('planets.json', planetIssues);

  const goodsIssues: string[] = [];
  for (const c of Object.values(commodities)) {
    if (c.origin === undefined) continue;
    const port = planets[c.origin];
    if (!port) goodsIssues.push(fmt('commodities.json', `${c.id}.origin`, `unknown port "${c.origin}"`));
    else if (port.market?.[c.id] !== 'low')
      goodsIssues.push(fmt('commodities.json', `${c.id}.origin`, `port "${c.origin}" must sell it at low`));
  }
  if (goodsIssues.length) throw new DataError('commodities.json', goodsIssues);

  const eventIssues: string[] = [];
  for (const e of Object.values(events)) {
    if (!(e.commodity in commodities))
      eventIssues.push(fmt('events.json', `${e.id}.commodity`, `unknown commodity "${e.commodity}"`));
  }
  if (eventIssues.length) throw new DataError('events.json', eventIssues);

  const missionIssues: string[] = [];
  const anyDump = Object.values(planets).some((p) => p.dumpSite);
  for (const m of Object.values(missionTypes)) {
    if (m.toDumpSite && !anyDump)
      missionIssues.push(fmt('missionTypes.json', `${m.id}.toDumpSite`, 'no port is flagged dumpSite'));
  }
  if (missionIssues.length) throw new DataError('missionTypes.json', missionIssues);

  const cfgIssues: string[] = [];
  if (!(config.startSystemId in systems))
    cfgIssues.push(fmt('config.json', 'startSystemId', `unknown system "${config.startSystemId}"`));
  if (!(config.startShipId in ships))
    cfgIssues.push(fmt('config.json', 'startShipId', `unknown ship "${config.startShipId}"`));
  const sp = planets[config.startPlanetId];
  if (!sp)
    cfgIssues.push(fmt('config.json', 'startPlanetId', `unknown planet "${config.startPlanetId}"`));
  else if (sp.systemId !== config.startSystemId)
    cfgIssues.push(
      fmt('config.json', 'startPlanetId', `planet "${sp.id}" is not in start system "${config.startSystemId}"`),
    );
  config.knownAtStart.forEach((sid, i) => {
    if (!(sid in systems))
      cfgIssues.push(fmt('config.json', `knownAtStart.${i}`, `unknown system "${sid}"`));
  });
  if (cfgIssues.length) throw new DataError('config.json', cfgIssues);

  return { ships, systems, planets, governments, commodities, events, missionTypes, config };
}

/** Loads and validates the bundled data. `override` swaps raw payloads (used by test flags). */
export async function loadGameData(
  override: Partial<Record<(typeof KEYS)[number], unknown>> = {},
): Promise<GameData> {
  const [ships, systems, planets, config, governments, commodities, events, missionTypes] =
    await Promise.all([
      import('../../data/ships.json'),
      import('../../data/systems.json'),
      import('../../data/planets.json'),
      import('../../data/config.json'),
      import('../../data/governments.json'),
      import('../../data/commodities.json'),
      import('../../data/events.json'),
      import('../../data/missionTypes.json'),
    ]);
  return parseGameData({
    ships: ships.default,
    systems: systems.default,
    planets: planets.default,
    config: config.default,
    governments: governments.default,
    commodities: commodities.default,
    events: events.default,
    missionTypes: missionTypes.default,
    ...override,
  });
}
