# Starwake: Cycle 2 — Shipyard, Outfitter and PC Sidebar HUD

**Date:** 2026-10-17
**Status:** Awaiting owner review
**Builds on:** cycle 1 (`2026-10-16-starwake-cycle1-trade-missions-design.md`) and the
beginner guide (`2026-10-17-starwake-beginner-guide-design.md`), both shipped
**Context:** `docs/design-notes.md` (original EV concept from the owner)

## 1. Purpose

Cycle 1 lets a pilot earn money, but there is nothing to spend it on beyond fuel and
cargo. Cycle 2 closes the loop: **better ships at a shipyard, upgrades at an
outfitter**, with the best hulls only at high-tech worlds so travel matters. It also
gives PC players the classic **right-hand sidebar HUD**.

Owner decisions this spec follows (all "go with the recommendation"):
- **Weapons are deferred** to the combat cycle. Nothing is sold that does nothing yet.
- Outfits **go with the old ship** on a trade-in (EV style).
- The sidebar HUD is **keyboard (PC) mode only**; touch keeps its rails.
- All names, descriptions and art are **original**; no EV names or text.

Out of scope: weapons, ammo, combat, damage, escape pods, scanners, afterburners,
the spaceport bar, story missions, the pilot card (cycle 3).

## 2. Content

### 2.1 Ships (`data/ships.json`)
`ShipSchema` gains:
- `price` (credits, integer ≥ 0)
- `techTier` (1–5)
- `shields`, `armor` (integers ≥ 0; base maximums)
- `outfitSpace` (tons available for outfits)
- `role` — one of `'starter' | 'courier' | 'scout' | 'freighter' | 'heavyFreighter' |
  'liner' | 'interceptor' | 'corvette' | 'trader' | 'carrier'`
- `hull` — the silhouette profile: `'pod' | 'dart' | 'wedge' | 'hauler' | 'liner' |
  'carrier'`
- `description` (original text, 1–2 sentences)

Crew is not added yet. It has no use until combat and boarding exist.

**Roster: 10 hulls, each with a distinct role (owner direction: no two ships alike).**
This table is a draft for owner approval. All names are original, and numbers may be
tuned while balancing. Flight stats are in game units: the current shuttle is speed
300, acceleration 150, turn 180°/s, and a jump costs 100 fuel.

| Tier | Ship | Role | Price | Hold t | Berths | Fuel | Speed | Accel | Turn | Shields | Armor | Outfit space | Hull |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Wayfarer Shuttle | starter | 10,000 | 20 | 4 | 300 | 300 | 150 | 180 | 60 | 40 | 10 | pod |
| 2 | Swiftwing Courier | courier: fast, small hold, extra fuel | 30,000 | 12 | 2 | 500 | 420 | 230 | 220 | 70 | 40 | 12 | dart |
| 2 | Pathfinder Scout | scout: longest range, nimble | 35,000 | 6 | 1 | 900 | 380 | 200 | 240 | 50 | 30 | 14 | dart |
| 2 | Mule Light Freighter | freighter: big cheap hold, slow | 45,000 | 60 | 2 | 400 | 240 | 110 | 120 | 100 | 120 | 20 | hauler |
| 3 | Kestrel Interceptor | interceptor: fastest, most agile, tiny hold (combat later) | 70,000 | 5 | 0 | 300 | 460 | 300 | 300 | 150 | 100 | 25 | dart |
| 3 | Starlit Liner | liner: most berths | 90,000 | 25 | 30 | 500 | 280 | 120 | 110 | 180 | 120 | 20 | liner |
| 4 | Ironback Heavy Freighter | heavyFreighter: largest hold | 140,000 | 150 | 4 | 600 | 200 | 80 | 90 | 250 | 300 | 30 | hauler |
| 4 | Warden Corvette | corvette: balanced, tough, most outfit space for its size (weapons later) | 160,000 | 30 | 6 | 450 | 340 | 190 | 170 | 300 | 250 | 45 | wedge |
| 5 | Meridian Trader | trader: best all-rounder | 300,000 | 90 | 12 | 700 | 330 | 160 | 150 | 350 | 300 | 50 | wedge |
| 5 | Bastion Carrier | carrier: huge hull with big hauling and berths, most shields, armor and outfit space (fighter bays later) | 450,000 | 120 | 20 | 800 | 230 | 90 | 80 | 600 | 600 | 80 | carrier |

The only tier-5 ships, the Meridian and the Bastion, are sold only at tier-5 worlds.
Prices scale so the first upgrade takes a few successful trade runs, and a tier-5 hull
is a long-term goal.

**Balance test.** This is a unit test over `data/ships.json` that fails if any of these
stops being true:
- No two ships share a hold size.
- The heavy freighter has the largest hold.
- The liner has the most berths.
- The scout has the largest fuel tank.
- The interceptor has the highest speed and turn rate.
- The carrier has the most shields, armor and outfit space.
- The starter is the cheapest ship.

### 2.2 Outfits (new `data/outfits.json`)
`OutfitSchema`: `id`, `name`, `description`, `category` (`'cargo' | 'fuel' | 'armor' |
'shields' | 'map'`), `price`, `techTier` (1–5), `space` (tons of outfit space used, 0
for maps), `max` (per ship), and an effect:
- `cargo`: `+tons` of cargo capacity
- `fuel`: `+units` of fuel capacity
- `armor` / `shields`: `+points` to the maximum
- `map`: `jumps` — reveals every system within N jumps of the current one

About 12 items, for example: small and large cargo pods, a fuel tank and an extended
tank, two armor plates, two shield units, and local, regional and long-range charts
(2, 4 and 7 jumps).

Maps take effect **at purchase** and are not kept as owned items (no owned count,
cannot be sold). Revealed systems become `known` and their neighbours `seen`, the same
as arriving (reuse the `revealOnArrival` rules).

### 2.3 Where they are sold
`PlanetSchema.services` gains `'shipyard'` and `'outfitter'`. Data adds them to a
spread of worlds: outfitters at most tier-2+ worlds, shipyards mostly tier 3+, with at
least one shipyard reachable from the start in two jumps. A shop's stock is **every
ship or outfit whose `techTier` ≤ the planet's `techTier`**.

## 3. Rules (pure sim code, unit-tested)

### 3.1 Ship stats (`src/sim/shipStats.ts`)
`shipStats(world, data)` returns `{ cargo, fuelCapacity, shields, armor, passengers,
outfitSpace, spaceUsed, spaceFree }` from the hull plus owned outfits. Every place
that reads a hull stat today (`cargo.ts`, `world.ts` refuel and jump fuel, `hudInfo.ts`,
`exchange.ts`, `missionComputer.ts`, `planetScreen.ts`, the controller refuel quote)
switches to it. Hull-only data (flight handling, `radius`) still reads the ship def.

### 3.2 Outfitter
- **Buy** one unit: blocked when credits < price, `spaceFree` < space, or owned = max.
  Each block has a reason string shown on screen.
- **Sell** one unit: refunds **50%** of price. Blocked when it would leave cargo used
  above the new capacity. Selling a fuel tank trims fuel to the new capacity (the
  Info panel warns how much fuel will be lost).
- **Map**: charges the price and reveals; blocked if it would reveal nothing new.

### 3.3 Shipyard
- **Trade-in value** = 75% of the current hull's price + 50% of each owned outfit's
  price (the outfits go with the old ship).
- **Net cost** = new price − trade-in (may be negative: the pilot is paid).
- **Buy** is blocked when credits < net cost, when the cargo in the hold exceeds the
  new hull's base cargo, when mission passengers exceed its berths, or when it is the
  ship already owned.
- After purchase: `shipId` changes, `outfits` is emptied, fuel is filled to the new
  capacity. Shields and armor are always at maximum (no damage until combat).

### 3.4 State and saves
- `WorldState` gains `outfits: Record<string, number>`.
- Save version **2 → 3**: adds `outfits` (default `{}`). Unknown outfit ids in a save
  raise `SaveError('unknownContent')`, the same as other unknown ids. v2 saves migrate.

### 3.5 Message fix
`MSG_TOO_CLOSE` stops hard-coding "(G)". The sim emits a `{ type: 'message', code:
'tooCloseToJump' }`; the UI renders it with the current Autopilot binding on PC
("Use autopilot (G) to fly out." with whatever key is bound, or no key text if
unbound) and "Tap Autopilot to fly out." in touch mode.

## 4. Screens

### 4.1 Planet screen
Adds **Shipyard** and **Outfitter** buttons when the planet has the service, with new
rebindable actions `openShipyard` and `openOutfitter` (planet group).

### 4.2 Shop layout (shared by both)
- **Left:** a paged icon grid. Each tile shows the icon, the name and (outfitter) the
  owned count. Page size fits the viewport, including 844×390.
- **Right:** an **Info** panel for the selected tile: description, stats (ships: cargo,
  berths, fuel, shields, armor, outfit space, speed, turn; outfits: effect, space,
  max), price, and the trade-in value / net cost (shipyard) or resale value
  (outfitter). A blocked buy shows its reason.
- **Buttons:** Buy, Sell (outfitter), Previous page, Next page, Back — each with a new
  rebindable action in a new `shop` group (`shopBuy`, `shopSell`, `shopPrevPage`,
  `shopNextPage`); Back uses the existing `back` action. Arrow keys move the selection.
- Buying a ship asks for confirmation (it is the biggest single spend).

### 4.3 Icons
- **Ships:** the same procedural renderer as flight, drawing the hull's `hull` profile
  at a fixed heading. `makeShipTextures` uses the profile too, so ships look different
  in flight.
- **Outfits:** original vector icons, one per category with a tier accent.

### 4.4 Mission destination on the map (owner request)
In the **Mission Computer** and the **Mission Log**, when a mission is highlighted,
pressing the **Map** key (the existing `openMap` binding) or a **Show on map** button
opens the star map centred on that mission's destination, with the destination marked
and the shortest route from the current system drawn as a preview (jump count shown).
The preview does not change the plotted course; the map offers **Set course** to plot it.
Closing the map returns to the same screen with the same mission still highlighted.
Unknown destinations are still marked (the mission names them). Works with touch (the
button) and keyboard (the key).

### 4.5 Always-available star map (owner request)
The owner could not find a way to open the map in flight (M on PC and a radar tap on
phone were not discoverable). The map becomes a **fixed, always-visible control**:
- **In flight, PC:** a **Map** button in the sidebar HUD (§5), showing its key.
- **In flight, phone:** a **Map** button in a rail, in the same spot every time.
  Nothing covers the game view.
- **On screens (planet, exchange, missions, shops, log):** a **Map** button in one
  fixed corner of the frame, the same place on every screen, replacing the planet
  screen's per-world "Star Map" button.
- The `map` / `openMap` hotkeys still work. The guide's map-step hints, How to Play and
  the tests are updated to point at the button.

### 4.6 Refuel at every port (owner request)
Every landable planet and station sells fuel.
- **Data:** every port gets a `fuelPrice`, and `'refuel'` is no longer a listed
  service: refuel is always offered. The 7 ports without fuel today get a price.
  Fringe and low-tier ports charge more (about 2–3× core prices), so where you fill
  up still matters.
- **Validation:** the "refuel listed exactly when fuelPrice is set" rule becomes
  "every port has a fuelPrice".
- **Towing:** this is still needed when you're stranded in space with too little fuel
  to jump. The tow destination becomes the nearest port, which now always sells fuel.
- The guide, How to Play text and tests that mention ports without fuel are updated.

## 5. PC sidebar HUD

In keyboard mode a right-hand sidebar (about 200 px) replaces the top-left status
panel. The main camera's viewport shrinks to the remaining width so the sidebar never
covers space. From top to bottom:
1. **Radar:** star, planets, the jump ring, the ship and its heading, the target
   highlighted.
2. **Shields / Armor / Fuel** bars (fuel also as jumps left).
3. **Nav:** the course destination and jumps left, or "No course".
4. **Secondary:** "None" (weapons arrive with combat).
5. **Target:** name, kind (planet/station) and distance, or "No target".
6. **Cargo free**, **credits** and the **date**.

The autopilot route banner and message line stay centred over the (narrower) game
view. The guide hint moves to the top-left of the game view. Touch mode is unchanged.
At narrow desktop widths (< 700 px wide) the sidebar is hidden and the old panel is
used.

## 6. Testing

- **Unit:** `shipStats`; outfit buy/sell rules and every block reason; map reveal;
  trade-in and net cost; ship purchase blocks; save v2 → v3 migration and unknown
  outfit ids; the too-close message in PC, rebound and touch forms; data validation
  of the new files (stock per tier, every shipyard world has stock).
- **E2E (Playwright):** highlight a mission and press the Map key: the map shows its
  destination and route, Set course plots it, closing returns to the mission;
  buy an outfit and a ship on desktop and see the new stats; the
  sidebar shows on desktop and is absent in touch; shops are usable at phone size
  844×390 with nothing off-screen.
- Existing suites stay green.

## 7. Delivery

Branch `cycle2-ships-outfits`, built task by task with a review after each task and a
final whole-branch review. Merge to `main` and deploy to GitHub Pages only after the
owner's OK.
