# Starwake Cycle 2: Shipyard, Outfitter and PC Sidebar HUD — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pilots can buy better ships (with trade-in) and outfits, sold by tech tier and faction at tech hubs. Fuel is sold at every port, the map is always one tap or click away, a highlighted mission can be previewed on the map, and PC players get an EV-style right sidebar HUD.

**Architecture:**
- **Content:** new data lives in `data/*.json` and is validated by zod plus cross-checks in `src/data/load.ts`.
- **Rules:** pure functions in `src/sim/` (new `shipStats.ts`, `outfitter.ts`, `shipyard.ts`), unit-tested with Vitest. `WorldState` gains `outfits`, and saves move to v3.
- **Screens:** UI is HTML screens in `src/ui/` mounted through `UiContext`. Both shops share one `shop.ts` grid and Info panel.
- **HUD:** the Phaser HUD (`src/render/hud.ts`) gains a sidebar mode, and `SpaceScene` narrows the camera to leave room for it.

**Tech Stack:** TypeScript (strict), Phaser 4.2.1, zod 4, Vite, Vitest + happy-dom, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-17-starwake-cycle2-ships-outfits-design.md` (read it with this plan; § numbers below refer to it).

## Global Constraints

- All names, descriptions and art are original. No EV names or text.
- Every new action gets a rebindable hotkey in `src/input/actions.ts` + `DEFAULT_BINDINGS`, labelled in `ACTION_LABEL`, and appears in the hotkey editor.
- Phone rule: in flight, nothing may cover the clear game view except the bottom context button. New flight controls go in the rails.
- The layout must work at phone size 844×390, with nothing off-screen.
- Work happens on branch `cycle2-ships-outfits`. Don't merge or deploy without the owner's OK.
- Usage pacing: check `get_usage` between tasks and spread work evenly across the days to the weekly reset. Stop only at task boundaries.
- Commands: `npm test` (Vitest), `npm run typecheck`, `npm run test:e2e` (Playwright, needs a build or dev server per `playwright.config`).
- Defaults for the owner's open questions (spec §8):
  - fringe and tier 1–2 fuel costs 2× core
  - trade-in is 75% of hull price + 50% of outfits
  - the shuttle is the starter
  - no weapons and no escape pod in this cycle
  - the local chart reveals 4 jumps

## Review Focus

1. **Saves from before cycle 2.** A v2 save with cargo and missions loads as v3 with `outfits: {}` and plays on. A save naming an unknown outfit id gives `SaveError('unknownContent')`. A v2 save on a ship id that still exists keeps the shuttle stats. → Task 3 tests.
2. **Selling capacity out from under the hold.** Selling a cargo pod while the hold is full is refused with a reason. Selling a fuel tank trims fuel and warns first. Buying a smaller ship with cargo or passengers aboard is refused. → Task 5 and Task 6 tests.
3. **Negative and zero credits.** A pilot in debt from a tow can sell outfits but can't buy. A trade-in larger than the new price pays the pilot. → Tasks 5 and 6.
4. **Fuel above the new capacity.** After any capacity change (ship buy, tank sale), fuel never exceeds `shipStats().fuelCapacity`, and the refuel quote stays ≥ 0. → Tasks 5 and 6.
5. **Rebinding.** After the Autopilot or Map key is rebound or unbound, every message and hint shows the new key or no key. It never shows "(G)" or "(M)" hard-coded. → Task 7.

---

### Task 1: Refuel at every port (spec §4.6)

**Files:**
- Modify: `data/planets.json` (give the 7 fuel-less ports a `fuelPrice`, remove `"refuel"` from every `services` list)
- Modify: `src/data/schemas.ts` (`PlanetSchema.services` drops `'refuel'`; `fuelPrice: z.number().nonnegative()` becomes required)
- Modify: `src/data/load.ts` (drop the "refuel listed exactly when fuelPrice" rule; the schema now requires the price)
- Modify: `src/sim/rules.ts` (`refuelQuote` no longer returns `'noFuelSold'`; `sellsFuel` always true; keep `towDestination` so a system with no ports still tows)
- Modify: `src/ui/planetScreen.ts` (Refuel button always shown), `src/guide/steps.ts`, `src/ui/howToPlay.ts` (drop any "some ports sell no fuel" wording)
- Test: `src/data/load.test.ts`, `src/sim/rules.test.ts` (or wherever refuel/tow tests live), `src/ui/planetScreen.test.ts`

**Interfaces:**
- Produces: `PlanetDef.fuelPrice: number` (required), `PlanetDef.services: ('exchange' | 'missions' | 'shipyard' | 'outfitter')[]` (shop values added in Task 2; add them to the enum now so data in Task 2 parses)

Prices for the 7 new ports:
- tier-1 independents (tallow-rock, vesk-outpost, mirren-hollow, the-midden, gull-rock): 5
- Free Reach tier-2 (little-wren, heron-station): 4

- [ ] **Step 1: Write failing tests.**
  - `load.test`: "every port must have a fuelPrice" rejects a planet missing `fuelPrice`.
  - `load.test`: the bundled data parses, and every planet has `fuelPrice > 0`.
  - `planetScreen.test`: at `tallow-rock` the Refuel button is present.
  - Rules test: `towDestination` returns null when the ship has < 1 jump of fuel but its system has any port.
- [ ] **Step 2:** Run `npm test`. Expect those tests to fail.
- [ ] **Step 3:** Make the data, schema, rules and UI changes above. Remove the `'noFuelSold'` reason and its entry in the planet screen's `REFUEL_REASON`.
- [ ] **Step 4:** Run `npm test && npm run typecheck`. Expect PASS. Update any existing test that asserted a fuel-less port.
- [ ] **Step 5:** Commit: `feat(fuel): every port sells fuel; fringe ports charge more`.

### Task 2: Ship and outfit content, tiers, factions, hubs (spec §2)

**Files:**
- Modify: `src/data/schemas.ts` (`ShipSchema` and `PlanetSchema` changes; new `OutfitSchema`, `OutfitDef`; `GameData.outfits`)
- Create: `data/outfits.json`
- Modify: `data/ships.json` (10 ships), `data/planets.json` (shops and hubs)
- Modify: `src/data/load.ts` (load `outfits.json`; cross-checks), `src/data/testData.ts` (fixtures gain the new fields)
- Create: `src/sim/stock.ts` (who sells what)
- Test: `src/data/load.test.ts`, `src/data/balance.test.ts` (new), `src/sim/stock.test.ts` (new)

**Interfaces:**
- `ShipDef` gains:
  - `price: number`, `techTier: 1|2|3|4|5`
  - `shields: number`, `armor: number`, `outfitSpace: number`
  - `role: 'starter'|'courier'|'scout'|'freighter'|'heavyFreighter'|'liner'|'interceptor'|'corvette'|'trader'|'carrier'`
  - `hull: 'pod'|'dart'|'wedge'|'hauler'|'liner'|'carrier'`
  - `description: string`, `soldBy?: string[]`
- `OutfitDef`:
  - `{ id, name, description, category: 'cargo'|'fuel'|'armor'|'shields'|'map'|'scoop', price, techTier, space, max, soldBy?: string[], effect }`
  - `effect` is one of `{ cargo: number } | { fuel: number } | { armor: number } | { shields: number } | { mapJumps: number } | { fuelPerMin: number }`. It must match `category`; enforce this with a zod discriminated union on `category`.
- `PlanetDef` gains `hub?: boolean`.
- Produces in `src/sim/stock.ts`:
  - `governmentOf(planetId: string, data: GameData): string`
  - `sells(planetId: string, item: { techTier: number; soldBy?: string[] }, data: GameData): boolean`: true when the tier is high enough AND (no `soldBy` OR the port's government is in `soldBy`)
  - `shipStock(planetId, data): ShipDef[]` and `outfitStock(planetId, data): OutfitDef[]`: empty unless the port has the matching service. Sort by `techTier`, then `price`.

Content: copy the ship table from spec §2.1 exactly. Set `soldBy` to:
- `['concord']`: kestrel, warden, meridian, bastion
- `['free-reach']`: ironback
- `['independent']`: pathfinder

Write a 1–2 sentence original description for each ship. Ids: `shuttle` (keep), `courier`, `scout`, `mule`, `kestrel`, `liner`, `ironback`, `warden`, `meridian`, `bastion`.

`data/outfits.json` (`price` / `techTier` / `space` / `max` / `effect` / `soldBy`):

| id | name | price | tier | space | max | effect | soldBy |
|---|---|---|---|---|---|---|---|
| cargo-pod | Cargo Pod | 2000 | 1 | 5 | 6 | cargo 5 | – |
| fuel-tank | Fuel Tank | 1500 | 1 | 3 | 4 | fuel 100 | – |
| local-chart | Local Chart | 1000 | 1 | 0 | 1 | mapJumps 4 | – |
| armor-plate | Armor Plate | 3000 | 2 | 5 | 6 | armor 25 | – |
| shield-booster | Shield Booster | 4000 | 2 | 4 | 6 | shields 30 | – |
| fuel-scoop | Fuel Scoop | 12000 | 3 | 6 | 1 | fuelPerMin 25 | – |
| cargo-bay | Cargo Bay Extension | 7000 | 3 | 15 | 4 | cargo 20 | – |
| extended-tank | Extended Tank | 6000 | 3 | 8 | 2 | fuel 300 | – |
| salvage-tank | Salvage Tank | 800 | 1 | 6 | 4 | fuel 100 | independent |
| frontier-rack | Frontier Cargo Rack | 4500 | 2 | 5 | 6 | cargo 8 | free-reach |
| reinforced-plating | Reinforced Plating | 6000 | 3 | 6 | 6 | armor 45 | free-reach |
| heavy-armor | Heavy Armor | 12000 | 4 | 10 | 4 | armor 90 | concord |
| shield-array | Shield Array | 15000 | 4 | 8 | 4 | shields 100 | concord |

Shops in `planets.json`:
- **Hubs** (`hub: true`, both `shipyard` and `outfitter`): vanterre, corvana-works, wrenhold, dunmore-crossing, lastlight-beacon.
- **Shipyard + outfitter:** lamplight-yards, hollis-landing, brannock-deeps, redwater-sound.
- **Outfitter only:** halcyon, glasshouse, concordance, hallow, quillon-spires, thistledown, kiln, oxbow-meadows, brinefield, skerry-light, brackwater.

Cross-checks in `load.ts` (each a `DataError` with a clear message):
- `soldBy` ids are known governments.
- Every hub has both shops.
- Every government has ≥ 1 hub.
- Two hubs of the same government are ≥ 2 jumps apart (BFS over links).
- Every item with `soldBy` is sold (per `sells`) at one or more hubs of each listed government.
- Every ship and outfit is sold by one or more ports.
- `config.startShipId` has the lowest price.

- [ ] **Step 1: Write failing tests.**
  - `stock.test`:
    - Halcyon (tier 3, concord, outfitter only) sells cargo-pod but not heavy-armor, frontier-rack or any ship.
    - Vanterre's ship stock includes meridian and bastion.
    - Wrenhold sells ironback, not kestrel.
    - Lastlight Beacon sells pathfinder and salvage-tank.
  - `balance.test`, over the real `data/ships.json`:
    - hold sizes are all distinct
    - `heavyFreighter` has the largest cargo
    - `liner` has the most passengers
    - `scout` has the largest fuelCapacity
    - `interceptor` has the highest maxSpeed and turnRate
    - `carrier` has the most shields, armor and outfitSpace
    - `starter` has the lowest price
  - `load.test`: one rejection test per cross-check above. Build each case by mutating a copy of the test data.
- [ ] **Step 2:** Run `npm test`. Expect FAIL.
- [ ] **Step 3:** Implement the schemas, data, `stock.ts` and cross-checks.
- [ ] **Step 4:** Run `npm test && npm run typecheck`. Expect PASS.
- [ ] **Step 5:** Commit: `feat(data): ten ship roles, outfit catalog, tier and faction stock, tech hubs`.

### Task 3: Owned outfits in the world and save v3 (spec §3.4)

**Files:**
- Modify: `src/sim/types.ts` (`WorldState.outfits: Record<string, number>`), `src/sim/world.ts` (`newWorld` sets `outfits: {}`)
- Modify: `src/save/pilot.ts` (`CURRENT_SAVE_VERSION = 3`, schema `version: z.literal(3)`, `outfits: z.record(z.string(), z.number().int().positive())`, migration `2: s => ({ ...s, version: 3, outfits: {} })`, `pilotFromWorld` / `worldFromPilot` copy outfits, and an unknown outfit id throws `SaveError('unknownContent', 'unknown outfit "<id>"')`)
- Test: `src/save/pilot.test.ts`, `src/save/transfer.test.ts` (if it pins the version)

**Interfaces:** Produces `WorldState.outfits`. The map from outfit id to count holds only counts > 0, and maps (category `map`) are never stored.

- [ ] **Step 1: Write failing tests.**
  - A v2 save fixture with cargo and a mission upgrades to v3 with `outfits: {}`, and its round trip is unchanged.
  - A v1 save upgrades through to v3.
  - A v3 save with `{ 'cargo-pod': 2 }` round-trips.
  - An unknown outfit id throws `unknownContent`.
  - A version-4 save throws `futureVersion`.
- [ ] **Step 2:** Run the tests. Expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npm test && npm run typecheck`. Expect PASS.
- [ ] **Step 5:** Commit: `feat(save): v3 stores owned outfits`.

### Task 4: `shipStats` and moving every hull-stat reader onto it (spec §3.1)

**Files:**
- Create: `src/sim/shipStats.ts`, `src/sim/shipStats.test.ts`
- Modify (replace `data.ships[...].cargo|passengers|fuelCapacity` reads): `src/sim/cargo.ts`, `src/sim/world.ts` (`applyRefuel`), `src/sim/rules.ts` (`refuelQuote(fuel: number, fuelCapacity: number, planet: PlanetDef, credits: number)`), `src/app/controller.ts`, `src/render/hudInfo.ts`, `src/ui/exchange.ts`, `src/ui/missionComputer.ts`, `src/ui/planetScreen.ts`. Hull-only reads (`radius`, flight handling, `howToPlay` start ship) stay.

**Interfaces:**
- Produces:
  - `interface ShipStats { cargo: number; passengers: number; fuelCapacity: number; shields: number; armor: number; outfitSpace: number; spaceUsed: number; spaceFree: number; fuelPerMin: number }`
  - `shipStats(shipId: string, outfits: Record<string, number>, data: GameData): ShipStats` (pure; works for ships you don't own, so it can drive shipyard previews)
  - `worldStats(world: WorldState, data: GameData): ShipStats` (shorthand for `shipStats(world.shipId, world.outfits, data)`)

- [ ] **Step 1: Write failing tests.**
  - The bare shuttle gives hull values and `spaceFree === outfitSpace`.
  - 2 cargo pods + 1 fuel tank on the shuttle give cargo 30, fuelCapacity 400, spaceUsed 13.
  - A fuel scoop gives `fuelPerMin` 25.
  - An unknown outfit id in `outfits` is ignored.
  - `cargoFree` with 2 pods reflects the larger hold.
- [ ] **Step 2:** Run the tests. Expect FAIL.
- [ ] **Step 3:** Implement and switch the call sites.
- [ ] **Step 4:** Run `npm test && npm run typecheck`. Expect PASS, with existing tests unchanged.
- [ ] **Step 5:** Commit: `refactor(sim): ship stats come from hull plus outfits`.

### Task 5: Outfitter rules, local chart and fuel scoop (spec §2.2, §3.2)

**Files:**
- Create: `src/sim/outfitter.ts`, `src/sim/outfitter.test.ts`
- Modify: `src/sim/galaxy.ts` (add `revealWithin(known, seen, data, fromSystemId, jumps): { known; seen }` using BFS plus the same seen rule as `revealOnArrival`)
- Modify: `src/sim/world.ts` (`stepWorld`: when not jumping, `fuel = min(cap, fuel + fuelPerMin * dt / 60)`)
- Modify: `src/app/controller.ts` (`buyOutfit(id)`, `sellOutfit(id)`, `outfitQuote(id)`; each triggers the autosave the exchange uses)

**Interfaces:**
- Produces:
  - `type OutfitBlock = 'credits' | 'space' | 'max' | 'notSold' | 'nothingToReveal'`
  - `type SellBlock = 'notOwned' | 'cargoWouldNotFit' | 'notSellable'`
  - `outfitBuyCheck(world, data, planetId, outfitId): { ok: true } | { ok: false; reason: OutfitBlock }`
  - `buyOutfit(world, data, planetId, outfitId): { world: WorldState; check }`: unchanged world when blocked. A map charges the price and calls `revealWithin`.
  - `outfitSellCheck(world, data, outfitId): { ok: true; refund: number; fuelLost: number } | { ok: false; reason: SellBlock }`
  - `sellOutfit(world, data, outfitId)`: refund `Math.floor(price * 0.5)`; fuel is trimmed to the new capacity.
  - `OUTFIT_BLOCK_TEXT: Record<OutfitBlock | SellBlock, string>`: original short sentences, e.g. `space: 'Not enough free outfit space.'`

- [ ] **Step 1: Write failing tests.**
  - Buying a cargo pod deducts 2000 and owned becomes 1.
  - Blocked on credits when credits < price, including negative credits.
  - Blocked on `space` when `spaceFree` < space.
  - Blocked on `max` when owned = max.
  - Blocked on `notSold` at a port that doesn't stock the item.
  - The local chart at Calder reveals every system within 4 jumps, is not stored in `outfits`, and is blocked with `nothingToReveal` when everything in range is known.
  - Selling refunds 50%.
  - Selling a pod while cargo used > new capacity gives `cargoWouldNotFit`.
  - Selling a fuel tank with full fuel reports `fuelLost` 100 and trims fuel.
  - Selling a map gives `notSellable`.
  - `stepWorld` with a scoop for 60 s of flight adds 25 fuel, capped at capacity.
  - No fuel is added while jumping, or without a scoop.
- [ ] **Step 2:** Run the tests. Expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npm test && npm run typecheck`. Expect PASS.
- [ ] **Step 5:** Commit: `feat(sim): outfitter buy/sell, local chart, fuel scoop`.

### Task 6: Shipyard rules (spec §3.3)

**Files:**
- Create: `src/sim/shipyard.ts`, `src/sim/shipyard.test.ts`
- Modify: `src/app/controller.ts` (`buyShip(id)`, `shipQuote(id)`; autosave after a purchase)

**Interfaces:**
- Produces:
  - `tradeInValue(world, data): number`: `floor(0.75 × hull price) + Σ floor(0.5 × outfit price × count)`
  - `type ShipBlock = 'credits' | 'cargo' | 'passengers' | 'owned' | 'notSold'`
  - `shipQuote(world, data, planetId, shipId): { price: number; tradeIn: number; net: number; check: { ok: true } | { ok: false; reason: ShipBlock } }`
  - `buyShip(world, data, planetId, shipId): { world; quote }`. On success:
    - `shipId` changes and `outfits = {}`
    - `credits -= net` (net may be negative, which pays the pilot)
    - `fuel = new hull fuelCapacity`
  - `SHIP_BLOCK_TEXT: Record<ShipBlock, string>`

- [ ] **Step 1: Write failing tests.**
  - The shuttle's trade-in is 7500. With 2 pods it is 9500.
  - Net cost for the mule = 45000 − tradeIn.
  - Blocked on `credits`, `owned` and `notSold`.
  - Blocked on `cargo` when the hold has more tons than the new hull's base cargo (e.g. 10 t aboard, buying the kestrel with hold 5).
  - Blocked on `passengers` when mission passengers exceed berths.
  - After buying: outfits are empty, fuel is full, credits are correct.
  - A trade-in above the new price increases credits.
- [ ] **Step 2:** Run the tests. Expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npm test && npm run typecheck`. Expect PASS.
- [ ] **Step 5:** Commit: `feat(sim): shipyard trade-in and purchase rules`.

### Task 7: Messages that follow the current bindings (spec §3.5)

**Files:**
- Modify: `src/sim/world.ts`:
  - `MSG_TOO_CLOSE = 'Too close to the star to jump. {autopilot} to fly out.'`
  - `MSG_NO_DESTINATION = 'Choose a destination on the star map{map}.'`
- Create: `src/ui/messageText.ts`, `src/ui/messageText.test.ts`
- Modify: every consumer of the controller `message` event (`src/render/SpaceScene.ts` → `hud.showMessage`, plus `src/ui/rails.ts` if it shows messages) so it formats the text first

**Interfaces:**
- Produces: `formatMessage(text: string, keyLabel: (a: ActionId) => string | null, touch: boolean): string`.

Replacements:

| Token | Keyboard, key bound | Keyboard, unbound | Touch |
|---|---|---|---|
| `{autopilot}` | `Use autopilot (G)` with the bound key | `Use autopilot` | `Tap the bottom button` |
| `{map}` | ` (M)` with the bound key | empty | ` (tap Map)` |

`keyLabel` comes from the existing key-name helper used by `hotkeyFor`.

- [ ] **Step 1: Write failing tests.**
  - Default bindings give "…Use autopilot (G) to fly out."
  - Autopilot rebound to KeyP gives "(P)".
  - Unbound gives "Use autopilot to fly out."
  - Touch gives "Tap the bottom button to fly out."
  - `{map}` in all three modes.
  - Text with no tokens is unchanged.
- [ ] **Step 2:** Run. Expect FAIL.
- [ ] **Step 3:** Implement, and wire up the consumers.
- [ ] **Step 4:** Run `npm test && npm run typecheck`. Expect PASS. Fix sim tests that compared exact message strings by comparing against the constants.
- [ ] **Step 5:** Commit: `fix(ui): jump messages show the current key, or touch wording`.

### Task 8: Hull silhouettes and shop icons (spec §4.3)

**Files:**
- Modify: `src/render/sprites.ts`:
  - `renderShipFrame(size, scale, angle, hue, hull: ShipDef['hull'])` picks a half-outline per hull profile. Add five new original outline arrays beside `HULL_HALF`, and `pod` keeps the current shape.
  - `makeShipTextures` passes `def.hull`.
- Create: `src/ui/icons.ts`:
  - `shipIcon(def: ShipDef, size: number): HTMLCanvasElement` draws one frame via an exported `drawShipFrame(ctx, size, def)` from sprites.ts at heading −90°, nose up.
  - `outfitIcon(def: OutfitDef, size: number): SVGSVGElement` is one original vector glyph per category, with the stroke colour stepping from grey (tier 1) to gold (tier 5).
- Test: `src/ui/icons.test.ts` (happy-dom)

- [ ] **Step 1: Write failing tests.**
  - `outfitIcon` returns an `svg` with `data-category` equal to the category for all 6 categories.
  - `shipIcon` returns a canvas of the requested size.
  - Each `hull` value maps to a distinct outline (assert that the outline arrays differ).
- [ ] **Step 2:** Run. Expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npm test && npm run typecheck`. Expect PASS. Check by eye with the `run` skill: launch the dev server, and confirm in flight that the shuttle still looks right.
- [ ] **Step 5:** Commit: `feat(art): six hull silhouettes and outfit icons`.

### Task 9: Shipyard and Outfitter screens (spec §4.1, §4.2)

**Files:**
- Modify: `src/input/actions.ts` and `src/input/bindings.ts`:
  - `ActionGroup` adds `'shop'`.
  - New actions:
    - `openShipyard` (planet, `KeyY`), label "Shipyard"
    - `openOutfitter` (planet, `KeyO`), label "Outfitter"
    - `shopBuy` (shop, `KeyB`), label "Buy"
    - `shopSell` (shop, `KeyS`), label "Sell"
    - `shopPrevPage` (shop, `PageUp`, `BracketLeft`), label "Previous page"
    - `shopNextPage` (shop, `PageDown`, `BracketRight`), label "Next page"
  - The hotkey editor lists the new group under the heading "Shops".
- Create: `src/ui/shop.ts`:
  - `showShop(ctx, opts: ShopOpts)` is the shared paged grid, Info panel and buttons.
  - `pageSize(width: number, height: number): { cols: number; rows: number }`: 4×3 at desktop sizes, 3×2 at 844×390.
- Create: `src/ui/shipyard.ts`:
  - `showShipyard(ctx, planetId, onClose)` builds `ShopOpts` from `shipStock` and `shipQuote`.
  - Info shows cargo, berths, fuel (as jumps), shields, armor, outfit space, speed, turn, price, trade-in and net cost.
  - Buy asks `confirmDialog` with "Trade in your <ship> and buy <ship> for <net>?". Sell is hidden.
- Create: `src/ui/outfitter.ts`:
  - `showOutfitter(ctx, planetId, onClose)` shows owned count tiles, effect, space and max.
  - Info shows the resale value and any fuel that would be lost.
  - Info and the status line show `OUTFIT_BLOCK_TEXT` reasons.
- Modify: `src/ui/planetScreen.ts` adds the Shipyard and Outfitter buttons and hotkeys when the planet has the service, plus "Tech hub" next to the tier when `hub`.
- Modify: `src/ui/styles.css` (shop grid and Info layout).
- Test: `src/ui/shop.test.ts`, `src/ui/planetScreen.test.ts`

**Interfaces:**
- `interface ShopItem { id: string; name: string; icon: () => Element; badge?: string; info: () => Element; canBuy: boolean; reason?: string; canSell?: boolean }`
- `interface ShopOpts { title: string; testId: 'shipyard' | 'outfitter'; items: () => ShopItem[]; onBuy(id: string): void | Promise<void>; onSell?(id: string): void; onClose(): void }`

Keys: the arrow keys move the selection (handled like `missionComputer.ts`); B, S and the page keys come from the `shop` group; Back (Esc) closes.

- [ ] **Step 1: Write failing tests.**
  - `pageSize(844, 390)` gives `{cols: 3, rows: 2}`.
  - `pageSize(1280, 800)` gives `{cols: 4, rows: 3}`.
  - The planet screen at Vanterre shows Shipyard, Outfitter and "Tech hub". At Halcyon it shows only Outfitter. At Merrow it shows neither.
  - The outfitter at Halcyon:
    - Buying a pod changes the badge to "1" and credits drop by 2000.
    - Buy is disabled with the space reason after filling the space.
  - The shipyard at Vanterre:
    - Selecting the mule shows trade-in 7500.
    - Buy, then confirm, makes the planet screen's cargo line show `/60 t`.
  - Next page moves to the second page when there are more items than fit on a page.
- [ ] **Step 2:** Run. Expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npm test && npm run typecheck`. Expect PASS.
- [ ] **Step 5:** Commit: `feat(ui): shipyard and outfitter screens`.

### Task 10: Map always one tap away (spec §4.5)

**Files:**
- Create: `src/ui/mapButton.ts`: `mapCornerButton(ctx, reopen: () => void): HTMLButtonElement` is a button labelled "Map" showing its hotkey. It sits in the top-right of `.sw-panel` via `.sw-map-corner` and calls `ctx.go.map({ onClose: reopen })`.
- Modify:
  - `src/ui/planetScreen.ts`: replace the "Star Map" action button with the corner button.
  - `src/ui/exchange.ts`, `src/ui/missionComputer.ts`, `src/ui/missionLog.ts`, `src/ui/shipyard.ts`, `src/ui/outfitter.ts`: add the corner button. Each reopen function rebuilds that screen.
- Modify: `src/ui/rails.ts` and `src/ui/rails.css` add a labelled "Map" button (`data-control="map"`) in the button rail directly above the radar. It shows in every layout, including when the radar is hidden for space, and presses `map` like the radar does.
- Modify: `src/guide/steps.ts` ("Tap Star Map." / "Tap the radar." become "Tap Map."), `src/ui/howToPlay.ts` (the map is always on the Map button).
- Test: `src/ui/rails.test.ts`, `src/ui/planetScreen.test.ts`, `src/guide/steps.test.ts`, `src/ui/howToPlay.test.ts`

- [ ] **Step 1: Write failing tests.**
  - Every listed screen renders `.sw-map-corner`, and clicking it mounts the star map. Closing returns to the same screen.
  - The rails have `[data-control="map"]` at 844×390 with the radar hidden.
  - The guide's map-step text for touch is "Tap Map."
- [ ] **Step 2:** Run. Expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npm test && npm run typecheck`. Expect PASS.
- [ ] **Step 5:** Commit: `feat(ui): fixed Map button on every screen and the phone rail`.

### Task 11: Preview a mission on the map (spec §4.4)

**Files:**
- Modify: `src/ui/starMap.ts`: `showStarMap` options gain `preview?: { systemId: string; label: string }`.
  - With a preview, the map centres on that system and pre-selects it.
  - It draws the route preview from the current system (reuse `routeSummary`) and shows `label`, e.g. "Mission: <title>".
  - Unknown systems still get a marker.
  - Set course plots it as today.
- Modify: `src/ui/missionComputer.ts` and `src/ui/missionLog.ts`:
  - Add a "Show on map" button.
  - A keydown matching any key bound to `map` or `openMap` triggers it too.
  - It opens the map with `preview = { systemId: dest port's systemId, label }`, and `onClose` reopens the same screen with the same selection.
  - Add `opts?: { selectId?: string }` to `showMissionComputer` (offer id) and `showMissionLog` (mission id).
- Test: `src/ui/starMap.test.ts`, `src/ui/missions.test.ts`

- [ ] **Step 1: Write failing tests.**
  - With offer 2 selected, the Map key opens the map with the destination system selected, `map-route` shows its jump count, and the plotted route is unchanged.
  - Set course plots the route.
  - Closing returns to the computer with offer 2 still selected.
  - The same flow works from the mission log.
- [ ] **Step 2:** Run. Expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npm test && npm run typecheck`. Expect PASS.
- [ ] **Step 5:** Commit: `feat(ui): highlighted mission previews its route on the map`.

### Task 12: PC sidebar HUD (spec §5)

**Files:**
- Create: `src/render/sidebar.ts`: `class Sidebar` with `layout(x: number, h: number)`, `update(world, data, dtSec)`, `setVisible(v)` and `mapButtonBounds()`. It is drawn with Phaser Graphics and Text at depth 1000 and scroll factor 0.
- Create: `src/render/sidebarInfo.ts` (pure, tested):
  - `sidebarInfo(world, data): { shields: number; armor: number; fuelFrac: number; jumps: number; nav: string; secondary: string; target: string | null; targetDetail: string | null; cargoFree: string; credits: string; date: string }`
  - `radarBlips(world, data, radius: number): { x: number; y: number; kind: 'star'|'planet'|'target'|'jumpRing' }[]`
- Modify: `src/render/SpaceScene.ts`:
  - `SIDEBAR_W = 200`.
  - Keyboard mode with `width >= 700`: the camera viewport is `{x: 0, y: 0, w: width - 200, h: height}`, the sidebar is laid out at `x = width - 200`, and the HUD's top-left panel is hidden.
  - Otherwise the current layout, with the sidebar hidden.
  - The sidebar's Map button (Task 10) emits the `map` menu.
- Modify: `src/render/hud.ts`: `setLayout(viewW, viewH, touchMode, sidebar: boolean)`. When `sidebar` is true, the status panel is hidden and the guide box moves to top-left.
- Modify: `src/app/testHook.ts`: `hook.sidebar = () => ({ visible: boolean; info: SidebarInfo })`.
- Test: `src/render/sidebarInfo.test.ts`

- [ ] **Step 1: Write failing tests.**
  - Nav:
    - "No course" with an empty route.
    - "Vesk · 2 jumps" with a route.
  - Secondary is "None".
  - Target:
    - With a target: its name and "Planet · 1,234" (or "Station · …") with the distance rounded.
    - Null when no target is set.
  - `radarBlips` puts the star at the center offset from the ship. A planet beyond radius is clamped to the edge. The target is tagged `target`.
  - Shields and armor equal `worldStats` maxima.
- [ ] **Step 2:** Run. Expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npm test && npm run typecheck`. Expect PASS. Check by eye with the `run` skill at 1280×800 and 600×800 (sidebar hidden).
- [ ] **Step 5:** Commit: `feat(hud): EV-style sidebar on PC`.

### Task 13: End-to-end coverage and docs

**Files:**
- Create: `tests/e2e/shops.spec.ts`, `tests/e2e/sidebar.spec.ts`
- Modify: `tests/e2e/starmap.spec.ts` (mission preview, corner Map button), `tests/e2e/touch.spec.ts` (rail Map button, shop at 844×390), and any spec that clicked "Star Map" or relied on a fuel-less port
- Modify: `docs/design-notes.md` (mark cycle 2 items as built)

- [ ] **Step 1: Write the e2e tests.**
  - **Shops (desktop):** start a pilot, give credits via the test hook, then set course and fly or tow to Dunmore Crossing (or put the world there via the hook if one exists; otherwise add `hook.teleport(planetId)` in `testHook.ts`).
    - Buy a cargo pod: the badge shows 1 and cargo free grows by 5.
    - Buy the mule: the planet screen shows `/60 t`.
  - **Sidebar:**
    - At 1280×800 keyboard mode, `hook.sidebar().visible` is true and the camera width is 1080.
    - In touch mode the sidebar is not visible.
  - **Phone 844×390:**
    - The outfitter grid and Buy button are fully on-screen (bounding boxes within the viewport).
    - The rail Map button opens the map in flight.
  - **Mission preview:** in the Mission Computer, select a job and press N. The map shows the destination and its route. Close it and the same job is still selected.
- [ ] **Step 2:** Run `npm run build && npm run test:e2e`. Expect all PASS, with existing specs updated.
- [ ] **Step 3:** Run `npm test && npm run typecheck`. Expect PASS.
- [ ] **Step 4:** Commit: `test(e2e): shops, sidebar, map button, mission preview`.

---

## Execution notes

- Dependencies:
  - Task 1 → Task 2 (the service enum).
  - Task 2 → Tasks 3–6, 8–9, 12 (data).
  - Task 3 → Tasks 4–6.
  - Task 4 → Tasks 5, 6 and 12.
  - Tasks 5–6 → Task 9.
  - Task 10 → Tasks 11–12.
  - Task 13 is last.
- After the final review, hand off with superpowers:finishing-a-development-branch. Merging to `main` and deploying to GitHub Pages wait for the owner's OK.
