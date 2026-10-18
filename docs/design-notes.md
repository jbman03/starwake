# Design notes

Decided in the 2026-10-15 design session. Each sub-project gets its own spec
under `docs/superpowers/specs/`.

- **Name:** Starwake (working title; name/trademark check before public launch)
- **Audience:** personal project first, may be released publicly later
- **Favorite EV parts to carry over:** flying, missions, the battle system,
  boarding/capture
- **Progression:** story-driven unlocks; tiered shipyards, best ships only at
  higher-tier worlds
- **Flight:** classic EV momentum with optional assists
- **Phone controls:** side rails, bottom-center context button, tap planet to land
- **PC controls:** arrow keys, a hotkey for every action, all rebindable
- **Art:** rendered look as close to classic EV as possible (original assets)
- **Tech:** Phaser + TypeScript PWA on GitHub Pages (public repo, all rights reserved)

Foundation spec: `docs/superpowers/specs/2026-10-15-starwake-foundation-design.md`

## Original EV concept (from the owner, 2026-10-16)

Reference screenshots came from EV running in the browser at
https://infinitemac.org/1996/System%207.5.3 (useful for checking feel later).

- **Planets** each offer their own mix of services: Commodity Exchange, Mission
  Computer, Spaceport Bar, Outfit Ship, Shipyard. Some have one, some all.
- **Commodity exchange:** goods (Food, Industrial, Medical, Luxury Goods, Metal,
  Equipment, plus unique local goods) each at Low/Med/High plus a price.
  Planet events (surplus/shortage) push prices down or up; another random
  port may be the opposite. Cargo in tons; shuttle starts with 20 free.
- **Mission computer:** generic jobs that differ by trip length and cargo:
  ferry passengers, rush delivery, cargo transport, cargo shipment, cargo
  delivery, dump garbage. Accept from a list with description and pay.
- **Star map:** systems as circles on hyperlanes; zoom; unexplored systems
  blank until visited or a map is bought (maps reveal everything within N
  jumps). Panel: current system, government, legal status, goods traded,
  services, ports, navigation hazards, date. EV started small and grew past
  100 systems.
- **Outfitter:** paged icon grid with owned counts — guns, launchers + ammo,
  turrets, fighter bays, armor, cargo pods, fuel tanks, escape pod, scanners,
  afterburner, mass expansion, maps. **Shipyard:** icon grid of ships + Info.
- **Main menu:** pilot card (pilot name, ship name, ship type, legal status in
  current system, combat rating, date). **In flight:** right-hand sidebar
  (radar, shield/fuel, nav destination, secondary weapon, target, cargo free,
  credits).
- **Factions:** two main powers (EV: Confederation vs Rebellion), plus pirates
  (random, more in outer systems), independent traders and other NPCs.
  Starwake equivalents: **the Concord** (core government), **the Free Reach**
  (frontier independence movement), **raiders**, independents.
- **Reputation:** missions for one side make you wanted by the other; enough
  and they shoot on sight and refuse landing on their worlds. Ships you shoot
  fight back; bribes work only up to a limit. Police scan at random in secure
  systems and patrolled outer areas, not everywhere.
- **Combat:** lasers and missiles hit shields, then armor. Below 10% armor a
  ship is disabled: can't move or shoot, slows and drifts (then boardable).

## Owner feedback after playing (2026-10-17)

- **Map must always be reachable.** In flight there was no obvious way to open it.
  Make it a fixed Map button (PC sidebar, phone rail, one fixed spot on every
  screen) instead of a per-world button. → cycle 2 spec §4.5
- **Refuel anywhere.** Running low, the owner couldn't refuel at some worlds. Every
  port now sells fuel; remote ports charge more. → cycle 2 spec §4.6
- **Mission destination on the map.** Highlighting a mission and pressing the Map key
  should show where it goes, to plan the trip. → cycle 2 spec §4.4
- **Ships must differ.** Each hull has its own role: carriers haul, couriers are fast,
  liners carry passengers, and so on. No two hold sizes are the same, and a balance
  test enforces this. → cycle 2 spec §2.1 role table
- **Recommended additions:** see "EV series study" below. They go to the owner as
  questions with top picks, not decided alone.

## EV series study (2026-10-18)

Sources: the owner's screenshots of the EV folder and manual, plus general knowledge of
how the three games work. The emulator could not be driven from Claude's browser, so the
owner's own play notes remain the best source for exact numbers. Everything below is in
our own words, and nothing is copied.

**How EV is built.** The app is small. Content sits in separate data files (ships,
outfits, weapons, worlds, systems, governments, missions, descriptions), plus graphics,
sounds and music. A plug-ins folder can add or replace any of those records, which is
why the game had such a long modding life. *Starwake already keeps content in JSON;
growing that into a mod loader later is cheap if each record type keeps a stable id and
schema.*

**Manual pitch (paraphrased).** It is an open-ended sandbox: trade, fight for one side
of a civil war, or turn pirate. Several sub-plots branch on your choices, so no two
games play the same. The engine was meant to host other scenarios.

**Shops and stock.**
- Every world and every item has a tech level, and a world sells items at or below its
  level.
- A few items carry a special tech value that only certain worlds have. That is how one
  government gets gear nobody else sells. → Starwake's `techTier` plus `soldBy` plus
  hubs (spec §2.3).
- Every hull has a mass budget for outfits. Each pod, tank, gun and armor piece uses
  some of it. → `outfitSpace` (spec §2.1).
- Selling outfits and trading in ships returns much less than the purchase price, so
  upgrades are real decisions. Trade-in value is spec open question 2.
- Maps reveal systems within a few jumps of where they're bought.
- A ramscoop slowly refuels the ship in flight.
- An escape pod saves the pilot when the ship is destroyed.

**Flight and combat feel.**
- Shields recharge on their own over time. Armor is repaired only when you land.
- A ship whose armor drops low is disabled: it drifts and can't fight. You can then
  board it to take cargo or money, or try to capture it. The odds depend on how your
  crew compares to theirs.
- Escorts can be hired or captured, and they follow your simple orders.
- The right-hand sidebar keeps radar, status, nav and target in a fixed place, so the
  view itself stays clean.

**Law and factions.**
- Each government tracks your legal standing separately. A single combat rating tracks
  overall fighting skill.
- Working for one side angers its enemies. At the extreme, they shoot on sight and
  refuse landing.
- Bribes and paying off fines can fix small problems.

**Pace.** The early game is a money grind in a weak starter ship. Players remember the
first big upgrade as a milestone. It needs to come soon enough (we aim for roughly
30–45 minutes of trading) to keep people playing.

**Override (the first sequel).**
- Same engine and a new setting.
- Mostly open play with lighter story pressure.
- A larger, more varied roster.
- Players liked the freedom. Some found it aimless without a strong thread.

**Nova (the second sequel).**
- **Several storylines.** Each faction has its own long storyline. Choosing one locks
  out its rivals, so the game rewards replaying.
- **Ranks.** Ranks within a faction give a title, plus perks such as a salary,
  discounts, landing rights or access to restricted ships.
- **Recurring characters.** Named pilots in unique ships keep turning up across the
  galaxy.
- **Carriers.** Carriers launch small fighters from bays.
- **New regions.** Mission chains open new areas, and some regions are hidden until the
  story reaches them.
- **Complaints.** Long fetch-quest stretches, story steps that are easy to miss, and
  needing a guide to find the next storyline trigger.

**What to carry into Starwake (owner to choose; top picks first):**
1. **Story-unlocked ship variants and gear** (cycle 3): for example an upgraded courier
   that only becomes available after a story chain. This fits the owner's original
   "story-driven unlocks" goal. *Top pick.*
2. **Faction ranks with real perks** (cycle 5): a title, plus discounts or hub access
   at each faction's tech hub. *Top pick.*
3. **Clear story signposting** (cycle 3): the mission log always shows the next lead,
   which avoids Nova's "where do I go now" problem. *Top pick.*
4. **Escorts and carriers' fighters** (cycle 6), building on the cycle 2 carrier.
5. **Recurring named pilots** in unique ships (cycle 4+).
6. **Story-gated region** (galaxy growth): a hidden area opened by a mission chain.
7. **Ship naming** (cycle 3, shown on the pilot card).
8. **Mod / plug-in loader** (later): extra JSON data packs.
9. **Escape pod** (cycle 4, combat).

## Expansion cycles (agreed 2026-10-16)

1. **Trade, mission computer, more systems** — ~20 systems in three areas
   (Concord core, Free Reach frontier, independent fringe), star map with
   exploration and route planning, in-game date (1 day per jump), cargo hold,
   per-planet services, commodity exchange with events, generic missions.
2. **Ships and outfits** — shipyard with trade-in, outfitter (tech-tier
   stock, maps), EV-style right sidebar HUD on PC.
   *Built:* ten hulls with a tech-tier shipyard and half-price trade-in,
   an outfitter that sells and refunds gear, a Map button on every landed
   screen and the phone rail, mission previews on the map, and the PC sidebar.
3. **Missions and bar** — spaceport bar, story missions that unlock ships,
   gear and areas; pilot card on the main menu.
Later: combat, reputation and police, boarding, contraband, more regions.
