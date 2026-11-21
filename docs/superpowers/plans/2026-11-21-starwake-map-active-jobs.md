# Star Map Active Jobs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Make the Star Map show clearly where your active jobs lead.
**Architecture:** All in `src/ui/starMap.ts`, plus its CSS in `src/ui/styles.css`.
- `mapModel` counts jobs per system.
- A new `activeJobs()` lists them.
- Rendering draws a ring and badge, a legend, and a side-panel list.
**Spec:** `docs/superpowers/specs/2026-11-21-starwake-map-active-jobs-design.md`

## Global Constraints

- **Job colour:** the existing flag yellow, `#ffd166`.
- **Legend:** bottom-left, text "◯ Your jobs ▲ Raiders", shown only with at least one job.
- **List:** story missions first, then jobs; row text "<title> → <system name>", or "→ ?" when not visible.
- **Touch targets:** at least 44 px; the existing map fit e2e checks must still pass.

## Review Focus

1. Two jobs to the same system: one ring with the badge "2", and two rows in the list. Test in Task 1.
2. A story step in a system not yet visible: no ring, and the row reads "→ ?" and selects nothing. Test in Task 1.
3. Phone 844×390 with three jobs: the list fits and Set course stays on screen. E2e in Task 2.

### Task 1: The model and `activeJobs`

- **Changes:**
  - `MapNode.jobs: number`, the count of jobs and story steps leading there; `flag` stays as `jobs > 0`.
  - `activeJobs(world, data): { title: string; systemId: string | null }[]`.
- **Tests (in `src/ui/starMap.test.ts`):**
  - `'two jobs to one system: jobs 2 on that node, two entries in activeJobs'`.
  - `'a story step in a hidden system: no job count there, entry systemId null'`.
- **Steps:** red → implement → green → `npx vitest run` → commit.

### Task 2: Rendering, legend, list, CSS and e2e

- **Ring and badge:**
  - The ring is a `circle r=13 .sw-map-job` when `jobs > 0`; it replaces the flag path.
  - The badge, when `jobs > 1`, is `g.sw-map-jobcount` at (11, -11), a circle with r 7 and the count as text.
- **Danger triangle:** scaled to about 70%, with CSS opacity 0.6.
- **Legend:** `.sw-map-legend` (data-testid `map-legend`) inside `.sw-starmap-view`.
- **List:**
  - A `.sw-map-jobs` section (data-testid `map-jobs`, heading "Your jobs") in the side panel, before the info box.
  - Its rows are buttons that call `select(systemId)`; a row is disabled when `systemId` is null.
- **Tests:**
  - Unit (`starMap.test`), for a world with a job at Merrow:
    - the node has `.sw-map-job`;
    - the legend shows;
    - tapping the "Your jobs" row selects Calder;
    - no legend or list without jobs.
  - E2e (`tests/e2e/starmap.spec.ts`): at a phone size of 844×390 with three jobs, the list is visible, the fit checks pass, and tapping a row then Set course plots it.
- **Steps:** red → implement → green → full suite → commit → merge, then confirm the deploy.
