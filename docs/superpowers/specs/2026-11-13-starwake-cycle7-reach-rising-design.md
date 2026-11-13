# Starwake cycle 7, Part 2: Free Reach Rising (and switching sides)

## Intent

This is the second of the four career arcs from the roadmap's "Branching storylines with twists". The player
becomes a rebel breaking the Concord's grip: Concord systems change flag and new free ports open. It is built on
the Part 1 framework (`2026-11-12-starwake-cycle7-arcs-design.md`).

It also delivers the roadmap's "expose it and switch sides, at a cost". The owner chose real switching
(Part 2, option A): a twist can move the pilot into another arc partway through.

**The owner chose:** one arc per merge, Free Reach Rising first. The Syndicate and The Wake come later, each
merged on its own.

**Done when:**
- A new pilot can take the Reach commission at Dunmore Crossing, one jump from the start.
- The arc has a three-way choice, a twist, and two outcomes for the pilot: stay a rebel, or defect to the Navy.
- A Navy pilot who exposes the Navy now defects into this arc and finishes it.
- Concord systems turn Free Reach, and a new free port opens.
- A legacy perk is earned.
- Live saves made under Part 1 still load and never get stuck.
- The full suite passes.

**Non-goals:** the Syndicate, the Wake, the Rift, any new UI screens, and Editor forms.
**Anti-goals:**
- A pilot stuck with no lead after switching.
- A Part 1 save that loads into a dead end.
- Arcs that can be combined. Lockout still holds: one arc at a time.

## Approaches (switching sides)

- **A. A "change arc" outcome (chosen).** `{ "type": "switchArc", "to": "<arc>" }` swaps `arc:<from>` for
  `arc:<to>` and carries half the old arc's points over (the cost). The choice's own flags open the target
  arc's way in. It is small and data-driven, and the Syndicate and the Wake reuse it.
- **B. Arc history** (a pilot belongs to several arcs over time). It touches every lockout, lead and rank check
  for little gain, so it was rejected.

## 1. Engine changes (small)

- **The `switchArc` outcome:** `{ type: 'switchArc', to: arcId }`.
  - It removes the current `arc:<x>` flag and sets `arc:<to>`.
  - It sets `arcPoints[to] += floor(arcPoints[x] / 2)` and leaves `arcPoints[x]` as it was.
  - It sets the rank flags reached in the new arc.
  - Its note reads "You have gone over to <to title>."
  - The loader checks that `to` is an arc. A switch with no arc chosen just takes the target arc.
- **Lockout in `acceptStory` itself** (deferred minor M8). A mission of a locked arc can't be taken, whatever UI
  path calls it.
- **A declined arc entry still leads** (M3). `leads()` keeps an untaken arc's lead on the day you declined it.
  The bar still respects the decline.
- **The legacy start hull is complete** (M4). A `shipId` perk gives the hull its own name, clears the old
  hull's outfits and applies the new hull's loadout. Free Reach Rising uses this perk.
- **Save v12** migrates Part 1 pilots: a pilot with `arc:navy` and `navy-exposed` but not `navy-done` is
  switched to `arc:rising` (half the points), exactly as the new N5 choice would do. Pilots who already finished
  N7X keep their Navy ending and legacy unchanged.

## 2. The arc

- **The arc record:**
  - id `rising`, title "Free Reach Rising", government `free-reach`.
  - Entry: `rr1-free-hand`, with the lead "Organiser Mara Quell is looking for pilots at the Dunmore Crossing bar."
  - Ranks: Hand 0, Agitator 20, Organiser 50, Speaker 90.
  - Legacy: "Reach friend: every new pilot starts in a Courier, a gift from the Compact." (`shipId: courier`).
- **The arc id is `rising`, not `reach`**, because `reach` is already the Lanterns story's Free Lanes arc.
  Flags use the `rising-` prefix.

| # | Mission | Where offered | Steps | Result |
|---|---|---|---|---|
| RR1 | A Free Hand (commit) | Dunmore Crossing bar. Giver: Organiser Mara Quell | Ferry 3 organisers to Redwater Sound | +10 pts, `rising-1` |
| RR2 | Charters for the Core | Redwater Sound bar | Deliver 8 t of printed charters to Hollis Landing | +10 pts (Agitator), `rising-2` |
| RR3 | The Picket Captain | Hollis Landing bar | Meet *Captain Ada Royce*, a Navy picket, in hollis. **Three-way card:** bluff past her; turn her (commit, sets `rising-royce`, Concord heat 30); or run (Concord heat 15) | +10 pts, `rising-3` |
| RR4 | The Ferryman's Cargo | Wrenhold bar. Giver: Ivo Sand, a ferry captain (the stranger, `stranger: true`) | Deliver 10 t of relief medicine to Thistledown | +20 pts (Organiser), `rising-4`, and the note "The ferry captain had the quartermaster's careful hands." |
| RR5 | The Price of Lanterns (**the twist**) | Thistledown bar | Scan the "Compact warehouse" in thistle, then `decide` at Haywain. The Compact's speakers have been selling lantern cores to raiders to pay for warships. **Card:** keep it in the family (commit, `rising-line`); take it to the Navy (commit: `switchArc navy`, `navy-loyal`, Free Reach heat 100, Free Reach cool, Concord friend); or, needing `rising-royce`, have Ada Royce carry it to the Navy quietly (commit: the same defection, with Free Reach heat 60) | |
| RR6 | Open the Lanes | Wrenhold bar (`rising-line`) | Meet a Concord governor's envoy in hollis (in space). **Card:** take Hollis peacefully, or blockade it (commit: Concord heat 40) | +20 pts; **hollis becomes Free Reach**; **Hollis Free Market** opens (a new station, `appearsFlag: rising-market`); `rising-6` |
| RR7 | The Free Compact | Wrenhold bar | Go to minster, scan the "Concord signal mast" in minster, then land at Wrenhold | +20 pts (Speaker); **minster and corvana become Free Reach**; `rising-done`, `arcDone rising` |

- **The Navy defector path joins here.**
  - N5's two "expose" choices gain `switchArc rising` and the flag `rising-defector`.
  - N6X (Running Dark) and N7X (The Lantern Fire) move to `arc: rising` and keep their ids, so saves still work.
  - N7X keeps its Hollis flip and Freehold Light, but no longer ends the Navy arc: its `arcDone navy` and
    `navy-done` become `rising-line`.
  - From there the defector plays RR6 and RR7. Points: 25 carried over + 20 + 20 + 20 + 20 = 105, so Speaker.
- **The Reach defector joins the Navy:** RR5's defect choices set `navy-loyal`, so N6L and N7L follow.
  Points: 25 carried over + 20 + 20 = 65, which is Commander, not Captain. That is the cost.
- **Safety:**
  - A pilot who defected to the Navy (Free Reach heat) is next sent only to Concord ports.
  - A Navy defector (Concord heat) is sent only to Reach ports or into space. RR6's step is a meet in space;
    RR7 is a scan in space plus a landing at Wrenhold.
  - The existing data test, "no step after heat needs a port of that government", is extended to cover
    `switchArc` paths.
- **Unlock:** Organiser (`rising-rank-2`) opens the **Lane Runner**, a data-only fast trader sold at Redwater
  Sound. It needs Free Reach friend, which RR4 grants.
- **Writing:** original prose in the house tone. New names: Mara Quell, Ada Royce, Ivo Sand and the Hollis
  Free Market. Tamsin Vey stays the defector's contact.

## 3. Testing

- **Unit:**
  - `switchArc`: flags swap, half the points move, rank flags are set, and the lockout follows.
  - `acceptStory` refuses a mission from a locked arc.
  - Leads after a decline.
  - The complete legacy start hull.
  - Save v11→v12 migration, plus a round trip.
- **Walkthroughs:**
  - Rising loyal (RR1→RR7), checking the final governments and the Free Market.
  - Reach→Navy defector (RR1→RR5 defect, N6L, N7L).
  - Navy→Reach defector (N1→N5 expose, N6X, N7X, RR6, RR7).
  - Each RR3 choice.
  - A lead at every step of every path.
- **Data:** heat safety across switches, no `minDay`, and the reachability fixed point.
- **E2E:**
  - Take RR1 with its confirm.
  - A forced switch shows the new arc on the pilot card.
  - A Part 1 save (v11, Navy exposed, before N6X) loads, leads to N6X, and N6X is offered at Dunmore.
- The full suite runs before the merge.

## Settled after the builder check (my calls)

1. **N6X and N7X pay `rising` points.** Their `arcPoints` outcomes are retargeted from `navy` to `rising`. Their
   flag names (`navy-6x`, `navy-freehold`) stay as they are, so saves keep working.
2. **The v12 migration**, for pilots with `arc:navy` and `navy-exposed` but not `navy-done`:
   - It applies `switchArc rising` to the Navy points they hold at that moment, including any from N6X.
   - It adds `rising-defector`.
   - It sets the `rising-rank-*` flags their carried points reach, and keeps the `navy-rank-*` flags.
   - Standing is already set by N5 and is left alone.
   - An active N6X or N7X carries on: the mission's arc changes in the data, and lockout only affects offers and
     new takes, never missions already under way.
3. **Legacy goes with the arc you finish.** A Navy→Reach defector earns the Rising perk at RR7, not the Navy
   one. A Reach→Navy defector earns the Navy perk at N7L. Perks from different pilots stack in the device's
   legacy as before. `arcDone rising` is set only at RR7.
4. **RR6 on the defector path:** hollis is already Free Reach after N7X, so the flip is a harmless no-op. The
   card text speaks of the Concord's "last claim" on Hollis, which reads right either way. Freehold Light and
   the Hollis Free Market can both stand in Hollis.
5. **A declined arc's lead stays for the rest of that day.** The bar offers the mission again the next day, as
   it does today. In `leads()`, an untaken arc's entry lead ignores "declined today"; everything else still
   respects it.
6. **`switchArc` details:**
   - `from` is `chosenArc(world)`. With no arc chosen, it just sets `arc:<to>` and moves no points.
   - Ranks reached by the carried points set their flags with promotion notes, as `addArcPoints` does.
   - The pilot card then shows the new arc's rank. "(struck off)" only applies to the arc the pilot is in, so
     it disappears after a switch.
7. **The Courier perk:**
   - `courier` is an existing hull. Its loadout is the ship's own `loadout` field, if it has one; otherwise it
     starts empty.
   - Starting credits are unchanged.
   - The Lane Runner (a ship) and the Hollis Free Market (a station with `appearsFlag`) are ordinary new records
     in the existing schemas.

## What's left to the builder

Stats for the Lane Runner and the Free Market (a fast mid-tier trader; a Reach station with exchange, missions
and bar), exact credits within the balance test's cap, and the prose.

## Decisions to review with the owner

- **The arc id is `rising`** (internal only), because `reach` was taken.
- **Switching sides carries half your arc points.** A Navy defector can still reach Speaker. A Reach defector
  tops out at Commander in the Navy.
- **Part 1 saves are migrated.** A pilot who exposed the Navy but hadn't finished Running Dark is moved into
  Free Reach Rising. Pilots who already finished The Lantern Fire keep their Navy ending.
- **The Navy defector's old ending (N7X) now carries on into RR6–RR7** instead of ending the Navy arc.
- **Free Reach Rising's legacy perk is a Courier as the starting hull,** and the shipId perk is now complete.
- **Part 1 defectors are moved at load time** (`worldFromPilot`), not by a v12 save migration. Save migrations
  here are data-free, and this one needs the arcs' rank data. The save version stays 11, the result is the same,
  and loading twice changes nothing more. (Planning call.)
