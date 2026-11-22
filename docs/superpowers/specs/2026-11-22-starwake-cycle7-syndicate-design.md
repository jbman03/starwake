# Starwake cycle 7, Part 3: The Syndicate

## Intent

This is the third career arc from the roadmap: "you become a pirate lord or crime boss. Smuggling routes become
yours, and you're Hunted in the core." It is built on the Part 1 framework (arcs, map overlay, ranks, legacy, Leads)
and Part 2's `switchArc`. The owner asked to proceed with my recommendations: one arc per merge, the Syndicate before
the Wake.

**Done when:**
- A new pilot can take a Syndicate job from day 1, close to the start.
- The arc has a three-way choice, a twist that can defect the pilot to the Navy or the Free Reach, and an ending.
- Fringe systems turn Syndicate, a Syndicate port opens, and the pilot ends up Hunted in Concord space.
- A legacy perk is earned.
- The full suite passes.

**Non-goals:**
- The Wake.
- New engine mechanics: the arc is data plus one new government.
- Combat steps in story missions.

**Anti-goals:**
- A pilot stuck at a port that refuses them.
- Syndicate systems that become deadlier for the Syndicate pilot.

## Approaches

- **A. A new `syndicate` government (chosen).**
  - The government is "The Hollow Syndicate", colour `#e05fb0` (pink, which no other government or map marker uses).
  - Systems it takes have no raider or patrol spawns, because the spawn tables have no entry for it, so its lanes
    really are yours.
  - It is data only, in `governments.json`. Law and standing work for any government.
- **B. Give systems to the existing "raiders" government.** Raider ships attack the player and the raiders have no
  law, so "your" routes would turn hostile. Rejected.

## The arc

- **The arc record:**
  - id `syndicate`, title "The Syndicate", government `syndicate`.
  - Entry: `sy1-quiet-cargo`, with the lead "Dockfixer Nell Corbin has work for a pilot who doesn't ask questions, at
    the Merrow bar."
  - Ranks: Runner 0, Fixer 20, Underboss 50, Boss 90.
  - Legacy: "Old favours: every new pilot starts with 7,500 cr of the Syndicate's laundered money."
    (`credits: 7500`).

| # | Mission | Where offered | Steps | Result |
|---|---|---|---|---|
| SY1 | A Quiet Cargo (commit) | Merrow bar, day 1. Giver: Dockfixer Nell Corbin | Deliver 6 t of unmarked crates to Tallow Rock (vesk) | +10 pts, `syndicate-1` |
| SY2 | Customs Are for Other People | Lastlight Beacon bar | Deliver 8 t of "medical stims" to Hallow (minster, Concord) | +10 pts (Fixer), Concord heat 20, `syndicate-2` |
| SY3 | The Customs Cutter | Lastlight Beacon bar | Meet the customs cutter *Inspector Maren Vosk* in vesk (in space). **Three-way card:** turn her (commit: `syndicate-inspector`); run the blockade (Concord heat 30); dump it and go (`syndicate-clean`) | +10 pts, `syndicate-3` |
| SY4 | The Silver Run | Skerry Light bar. Giver: Corin Vale, a silver broker (the stranger, `stranger: true`) | Deliver 10 t of silver bullion to Brackwater | +20 pts (Underboss), `syndicate-4`, and the note "The broker counted coins with the quartermaster's careful hands." |
| SY5 | Whose Silver (**the twist**) | Skerry Light bar | Scan "the Syndicate vault" in brackwater, then `decide` at The Midden. The Syndicate's silver is Navy pay: the Concord funds the Syndicate to bleed the Reach. **Card:** keep the Syndicate's secret (commit: `syndicate-line`); sell it to the Reach (commit: `switchArc rising`, `rising-line`, `rising-defector`, Syndicate heat 100, Free Reach friend); or, needing `syndicate-inspector`, have Maren Vosk take it to the Navy (commit: `switchArc navy`, `navy-loyal`, `navy-defector`, Syndicate heat 100, Concord friend) | `syndicate-5` |
| SY6 | The Undermarket | Skerry Light bar (`syndicate-line`) | Deliver 20 t of contraband to Lastlight Beacon | +20 pts; **vesk and skerry become Syndicate**; **The Undermarket** opens in brackwater (`appearsFlag: syndicate-market`); `syndicate-6` |
| SY7 | Boss of the Rim | The Undermarket bar | Meet the Concord customs commodore in lastlight (in space). **Card:** buy the lanes; or break the blockade (commit: Concord heat 40) | +20 pts (Boss); **brackwater becomes Syndicate**; Concord heat 60 ("Hunted in the core"); `syndicate-done`, `arcDone syndicate` |

- **Points:** 10 + 10 + 10 + 20 = 50 at the twist; then 50 + 20 + 20 = 90 (Boss). A defector carries 25 into their
  new arc:
  - into Free Reach Rising: 25 + RR6 + RR7 = 65;
  - into the Navy: 25 + N6L + N7L = 65.
- **Defector routes:**
  - The flags `rising-defector` and `navy-defector` already keep RR1 and N1 closed to defectors.
  - Neither path ever needs a Syndicate port: RR6 and RR7 are at Wrenhold, Hollis and Minster; N6L and N7L at
    Concordance, Hollis Landing and Picket Station.
  - The data test "no step after heat needs a port of that government" covers this.
- **Concord heat while loyal:**
  - Turning the inspector adds none; running the blockade adds 30. SY2's 20 brings the most to 50, below Hunted (60).
  - SY2's delivery to Hallow comes before any heat.
  - From SY6 on, the steps are in fringe ports or space, so a Concord-Hunted Syndicate pilot is never sent to a
    Concord port.
- **Unlock:** Underboss (`syndicate-rank-2`) opens the **Nightjar**, a data-only smuggler's hull sold at The
  Undermarket. It needs Syndicate friend, which SY4 grants.
- **The Undermarket:** a station in brackwater with exchange, missions, outfitter and bar, plus a shipyard for the
  Nightjar. Its name is within the phone rail's name limit.
- **Writing:** original prose in the house tone. New names: Nell Corbin, Maren Vosk, Corin Vale, The Undermarket and
  the Nightjar.

## Testing

- **Walkthroughs** (`storyArcSyndicate.test.ts`):
  - loyal SY1→SY7, checking the governments, The Undermarket, 90 points, Hunted by the Concord and `arcdone:syndicate`;
  - Syndicate→Reach (SY5 sell, RR6, RR7);
  - Syndicate→Navy via the inspector (SY5, N6L, N7L);
  - each SY3 choice;
  - a lead at every step.
- **Data:** the new government loads; a `syndicate` system has no raider spawns; the heat-safety, `minDay`, pay-cap
  and sentence tests hold.
- **E2E:** take SY1 at Merrow with its confirm, and the Star Map shows a Syndicate system in pink after a forced
  outcome.
- The full suite runs before the merge.

## Settled after the builder check (my calls)

1. **The Nightjar** uses the existing ship gates, `requiresFlag: syndicate-rank-2` plus `requiresStanding` Syndicate
   friend. No Syndicate faction is added: the arc's ranks are enough. A government needs a faction entry only when it
   holds a system in the base data, and the Syndicate only gains systems through the story overlay.
2. **Syndicate heat** works like any government's: Hunted means its ports refuse landing. A defector leaves at SY5,
   before SY6 and SY7 flip anything, so no Syndicate port exists on their path.
3. **Independent encounters** that list `independent` stop appearing in Vesk and Skerry once they turn Syndicate.
   That is fitting: those systems have changed hands. They are left as they are.
4. **The Undermarket** is a station with `appearsFlag`, as Freehold Light and the Hollis Market are; that is proven
   to work in a known system.
5. **Names:** "Brackwater" in SY4 means the planet `brackwater`; "Merrow" is the planet `merrow`, in Calder.

## What's left to the builder

The Nightjar's stats (a fast mid-hold smuggler with a distinct hold size), The Undermarket's market and position,
exact credits within the pay cap, and the prose.

## Decisions to review with the owner

- **A new Syndicate government** rather than handing systems to the raiders, so Syndicate lanes are quiet, not
  hostile.
- **The twist:** the Syndicate is secretly Navy-funded. It can defect you to the Reach, or to the Navy if you turned
  the customs inspector.
- **The legacy is credits** (7,500 cr), so the three perks differ: Navy credits, Reach a Courier, Syndicate more
  credits.
- **Lastlight stays independent:** it is the Independent faction's hub. The Syndicate takes Vesk, Skerry and
  Brackwater instead.
