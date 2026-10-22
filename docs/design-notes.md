# Design notes

Decided in the 2026-10-15 design session. Each sub-project gets its own spec
under `docs/superpowers/specs/`.

- **Name:** Starwake (working title; name/trademark check before public launch)
- **Audience:** personal project first, may be released publicly later
- **Favorite EV parts to carry over:** flying, missions, the battle system,
  boarding/capture
- **Progression:** story-driven unlocks; tiered shipyards, best ships only at
  higher-tier worlds
- **Flight:** classic EV momentum with optional assists
- **Phone controls:** side rails, bottom-center context button, tap planet to land
- **PC controls:** arrow keys, a hotkey for every action, all rebindable
- **Art:** rendered look as close to classic EV as possible (original assets)
- **Tech:** Phaser + TypeScript PWA on GitHub Pages (public repo, all rights reserved)

Foundation spec: `docs/superpowers/specs/2026-10-15-starwake-foundation-design.md`

## Original EV concept (from the owner, 2026-10-16)

Reference screenshots came from EV running in the browser at
https://infinitemac.org/1996/System%207.5.3 (useful for checking feel later).

- **Planets** each offer their own mix of services: Commodity Exchange, Mission
  Computer, Spaceport Bar, Outfit Ship, Shipyard. Some have one, some all.
- **Commodity exchange:** goods (Food, Industrial, Medical, Luxury Goods, Metal,
  Equipment, plus unique local goods) each at Low/Med/High plus a price.
  Planet events (surplus/shortage) push prices down or up; another random
  port may be the opposite. Cargo in tons; shuttle starts with 20 free.
- **Mission computer:** generic jobs that differ by trip length and cargo:
  ferry passengers, rush delivery, cargo transport, cargo shipment, cargo
  delivery, dump garbage. Accept from a list with description and pay.
- **Star map:** systems as circles on hyperlanes; zoom; unexplored systems
  blank until visited or a map is bought (maps reveal everything within N
  jumps). Panel: current system, government, legal status, goods traded,
  services, ports, navigation hazards, date. EV started small and grew past
  100 systems.
- **Outfitter:** paged icon grid with owned counts — guns, launchers + ammo,
  turrets, fighter bays, armor, cargo pods, fuel tanks, escape pod, scanners,
  afterburner, mass expansion, maps. **Shipyard:** icon grid of ships + Info.
- **Main menu:** pilot card (pilot name, ship name, ship type, legal status in
  current system, combat rating, date). **In flight:** right-hand sidebar
  (radar, shield/fuel, nav destination, secondary weapon, target, cargo free,
  credits).
- **Factions:** two main powers (EV: Confederation vs Rebellion), plus pirates
  (random, more in outer systems), independent traders and other NPCs.
  Starwake equivalents: **the Concord** (core government), **the Free Reach**
  (frontier independence movement), **raiders**, independents.
- **Reputation:** missions for one side make you wanted by the other; enough
  and they shoot on sight and refuse landing on their worlds. Ships you shoot
  fight back; bribes work only up to a limit. Police scan at random in secure
  systems and patrolled outer areas, not everywhere.
- **Combat:** lasers and missiles hit shields, then armor. Below 10% armor a
  ship is disabled: can't move or shoot, slows and drifts (then boardable).

## Owner feedback after playing (2026-10-17)

- **Map must always be reachable.** In flight there was no obvious way to open it.
  Make it a fixed Map button (PC sidebar, phone rail, one fixed spot on every
  screen) instead of a per-world button. → cycle 2 spec §4.5
- **Refuel anywhere.** Running low, the owner couldn't refuel at some worlds. Every
  port now sells fuel; remote ports charge more. → cycle 2 spec §4.6
- **Mission destination on the map.** Highlighting a mission and pressing the Map key
  should show where it goes, to plan the trip. → cycle 2 spec §4.4
- **Ships must differ.** Each hull has its own role: carriers haul, couriers are fast,
  liners carry passengers, and so on. No two hold sizes are the same, and a balance
  test enforces this. → cycle 2 spec §2.1 role table
- **Recommended additions:** see "EV series study" below. They go to the owner as
  questions with top picks, not decided alone.

## EV series study (2026-10-18)

Sources: the owner's screenshots of the EV folder and manual, plus general knowledge of
how the three games work. The emulator could not be driven from Claude's browser, so the
owner's own play notes remain the best source for exact numbers. Everything below is in
our own words, and nothing is copied.

**How EV is built.** The app is small. Content sits in separate data files (ships,
outfits, weapons, worlds, systems, governments, missions, descriptions), plus graphics,
sounds and music. A plug-ins folder can add or replace any of those records, which is
why the game had such a long modding life. *Starwake already keeps content in JSON;
growing that into a mod loader later is cheap if each record type keeps a stable id and
schema.*

**Manual pitch (paraphrased).** It is an open-ended sandbox: trade, fight for one side
of a civil war, or turn pirate. Several sub-plots branch on your choices, so no two
games play the same. The engine was meant to host other scenarios.

**Shops and stock.**
- Every world and every item has a tech level, and a world sells items at or below its
  level.
- A few items carry a special tech value that only certain worlds have. That is how one
  government gets gear nobody else sells. → Starwake's `techTier` plus `soldBy` plus
  hubs (spec §2.3).
- Every hull has a mass budget for outfits. Each pod, tank, gun and armor piece uses
  some of it. → `outfitSpace` (spec §2.1).
- Selling outfits and trading in ships returns much less than the purchase price, so
  upgrades are real decisions. Trade-in value is spec open question 2.
- Maps reveal systems within a few jumps of where they're bought.
- A ramscoop slowly refuels the ship in flight.
- An escape pod saves the pilot when the ship is destroyed.

**Flight and combat feel.**
- Shields recharge on their own over time. Armor is repaired only when you land.
- A ship whose armor drops low is disabled: it drifts and can't fight. You can then
  board it to take cargo or money, or try to capture it. The odds depend on how your
  crew compares to theirs.
- Escorts can be hired or captured, and they follow your simple orders.
- The right-hand sidebar keeps radar, status, nav and target in a fixed place, so the
  view itself stays clean.

**Law and factions.**
- Each government tracks your legal standing separately. A single combat rating tracks
  overall fighting skill.
- Working for one side angers its enemies. At the extreme, they shoot on sight and
  refuse landing.
- Bribes and paying off fines can fix small problems.

**Pace.** The early game is a money grind in a weak starter ship. Players remember the
first big upgrade as a milestone. It needs to come soon enough (we aim for roughly
30–45 minutes of trading) to keep people playing.

**Override (the first sequel).**
- Same engine and a new setting.
- Mostly open play with lighter story pressure.
- A larger, more varied roster.
- Players liked the freedom. Some found it aimless without a strong thread.

**Nova (the second sequel).**
- **Several storylines.** Each faction has its own long storyline. Choosing one locks
  out its rivals, so the game rewards replaying.
- **Ranks.** Ranks within a faction give a title, plus perks such as a salary,
  discounts, landing rights or access to restricted ships.
- **Recurring characters.** Named pilots in unique ships keep turning up across the
  galaxy.
- **Carriers.** Carriers launch small fighters from bays.
- **New regions.** Mission chains open new areas, and some regions are hidden until the
  story reaches them.
- **Complaints.** Long fetch-quest stretches, story steps that are easy to miss, and
  needing a guide to find the next storyline trigger.

**What to carry into Starwake (owner to choose; top picks first):**
1. **Story-unlocked ship variants and gear** (cycle 3): for example an upgraded courier
   that only becomes available after a story chain. This fits the owner's original
   "story-driven unlocks" goal. *Top pick.*
2. **Faction ranks with real perks** (cycle 5): a title, plus discounts or hub access
   at each faction's tech hub. *Top pick.*
3. **Clear story signposting** (cycle 3): the mission log always shows the next lead,
   which avoids Nova's "where do I go now" problem. *Top pick.*
4. **Escorts and carriers' fighters** (cycle 6), building on the cycle 2 carrier.
5. **Recurring named pilots** in unique ships (cycle 4+).
6. **Story-gated region** (galaxy growth): a hidden area opened by a mission chain.
7. **Ship naming** (cycle 3, shown on the pilot card).
8. **Mod / plug-in loader** (later): extra JSON data packs.
9. **Escape pod** (cycle 4, combat).

## Fun review (2026-10-20)

Goal from the owner: Starwake should be "as much fun as I had in Escape Velocity". A new
TEST pilot played the live build (since deleted). The pilot ran the guide, an exchange buy,
two jobs, a 2-jump rush delivery into unexplored space, refuel, a chart purchase and the outfitter.
This was compared with the notes above, the owner's EV checklist doc, and public write-ups of
Override and Nova. The emulator was not driven this time. Nothing here is decided: the owner picks.

### What the first session feels like now

- **Space is empty.** The pilot crossed three systems and saw no other ship. In EV, traders,
  patrols and pirates passed through every system, so every jump felt alive, even before a fight.
  This is the biggest fun gap.
- **Nothing happens between landings.** Jumps are instant, with no streak, flash or sound.
  Autopilot flies, you press J, and the screen changes. Nothing can interrupt the trip
  (a hail, a wreck, a distress call), so the only stories are the ones on the mission screen.
- **Missions out-earn trade by about 15×.** The guide's food run makes roughly 200 cr. A 4 t
  rush job paid 3,900 cr for about 3 minutes of play. The courier (30,000 cr) is about five
  rush jobs away, so the first upgrade comes in about 15 minutes. That is quick, but trading
  is pointless early on, and EV's "find a good route" loop is missing.
- **Nothing to chase.** The outfitter sells only utility items: tanks, pods, plates, a chart
  and a scoop. No ship or item is rare, hidden or teased, so nothing makes you think "one
  day I'll fly that".
- **Discovery works but is thin.** A mission to an unknown system reveals that system on
  the map, and buying a chart reveals the systems nearby. Both feel good. An unexplored
  system holds no surprise yet, though (no hidden world, odd good or wreck).
- **Good bits to build on:** the planet blurbs have charm. The mission screen's rumour
  line ("Traders say … is flooded with …") feels like EV, and a phone fits the game well.
- **Friction (small fixes):**
  - The Map key is M in flight but N when landed, where M opens the Mission Computer.
  - The guide stays linear. After I flew elsewhere, step 7 still sent me to Tessaly for food.
  - The preview of a rush job into an unvisited system says "No known route", even though
    the route appears once the job is accepted. That scares a new pilot off a deadline job.
  - Once, after the "Mission complete" OK, the next hotkey (R to refuel) did nothing.
    I may have pressed too fast, so this needs a check.
  - The main menu has no pilot card yet (already planned for cycle 3).

### What made the EV series fun (own words)

- **A living galaxy.** Ships of every government fly their own errands, so you sense
  power and danger before you understand them.
- **Rags to riches.** You start in a weak shuttle. The first upgrade is a milestone, and a
  top warship or a rare hull is a goal that takes many hours.
- **Freedom with hooks.** Trade, fight or turn pirate. Story threads begin from the bar,
  a hail or a chance meeting, and Override and Nova players praised that freedom most.
  Nova's complaints: only one storyline per playthrough, a shared stretch that every
  storyline repeats, and story steps that were hard to find.
- **Risk while travelling.** Pirates in the outer systems, police scans and wanted
  levels make a cheap cargo run tense.
- **Rare ships and gear.** Ships sold at one hidden world, ships earned only through a
  story, and ships captured by boarding. Players talk about these for years.
- **Feel.** The hyperspace streak, the landing zoom, weapon sounds and the shield flash.
  Nova was criticised for having no music, so sound clearly mattered to players.

### Ranked recommendations

Ratings: **Fun** is how much it adds (★–★★★). **Effort** is S (a few days), M (a cycle's
main feature) or L (a whole cycle). **Cycle** follows the current roadmap: cycle 3 is
bar and story, then combat, factions and law, boarding, contraband, art and sound,
and plug-ins.

| # | Recommendation | Fun | Effort | Cycle |
|---|---|---|---|---|
| 1 | **Living traffic.** Non-hostile ships of each faction fly through, land, take off and jump out. Fringe systems are quieter or rougher. The radar shows them, and you can target one to read its name and type. Combat later turns the same ships into raiders and police. | ★★★ | M | 3 (lay the base before combat) |
| 2 | **In-flight encounters.** Random events between landings: a hail with an offer, a drifting wreck with salvage, a distress beacon, a lost courier. Each is a short card with 2–3 choices. These add stories to empty trips and give the bar a second source of hooks. | ★★★ | M | 3 |
| 3 | **A story hook in the first 10 minutes, with a rare ship at the end.** The first bar thread starts early and ends by unlocking a unique hull variant. The mission log always shows the next lead, avoiding Nova's "where now?" problem. The shipyard shows the locked ship as a silhouette with a "?" teaser. | ★★★ | L | 3 (already planned; this sets its target) |
| 4 | **Juice pass, cheap version.** A hyperspace streak and flash on jumps, a landing and take-off zoom, an engine glow, and simple sounds made in code (thrust, jump, land, buy, mission paid) with a mute toggle. Real art and music come later. | ★★★ | S | Pull forward into cycle 3 |
| 5 | **Earning curve and trade balance.** Trade routes worth flying, about 1/3 to 1/2 of mission pay per minute, with rumours pointing to them. A guide trade that makes a visible profit. Milestones: first upgrade at about 20–30 minutes, a mid ship at 1–2 hours, the dream ship as a long goal. Rare goods and price spikes create "run it now" moments. | ★★ | S | 3 (balance pass + test) |
| 6 | **Danger on the road.** Raiders in fringe systems, a choice to flee, fight or pay, and cargo at stake. This is what makes a money run tense. | ★★★ | L | 4 (combat), with police in 5 |
| 7 | **Rare ships worth chasing.** 3–5 one-off hulls: one from the story, one sold at a single hidden world, one from restoring a derelict, and later ones from capture. Each needs a teaser somewhere (a rumour, the shipyard silhouette, a wreck). | ★★★ | M | 3 (one), 6 (capture) |
| 8 | **Discovery rewards.** A few unexplored systems hold something: a hidden world, a unique good, an old wreck, or a lane that charts don't show. A story-gated region comes later. | ★★ | M | 3 (small), galaxy growth (region) |
| 9 | **Recurring named pilots.** A handful of characters in their own ships turn up across the galaxy and remember you. | ★★ | M | 4+ |
| 10 | **Goals on the pilot card.** Net worth, combat rating, ship name, systems explored (n/20) and a notable-deeds list, so progress is visible. | ★ | S | 3 |
| 11 | **Friction fixes** from the playtest above: one Map key everywhere, a guide that adapts or ends early, an honest route preview for unvisited systems, and a check on the dropped hotkey after a dialog. | ★ | S | Quick fix before cycle 3 |
| 12 | **Faction ranks with perks** (from the EV study). | ★★ | M | 5 |

**Top picks:** 1, 2, 3 and 4 make up a stronger cycle 3, "a galaxy that's alive, with a
story to find". Item 11 should land first as a small fix pass, and item 5 should come with
cycle 3's balance work.

Sources (public write-ups, paraphrased): [Wikipedia: EV Override](https://en.wikipedia.org/wiki/Escape_Velocity_Override),
[Wikipedia: EV Nova](https://en.wikipedia.org/wiki/Escape_Velocity_Nova),
[MobyGames: EV Nova](https://www.mobygames.com/game/9881),
[Playable Classics: Escape Velocity](https://tleaves.com/wordpress-archive/post0378/).

## Expansion cycles (agreed 2026-10-16)

1. **Trade, mission computer, more systems** — ~20 systems in three areas
   (Concord core, Free Reach frontier, independent fringe), star map with
   exploration and route planning, in-game date (1 day per jump), cargo hold,
   per-planet services, commodity exchange with events, generic missions.
2. **Ships and outfits** — shipyard with trade-in, outfitter (tech-tier
   stock, maps), EV-style right sidebar HUD on PC.
   *Built:* ten hulls with a tech-tier shipyard and trade-in (75% of the hull plus 50% of fitted outfits),
   an outfitter that sells and refunds gear, a Map button on every landed
   screen and the phone rail, mission previews on the map, and the PC sidebar.
3. **Missions and bar** — spaceport bar, story missions that unlock ships,
   gear and areas; pilot card on the main menu.
4. **Living galaxy (fun pass, 2026-10-20)** — built from the fun review:
   NPC traffic (ships jump in, land, take off and pass through; Tab cycles ships
   then planets; click or tap to target; the target line shows name, faction,
   hull and role), in-flight encounters (radio hails answered with Y, white-diamond
   sites opened close and slow, short choice cards on 1/2/3), a Notes section in the
   Mission Log for rumours and leads, and one survey-ship thread (a rumour leads
   to a beacon in Skerry, which opens a hidden lane to Hushwater, where the derelict
   Long Patience can be claimed to unlock the one-off Patience-class Surveyor at
   Wrenhold). Also: the juice pass (engine flame, arrival flash, landing and
   take-off animation, credits count-up), synthesised sound with volume and mute
   (V), a balance pass (rush jobs pay less, wider price spreads, the guide trade is
   20 t and follows the pilot's route), N as the map key everywhere (M still works
   in flight), and the pilot card on the main menu with ship naming after a purchase.
   *Fun-review items built:* 1 (living traffic), 2 (encounters), 4 (juice and
   sound), 5 (earning curve and balance), 10 (pilot card) and 11 (friction fixes).
   *Partly built:* 3 (story hook, via the survey thread), 7 (rare ships, one hull)
   and 8 (discovery rewards, the hidden lane). Phone rule held: only the context
   button changes for hails and sites, with no banner over the view.
5. **Cycle 3 Plan A — story engine (2026-10-22)** — the engine and the shared story.
   *Built:* the spaceport bar (`openBar`, B by default) with contacts offering story and side
   jobs, local gossip and a lead line; story jobs of go, land, deliver, ferry, scan or search a
   site (Y, or the Scan/Search context button) and meet-a-named-ship steps; a Story section in
   the Mission Log (current step and destination, Show on map, Next lead, Done), where side jobs
   can be abandoned back to the giver's bar and main-story jobs cannot; main-story deadlines that
   return the job to the giver's bar the next day; faction standing (cool, neutral, friend) on
   the pilot card, locking some ships and gear behind friendship; the Dimming, a hidden region
   the story opens; and the shared story "The Lanterns Go Dark" (M1-M4, from the Halcyon bar on
   day 2, ending in a choice of Concord or Free Reach) plus two side chains, The Missing Courier
   and The Surveyor's Charts (reward: Surveyor's Folio). Test hooks for e2e: `storyOffers`,
   `story`, `storySite`, `storyMeet`, `acceptStoryNow`. *Still to come (Plan B):* both side
   arcs, six side chains and the unique hulls.
Later: combat, reputation and police, boarding, contraband, more regions.
