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
- `hull` — one of `'dart' | 'wedge' | 'hauler' | 'ring'`, the silhouette profile
- `description` (original text, 1–2 sentences)

Roster (about 8 hulls; names and numbers are tuned in the plan, all original):

| Tier | Role | Notes |
|---|---|---|
| 1 | Wayfarer Shuttle | the start ship (existing), cheap, small |
| 2 | fast courier | quick, little cargo, few berths |
| 2 | cheap freighter | slow, more cargo |
| 3 | balanced trader | the natural first upgrade |
| 3 | bulk hauler | big hold, sluggish |
| 4 | long-range runner | large fuel tank, decent hold |
| 4 | heavy freighter | very large hold |
| 5 | flagship trader | best all-round; sold only at tier-5 worlds |

Prices scale so the first upgrade takes a few successful trade runs and the tier-5
hull is a long-term goal.

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
- **E2E (Playwright):** buy an outfit and a ship on desktop and see the new stats; the
  sidebar shows on desktop and is absent in touch; shops are usable at phone size
  844×390 with nothing off-screen.
- Existing suites stay green.

## 7. Delivery

Branch `cycle2-ships-outfits`, built task by task with a review after each task and a
final whole-branch review. Merge to `main` and deploy to GitHub Pages only after the
owner's OK.
