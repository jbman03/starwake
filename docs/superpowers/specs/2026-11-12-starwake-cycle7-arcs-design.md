# Starwake cycle 7, Part 1: branching storylines (framework, Leads log, Concord Navy arc)

## Intent

The roadmap item is "Branching storylines with twists": four story arcs that split early, lock each other out
and change the galaxy map as you play them. This round follows the EV lesson: Nova's storylines gave it replay
value, but players disliked the shared forced stretch and the long waits between story steps. So the arcs split
on day 1, and a Leads log always says where the next step is.

**The owner chose:**
- Four new arcs that split early. The shipped Lanterns story (M1–M4) and its Concord and Free Reach arcs
  (C1–C7, R1–R7) stay as they are, as side content.
- Ship it in parts. **Part 1** (this spec) is the arc framework, the Leads log and one full arc,
  **Concord Navy**. It gets merged and deployed on its own. Free Reach Rising, The Syndicate and The Wake
  mystery follow in later parts and need no new engine work, only data.

**Part 1 is done when:**
- A new pilot can take the Navy commission at Halcyon on day 1.
- Taking it locks out the other arcs; with only Navy in the data this is checked by tests.
- The arc has a three-way choice and a mid-arc twist with two endings. Each commit choice warns first.
- Both endings change the map: systems change flag, a station can be destroyed and a new port appears.
- The Leads log always shows the next step.
- Finishing the arc gives every later pilot a legacy perk.
- The suite passes, the live game stays playable, and old saves load.

## 1. Arc framework

### Data: `data/arcs.json`
```json
{ "arcs": [ {
  "id": "navy",
  "title": "Concord Navy",
  "government": "concord",
  "blurb": "Hold the line for the Concord against the Free Reach.",
  "entry": { "mission": "n1-commission", "lead": "Commander Idris Hale is recruiting at the Halcyon bar." },
  "ranks": [ { "title": "Ensign", "points": 0 }, { "title": "Lieutenant", "points": 20 },
             { "title": "Commander", "points": 50 }, { "title": "Captain", "points": 90 } ],
  "legacy": { "text": "Navy veteran: your old commander sends 5,000 cr to every new pilot.", "credits": 5000 }
} ] }
```
- Zod schema `ArcSchema`, plus a load-time check that `entry.mission` exists and that its `arc` is this arc.
- `legacy` takes any of `credits`, `shipId` (the start hull) and `flag` (a contact flag set at the start).
- `StoryMissionSchema.arc` becomes a string. It is either one of the old values (`main`, `concord`, `reach`,
  `side`) or an arc id from `arcs.json`, and the loader checks which.

### Lockout
- Accepting a mission whose arc is in `arcs.json` sets the flag `arc:<id>`.
- A mission of arc X is offerable only while no `arc:<other>` flag is set. Once you commit to one arc, the
  others vanish from the bars, the hails and the Leads log.
- The arc's first mission says so in its offer text, and its Accept asks for a commit confirmation (see below).

### Ranks
- A new outcome `{ "type": "arcPoints", "arc": "navy", "n": 10 }` adds to `world.arcPoints[arc]`.
- Reaching rank *k* sets the flag `<arc>-rank-<k>` and posts a note: "Promoted to Lieutenant".
- Missions gate on rank with the existing `offer.requires` flags. Ships and outfits gate on it with the
  existing `requiresFlag`.
- The pilot card's rank lines show the arc title, for example "Concord Navy: Lieutenant", next to the
  existing faction ranks.

### Choices, commits and the `decide` step
- `EncounterChoiceSchema` gains `commit?: true`. Picking a commit choice first opens a confirm dialog: "This
  choice can't be undone. <label>?" with Confirm and Back. The arc's first mission gets the same treatment on
  Accept, via `StoryMissionSchema.commit?: true`.
- A new step kind, `{ kind: 'decide', planet, card, text }`, opens its card (the encounter card UI) when the pilot
  lands at `planet`. Outcomes apply as they do for a `meet` card, and the step is done. Closing the card without
  choosing leaves the step open, so landing again reopens it.

### Map changes: the galaxy overlay
- `WorldState.galaxy = { governments: Record<systemId, govId>, destroyed: planetId[] }`, saved.
- New outcomes:
  - `{ "type": "government", "system": "brannock", "government": "concord" }`
  - `{ "type": "destroyPlanet", "planet": "the-commons" }`
  - `{ "type": "heat", "government": "concord", "n": 100 }` adds legal heat through the existing `addHeat`
    (enough heat makes the pilot Hunted, so that government's ports refuse landing)
- A planet can carry `appearsFlag`: it is absent until that flag is set (a new port the story opens).
- `applyGalaxy(base: GameData, world): GameData` returns `base` itself when there are no changes. Otherwise it
  returns a copy in which:
  - `systems` carry the overridden governments,
  - destroyed planets and not-yet-appeared planets are left out of `planets`.

  The result is memoised on a key built from the changes.
- The controller's `data` becomes a getter over `applyGalaxy(baseData, world)`. It is recomputed after
  outcomes, after a load, and on a new session. Every existing reader (the map colours, traffic, law, the bars,
  the HUD, the sidebar) sees the changed galaxy with no per-site edits.
- Safety rules, enforced as data tests (including that no step after a `heat` outcome needs a port of that
  government):
  - A destroyed planet is never a later step's planet.
  - A destroyed planet is never the planet where the destroying step completes.
  - `config.startPlanetId` is never destroyed.
- If the pilot is landed at a planet that becomes absent (only reachable through a plug-in), they take off at
  its last position.

### Legacy
- A new IndexedDB key, `legacy`, holds `{ arcsDone: string[] }`. It is shared by every pilot on the device.
- A new outcome `{ "type": "arcDone", "arc": "navy" }` records the arc as done.
- A new pilot gets each done arc's perk at creation: credits are added, `shipId` replaces the start hull and
  `flag` is set. The new-pilot screen lists the perks under "Legacy".
- Lockout is per pilot, so a legacy perk never opens another arc. Pilot export and import leave legacy alone.

### Saves
- Version 11. The migration adds `galaxy: { governments: {}, destroyed: [] }` and `arcPoints: {}`. Old pilots
  are otherwise unchanged.

## 2. Leads log

- A Leads section at the top of the Mission Log. It replaces the single "Next lead" line, and the bar's lead
  line uses the same source.
- `leads(world, data): Lead[]` returns one line per thread, each with a Show on map button:
  1. **Active story missions:** `<title>: <current step text> (<system>)`, and why: "for <giver>".
  2. **Offers you can take now:** `<giver> at <port>: <title>`. This covers the main story, side chains and
     arc missions, using the same conditions as the bars and hails.
  3. **Untaken arcs** (no arc chosen yet): the arc's `entry.lead`, tagged "Story arc: <title>. Taking it closes
     the other arcs."
- No arc mission uses `minDay`, so an arc always has a lead. If a thread is waiting only on a day count, the
  lead says "From <date>" rather than going quiet. A data test checks that every arc mission in a reachable
  state produces a lead.

## 3. The Concord Navy arc

All systems and ports already exist. Ids are given as `system/port`.

| # | Mission | Where offered | Steps | Result |
|---|---|---|---|---|
| N1 | The Commission (commit) | Halcyon bar, day 1. Giver: Commander Idris Hale | Ferry 2 cadets to Vanterre (tessaly) | +10 pts, 3,000 cr, `navy-1` |
| N2 | Picket at Hollis | Vanterre bar | Go to hollis; scan "Reach courier beacon"; land at Picket Station | +10 pts (Lieutenant), `navy-2` |
| N3 | The Thistle Convoy | Picket Station bar | Meet the convoy *Haywain Relief* in thistle. **Three-way card:** seize it (commit; Free Reach cool), escort it through (Free Reach neutral) or wave it on and say nothing | +10 pts, `navy-3` plus `navy-seized`, `navy-mercy` or `navy-quiet` |
| N4 | The Quartermaster's Ledger | Lamplight Yards bar. Giver: Quartermaster Sable Wren (the stranger) | Deliver 10 t of "sealed lantern cores" to Corvana Works | +20 pts (Commander), `navy-4` |
| N5 | Cold Cores (**the twist**) | Corvana Works bar | Scan the "core furnace" in corvana, then `decide` at Smelt Ring. The cores are full, not spent: the Navy melts them down so the fringe lanterns stay dark and the Reach starves. **Card:** keep the secret (commit), expose it (commit) or, needing `navy-mercy`, hand the ledger to the convoy captain you spared (commit) | `navy-loyal` or `navy-exposed`; exposing also sets Concord cool and Free Reach neutral, or Free Reach friend on the convoy route |
| N6L | Hold the Line | Concordance bar (`navy-loyal`) | Deliver 20 t of garrison supplies to Hollis Landing | +20 pts; **brannock and thistle become Concord** |
| N7L | The Commons | Picket Station bar | Meet a Reach captain in wrenhold. **Card:** destroy The Commons (commit; `destroyPlanet the-commons`) or take their surrender | +20 pts (Captain); **wrenhold becomes Concord**; `navy-done`, `arcDone navy` |
| N6X | Running Dark | Dunmore Crossing bar (`navy-exposed`). Giver: Tamsin Vey | Ferry 3 witnesses (boarded at Dunmore) to Wrenhold | +20 pts, `navy-6x` |
| N7X | The Lantern Fire | Wrenhold bar | Scan "the core convoy" in hollis (in space: no Concord landing needed), then land at Wrenhold | +20 pts; **hollis becomes Free Reach**, and the new **Freehold Light** station appears there (`appearsFlag: navy-freehold`); `navy-done`, `arcDone navy` |

- **Costs of exposing:** Concord standing drops to cool, which locks Concord hulls and gear. A `heat` outcome
  makes the pilot Hunted by the Concord, so Concord ports refuse landing until the heat decays or the fines are
  paid at a non-Concord port. The defector missions never need a Concord port. The Navy rank titles stay, but
  the rank lines show "(struck off)" after `navy-exposed`.
- **The stranger:** Sable Wren's giver entry carries `"stranger": true`. Later arcs give the same character a
  different name. A note set at N4 ("The quartermaster's eyes did not match her papers") is the first thread of
  that tie-in.
- **Unlocks:**
  - Commander (`navy-rank-2`) opens a new data-only hull at Lamplight Yards, the **Picket cutter**. It is a fast
    Concord gunship with procedural art, like every hull, and needs `navy-rank-2` and Concord friend.
  - Captain is the ending's title.
- **Writing:** every mission has original offer text, accept text, step text and outcome messages, with three
  card texts in the house tone: plain, warm and dry. No reused names other than Tamsin Vey, who already exists.
- **Points:** 10 + 10 + 10 + 20 = 50 reaches Commander at the twist, and 50 + 20 + 20 = 90 reaches Captain at
  either ending.

## 4. Plug-ins and the Editor

- `arcs` joins the plug-in record types and merges like the others, so a plug-in can add an arc with its
  missions.
- The Editor gets an arcs collection if its forms are schema-driven. If it isn't, that is deferred to Part 2,
  and the Editor guide says arcs come from plug-in JSON for now.

## 5. Testing

- **Unit:**
  - `applyGalaxy`: identity when unchanged; government override; destroyed and appearing planets; memoisation.
  - The new outcomes.
  - Lockout across two arcs, using a test fixture arc.
  - Rank flags and notes.
  - Commit confirm, and `decide` open, close and reopen.
  - `leads()` for active, offer and untaken cases, with a lead always present along both Navy paths.
  - Legacy store and new-pilot perks.
  - Save v10 → v11 migration.
- **Data:** the arcs load-time checks; the destroyed-planet safety rules; every Navy mission reachable; both
  endings reached by a walkthrough test (like `storyArcConcord.test.ts`) that checks the final governments and
  planets.
- **E2E:** take N1 at Halcyon, with its commit confirm; the Leads log shows the next step; a forced N6L outcome
  recolours brannock on the Star Map. Run the full suite before the merge.

## Decisions to review with the owner

- **Map changes are an overlay on the data view** (approach A), not edits at about 170 call sites. Every screen
  sees the new map for free. The cost is one memoised copy of the data when the map has changed.
- **Arcs lock out on taking the first mission**, which needs a commit confirm, rather than on finishing it. That
  way the split comes early and is explicit.
- **"Hunted in the core" after exposing** reuses the law system: a new `heat` outcome makes the pilot Hunted by
  the Concord, and Concord standing goes to cool. It wears off like any crime (heat decays, and fines can be
  paid), so it is not permanent. No new law state is added.
- **Legacy is per device** (IndexedDB), not exported with a pilot, because it belongs to the player, not the
  pilot. Both Navy endings give the same perk: 5,000 cr.
- **The defector path ends inside the Navy arc** in Part 1 (N6X and N7X). When Free Reach Rising ships, the
  defector can carry on into it.
- **New hull, the Picket cutter**, is data-only with procedural art, so it is an original asset.
- **The Editor's arc form** may wait until Part 2 if the Editor isn't schema-driven. Plug-ins can add arcs
  from Part 1.
- **Made while building (Part 1):**
  - **The final Navy mission pays 6,000 cr**, not 8,000. The existing balance test caps story pay at twice the
    best trade loop per jump.
  - **The Quartermaster's Ledger (N4) makes the Concord a friend.** The Picket cutter needs Concord friend, and
    a Navy pilot had no other way to earn it.
  - **The bar's one-line hint still suggests a single next contact.** The full Leads list lives in the Mission
    Log, as compact rows: tap or Enter opens the map. A button for every lead pushed the phone log's buttons off
    screen.
  - **A decide card put off with "Not now" reopens at the next landing** there, not on reopening the planet
    screen during the same visit.
  - **Arcs in the Editor use its generic record editor** (JSON fields, like story missions). There is no
    dedicated arc form.
  - **New original names:** convoy master Bryn Arden, Captain Rook Danner and foreman Ilse Varga.
