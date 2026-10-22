# Starwake: Cycle 3 — Story, Side Missions and the Spaceport Bar

**Date:** 2026-10-22
**Status:** Design approved in chat by the owner on 2026-10-22; the written spec still needs the owner's review
**Builds on:** the living galaxy (`2026-10-20-starwake-living-galaxy-design.md`), shipped
**Context:** `docs/design-notes.md` (EV series study, fun review)

## 1. Purpose

The owner asked for storyline missions and side missions that give reasons to explore
the galaxy, the way Escape Velocity did. This cycle adds:

- a **spaceport bar**, where named contacts offer story and side jobs;
- a data-driven **story mission engine**;
- one main storyline, **"The Lanterns Go Dark"**: a shared opening arc that ends in a
  choice of side, then a Concord arc or a Free Reach arc;
- **8 side chains** spread across the galaxy;
- a new region, **the Dimming**, opened partway through the shared arc;
- **light faction standing**, which unlocks each side's story ships and gear.

Owner decisions (2026-10-22):
- Missions come from the bar, and hails can continue them.
- The story has a shared start, then you pick a side. That locks out the other side for
  this pilot.
- A new region of about 9 systems.
- No combat for now. Steps that become fights later are written as non-combat steps.
- The premise is "The Lanterns Go Dark".
- 8 short side chains.
- Light standing now. Full reputation and police wait for the factions cycle.

Design rules still hold:
- All names and text are original.
- On phones nothing covers the game view except the bottom context button, unless the
  player opens a screen.
- Every new action has a rebindable hotkey.

**Build in two plans:**
- **Plan A, the engine and shared arc.** The bar, the mission engine, standing, the
  Dimming, the shared arc (M1–M4) with the choice, and 2 side chains (S1, S2) to prove
  the engine.
- **Plan B, both side arcs.** The Concord arc (C1–C7), the Free Reach arc (R1–R7), the
  other 6 side chains, the unique ships and outfits, and a balance pass.

Plan A ships playable on its own. Plan B is content and tests on the same engine.

## 2. The story

### 2.1 Premise

The Concord of Lanterns keeps the hyperlanes safe with lane beacons, called "lanterns".
Out on the rim, lanterns are going dark one by one: someone is stripping their cores.
The trail leads past the charted lanes into a dark region the old charts call the
Dimming. The Concord wants the lanes relit and the region under its charter. The Free
Reach Compact wants the lanes free of Concord tolls, with the Dimming settlers left to
run their own affairs. The pilot ends up holding the evidence, and the lane charts, that
decide it.

### 2.2 Cast (original)

- **Warden Sela Corrin**: a Concord lane-warden, tired and principled. Based at
  Concordance (Aurelle).
- **Tamsin Vey**: a Free Reach broker, charming, who keeps her word to the letter. Based
  at Wrenhold.
- **Odo Haskett**: an independent analyst at Lastlight who can read a dead core.
- **The *Low Tide***: a scavenger ship that knows more than it says, captained by Mags
  Orrin.
- **The core-takers**: unpaid rim salvagers led by **Bram Kettle**, more desperate than
  wicked.
- **The Dimming settlers**: the Unlit Holdings, a new government. Their speaker is
  **Ama Reed**.

### 2.3 Shared arc (Plan A)

| # | Title | Offered | Steps (non-combat) | Outcome |
|---|---|---|---|---|
| M1 | Lights Out on the Rim | Halcyon bar, day ≥ 2 or after the guide | Go to Skerry and **scan** the dead lantern (a story site) | Credits 3,000; note; flag `lanterns-1` |
| M2 | A Second Opinion | the Halcyon bar or Warden Corrin's port bar | **Deliver** the core fragment (1 t) to Odo Haskett at Lastlight within 8 days | Credits 4,000; note: the core was cut, not burned out |
| M3 | Low Tide | the Lastlight bar | **Meet** the *Low Tide* in Brackwater. Choose to pay 5,000 cr, trade 10 t of food, or bluff (fails unless you carry food) | Flag `dimming-lane`, which opens the hidden lane from Oxbow; the Dimming systems are charted 1 jump in |
| M4 | Past the Charts | by hail on entering the Dimming | **Go** to Gloam, **find** the stripped-lantern field (site), **meet** Bram Kettle | **The choice:** give the evidence to Corrin (`side-concord`) or the lane charts to Vey (`side-reach`). The chosen side's standing becomes friend and the other's becomes cool. Credits 6,000 |

### 2.4 Side arcs (Plan B)

Each arc is 7 missions. It starts from its patron's bar and runs through the Dimming
and the patron's space.

- **Concord, "Relight":**
  1. ferry lane engineers into the Dimming;
  2. deliver lantern cores;
  3. relight three lanterns: go and scan in three Dimming systems;
  4. meet Bram Kettle to negotiate his crew's surrender (a fight later);
  5. carry the charter to Ama Reed;
  6. escort a charter liner by flying ahead and scanning;
  7. the ceremony at Concordance.

  Reward: the **Lantern-tender** (a unique Concord hull) and Concord standing friend.
- **Free Reach, "Free Lanes":**
  1. carry lane charts to independent traders;
  2. ferry settler delegates to Wrenhold;
  3. broker back-pay for Bram's salvagers;
  4. place Reach waylights (go and scan) in three Dimming systems;
  5. slip past a Concord patrol cordon by choosing a route (a fight later);
  6. bring Ama Reed to the compact meeting;
  7. the signing at Wrenhold.

  Reward: the **Freewind runner** (a unique Free Reach hull) and Free Reach standing
  friend.

Choosing a side sets `side-concord` or `side-reach`. The other arc's missions require
the opposite flag, so they never offer.

### 2.5 Side chains

All are original, 2–4 steps each, and offered in bars.

| # | Chain | Where | Reward | Plan |
|---|---|---|---|---|
| S1 | **The Missing Courier**: find Pell Darrow's ship, overdue on the Vesk run | Vesk, Mirren, Lastlight | 5,000 cr plus a rumour | A |
| S2 | **The Surveyor's Charts**: recover a surveyor's lost chart tubes | Corvana, Thistle, Cinderfall | Unique outfit *Surveyor's Folio*, a map that charts 6 jumps | A |
| S3 | **The Pilgrim Road**: ferry pilgrims to four shrine worlds | across the galaxy | Credits and a note | B |
| S4 | **Two Houses**: the feuding Marlow and Teague haulers; side with one | Redwater, Oxbow | Unique *House Rack* cargo outfit | B |
| S5 | **The Collector**: bring Copperwine, Glowmoss and Stillwater Pearl | Quillon | Unique *Cold Hold* cargo outfit | B |
| S6 | **Echoes of the Long Patience**: needs `survey-claim` | Hushwater, Skerry | Credits and a rumour | B |
| S7 | **The Doctor's Rounds**: medical deliveries against deadlines | fringe ports | Credits | B |
| S8 | **The Last Lightkeeper**: the old keeper of a dead Dimming lantern | the Dimming | Unique *Keeper's Lens*, a map that reveals the whole Dimming | B |

## 3. The Dimming (Plan A)

- **Systems.** 9 new systems east of Oxbow, at map x of about 650–950. Government: a new
  **Unlit Holdings** with a grey-violet colour.
- **Entry.** A hidden lane Oxbow ↔ Gloam opens with the flag `dimming-lane`. It reuses
  `hiddenLinks` and `lanesOf`. Inside the region, lanes are normal once the region is
  open.
- **Worlds.** 5 ports. Mostly tier 1–2, plus one tier-3 station, **Reed's Anchor**, with
  a shipyard and outfitter. Each port has the bar.
- **Goods.** One unique good, *Dimglass*, a lantern-glass offcut, base price 700. Its
  buyers are Concord worlds.
- **Traffic.** Sparse: [0, 2], with Unlit Holdings ships.
- **Hidden count.** Until the flag is set, `visibleSystemCount` excludes all 9 Dimming
  systems, the same as Hushwater.

## 4. The spaceport bar (Plan A)

- **Service.** A new value `'bar'` in `PlanetSchema.services`. Most tier-2+ ports and
  every Dimming port get it.
- **Hotkey.** A new action `openBar`, planet group, default `KeyB`, label "Spaceport
  Bar". It sits on the planet screen beside the other services.
- **Screen.** It shows the port name and the date, and three lists:
  - **Contacts:** story or side offers available here, each with the giver's name, a
    title and an offer text, plus Accept and Decline.
  - **Gossip:** today's rumour (the existing `rumor()` line) plus one flavour line from
    the port.
  - **Lead:** when a story lead points elsewhere, one line such as "Talk is that a Concord
    warden at Concordance wants a pilot."
- **Phones.** Same layout as the mission computer at 844×390. Map button in the corner.

## 5. The story mission engine (Plan A)

Data lives in `data/story.json`, rules in `src/sim/story/` (pure and unit-tested), and
the UI in `src/ui/bar.ts` and the mission log.

### 5.1 Mission data (zod-validated)

```
StoryMission {
  id; arc: 'main' | 'concord' | 'reach' | 'side'; chain?: string;
  title; giver: { name; title };
  offer: { where: 'bar' | 'hail'; ports?: planetId[]; systems?: systemId[];
           requires?: flag[]; notFlags?: flag[]; minDay?: number;
           standing?: { [government]: 'cool' | 'neutral' | 'friend' } };
  text: string;           // the offer
  acceptText: string;
  declinable: boolean;    // main-arc missions can be put off, never lost
  steps: Step[];          // done in order
  onComplete: Outcome[];  // reuses the encounter Outcome union plus standing/unlock
  onFail?: Outcome[];
  combatLater?: string;   // the note for the combat cycle
}
Step =
  | { kind: 'go'; system: id; text }
  | { kind: 'land'; planet: id; text }
  | { kind: 'deliver'; planet: id; cargo: { name; tons }; deadlineDays?; text }
  | { kind: 'ferry'; planet: id; passengers: number; deadlineDays?; text }
  | { kind: 'scan'; system: id; site: { label }; text }   // fly to a story site, press interact
  | { kind: 'find';  system: id; site: { label }; text }   // like scan, but it isn't on radar until you're within 600 px
  | { kind: 'meet'; system: id; ship: { name; shipId; government }; card: EncounterCard; text }
```

- **New outcomes:** `standing { government, level }` and `unlock { ship | outfit }`. An
  unlock sets a flag that `requiresFlag` items read.
- **Meet steps** spawn a named story NPC (from traffic) that waits near the system
  centre and hails the pilot. The hail opens an encounter card whose choices complete
  the step, branch, or fail it.
- **Cards** reuse the encounter card UI and `choiceBlock` / `applyChoice` rules.

### 5.2 State (save v5)

- `world.story`:
  - `active: { id; step: number; deadlineDay: number | null }[]`
  - `done: string[]`
  - `failed: string[]`
  - `declined: string[]`
- `world.standing: Record<governmentId, 'cool' | 'neutral' | 'friend'>`. A government
  that is absent counts as neutral.
- Migration 4 → 5 fills empty defaults.
- Story missions do not count toward `MAX_MISSIONS`. They do use the hold and the berths,
  and acceptance is blocked with a reason when the ship can't carry them.

### 5.3 Rules

- **Offers.** `storyOffersAt(world, data, portId)` lists missions whose offer conditions
  are met, that are not active, done or failed, and where no other mission of the same
  arc or chain is active. The main arc only offers in order.
- **Progress.**
  - Steps advance on events: arrival (go), landing (land, deliver, ferry), interact at a
    site (scan, find), and card choice (meet).
  - Cargo and passengers are loaded on accept and unloaded on the step that delivers them.
- **Deadlines.**
  - Missing a deadline fails the mission and applies `onFail`.
  - A main-arc mission never fails for good: it returns to its giver's bar the next day,
    and its cargo is lost.
- **Abandon.** Side missions can be abandoned from the log. Main-arc missions can't.
- **The choice.** An M4 card choice sets the side flag and both standings in one outcome
  list.
- **Leads.** `nextLead(world, data)` returns the port of the first available main-arc
  offer, or else of a side offer, for the log and the bar's Lead line.

### 5.4 Mission log

- A new **Story** section, above Jobs. For each active story mission it shows:
  - the title and the giver;
  - the current step's text;
  - the destination and any deadline;
  - a **Show on map** button that previews the destination, like the cycle 2 job preview.
- When nothing is active, a **Next lead** line shows `nextLead`.
- Completed story missions list under **Done** with their date.

## 6. Standing (Plan A)

- Three levels per government: **cool**, **neutral** and **friend**.
- **Pilot card:** "Concord: friend · Free Reach: cool".
- **Gating:** ships and outfits gain an optional `requiresStanding: { government, level }`
  (friend). The shipyard shows a locked tile, like the Patience teaser, with "Requires
  Concord friendship".
- **Out of scope:** standing does not yet affect landing, prices, police or traffic
  hostility (factions cycle).

## 7. Unique rewards (Plan B, data)

- **Lantern-tender** (Concord, sold at Concordance with friend standing and
  `concord-done`): a sturdy mid-hull with good fuel range, a 60 t hold, and room for
  future turrets.
- **Freewind runner** (Free Reach, sold at Wrenhold with friend standing and
  `reach-done`): fast, a 30 t hold, and the longest jump range in the game.
- **Unique outfits** from S2, S4, S5 and S8, each sold once after its chain. They use
  existing categories (map, cargo).
- Hold sizes must stay unique (balance test).

## 8. Testing

- **Unit:**
  - offer conditions, including order and the lock-out after the choice;
  - each step kind advancing on its event;
  - deadlines: failing a side mission, and the main arc returning to its bar;
  - cargo and passenger load and unload;
  - the abandon rules;
  - standing outcomes and gating;
  - `nextLead`;
  - the save v4 → v5 migration;
  - data validation of `story.json`: every port, system, ship, good and flag reference
    exists, every mission is reachable from its requirements, and no step points at a
    hidden system without the flag that opens it;
  - Dimming hidden until `dimming-lane`.
- **Story walk-through test:** a pure test plays M1 → M4 → each side's arc to the end
  (Plan B) through the real rules, choosing one side and then the other in two runs.
- **E2E (Playwright):**
  - open the bar with B, accept M1, see it in the log with Show on map;
  - complete a scan step through the test hook;
  - the M4 choice locks the other side's offers;
  - the bar at phone size 844×390 with every control on screen.
- Existing suites stay green.

## 9. Delivery

- **Plan A:** branch `cycle3-story-engine`.
- **Plan B:** branch `cycle3-story-arcs`, built after Plan A merges.

Each plan is built task by task, with reviews and a final whole-branch review. Each
merges and deploys only after the owner's OK. A phone notification goes out when each
is ready.

## 10. Open owner questions (defaults used until answered)

| Question | Default |
|---|---|
| Bar hotkey | B on planet screens |
| Can main-arc missions fail for good? | No: they return to the giver's bar |
| Do story missions count toward the 8-job limit? | No |
| How the choice affects standing | Chosen side friend, the other cool |
| Dimming size | 9 systems, 5 ports |
| Unique hull prices | Lantern-tender 180,000 cr, Freewind 150,000 cr |
