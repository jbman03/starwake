# Story Engine (Cycle 3, Plan A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a spaceport bar, a data-driven story mission engine, light faction standing,
the hidden Dimming region, the shared story arc M1–M4 (ending in the choice of side), and
side chains S1–S2.

**Architecture:**
- Story rules are pure functions in a new `src/sim/storyMissions.ts`. Flag and note
  helpers stay in the existing `src/sim/story.ts`.
- Content lives in `data/story.json`, validated by zod in `src/data/schemas.ts` and
  `src/data/load.ts`.
- Story state (`world.story`, `world.standing`) is saved in save v5.
- The controller feeds sim events to the story rules. It also owns the transient
  in-flight story sites and the "meet" ships, the same way it owns encounter `pending`.
- New UI: `src/ui/bar.ts` and a Story section in `src/ui/missionLog.ts`.

**Tech Stack:** Phaser 4, TypeScript, zod, Vite PWA, Vitest (happy-dom), Playwright.

**Spec:** `docs/superpowers/specs/2026-10-22-starwake-story-design.md` (Plan A = §2.3,
S1–S2 of §2.5, §3, §4, §5, §6, §8).

## Global Constraints

- All names and text are original, with no Escape Velocity names or text. Use the cast
  and titles from spec §2.2–§2.5.
- On phones nothing covers the game view except the bottom context button, unless the
  player opens a screen.
- Every new action gets a rebindable hotkey in `src/input/actions.ts` and
  `src/input/bindings.ts`, with conflicts checked within its group.
- Sim code stays pure and deterministic. Randomness only comes through
  `src/sim/random.ts`, seeded from `world.seed`.
- New world-space Phaser objects go through `SpaceScene.addWorldObject`.
- Commands: `npm test`, `npm run typecheck`, `npm run test:e2e`, `npm run build`.
- Phone e2e viewport: 844×390.
- Work on branch `cycle3-story-engine`. Never push or merge.

## Review Focus

1. **A v4 save loads.** It gets empty story state and no standing, and a pilot
   mid-survey-thread keeps its flags. *Test owner: Task 1.*
2. **The Dimming stays hidden before `dimming-lane`.** That includes the map, routes,
   charts, the Patience's built-in chart, NPC lanes, mission destinations and the
   explored count. *Test owner: Task 2.*
3. **Full hold or berths when accepting a story mission.** Acceptance is blocked with a
   reason, and nothing half-loads. *Test owner: Task 3.*
4. **A missed main-arc deadline.** The mission returns to its giver's bar and is never
   lost. Its cargo is removed. *Test owner: Task 3.*
5. **Leaving a system while a story site or meet ship is pending.** It clears, and it
   reappears when you come back while the step is still current. *Test owner: Task 5.*

---

### Task 1: Story schema, state and save v5

**Files:**
- Modify: `src/data/schemas.ts`, `src/data/load.ts`, `src/data/testData.ts`, `src/sim/types.ts`, `src/sim/world.ts` (`newWorld`), `src/save/pilot.ts`
- Create: `data/story.json` (`{ "missions": [] }` for now)
- Test: `src/data/load.test.ts`, `src/save/pilot.test.ts`

**Interfaces:**
- Produces these schemas and types: `StoryMissionSchema`, `StoryStepSchema` and
  `StandingLevel = 'cool' | 'neutral' | 'friend'`, following spec §5.1 exactly.
- `OutcomeSchema` gains two members:
  - `{ type: 'standing', government: id, level: StandingLevel }`
  - `{ type: 'unlock', flag: id }`
- `GameData.story: Record<string, StoryMissionDef>`.
- `ShipSchema` and `OutfitSchema` gain `requiresStanding?: { government: id, level: StandingLevel }`.
- `PlanetSchema.services` gains `'bar'`.
- WorldState gains:
  - `story: { active: { id: string; step: number; deadlineDay: number | null }[]; done: string[]; failed: string[]; declined: string[] }`
  - `standing: Record<string, StandingLevel>`
- `CURRENT_SAVE_VERSION = 5`. Migration `4:` fills the defaults.
- Loader reference checks, each failing with a path in the message: every story port,
  system, ship id, government, good and outcome reference must exist. A `meet` step's
  `shipId` must not be `unique`.

- [ ] Write the failing tests:
  - migration 4→5 defaults;
  - "v4 save mid-survey-thread keeps flags through v5";
  - story state round-trips through `pilotFromWorld` / `worldFromPilot`;
  - the loader rejects a mission whose step names an unknown planet, and one with an
    unknown step kind;
  - the loader accepts an empty `missions` list.
- [ ] Run `npm test -- load pilot`. Expect FAIL.
- [ ] Implement it.
- [ ] Run `npm test` and `npm run typecheck`. Expect PASS.
- [ ] Commit: `feat: story schema, standing and save v5`.

### Task 2: The Dimming region and per-system unlock flags

**Files:**
- Modify: `src/sim/galaxy.ts`, `src/data/schemas.ts` (`SystemSchema.unlockFlag?: id`), `src/data/load.ts`
- Modify data:
  - `data/systems.json`: 9 Dimming systems at map x 650–950, including **Gloam**, which
    gets `hiddenLinks: ["oxbow"]`. Oxbow gets `hiddenLinks: ["gloam"]`.
  - `data/governments.json`: `unlit`, "Unlit Holdings", a grey-violet colour.
  - `data/planets.json`: 5 Dimming ports with the bar. One is **Reed's Anchor**, a
    tier-3 station with a shipyard and outfitter.
  - `data/commodities.json`: `dimglass`, base price 700, with "high" buyers on Concord
    worlds.
- Test: `src/sim/galaxy.test.ts`, `src/data/load.test.ts`, `src/data/balance.test.ts`, `src/sim/traffic.test.ts`

**Interfaces:**
- Hidden systems become per-flag:
  - Every `hidden: true` system has `unlockFlag`: Hushwater uses `"hushwater-lane"`, and
    all 9 Dimming systems use `"dimming-lane"`.
  - `lanesOf(data, id, flags)` includes a lane to or from a hidden system only when that
    hidden system's `unlockFlag` is in `flags`. Lanes between two Dimming systems are
    ordinary `links`, and both ends are hidden.
  - `visibleSystems` and `visibleSystemCount` filter per system by `unlockFlag`.
  - `HIDDEN_LANE_FLAG` stays exported, with value `'hushwater-lane'`, for existing
    callers.
- Traffic: `trafficLevel` for `unlit` systems is [0, 2]. `npcLanes` already skips hidden
  systems; extend it so a hidden system whose flag is set counts as visible.

- [ ] Write the failing tests:
  - "Dimming hidden before dimming-lane", covering `mapModel`, `routeBetween` from Oxbow,
    `revealWithin`, `revealOnArrival` at Oxbow, `visibleSystemCount` and `hopDistance`;
  - all of these open once the flag is set;
  - `hushwater-lane` alone does not open the Dimming, and `dimming-lane` alone does not
    open Hushwater;
  - the loader requires `unlockFlag` on every hidden system;
  - the existing balance tests stay green: unique hold sizes, every system reachable via
    hidden links, link counts.
- [ ] Run. Expect FAIL. Implement. Run `npm test` and `npm run typecheck`. Expect PASS.
- [ ] Commit: `feat: the Dimming region behind its own hidden lane`.

### Task 3: Story rules (pure)

**Files:**
- Create: `src/sim/storyMissions.ts`
- Test: `src/sim/storyMissions.test.ts` (with fixture missions defined in the test)

**Interfaces:**
- `storyOffersAt(world, data, portId): StoryMissionDef[]`, following spec §5.3 offer
  rules. The main arc is offered in order: a main mission's `requires` must hold, and no
  other main mission may be active.
- `canAcceptStory(world, data, id): { ok: true } | { ok: false; reason: 'cargo' | 'berths' | 'active' }`.
- `acceptStory(world, data, id): WorldState`. It loads the cargo and passengers of every
  deliver or ferry step that is still to come, and sets `deadlineDay` from the first
  step that has `deadlineDays`. Load story cargo under a cargo key that the exchange
  can't sell; reuse how mission cargo is held.
- `declineStory(world, id): WorldState`. It adds the id to `declined`. A declined
  mission is offered again on a later day; it is not offered again the same day.
- `type StoryEvent = { kind: 'arrived'; systemId } | { kind: 'landed'; planetId } | { kind: 'site'; missionId } | { kind: 'card'; missionId; outcomes: Outcome[] }`.
- `advanceStory(world, data, ev): { world: WorldState; messages: string[]; completed: string[] }`.
  - It advances each active mission whose current step matches the event.
  - The final step completes the mission: `onComplete` outcomes are applied through the
    same applier as encounters (export it from encounters.ts if needed) plus standing
    and unlock.
  - The id moves to `done`.
- `checkStoryDeadlines(world, data): { world; messages }`. It runs on day advance.
  - A side mission fails: `onFail` is applied, its cargo removed, and the id moved to
    `failed`.
  - A main mission is reset: it is removed from `active`, its cargo removed, and it is
    offered again from the next day.
- `abandonStory(world, id)`. It is allowed for side missions only.
- `currentStep(world, data, id)`.
- `nextLead(world, data): { portId: string; text: string } | null`. The text is
  "Talk is that {giver.title} {giver.name} at {port} wants a pilot."
- `standingOf(world, gov): StandingLevel`.

- [ ] Write the failing tests:
  - offer conditions: `requires`, `notFlags`, `minDay`, standing, ports, main-arc order;
  - each step kind advancing on its event;
  - "full hold blocks acceptance";
  - "no berths blocks acceptance";
  - "missed main-arc deadline returns to bar";
  - a missed side deadline fails the mission;
  - abandon is refused for main;
  - standing and unlock outcomes;
  - `nextLead`;
  - determinism.
- [ ] Run. Expect FAIL. Implement. Run. Expect PASS.
- [ ] Commit: `feat: story mission rules`.

### Task 4: The spaceport bar

**Files:**
- Create: `src/ui/bar.ts`
- Modify: `src/input/actions.ts`, `src/input/bindings.ts` (`openBar`, planet group, `['KeyB', null]`, label "Spaceport Bar"), `src/ui/planetScreen.ts`, `src/app/controller.ts` (`storyOffers()`, `acceptStory(id)`, `declineStory(id)`), `src/ui/context.ts` or wherever screens are routed
- Modify data: add `'bar'` to most tier-2+ ports and every Dimming port in `data/planets.json`
- Test: `src/ui/bar.test.ts`, `tests/e2e/bar.spec.ts`

**Interfaces:**
- Consumes the Task 3 API.
- The bar screen has three parts:
  - **Contacts:** each offer as a row with giver name and title, plus the mission title.
    Selecting a row shows the offer text with Accept (Enter) and Decline. A blocked
    accept shows the reason.
  - **Gossip:** `rumor()` plus the port's description line.
  - **Lead:** `nextLead`, shown when it points to a different port.
- The Map button sits in the corner, as on the other screens.
- After Accept, the screen shows the mission's `acceptText`.
- Test hooks `storyOffers()` and `story()` are added to `src/app/testHook.ts`.

- [ ] Write the failing tests:
  - the bar lists offers;
  - Accept moves the mission to `active` and shows `acceptText`;
  - a blocked accept shows its reason;
  - Decline hides the offer for today.
- [ ] Run. Expect FAIL. Implement. Run. Expect PASS.
- [ ] E2E `bar.spec.ts`:
  - desktop: press `b` on a bar port and see the Gossip section;
  - phone 844×390: the bar opens, and every control's box is inside the viewport.
- [ ] Commit: `feat: spaceport bar`.

### Task 5: Story steps in flight (sites and meet ships)

**Files:**
- Modify: `src/app/controller.ts`, `src/sim/context.ts` (the `openSite` context also covers story sites), `src/render/SpaceScene.ts`, `src/render/sidebar.ts`, `src/ui/rails.ts` (radar), `src/sim/traffic.ts` (a pinned story NPC), `src/app/testHook.ts`
- Test: `src/app/controller.test.ts`, `src/sim/traffic.test.ts`, `tests/e2e/story.spec.ts`

**Interfaces:**
- Controller state:
  `storySite: { missionId; pos: Vec2; label: string; hiddenUntilNear: boolean } | null`
  and `storyMeet: { missionId; npcId: string } | null`.
  - Both are recomputed on `arrived`, `beginSession` and `towed` from the current step of
    each active mission in this system, and cleared on `jumped`.
  - **Scan and find sites** are placed deterministically from the mission id and system,
    600–1000 px from the system centre. A find site isn't on radar or drawn until the
    ship is within 600 px. The same reach rule as encounter sites applies (≤60 px,
    <40 speed). Interact (Y) or the context button "Scan" / "Search" fires
    `advanceStory({kind:'site'})`.
  - **Meet ships:** `addStoryNpc(traffic, { id, name, shipId, government, holdPos })`
    adds a named NPC that flies to `holdPos` and waits there. It never lands or jumps. It
    is targetable, with the label "{name} — {gov} {hull}".
    - On arrival, a meet step sets a story hail: the HUD banner on PC, and on phones the
      context button "Answer hail", using the same ranking as encounter hails.
    - Answering opens the step's card via `showEncounterCard`. Choices are gated with the
      same `choiceBlock` / `applyChoice` rules. The chosen choice's outcomes go to
      `advanceStory({kind:'card', outcomes})`.
- `arrived` calls `advanceStory({kind:'arrived'})`. Landing calls
  `advanceStory({kind:'landed'})`. Day advance calls `checkStoryDeadlines`. Messages
  show on the HUD or the planet screen.
- Test hooks: `storySite()`, `storyMeet()`, `acceptStoryNow(id)`.

- [ ] Write the failing tests:
  - "leaving system clears story site and it returns on re-entry";
  - a find site stays off radar until within 600 px;
  - a site advances the step on interact;
  - the meet NPC waits and never lands;
  - a card choice advances the step;
  - a meet hail on a phone uses the context button only.
- [ ] Run. Expect FAIL. Implement. Run. Expect PASS.
- [ ] E2E `story.spec.ts`: accept a fixture or real M1 via the hook, fly or teleport to
  Skerry, open the scan site with the hook placing the ship beside it, press `y`, and the
  log shows the next step.
- [ ] Commit: `feat: story sites and meet ships in flight`.

### Task 6: The mission log Story section and standing on the pilot card

**Files:**
- Modify: `src/ui/missionLog.ts`, `src/ui/starMap.ts` (preview a story destination), `src/ui/mainMenu.ts` (`pilotCard` standing line), `src/sim/shipyard.ts` + `src/sim/outfitter.ts` + `src/sim/stock.ts` + `src/ui/shipyard.ts` + `src/ui/outfitter.ts` (`requiresStanding` locked tile, text "Requires {Government} friendship")
- Test: `src/ui/missions.test.ts` or `src/ui/missionLog.test.ts`, `src/ui/pilotCard.test.ts`, `src/sim/shipyard.test.ts`, `src/sim/outfitter.test.ts`

**Interfaces:**
- Story section in the log:
  - It sits above Jobs and shows each active story mission: title, "from {giver}", the
    current step text, the destination, and the deadline if any.
  - **Show on map** previews the destination system. It uses `anyLane` only when that
    system is visible.
  - **Next lead** shows when nothing is active.
  - **Done** lists completed missions with their day.
  - **Abandon** appears for side missions only.
- `pilotCard(...)` adds `standing: string`, e.g. "Concord: friend · Free Reach: cool".
  Neutral governments are omitted. When all are neutral the line reads "Standing:
  neutral everywhere".
- `requiresStanding` blocks a ship quote or outfit quote with a new reason `'standing'`.
  The shipyard and outfitter show the item as a locked tile, as the Patience teaser does.

- [ ] Write the failing tests: the Story section shows step and destination; Show on
  map; Next lead; abandon only for side missions; the standing line; the standing block.
- [ ] Run. Expect FAIL. Implement. Run. Expect PASS.
- [ ] Commit: `feat: story log, next lead and standing`.

### Task 7: Story content (M1–M4, S1, S2) and the walk-through test

**Files:**
- Modify: `data/story.json`, `data/outfits.json` (Surveyor's Folio: map category, charts 6 jumps, `requiresFlag: "folio-unlocked"`, sold once at Corvana), `data/planets.json` (any bar or port tweaks needed)
- Test: `src/sim/storyWalkthrough.test.ts`, `src/data/load.test.ts`

**Content rules:**
- **M1–M4** follow spec §2.3 exactly: giver, port, steps, outcomes and values.
  - M2's deadline is 8 days.
  - M3's choices: pay 5,000 cr; trade 10 t of food (needs 10 t of food in the hold); or
    bluff, which fails the step with a message unless food is carried.
  - M3 sets `dimming-lane` and reveals Gloam plus 1 jump.
  - M4 is offered by hail on first arrival in Gloam. Its steps: go to Gloam, find the
    lantern field, meet Bram Kettle.
  - **M4's choice card** has two choices:
    - "Give the evidence to Corrin" sets `side-concord`, standing concord friend and
      free-reach cool.
    - "Sell the charts to Vey" sets `side-reach`, standing free-reach friend and
      concord cool.
    - Both pay 6,000 cr and add a note naming the patron's port.
- **S1** (3 steps) and **S2** (3 steps) follow spec §2.5. S2 unlocks the Folio.
- Every mission has original offer and accept text, 2–4 sentences each, in the tone of
  the existing encounters.
- `combatLater` is set on M3 ("a fight with the Low Tide if the bluff fails") and on M4
  ("Bram's crew may fight").

- [ ] Write the failing walk-through test. Using `newWorld` and the real rules, it plays
  M1 → M2 → M3 → M4 twice, choosing Concord in one run and Free Reach in the other. It
  asserts the flags, standings, credits, that the Dimming opens, and that S1 and S2
  complete.
- [ ] Add the loader test "every story mission is reachable": a fixed-point pass over
  the flags set by outcomes.
- [ ] Run. Expect FAIL. Write the content. Run `npm test`. Expect PASS.
- [ ] Commit: `content: the shared arc and two side chains`.

### Task 8: Verification, How to Play and design notes

**Files:**
- Modify: `src/ui/howToPlay.ts` (the bar and its B key from bindings, the Story log, standing; spoiler-light), `docs/design-notes.md` (cycle 3 Plan A built), `tests/e2e/story.spec.ts` (the M4 choice locks the other side, via hooks)

- [ ] Add an e2e test: force M4's card via hooks, choose Concord, and the pilot card
  shows "Concord: friend".
- [ ] Update How to Play and the design notes.
- [ ] Run `npm run typecheck && npm test && npm run test:e2e && npm run build`. Expect
  everything to pass.
- [ ] Commit: `docs: how to play and notes for the story engine`.
