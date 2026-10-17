# Starwake: Cycle 1 — Trade, Mission Computer and Galaxy

**Date:** 2026-10-16
**Status:** Awaiting owner review
**Builds on:** `2026-10-15-starwake-foundation-design.md` (foundation, shipped)
**Context:** `docs/design-notes.md` (original EV concept from the owner)

## 1. Purpose

The foundation can fly, land, refuel and jump between two systems, but a planet
offers nothing to do and credits only ever go down. Cycle 1 gives the player
the core EV loop: **a galaxy worth exploring, goods to trade, and jobs to take**,
so money can be earned and every landing can matter.

Owner decisions this spec follows (all "go with the recommendation"):
- About **20 systems** in three areas; grow toward 100+ in later cycles.
- Commodities: the **classic six plus a few unique local goods**; contraband later.
- Cargo in **tons**; Buy/Sell move **10 tons per press**.
- The **mission computer** (generic jobs) is part of this cycle; the Spaceport Bar
  and story missions are cycle 3.
- The beginner guide is built **after** this cycle so it can teach the whole loop.

Out of scope here: shipyard/outfitter and the PC sidebar HUD (cycle 2), bar and
story (cycle 3), combat, reputation, police, contraband, boarding.

## 2. Galaxy

### 2.1 Layout
- **20 systems** joined by **hyperlanes** (2–4 links each, the graph is connected).
- Three areas, each system has an **owner**:
  - **Concord core** (7 systems): secure, high-tech (tiers 3–5), dense trade.
  - **Free Reach frontier** (8 systems): mixed tech (2–4), farm and mining worlds.
  - **Independent fringe** (5 systems): tiers 1–2, few services, rare goods,
    some systems with no fuel.
- Existing content is kept: **Calder** becomes the start system at the edge of
  the core (Halcyon stays the start planet); **Vesk** becomes a fringe system.
- Each system has **0–4 ports** (planet, moon or station). Every port has a
  hand-written original description.

### 2.2 Governments
`data/governments.json`: `id`, `name`, `color`, `description`. Three entries:
`concord`, `free-reach`, `independent`. In this cycle they only color the map and
show in the info panel; reputation, landing rights and police come later, but the
data is in place now.

### 2.3 Jumping (replaces the foundation's "always links[0]" rule)
- A jump needs a **selected destination** that is linked to the current system.
- If no destination is selected and there is exactly one link, that link is used.
- The jump point direction is toward the selected destination's `mapPos`.
- **Each jump advances the in-game date by 1 day.** A tow advances it by the
  number of hyperlane hops between the two systems (minimum 1).

### 2.4 Exploration
- **Known systems** at the start: all Concord core systems.
- A system becomes known when you **arrive** in it, and its direct neighbours
  become **seen** (shown as a circle with a name but no details).
- Unknown systems are drawn as **blank circles** with no name; their lanes are
  drawn only if one end is known.
- (Cycle 2 adds buyable maps that reveal everything within N jumps.)

## 3. Star map

Opened with **M** / the radar button (flight) or a **Star Map** button (planet
screen). It pauses flight while open, like today's placeholder.

- **Layout:** EV style — systems are circles on lanes, colored by owner; the
  current system is marked; zoom with **+/−** buttons, mouse wheel or pinch; drag
  to pan. Visited systems are filled circles, seen-only are hollow, unknown blank.
- **Info panel** for the selected system: name, government, goods traded, services
  (union of its ports), ports list, hazards (none yet), and the **current date**.
  Unknown systems show "Unexplored".
- **Route planning:** select any known or seen system → shortest route by hops is
  highlighted, with "N jumps · fuel needed N · you have M". If fuel is short the
  text is red and the jumps that can't be reached are dashed.
- **Set course** button stores the route. In flight, the HUD shows the next hop,
  **J** jumps to it, and the context button reads "JUMP TO <NEXT>". On arrival
  the route advances; on reaching the end it clears.
- **Mission destinations** are marked on the map with a small flag.
- Phone: the map fills the screen inside the safe area; buttons are ≥ 44 px.

## 4. Time

- `day` counter in the world, starting at day 0 = **1 March 3207**.
- Displayed as `14 Mar 3207` on the map, planet screen, exchange and mission
  screens (and later the main-menu pilot card).
- Advances only on jumps and tows (§2.3). Landing, flying in-system and
  trading take no in-game time, as in EV.

## 5. Cargo hold

- `ShipDef` gains `cargo` (tons) and `passengers` (berths). Shuttle: **20 t**,
  **4 berths**.
- Hold contents: commodity tons + mission cargo tons. Passengers use berths only.
- HUD (desktop panel and phone rail) shows **Credits** and **Cargo: free/total**.
- Trade cargo and mission cargo are tracked separately; mission cargo can't be sold.

## 6. Commodity exchange

### 6.1 Goods
`data/commodities.json`: `id`, `name`, `basePrice`, `description`, optional
`origin` (port id for unique goods).
- Classic six: **Food, Industrial, Medical, Luxury, Metal, Equipment**.
- Three unique goods, each sold only at its origin port and bought at a few
  others at High: e.g. **Vesk Glowmoss**, **Halcyon Copperwine**, and one Free
  Reach good. Names and text are original.

### 6.2 Which ports trade what
Each port with the `exchange` service lists `market: { <commodityId>: "low" | "med" | "high" }`,
the **normal level** set by what kind of world it is (farm worlds sell Food low,
mining stations pay high for Food, and so on). A port trades only listed goods.

### 6.3 Price model
```
price = round(basePrice × levelMult(level) × eventMult × pressure × dailyNoise)
levelMult: low 0.75, med 1.00, high 1.30
dailyNoise: deterministic per (port, commodity, day), within ±6 %
```
- **Buy price** = price; **sell price** = price (EV-style single price).
- **Displayed level** comes from the final price relative to basePrice:
  ≤ 0.85 → Low, ≥ 1.15 → High, otherwise Med.
- **Pressure (your own trading):** each 10 t you **sell** at a port lowers that
  good's pressure there by 3 %, and each 10 t you **buy** raises it by 3 %
  (clamped 0.70–1.30). Pressure recovers 25 % of the way back to 1.0 per day.
  This removes permanent "golden routes".
- **Events:** see 6.4.

### 6.4 Market events
`data/events.json` templates: `id`, `text` (with `{port}`), `commodity`,
`effect: "surplus" | "shortage"`, `strength` (e.g. 0.6 or 1.6), `days: [min, max]`,
optional `kinds` (port kinds/areas it can hit).
- Examples: "Bumper harvest on {port} — Food is cheap" (surplus),
  "Fever outbreak on {port} — Medical in demand" (shortage).
- Each new day there is a **35 % chance** a new event starts at a random port
  that trades that good; at most **4** active at once; no two on the same
  port+good.
- `eventMult` ramps: full strength for the first half of the duration, then fades
  linearly to 1.0.
- **News:** the exchange screen shows the local event (if any) in a notice line.
  The mission computer shows one **rumor** about another active event within 4
  jumps ("Traders say {port} is short of Medical").

### 6.5 Exchange screen (EV layout)
A panel over the planet screen: table of **Commodity · In hold · Level · Price**,
row selection, buttons **Buy 10**, **Sell 10**, **Buy max**, **Sell all**, **Done**.
Shift-click / long-press on Buy/Sell moves **1 t**. Shows credits, cargo free,
the date and the local news line. Buying is limited by credits and free cargo;
messages explain why a button does nothing ("Hold full", "Not enough credits").
Unique goods show their description on selection. Hotkeys: arrows select,
**B** buy, **S** sell, **Esc** done (all in a new *Exchange* bindings group).

## 7. Mission computer

### 7.1 Mission types (`data/missionTypes.json`)

| Type | Carries | Hops | Deadline | Pay | Notes |
|---|---|---|---|---|---|
| Ferry passengers | 1–4 passengers (berths) | 1–4 | hops × 3 days | medium | — |
| Rush delivery | 1–5 t | 1–2 | hops + 1 day | high per t | late = fail |
| Cargo transport | 8–15 t | 2–4 | hops × 2 + 2 | medium | — |
| Cargo shipment | 20–40 t | 3–6 | hops × 3 + 3 | high total | needs a bigger hold (cycle 2) |
| Cargo delivery | 2–10 t | 1 | 4 days | low | easy local work |
| Dump garbage | 5–15 t | to a port flagged `dumpSite` | none | low, **paid up front** | — |

Pay formula (per type: `basePay`, `perHop`, `perTon`, `perPassenger`, `urgency`):
`pay = (basePay + perHop × hops + perTon × tons + perPassenger × pax) × urgency`, rounded to the nearest 10 credits.

### 7.2 Offers
- Ports with the `missions` service show **3–7 offers**, generated
  deterministically from (pilot seed, port, day). The list refreshes when the
  day changes; leaving and re-landing the same day shows the same list.
- Destinations are ports that exist, are reachable by lanes, and (for rush)
  are within 2 hops. Offers you can't currently take (not enough free cargo or
  berths) are still listed, with the reason shown and **Accept** disabled.
- Text is generated from templates with the destination, cargo name and pay,
  in the EV voice: "A group of settlers ask to be taken to Tallow Rock in the
  Vesk system, in return for 4,200 credits."

### 7.3 Accepting, completing, failing
- At most **8 active missions**. Accepting reserves the cargo tons / berths.
- **Completion:** landing at the destination port before or on the deadline
  completes it automatically: a dialog lists completed missions and pay;
  credits are added; cargo/berths freed.
- **Failure:** when a jump moves the date past a deadline, the mission fails, a
  message says so, the cargo/berths are freed, and no pay is given.
- **Abandon** from the mission log: confirm dialog; cargo freed, no pay
  (garbage pay already received is kept — it's dumped "somewhere").
- **Mission log** (from the planet screen, pause menu and hotkey **K**): active
  missions with destination, deadline (and days left), cargo and pay; a
  "Show on map" link.

## 8. Planet screen and services

- Ports gain `services: ("refuel" | "exchange" | "missions")[]` (cycle 2/3 add
  `outfitter`, `shipyard`, `bar`). Only listed services show as buttons —
  each port has its own mix, as in EV.
- Button order: **Commodity Exchange**, **Mission Computer**, **Refuel**,
  **Star Map**, **Mission Log**, **Leave**. Hotkeys in the Planet group:
  **C** exchange, **M** missions, **R** refuel, **N** star map, **K** log,
  **L / Esc** leave.
- Planet screen shows the date and cargo free beside credits and fuel.
- The start planet Halcyon has exchange + missions + refuel, so there is
  something to do from the first landing.

## 9. Data and code shape

- New data files: `governments.json`, `commodities.json`, `events.json`,
  `missionTypes.json`; extended `systems.json` (owner, links, mapPos),
  `planets.json` (`services`, `market`, `dumpSite`), `ships.json` (`cargo`,
  `passengers`). All validated by Zod, with cross-references checked
  (market goods exist, mission destinations exist, unique-good origins exist,
  lane graph connected and symmetric).
- New pure sim modules (no Phaser/DOM): `calendar`, `economy` (prices, pressure,
  events), `missions` (generation, accept/complete/fail), `galaxy` (known/seen,
  routes by BFS), `cargo`. Randomness uses a **seeded RNG** stored in the save
  (`seed`) so everything is reproducible and testable.
- World state gains: `day`, `cargo`, `missions`, `route`, `known`, `seen`,
  market `pressure` and active `events`, `seed`.

## 10. Saves

- `CURRENT_SAVE_VERSION` becomes **2**. Migration 1 → 2 adds: `day: 0`,
  `cargo: {}`, `missions: []`, `route: []`, `known`: core systems plus the saved
  system, `seen`: their neighbours, `pressure: {}`, `events: []`, `seed`: random.
- Existing v1 pilots load into the new galaxy at their saved planet (Calder and
  Vesk ports keep their ids).
- Saves still happen landed; all new state is included.

## 11. Error handling and edge cases

- Data errors use the existing file → path → message screen.
- Buy/sell can never leave credits below 0 or cargo above capacity; a pilot in
  debt can sell but not buy.
- A mission whose destination becomes unreachable (not possible with static
  data, but guarded) fails with a message instead of crashing.
- Tow into a system completes missions only on landing at the right port.
- Route planning with no path shows "No known route".
- Long numbers format with separators (`10,000`).

## 12. Testing and definition of done

**Unit (Vitest):** calendar formatting; price formula incl. levels, noise
bounds, pressure apply/recover, event ramp/fade, display level thresholds;
event spawning limits (≤ 4, no duplicates) with a fixed seed; buy/sell limits
(credits, cargo, debt); mission generation determinism for (seed, port, day),
destination validity, pay formula, capacity checks; accept/complete/fail/abandon;
deadline failure on jump; dump-garbage paid up front; route BFS and fuel check;
known/seen updates on arrival; jump to selected destination; save migration
1 → 2 and v2 round-trip; data validation of all new files.

**Browser (Playwright):** new pilot → open exchange at Halcyon → buy 10 Food →
fly → jump along a planned route → sell at a port where Food is High → credits
went up; accept a cargo delivery → land at destination → paid; star map opens,
shows unknown circles, plans a route; phone layout: exchange and mission
screens fit at 844×390 with no horizontal scroll.

**Owner check:** play the loop on PC and phone: make money from trade and
missions, explore the fringe, plan a multi-jump route.
