import { z } from 'zod';
import {
  ConfigSchema,
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

export function parseGameData(raw: {
  ships: unknown;
  systems: unknown;
  planets: unknown;
  config: unknown;
}): GameData {
  const ships = parseList('ships.json', ShipSchema, raw.ships);
  const systems = parseList('systems.json', SystemSchema, raw.systems);
  const planets = parseList('planets.json', PlanetSchema, raw.planets);

  const cfg = ConfigSchema.safeParse(raw.config);
  if (!cfg.success) throw new DataError('config.json', zodIssues('config.json', '', cfg.error));
  const config: GameConfig = cfg.data;

  const sysIssues: string[] = [];
  for (const s of Object.values(systems)) {
    s.links.forEach((l, i) => {
      if (!(l in systems))
        sysIssues.push(fmt('systems.json', `${s.id}.links.${i}`, `unknown system "${l}"`));
    });
  }
  if (sysIssues.length) throw new DataError('systems.json', sysIssues);

  const planetIssues: string[] = [];
  for (const p of Object.values(planets)) {
    if (!(p.systemId in systems))
      planetIssues.push(fmt('planets.json', `${p.id}.systemId`, `unknown system "${p.systemId}"`));
  }
  if (planetIssues.length) throw new DataError('planets.json', planetIssues);

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
  if (cfgIssues.length) throw new DataError('config.json', cfgIssues);

  return { ships, systems, planets, config };
}

/** Loads and validates the bundled data. `override` swaps raw payloads (used by test flags). */
export async function loadGameData(
  override: Partial<Record<'ships' | 'systems' | 'planets' | 'config', unknown>> = {},
): Promise<GameData> {
  const [ships, systems, planets, config] = await Promise.all([
    import('../../data/ships.json'),
    import('../../data/systems.json'),
    import('../../data/planets.json'),
    import('../../data/config.json'),
  ]);
  return parseGameData({
    ships: ships.default,
    systems: systems.default,
    planets: planets.default,
    config: config.default,
    ...override,
  });
}
