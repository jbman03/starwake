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
- **Recommended additions:** still to be drafted after the EV comparison. They will go
  to the owner as questions with top picks, not decided alone.

## Expansion cycles (agreed 2026-10-16)

1. **Trade, mission computer, more systems** — ~20 systems in three areas
   (Concord core, Free Reach frontier, independent fringe), star map with
   exploration and route planning, in-game date (1 day per jump), cargo hold,
   per-planet services, commodity exchange with events, generic missions.
2. **Ships and outfits** — shipyard with trade-in, outfitter (tech-tier
   stock, maps), EV-style right sidebar HUD on PC.
3. **Missions and bar** — spaceport bar, story missions that unlock ships,
   gear and areas; pilot card on the main menu.
Later: combat, reputation and police, boarding, contraband, more regions.
