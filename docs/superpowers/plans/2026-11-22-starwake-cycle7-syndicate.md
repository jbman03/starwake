# Cycle 7 Part 3: The Syndicate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Add the Syndicate career arc as data, on the existing framework.
**Spec:** `docs/superpowers/specs/2026-11-22-starwake-cycle7-syndicate-design.md`

## Global Constraints

- **Ids:** the government is `syndicate` ("Syndicate of the Hollow", `#e05fb0`); the arc is `syndicate`, and its flags
  use the `syndicate-` prefix.
- **Ranks:** Runner 0, Fixer 20, Underboss 50, Boss 90.
- **Legacy:** `credits: 7500`, text "Old favours: every new pilot starts with 7,500 cr of the Syndicate's laundered
  money."
- **Story limits:** offer and accept texts run 2–4 sentences; pay stays within the cap; no `minDay`; port names fit
  the phone rail; every hull's hold size is distinct.
- **Merge rule:** run the full suite with nothing else running, then the final review, then merge and confirm the
  deploy.

## Review Focus

1. A Syndicate→Reach defector never needs a Syndicate or Concord port: RR6 and RR7 are at Wrenhold and in space.
   Data test, Task 1.
2. A loyal pilot with 50 Concord heat (SY2 plus running the blockade) is never sent to a Concord port after SY3.
   Data test plus walkthrough, Task 1.
3. A `syndicate` system spawns no raiders and no patrols. Unit test, Task 1.

### Task 1: The government, the arc data and the walkthroughs

- **Files:**
  - `data/governments.json`, `data/arcs.json`, `data/story.json` (`sy1-quiet-cargo` … `sy7-boss-of-the-rim`),
    `data/planets.json` (`the-undermarket`), `data/ships.json` (`nightjar`).
  - Tests: `src/sim/storyArcSyndicate.test.ts`, plus one spawn test in `src/sim/traffic.test.ts`.
- **Tests:**
  - `'the syndicate arc: ranks, legacy, SY1 commit, SY4 stranger, nightjar gate'`.
  - `'syndicate loyal SY1–SY7 …'`.
  - `'Syndicate→Reach …'`.
  - `'Syndicate→Navy via the inspector …'`.
  - `'each SY3 choice leads on to SY4'`.
  - `'the inspector-only choice needs syndicate-inspector'`.
  - `'a syndicate system has no raider or patrol chance'`.
- **Steps:** red → write the data → `npx vitest run` green → commit.

### Task 2: E2e, help text, docs, full suite, review and merge

- **Files:** `tests/e2e/arcs.spec.ts` (SY1 at Merrow with its confirm; a forced
  `government vesk syndicate` shows Vesk's dot in pink on the Star Map), `docs/design-notes.md`.
- **Steps:** red → green → full suite → commit → final review and fix pass → merge `--no-ff` → confirm the live site.
