# Starwake: Cycle 4 — Combat and Boarding

**Date:** 2026-10-25
**Status:** Design approved in brainstorming by the owner (2026-10-25); this written spec awaits the owner's review
**Builds on:** living galaxy (`2026-10-20-starwake-living-galaxy-design.md`) and the story cycle
(`2026-10-22-starwake-story-design.md`), both shipped
**Context:** `docs/design-notes.md` — the owner's favourite EV parts are flying, missions, battle
and boarding; fun review item 6 ("danger on the road")

## 1. Purpose

Space is alive but harmless. This cycle adds danger and the owner's favourite feature:
- raiders, traders and patrols that fight, flee and hunt;
- weapons that feel different from each other;
- EV-style damage: shields, then armor, then disabled, then destroyed;
- boarding a disabled ship to loot it or capture it;
- an escape pod, and a fair game-over;
- bounty and clear-the-lanes missions;
- a small standing penalty for shooting the wrong ships.

Design rules still hold:
- All names, text and art are original.
- On phones nothing covers the game view. Only the bottom-centre context button changes.
  The player opens screens and cards themselves.
- Every new action has a rebindable hotkey on PC.
- The sim stays pure and seeded at a fixed 60 Hz step. Rendering goes in `src/render`. Overlay UI
  goes in `src/ui` and uses textContent only. Data lives in Zod-validated `data/*.json`.

## 2. Owner decisions (brainstorming, 2026-10-25)

| Topic | Decision |
|---|---|
| Danger | Safe core, wild edges. Raiders are rare in Concord core space, common at the fringe and in the Dimming. The starter shuttle carries one light gun. |
| Death | An escape pod (a cheap outfit, used up) saves the pilot; without one the game reloads the last landing save. |
| Capture | The pilot chooses: take command (the old ship is credited at trade-in) or sell her as a prize (about 30% of the hull price). Keeping her as an escort comes with the escorts cycle. |
| Aiming | Light gun assist on PC and phone: guns bend a few degrees toward a nearly-lined-up target, turrets aim themselves, missiles home. |
| Weapons | The full set, beams included (§4). |
| Phone controls | No new buttons. Holding TGT targets the nearest hostile, tapping the label under MSL cycles the secondary, and Board uses the context button. |
| Raiders | About half hail first with a demand (pay or refuse); the rest attack on sight. Hurt raiders flee. |

## 3. Architecture

This is approach A from brainstorming: combat is built beside traffic. Traffic is not moved into
the saved world.

- **`src/sim/combat.ts`** (new, pure) holds:
  - hull state: `{ shields, armor, maxShields, maxArmor, disabled, lastHitSec }`;
  - firing: cooldowns, the gun aim assist and turret aim;
  - projectiles (bolts, rockets, homing missiles) and beams;
  - hit tests, and damage that goes to shields first, then armor;
  - shield recharge and the disable and destroy thresholds.
- **`src/sim/ai.ts`** (new, pure) turns one NPC's situation into a `FlightInput` plus fire
  intents, with one behaviour per role (§5).
- **`src/sim/battle.ts`** (new, pure) runs one fight tick. `stepBattle(battle, world, traffic, input,
  data, dt)` runs the player's and the NPCs' weapons, moves projectiles, applies damage, and
  returns new state plus events. Its events are `shot`, `hit`, `disabled`, `destroyed`,
  `playerDisabled`, `playerDestroyed`, `standingDrop` and `fled`.
  - The `Battle` state holds the player's hull, the projectiles and beams, the player's
    selected secondary, and which governments are angry this visit.
  - It is transient like `Traffic`: not saved, and rebuilt on arrival or load. Landing repairs
    the ship, and saves happen only when landed.
- **`src/sim/boarding.ts`** (new, pure) works out what is aboard (credits, cargo, ammo, rolled
  from the seed and the NPC id), the capture odds, and the outcome of each boarding choice.
- **`src/sim/traffic.ts`** changes:
  - each `Npc` gains a `role` (`trader`, `patrol` or `raider`), a `hull` (combat state), a
    `loadout` and a `hostile` flag;
  - spawning picks a role from the system class (§5);
  - disabled ships drift and are never despawned by their errand. Destroyed ships are removed
    after the explosion.
- **The controller** holds `battle` next to `traffic`. It calls `stepBattle` after `stepWorld`
  each tick and routes the events to sound, messages, the context button, the boarding card
  and the death flow.
- **Rendering** (`SpaceScene`) adds:
  - bolts, missiles with a short trail, and beams;
  - a shield-hit ring flash and an explosion burst;
  - sparks on disabled ships;
  - hull bars on the targeted ship.

  Low-quality mode cuts the particle counts. Every new object is registered with
  `addWorldObject` so the sidebar camera skips it.
- **Sound** (`src/audio/sfx.ts`) adds new synthesised sounds: `shot`, `missile`, `beam` (a loop
  while it fires), `shieldHit`, `armorHit`, `explosion`, `disabled` and `alarm` (the player's
  armor is low).

## 4. Weapons and outfits

New outfit categories in `OutfitSchema`:

| Category | Effect fields |
|---|---|
| `gun` | damage, rate, speed, range, spread, assist |
| `turret` | the same as a gun, plus `arc` (360) |
| `launcher` | `ammo` (an outfit id), rate, homing |
| `ammo` | damage, speed, range, `turnRate` (homing); space 0; `max` per launcher |
| `beam` | damage per second, range |
| `pod` | (the escape pod) |

Each weapon outfit is a Zod discriminated-union member with `.strict()` effects, like the
existing ones. `shipStats` ignores weapon effects. A new `weaponsOf(outfits, data)` lists them.

Starting roster (numbers are first guesses; the plan's balance test pins the final ones):

| Id | Name | Kind | Tier | Price | Space | Feel |
|---|---|---|---|---|---|---|
| `light-blaster` | Spark Blaster | gun | 1 | 2,500 | 3 | 6 dmg, 4/s, quick bolts; the starter gun |
| `rapid-cannon` | Chatter Cannon | gun | 2 | 7,000 | 5 | 4 dmg, 10/s, ±3° spread; shreds shields |
| `heavy-blaster` | Maul Blaster | gun | 3 | 14,000 | 8 | 22 dmg, 1.5/s, slow heavy bolts |
| `pivot-turret` | Pivot Turret | turret | 3 | 20,000 | 10 | 8 dmg, 3/s, aims itself in any direction |
| `rocket-rack` | Rocket Rack | launcher | 2 | 6,000 | 6 | fires `rocket` ammo |
| `rocket` | Rocket | ammo | 2 | 50 | 0 | 40 dmg, unguided, up to 20 per rack |
| `seeker-launcher` | Seeker Tube | launcher | 3 | 15,000 | 8 | fires `seeker` ammo |
| `seeker` | Seeker Missile | ammo | 3 | 150 | 0 | 60 dmg, homes on the target, up to 12 per tube |
| `lance-beam` | Lance Beam | beam | 5 (hubs only) | 45,000 | 14 | 30 dmg/s, hits instantly, short range |
| `escape-pod` | Escape Pod | pod | 1 | 2,000 | 1 | saves the pilot once (max 1) |

- **Primary and secondary weapons.**
  - Primary fire shoots every gun, turret and beam fitted.
  - Secondary fire shoots the selected launcher, which spends one ammo per shot.
  - Cycle secondary steps through the launchers you own, skipping any that have no ammo.
- **Aim assist.** A gun's bolt leaves on the ship's heading. If the target sits within the
  gun's `assist` cone (default 6°), the bolt bends toward the target's lead point instead.
- **Turrets** aim at the target, or with no target at the nearest hostile in range.
- **Ammo** is stored as outfit counts (it is already saved). The outfitter sells and refunds it
  like other outfits, capped at `max × launchers`.
- **NPC loadouts.** `ships.json` gains `crew` (an integer, required) and an optional `loadout`
  (outfit id → count) used only for NPCs. A hull without a loadout gets a light blaster per
  2 crew, up to 2.
- **The starter gun.** New pilots start with one Spark Blaster fitted (`config.startOutfits`).
  The v5 → v6 save migration gives one to any pilot flying the shuttle without a gun.

## 5. Ships in space and their AI

- **Roles by system class.** Each NPC spawn rolls a role. Chance of a raider:
  - Concord core: 5%;
  - Free Reach: 20%;
  - independent: 30%;
  - fringe (tier-1 only) and the Dimming: 40%.

  Patrols make up 15% of spawns in Concord and Free Reach space and fly their government's
  colours. Everything else is a trader, which is today's traffic.
- **Safe moments.**
  - No raiders spawn in the start system.
  - No raiders spawn while the First Flight guide runs.
- **Raiders** fly under a new government, `raiders` ("Rimward Raiders", a red tint). No standing
  is tracked with them.
  - Their hull pool is shuttle, courier, scout, kestrel and, rarely, warden.
  - About 50% of them open with a demand hail (§6). The rest hunt the player and traders
    on sight.
  - A raider flees to the nearest jump point at 30% armor and leaves the system.
- **Patrols** (kestrel or warden in their government's colours) attack raiders in range. They
  attack the player only once their government is angry this visit (§9).
- **Traders** keep their errand. Once hit, they flee to the nearest jump point or port. Any
  ship that is fired on fires back if it has weapons and the shooter is in range.
- **AI movement** reuses `flight.ts` and the autopilot steering. Attackers face a lead point and
  fire when lined up. They hold a preferred range, and orbit a little so fights aren't
  head-on rams.
- **Caps.** The existing 8-NPC cap (4 in low quality) still holds. At most 3 hostile raiders at
  once.

## 6. Raider demands

This reuses the hail flow (Y, or the context button "Answer hail").
- The hail reads "*Name* (raider): Dump {n} t of cargo or pay {c} cr, and fly on."
- The card offers:
  - **Pay {c} cr.** The price is the larger of 300 or 5% of credits, rounded to 10.
  - **Dump cargo.** Only when the hold has goods; it drops the {n} t worth most.
  - **Refuse.**
- Paying or dumping makes the raider peaceful, and it leaves the system.
- Refusing makes it attack at once. So does ignoring the hail for 15 s.
- If another hail is already pending, the raider attacks without a demand.

## 7. Damage, disabling and destruction

- **Damage** goes to shields first. Only the overflow reaches armor.
- **Shield recharge.** Shields recharge at 5% of max per second, starting 2 s after the last
  hit. A disabled ship's shields don't recharge.
- **Disabled.** A ship below 10% armor is disabled:
  - it can't thrust, turn or fire;
  - it keeps drifting and slows to a stop over about 8 s;
  - it shows sparks.
- **Destroyed.** A disabled ship that takes more armor damage is destroyed when its armor reaches 0.
  An explosion follows, and the ship is removed.
- **Kills.** The player is credited with a kill when the player's shot disables or destroys a
  ship. Disabling and then destroying the same ship counts once.
- **The player's hull.**
  - The player's shields and armor come from `shipStats`.
  - Landing (or loading) fully repairs both.
  - Jumping out keeps the damage.
  - A low-armor alarm sounds at 25%.

## 8. Boarding and capture

- **When.** The context button and the `board` action (default B) offer **Board** when the
  pilot targets or is near a disabled ship within 60 px, moving below 40 speed relative to it.
- **The card.** Boarding pauses the sim and opens a boarding card in the encounter-card style,
  with hotkeys 1–5 (encounter choices 1–3 plus two new ones). It lists:
  - **Take credits.** A rolled amount, roughly 2–8% of the hull price.
  - **Take cargo.** Goods aboard, up to the free hold space.
  - **Take ammo.** Only ammo your launchers can use, up to their capacity.
  - **Attempt capture (NN%).**
    - The odds are `clamp(0.05, 0.85, 0.5 × yourCrew / theirCrew)`, rounded and shown.
    - The pilot gets one attempt per ship. A failure ends boarding: "The crew drives your
      party off". The ship scuttles and is destroyed 3 s later, at a safe distance.
  - **Leave.**

  Each take can be used once. The card stays open until Capture or Leave.
- **After a capture,** a second card offers:
  - **Take command.**
    - The pilot moves to the captured hull, patched to 25% armor and empty shields until
      the next landing.
    - The old ship is credited at its trade-in value (75% hull plus 50% outfits, the shipyard's
      rule).
    - The captured ship keeps its own loadout as outfits, and the pilot's cargo moves over.
    - This is disabled, with the reason shown, when the new hold or berths can't fit the
      current jobs' cargo and passengers. It is also disabled when her outfits exceed her
      space, which can't happen with valid data.
    - `shipName` resets to the captured ship's name.
  - **Sell as prize.** Pays 30% of the hull price, and the ship is towed away (removed).
- **Captures** add to `stats.captures`. Capturing a patrol or trader also angers its
  government (§9).

## 9. Standing from combat (minimal)

- **Firing on a trader or patrol.** When the pilot first damages a government's (non-raider)
  trader or patrol during a system visit:
  - standing with that government drops one level (friend → neutral → cool), at most once per
    government per visit;
  - that government's ships in the system turn hostile to the pilot for the rest of the visit;
  - a message reads "The Concord will remember that."
- **Destroying or capturing a patrol** sets standing to cool.
- **Raiders.** Killing raiders changes no standing. Rewards for that come with cycle 5's law
  system.
- **Locks.** Standing drops reuse the existing locks: cool standing already blocks some ships
  and gear. No police scans, fines or bribes come in this cycle.

## 10. Player disabled or destroyed

- **Disabled.** The ship can't thrust or fire, and hostiles keep shooting.
  - With no hostile within 1,500 px for 5 s, the context button offers **Call a tow** (the
    existing tow: the fee is charged and the ship is towed to the nearest port).
- **Destroyed.** An explosion, a 2 s pause, then a "Ship destroyed" card.
  - **With an escape pod.** The pod is used up. The pilot wakes at the nearest port whose
    government's standing isn't cool (the start planet if there is none).
    - The pilot is in a shuttle with one Spark Blaster.
    - The pilot keeps credits, flags, story, standing, notes and stats.
    - Cargo and other outfits are lost.
    - Job missions carrying cargo or passengers fail. A story mission whose current step
      carries cargo or passengers goes back to its giver, the same as a late `onLate: 'retry'`
      mission.
    - The game autosaves at that port.
  - **Without a pod.** The card says "Your ship is lost." Its button reloads the last autosave,
    or goes to the main menu if there is none.

## 11. Combat missions

`missionTypes.json` gains two types. The `MissionTypeSchema` gains an optional
`combat: { kind: 'bounty' | 'clear', count?: [min, max] }`. `Mission` gains an optional
`combat: { kind, systemId, shipId?, targetName?, needed, done }`.

- **Bounty.** "Bounty: *Name*, wanted in {system}."
  - On arrival in the target system, a named raider spawns, using the story meet-ship pinning,
    and fights.
  - Disabling or destroying her marks the job done.
  - Return to the origin port to collect.
  - The job has a deadline, and the pay scales with the raider's hull.
- **Clear the lanes.** "Clear {count} raiders from {system}."
  - While the job is active, raiders spawn in that system at 60%.
  - Each raider the pilot disables or destroys there counts.
  - Return to the origin port to collect.
- Both are offered only at ports in Concord and Free Reach space, and only when the pilot owns
  a weapon. The mission log and the map show the target system as the destination until the
  job is done, then the origin port.
- Pay is in the rush range for a bounty and above shipment for a clear job. The plan's balance
  test checks it.

## 12. Controls

| Action | Default | Phone |
|---|---|---|
| `firePrimary` | Space | FIRE (hold) |
| `fireSecondary` | Shift | MSL (hold) |
| `cycleSecondary` (new) | Q | Tap the weapon label under MSL |
| `nearestHostile` | R | Hold TGT for 0.5 s |
| `board` (new) | B | The context button "Board" |
| `encounterChoice4`, `encounterChoice5` (new) | 4, 5 | Tap the card |

- All are rebindable in the existing hotkey editor.
- Saved custom bindings gain the new actions' defaults.
- `howToPlay` drops these from `COMING_SOON` and lists them.
- **Context button priority:**
  1. Board;
  2. Call a tow;
  3. Answer hail;
  4. Scan or Search;
  5. Land.
- **Display.**
  - The PC sidebar shows the player's shield and armor bars, the selected secondary with its
    ammo, and the target's shield and armor bars.
  - The phone rail HUD shows the player's bars, and the MSL label shows the ammo count.
  - No damage numbers float over the view.

## 13. Saves (v6)

- Adds `stats.kills` and `stats.captures`.
- Adds an optional `combat` on missions.
- The migration from v5:
  - fills kills 0 and captures 0;
  - gives the starter gun to a shuttle pilot with no weapon (§4).
- Older saves (v1–v5) keep loading through the migration chain.
- **The pilot card** shows a combat rating from `kills + 2 × captures`:
  - Harmless (0);
  - Green (1);
  - Steady (10);
  - Veteran (30);
  - Ace (75);
  - Legend (150).

## 14. Testing

- **Unit (Vitest):**
  - damage order, recharge delay, the disable and destroy thresholds;
  - the aim assist cone, turret aim, missile homing and ammo use;
  - cycling the secondary;
  - AI choices per role (attack, flee at 30%, patrol only when angry);
  - role spawn rates per system class, and the safe moments;
  - raider demand outcomes;
  - the boarding loot roll, capture odds, take command (trade-in, cargo, the fit check) and
    the prize;
  - standing drops, at most once per government per visit;
  - escape pod versus reload;
  - both combat mission types, end to end;
  - the v5 → v6 migration, and v1 → v6;
  - data validation for the new outfits and `crew`;
  - a balance test for weapon tiers and mission pay;
  - battle determinism: the same seed and inputs give the same result.
- **E2E (Playwright):**
  - desktop: target the nearest hostile (R), fire until it is disabled, board, take cargo and
    capture;
  - phone 844×390: FIRE and MSL work, hold TGT, the Board context button, and nothing new
    inside the clear view;
  - death with and without a pod;
  - a raider demand paid;
  - a bounty mission;
  - rebinding fire;
  - existing suites stay green.

  Test hooks: `spawnHostile`, `disableTarget`, `combatState`.

## 15. Delivery

- **Branch.** The work goes on the feature branch `claude/ecstatic-dirac-d2obvh`. The session
  requires this branch; it stands in for `cycle-4-combat`.
- **Process.** Subagent-driven development, with a review after each task and a final review
  of the whole branch.
- **Checks.** The typecheck, Vitest and Playwright must pass before anything is called done.
- **Merge.** Nothing merges to `main` (which deploys to GitHub Pages) without the owner's OK.
  The owner is asked to test on an iPhone in Chrome first.

## 16. Out of scope (later cycles)

- Police scans, fines, bribes, legal status, and patrols that react to cool standing
  (cycle 5).
- Escorts, keeping a captured ship as an escort, and carriers launching fighters.
- Story `combatLater` fights. They stay as notes, to be wired up once combat has settled in.
- Real art and sound, and gamepad support.
