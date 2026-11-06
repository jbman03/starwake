# Starwake Editor and plug-ins: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Plug-ins anyone can make in a Starwake Editor page and turn on in the game.

**Architecture:** `src/plugins/format.ts` (Zod schema for a plug-in file, `applyPlugins(raw, packs)`), `src/plugins/store.ts` (IndexedDB, `idb-keyval`), `src/data/load.ts` gains `loadRawGameData()`, boot applies enabled plug-ins and falls back to the plain data, `src/ui/pluginsScreen.ts` on the main menu. Part B adds `editor.html` + `src/editor/` (a Vite page). Part C adds forms, a map view, a guide and `public/plugins/sample.starwake.json`.

**Spec:** docs/superpowers/specs/2026-11-06-starwake-editor-design.md

## Constraints

- The base game always boots: plug-in errors never block it.
- Plug-ins change list records only (spec §2).
- UI with `el()` / `button()`; strict TS; tests for every rule.
- Commit trailers as the session supplies; full suite and CI green before each merge.

## Part A — format, loader, Plug-ins screen

- [x] A1 `src/plugins/format.ts`: `PluginSchema`, `LIST_KEYS`, `applyPlugins`, `checkPlugin(baseRaw, pack)` (returns issues), `pluginSummary`. Tests.
- [x] A2 `src/plugins/store.ts`: list, put, setEnabled, remove; tests with fake-indexeddb.
- [x] A3 `loadRawGameData()` in `load.ts`; `bootData()` in `src/plugins/boot.ts`: base + enabled plug-ins, fallback with the error. Wire into `main.ts`. Tests.
- [x] A4 `src/ui/pluginsScreen.ts` and the main-menu button; import (file), toggle, remove, Restart now; e2e.
- [x] A5 Docs (README, How to Play note), verify, merge, deploy.

## Part B — the Editor page

- [x] B1 `editor.html` + `src/editor/main.ts` as a second Vite input; PWA precache.
- [x] B2 `src/editor/model.ts`: the plug-in being edited (localStorage), record CRUD, templates from base records, validation via `checkPlugin`.
- [x] B3 UI: details, type list, record list, JSON editor with live errors, Export / Import / Install.
- [x] B4 e2e: make a ship in the Editor, install, see it in the game's shipyard.

## Part C — forms, map, guide, sample

- [x] C1 Form views for ships, outfits, commodities, encounters (JSON stays available).
- [x] C2 Map view for systems (drag to place, click to link).
- [x] C3 Guide (How to Play tab + README section), `public/plugins/sample.starwake.json`, e2e.
