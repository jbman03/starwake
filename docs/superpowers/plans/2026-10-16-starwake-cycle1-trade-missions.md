# Starwake Cycle 1 (Trade, Mission Computer, Galaxy) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the foundation into a playable EV loop: a 20-system galaxy with exploration and route planning, an in-game date, a cargo hold, a commodity exchange with moving prices and events, and a mission computer with six job types.

**Architecture:** All new rules are pure TypeScript in `src/sim` (seeded RNG, calendar, galaxy, economy, cargo, missions) wired into `stepWorld`'s jump/arrival path and exposed to the UI through small `Controller` methods. New screens are HTML overlays in `src/ui` following the existing `ctx.mount` pattern. Content is JSON in `data/`, validated by Zod with cross-reference checks. Saves migrate v1 → v2.

**Tech Stack:** existing — TypeScript strict, Phaser 4, Vite, Vitest (+ happy-dom), Playwright, Zod, idb-keyval.

**Spec:** `docs/superpowers/specs/2026-10-16-starwake-cycle1-trade-missions-design.md`

## Global Constraints

- All names, descriptions and goods are original; no Escape Velocity text or names (EV mechanics only).
- `src/sim` must not import Phaser, DOM, or anything from `src/render` / `src/ui`. Randomness in sim comes only from the seeded RNG (`src/sim/random.ts`) — never `Math.random`.
- Every new player action gets an `ActionId` with a default hotkey and is rebindable (Escape must stay on `pause` and `back`).
- Phone: nothing new may cover the clear game-view region in flight; new screens fit 844×390 without horizontal scroll; buttons ≥ 44 px.
- Exact values from the spec: levelMult low 0.75 / med 1.00 / high 1.30; dailyNoise within ±6 %; display level ≤ 0.85 Low, ≥ 1.15 High; pressure 3 % per 10 t, clamp 0.70–1.30, recovers 25 % toward 1.0 per day; event chance 35 %/day, ≤ 4 active, no duplicate port+good; ≤ 8 active missions; 3–7 offers per port; shuttle cargo 20 t, 4 berths; day 0 = 1 Mar 3207; 1 day per jump; Buy/Sell 10 t per press, 1 t with Shift/long-press.
- Credits may be negative only via tow; trading never pushes credits below 0; a pilot in debt can sell but not buy.
- Save version becomes 2; v1 saves must load.

## Review Focus

1. **Mission deadline crossed by a multi-day tow** → each overdue mission fails exactly once with one message; cargo freed. Test in Task 7.
2. **Landing at a port that completes several missions at once while the hold also holds trade goods** → all completed, pay summed, trade goods untouched. Test in Task 7.
3. **Repeated buy/sell spam at one port in one day** → price moves by pressure but never below 0.70× / above 1.30× base contribution; credits never negative. Test in Task 6.
4. **Old v1 pilot saved at Vesk Outpost with a route-less world** → loads into v2 at the same port with known/seen set and no crash on the map. Test in Task 8.
5. **Jump with a route whose next hop isn't linked (stale route after a data change)** → route cleared with a message, no jump, no fuel charged. Test in Task 4.

---

## File Structure

```
data/governments.json  data/commodities.json  data/events.json  data/missionTypes.json   (new)
data/systems.json  data/planets.json  data/ships.json  data/config.json                (extended)
src/data/schemas.ts  src/data/load.ts                                               (extended)
src/sim/random.ts      seeded RNG + string hash
src/sim/calendar.ts    day ↔ date text
src/sim/galaxy.ts      known/seen reveal, BFS routes, fuel check
src/sim/economy.ts     prices, levels, pressure, events, daily tick, rumors
src/sim/cargo.ts       hold accounting, buy/sell
src/sim/missions.ts    offer generation, accept/complete/fail/abandon
src/sim/types.ts  src/sim/world.ts  src/sim/rules.ts  src/sim/context.ts             (extended)
src/save/pilot.ts      v2 schema + migration 1→2
src/app/controller.ts  trade/mission/route wrappers, completion on landing
src/input/actions.ts  src/input/bindings.ts                                         (new actions/group)
src/ui/starMap.ts      replaces src/ui/mapPlaceholder.ts
src/ui/exchange.ts  src/ui/missionComputer.ts  src/ui/missionLog.ts                 (new)
src/ui/planetScreen.ts  src/ui/pauseMenu.ts  src/ui/rails.ts  src/render/hudInfo.ts  src/render/hud.ts
tests/e2e/trade-loop.spec.ts  tests/e2e/screens-phone.spec.ts
```

---

### Task 1: Data model, validation and seeded RNG

**Files:**
- Create: `src/sim/random.ts`, `src/sim/random.test.ts`
- Modify: `src/data/schemas.ts`, `src/data/load.ts`, `src/data/load.test.ts`, `data/ships.json`, `data/systems.json`, `data/planets.json`
- Create: `data/governments.json`, `data/commodities.json`, `data/events.json`, `data/missionTypes.json` (minimal valid content: the 6 classic goods, 3 governments, 4 events, the 6 mission types; full galaxy content is Task 2)

**Interfaces:**
- Produces (`schemas.ts`):
  - `ShipDef` + `cargo: number`, `passengers: number`.
  - `SystemDef` + `government: string`, `hazards?: string[]` (links/mapPos as today).
  - `PlanetDef` + `services: ('refuel'|'exchange'|'missions')[]`, `market?: Record<string, 'low'|'med'|'high'>`, `dumpSite?: boolean`. Rule: `services` includes `'refuel'` iff `fuelPrice` is set; includes `'exchange'` iff `market` is non-empty.
  - `GovernmentDef { id; name; color: string /*#rrggbb*/; description }`
  - `CommodityDef { id; name; basePrice: number; description; origin?: string /*port id*/ }`
  - `EventDef { id; text /*contains {port}*/; commodity: string; effect: 'surplus'|'shortage'; strength: number; days: [number, number] }`
  - `MissionTypeDef { id; name; hops: [number, number]; tons: [number, number]; passengers: [number, number]; deadline: { perHop: number; plus: number } | null; basePay; perHop; perTon; perPassenger; urgency: number; paidUpfront: boolean; toDumpSite: boolean; titleTemplate: string; textTemplate: string }`
  - `GameConfig` + `knownAtStart: string[] /*system ids*/`, `startYear: 3207`, `startMonth: 3`, `startDay: 1`.
  - `GameData` + `governments`, `commodities`, `events`, `missionTypes` (Records by id).
- Cross-reference checks in `parseGameData` (format `"<file> → <path>: <message>"`): system `government` exists; links symmetric (A lists B ⇔ B lists A); lane graph connected; market keys are commodity ids; commodity `origin` is a port with that good at `low`; event `commodity` exists; services/fuelPrice/market rule above; `knownAtStart` ids exist; at least one `dumpSite` port when a `toDumpSite` mission type exists.
- `src/sim/random.ts`: `hashString(...parts: (string|number)[]): number` (32-bit FNV-1a over `parts.join('|')`), `mulberry32(seed: number): () => number` ([0,1)), `randInt(r, min, max)` inclusive, `pick<T>(r, list: readonly T[]): T`.

- [ ] **Step 1: Write failing tests:** random — same seed ⇒ same sequence; `randInt(r,1,3)` only yields 1..3 over 1000 draws; `hashString('a',1) !== hashString('a',2)`. load — shipped data passes; asymmetric link fails with `"systems.json → <id>.links: link to <other> is not mirrored"`; disconnected system fails `"systems.json → <id>: unreachable from <start>"`; market key `"spice"` fails `"planets.json → <id>.market.spice: unknown commodity"`; port with `fuelPrice` but no `refuel` service fails.
- [ ] **Step 2:** Run → FAIL. Implement. Update existing data to satisfy the new rules (Calder ports get `services`/`market`; Halcyon: `["refuel","exchange","missions"]`). Run full `npm test` + typecheck → PASS.
- [ ] **Step 3: Commit** `feat(data): cycle 1 data model, validation and seeded RNG`

---

### Task 2: Galaxy content (20 systems)

**Files:**
- Modify: `data/systems.json`, `data/planets.json`, `data/commodities.json`, `data/events.json`, `data/missionTypes.json`, `data/config.json`, `src/data/load.test.ts`

**Interfaces:**
- Consumes: Task 1 schemas.
- Content rules (from spec §2, §6, §7):
  - 20 systems: 7 `concord` (tech 3–5), 8 `free-reach` (2–4), 5 `independent` (1–2). Keep `calder` (concord, start, at the core's edge) and `vesk` (independent) with their existing ports and ids. 2–4 links each; `mapPos` laid out so concord is a cluster, free-reach wraps one side, independents are the far edge; no two systems closer than 60 map units.
  - 0–4 ports per system (≥ 30 ports total), each with an original 1–3 sentence description in the existing voice. Concord ports mostly have all three services; fringe ports often only refuel or nothing; at least 2 fringe systems sell no fuel; ≥ 2 `dumpSite` stations.
  - Markets reflect world type (farm → Food low, Equipment high; mining → Metal low, Food high; core industry → Industrial/Equipment low, Luxury high, etc.). Every classic good is `low` somewhere and `high` somewhere within 3 hops.
  - Unique goods: `glowmoss` (origin `tallow-rock` in Vesk), `copperwine` (origin `halcyon`), one Free Reach good of the implementer's invention. basePrice for unique goods 400–900; classic 80–500.
  - `events.json`: 10–14 events covering every classic good with both surplus (strength 0.55–0.7) and shortage (1.5–1.9), days 3–8.
  - `missionTypes.json`: the 6 types with the spec's table values; templates with `{dest}`, `{system}`, `{cargo}`, `{pay}`, `{tons}`, `{pax}`, `{days}` placeholders; original phrasing.
  - `config.json`: `knownAtStart` = the 7 concord ids.
- [ ] **Step 1: Write failing tests** in `load.test.ts`: exactly 20 systems with the 7/8/5 split; ≥ 30 ports; every classic good has a `low` port and a `high` port; ≥ 2 systems with no fuel port; ≥ 2 dump sites; all descriptions non-empty and unique.
- [ ] **Step 2:** Run → FAIL. Author the content. Run → PASS (full suite).
- [ ] **Step 3: Commit** `feat(data): 20-system galaxy, markets, events and mission types`

---

### Task 3: Calendar and galaxy navigation

**Files:**
- Create: `src/sim/calendar.ts`, `src/sim/calendar.test.ts`, `src/sim/galaxy.ts`, `src/sim/galaxy.test.ts`

**Interfaces:**
- Produces:
  - `formatDate(day: number, cfg: GameConfig): string` → `"1 Mar 3207"` for day 0, `"14 Mar 3207"` for day 13, `"1 Apr 3207"` for day 31 (Gregorian month lengths; use `Date.UTC` on the configured year).
  - `routeBetween(data: GameData, fromId: string, toId: string, allowed: (id: string) => boolean): string[] | null` — BFS by hops over lanes; returns hops excluding `fromId`, including `toId`; intermediate systems must satisfy `allowed`; `[]` when from === to.
  - `revealOnArrival(known: readonly string[], seen: readonly string[], data, systemId): { known: string[]; seen: string[] }` — adds system to known, its neighbours to seen (seen never contains known ids).
  - `fuelCheck(fuel: number, hops: number, cfg): { needed: number; have: number; reachable: number }` (`reachable` = how many hops the fuel covers).
  - `hopDistance(data, a, b): number` (BFS over all systems; Infinity if none).
- [ ] **Step 1: Write failing tests:** the three date examples plus day 365 → `"1 Mar 3208"`; route through only-known systems vs none when a gap is unknown; route excludes start; reveal adds neighbours to seen and removes newly known from seen; fuelCheck with fuel 250 / 3 hops ⇒ reachable 2.
- [ ] **Step 2:** Run → FAIL. Implement. Run → PASS.
- [ ] **Step 3: Commit** `feat(sim): calendar and galaxy routing`

---

### Task 4: World state v2 — date, routes, exploration, selected-destination jumps

**Files:**
- Modify: `src/sim/types.ts`, `src/sim/world.ts`, `src/sim/rules.ts`, `src/sim/context.ts`, their tests

**Interfaces:**
- Consumes: Tasks 1, 3.
- Produces (`types.ts`):
  - `Level = 'low'|'med'|'high'`
  - `MarketEvent { templateId; portId; commodityId; startDay; days; strength }`
  - `Mission { id; typeId; originId; destId; tons; passengers; pay; paidUpfront: boolean; deadlineDay: number | null; title; description; cargoName }`
  - `WorldState` + `day: number; seed: number; cargo: Record<string, number>; missions: Mission[]; route: string[]; known: string[]; seen: string[]; pressure: Record<string, number> /* key "port:commodity", absent = 1 */; events: MarketEvent[]`
  - `SimEvent` + `{ type: 'arrived'; systemId: string; day: number }`
- `newWorld(data, seed?: number)`: day 0, empty cargo/missions/route/pressure/events, `known` = `config.knownAtStart` ∪ start system, `seen` from `revealOnArrival`, `seed` = given or `hashString(Date.now())` — note: the only non-deterministic call, in `newWorld`'s default argument, not in sim logic.
- `jumpDestination(world, data)` (rules.ts): `route[0]` if it is linked from the current system; else the single link if exactly one; else `null`. `canJump` gains reason `'noDestination'`; message `MSG_NO_DESTINATION = 'Choose a destination on the star map (M).'`. If `route[0]` exists but isn't linked: clear `route`, message `MSG_ROUTE_BROKEN = 'Course no longer valid — plot a new one on the star map.'`, no jump, no fuel.
- On jump arrival (existing `arriveFromJump` path): `day += 1`; `route` drops its first hop if it equals the arrival system; `known/seen` via `revealOnArrival`; emit `arrived`. Economy/mission day effects are added in Tasks 5 and 7 via a single `advanceDays(world, data, n)` hook created here as an identity function in `world.ts` and called with `n=1` on jump and `n=max(1, hopDistance)` on tow.
- `contextAction` 'jump' requires a non-null `jumpDestination`; context label (rails) "JUMP TO <NAME>" uses it (update `contextLabel` in `src/ui/rails.ts`).
- `setRoute(world, data, toSystemId): { world; ok: boolean; reason?: 'noRoute' }` (world.ts) using `routeBetween` with `allowed = known ∪ seen`.
- [ ] **Step 1: Write failing tests:** jump with no route and 2 links → `noDestination` message, no fuel; route [vesk] from calder → arrives vesk, day 1, route [], vesk known, vesk neighbours seen; 3-hop route followed by 3 jumps; stale route (Review Focus 5); tow from a fringe system 3 hops from the destination → day += 3; `setRoute` to an unknown-and-unseen system → `noRoute`.
- [ ] **Step 2:** Run → FAIL. Implement (update existing tests that assumed `links[0]`). Run → PASS.
- [ ] **Step 3: Commit** `feat(sim): date, routes, exploration and destination jumps`

---

### Task 5: Economy — prices, pressure, events, rumors

**Files:**
- Create: `src/sim/economy.ts`, `src/sim/economy.test.ts`
- Modify: `src/sim/world.ts` (`advanceDays` calls `economyDay` per day)

**Interfaces:**
- Produces:
  - `LEVEL_MULT = { low: 0.75, med: 1.0, high: 1.3 }`
  - `dailyNoise(seed, portId, commodityId, day): number` in [0.94, 1.06] from `hashString`.
  - `eventMult(world, portId, commodityId): number` — strength for the first half of `days` (from `startDay`), then linear fade to 1.0 at `startDay + days`.
  - `priceOf(world, data, portId, commodityId): number | null` (null if not traded) = round(base × levelMult × eventMult × pressure × noise).
  - `displayLevel(price, basePrice): Level` (≤ 0.85 low, ≥ 1.15 high).
  - `applyPressure(world, portId, commodityId, tonsBought: number /* negative = sold */): WorldState` — ±3 % per 10 t (pro-rata), clamp [0.70, 1.30].
  - `economyDay(world, data): WorldState` — pressure moves 25 % toward 1.0 (delete key when |p−1| < 0.005); expire finished events; with probability 0.35 (rng from `hashString(seed,'event',day)`) spawn one event from a random template at a random port trading that good, respecting ≤ 4 active and no duplicate port+good.
  - `localNews(world, data, portId): string | null` — text of an active event at this port.
  - `rumor(world, data, portId): string | null` — "Traders say {port} is {short of / flooded with} {good}." for an active event at another port within 4 hops (deterministic pick by day).
- [ ] **Step 1: Write failing tests:** level multipliers; noise bounds over 500 samples; event ramp (full at day+1, ~half-faded at 75 %, 1.0 at end); pressure: sell 40 t → 0.88, sell 200 t → 0.70 clamp, then 1 day → 0.91 recovery; economyDay with fixed seed over 60 days never exceeds 4 events and never duplicates port+good; displayLevel thresholds.
- [ ] **Step 2:** Run → FAIL. Implement. Run → PASS.
- [ ] **Step 3: Commit** `feat(sim): commodity prices, pressure and market events`

---

### Task 6: Cargo hold and trading

**Files:**
- Create: `src/sim/cargo.ts`, `src/sim/cargo.test.ts`

**Interfaces:**
- Produces:
  - `cargoUsed(world): number` (trade tons + mission tons), `cargoFree(world, data): number`, `berthsFree(world, data): number`.
  - `buy(world, data, portId, commodityId, tons): { world; tons: number; cost: number; reason?: 'notTraded'|'holdFull'|'noCredits' }` — buys up to `tons`, limited by free cargo and `floor(credits / price)`; credits never below 0; applies pressure.
  - `sell(world, data, portId, commodityId, tons): { world; tons; revenue; reason?: 'notTraded'|'noneHeld' }`.
  - `maxBuy(world, data, portId, commodityId): number`.
- [ ] **Step 1: Write failing tests:** buy 10 Food with 20 t free → 10 t, credits −cost; buy 30 with 20 free → 20 + `holdFull` only when 0 bought; credits −300 → `noCredits`, 0 bought; sell more than held → sells held; mission cargo counts against hold; Review Focus 3 (50 alternating buy/sell presses: credits never < 0, pressure within clamp).
- [ ] **Step 2:** Run → FAIL. Implement. Run → PASS.
- [ ] **Step 3: Commit** `feat(sim): cargo hold and trading`

---

### Task 7: Missions

**Files:**
- Create: `src/sim/missions.ts`, `src/sim/missions.test.ts`
- Modify: `src/sim/world.ts` (`advanceDays` calls `failOverdue` per day; returns failed missions as `{ type: 'message' }` SimEvents: `"Mission failed: <title> — the deadline passed."`)

**Interfaces:**
- Produces:
  - `MAX_MISSIONS = 8`
  - `MissionOffer = Omit<Mission, 'id'> & { offerId: string }`
  - `offersAt(world, data, portId): MissionOffer[]` — 3–7 offers from `mulberry32(hashString(seed, portId, day))`; destination ports per type rules (hops within range via `hopDistance` over ALL systems, excluding the origin system for hops ≥ 1; `toDumpSite` → nearest-first dump site); deadline = `day + perHop × hops + plus` (null when type deadline null); pay = `(basePay + perHop×hops + perTon×tons + perPassenger×pax) × urgency` rounded to nearest 10; title/description from templates.
  - `canAccept(world, data, offer): { ok: true } | { ok: false; reason: 'tooMany'|'noSpace'|'noBerths' }`
  - `accept(world, data, offer): WorldState` — adds `Mission` with id `offer.offerId`; paidUpfront adds pay now. Accepting the same offer twice is a no-op.
  - `completeAt(world, portId): { world; completed: Mission[]; pay: number }` — all missions whose `destId === portId` (and not overdue).
  - `failOverdue(world): { world; failed: Mission[] }` — missions with `deadlineDay !== null && day > deadlineDay`.
  - `abandon(world, missionId): WorldState` — frees cargo/berths, no pay; upfront pay (garbage) is kept.
  - `offersAt` hides offers already accepted (by offerId).
- [ ] **Step 1: Write failing tests:** determinism (same seed/port/day ⇒ identical offers; next day differs); 3–7 offers; rush destinations within 2 hops; garbage pays upfront and goes to a dump site; pay formula example from fixture numbers; canAccept reasons; Review Focus 1 (tow advances 3 days past two deadlines ⇒ each fails once, one message each); Review Focus 2 (two missions to the same port + 10 t Food: both complete, pay summed, Food kept).
- [ ] **Step 2:** Run → FAIL. Implement. Run → PASS.
- [ ] **Step 3: Commit** `feat(sim): mission computer jobs`

---

### Task 8: Save v2 and controller integration

**Files:**
- Modify: `src/save/pilot.ts`, `src/save/pilot.test.ts`, `src/app/controller.ts`, `src/app/controller.test.ts`, `src/save/transfer.ts` (if schema use changes)

**Interfaces:**
- `CURRENT_SAVE_VERSION = 2`; `PilotSaveSchema` v2 adds the WorldState v2 fields (`day, seed, cargo, missions, route, known, seen, pressure, events`). `migrations[1]` fills defaults: `day 0`, `seed = hashString(id)`, empty collections, `known = config.knownAtStart ∪ {systemId}` — migration needs `GameData`, so `upgradeSave(raw)` stays data-free and fills `known: []`, and `worldFromPilot` repairs empty `known` using data (documented).
- `pilotFromWorld` / `worldFromPilot` carry all v2 fields.
- Controller additions (thin wrappers that replace `this.world`, emit `contextChanged`, and never save by themselves):
  - `buy(commodityId, tons)`, `sell(commodityId, tons)` → the cargo.ts result.
  - `offers(): MissionOffer[]` (at `landedPlanetId`), `acceptMission(offerId)`, `abandonMission(id)`.
  - `plotRoute(systemId)` → `setRoute` result; `clearRoute()`.
  - On landing (`landAt`): run `completeAt`; if any completed, emit `{ type: 'missionsCompleted'; missions: Mission[]; pay: number }` BEFORE autosave so the save includes the pay.
  - `ControllerEvent` + `missionsCompleted`.
- [ ] **Step 1: Write failing tests:** v1 → v2 migration loads at the same port (Review Focus 4 using a v1 Vesk Outpost save); v2 round trip; controller: accepting then landing at the destination emits `missionsCompleted` and the autosaved pilot has the pay; buy/sell via controller updates world.
- [ ] **Step 2:** Run → FAIL. Implement. Run → PASS.
- [ ] **Step 3: Commit** `feat: save v2 and controller trade/mission/route API`

---

### Task 9: Actions, hotkeys and the star map

**Files:**
- Modify: `src/input/actions.ts`, `src/input/bindings.ts`, `src/ui/hotkeyEditor.ts` (new group title), tests
- Create: `src/ui/starMap.ts`, `src/ui/starMap.test.ts`; delete `src/ui/mapPlaceholder.ts` (move its tests)
- Modify: `src/ui/context.ts` (`go.map` → star map), `src/ui/planetScreen.ts` (Star Map button), `src/render/hudInfo.ts` (next-hop line), `tests/e2e/*` that referenced the placeholder

**Interfaces:**
- New ActionIds: planet group `openExchange` (KeyC), `openMissions` (KeyM), `openMap` (KeyN), `missionLog` (KeyK); flight group `missionLog` can't share an id across groups, so use `flightMissionLog` (KeyK); new group `'exchange'` with `buyGoods` (KeyB), `sellGoods` (KeyS) — `back` (Escape, menus) closes screens as today. Labels in `ACTION_LABEL`. Hotkey editor shows an "Exchange" section.
- `showStarMap(ctx, opts?: { onClose?: () => void })`: SVG map (systems as circles colored by government; filled = known, hollow = seen, blank grey = unknown; lanes where an end is known/seen; current system ring; route polyline; mission destination flags), zoom buttons + wheel + pinch, drag to pan, info panel (name, government, goods traded, services union, ports, hazards, date; "Unexplored" for unknown), route text `"N jumps · fuel needed N · you have M"` (red when short), **Set course** / **Clear course** buttons → controller `plotRoute`/`clearRoute`. Pure helpers exported for tests: `mapModel(world, data): { nodes: {id,name|null,state:'known'|'seen'|'unknown',color,x,y,current:boolean,flag:boolean}[]; lanes: [string,string][] }`.
- HUD (`hudInfo`) adds `nextHop: string | null` → desktop HUD line "Course: Vesk (2 jumps)" and rail HUD equivalent.
- [ ] **Step 1: Write failing tests:** `mapModel` hides names of unknown systems and lanes between two unknown systems; flags for mission destinations; new actions have defaults and no same-group conflicts; e2e: open map with M in flight → unknown circles present → select a known system → Set course → J jumps toward it.
- [ ] **Step 2:** Run → FAIL. Implement. Run → PASS (full unit + e2e).
- [ ] **Step 3: Commit** `feat(ui): star map with exploration and route planning`

---

### Task 10: Planet services and the commodity exchange screen

**Files:**
- Modify: `src/ui/planetScreen.ts`, `src/ui/styles.css`, tests
- Create: `src/ui/exchange.ts`, `src/ui/exchange.test.ts`

**Interfaces:**
- Planet screen: buttons only for the port's `services` plus Star Map, Mission Log, Leave, in the spec's order, with planet-group hotkeys; shows date and `Cargo: free/total` beside credits and fuel.
- `showExchange(ctx, portId, onClose)`: table rows `Commodity · In hold · Level · Price`, selection by click/arrow keys, **Buy 10 / Sell 10 / Buy max / Sell all / Done**, Shift-click or long-press (≥ 450 ms) = 1 t; reason line for zero-result presses ("Hold full", "Not enough credits", "You have none to sell"); local news line; unique-good description on selection; date, credits, cargo free. Uses the `exchange` input group for B/S and `back` to close.
- [ ] **Step 1: Write failing tests (happy-dom):** Halcyon screen shows Commodity Exchange and Mission Computer; a fringe refuel-only port shows only Refuel/Star Map/Mission Log/Leave; exchange Buy 10 changes "In hold" and credits; Buy with full hold shows "Hold full"; long-press buys 1.
- [ ] **Step 2:** Run → FAIL. Implement. Run → PASS.
- [ ] **Step 3: Commit** `feat(ui): per-port services and commodity exchange`

---

### Task 11: Mission computer, mission log and HUD cargo

**Files:**
- Create: `src/ui/missionComputer.ts`, `src/ui/missionLog.ts`, tests
- Modify: `src/ui/planetScreen.ts` (completion dialog on `missionsCompleted`), `src/ui/pauseMenu.ts` (Mission Log button), `src/ui/context.ts`, `src/render/hudInfo.ts` + `src/render/hud.ts` + `src/ui/rails.ts` (Credits and `Cargo free/total` lines; rail HUD must stay inside the left rail)

**Interfaces:**
- `showMissionComputer(ctx, portId, onClose)`: EV layout — list of offer titles (left), selected offer's title + description + "Pays N cr · Deadline 14 Mar 3207 (5 days)" + cargo/pax needs (right), **Accept Mission** (disabled with reason text from `canAccept`), **Done**; the rumor line from `rumor()`; date.
- `showMissionLog(ctx, onClose)`: active missions with destination (port, system), deadline/days left, cargo/pax, pay; **Show on map** (opens star map with that system selected), **Abandon** (confirm dialog).
- Completion dialog text: `"Mission complete: <title>"` per mission + `"Paid N cr."` total.
- [ ] **Step 1: Write failing tests (happy-dom):** computer lists 3–7 offers, accept moves one into the log and reduces cargo free; a 20–40 t shipment shows Accept disabled with "Not enough cargo space"; abandon removes it; completion dialog lists pay; HUD info includes credits and cargo text.
- [ ] **Step 2:** Run → FAIL. Implement. Run → PASS.
- [ ] **Step 3: Commit** `feat(ui): mission computer, mission log and cargo HUD`

---

### Task 12: End-to-end loop and phone layout

**Files:**
- Create: `tests/e2e/trade-loop.spec.ts`, `tests/e2e/screens-phone.spec.ts`
- Modify: README (new controls: C/M/N/K/B/S, star map), `tests/e2e/helpers.ts` as needed

**Interfaces:** none new.
- [ ] **Step 1: Write e2e tests:**
  - trade loop (desktop): new pilot → Commodity Exchange → buy 10 of a good that is `low` at Halcyon → Done → Leave → open star map → set course to a known system whose port lists that good `high` (pick via `window.__starwake.data`) → fly out (autopilot) and jump along the route → land at that port → sell all → credits greater than the start minus fuel costs; no console errors.
  - missions: accept a Cargo delivery at Halcyon → fly to its destination → land → completion dialog shows pay → credits increased.
  - phone (844×390, touch): exchange, mission computer, mission log and star map each have no horizontal scroll (`scrollWidth <= clientWidth`), all buttons ≥ 44 px tall, and in flight the HUD credits/cargo lines are inside the left rail.
- [ ] **Step 2:** Run → fix anything they reveal (in the owning module, with a unit test where practical). Full `npm test`, typecheck, build, e2e → PASS.
- [ ] **Step 3: Commit** `test: cycle 1 end-to-end trade and mission loop`
