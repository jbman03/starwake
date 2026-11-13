# Cycle 7 Part 2: Free Reach Rising Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the Free Reach Rising career arc. A new `switchArc` outcome lets a twist move the pilot into another arc. The Navy defector path is rerouted into the new arc, and Part 1 saves are moved onto it safely.

**Architecture:** Mostly data, in `data/arcs.json`, `data/story.json`, `data/planets.json` and `data/ships.json`, on the Part 1 framework. The engine adds:
- one outcome, `switchArc`, in `src/sim/arcs.ts` and `applyOutcomes`;
- a lockout check in `acceptStory`;
- a decline exception in `leads()`;
- a complete legacy start hull in `applyLegacy`;
- a load-time fix-up of Part 1 Navy defectors in `worldFromPilot`.

**Tech Stack:** TypeScript (strict), Zod, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-13-starwake-cycle7-reach-rising-design.md` (and Part 1's `2026-11-12-starwake-cycle7-arcs-design.md`).

## Global Constraints

- **Arc record:**
  - Arc id `rising`, title "Free Reach Rising", government `free-reach`; flags use the `rising-` prefix.
  - Ranks: Hand 0, Agitator 20, Organiser 50, Speaker 90.
  - Entry `rr1-free-hand`, lead "Organiser Mara Quell is looking for pilots at the Dunmore Crossing bar."
  - Legacy: text "Reach friend: every new pilot starts in a Courier, a gift from the Compact.", `shipId: "courier"`.
- **`switchArc` rules:**
  - It carries `floor(points / 2)` and leaves the old arc's points in place.
  - Its note reads "You have gone over to <title>."
  - `from` is `chosenArc`; with no arc chosen, it only sets `arc:<to>`.
- **The defector routes:**
  - N6X and N7X keep their ids but take `arc: "rising"`, and their `arcPoints` go to `rising`.
  - N7X's `navy-done` and `arcDone navy` become the flag `rising-line`.
  - Both N5 expose choices gain `switchArc rising` and the flag `rising-defector`.
  - RR5's defect choices set `navy-loyal` and `switchArc navy`.
- **Story limits:** offer and accept texts run 2–4 sentences; story pay stays at or under 2× the best trade loop per jump (the existing balance test); no arc mission uses `minDay`.
- **Run the full suite before merging** (typecheck, `npm test`, `npx playwright test -c pw.local.config.ts --trace off` with nothing else running, build). Merge `--no-ff` to `main`, then confirm the deploy and the live site.

## Review Focus

1. **A Part 1 save mid-defection** (`arc:navy`, `navy-exposed`, N6X active) loads with N6X still active and finishable, and leads present. Test in Task 3.
2. **A switch when the target arc's entry was declined today**, or the pilot already took a target-arc mission: no duplicate arc flag, and `chosenArc` is the new arc. Test in Task 1.
3. **A Reach→Navy defector is Hunted by the Reach:** no later step needs a Free Reach port. Data test in Task 4.
4. **A legacy Courier start**: the pilot card, the trade-in value and the outfits are consistent; there is no leftover shuttle outfit. Test in Task 2.
5. **Re-loading the same Part 1 save twice** doesn't halve the points twice (the fix-up is idempotent). Test in Task 3.

---

### Task 1: The `switchArc` outcome, the lockout in `acceptStory`, and the declined-arc lead

**Files:** `src/data/schemas.ts` (outcome), `src/data/load.ts` (checkOutcome: `to` must be an arc), `src/sim/arcs.ts`, `src/sim/encounters.ts`, `src/sim/storyMissions.ts` (`acceptStory`), `src/sim/leads.ts`.
**Tests:** `src/sim/arcs.test.ts`, `src/sim/leads.test.ts`, `src/data/load.test.ts`.

**Interfaces:**
- Produces:
  - Outcome `{ type: 'switchArc'; to: string }`.
  - `switchArc(world: WorldState, data: GameData, to: string): { world: WorldState; promoted: string | null }`, exported from `src/sim/arcs.ts`.

- [ ] **Step 1: Failing tests** (using `twoArcs()` from `arcsTestKit`):
  - `'switchArc moves alpha to beta: flags swap, half the points carry, rank flags and the note'`: alpha at 50 points, then switch to beta.
    - `chosenArc` is `'beta'`.
    - `flags` doesn't contain `arc:alpha` and contains `arc:beta`.
    - `arcPoints` is `{ alpha: 50, beta: 25 }`.
    - The `beta-rank-1` flag is set.
    - A note reads `'You have gone over to Beta Arc.'`.
  - `'switchArc with no arc chosen sets the target and moves nothing'`.
  - `'switchArc to the arc already chosen changes nothing'` (Review Focus 2).
  - `'acceptStory refuses a mission of a locked arc'`: take `alpha-1`, then `acceptStory(w, data, 'beta-1')` returns the same world.
  - `'a declined arc entry keeps its arc lead that day'`: `declineStory(w, 'alpha-1')`, then `leads(...)` still has the alpha arc lead.
  - In load.test: `'a switchArc to an unknown arc is refused'`.
- [ ] **Step 2:** Run `npx vitest run src/sim/arcs.test.ts src/sim/leads.test.ts src/data/load.test.ts`. Expected: the new tests FAIL.
- [ ] **Step 3:** Implement.
  - The outcome case calls `switchArc` and pushes the promotion line as `arcPoints` does.
  - In `leads.ts`, the arc-entry check uses `conditionsMet` on a world whose `story.declined` has the entry's same-day decline filtered out.
- [ ] **Step 4:** The same run PASSES, then `npx vitest run` is all green.
- [ ] **Step 5:** Commit "Arcs: switchArc outcome, lockout on take, declined arcs keep their lead".

### Task 2: A complete legacy start hull

**Files:** `src/sim/world.ts` (`applyLegacy`). **Test:** `src/sim/world.test.ts`.

**Interfaces:**
- Consumes: `yardFit(data, shipId)` from `src/sim/shipyard.ts`.
- `applyLegacy`'s signature is unchanged.

- [ ] **Step 1: Failing test**
  - `'a shipId perk gives the hull its name, its yard fit and no leftover outfits'`: fixture arc legacy `{ shipId: 'courier' }`.
  - Expect:
    - `shipId` is `'courier'`;
    - `shipName` is `data.ships.courier.name`;
    - `outfits` equals `yardFit(data, 'courier')`;
    - `crew` and `ship.fuel` match the courier;
    - `tradeInValue(w, data)` is greater than 0 (Review Focus 4).
- [ ] **Step 2:** Run it. Expected: FAIL on `shipName` or `outfits`.
- [ ] **Step 3:** Implement: `shipName: hull.name, outfits: yardFit(data, hull.id)`.
- [ ] **Step 4:** Run `npx vitest run src/sim/world.test.ts`. Expected: PASS.
- [ ] **Step 5:** Commit "Legacy: a start hull comes with its own name and fit".

### Task 3: Part 1 Navy defectors move into the new arc on load

**Files:** `src/sim/arcs.ts` (`movePart1Defector`), `src/save/pilot.ts` (`worldFromPilot` calls it). **Tests:** `src/sim/arcs.test.ts`, `src/save/pilot.test.ts`.

**Ruling (deviation from the spec):** this is done at load, in `worldFromPilot`, not as a v12 save migration. Migrations here are data-free, and this needs the arcs' rank data. The save version stays 11. The effect is the same, and it is idempotent.

**Interfaces:**
- Consumes: `switchArc` (Task 1).
- Produces: `movePart1Defector(world: WorldState, data: GameData): WorldState`.
  - It applies only when `data.arcs.rising` exists, the flags include `arc:navy` and `navy-exposed`, and do not include `navy-done`.
  - Then it applies `switchArc(world, data, 'rising')` and adds `rising-defector`.
  - Otherwise it returns `world` unchanged.

- [ ] **Step 1: Failing tests**, using test data with a fixture `rising` arc added to `twoArcs()` (the shipped arc arrives in Task 4):
  - `'a Part 1 exposed Navy pilot is moved to rising with half the points and rising-defector'`.
  - `'running it twice changes nothing more'` (Review Focus 5).
  - `'a Navy pilot who finished (navy-done) is left alone'`.
  - `'a loyal Navy pilot is left alone'`.
  - In pilot.test: `'a v11 save of an exposed Navy pilot loads as a Free Reach Rising pilot'`.
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3:** Implement, and call it at the end of `worldFromPilot`.
- [ ] **Step 4:** Run `npx vitest run src/sim/arcs.test.ts src/save`. Expected: PASS.
- [ ] **Step 5:** Commit "Saves: Part 1 Navy defectors carry on into Free Reach Rising".

### Task 4: The Free Reach Rising arc (content)

**Files:**
- `data/arcs.json` (the `rising` arc).
- `data/story.json`:
  - new missions `rr1-free-hand`, `rr2-charters`, `rr3-picket-captain`, `rr4-ferrymans-cargo`, `rr5-price-of-lanterns`, `rr6-open-the-lanes`, `rr7-free-compact`;
  - edits to `n5-cold-cores`, `n6x-running-dark` and `n7x-lantern-fire`.
- `data/planets.json` (`hollis-free-market`, a station in hollis: `appearsFlag: "rising-market"`, services exchange, missions and bar, with a market).
- `data/ships.json` (`lane-runner`: a fast trader sold at `redwater-sound`, `requiresFlag: "rising-rank-2"`, `requiresStanding` free-reach friend).
- Tests: `src/sim/storyArcRising.test.ts`; extend `src/sim/storyArcNavy.test.ts` and `src/data/load.test.ts`.

**Interfaces:**
- Consumes: Tasks 1–3, and `storyKit` (`play` handles `decide`).
- Mission details, flags, points and steps are exactly as in the spec's table, plus "Settled after the builder check" items 1 and 4. RR4 grants Free Reach friend (so the Lane Runner is reachable).
- RR6's card has two choices:
  - "Take Hollis peacefully";
  - "Blockade it", with `commit` and Concord heat 40.
- Each RR3 choice: "Bluff past" / "Turn her" (commit) / "Run", with the heats in the spec.

- [ ] **Step 1: Failing tests** in `storyArcRising.test.ts`, with `PORTS` and `walk()` as in `storyArcNavy.test.ts`:
  - `'the rising arc: ranks, legacy courier, RR1 commit, RR4 giver is the stranger'`.
  - `'rising loyal: RR1–RR7; hollis, minster, corvana Free Reach; Hollis Free Market in the view; 90 points; arcdone:rising'`.
  - `'Reach→Navy defector: RR1–RR5 defect, then N6L, N7L; chosenArc navy; arcPoints.navy 65; Hunted by the Reach; arcdone:navy'`.
  - `'Navy→Reach defector: N1–N5 expose, then N6X, N7X, RR6, RR7; chosenArc rising; arcPoints.rising 105; arcdone:rising and not arcdone:navy'`.
  - `'each RR3 choice leads on to RR4'`.
  - `'the Royce-only defect choice needs rising-royce'`.
  - `'a lead exists at every step of every path'` (folded into `walk()`).
  - In storyArcNavy.test, update the exposed-path test to the new route (N7X no longer finishes the Navy arc).
  - In load.test, extend the heat-safety test: a group with `switchArc` also gates the target arc's missions on the flags set beside it (Review Focus 3).
- [ ] **Step 2:** Run `npx vitest run src/sim/storyArcRising.test.ts src/sim/storyArcNavy.test.ts src/data`. Expected: FAIL.
- [ ] **Step 3:** Write the data.
  - Original prose in the house tone.
  - New names: Mara Quell, Ada Royce, Ivo Sand (`stranger: true`, note "The ferry captain had the quartermaster's careful hands.") and the Hollis Free Market.
- [ ] **Step 4:** Run `npx vitest run`. Expected: all PASS.
  - The existing data tests (sentence counts, pay cap, reachability, heat safety) must hold. Adjust the prose or pay, never the tests' rules.
- [ ] **Step 5:** Commit "Story: the Free Reach Rising arc, and the Navy defector carries on into it".

### Task 5: E2e, help text, docs, full suite and merge

**Files:**
- `tests/e2e/arcs.spec.ts`
- `src/app/testHook.ts`, if a load-from-save helper is needed
- `src/ui/howToPlay.ts` (Career arcs: switching sides) and `src/ui/howToPlay.test.ts`
- `public/editor-guide.html` (`switchArc`)
- `docs/design-notes.md`
- `tests/e2e/bar.spec.ts` (already strips arc missions; it needs no change)

- [ ] **Step 1: Failing tests**
  - In howToPlay.test: Missions contains `'switch sides'`.
  - In arcs.spec:
    - `'take the Reach commission at Dunmore Crossing: confirm, then the Leads log shows the ferry to Redwater Sound'`: teleport to `dunmore-crossing`, B, pick "A Free Hand", Accept, Confirm.
    - `'a Part 1 save of an exposed Navy pilot loads with Running Dark offered at Dunmore Crossing'`: put a v11 save with `arc:navy` and `navy-exposed` in the store through the test hook, load it, teleport to Dunmore Crossing, B; the bar lists "Running Dark".
    - `'a forced switchArc shows Free Reach Rising on the pilot card'`: `applyOutcomesNow([{type:'flag',flag:'arc:navy'},{type:'switchArc',to:'rising'}])`, save, go to the main menu; the card shows `Free Reach Rising: Hand`.
- [ ] **Step 2:** Run `npx vitest run src/ui/howToPlay.test.ts` and `npx playwright test -c pw.local.config.ts tests/e2e/arcs.spec.ts --trace off`. Expected: FAIL.
- [ ] **Step 3:** Implement the text and docs, plus any test-hook helper.
- [ ] **Step 4:** Run the full suite (see Global Constraints). Expected: all green. Rerun any flake on its own on a quiet machine, and name it in the report.
- [ ] **Step 5:** Commit. Run the final whole-branch review and its fix pass. Merge `--no-ff` to `main`, push, confirm the Deploy run succeeds, and confirm the live site serves the new script hash.
