# Starwake: Living Galaxy — the fun pass

**Date:** 2026-10-20
**Status:** Approved for build ("go with your recommendations", relayed from the owner 2026-10-20)
**Builds on:** cycle 2 (`2026-10-17-starwake-cycle2-ships-outfits-design.md`), shipped
**Context:** `docs/design-notes.md` § "Fun review (2026-10-20)" (ranked list this spec builds)

## 1. Purpose

The fun review found that space is empty, nothing happens between landings, trading is
pointless next to missions, and there is nothing rare to chase. This pass makes the
galaxy feel alive before combat arrives. It builds the review's items in ranked order:

| Review # | Section here |
|---|---|
| 11 friction fixes | §2 |
| 1 living traffic | §3 |
| 2 in-flight encounters | §4 |
| 3 + 7 + 8 a thread to find, a rare ship, a hidden place | §5 |
| 4 juice (effects and sound) | §6 |
| 5 earning curve | §7 |
| 10 pilot card | §8 |

Items 6, 9 and 12 (danger, named pilots, ranks) need combat or factions and stay in their
cycles. The full spaceport bar stays in cycle 3. §5 adds the story-flag store that the bar
will reuse.

Design rules still hold:
- All names and text are original.
- On phones nothing covers the game view except the bottom context button, unless the
  player opens a screen themselves.
- Every new action has a rebindable hotkey.

## 2. Friction fixes

1. **One Map key.** The flight `map` action defaults to `['KeyN', 'KeyM']`, so N opens the
   map everywhere and M still works in flight. Landed `openMap` stays `KeyN`. Button
   labels show the first key (N), and saved custom bindings are left alone.
2. **The guide adapts.** The course and sell steps of the First Flight guide no longer
   name Tessaly. They name the nearest known port, by jumps, that buys the guide's good
   for more than the pilot paid. That port is worked out again on every landing. If no
   such port is known, they name Tessaly as before. Selling the good at a profit
   anywhere completes the sell step.
3. **Honest route preview.** When the map previews a mission whose destination is not
   known yet, it shows the route through `seen` systems as accepting would. The status
   line reads "N jumps (through unexplored space)" instead of "No known route".
4. **Hotkey after a dialog.** Reproduce the report (after OK on "Mission complete",
   the next hotkey did nothing) in an e2e test. Fix it if it reproduces. If it doesn't,
   keep the test as a guard.

## 3. Living traffic

New pure module `src/sim/traffic.ts` plus rendering in `SpaceScene`.

- **Who flies.** Each system has a traffic level from its government and tier:
  - Concord core: 3–5 ships.
  - Free Reach and independent: 2–3 ships.
  - Fringe (tier 1): 0–2 ships.

  The system data may set `traffic` to override this.
- **What they do.** Every NPC has one errand:
  - **arrive:** jump in at the edge with a streak, fly to a port and land, then vanish
    with a landing fade;
  - **depart:** take off from a port, fly out and jump away;
  - **pass:** jump in, cross the system, and jump out.
- **How they fly.** NPCs use the same flight rules as the player (`flight.ts`) with
  their hull's stats, and steer like autopilot.
- **Population.** Spawning is deterministic from `seed`, `day`, system id and a spawn
  counter. On arrival the system is seeded mid-errand. After that a new ship spawns
  every 8–20 s while the system is below its level. At most 8 NPCs exist at once.
- **Not saved.** Traffic is transient and rebuilt after a load or a jump.
- **Identity.** Each NPC has:
  - a hull from `ships.json`, weighted by tier and role (no carriers outside hubs);
  - its faction's colour, shown as a tint and a radar dot colour;
  - an original generated name (e.g. "*Brass Heron*"), made from two word lists in
    `data/names.json`.
- **Targeting.** `nextTarget` (Tab) cycles through ships and then planets. A tap on a
  ship targets it. A targeted ship gets a bracket, and the sidebar or HUD target line
  reads "*Brass Heron* — Concord Mule (trader)".
- **Radar.** Ships show as small dots in their faction's colour.
- **Rendering.** Ship sprites reuse `makeShipTextures`, with a faction hue tint. Each
  sprite is registered through `addWorldObject` so the sidebar camera skips it.
- **Performance.** Low-quality mode caps NPCs at 4.

## 4. In-flight encounters

Data lives in `data/encounters.json` and the logic in `src/sim/encounters.ts`. An
encounter is something met in flight. It never interrupts the player and is never forced.

- **Rolling.** On jump arrival:
  - 25% chance of an encounter, rolled deterministically from the seed;
  - no rolls while the First Flight guide is running;
  - never two arrivals in a row;
  - each template has a weight and optional conditions: `minDay`, government, `tier`,
    `requiresFlag`, `notFlag`, and `hasCargoSpace`.
- **Two kinds.**
  - **Hail.** A radio call. A HUD banner reads "Incoming hail — *Brass Heron* (Y to
    answer)". On phones the context button turns into "Answer hail". The call lapses
    after 30 s or when the pilot leaves the system.
  - **Site.** A thing in space: a derelict, a beacon or a cargo drift. It is placed
    600–1400 px from the arrival point and shown on radar as a white diamond. The pilot
    flies within 60 px and below 40 speed, and the context action (`interact`, default
    `KeyY`) opens it.
- **The card.** Answering a hail or opening a site pauses the sim and opens an encounter
  card. The card holds a short original text and 2–3 choices, each with a hotkey (1/2/3).
  Each choice applies one or more outcomes:
  - `credits ±n`;
  - `cargo +t of good` (capped by free space);
  - `fuel ±n`;
  - `mission` (adds a generated job, such as a stranded passenger or a lost parcel);
  - `reveal` (charts systems);
  - `rumour` (a line added to the mission log);
  - `flag` (sets a story flag);
  - `message`.

  Each outcome is a tagged union and is validated with zod.
- **Content.** At least 12 templates:
  - a stranded passenger;
  - a lost courier's parcel;
  - a cheap-goods pedlar;
  - a cargo drift;
  - an empty derelict;
  - a derelict with salvage;
  - a fuel-starved hauler (sell or give fuel);
  - a surveyor's beacon (reveals systems);
  - a rumour broadcast;
  - a pilgrim convoy;
  - a customs-free trader;
  - the rare-ship thread in §5.
- **Mission log.** A new "Notes" section lists rumours and story leads, newest first,
  and keeps up to 20.

## 5. A thread to find: the survey ship

This uses a new generic story-flag store, `world.flags: string[]` (saved). It also seeds
cycle 3, which builds the bar on top of it.

1. **Rumour.** From day 5, the mission computer's rumour line can be: "Old spacers swear
   a survey ship still drifts beyond Skerry, where the charts go blank." Seeing it sets
   the flag `survey-rumour` and adds a log note.
2. **The hidden lane.** A new system, **Hushwater**, links only to Skerry. Its lane is
   `hidden: true`. A hidden system is never added to `seen`, local charts never reveal
   it, and routes ignore it until the flag `hushwater-lane` is set. The flag is set by
   the rumour plus a surveyor's beacon in Skerry, which is guaranteed once
   `survey-rumour` is set.
3. **The derelict.** On the first arrival in Hushwater, a guaranteed site encounter
   finds the drifting survey ship *Long Patience*. Taking her log and transponder sets
   the flag `survey-claim`. A choice also lets the pilot strip her for parts (credits),
   but that sets `survey-stripped` and ends the thread.
4. **Restoration.** With `survey-claim`, the shipyard at the Free Reach hub offers the
   **Patience-class Surveyor** for 60,000 cr. This one-off hull has scout range, a 40 t
   hold, fast speed, and a built-in chart that reveals 2 jumps on arrival in any system.
   It is sold once, only to this pilot.
5. **Teaser.** Before the claim, that shipyard lists a dim silhouette, "??? — 'ask about
   the old survey ship'", which cannot be bought.

Hushwater also has one small world with a unique good, **Stillwater Pearl**, so the
hidden place is worth returning to.

## 6. Juice

A jump streak and flash already exist. This pass adds:

- **Visual:**
  - an engine flame behind any ship that is thrusting, player and NPC;
  - an arrival effect: reverse streaks plus a short flash fading out;
  - a landing effect: the ship shrinks and fades into the planet over 0.4 s before the
    planet screen opens;
  - a take-off effect: the reverse of landing;
  - NPC jump in and out streaks;
  - on landed screens, the credits number counts up when a mission pays.
- **Sound:** a new `src/audio/sfx.ts`, synthesised with WebAudio, with no audio files.
  - Sounds: thrust hum (a loop while thrusting), jump whoosh, arrival thump, landing
    chime, take-off rumble, buy/sell tick, mission paid jingle, hail beep, and
    site-found ping.
  - The audio context starts on the first user gesture.
- **Settings:** master volume (0–100, default 60) and a mute toggle. Mute is a new
  rebindable action `toggleSound` with default `KeyV`, and works in flight and landed.
  The setting is saved.
- **Music** stays out of scope (art and sound cycle).

## 7. Earning curve

The goal: trading is a real choice, and the first upgrade feels earned.

- **Targets, checked by a pure balance test (`balance.test.ts`):**
  - With the shuttle, the best 2-port loop among the start-known systems earns at least
    40% of the median mission's credits per jump.
  - The starter path (10,000 cr, missions only, median offers) reaches 30,000 cr (the
    courier) in 8–14 completed jobs, not about 5.
  - The guide's trade makes at least 300 cr profit.
- **Levers, with numbers set in the plan:**
  - rush pay per ton down;
  - urgency multiplier down;
  - commodity low and high spreads wider;
  - the guide buys 20 t instead of 10;
  - rumours point at real events.

## 8. Pilot card

The main menu's pilot row becomes a card. It shows:
- pilot name;
- ship name and hull;
- credits and net worth (credits plus 75% hull trade-in plus 50% outfits);
- date;
- systems explored, as n of the visible total (hidden systems not counted until found);
- jobs completed.

Save fields: `shipName` (it defaults to the hull name, and the shipyard asks for a name
on purchase, prefilled) and `stats: { jobsDone: number }`.

## 9. State and saves

Save version 4 adds `flags: []`, `shipName`, `stats: { jobsDone: 0 }`, `notes: []` and
`lastEncounterDay`. The migration from v3 fills in those defaults. Traffic, open hails
and sites are not saved.

## 10. Testing

- **Unit:**
  - traffic: spawn determinism, caps and errands ending, and no carriers outside hubs;
  - encounter rolls and conditions, every outcome, and the guide lockout;
  - the hidden lane: routes, charts and `seen` exclusion until the flag is set;
  - the survey thread from start to finish;
  - the guide's adaptive port;
  - the route preview for unknown destinations;
  - the balance targets in §7;
  - the save v3 → v4 migration;
  - data validation for `encounters.json` and `names.json`.
- **E2E (Playwright):**
  - NPC ships render and can be targeted;
  - a forced encounter (test hook) on desktop: answer the hail, pick a choice, and see
    the outcome;
  - the same encounter at phone size 844×390 through the context button;
  - the sound toggle hotkey;
  - the N map key in flight;
  - the hotkey works after a dialog;
  - the pilot card shows its stats.
- Existing suites stay green.

## 11. Delivery

The work goes on branch `living-galaxy`. It is built task by task with a review after
each task, then a final whole-branch review. It merges to `main` and deploys only
after the owner's OK, and the owner gets a phone notification when it is ready.

## 12. Open owner questions (defaults used until answered)

| Question | Default |
|---|---|
| Encounter rate | 25% of arrivals, never twice in a row |
| Map key | N everywhere (M also works in flight) |
| Interact key | Y |
| Sound on by default | Yes, volume 60 |
| Restored survey ship price | 60,000 cr |
| Stripping the derelict ends the thread | Yes (a real choice) |
