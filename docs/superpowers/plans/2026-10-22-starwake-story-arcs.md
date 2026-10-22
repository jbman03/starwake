# Story Arcs (Cycle 3, Plan B) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fill the Plan A story engine with content:
- the Concord "Relight" arc (C1–C7) and the Free Reach "Free Lanes" arc (R1–R7);
- side chains S3–S8;
- the unique Lantern-tender and Freewind runner hulls;
- the unique outfits House Rack, Cold Hold and Keeper's Lens;
- a balance pass and a full both-sides walk-through test.

**Architecture:** This is mostly data. Content goes in `data/story.json`, `data/ships.json` and `data/outfits.json`, validated by the existing loader. The rules in `src/sim/storyMissions.ts` stay as they are unless a task names a gap. Tests drive the real rules: `acceptStory`, `advanceStory`, `answerStoryHail`, `choiceBlock`, `applyOutcomes`.

**Tech Stack:** TypeScript, zod, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-22-starwake-story-design.md`. Plan B covers §2.4, S3–S8 of §2.5, §7 and §8 (the walk-through).

## Global Constraints

- All names and text are original, with no Escape Velocity names or text.
  - Use the cast from spec §2.2: Sela Corrin, Tamsin Vey, Odo Haskett, Mags Orrin (*Low Tide*), Bram Kettle, Ama Reed.
  - The tone is warm, a little wry and short. Offer and accept texts are 2–4 sentences each.
  - Never use the name "Jory".
- No combat. Steps that will become fights carry a `combatLater` note.
- Hold sizes stay unique across all hulls (balance test). **Ruling:** the spec's 60 t Lantern-tender collides with the Mule and its 30 t Freewind collides with the Warden. Use **64 t** and **32 t**.
- Key names in UI text come from bindings (`k(...)`), never hardcoded.
- Work happens in the worktree `C:\Users\jbman\Projects\space-game-arcs` on branch `cycle3-story-arcs`. Never push or merge. Never touch the main checkout at `C:\Users\jbman\Projects\space-game`.
- Commands, run in the worktree: `npm test`, `npm run typecheck`, `npm run build`, and e2e as set up in Task 1.

## Review Focus

1. **Each side can finish its arc from a fresh pilot, and the locked-out side never offers.** Owner: Task 6, the walk-through.
2. **No soft-locks.** Every hidden-system step requires its unlock flag, every destination is plottable, and a main-arc deadline returns the mission to its bar. Owner: Tasks 2–5, through the loader's reachability and unlock validation.
3. **Unique rewards are sold once.** They appear only after friend standing plus the arc-done flag, and the shipyard teases them before that. Owner: Task 1.
4. **Earning curve.** Story pay doesn't swamp trade and jobs. Owner: Task 6, the balance test.
5. **Save and load mid-arc** keeps the current step, cargo and pending meet. Owner: Task 6.

---

### Task 1: Rewards data and a worktree-safe e2e port

**Files:**
- Modify: `vite.config.ts`, `playwright.config.ts`, and `package.json` if needed
- Modify: `data/ships.json`, `data/outfits.json`
- Test: `src/data/balance.test.ts`, `src/sim/shipyard.test.ts`, `src/sim/outfitter.test.ts`

**Interfaces:**
- **E2E port:** the Vite dev port and the Playwright `baseURL`/`webServer.port` read `process.env.SW_PORT`, defaulting to 5173. In this worktree, e2e runs as `SW_PORT=5174 npx playwright test …` so it never reuses another checkout's server on 5173. Document it in a comment in `playwright.config.ts`.
- **Hulls:**
  - `lantern-tender`: Concord, price 180000, cargo 64, good fuel range, a sturdy mid-hull.
    - `unique: true`, `soldAt: ["concordance"]`, `requiresFlag: "concord-done"`, `requiresStanding: { government: "concord", level: "friend" }`.
  - `freewind`: Free Reach, price 150000, cargo 32, fast, with the longest jump range in the game (the most fuel jumps of any hull).
    - `unique: true`, `soldAt: ["wrenhold"]`, `requiresFlag: "reach-done"`, `requiresStanding: { government: "free-reach", level: "friend" }`.
  - Pick the other stats to fit their roles among the existing hulls, and give a one-line reason for each.
- **Outfits**, each `unique`, `requiresFlag`, `soldAt`, and sold once:
  - `house-rack`: cargo, +8 t, flag `house-rack-unlocked`, sold at `redwater-sound`.
  - `cold-hold`: cargo, +12 t, flag `cold-hold-unlocked`, sold at `quillon-spires`.
  - `keepers-lens`: map that charts every Dimming system. Use a mapJumps value large enough to cover the Dimming from where it is sold. Flag `keepers-lens-unlocked`, sold at `reeds-anchor`.
- Every new item has original description text.

- [ ] Write the failing tests:
  - each hull is locked before its flag and standing are met;
  - each hull is buyable once both are met, then `owned`, then `gone` after a trade-in;
  - each outfit follows the same lifecycle;
  - hold sizes are unique;
  - the Freewind has the most fuel jumps of any hull.
- [ ] Run `npm test`. Expect FAIL.
- [ ] Implement it, then run `npm test` and `npm run typecheck`. Expect PASS.
- [ ] Run one e2e spec with `SW_PORT=5174 npx playwright test tests/e2e/bar.spec.ts`. Expect PASS.
- [ ] Commit `feat: unique story rewards and a configurable e2e port`.

> Note: final pay lives in data/story.json after the Task 6 balance pass; the figures in the tables below are the first draft.

### Task 2: The Concord arc, "Relight" (C1–C7)

**Files:**
- Modify: `data/story.json`
- Test: `src/sim/storyArcConcord.test.ts`

**Content** (spec §2.4). The arc is `concord`, given by Warden Sela Corrin. Every mission requires `side-concord` and has `notFlags: ["side-reach"]`. The arc is offered in order from the Concordance bar, or by hail where noted.

| # | Title (yours) | Steps | Outcome |
|---|---|---|---|
| C1 | ferry lane engineers | ferry 3 passengers to Reed's Anchor | 6,000 cr |
| C2 | deliver lantern cores | deliver 6 t of cores to a Dimming port within 10 days | 7,000 cr |
| C3 | relight three lanterns | go and scan in three different Dimming systems | 9,000 cr; flag `lanterns-relit` |
| C4 | Bram's surrender | meet Bram Kettle in the Dimming. Card: offer terms (ends peacefully) or threaten (also ends; note). `combatLater` set | 6,000 cr |
| C5 | the charter | land at Ama Reed's port and deliver the charter (1 t) | 6,000 cr |
| C6 | escort the liner | go to and scan two Dimming systems ahead of the charter liner, then land at Reed's Anchor | 8,000 cr |
| C7 | the ceremony | land at Concordance | 10,000 cr; flag `concord-done`; standing concord friend; note: "Concordance yards will build you a Lantern-tender." |

Use only step kinds that already exist: go, land, deliver, ferry, scan, find, meet. Every Dimming step requires `dimming-lane`, which the shared arc guarantees via `side-concord`. Add `dimming-lane` to `requires` if the loader's unlock validation asks for it.

- [ ] Write the failing test. From a world that has finished M4 with Concord, play C1→C7 through the real rules. Assert:
  - the credits, flags and standing at the end;
  - the Lantern-tender quote is ok at Concordance;
  - no `side-reach` arc mission is ever offered.
- [ ] Run. Expect FAIL. Write the content. Run `npm test`. Expect PASS. The loader's reachability, unlock and sentence-count tests must pass too.
- [ ] Commit `content: the Concord arc`.

### Task 3: The Free Reach arc, "Free Lanes" (R1–R7)

**Files:**
- Modify: `data/story.json`
- Test: `src/sim/storyArcReach.test.ts`

**Content** (spec §2.4). The arc is `reach`, given by Tamsin Vey. Every mission requires `side-reach` and has `notFlags: ["side-concord"]`. It is offered from the Wrenhold bar.

| # | Steps | Outcome |
|---|---|---|
| R1 | deliver lane charts (2 t) to an independent port | 6,000 cr |
| R2 | ferry 4 settler delegates from a Dimming port to Wrenhold within 12 days | 7,000 cr |
| R3 | meet Bram Kettle; card: broker back-pay (needs 4,000 cr, refunded by the outcome) or promise a share | 8,000 cr; flag `salvagers-paid` |
| R4 | place waylights: go and scan in three Dimming systems | 9,000 cr |
| R5 | the cordon: meet a Concord patrol captain (original name) in Oxbow; card: take the long route (costs fuel) or the quiet route (needs `salvagers-paid`); `combatLater` set | 6,000 cr |
| R6 | ferry Ama Reed to Wrenhold | 6,000 cr |
| R7 | the signing: land at Wrenhold | 10,000 cr; flag `reach-done`; standing free-reach friend; note: "The Wrenhold yards will fit you a Freewind runner." |

- [ ] Write the failing test. It is the mirror of Task 2 for Free Reach, and it asserts the Freewind quote is ok at Wrenhold.
- [ ] Run. Expect FAIL. Write the content. Run `npm test`. Expect PASS.
- [ ] Commit `content: the Free Reach arc`.

### Task 4: Side chains S3–S5

**Files:**
- Modify: `data/story.json`
- Test: `src/sim/storySides.test.ts`

**Content** (spec §2.5):
- **S3, The Pilgrim Road.** 4 steps, each ferrying the pilgrims on to the next of four shrine worlds you choose across the galaxy (the original 21 systems only). Pays credits 3,000 per leg and adds a note at the end.
- **S4, Two Houses.** The Marlow and Teague haulers feud; you side with one. Offered at the Redwater Sound bar. 3 steps:
  1. land at Redwater Locks;
  2. meet a Marlow or Teague hauler in Oxbow, with a card to choose a house. This sets `house-marlow` or `house-teague`;
  3. deliver 5 t back to Redwater Sound.

  Either branch completes, then `unlock house-rack-unlocked`.
- **S5, The Collector.** Offered at the Quillon Spires bar. Bring Halcyon Copperwine, Vesk Glowmoss and Stillwater Pearl. Each good uses a step whose meet card has a `needs.cargo` choice that hands the goods over through a negative cargo outcome. Then `unlock cold-hold-unlocked`.
  - Stillwater Pearl comes from Hushwater, so S5's offer requires `hushwater-lane`. Use the commodity ids in `data/commodities.json`.

- [ ] Write the failing test: each chain completes through the real rules and its unlock flag is set. S4 is tested on both branches.
- [ ] Run. Expect FAIL. Write the content. Run. Expect PASS.
- [ ] Commit `content: side chains S3 to S5`.

### Task 5: Side chains S6–S8

**Files:**
- Modify: `data/story.json`
- Test: `src/sim/storySides.test.ts`

**Content:**
- **S6, Echoes of the Long Patience.** Requires `survey-claim`. Offered at the Skerry Light bar. Two steps:
  1. scan in Hushwater;
  2. land at Skerry Light.

  Pays credits and adds a rumour.
- **S7, The Doctor's Rounds.** Medical deliveries to three fringe ports, each with a deadline of 6–8 days. Uses the existing `medical` good as named story cargo, "clinic crates".
- **S8, The Last Lightkeeper.** Offered at a Dimming bar. Requires `dimming-lane`. Three steps:
  1. find the keeper's dead lantern;
  2. meet the keeper (original name);
  3. land at Reed's Anchor.

  Ends with `unlock keepers-lens-unlocked`.

- [ ] Write the failing test: each chain completes. S7 fails if its deadline is missed, and it can be abandoned.
- [ ] Run. Expect FAIL. Write the content. Run. Expect PASS.
- [ ] Commit `content: side chains S6 to S8`.

### Task 6: Balance pass and the full walk-through

**Files:**
- Modify: `src/sim/storyWalkthrough.test.ts` (extend), `src/data/balance.test.ts`, `data/story.json` (pay tuning only)
- Test: the same files, plus `src/app/controller.test.ts` (save and load mid-arc)

- [ ] Write the failing tests:
  - **Full walk-through per side:** a fresh world plays M1→M4, then the whole side arc, then every side chain whose requirements that side can meet. Assert final credits within a band and the unique hull buyable. Twice, once per side.
  - **Balance:**
    - the total story credits from M1 through either arc end lie between 70,000 and 110,000;
    - no single story mission pays more than 12,000;
    - per jump, story pay stays within 2× the best trade loop (`bestLoopPerJump`).
  - **Save and load mid-arc:** a Concord pilot saved mid-C4 in the meet system has the meet ship and hail back after load.
- [ ] Run. Expect FAIL. Tune pay in `story.json` until every test passes.
- [ ] Commit `balance: story pay and the full walk-through`.

### Task 7: Docs and verification

**Files:**
- Modify: `docs/design-notes.md` (Plan B built), `src/ui/howToPlay.ts` (a spoiler-light line saying that choosing a side opens a story arc and rare ships), `tests/e2e/story.spec.ts` (e2e: a Concord pilot with `concord-done` and friend standing sees the Lantern-tender as buyable at Concordance)

- [ ] Add the e2e test and the doc updates.
- [ ] Run `npm run typecheck && npm test && SW_PORT=5174 npm run test:e2e && npm run build`. Expect everything to pass.
- [ ] Commit `docs: story arcs in how to play and notes`.
