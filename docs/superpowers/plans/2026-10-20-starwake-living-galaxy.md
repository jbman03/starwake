# Living Galaxy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the galaxy feel alive before combat: friction fixes, NPC traffic, in-flight
encounters, a survey-ship thread with a hidden system and a rare hull, effects and sound,
a fairer earning curve, and a pilot card.

**Architecture:**
- Rules live in pure, unit-tested modules under `src/sim/`: `traffic.ts`, `encounters.ts`
  and `story.ts`.
- Transient flight state (traffic, an open hail, a site) belongs to the `Controller`, not
  to the saved `WorldState`.
- Lasting state goes into `WorldState` and save v4: `flags`, `notes`, `shipName`, `stats`
  and `lastEncounterDay`.
- Content goes in JSON under `data/` and is validated with zod in `src/data/load.ts`.
- Rendering lives in `SpaceScene`, `hud.ts` and `sidebar.ts`.
- Sound is synthesised with WebAudio in `src/audio/sfx.ts`.

**Tech Stack:** Phaser 4, TypeScript, zod, Vite PWA, Vitest (happy-dom), Playwright.

**Spec:** `docs/superpowers/specs/2026-10-20-starwake-living-galaxy-design.md`

## Global Constraints

- Every name and text is original. No EV names or text.
- On phones nothing covers the game view except the bottom context button, unless the
  player opens a screen themselves.
- Every new action gets a rebindable hotkey, listed in `src/input/actions.ts`
  (`ACTION_IDS`, `ACTION_GROUP`, `ACTION_LABEL`) and in `src/input/bindings.ts`.
- Sim code stays pure and deterministic. All randomness comes from `src/sim/random.ts`
  (`hashString`, `mulberry32`), seeded from `world.seed`.
- New world-space Phaser objects go through `SpaceScene.addWorldObject` so the sidebar
  camera ignores them.
- Commands: `npm test`, `npm run typecheck` and `npm run test:e2e`. All must stay green.
- Phone e2e viewport: 844×390.
- Work on branch `living-galaxy`, committing after each task. Never push or merge.

## Review Focus

1. **An old save (v3) loads.** v4 defaults are filled in, nothing is lost, and a save
   that references Hushwater ids works with the flag either set or unset.
   *Task 3 test:* "v3 save with missions and outfits round-trips through v4".
2. **Phone layout.** The hail prompt never overlays the view. It only changes the
   context button's label, and the encounter card fits at 844×390.
   *Task 9 e2e:* "phone hail via context button".
3. **Jumping out with an open hail or site.** The hail lapses, the site is dropped, and
   no orphan card is left.
   *Task 9 test:* "leaving system clears pending encounter".
4. **Full hold or no fuel.** A choice that gives cargo is capped at the free space. A
   fuel gift never pushes fuel below 0, and a choice that needs fuel is disabled with a
   reason. *Task 8 tests:* "cargo outcome capped", "fuel choice disabled when short".
5. **Hidden-system leaks.** Hushwater must never show on the map, in charts or in routes
   before `hushwater-lane` is set, including routes from mission previews and the
   "systems explored" total.
   *Task 5 tests:* "chart never reveals hidden", "routeBetween ignores hidden lane".

---

### Task 1: One Map key and an honest route preview

**Files:**
- Modify: `src/input/bindings.ts` (`map` default becomes `['KeyN', 'KeyM']`)
- Modify: `src/ui/starMap.ts` (`routeSummary`)
- Test: `src/input/bindings.test.ts`, `src/ui/starMap.test.ts`, `tests/e2e/starmap.spec.ts`

**Interfaces:**
- Produces: `routeSummary(world, data, toId, opts?: { anyLane?: boolean }): RouteSummary`.
  With `anyLane`, the route goes through `seen` and unknown systems, as accepting a
  mission does.

- [ ] Write failing tests:
  - `DEFAULT_BINDINGS.map` equals `['KeyN', 'KeyM']`, and `openMap` still equals
    `['KeyN', null]`.
  - When the destination is unexplored but reachable, `routeSummary` with
    `{ anyLane: true }` returns a route of length 2 and text starting
    "2 jumps (through unexplored space)".
- [ ] Run `npm test -- bindings starMap`. Expect FAIL.
- [ ] Implement:
  - Use `anyLane` for the mission preview, i.e. when `showStarMap` gets `opts.preview`.
  - When any hop is not in `world.known`, append " (through unexplored space)" after
    the jump count.
- [ ] Add an e2e test in `starmap.spec.ts`: in flight, press `n` and the star map opens.
- [ ] Run `npm test` and `npm run test:e2e -- starmap`. Expect PASS.
- [ ] Commit `fix: one Map key (N) everywhere; honest route preview for unexplored destinations`.

### Task 2: The guide adapts, and the hotkey after a dialog

**Files:**
- Modify: `src/guide/target.ts`, `src/guide/steps.ts`, `src/guide/guide.ts`
- Test: `src/guide/target.test.ts`, `src/guide/steps.test.ts`, `tests/e2e/hotkeys.spec.ts`

**Interfaces:**
- Produces:
  `bestSellPort(world: WorldState, data: GameData, good: string, paid: number): { system: string; port: string } | null`
  in `target.ts`. It returns the known port with the fewest jumps whose current sell
  price for `good` is greater than `paid`, breaking ties by the higher price.

- [ ] Write failing tests:
  - `bestSellPort` picks the nearest profitable known port.
  - It returns null when none is known.
  - The guide's target system and port are recomputed on landing.
  - Selling the guide good for a profit at a port that isn't the target completes the
    sell step.
  - Step 7's text names the recomputed port, not "Tessaly", when the pilot landed
    elsewhere.
- [ ] Run them. Expect FAIL.
- [ ] Implement:
  - Call `bestSellPort` in `Guide.update` whenever `landedPlanetId` changes.
  - Fall back to the existing fixed target when it returns null.
- [ ] Write an e2e test in `hotkeys.spec.ts`, "hotkey works right after the Mission
  complete dialog":
  1. Teleport to a mission destination with a finished mission via the test hook.
  2. Press Enter on the dialog.
  3. Press `r` immediately.
  4. Expect the "Bought … fuel" note.
- [ ] Run the e2e test.
  - If it fails, find where focus is lost: the dialog close should hand focus back to
    the screen root (`ui/overlays.ts`), and the planet screen's keydown handler must
    survive the close.
  - Fix it, then rerun. Expect PASS.
- [ ] Commit `fix: guide follows the pilot's route; hotkeys work after a dialog`.

### Task 3: Save v4 and the new world fields

**Files:**
- Modify: `src/sim/types.ts`, `src/sim/world.ts` (`newWorld`), `src/save/pilot.ts`, `src/app/controller.ts` (jobsDone)
- Test: `src/save/pilot.test.ts`, `src/sim/world.test.ts`

**Interfaces:**
- Produces these `WorldState` fields:
  - `flags: string[]`
  - `notes: { day: number; text: string }[]` (newest first, at most 20)
  - `shipName: string`
  - `stats: { jobsDone: number }`
  - `lastEncounterDay: number | null`
- Produces these helpers in a new `src/sim/story.ts`:
  - `hasFlag(w, f): boolean`
  - `setFlag(w, f): WorldState` (idempotent)
  - `addNote(w, text): WorldState` (dedupes the same text, caps the list at 20)
- `CURRENT_SAVE_VERSION = 4`.

- [ ] Write failing tests:
  - Migration 3 → 4 fills `flags: []`, `notes: []`, `shipName` (the ship def name, or
    the shipId if that def is missing), `stats: { jobsDone: 0 }` and
    `lastEncounterDay: null`.
  - "v3 save with missions and outfits round-trips through v4".
  - `pilotFromWorld` and `worldFromPilot` preserve the new fields.
  - `addNote` caps at 20 and dedupes.
  - Completing 2 missions on landing adds 2 to `stats.jobsDone`.
- [ ] Run. Expect FAIL.
- [ ] Implement:
  - Add a zod schema entry for each field.
  - Write migration `3:`.
  - Increment `stats.jobsDone` where the controller handles `completeAt` results.
  - `buyShip` sets `shipName` to the new hull's name. Task 14 adds a naming prompt.
- [ ] Run `npm test` and `npm run typecheck`. Expect PASS.
- [ ] Commit `feat: save v4 with story flags, notes, ship name and stats`.

### Task 4: New data (names, encounters, Hushwater, the surveyor)

**Files:**
- Create: `data/names.json`, `data/encounters.json`
- Modify:
  - `data/systems.json`: add Hushwater, plus `hiddenLinks: ["hushwater"]` on Skerry
  - `data/planets.json`: one small world, "Quiet Shoal", in Hushwater, with exchange and
    refuel
  - `data/commodities.json`: `stillwater-pearl`, base 900, origin Quiet Shoal
  - `data/ships.json`: `patience` surveyor, with `unique: true` and
    `requiresFlag: "survey-claim"`, sold only at the Free Reach hub
  - `src/data/schemas.ts`, `src/data/load.ts`
- Test: `src/data/load.test.ts`, `src/data/balance.test.ts`

**Interfaces:**
- Produces these schema fields:
  - `SystemSchema.hiddenLinks?: string[]`
  - `SystemSchema.hidden?: boolean` (true for Hushwater)
  - `SystemSchema.traffic?: [min, max]`
  - `ShipSchema.unique?: boolean`
  - `ShipSchema.requiresFlag?: string`
- Produces these `GameData` fields:
  - `GameData.names: { first: string[]; second: string[] }`
  - `GameData.encounters: Record<string, EncounterDef>`
- `EncounterDef` (exported type) is:
  `{ id; kind: 'hail' | 'site'; weight: number; once?: boolean; title: string; text: string; when?: { minDay?; governments?; tiers?; systems?; requiresFlag?; notFlag? }; choices: { label: string; needs?: { fuel?: number; credits?: number; cargoSpace?: number }; outcomes: Outcome[] }[] }`.
  - It has 1–3 choices.
  - `Outcome` is a discriminated union on `type`:
    - `credits {n}`
    - `cargo {good, tons}`
    - `fuel {n}`
    - `mission {missionType, toSystem?}`
    - `reveal {systems?: string[]; jumps?: number}`
    - `rumour {text}`
    - `flag {flag}`
    - `message {text}`
  - Text may use `{ship}` (the NPC name), `{system}` and `{pilot}`.
- Patience stats: price 60000, cargo 40, `techTier` 3, fuel range like the scout,
  `maxSpeed` like the courier, `role: "scout"`, plus a built-in `chartJumps: 2`.
  If `chartJumps` doesn't fit `ShipSchema`, add it as optional.

- [ ] Write failing tests:
  - The loader rejects an encounter with 0 or 4 choices, or an unknown outcome type.
  - It rejects a `hiddenLinks` target that isn't a system.
  - Every encounter references known goods, systems and mission types.
  - `names.json` has at least 20 entries in each list.
  - The existing hold-size uniqueness balance test still passes with the 40 t surveyor.
    If 40 t collides, use 42.
- [ ] Run. Expect FAIL.
- [ ] Write the content:
  - The 12 templates from spec §4, with original text.
  - The 3 survey-thread templates: `survey-beacon` (hail, Skerry, `requiresFlag:
    survey-rumour`, `once`), `long-patience` (site, Hushwater, `once`) and
    `pearl-diver` (optional flavour).
  - Implement the schema and loader.
- [ ] Run `npm test`. Expect PASS.
- [ ] Commit `feat: data for names, encounters, Hushwater and the Patience surveyor`.

### Task 5: Hidden lanes

**Files:**
- Modify: `src/sim/galaxy.ts`, `src/ui/starMap.ts` (`mapModel`), `src/sim/world.ts` (`setRoute`)
- Test: `src/sim/galaxy.test.ts`, `src/ui/starMap.test.ts`

**Interfaces:**
- Produces `lanesOf(data: GameData, id: string, flags: readonly string[]): string[]`.
  It returns `links`, plus `hiddenLinks` once the flag `hushwater-lane` is set, plus the
  reverse lane from a hidden system back to its parent.
- The lane-unlock flag is the constant `HIDDEN_LANE_FLAG = 'hushwater-lane'`.
- `routeBetween`, `revealOnArrival`, `systemsWithin` and `revealWithin` gain a `flags`
  parameter and use `lanesOf`. Update every caller.

- [ ] Write failing tests:
  - "routeBetween ignores hidden lane" when the flag is unset.
  - The route Skerry → Hushwater has length 1 once the flag is set.
  - "chart never reveals hidden": `revealWithin` from Skerry at 4 jumps excludes
    Hushwater without the flag.
  - Arriving at Skerry doesn't add Hushwater to `seen` without the flag, but does with
    it.
  - `mapModel` omits Hushwater and its lane until the flag is set.
  - The visible system total for the pilot card excludes hidden systems until the flag
    is set (export `visibleSystemCount(data, flags)`).
- [ ] Run. Expect FAIL. Implement. Run `npm test` and `npm run typecheck`. Expect PASS.
- [ ] Commit `feat: hidden lanes that open with a story flag`.

### Task 6: Traffic simulation (pure)

**Files:**
- Create: `src/sim/traffic.ts`
- Test: `src/sim/traffic.test.ts`

**Interfaces:**
- Produces:
  - `type Errand = 'arrive' | 'depart' | 'pass'`
  - `interface Npc { id: string; name: string; shipId: string; government: string; errand: Errand; ship: ShipState; portId: string | null; phase: 'jumpIn' | 'fly' | 'land' | 'jumpOut' | 'gone'; phaseT: number; thrusting: boolean }`
  - `interface Traffic { systemId: string; npcs: Npc[]; spawnCount: number; nextSpawnSec: number; targetId: string | null }`
  - `trafficLevel(data, systemId): [number, number]`. Defaults:
    - Concord: [3, 5]
    - independent and Free Reach: [2, 3]
    - any system whose ports are all tier ≤ 1: [0, 2]
    - the system's `traffic` field overrides these.
  - `seedTraffic(world, data, maxNpcs: number): Traffic`. This spawns the level minimum,
    spread mid-errand.
  - `stepTraffic(t: Traffic, world, data, dt: number, maxNpcs: number): { traffic: Traffic; events: TrafficEvent[] }`.
  - `type TrafficEvent = { type: 'npcJumpIn' | 'npcJumpOut' | 'npcLanded' | 'npcTookOff'; id: string }`.
  - `npcLabel(npc, data): string`. It returns, for example,
    "Brass Heron — Concord Mule (trader)", using the government name's first word and
    the hull's role.
- Rules:
  - Spawns are deterministic from
    `hashString(world.seed, 'npc', systemId, world.day, spawnCount)`.
  - Every 8–20 s a ship spawns while the count is below the level.
  - At most `maxNpcs` ships exist (8 on high quality, 4 on low).
  - Hulls are picked by weight from ships whose `techTier` is at most the system's best
    port tier, excluding `unique` hulls. The carrier role spawns only in hub systems.
  - NPCs fly with `stepShip` from `flight.ts` and the same autopilot input as the player.
    Export `autopilotInput` from `world.ts` if needed.
  - A jump in or out takes 1.0 s. A ship that reaches its port within the arrival
    radius goes to phase `land`, then `gone` after 0.4 s, and is then removed.

- [ ] Write failing tests:
  - Determinism: same inputs give the same NPCs.
  - The count stays within `trafficLevel` and the cap.
  - No carrier in a non-hub system.
  - No unique hull ever.
  - Every errand finishes (`gone`) within 180 simulated seconds.
  - Hushwater gets `[0, 1]` (set `traffic` in its data).
- [ ] Run. Expect FAIL. Implement. Run. Expect PASS.
- [ ] Commit `feat: NPC traffic simulation`.

### Task 7: Traffic on screen, targeting and radar

**Files:**
- Modify: `src/app/controller.ts`, `src/render/SpaceScene.ts`, `src/render/sidebar.ts`, `src/render/sidebarInfo.ts`, `src/render/hud.ts`, `src/render/hudInfo.ts`, `src/app/testHook.ts`
- Test: `src/render/sidebarInfo.test.ts`, `src/app/controller.test.ts`, `tests/e2e/traffic.spec.ts` (new)

**Interfaces:**
- Consumes the Task 6 API.
- Produces:
  - `Controller.traffic: Traffic`. It is reseeded on `beginSession` and on the `jumped`
    event, and stepped inside `Controller.update` while flying.
  - `Controller.targetShip(id: string | null): void`.
  - `nextTarget` cycles ships (nearest first) and then planets. With a ship targeted,
    `world.targetPlanetId` is null.
  - A test hook `traffic(): { id: string; label: string; screen: { x: number; y: number } | null }[]`.

- [ ] Write failing tests:
  - Tab cycles: ship → ship → planet → planet → none.
  - With a ship targeted, `sidebarInfo` returns `target: "Brass Heron — Concord Mule (trader)"`.
  - Radar entries include NPC dots with the government's colour.
- [ ] Run. Expect FAIL.
- [ ] Implement the rendering:
  - One image per NPC from `makeShipTextures`, tinted by `governments[g].color`.
  - A target bracket on the targeted ship.
  - Tapping a ship (touch) or clicking it (mouse) calls `targetShip`.
- [ ] Write an e2e test in `traffic.spec.ts`: on a new pilot in Calder, at least 1 NPC
  appears within 25 s; Tab targets it, and the sidebar target line contains "—".
- [ ] Run `npm test` and `npm run test:e2e -- traffic sidebar flight`. Expect PASS.
- [ ] Commit `feat: traffic on screen with targeting and radar`.

### Task 8: Encounter rules (pure)

**Files:**
- Create: `src/sim/encounters.ts`
- Test: `src/sim/encounters.test.ts`

**Interfaces:**
- Consumes `EncounterDef` and `Outcome` (Task 4), and `setFlag` and `addNote`
  (Task 3).
- Produces:
  - `ENCOUNTER_CHANCE = 0.25`
  - `rollEncounter(world, data, opts: { guideActive: boolean }): EncounterDef | null`. It
    runs on arrival.
    - It returns null while the guide is active.
    - It returns null if `lastEncounterDay === world.day - 1`.
    - Otherwise it uses `mulberry32(hashString(world.seed, 'enc', world.systemId, world.day))`
      to roll the chance, then picks by weight among eligible templates.
    - An eligible template has its `when` conditions met. A `once` template is eligible
      only while flag `enc:<id>` is unset.
    - **Guaranteed templates** skip the chance roll and the not-twice rule:
      `survey-beacon` in Skerry with `survey-rumour` set and `hushwater-lane` unset, and
      `long-patience` on the first arrival in Hushwater.
  - `choiceBlock(world, data, choice): 'fuel' | 'credits' | 'cargoSpace' | null`
  - `applyChoice(world, data, def, choiceIdx, ctx: { npcName: string }): { world: WorldState; messages: string[]; missions: Mission[] }`.
    - It applies the outcomes in order.
    - Cargo is capped at the free space.
    - Fuel is clamped between 0 and capacity.
    - `reveal` uses `revealWithin` or the named systems.
    - `mission` builds a mission with the existing generator in `missions.ts`, from
      that type, with its destination set to `toSystem`'s first port or to a random
      known port 1–3 jumps away. Export a builder from `missions.ts` if needed.
    - It sets `enc:<id>` for `once` templates.
    - It sets `lastEncounterDay`.
  - `fillText(text, ctx): string`. It replaces `{ship}`, `{system}` and `{pilot}`.

- [ ] Write failing tests:
  - The guide lockout.
  - The not-twice-in-a-row rule.
  - Determinism.
  - The `when` filters.
  - "cargo outcome capped".
  - "fuel choice disabled when short".
  - Each outcome type.
  - `once` templates never repeat.
  - The guaranteed `survey-beacon` and `long-patience`.
  - Over 1000 seeded arrivals, the rate is 0.2–0.3 for a system with eligible
    templates.
- [ ] Run. Expect FAIL. Implement. Run. Expect PASS.
- [ ] Commit `feat: encounter rules`.

### Task 9: Encounters in flight (hail, site, card, notes)

**Files:**
- Create: `src/ui/encounterCard.ts`
- Modify:
  - `src/app/controller.ts`
  - `src/sim/context.ts` (new context actions `answerHail` and `openSite`)
  - `src/input/actions.ts` and `src/input/bindings.ts`: new `interact` action, flight
    group, default `['KeyY', null]`, label "Answer hail / open site"; new
    `encounterChoice1..3`, menus group, `Digit1..3`
  - `src/render/hud.ts`, `src/render/SpaceScene.ts` (site diamond, radar), `src/ui/missionLog.ts` (Notes section), `src/app/testHook.ts`
- Test: `src/sim/context.test.ts`, `src/ui/encounterCard.test.ts`, `src/app/controller.test.ts`, `tests/e2e/encounters.spec.ts` (new)

**Interfaces:**
- Produces controller state:
  - `pending: { def: EncounterDef; npcName: string; kind: 'hail'; expiresSec: number } | { def; npcName; kind: 'site'; pos: Vec2 } | null`.
  - It is set on the `arrived` event via `rollEncounter`, using an NPC name made from
    `names.json`.
- Hail: the HUD banner reads `Incoming hail — {npcName} ({key} to answer)`. It lapses
  after 30 s.
- Site: the context action `openSite` appears when the ship is within 60 px and below
  40 speed.
- `interact`, or the context button, opens `showEncounterCard(ctx, view, onChoose)`.
  - It pauses flight.
  - Each choice has a 1/2/3 hotkey. A blocked choice is disabled and shows its reason.
  - The outcome messages show on the card.
  - A Done button resumes flight.
- Test hook: `forceEncounter(id: string): void`. It places a site 200 px ahead, or
  starts a hail.
- The mission log gets a "Notes" section listing `world.notes`.

- [ ] Write failing tests:
  - "leaving system clears pending encounter".
  - A hail expires after 30 s.
  - The `openSite` context appears only within range and speed.
  - The card disables a blocked choice and shows its reason.
  - Choosing updates the world, and the new mission appears in the log.
- [ ] Run. Expect FAIL. Implement. Run. Expect PASS.
- [ ] Write e2e tests in `encounters.spec.ts`:
  - Desktop: force `stranded-passenger`, press `y`, then `1`. A mission is added, and
    Done resumes.
  - "phone hail via context button" at 844×390: force a hail, and the context button
    label reads "Answer hail". Tap it; the card is fully on screen (every button's
    bounding box is inside the viewport). Choose, then Done. No overlay remains in
    the view.
- [ ] Run `npm run test:e2e -- encounters touch`. Expect PASS.
- [ ] Commit `feat: in-flight hails and sites with encounter cards and notes`.

### Task 10: The survey-ship thread and the rare hull

**Files:**
- Modify: `src/sim/economy.ts` (`rumor`), `src/ui/missionComputer.ts`, `src/sim/shipyard.ts`, `src/ui/shipyard.ts`, `src/sim/world.ts` (built-in chart on arrival)
- Test: `src/sim/economy.test.ts`, `src/sim/shipyard.test.ts`, `src/sim/story.test.ts`, `tests/e2e/shops.spec.ts`

**Interfaces:**
- `SURVEY_RUMOUR = 'Old spacers swear a survey ship still drifts beyond Skerry, where the charts go blank.'`
- `rumor(world, data, portId)`:
  - From day 5 on, when `survey-rumour` is unset, it returns `SURVEY_RUMOUR` on 1 in 3
    days, seeded.
  - When the mission computer shows that line, it calls
    `controller.noteRumour(SURVEY_RUMOUR)`, which sets `survey-rumour` and adds a note.
- `shipQuote` blocks `requiresFlag` ships without the flag (new block `'locked'` with
  text "Ask about the old survey ship").
  - Owning a `unique` ship, or having bought it once (flag `bought:<id>`), blocks it as
    `'owned'`.
- The shipyard UI shows a locked ship as a dim silhouette tile named "???". Buy is
  disabled, and Info shows the teaser.
- A ship with `chartJumps` reveals that many jumps on every arrival.
- The `long-patience` choices:
  - "Take her log and transponder" sets `survey-claim` and adds a note: "The Free Reach
    yards at {hub} can restore the Long Patience."
  - "Strip her for parts" gives 6,000 cr and sets `survey-stripped`.
- The `survey-beacon` choice sets `hushwater-lane`, and the reveal opens the lane.

- [ ] Write failing tests:
  - The full thread: rumour → beacon → lane → Hushwater derelict → claim → the shipyard
    quote is ok at 60,000 → buy → the second quote is `owned`.
  - The stripped branch never unlocks the hull.
  - The rumour is deterministic and stops after the flag is set.
  - The chart reveals on arrival with `chartJumps`.
- [ ] Run. Expect FAIL. Implement. Run. Expect PASS.
- [ ] Write an e2e test in `shops.spec.ts`: the Free Reach hub shipyard shows the "???"
  tile with Buy disabled.
- [ ] Commit `feat: survey-ship thread, Hushwater lane and the Patience surveyor`.

### Task 11: Visual effects

**Files:**
- Modify: `src/render/SpaceScene.ts`, `src/app/controller.ts` (a short landing and take-off phase before the planet screen opens), `src/ui/planetScreen.ts` (credits count-up)
- Test: `src/app/controller.test.ts`, `src/ui/planetScreen.test.ts`

**Interfaces:**
- `LANDING_FX_SEC = 0.4`.
  - The controller delays the `landed` UI handoff by this long. A view field
    `landingT: number | null` lets the scene scale the ship from 1 to 0.2 and fade it.
  - Take-off reverses this for 0.4 s after leaving a planet.
  - Input is ignored during both phases.
- Engine flame:
  - It is drawn behind the player while thrust is applied, and behind NPCs with
    `thrusting`.
  - It is a 2–3 triangle flicker in the `fx` graphics.
- Arrival effect: for 0.5 s after `arrived`, draw reverse streaks and a fading flash
  (reuse `drawJumpFx` with the progress reversed).
- NPC jump in and out reuse the streak at the NPC's position, scaled 0.4.
- Credits count-up: when `missionsCompleted` fires, the planet screen's credits value
  animates from the old value to the new one over 0.8 s, and jumps instantly if
  `prefers-reduced-motion` is set.

- [ ] Write failing tests:
  - After landing, the `landed` UI event fires only after 0.4 s of updates.
  - Input during landing is ignored.
  - The count-up shows the final value after 0.8 s, and immediately under reduced
    motion.
- [ ] Run. Expect FAIL. Implement. Run. Expect PASS.
- [ ] Check the existing e2e land and jump suites still pass. Raise waits in
  `tests/e2e/helpers.ts` if needed.
- [ ] Commit `feat: engine flame, arrival flash, landing and take-off, credits count-up`.

### Task 12: Sound

**Files:**
- Create: `src/audio/sfx.ts`
- Modify:
  - `src/save/settings.ts`: add `muted: boolean` (default false). Keep `volume`
    (default stays 0.8, shown as 0–100).
  - `src/ui/settingsScreen.ts`: a volume slider and a mute checkbox
  - `src/input/actions.ts` and `bindings.ts`: `toggleSound`, menus group so it works
    flying and landed, default `['KeyV', null]`
  - `src/app/controller.ts` and `src/main.ts`: wire events to sounds
- Test: `src/audio/sfx.test.ts`, `src/save/settings.test.ts`, `tests/e2e/hotkeys.spec.ts`

**Interfaces:**
- Produces:
  - `type Sfx = 'thrust' | 'jump' | 'arrive' | 'land' | 'takeoff' | 'trade' | 'paid' | 'hail' | 'site'`
  - `class SoundBoard { constructor(getSettings: () => Settings, ctxFactory?: () => AudioContext); unlock(): void; play(s: Sfx): void; setThrust(on: boolean): void; muted(): boolean }`
- Behaviour:
  - Every sound is synthesised from oscillators and noise buffers plus gain envelopes,
    with no files.
  - `unlock` runs on the first pointerdown or keydown.
  - `play` does nothing when muted, when volume is 0, or before unlock.
  - The thrust hum is a looping, low-passed noise whose gain ramps over 0.1 s.
- Event mapping:
  - jump start → `jump`
  - `arrived` → `arrive`
  - landed → `land`
  - leave → `takeoff`
  - buy or sell → `trade`
  - `missionsCompleted` → `paid`
  - a pending hail → `hail`
  - a site placed → `site`
- `toggleSound` flips `muted`, saves it, and shows the message "Sound off" or
  "Sound on".

- [ ] Write failing tests with a fake AudioContext that records `createOscillator`
  calls:
  - Nothing plays before unlock.
  - Nothing plays when muted.
  - `play('jump')` creates nodes.
  - Settings migration fills `muted: false`.
- [ ] Run. Expect FAIL. Implement. Run. Expect PASS.
- [ ] Write an e2e test: press `v` in flight, and the HUD message says "Sound off" and
  the settings are saved.
- [ ] Commit `feat: synthesised sound effects with volume and mute (V)`.

### Task 13: Earning curve

**Files:**
- Modify: `data/missionTypes.json`, `data/commodities.json` (if spreads live there) or `src/sim/economy.ts` level multipliers, `src/guide/steps.ts` (`BUY_TONS = 20`)
- Test: `src/data/balance.test.ts`

**Interfaces:**
- Produces `src/sim/balance.ts` (pure, test-only helpers allowed):
  - `bestLoopPerJump(world, data, shipId): number`. This is the best 2-port round trip
    among start-known systems, in profit per jump, at base levels with no events.
  - `medianMissionPerJump(world, data, samples: number): number`. This is over
    generated offers at start-known ports that the shuttle can carry.
  - `jobsToAfford(world, data, price: number): number`. This repeatedly takes median
    offers.

- [ ] Write failing tests with the spec §7 targets:
  - `bestLoopPerJump(shuttle) >= 0.4 * medianMissionPerJump`.
  - `jobsToAfford(courier price)` is between 8 and 14.
  - The guide trade at base prices makes at least 300 cr on 20 t.
- [ ] Run. Expect FAIL, which records the current numbers in the failure output.
- [ ] Tune the levers until all three pass:
  - lower `rush.perTon` (300 → about 150);
  - lower `urgency` (rush 1.5 → about 1.25, shipment 1.2 → about 1.1);
  - widen the low/high price multipliers in `economy.ts`.

  Keep the cycle 1 and cycle 2 balance tests green.
- [ ] Run `npm test`. Expect PASS. Then run `npm run test:e2e -- trade-loop guide`.
  Expect PASS, after updating any expected numbers in those specs.
- [ ] Commit `balance: trade competes with missions; first upgrade after 8–14 jobs`.

### Task 14: Pilot card and ship naming

**Files:**
- Modify: `src/ui/mainMenu.ts`, `src/save/store.ts` (if the list rows need summary fields), `src/ui/shipyard.ts` (name prompt), `src/sim/shipyard.ts`
- Test: `src/ui/ui.test.ts` or a new `src/ui/pilotCard.test.ts`, `tests/e2e/shops.spec.ts`

**Interfaces:**
- Produces:
  - `netWorth(world, data): number`, which is credits plus `tradeInValue`.
  - `pilotCard(save: PilotSave, data): { name; shipLine: string; credits: string; netWorth: string; date: string; explored: string; jobs: string }`.
    - `shipLine` is "*{shipName}* — {hull name}".
    - `explored` is "{known visible}/{visibleSystemCount} systems".
- Main menu: each pilot row renders as a card with these lines, and keeps the
  Load/Rename/Delete buttons.
- Shipyard: after a successful buy, a name prompt appears, prefilled with the hull name,
  limited to 24 characters and cleaned like pilot names. Cancel keeps the default.
  The name is saved in `shipName`.

- [ ] Write failing tests:
  - `pilotCard` formats each line.
  - Hidden systems are excluded from the total until the flag is set.
  - A ship name over 24 characters is trimmed.
- [ ] Run. Expect FAIL. Implement. Run. Expect PASS.
- [ ] Write an e2e test: the main menu shows "systems" and "jobs" for a saved pilot.
  Buying a ship and naming it "Dawn Kettle" shows that name on the card after quitting
  to the menu.
- [ ] Commit `feat: pilot card and ship naming`.

### Task 15: Full verification and the phone pass

**Files:**
- Modify: `tests/e2e/touch.spec.ts`, `docs/design-notes.md` (built list under Expansion cycles), `src/ui/howToPlay.ts` (new keys N, Y, V and 1–3, plus a paragraph on hails and sites)

- [ ] Add a touch e2e test at 844×390: in flight, NPC sprites and the site diamond
  render inside the view, and no DOM element other than the rails and the context
  button overlaps the camera viewport.
- [ ] Update How to Play and design-notes.
- [ ] Run `npm run typecheck && npm test && npm run test:e2e`. Expect everything to pass.
- [ ] Run `npm run build`. Expect success.
- [ ] Commit `docs: how to play and notes for the living galaxy`.
