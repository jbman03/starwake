# Starwake Beginner Guide Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** An interactive First Flight walkthrough (buy low → route → jump → land → sell high) plus a How to Play reference screen.

**Architecture:** Pure step definitions and target selection in `src/guide/`, a small runtime that tracks progress per pilot in localStorage and exposes the current hint, and UI that renders hints inside existing panels, the desktop HUD column and the phone left rail (never over the clear game view).

**Tech Stack:** existing (TypeScript, Phaser 4, Vite, Vitest + happy-dom, Playwright).

**Spec:** `docs/superpowers/specs/2026-10-17-starwake-beginner-guide-design.md`

## Global Constraints
- Nothing new may cover the clear game-view region in flight on phone; hints in flight go in the left rail (phone) or under the HUD at top-left (desktop).
- Hint text uses the player's actual key bindings (`hotkeyFor`) and adapts to input mode (keyboard vs touch).
- Guide never triggers game actions; it only observes. Skip asks to confirm.
- Progress key: `starwake.guide.<pilotId>` = `{ step: number; done: boolean; good; system; port; startCredits }`; storage failures must not crash (fall back to in-memory).
- All text original; textContent only; screens fit 844×390; buttons ≥ 44 px.
- `src/sim` unchanged.

## Review Focus
1. Reload mid-guide → resumes the same step with the same targets. (G1)
2. Player goes off-script (sells early, jumps elsewhere) → guide doesn't break or crash; step completes when its condition becomes true. (G1)
3. No eligible trade target at the start planet (e.g. replay at a fringe port) → guide starts from the flight steps with a fallback target or explains, never throws. (G1)
4. Phone flight hint never overlaps the clear region at 844×390, 780×360, 932×430. (G2)
5. Guide + completion dialog + mission notices on the same planet screen don't stack unreadably. (G2)

---

### Task 1: Guide core (steps, targets, progress, runtime)

**Files:** Create `src/guide/steps.ts`, `src/guide/target.ts`, `src/guide/progress.ts`, `src/guide/guide.ts`, tests next to each.

**Interfaces:**
- `GuideState { screen: 'planet'|'exchange'|'missions'|'map'|'flight'|'other'; world: WorldState; landedPlanetId: string|null; startPos?: Vec2 }`
- `GuideTarget { good: string; system: string; port: string }`; `pickTarget(world, data, portId): GuideTarget | null` — deterministic: a classic good `low` at `portId`, `high` at an exchange port in a known system within 3 hops (fewest hops, then id order); null if none.
- `STEPS: StepDef[]` (11 entries per spec §2.2) with `id`, `text(ctx: { target, mode: 'keyboard'|'touch', key: (a: ActionId) => string, profit?: number, data })`, `done(s: GuideState, t: GuideTarget, p: Progress): boolean`.
- `loadProgress(pilotId)`, `saveProgress(pilotId, p)`, `clearProgress(pilotId)` with storage-failure fallback.
- `class Guide { constructor(controller, data, deps: { mode(): 'keyboard'|'touch'; bindings(): Bindings; storage?: Storage }); start(): boolean /* false if no target and not resumable */; skip(); update(state: GuideState); current(): { text: string; step: number; total: number } | null; on('change', fn) }`. When there's no target (Review Focus 3), the guide starts at step 5 (Leave) with a target chosen from the nearest port that sells any low good, or returns false.
- [ ] Tests first: every step's `done` predicate (true/false cases); `pickTarget` returns a reachable High port for Halcyon and is stable; resume after reload (new Guide instance reads saved step/targets); off-script cases (sold early before step 10 → step 10 completes immediately when reached; jumped to a different system → step 8 waits); skip marks done; text uses bindings and mode; storage throwing → still works. Prove key ones by mutation.
- [ ] Implement; full `npm test`, typecheck, build.
- [ ] Commit `feat(guide): first-flight steps, targets and progress`

### Task 2: Guide UI (start/skip/replay, hints in panels, HUD and rail)

**Files:** Create `src/ui/guideHint.ts`; modify `src/ui/mainMenu.ts` (offer after New Pilot), `src/ui/planetScreen.ts`, `src/ui/exchange.ts`, `src/ui/missionComputer.ts`, `src/ui/starMap.ts` (callout slot), `src/render/hud.ts` / `src/render/hudInfo.ts` (desktop hint line), `src/ui/rails.ts` + `src/input/touch.ts` (rail hint area within the rail budget), `src/ui/settingsScreen.ts` (Replay first flight), `src/main.ts`/`src/ui/context.ts` (wire the Guide), tests + `tests/e2e/guide.spec.ts`.

**Interfaces:**
- `mountGuideHint(container: HTMLElement, guide: Guide, opts: { onSkip })` renders `current()` text + "Skip guide"; updates on `change`.
- The UI feeds `guide.update(state)` on screen changes and every ~250 ms in flight.
- New-pilot dialog: "Take the guided first flight? (about 5 minutes)" — Start guide / Skip.
- [ ] Tests first (happy-dom): hint renders in planet/exchange/missions/map panels; skip confirm; replay resets progress. e2e desktop: full walkthrough following hint text to "Nice trade" with profit > 0; reload mid-guide resumes. e2e phone 844×390 + 780×360 + 932×430: flight hint inside the left rail, no overlap with the clear region; screens fit.
- [ ] Implement; full suites incl. e2e.
- [ ] Commit `feat(ui): first-flight guide hints and controls`

### Task 3: How to Play reference

**Files:** Create `src/ui/howToPlay.ts` + test; modify `src/input/actions.ts`/`bindings.ts` (`howToPlay` action, KeyH, planet + menus groups as separate ids if needed), `src/ui/mainMenu.ts`, `src/ui/pauseMenu.ts`, `src/ui/planetScreen.ts`, README (mention), `tests/e2e/howtoplay.spec.ts`.

**Interfaces:**
- `showHowToPlay(ctx, { onClose })` with tabs Flying / Planets & trade / Missions / Travel & fuel / Controls; Controls generated from `ACTION_IDS`, `ACTION_LABEL`, current bindings (both slots) plus a phone column.
- [ ] Tests first: each tab renders; Controls reflects a rebound key; opens from main menu, pause and planet; fits 844×390.
- [ ] Implement; full suites.
- [ ] Commit `feat(ui): How to Play reference`
