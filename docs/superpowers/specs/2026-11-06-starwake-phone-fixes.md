# Starwake — Phone playtest fixes (design notes)

Status: shipped · 2026-11-06

Source: the "Starwake Phone Playthrough Report" (Nov 5 2026, 8 pages, phone 7/10). It was played on the build
with the playtest fixes but before the playtest improvements (combat training, Fleet panel, boarding by autopilot,
sale hints) went live, so some of its notes are already answered by those.

| Report # | Fix |
|---|---|
| 1 | Holding TGT survives a lost pointer capture (only a real cancel ends the hold), and targeting the nearest hostile says who ("Targeting the nearest hostile: …") or "No hostile ship nearby." |
| 2 | Touch: FIRE with nothing targeted locks onto the nearest hostile, so the guns' assist can aim. |
| 3 | On short screens Leave sticks to the bottom of the planet screen while it scrolls. |
| 4 | Tolls are capped at `combat.demand.maxCredits` (1 500 cr). |
| 5 | After a toll is paid or cargo dumped, raiders let the pilot pass for `combat.demand.graceDays` (1). Session only, not saved. |
| 6 | Fringe fuel eased by 1 cr a unit at tier 1–2 ports (never below 3); Refuel shows the price per jump. |
| 7 | Real phones already ask to rotate in portrait; for a touch view without that prompt, HUD lines wrap instead of cutting off. |
| 8 | The page carries `data-input="touch"` in touch play, which hides every hotkey chip. |
| 9 | How to Play on short screens: one scrolling row of tabs and tighter spacing, so the text gets the height. |
| 10 | Shops show 4×2 tiles on a wide, short phone (was 3×2); the shipyard lists an open one-off reward hull first. |
| 11 | The guide's final "Nice trade" card dismisses itself at the next landing. |

## Decisions to review with the owner

1. **Toll cap 1 500 cr** and **one day's grace** after paying (`data/combat.json` → `demand`).
2. **Fringe fuel −1 cr a unit** (tier 1–2 ports): a jump there now costs 300–500 cr instead of 400–600.
3. **Touch FIRE auto-targets** the nearest hostile only when nothing is targeted; a chosen target is never changed.
4. **Portrait stays a "please rotate" screen on phones**; only the wrap fallback was added.
