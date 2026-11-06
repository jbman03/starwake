# Starwake — Playtest fix release (design notes)

Status: shipped in three merges · 2026-11-06

Source: the "Starwake Playthrough Report" (Nov 5 2026, 12 pages, rating 6.5/10, 24 bugs). The owner asked for
the report to be reviewed, analysed and implemented, and added one feature mid-way: beams that run on power, not
ammo.

## Merge 1 — cycle 6 bugs and beam power

| Report # | Fix |
|---|---|
| 1, 19 | A bay can't be sold while its fighters would have nowhere to dock ("Sell some fighters first"). The outfitter's Max for fighters and ammo shows what the bays or launchers hold; a full bay says "Your fighter bays are full." |
| 2 | Fighters beyond the bays' room never count as docked, so they never launch. |
| 3 | The autopilot's approach speed allows for the half-turn a ship needs before braking (v·tTurn + v²/2a = d), so slow hulls (Bastion, Ironback) land instead of circling. Tested on every shipyard hull. |
| 4, 13 | An unpaid wage is announced the day it happens; an escort left behind on a jump is announced; the sidebar counts escorts away ("Escorts: 1 (+1 away)"). The report's vanished escort was most likely undone by a reload (saves only on landing, fixed in merge 2). |
| 6 | A bought hull leaves the yard with its standard guns, turrets, launchers and ammo (its NPC loadout, never bays or fighters). The shipyard lists them under "Comes with". |
| 12 | Player fighters keep station outside the carrier's hull. |
| Owner | Beams draw on power (0–100%): it drains while firing (20%/s), recharges at rest (25%/s), and damage falls to a 30% floor, so a beam never stops working. Shown as "Beam %" on the sidebar and rail; a drained beam draws thinner. Tunables: `combat.json` → `beams`. |

## Merge 2 — survival, saves and controls

| Report # | Fix |
|---|---|
| Top 1, balance 1–2 | A green pilot (under `spawn.greenKills` = 5 kills) meets only raider hulls up to tier `spawn.greenRaiderTier` = 2, and every raider hails with a toll before it fights. |
| 5, balance 5 | Story cargo and passengers that fit the starter ship ride the escape pod, so the step goes on; what doesn't fit is lost and re-offered as before. |
| 11 | Leaving a planet saves too (as well as landing). |
| 7 | J while too close to the star flies out and jumps by itself once clear. |
| 9 | Tab walks a fixed order: sites, ships in arrival order, then planets from the star outward. Nothing is skipped as ships move. |
| 10 | A key pressed in the same frame as one that closes a dialog reaches the next screen (an unused press survives one poll). |

## Merge 3 — UI and text

14 (map framed on the whole galaxy, wider side padding), 15 (find-site hint names the keys), 16 (Reed's line),
17 (Bluff label), 18 (guide job step mentions passenger jobs; the exchange opens on a held good), 20 (no
duplicate refusal), 21 ("Only mission cargo aboard"), 22 (planet lists scroll in their own box), 23 (Previous
target on T), 24 (copy slips).

## Decisions to review with the owner

1. **Arrivals stay inside the jump boundary** (report #8), as in Escape Velocity. The one-press queued jump (#7)
   removes the extra presses that made it painful. Moving arrivals outward would put planets farther away.
2. **Tab no longer goes nearest-first.** A fixed order was the only way to stop skips; R still targets the nearest
   hostile.
3. **Bought ships come with guns but not bays or fighters** (a free Hornet Bay and four Wasps would be worth
   84 000 cr on a 450 000 cr hull).
4. **Green pilots:** every raider hails until 5 kills, and only tier 1–2 raider hulls appear. Numbers in
   `combat.json` → `spawn`.
5. **Beam power numbers:** 20%/s drain, 25%/s recharge, 30% floor (`combat.json` → `beams`).
6. **Previous target key: T.**
7. **The pod carries story cargo only if the starter ship could** (20 t, 4 berths).

## Improvements (owner: "proceed" with the report's improvements)

Shipped after the fixes, in tested merges:

- **Map danger:** each charted system's info panel rates its danger (Low, Medium, High) from its raider chance;
  a red or amber triangle marks raider-heavy systems.
- **Find sites:** while a site is hidden, the objective line gives a signal (faint over 1 800 px, growing, strong
  within 1 000 px), so a sweep has a warmer and a colder.
- **Exchange:** each good lists charted ports that pay high for it; Undo takes back the last trade while the
  exchange is open.
- **The Dimming:** finishing Low Tide, Warden Corrin lends Hal Brennan and a Kestrel (no wage, not for sale). A
  new story outcome, `escort`, lends a pilot; a full group means he stays behind.
- **Fleet panel** (E, or the pause menu): every escort's status, fighters aboard and out, and the order.
- **Boarding:** the autopilot key flies beside a targeted disabled ship; range is hull to hull; Take everything (5).
- **Combat training** (pause menu, in flight): an unarmed drone and five objective steps; no kill is counted.

More decisions to review:

8. **Lent escort:** Corrin lends Hal Brennan when Low Tide completes (not a loaner ship), and keeps lending as
   long as he survives; he is an escort like any other.
9. **Fleet panel key: E.** **Take everything: 5** (Leave moves to Esc only, keeping keys 1-4 as they were).
10. **Combat training is optional,** from the pause menu, not offered automatically.
11. **Danger thresholds:** High at a 30% raider chance, Medium at 15%.
