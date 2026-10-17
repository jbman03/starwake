# Starwake: Beginner Guide

**Date:** 2026-10-17
**Status:** Approved direction (owner: "go with the recommendations" → option C, built after cycle 1)
**Builds on:** foundation + cycle 1 (trade, missions, galaxy)

## 1. Purpose

New players land at Halcyon with no explanation. Give them (a) an interactive
**First Flight** walkthrough that teaches the core loop by doing it — buy low,
fly a route, sell high, take a job — and (b) a **How to Play** reference they can
open any time.

## 2. First Flight walkthrough

### 2.1 When it runs
- After **New Pilot** is created, a dialog asks: "Take the guided first flight?
  (about 5 minutes)" — **Start guide** / **Skip**.
- Can be restarted from **Settings → General → Replay first flight** or the
  **Replay first flight** button in **How to Play** (applies to the current
  pilot; starts at step 1 at the current planet if it has a guided trade,
  otherwise from the flight steps). The skip and offer dialogs point to both
  ("Settings → General or How to Play (H)").
- Progress is stored per pilot id in localStorage (`starwake.guide.<pilotId>` =
  `{ step, done, target, buyPort, … }`), so a reload resumes the guide. Not part
  of the save. Older progress without `buyPort` takes the port the target is
  picked from (the current or start planet), else switches to fallback.
- **Reload reconciliation:** guide progress is saved every step but the pilot
  only on landing, so after a reload the hold may not have the purchase. On
  resume and on every update, when not in fallback, on steps 3–9 and with less
  than 10 t of {good} aboard: landed at `buyPort` → rewind to step 2; anywhere
  else → switch to fallback (step 10 becomes "check the prices at {port}").

### 2.2 Steps (each completes automatically when the player does the thing)

| # | Where | Hint (keyboard / touch wording adapts) | Completes when |
|---|---|---|---|
| 1 | Planet | "Welcome to Halcyon. Open the **Commodity Exchange** (C)." | exchange opened |
| 2 | Exchange | "**{good}** is cheap here. Buy 10 t (B)." / touch: "{good} is cheap here. Buy 10 t." Off the exchange: "Open the exchange (C) and buy 10 t of {good}." Away from the buy port: "…at {buyPort}." (good = a Low classic good at this port that is High at a known port within 3 jumps) | hold contains ≥ 10 t of {good} |
| 3 | Exchange → Planet | On the exchange: "Close the exchange (Esc) and open the **Mission Computer** (M)." / "Tap Done, then Mission Computer." On the planet screen (where Esc is Leave): "Open the Mission Computer (M)." / "Tap Mission Computer." | mission computer opened, **or** in flight, **or** the port has no Mission Computer |
| 4 | Missions | "Jobs pay when you land at their destination. Accept one if you like, then close (Esc)." / "Jobs pay on arrival. Take one, or tap Done." | not on the mission computer |
| 5 | Planet | "**Leave** the planet (L)." | in flight |
| 6 | Flight | "Fly: ↑ thrust, ← → turn, X stop." / "Push the stick to fly, STOP to brake." | ship has moved ≥ 300 px from where it started |
| 7 | Flight | "Open the **Star Map** (M) and set a course to **{system}**. {good} pays well there." (N on a planet) / touch: "Tap the radar. Set course to {system}." in flight, "Tap Star Map. Set course to {system}." on the planet screen | route's final system = {system} (or already there) |
| 8 | Flight | "Fly clear of the star (G autopilot) and **Jump** (J). Repeat until you arrive in {system}." / "To {system}: fly clear, tap Jump. Repeat." While no course leads to {system}, step 8 shows the step 7 plotting text again (it does not drop back a step). | arrived in {system} |
| 9 | Flight | "Land at **{port}** (Tab to target, L to land)." / "Tap {port} to land." | landed at {port} |
| 10 | Planet → Exchange | "Open the exchange (C) and **Sell all** your {good}." / "Exchange: Sell all {good}." Fallback: "Open the exchange at {port} and check the prices: {good} pays well here." / "Exchange: {good} pays well." | hold has 0 t of {good} (fallback: exchange opened at {port}) |
| 11 | Done | "Nice trade! You made **N cr**. Tips: refuel before long trips, check the Mission Log (K), and watch for market news." | dismissed |

- {good}/{system}/{port} are chosen once at guide start, deterministically,
  from the real data and saved with the progress.
- If the player goes off-script (e.g. jumps elsewhere), the hint stays and the
  step still completes when its condition becomes true; route-dependent steps
  re-target to {system} by name.
- **Mission steps (3–4) are optional:** leaving, or a port without a Mission
  Computer (e.g. Merrow, Pell), completes step 3 and step 4 completes off the
  mission computer, so the guide flows on to Leave / Fly.
- **Touch wording is shortened** so every rail hint fits 3 lines (≤ 44
  characters with the longest names in the data); it names only controls on
  the current screen.
- Trade wording says "cheap here" / "pays well", never Low/High, so it cannot
  contradict the exchange's live price level.
- Steps never block play and never trigger actions themselves.

### 2.3 Where hints appear (respects "never cover the game view")
- **Screens (planet, exchange, missions, map):** a callout card at the bottom of
  the panel, above the buttons, inside the panel's layout (not overlaying it).
- **Flight, desktop:** a hint bar under the HUD at the top-left, within the HUD
  column (not over the view's center).
- **Flight, phone:** the hint shows inside the **left rail**, below the HUD
  (wrapping up to 3 lines); the rail's layout budget accounts for it. Nothing
  is added to the clear game-view region.
- Every hint has **Skip guide** (asks to confirm; marks done).
- Hotkey names in hints come from the player's actual bindings.

## 3. How to Play reference

- Opens from **main menu**, **pause menu** and **planet screen** ("How to Play",
  hotkey **H** in planet/menus groups; rebindable).
- Tabs: **Flying**, **Planets & trade**, **Missions**, **Travel & fuel**,
  **Controls**. Controls lists every action with its current key(s) on PC and the
  phone equivalents (stick, STOP, FIRE, context button, radar).
- Short, accurate text; textContent only; fits 844×390; buttons ≥ 44 px.

## 4. Code shape
- `src/guide/steps.ts` — pure step definitions: `{ id, text(ctx), done(state) }`
  over a small `GuideState` snapshot (screen, world, landedPlanetId, flags).
- `src/guide/guide.ts` — runtime: picks the trade target, tracks progress,
  persists it, emits the current hint; subscribes to controller/UI events.
- `src/ui/guideHint.ts` — renders the callout in screens / HUD / rail.
- `src/ui/howToPlay.ts` — the reference screen.
- No changes to sim rules.

## 5. Testing
- Unit: each step's completion predicate; target selection (deterministic,
  valid, reachable); progress persistence + resume; skip; wording adapts to
  input mode and bindings.
- e2e (desktop): new pilot → Start guide → follow every step using the hint's
  instructions → final "Nice trade" with positive profit; reload mid-guide
  resumes the step. Phone (844×390): hint sits inside the left rail during
  flight and inside panels on screens; no overlap with the clear region.
- e2e: How to Play opens from main menu and pause; Controls tab lists current keys.
