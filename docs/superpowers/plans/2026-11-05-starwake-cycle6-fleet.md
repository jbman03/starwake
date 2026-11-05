# Cycle 6, part 2 — Crew, wingmen, carriers and a nemesis: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish cycle 6: crew and wingmen (Part A), carriers and fighters (Part B), a nemesis (Part C), each its own tested merge.

**Architecture:** Everything builds on the escort group. New tunables live in `data/fleet.json` (`FleetSchema`, `GameData.fleet`), one section per part. Crew is a number on the world. Wingmen are escorts with a `wingmanId`. Fighters are escort NPCs that are not in the saved list (their docked count is an outfit count). The nemesis is a raider NPC with a `nemesis` flag and a small saved record.

**Tech Stack:** TypeScript, Phaser 4, Zod, Vitest, Playwright.

**Spec:** docs/superpowers/specs/2026-11-05-starwake-cycle6-fleet-design.md

## Global Constraints

- Old saves (v1–v8) must load; corrupt new fields never fail a load.
- PC and phone (844×390) both work; the PC sidebar still fits 1280×600.
- UI only through `el()`, `button()` and `textContent`.
- The sim stays pure, seeded and fixed-step: no `Math.random` or `Date` in `src/sim`.
- Every tunable is in `data/fleet.json`.
- No model names in code, docs or commit subjects. Commit messages end with the session's two attribution trailers.
- Before each merge: `npm run typecheck`, `npx vitest run`, the full Playwright suite and `npm run build` pass.

## Part A — Crew and wingmen (save v9)

### Decisions (where the spec leaves a choice)

1. `fleet.json` starts with `crew` and `wingmen`; `FleetSchema` makes `fighters` and `nemesis` optional until their parts land, then required.
2. `WorldState.crew` is a plain number. `crewCap(world, data) = data.ships[world.shipId].crew`.
3. Capture losses are applied in `combatControl.boardChoose` through pure `crewAfterCapture(world, data, won)`.
4. `Escort` gains optional `wingmanId`, `takedowns` and `downUntilDay`. A downed wingman stays in the list but is never spawned (like `waiting`), never draws wages, and `escortsJump` leaves it alone.
5. Takedowns: `stepBattle`'s `disabled`/`destroyed` events gain `escortId` (the escort NPC that dealt the hit). `creditWingmen(world, data, events)` counts `disabled` events by a wingman and returns HUD lines (takedown line, rank-up).
6. Damage bonus: `Npc.damageMul` (optional, set by `escortNpc` from the wingman's rank). `stepBattle` step 5 multiplies a hit's damage by its owner's `damageMul`.
7. Ejecting: `escortLosses` turns a destroyed wingman into `downUntilDay = day + recoverDays` with message `<name>: <eject line>` instead of removing it. `landEscorts` brings back any whose day has come (armor full, outfits = hull default), with the `back` line as a notice.
8. Wingman offers: `wingmanOffer(world, data, portId)` returns the pilot whose `homePort` is this port when the port has a bar, kills ≥ `requiresKills` and no escort has that `wingmanId`. Recruit: `recruitWingman`, refusals reuse `hireRefusal`.
9. Planet screen: "Hire crew" row (bar ports, crew below complement) and a "Wingman" section (when an offer exists), in the actions column next to the escort lists, `data-testid` `hire-crew` and `wingman-offer`.
10. Save v9: `crew` with `.catch(-1)` (−1 = full); escort entries keep `wingmanId` (string or absent), `takedowns` (≥ 0 integer), `downUntilDay` (finite or absent).

### Task A1: Fleet data and schema
- [x] `data/fleet.json` with `crew` and `wingmen` (four pilots, ranks, recoverDays).
- [x] `FleetSchema` in `schemas.ts`, `GameData.fleet`, loader key `fleet`, testData, load.test `raw()`.
- [x] Cross-checks: wingman `shipId` known and not unique-only; `homePort` known with a bar; ranks ascending from 0; ids unique.
- [x] Tests for the schema and cross-checks.

### Task A2: Crew
- [x] `src/sim/crew.ts`: `crewCap`, `crewHireCost`, `hireCrew`, `crewAfterCapture`.
- [x] `newWorld` full crew; `buyShip` full crew; `takeCommand` crew capped; `podRescue`/death reset full.
- [x] `captureOdds` uses `world.crew`.
- [x] Boarding card shows crew and losses; capture applies losses.
- [x] Tests.

### Task A3: Wingmen rules
- [x] `src/sim/wingmen.ts`: `wingmanOffer`, `recruitWingman`, `wingmanRank`, `damageMulOf`, `creditWingmen`.
- [x] `escorts.ts`: `payWages`, `landEscorts`, `escortLosses` handle wingmen; `escortNpcs.ts` skips downed and sets `damageMul`; `escortsJump` leaves downed alone.
- [x] `battle.ts`: `escortId` on events; `damageMul` on hits.
- [x] Controller: credit wingmen after each battle tick, recruit/hire-crew methods.
- [x] Tests.

### Task A4: Save v9
- [x] Migration 8 → 9, schema, `pilotFromWorld`, `worldFromPilot`, tolerant loading; tests.

### Task A5: UI and docs
- [x] Planet screen rows; escort list shows rank / "recovering until <date>".
- [x] How to Play: "Crew" and "Wingmen" in the Escorts tab; README; roadmap.
- [x] E2E `tests/e2e/fleet.spec.ts`: hire crew, recruit a wingman, a wingman takedown is counted.

### Task A6: Verify, merge, deploy
- [x] typecheck, vitest, Playwright, build; merge to `main`; Deploy green; site loads.

## Part B — Carriers and fighters (no save change)

### Decisions

1. **Data.** Outfit categories `bay` (`effect: { fighter, rate }`) and `fighter` (`effect: { shipId }`); outfits gain optional `hulls` (hull classes allowed to fit it). `fighter-bay` (carrier hulls only) and `wasp-fighter`; hull `wasp` (role and hull `fighter`, never sold: `soldAt: []`, never spawned: role weight 0, excluded from raider hulls and bounty targets). The NPC Bastion loadout gains a bay and 4 Wasps. `fleet.fighters`: `fighterDistance`, `dockRadius`.
2. **Capacity.** `fighterCap(outfits, fighterId)` = the fighter's `max` × bays launching it (as `ammoCap`). The outfitter refuses a fighter with no bay (`noBay`: "Needs a fighter bay") and a bay on the wrong hull (`hull`: "Only a carrier can fit this.").
3. **Fighter NPCs.** `Npc.fighter?: { outfitId: string; carrierId: string }`. Player fighters: id `esc-f<n>` (player side by prefix), `role: 'escort'`, `government: ''`, carrier `player`. NPC fighters: id `<carrierId>-f<n>`, the carrier's role, government and aggro.
4. **Launch and recall** live in `stepBattle` (like `cycleSecondary`): `Battle.launchQueue` (fighters still to launch) and `Battle.recall` (true while recalled). A press with fighters out recalls them; otherwise it queues every docked fighter. One launches per bay `rate` (cooldown key `player:<bayId>`), spawned at the player's position and velocity. Events: `{ type: 'fighters', what: 'launched' | 'recalled' | 'docked' }`.
5. **Fighter steering.** Player fighters run the escort branch with their own slot arc at `fighterDistance`. While recalled their slot is the player's position, they ignore targets, and they dock within `dockRadius` (removed; the outfit count goes up). NPC fighters run `decide()`; in errand mode with their carrier present they fly to it and dock the same way; without a carrier they leave with traffic.
6. **NPC carriers** launch while their decision is `attack`, one per bay rate, while fighters remain in their outfits.
7. **Docking on leaving.** `dockFighters(world, traffic)` before every jump, landing, tow and pod rescue: every player fighter that is not disabled goes back into the outfit count; disabled ones are lost. `fighterLosses` says "A Wasp is lost." for each player fighter destroyed in battle.
8. **Counting.** Fighters out count as escorts present (so ORDER shows and orders work); the sidebar line counts them too.
9. **Controls.** Action `launchFighters` (default KeyU, flight group, "Launch / recall fighters"). Phone: a LAUNCH button sharing the ORDER row (half width each), shown with a bay and fighters docked or out; the row shows when either button does.

### Task B1: Data, schema, sprite and icons
### Task B2: Fighters sim (`src/sim/fighters.ts`), battle hooks, controller lifecycle
### Task B3: Outfitter rules and UI, controls (key and phone), How to Play, README, roadmap
### Task B4: E2E (`tests/e2e/carriers.spec.ts`): buy a bay and Wasps, launch with U, recall, dock on landing; phone LAUNCH
### Task B5: Verify, merge, deploy

## Part C — Nemesis (outline; detailed before it starts)

`fleet.nemesis`; `WorldState.nemesis`; save v10; `src/sim/nemesis.ts` (spawn roll, defeat, final); controller hooks on arrival, battle events, death and tow; test hook `spawnNemesis`; docs; e2e.
