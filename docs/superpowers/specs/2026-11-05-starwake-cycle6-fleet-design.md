# Starwake — Cycle 6, part 2: Crew, wingmen, carriers and a nemesis (design)

Status: approved for spec · 2026-11-05 (owner pre-approved the cycle; choices logged in §9)

## 1. Goal

Finish cycle 6 with the four features the escorts spec left out (escorts spec §11): **crew**,
**wingmen**, **carriers and fighters**, and a **nemesis**. Everything builds on the escort group
(`WorldState.escorts`, escort NPCs, `escortAi`). It must stay playable on PC and phone, keep old
saves loading, and never break the live game.

It ships as three merges, in order, each fully tested and deployed before the next starts:

| Part | Features | Save |
|---|---|---|
| A | Crew, wingmen | v9 |
| B | Carriers and fighters | v9 (no shape change: fighters are outfits) |
| C | Nemesis | v10 |

All new tunables go in one new file, `data/fleet.json` (`FleetSchema`, loaded as `GameData.fleet`),
in sections `crew`, `wingmen`, `fighters` and `nemesis`, added part by part. The sim stays pure and seeded.

## 2. Part A1 — Crew

The pilot's ship now has a real crew that the pilot hires and loses. The hull's `crew` field
becomes its **complement** (the most crew it berths).

- **State.** `WorldState.crew: number`, 0 to the hull's complement. Starts full on a new pilot.
- **Data (`fleet.crew`):** `hireCost` (cr per crew member, 150),
  `failLoss` (share of the boarding party lost on a failed capture, 0.25),
  `winLoss` (share lost on a successful capture, 0.1), `minCrew` (1).
- **Boarding.** `captureOdds` uses `world.crew` (not the hull's complement) against the other
  ship's complement. A failed capture loses `ceil(crew × failLoss)`; a success loses
  `floor(crew × winLoss)`. Crew never drops below `minCrew`. The boarding card shows
  "Your crew 4 · hers 6" and the losses in its result line.
- **Hiring.** Any port with a `bar` offers **Hire crew** on the planet screen: one row showing
  "Crew 3/6" and a button "Hire 3 (450 cr)" that fills the complement. Refused with
  "Not enough credits." when short. No row when the crew is full. No wages.
- **Ship changes.** Buying a ship comes with a full crew (the yard crews it). Taking command of a
  capture moves your crew across, capped at her complement.
- **Sidebar.** No new line (the sidebar is full); crew shows on the planet screen and the
  boarding card.

## 3. Part A2 — Wingmen

Wingmen are named, one-of-a-kind pilots with their own ships. They join the escort group (they
count toward `maxEscorts`), take its orders, and differ from hired escorts in three ways: they
**gain rank** from takedowns, they **eject instead of dying**, and they **talk**.

- **Data (`fleet.wingmen`):**
  - `pilots`: each `{ id, name, shipId, homePort, requiresKills, fee, wage, bio, lines }`, where
    `lines` has `join`, `takedown[]`, `eject`, `back`. Four pilots, one per region, original
    names and lines.
  - `ranks`: `[{ name, takedowns, damageBonus }]` — Green 0 / +0%, Seasoned 3 / +10%,
    Veteran 8 / +20%, Ace 15 / +35%.
  - `recoverDays` (3): days a downed wingman needs before rejoining.
- **Meeting one.** A wingman waits at the bar of their home port when the pilot has at least
  `requiresKills` kills and the wingman is not already in the group. The planet screen shows a
  **Wingman** row: name, ship, rank, fee, wage and the bio, and a Recruit button. Refused when the
  group is full or credits are short (same reasons as hiring).
- **In the group.** A wingman is an `Escort` with `wingmanId` and `takedowns`. They fly, jump,
  refuel, draw wages and leave when unpaid exactly like a hired escort.
- **Rank.** Each ship a wingman disables counts one takedown. Their shots deal
  `1 + damageBonus` of normal damage (from their rank). Reaching a new rank shows
  "<name> is now <rank>." The rank shows in the Your escorts list.
- **Ejecting.** When a wingman's ship is destroyed they eject: they stay in the list with
  `downUntilDay = day + recoverDays`, do not fly or draw wages, and the HUD says their `eject`
  line. At the first landing on or after that day they are back with a rebuilt ship (full armor,
  their hull's default outfits) and their `back` line shows as a planet notice. Takedowns are kept.
- **Talk.** On each takedown the HUD shows one of their `takedown` lines (seeded by the takedown
  count) as "<name>: <line>".
- **Dismissing.** A dismissed wingman goes home and can be recruited again later at their home
  bar (their takedowns start over).

## 4. Part B — Carriers and fighters

The Bastion Carrier (already in the shipyard) gains a **fighter bay**. Fighters are small
player-side craft that launch, fight under the group's order and land back on the carrier.
NPC carriers launch fighters too.

- **Data.**
  - New outfit category `bay`: `effect: { fighter: <outfit id>, rate }` (launches per second).
    `fighter-bay` (Bastion-only via `hulls: ['carrier']`, space 20, max 2).
  - New outfit category `fighter`: `effect: { shipId }`, `max` per bay, bought at the outfitter
    like ammo. `wasp-fighter` (4 per bay, 6 000 cr).
  - New hull `wasp` (role `fighter`, hull `fighter`, never sold in the shipyard, never hired, never
    spawned as traffic) with one light blaster.
  - Outfits gain optional `hulls` (hull classes that may fit it). The outfitter refuses others with
    "Only a carrier can fit this.".
  - The Bastion's NPC loadout gains a bay and 4 Wasps; the shipyard Bastion is unchanged (bays are
    bought).
  - `fleet.fighters` holds `fighterDistance` (60 px) and `dockRadius` (40 px).
- **Player controls.** Bindable action `launchFighters` (default **KeyU**, "Launch / recall
  fighters"). With fighters docked and none out, it launches them one at a time at the bay's rate.
  With any out, it recalls them: they fly home and dock within `dockRadius`. Phone: a **LAUNCH**
  button in the rail, shown only with a bay and fighters. HUD messages: "Fighters launched.",
  "Fighters recalled.", "Fighters docked."
- **In flight.** A launched fighter is an escort NPC (`role: 'escort'`, id `esc-f<n>`,
  `fighterBay` set) that follows the group's order, but keeps station on a tighter arc
  (`fighterDistance`). It is not in `WorldState.escorts`; the docked count is the outfit count.
- **Docking.** Landing, jumping and being towed dock every launched fighter that is not
  disabled (back into the outfit count). Disabled or destroyed fighters are lost ("A Wasp is
  lost."). A carrier swapped away (selling the ship) loses no fighters: you can't sell or change
  ships while landed with fighters out, because landing docks them first.
- **NPC carriers.** An engaged NPC whose loadout has a bay launches its fighters (same rate) with
  its government and role, its aggro, and `fighterOf` = the carrier's id. They use the normal
  AI; with nothing to fight they fly back and dock. If the carrier is gone they keep fighting
  and then leave with the system's traffic. NPC fighters never count as kills for clear jobs
  (they are not raiders' hulls) unless they belong to raiders.
- **Law.** Fighter hits are escort hits (player-side), so the same crime rules apply.

## 5. Part C — Nemesis

A recurring rival who hunts the pilot once they are known as a fighter.

- **Data (`fleet.nemesis`):** `name`, `title`, `requiresKills` (10),
  `chance` (0.25 on arrival in a system with no story ship), `cooldownDays` (6), `defeatsToEnd`
  (4), `levels` (per defeat: `shipId`, extra `outfits`, `reward`), `lines` (`arrive[]`,
  `escape[]`, `final`), `finalFlag` (`nemesis-done`), `finalReward`.
- **State.** `WorldState.nemesis: { defeats, nextDay, done }` (save v10, migration 9 → 10 adds
  `{ defeats: 0, nextDay: 0, done: false }`).
- **Appearing.** On arrival in a system (not the start system, not with the guide on, not
  `?calm`), when `kills ≥ requiresKills`, not done, `day ≥ nextDay`, and a seeded roll
  `(seed, 'nemesis', day, systemId) < chance`, the nemesis jumps in as a hostile NPC
  (`role: 'raider'`, `government: 'raiders'`, `nemesis: true`) flying the hull for their level, and
  the HUD shows an `arrive` line as a hail ("<name>: …"). They ignore demands and never flee.
- **Defeat.** Disabling the nemesis (by anyone on the player's side) makes them eject: the ship
  vanishes in a flash, the HUD shows an `escape` line, `defeats + 1`, `nextDay = day +
  cooldownDays`, and the level's `reward` is paid. They can't be boarded. The `defeatsToEnd`-th
  defeat is final: the `final` line, `finalReward`, `finalFlag` set, a captain's-log note, and
  `done = true`.
- **Losing.** If the nemesis is in the system when the pilot is destroyed or towed, `nextDay`
  is set to `day + cooldownDays` (they gloat and leave).
- **Leaving.** If the pilot jumps or lands with the nemesis still there, nothing is counted;
  they can appear again from `nextDay` (unchanged).

## 6. Save

- **v9 (Part A).** `crew: number` (migration 8 → 9 sets `-1`, meaning "full"; `worldFromPilot`
  resolves it to the hull's complement). Escort entries gain optional `wingmanId`, `takedowns`
  and `downUntilDay`. Tolerant loading: a non-finite crew becomes full, crew clamps to
  [0, complement]; an unknown `wingmanId` turns the entry into a plain hired escort; two entries
  with the same `wingmanId` keep the first.
- **v10 (Part C).** `nemesis: { defeats, nextDay, done }`; corrupt values load as the default.
- Old saves (v1–v8) chain forward and load.

## 7. Testing

- **Unit:** schemas and cross-checks (unknown hulls, ports, outfit ids, a bay naming a
  non-fighter); crew hire, losses and odds; ship purchase and command crew; wingman offers,
  recruit, takedowns and rank, damage bonus, eject and return; fighter launch, recall, dock, loss,
  NPC carrier launch; nemesis spawn rules, defeat, final defeat, cooldown; v9 and v10 migrations
  and tolerant loading.
- **E2E (per part):** A: hire crew at a bar; recruit a wingman and see them in the group;
  a wingman takedown raises the count. B: buy a bay and fighters, launch with L, recall, dock on
  landing; phone LAUNCH button. C: nemesis appears (forced by a test hook), disabling them pays
  the reward and records the defeat. The sidebar still fits 1280×600.
- **Process:** typecheck, Vitest, the full Playwright suite and the build pass before each merge;
  the Deploy workflow is green and the live site loads after each.

## 8. Docs

How to Play gets "Crew & wingmen", "Carriers" and "Nemesis" sections (in the Escorts tab, or a
tab each where the tab bar has room); README feature list and the design-notes roadmap are
updated per part.

## 9. Decisions to review with the owner

The owner pre-approved this cycle and asked for recommended options where a question would
normally go to them. Each is easy to change (most are numbers in `data/*.json`):

1. **Three merges** (A crew + wingmen, B carriers, C nemesis), as the task's fallback order.
2. **Crew has no wages**, only a hire cost (150 cr each) to fill the complement at any bar.
   Wages on top of escort wages felt like too much bookkeeping for a small game.
3. **Crew only matters for boarding** (capture odds and casualties). No penalty for flying
   short-handed.
4. **Buying a ship gives a full crew**; taking command of a capture moves your crew over.
5. **Wingmen share the escort limit** (3). They are recruited for a fee and draw a wage like hired
   escorts.
6. **Wingman rank is a damage bonus** (+10/20/35% at 3/8/15 takedowns), counted on disables.
7. **Wingmen eject instead of dying** and come back after 3 days at the next landing, with a
   free rebuilt ship.
8. **Four wingmen**, at Vanterre, Brannock Deeps, Lastlight Beacon and Reed's Anchor, needing 0,
   3, 6 and 10 kills.
9. **Fighters are outfits** (like ammo): a Fighter Bay (carrier hulls only) and Wasp fighters
   bought at the outfitter; one key launches all, the same key recalls.
10. **Fighters dock automatically** on landing, jumping and tows; disabled ones are lost.
11. **NPC Bastions carry fighters** and launch them when they fight.
12. **The nemesis** ("Kade Varro, the Ashen Hand") appears from 10 kills, at most every 6 days, with
    a 25% chance per arrival, ejects when disabled, and is finished after 4 defeats, getting a
    tougher hull each time. Rewards 5 000 / 10 000 / 20 000 cr and 50 000 cr at the end.
13. **Default keys:** U for fighters (L is Land; I stays escort orders).

## 10. Out of scope

Per-escort orders, a fleet screen, crew wages and morale, crew skills, escort upgrades at the
outfitter, fighters on non-carrier escorts, a nemesis story arc beyond the four duels, and more
than one nemesis.
