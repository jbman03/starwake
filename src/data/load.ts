import { z } from 'zod';
import {
  CommoditySchema,
  ConfigSchema,
  EncounterSchema,
  EventSchema,
  GovernmentSchema,
  MissionTypeSchema,
  NamesSchema,
  OutfitSchema,
  PlanetSchema,
  ShipSchema,
  StoryMissionSchema,
  SystemSchema,
  type GameConfig,
  type Outcome,
  type GameData,
} from './schemas';
import { sells } from '../sim/stock';

export class DataError extends Error {
  constructor(
    public readonly file: string,
    public readonly issues: string[],
  ) {
    super(`Invalid game data in ${file}:\n  ${issues.join('\n  ')}`);
    this.name = 'DataError';
  }
}

/** Fewest lane hops between two systems (Infinity when unconnected). */
function hopDistance(systems: Record<string, { links: string[] }>, from: string, to: string): number {
  const seen = new Set([from]);
  let frontier = [from];
  for (let d = 0; frontier.length > 0; d++) {
    if (frontier.includes(to)) return d;
    const next: string[] = [];
    for (const id of frontier) {
      for (const l of systems[id]?.links ?? []) {
        if (l in systems && !seen.has(l)) {
          seen.add(l);
          next.push(l);
        }
      }
    }
    frontier = next;
  }
  return Infinity;
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

interface Refs {
  systems: Record<string, unknown>;
  planets: Record<string, unknown>;
  governments: Record<string, unknown>;
  commodities: Record<string, unknown>;
  missionTypes: Record<string, unknown>;
  ships: Record<string, { unique?: boolean }>;
}

/** Reference checks for one outcome; pushes a path-tagged issue for each unknown id. */
function checkOutcome(issues: string[], file: string, at: string, o: Outcome, r: Refs): void {
  if (o.type === 'cargo' && !(o.good in r.commodities)) issues.push(fmt(file, at, `unknown commodity "${o.good}"`));
  if (o.type === 'mission') {
    if (!(o.missionType in r.missionTypes)) issues.push(fmt(file, at, `unknown mission type "${o.missionType}"`));
    if (o.toSystem !== undefined && !(o.toSystem in r.systems)) issues.push(fmt(file, at, `unknown system "${o.toSystem}"`));
  }
  if (o.type === 'reveal')
    for (const sid of o.systems ?? []) if (!(sid in r.systems)) issues.push(fmt(file, at, `unknown system "${sid}"`));
  if (o.type === 'standing' && !(o.government in r.governments))
    issues.push(fmt(file, at, `unknown government "${o.government}"`));
}

function checkChoices(issues: string[], file: string, at: string, choices: { needs?: { cargo?: { good: string } } }[], r: Refs): void {
  choices.forEach((c, ci) => {
    const g = c.needs?.cargo?.good;
    if (g !== undefined && !(g in r.commodities)) issues.push(fmt(file, `${at}.choices.${ci}.needs.cargo`, `unknown commodity "${g}"`));
  });
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
  'outfits',
  'names',
  'encounters',
  'story',
] as const;

export function parseGameData(raw: Record<(typeof KEYS)[number], unknown>): GameData {
  const ships = parseList('ships.json', ShipSchema, raw.ships);
  const outfits = parseList('outfits.json', OutfitSchema, raw.outfits);
  const systems = parseList('systems.json', SystemSchema, raw.systems);
  const planets = parseList('planets.json', PlanetSchema, raw.planets);
  const governments = parseList('governments.json', GovernmentSchema, raw.governments);
  const commodities = parseList('commodities.json', CommoditySchema, raw.commodities);
  const events = parseList('events.json', EventSchema, raw.events);
  const missionTypes = parseList('missionTypes.json', MissionTypeSchema, raw.missionTypes);

  const nm = NamesSchema.safeParse(raw.names);
  if (!nm.success) throw new DataError('names.json', zodIssues('names.json', '', nm.error));
  const names = nm.data;
  const encounters = parseList('encounters.json', EncounterSchema, raw.encounters);

  const stf = z.object({ missions: z.array(z.unknown()) }).safeParse(raw.story);
  if (!stf.success) throw new DataError('story.json', zodIssues('story.json', '', stf.error));
  const story = parseList('story.json', StoryMissionSchema, stf.data.missions);

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
    if (s.hidden && !s.unlockFlag) sysIssues.push(fmt('systems.json', `${s.id}.unlockFlag`, 'a hidden system needs an unlockFlag'));
    // Lanes are two-way: if A lists B, B must list A.
    for (const l of s.links) {
      if (l in systems && !systems[l].links.includes(s.id))
        sysIssues.push(fmt('systems.json', `${s.id}.links`, `link to ${l} is not mirrored`));
    }
    // Hidden lanes follow the same rule among themselves.
    (s.hiddenLinks ?? []).forEach((l, i) => {
      if (!(l in systems)) {
        sysIssues.push(fmt('systems.json', `${s.id}.hiddenLinks.${i}`, `unknown system "${l}"`));
      } else if (!(systems[l].hiddenLinks ?? []).includes(s.id)) {
        sysIssues.push(fmt('systems.json', `${s.id}.hiddenLinks`, `link to ${l} is not mirrored`));
      }
    });
  }
  // The lane graph must be connected (walk from the start system).
  if (config.startSystemId in systems) {
    const seen = new Set([config.startSystemId]);
    const queue = [config.startSystemId];
    while (queue.length) {
      const cur = systems[queue.shift()!];
      for (const l of [...cur.links, ...(cur.hiddenLinks ?? [])]) {
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
    const hasExchange = p.services.includes('exchange');
    const hasMarket = Object.keys(p.market ?? {}).length > 0;
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

  const shopIssues: string[] = [];
  const hubsByGov: Record<string, string[]> = {};
  // Only governments that hold a system need a hub (the raiders hold none).
  for (const gid of Object.keys(governments)) if (Object.values(systems).some((sy) => sy.government === gid)) hubsByGov[gid] = [];
  for (const p of Object.values(planets)) {
    if (!p.hub) continue;
    if (!p.services.includes('shipyard') || !p.services.includes('outfitter'))
      shopIssues.push(fmt('planets.json', `${p.id}.hub`, 'hub must have both shipyard and outfitter'));
    hubsByGov[systems[p.systemId].government]?.push(p.id);
  }
  for (const [gid, hubs] of Object.entries(hubsByGov)) {
    if (hubs.length === 0) shopIssues.push(fmt('planets.json', 'hub', `government "${gid}" has no hub`));
    for (let i = 0; i < hubs.length; i++)
      for (let j = i + 1; j < hubs.length; j++) {
        const hops = hopDistance(systems, planets[hubs[i]].systemId, planets[hubs[j]].systemId);
        if (hops < 2)
          shopIssues.push(
            fmt('planets.json', 'hub', `hubs "${hubs[i]}" and "${hubs[j]}" are only ${hops} jump apart; need at least 2`),
          );
      }
  }
  const partial = { ships, outfits, systems, planets, governments, commodities, events, missionTypes, names, encounters, story, config } as GameData;
  const items: { file: string; item: { id: string; techTier: number; soldBy?: string[] } }[] = [
    ...Object.values(ships).map((item) => ({ file: 'ships.json', item })),
    ...Object.values(outfits).map((item) => ({ file: 'outfits.json', item })),
  ];
  for (const { file, item } of items) {
    const shop = file === 'ships.json' ? 'shipyard' : 'outfitter';
    for (const g of item.soldBy ?? []) {
      if (!(g in governments)) shopIssues.push(fmt(file, `${item.id}.soldBy`, `unknown government "${g}"`));
    }
    for (const pid of (item as { soldAt?: string[] }).soldAt ?? []) {
      if (!(pid in planets)) shopIssues.push(fmt(file, `${item.id}.soldAt`, `unknown planet "${pid}"`));
    }
    const gate = (item as { requiresStanding?: { government: string } }).requiresStanding;
    if (gate && !(gate.government in governments))
      shopIssues.push(fmt(file, `${item.id}.requiresStanding.government`, `unknown government "${gate.government}"`));
    const sellers = Object.values(planets).filter((p) => p.services.includes(shop) && sells(p.id, item, partial));
    if (sellers.length === 0) shopIssues.push(fmt(file, item.id, 'no port sells this'));
    for (const g of item.soldBy ?? []) {
      if (!(g in governments)) continue;
      if (!sellers.some((p) => p.hub && systems[p.systemId].government === g))
        shopIssues.push(fmt(file, `${item.id}.soldBy`, `not sold at any "${g}" hub`));
    }
  }
  if (shopIssues.length) throw new DataError('planets.json', shopIssues);

  const eventIssues: string[] = [];
  for (const e of Object.values(events)) {
    if (!(e.commodity in commodities))
      eventIssues.push(fmt('events.json', `${e.id}.commodity`, `unknown commodity "${e.commodity}"`));
  }
  if (eventIssues.length) throw new DataError('events.json', eventIssues);

  const refs: Refs = { systems, planets, governments, commodities, missionTypes, ships };
  const encIssues: string[] = [];
  for (const e of Object.values(encounters)) {
    const w = e.when;
    (w?.systems ?? []).forEach((sid, i) => {
      if (!(sid in systems)) encIssues.push(fmt('encounters.json', `${e.id}.when.systems.${i}`, `unknown system "${sid}"`));
    });
    (w?.governments ?? []).forEach((gid, i) => {
      if (!(gid in governments))
        encIssues.push(fmt('encounters.json', `${e.id}.when.governments.${i}`, `unknown government "${gid}"`));
    });
    checkChoices(encIssues, 'encounters.json', e.id, e.choices, refs);
    e.choices.forEach((c, ci) =>
      c.outcomes.forEach((o, oi) =>
        checkOutcome(encIssues, 'encounters.json', `${e.id}.choices.${ci}.outcomes.${oi}`, o, refs),
      ),
    );
  }
  if (encIssues.length) throw new DataError('encounters.json', encIssues);

  const storyIssues: string[] = [];
  const sf = 'story.json';
  // Every flag some outcome or hidden system can set; an offer may only mention these.
  const settable = new Set<string>(Object.values(systems).flatMap((sy) => (sy.unlockFlag ? [sy.unlockFlag] : [])));
  const collect = (os: readonly Outcome[]) => {
    for (const o of os) if (o.type === 'flag' || o.type === 'unlock') settable.add(o.flag);
  };
  for (const e of Object.values(encounters)) e.choices.forEach((c) => collect(c.outcomes));
  for (const m of Object.values(story)) {
    collect(m.onComplete);
    collect(m.onFail ?? []);
    for (const st of m.steps) if (st.kind === 'meet') st.card.choices.forEach((c) => collect(c.outcomes));
  }
  // A choice gated on a flag must name one that something can set.
  const gate = (c: { needs?: { flag?: string } }, at: string) => {
    if (c.needs?.flag && !settable.has(c.needs.flag)) storyIssues.push(fmt(sf, at, `needs.flag "${c.needs.flag}" is never set by any outcome or system`));
  };
  for (const e of Object.values(encounters)) e.choices.forEach((c, ci) => gate(c, `${e.id}.choices.${ci}`));
  for (const m of Object.values(story))
    m.steps.forEach((st, si) => {
      if (st.kind === 'meet') st.card.choices.forEach((c, ci) => gate(c, `${m.id}.steps.${si}.card.choices.${ci}`));
    });
  for (const m of Object.values(story)) {
    const unknownIn = (at: string, kind: string, v: string, set: Record<string, unknown>) => {
      if (!(v in set)) storyIssues.push(fmt(sf, `${m.id}.${at}`, `unknown ${kind} "${v}"`));
    };
    (m.offer.ports ?? []).forEach((v, i) => unknownIn(`offer.ports.${i}`, 'planet', v, planets));
    (m.offer.systems ?? []).forEach((v, i) => unknownIn(`offer.systems.${i}`, 'system', v, systems));
    for (const k of ['requires', 'notFlags'] as const)
      (m.offer[k] ?? []).forEach((f, i) => {
        if (!settable.has(f)) storyIssues.push(fmt(sf, `${m.id}.offer.${k}.${i}`, `flag "${f}" is never set by any outcome or system`));
      });
    // A step or hail in a hidden system is only reachable once its unlock flag is set, so the offer must wait for it.
    const needsUnlock = (sysId: string, at: string) => {
      const sy = systems[sysId];
      if (sy?.hidden && sy.unlockFlag && !(m.offer.requires ?? []).includes(sy.unlockFlag))
        storyIssues.push(fmt(sf, `${m.id}.${at}`, `system "${sysId}" is hidden: offer.requires must include "${sy.unlockFlag}"`));
    };
    if (m.offer.where === 'hail') (m.offer.systems ?? []).forEach((v, i) => needsUnlock(v, `offer.systems.${i}`));
    for (const g of Object.keys(m.offer.standing ?? {})) unknownIn(`offer.standing.${g}`, 'government', g, governments);
    m.steps.forEach((st, i) => {
      const at = `steps.${i}`;
      if ('system' in st) {
        unknownIn(`${at}.system`, 'system', st.system, systems);
        needsUnlock(st.system, `${at}.system`);
      }
      if ('planet' in st) {
        unknownIn(`${at}.planet`, 'planet', st.planet, planets);
        const home = planets[st.planet]?.systemId;
        if (home) needsUnlock(home, `${at}.planet`);
      }
      if (st.kind === 'meet') {
        unknownIn(`${at}.ship.shipId`, 'ship', st.ship.shipId, ships);
        unknownIn(`${at}.ship.government`, 'government', st.ship.government, governments);
        if (ships[st.ship.shipId]?.unique)
          storyIssues.push(fmt(sf, `${m.id}.${at}.ship.shipId`, `ship "${st.ship.shipId}" is unique and cannot be met as an NPC`));
        checkChoices(storyIssues, sf, `${m.id}.${at}.card`, st.card.choices, refs);
        st.card.choices.forEach((c, ci) =>
          c.outcomes.forEach((o, oi) => checkOutcome(storyIssues, sf, `${m.id}.${at}.card.choices.${ci}.outcomes.${oi}`, o, refs)),
        );
      }
    });
    m.onComplete.forEach((o, i) => checkOutcome(storyIssues, sf, `${m.id}.onComplete.${i}`, o, refs));
    (m.onFail ?? []).forEach((o, i) => checkOutcome(storyIssues, sf, `${m.id}.onFail.${i}`, o, refs));
  }
  if (storyIssues.length) throw new DataError(sf, storyIssues);

  // A hull or outfit gated on a story flag (or withdrawn by one) must name a flag something can set.
  const gearIssues: string[] = [];
  for (const sh of Object.values(ships)) {
    if (sh.requiresFlag && !settable.has(sh.requiresFlag)) gearIssues.push(fmt('ships.json', `${sh.id}.requiresFlag`, `flag "${sh.requiresFlag}" is never set by any outcome or system`));
    if (sh.hiddenByFlag && !settable.has(sh.hiddenByFlag)) gearIssues.push(fmt('ships.json', `${sh.id}.hiddenByFlag`, `flag "${sh.hiddenByFlag}" is never set by any outcome or system`));
  }
  for (const o of Object.values(outfits))
    if (o.requiresFlag && !settable.has(o.requiresFlag)) gearIssues.push(fmt('outfits.json', `${o.id}.requiresFlag`, `flag "${o.requiresFlag}" is never set by any outcome or system`));
  if (gearIssues.length) throw new DataError('ships.json / outfits.json', gearIssues);

  const combatIssues: string[] = [];
  for (const o of Object.values(outfits)) {
    if (o.category === 'launcher' && outfits[o.effect.ammo]?.category !== 'ammo')
      combatIssues.push(fmt('outfits.json', `${o.id}.effect.ammo`, `"${o.effect.ammo}" is not an ammo outfit`));
  }
  for (const sh of Object.values(ships))
    for (const oid of Object.keys(sh.loadout ?? {}))
      if (!(oid in outfits)) combatIssues.push(fmt('ships.json', `${sh.id}.loadout.${oid}`, `unknown outfit "${oid}"`));
  for (const oid of Object.keys(config.startOutfits))
    if (!(oid in outfits)) combatIssues.push(fmt('config.json', `startOutfits.${oid}`, `unknown outfit "${oid}"`));
  if (combatIssues.length) throw new DataError('outfits.json / ships.json / config.json', combatIssues);

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
  else if (Object.values(ships).some((s) => s.id !== config.startShipId && s.price <= ships[config.startShipId].price))
    cfgIssues.push(fmt('config.json', 'startShipId', 'startShipId must be the lowest-priced ship'));
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

  return { ships, outfits, systems, planets, governments, commodities, events, missionTypes, names, encounters, story, config };
}

/** Loads and validates the bundled data. `override` swaps raw payloads (used by test flags). */
export async function loadGameData(
  override: Partial<Record<(typeof KEYS)[number], unknown>> = {},
): Promise<GameData> {
  const [ships, systems, planets, config, governments, commodities, events, missionTypes, outfits, names, encounters, story] =
    await Promise.all([
      import('../../data/ships.json'),
      import('../../data/systems.json'),
      import('../../data/planets.json'),
      import('../../data/config.json'),
      import('../../data/governments.json'),
      import('../../data/commodities.json'),
      import('../../data/events.json'),
      import('../../data/missionTypes.json'),
      import('../../data/outfits.json'),
      import('../../data/names.json'),
      import('../../data/encounters.json'),
      import('../../data/story.json'),
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
    outfits: outfits.default,
    names: names.default,
    encounters: encounters.default,
    story: story.default,
    ...override,
  });
}
