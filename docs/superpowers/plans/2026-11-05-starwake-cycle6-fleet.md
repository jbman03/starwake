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
- [ ] `data/fleet.json` with `crew` and `wingmen` (four pilots, ranks, recoverDays).
- [ ] `FleetSchema` in `schemas.ts`, `GameData.fleet`, loader key `fleet`, testData, load.test `raw()`.
- [ ] Cross-checks: wingman `shipId` known and not unique-only; `homePort` known with a bar; ranks ascending from 0; ids unique.
- [ ] Tests for the schema and cross-checks.

### Task A2: Crew
- [ ] `src/sim/crew.ts`: `crewCap`, `crewHireCost`, `hireCrew`, `crewAfterCapture`.
- [ ] `newWorld` full crew; `buyShip` full crew; `takeCommand` crew capped; `podRescue`/death reset full.
- [ ] `captureOdds` uses `world.crew`.
- [ ] Boarding card shows crew and losses; capture applies losses.
- [ ] Tests.

### Task A3: Wingmen rules
- [ ] `src/sim/wingmen.ts`: `wingmanOffer`, `recruitWingman`, `wingmanRank`, `damageMulOf`, `creditWingmen`.
- [ ] `escorts.ts`: `payWages`, `landEscorts`, `escortLosses` handle wingmen; `escortNpcs.ts` skips downed and sets `damageMul`; `escortsJump` leaves downed alone.
- [ ] `battle.ts`: `escortId` on events; `damageMul` on hits.
- [ ] Controller: credit wingmen after each battle tick, recruit/hire-crew methods.
- [ ] Tests.

### Task A4: Save v9
- [ ] Migration 8 → 9, schema, `pilotFromWorld`, `worldFromPilot`, tolerant loading; tests.

### Task A5: UI and docs
- [ ] Planet screen rows; escort list shows rank / "recovering until <date>".
- [ ] How to Play: "Crew" and "Wingmen" in the Escorts tab; README; roadmap.
- [ ] E2E `tests/e2e/fleet.spec.ts`: hire crew, recruit a wingman, a wingman takedown is counted.

### Task A6: Verify, merge, deploy
- [ ] typecheck, vitest, Playwright, build; merge to `main`; Deploy green; site loads.

## Part B — Carriers and fighters (outline; detailed before it starts)

Outfit categories `bay` and `fighter`, optional outfit `hulls`; hull `wasp` (role and hull `fighter`, sprite); `fleet.fighters`; `src/sim/fighters.ts` (launch, recall, dock, loss); battle hook for NPC carriers; action `launchFighters` (KeyL) and phone LAUNCH; outfitter refusal; docs; e2e.

## Part C — Nemesis (outline; detailed before it starts)

`fleet.nemesis`; `WorldState.nemesis`; save v10; `src/sim/nemesis.ts` (spawn roll, defeat, final); controller hooks on arrival, battle events, death and tow; test hook `spawnNemesis`; docs; e2e.
