# Cycle 7 Part 1: Branching Storylines Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Data-driven story arcs that lock each other out, branch on choices, change the galaxy map and leave legacy perks. Plus a Leads log, and the Concord Navy arc as the first arc.

**Architecture:**
- Arcs live in `data/arcs.json`. Their missions stay in `data/story.json`, tagged with the arc id.
- Map changes are a saved `world.galaxy` list. `applyGalaxy()` folds it into the `GameData` view the controller
  hands out, so existing readers need no edits.
- New outcomes go through the one shared `applyOutcomes`. Legacy is a device-wide IndexedDB record.

**Tech Stack:** TypeScript (strict), Zod, Vitest (happy-dom), Playwright, idb-keyval, Phaser 4 (untouched).

**Spec:** `docs/superpowers/specs/2026-11-12-starwake-cycle7-arcs-design.md`

## Global Constraints

- Save version goes from 10 to **11**. The migration adds `galaxy: { governments: {}, destroyed: [] }` and `arcPoints: {}`. Nothing else changes.
- Arc flag `arc:<id>`; rank flag `<arc>-rank-<k>`; done flag `arcdone:<id>`.
- Navy ranks: Ensign 0, Lieutenant 20, Commander 50, Captain 90.
- Navy legacy: `credits: 5000`, text "Navy veteran: your old commander sends 5,000 cr to every new pilot."
- Commit confirm copy: title "This choice can't be undone", body `<label>?`, buttons "Confirm" and "Back".
- Untaken-arc lead tag: "Story arc: <title>. Taking it closes the other arcs."
- Original assets only. New hulls use the procedural sprites. No arc mission uses `minDay`.
- Keep the live game playable. Run the full suite (typecheck, `npm test`, `npm run test:e2e`, `npm run build`) before merging to `main`.
- Local e2e in this container: `npx playwright test -c pw.local.config.ts` (uncommitted; points at `/opt/pw-browsers/chromium`, video off).

## Review Focus

1. **The pilot is landed at a planet the story destroys, or one that hasn't appeared yet** (also reachable through a plug-in). The game must not crash or soft-lock. Expect take-off at its last position. Test in Task 2.
2. **A save made mid-arc reloads with the changed map:** governments still flipped, the station still gone. Test in Task 2, with a round trip through `pilotFromWorld` and the loader.
3. **A commit choice is cancelled with Back:** nothing applies and the card stays open. Test in Task 4.
4. **Closing a `decide` card without choosing**, then landing elsewhere and coming back: the card shows again and the step is not lost. Test in Task 4.
5. **The legacy store can't be read or written** (private mode, IndexedDB error): new-pilot creation and the arc ending still work, with no perk. Test in Task 6.

---

### Task 1: Schemas, loader checks and plug-in support for arcs

**Files:**
- Create: `data/arcs.json` as `{ "arcs": [] }` (Navy content comes in Task 7)
- Modify: `src/data/schemas.ts`, `src/data/load.ts`, `src/plugins/format.ts` (`LIST_KEYS`, `listOf`)
- Test: `src/data/load.test.ts`, `src/plugins/format.test.ts`

**Interfaces:**
- Produces:
  - `ArcSchema` / `type ArcDef = { id; title; government; blurb; entry: { mission: string; lead: string }; ranks: { title: string; points: number }[]; legacy: { text: string; credits?: number; shipId?: string; flag?: string } }`.
  - `GameData.arcs: Record<string, ArcDef>`.
  - `StoryMissionDef.arc: string`.
  - `StoryMissionDef.commit?: true`.
  - `giver.stranger?: true`.
  - Choices: `commit?: true`.
  - Step `{ kind: 'decide'; planet: string; card: EncounterCard; text: string }`.
  - Outcomes:
    - `{ type: 'government'; system; government }`
    - `{ type: 'destroyPlanet'; planet }`
    - `{ type: 'heat'; government; n }`
    - `{ type: 'arcPoints'; arc; n }`
    - `{ type: 'arcDone'; arc }`
  - `PlanetDef.appearsFlag?: string`.

- [ ] **Step 1: Write the failing loader tests**
  - `'an arc whose entry mission is missing or tagged with another arc is refused'`: expect `parseGameData` to throw, with a message naming the arc id.
  - `'a story mission arc must be main, concord, reach, side or an arcs.json id'`.
  - `'ranks start at 0 points and rise'`: the first rank has points 0, and the points strictly increase.
  - `'outcomes naming an unknown system, planet, government or arc are refused'`.
- [ ] **Step 2:** Run `npx vitest run src/data/load.test.ts`. Expected: the new tests FAIL.
- [ ] **Step 3:** Add the schemas and the cross-reference checks next to the existing story checks in `load.ts`. Then add `arcs` to the plug-in `LIST_KEYS`, with `listOf` reading `raw.arcs.arcs` the way it reads `raw.story.missions`.
- [ ] **Step 4:** Run `npx vitest run src/data src/plugins` and `npx tsc --noEmit`. Expected: PASS.
- [ ] **Step 5:** Commit "Arcs: schemas, loader checks, plug-in record type".

### Task 2: Galaxy overlay, the new map outcomes and save v11

**Files:**
- Create: `src/sim/galaxyOverlay.ts`
- Modify:
  - `src/sim/types.ts` (`galaxy`, `arcPoints` on `WorldState`)
  - `src/sim/world.ts` (`newWorld` defaults)
  - `src/sim/encounters.ts` (`applyOutcomes` cases `government`, `destroyPlanet`, `heat`)
  - `src/save/pilot.ts` (v11 schema and migration)
  - `src/app/controller.ts` (`data` getter)
- Test: `src/sim/galaxyOverlay.test.ts`, `src/save/pilot.test.ts`, `src/app/controller.test.ts`

**Interfaces:**
- Consumes: the Task 1 outcome types, and `PlanetDef.appearsFlag`.
- Produces:
  - `applyGalaxy(base: GameData, world: Pick<WorldState, 'galaxy' | 'flags'>): GameData`. It returns `base` itself when nothing applies, and is memoised per base on `JSON.stringify(galaxy) + appearing flags`.
  - `WorldState.galaxy: { governments: Record<string, string>; destroyed: string[] }`.
  - `WorldState.arcPoints: Record<string, number>`.
  - The controller keeps `baseData` and exposes `get data(): GameData`, returning `applyGalaxy(this.baseData, this.world)`.

- [ ] **Step 1: Write the failing tests**
  - `applyGalaxy`:
    - `'returns the base data unchanged with no changes'`: `toBe(base)`.
    - `'overrides a system government'`.
    - `'drops destroyed planets and planets whose appearsFlag is unset, keeping them once the flag is set'`.
    - `'returns the same object for the same changes'`.
  - `applyOutcomes`: `government` sets `galaxy.governments`; `destroyPlanet` appends once; `heat` makes `legalStatus(...)` `'hunted'` at n=100.
  - Save: `'a v10 save migrates to v11 with an empty galaxy and arcPoints'`, and `'a save with a flipped system and a destroyed station round-trips'` (Review Focus 2).
  - Controller: `'a destroyed planet the pilot is landed at: leavePlanet takes off at its last position without throwing'` (Review Focus 1). Set `world.galaxy.destroyed = ['halcyon-test-port']`, using a test-data port, while landed.
- [ ] **Step 2:** Run the named tests. Expected: FAIL.
- [ ] **Step 3:** Implement. `leavePlanet` and `departFrom` read the planet from `baseData` when the view no longer has it.
- [ ] **Step 4:** Run `npx vitest run` (the full unit suite: the getter touches every controller reader) and `npx tsc --noEmit`. Expected: PASS.
- [ ] **Step 5:** Commit "Galaxy overlay: story map changes, heat outcome, save v11".

### Task 3: Arc lockout, points and ranks

**Files:**
- Create: `src/sim/arcs.ts`
- Modify:
  - `src/sim/storyMissions.ts` (`conditionsMet` lockout; `acceptStory` sets `arc:<id>`)
  - `src/sim/encounters.ts` (`arcPoints` and `arcDone` cases)
  - `src/ui/mainMenu.ts` (`pilotCard.rankLines`)
- Test: `src/sim/arcs.test.ts`, `src/ui/pilotCard.test.ts`

**Interfaces:**
- Produces:
  - `chosenArc(world, data): string | null`: the id behind the `arc:<id>` flag.
  - `arcLocked(world, data, arcId): boolean`: true when another arc is chosen.
  - `arcRank(world, data, arcId): number`: the index into `ranks`.
  - `addArcPoints(world, data, arcId, n): { world: WorldState; promoted: string | null }`. It sets `<arc>-rank-<k>` for each rank reached, and its note reads "Promoted to <title> (<arc title>)".
  - `arcDone` sets `arcdone:<id>`.
  - Rank line: `"<arc title>: <rank title>"`, with `" (struck off)"` appended when the flag `<arc>-exposed` is set.

- [ ] **Step 1: Write the failing tests**
  - `'taking an arc mission sets arc:<id> and hides the other arc's missions from bars, hails and offers'`. Uses a fixture with two arcs, `alpha` and `beta`.
  - `'points cross 20 and 50: Lieutenant, then Commander; each flag set once'`.
  - `'the pilot card shows "Concord Navy: Lieutenant", then "(struck off)" after navy-exposed'`.
- [ ] **Step 2:** Run `npx vitest run src/sim/arcs.test.ts src/ui/pilotCard.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement. `applyOutcomes`' `arcPoints` case calls `addArcPoints` and pushes the promotion line into `messages`.
- [ ] **Step 4:** Run the tests again. Expected: PASS.
- [ ] **Step 5:** Commit "Arcs: lockout on first mission, arc points and ranks".

### Task 4: The `decide` step and commit confirms

**Files:**
- Modify:
  - `src/sim/storyMissions.ts` (`stepMatches`: `card` also matches `decide`; new `pendingDecide(world, data, planetId): StoryMissionDef | null`)
  - `src/app/controller.ts` (`decideCard()`; the `chooseStory` path reused for decide)
  - `src/ui/planetScreen.ts` (opens the card on mount after the completion dialog)
  - `src/ui/encounterCard.ts` (confirm on a `commit` choice)
  - `src/ui/bar.ts` (confirm on Accept for a `commit` mission)
- Test: `src/sim/storyMissions.test.ts`, `src/ui/encounterCard.test.ts`, `src/ui/planetScreen.test.ts`, `src/ui/bar.test.ts`

**Interfaces:**
- Consumes: `EncounterView`; the `showEncounterCard(ctx, view, onChoose)` contract; `confirmDialog` from `src/ui/dom.ts` (use the dialog the Mission Log's Abandon uses).
- Produces:
  - `EncounterView.choices[i].commit?: boolean`.
  - `Controller.decideCard(): { missionId: string; view: EncounterView } | null`, set while landed at a pending decide port.
  - `Controller.chooseDecide(idx): { messages: string[] } | null`.

- [ ] **Step 1: Write the failing tests**
  - `'landing at a decide step's port opens its card; a choice applies its outcomes and finishes the step'`.
  - `'closing the card without choosing keeps the step; landing there again reopens it'` (Review Focus 4).
  - `'a commit choice asks "This choice can't be undone"; Back applies nothing and keeps the card'` (Review Focus 3). Also: `'Confirm applies it'`.
  - `'a commit mission's Accept in the bar asks the same confirm'`.
- [ ] **Step 2:** Run the four test files. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the tests again. Expected: PASS.
- [ ] **Step 5:** Commit "Story: decide cards on landing, and confirms before choices that can't be undone".

### Task 5: The Leads log

**Files:**
- Create: `src/sim/leads.ts`
- Modify: `src/ui/missionLog.ts` (a Leads section at the top replaces the "Next lead" line); `src/ui/bar.ts` (the lead line uses `leads()`)
- Test: `src/sim/leads.test.ts`, `src/ui/missions.test.ts`

**Interfaces:**
- Consumes: `currentStep`, `stepSystem`, `storyOffersAt`, `storyHailAt`, `chosenArc`.
- Produces:
  - `type Lead = { kind: 'active' | 'offer' | 'arc'; text: string; why: string; systemId: string | null }`.
  - `leads(world, data): Lead[]`, ordered active, then offer, then arc.
    - Active: text `"<title>: <step text>"`, why `"for <giver name>"`.
    - Offer: text `"<giver name> at <port name>: <title>"`.
    - Arc: text = `entry.lead`, why = the untaken-arc tag from Global Constraints.
  - `nextLead` is kept, as a wrapper returning the first offer lead (the existing tests rely on it).

- [ ] **Step 1: Write the failing tests**
  - `'a new pilot has the Navy arc lead and the Lanterns offer'`: run against the fixture arc and `newWorld`.
  - `'an active mission's lead names its step and system'`.
  - `'after choosing an arc, other arcs' leads are gone'`.
  - `'a side chain waiting only on minDay leads with "From <formatted date>"'`. Use `formatDate` from `src/sim/calendar.ts`; such an offer lead gets the why `From <date>`.
  - `'the Mission Log shows a Leads section with Show on map per lead'`.
- [ ] **Step 2:** Run `npx vitest run src/sim/leads.test.ts src/ui/missions.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the tests again. Expected: PASS.
- [ ] **Step 5:** Commit "Leads log: every story thread's next step, in the Mission Log and the bar".

### Task 6: Legacy perks

**Files:**
- Create: `src/save/legacy.ts`
- Modify:
  - `src/app/controller.ts` (after each save, merge the `arcdone:*` flags into the legacy record)
  - `src/ui/mainMenu.ts` (`newPilot` applies the perks; the prompt dialog shows a "Legacy" list)
  - `src/sim/world.ts` (`applyLegacy(world, data, arcsDone): WorldState`)
- Test: `src/save/legacy.test.ts`, `src/sim/world.test.ts`, `src/ui/mainMenu.test.ts` (or the existing main-menu test file)

**Interfaces:**
- Produces:
  - `loadLegacy(): Promise<{ arcsDone: string[] }>`: never rejects, and resolves `{ arcsDone: [] }` on error.
  - `recordArcsDone(ids: string[]): Promise<void>`: never rejects. Uses the IDB key `legacy`, in the same `createStore(PILOT_DB, …)` store as the pilots, filtered out of `PilotStore.list()`.
  - `applyLegacy`: adds credits, swaps in the start hull with full fuel and armor, sets the flags.

- [ ] **Step 1: Write the failing tests**
  - `'recordArcsDone merges and dedupes'`.
  - `'applyLegacy adds 5,000 cr for navy and ignores unknown arc ids'`.
  - `'a legacy store that throws: loadLegacy gives none and newPilot still creates the pilot'` (Review Focus 5).
  - `'PilotStore.list ignores the legacy key'`.
- [ ] **Step 2:** Run the named tests. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the tests again. Expected: PASS.
- [ ] **Step 5:** Commit "Legacy: finished arcs give every new pilot a perk".

### Task 7: The Concord Navy arc (content)

**Files:**
- Modify:
  - `data/arcs.json` (the `navy` arc as in the spec §1 example)
  - `data/story.json` (missions `n1-commission`, `n2-picket`, `n3-convoy`, `n4-ledger`, `n5-cold-cores`, `n6l-hold-the-line`, `n7l-the-commons`, `n6x-running-dark`, `n7x-lantern-fire`)
  - `data/planets.json` (`freehold-light`: a station in hollis with `appearsFlag: "navy-freehold"`, services `exchange, missions, bar`, an original description)
  - `data/ships.json` (`picket-cutter`, sold at `lamplight-yards`, `requiresFlag: "navy-rank-2"`, `requiresStanding` concord friend; stats between `kestrel` and `warden`, fast and light-armored)
- Create: `src/sim/storyArcNavy.test.ts` (use `storyTestKit.ts` as the Concord and Reach arc tests do)
- Test: `src/data/load.test.ts` (the data safety rules)

**Interfaces:**
- Consumes: everything above.
- The mission table, flags, points, outcomes and the givers (Idris Hale; Sable Wren with `stranger: true`; Tamsin Vey) are exactly as in the spec §3 table and its bullets.
- `navy-exposed` is set by both expose choices in N5, along with `heat concord 100`, `standing concord cool`, and `standing free-reach neutral` or `friend`.
- N7X sets `navy-freehold` and `government hollis free-reach`.
- N6L sets brannock and thistle to concord. N7L sets wrenhold to concord, and its destroy choice also does `destroyPlanet the-commons`.
- Both endings: `arcDone navy` and `navy-done`.

- [ ] **Step 1: Write the failing tests**
  - Walkthroughs: `'loyal path: N1 to N7L destroying The Commons; brannock, thistle and wrenhold are Concord, the-commons is gone, rank Captain, arcdone:navy'`. Also `'loyal path, surrender: the-commons stays'`. Also `'exposed path: N1 to N7X; the pilot is Hunted by the Concord; hollis is Free Reach; Freehold Light is in the view'`.
  - `'each of the three convoy choices leads on to N4'`.
  - `'the mercy-only expose choice needs navy-mercy'`.
  - `'a lead exists at every step of both paths'`.
  - Data safety:
    - `'no step after a destroyPlanet names that planet'`.
    - `'no step after a heat outcome needs a port of that government'`.
    - `'the start planet is never destroyed'`.
    - `'no arc mission uses minDay'`.
- [ ] **Step 2:** Run `npx vitest run src/sim/storyArcNavy.test.ts src/data`. Expected: FAIL.
- [ ] **Step 3:** Write the data.
  - All the prose is original, in the house tone (plain, warm, dry). Use short sentences, as in `data/story.json`.
  - N1 and the three commit choices carry `commit: true`.
  - N1's offer text says that taking it commits the pilot to the Navy.
  - N4 adds the note "The quartermaster's eyes did not match her papers."
- [ ] **Step 4:** Run `npx vitest run`. Expected: all PASS. The existing story tests must still pass, because Halcyon's bar now also offers N1.
- [ ] **Step 5:** Commit "Story: the Concord Navy arc".

### Task 8: Editor, help text, e2e, docs and the merge

**Files:**
- Modify:
  - `src/editor/*`: add `arcs` to the Editor's collections if its forms come from `LIST_KEYS` and the schemas. If they don't, leave the Editor unchanged.
  - `public/editor-guide.html` (arcs, the new outcomes, `decide`, `appearsFlag`, `commit`)
  - `src/ui/howToPlay.ts` (a "Story arcs" section: choosing one closes the others, the Leads log, legacy)
  - `docs/design-notes.md` (the cycle 7 Part 1 entry)
  - The spec's decisions section, if anything changed while building.
- Create: `tests/e2e/arcs.spec.ts`
- Test: `src/ui/howToPlay.test.ts`, `tests/e2e/plugins.spec.ts` (the guide section list)

- [ ] **Step 1: Write the e2e tests in `tests/e2e/arcs.spec.ts`**
  - `'take the Navy commission at Halcyon: the confirm shows, Back cancels, Confirm takes it; the Mission Log Leads shows the ferry to Vanterre'`.
  - `'a forced N6L outcome recolours brannock on the Star Map'`: through the test hook, apply `{type:'government',system:'brannock',government:'concord'}`, then open the map and check the brannock node's dot fill equals Concord's colour.
  - Add test-hook helpers to `src/app/testHook.ts` if needed: `applyOutcomesNow(outcomes)`.
- [ ] **Step 2:** Run `npx playwright test -c pw.local.config.ts tests/e2e/arcs.spec.ts --trace off`. Expected: FAIL, then PASS after the hook exists.
- [ ] **Step 3:** Update the help text, the Editor guide and the design notes.
- [ ] **Step 4: Full suite**
  - Run `npm run typecheck`, `npm test`, `npm run build`, and `npx playwright test -c pw.local.config.ts --trace off` (about 13 min; run it in the background).
  - Expected: all pass. A failure must be fixed or shown to fail on `main` too, as the plug-in reload race was.
- [ ] **Step 5: Merge and deploy**
  - Merge `claude/cycle7-arcs` into `main` with `--no-ff`, then push with up to 4 retries.
  - Confirm that the Deploy run for the merge commit succeeds (`mcp__github__actions_list` `list_workflow_runs`).
  - Confirm that `curl -fsS https://jbman03.github.io/starwake/` serves the new script hash.
