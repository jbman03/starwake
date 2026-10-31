# Starwake Cycle 5 — Law, Contraband and Faction Ranks (design)

Status: draft for owner review · 2026-10-30

## 1. Goal

Make each faction's law and favour matter. The law watches what you do and carry, and its
patrols scan, fine, chase or shoot you. Good work for a faction moves you up its rank ladder,
which comes with real perks. Law and ranks get balanced weight. Whatever you do, you can always
recover your record. It must play on PC and phone, keep old saves working, and never break the
live game.

## 2. Owner decisions (brainstorm)

| Question | Decision |
|---|---|
| Focus | Law and ranks, balanced. |
| Harshness | Escalating and always recoverable: Clean → Suspect → Wanted → Hunted. Fines and bribes are available, and heat fades with time. |
| Contraband | Three illegal goods and patrol scans, with a scrambler outfit. |
| Ranks | A five-step ladder per lawful faction, earned through its work. Each rank brings a title and a perk. Rival factions pull against each other. |
| Approach | A. New law, contraband and rank modules sit beside the existing standing (cool, neutral, friend), which stays as each faction's opinion of you. |

## 3. Architecture

- New pure sim modules, all seeded and fixed-step:
  - `src/sim/law.ts`: heat, legal status, crimes, fines, bribes and decay.
  - `src/sim/contraband.ts`: what is illegal where, and the scan check.
  - `src/sim/ranks.ts`: rank points, rank lookup, perks and the rival pull.
- New data with Zod schemas and stable ids, so the editor and plug-ins can use it:
  - `data/law.json`: thresholds, crime heat, fines, bribe odds, decay and scan values.
  - `data/factions.json`: per faction, its ranks (title, points, perk), its hub port and its rivals.
  - Contraband goods go in `data/commodities.json` with a new `illegalIn: string[]`. Black-market
    ports list them in their `market`. The scrambler goes in `data/outfits.json`.
  - Ships and outfits gain an optional `requiresRank: { government, rank }`, next to the
    existing `requiresStanding`.
- Combat (`battle.ts`, `ai.ts`, `combatControl.ts`) reads legal status to decide patrol hostility.
  Crimes come from the existing combat hooks (`angerOnHit` / `angerGovernment`).
- Scans and law hails use the existing hail/pending-card system (`raiders.ts` demand is the model).
  They add no new on-screen buttons.
- Save v7: `law` and `ranks` per government, migrated from v6 as Clean and rank 0.

## 4. Law

### 4.1 Heat and status

Each government keeps a heat number from 0 to 100 for the player. Status is read from the heat
with thresholds from `law.json`:

| Status | Heat | What its patrols do |
|---|---|---|
| Clean | 0–9 | Ignore you, except for contraband scans (§5). |
| Suspect | 10–29 | Hail: "pay your fine of X cr". If you refuse, heat +5. They don't attack. |
| Wanted | 30–59 | Hail: pay the fine, or they attack. A bribe may work. |
| Hunted | 60–100 | Attack on sight. Its ports refuse landing. |

Wanted or Hunted also caps your standing with that government at `cool`, and freezes rank
gains with it (§6).

### 4.2 Crimes

Heat values live in `law.json`; the government is that of the victim's ship.

| Crime | Heat (default) |
|---|---|
| Shooting one of its patrols or traders (first hit per ship) | +10 |
| Disabling one of its ships | +20 |
| Destroying or capturing one of its ships | +40 |
| Caught with contraband it outlaws | +15 |
| Running from its scan or law hail | +20 |
| Boarding one of its ships for loot | +15 |

Raiders have no law, so attacking them is never a crime. Heat is capped at 100.

### 4.3 Recovery

- **Decay:** heat falls by 2 per day (`decayPerDay`) for every government.
- **Fines:** at any port where you are not Hunted by its owner, the planet screen offers
  "Pay fines" for each government where you are Suspect or worse. The cost is
  `heat × fineRate` (default 40 cr per point). Paying sets that heat to 0. A patrol's law hail
  offers the same fine in flight.
- **Bribe:** a law hail offers a bribe costing `bribeMul × fine` (default 1.5). A scan hail's
  bribe costs `bribeMul × contrabandFine × illegal tons`, so a Clean pilot's scan bribe is never
  free. It works with probability `bribeChance` (default 0.6), drawn from the seeded RNG. If it
  works, the patrol leaves and heat is unchanged. If it fails, no credits are taken, heat +10
  (`bribeFailHeat`) and that patrol attacks.
- **Landing when Hunted:** landing at a port of a government that hunts you is refused, with the
  message "Landing refused: you are hunted by the X." A tow skips those ports and goes to the
  nearest port of any other government. An escape-pod rescue keeps the cycle 4 rule: the nearest
  port whose standing isn't cool (Wanted counts as cool), else the start planet.
- **Custody:** the pilot can always recover. When a tow or pod rescue can only reach a port of a
  government that hunts the pilot, it goes there anyway and the pilot is taken into custody on
  arrival: that government's fine is paid from the credits (as much as they cover) and its heat
  drops to just below Wanted (`thresholds.wanted − 1`). A message explains what happened.

### 4.4 Patrol behaviour

- Patrols are the existing traffic role. A patrol of government G treats the player as hostile
  when G is in the battle's `angry` set (cycle 4) or the player is Hunted by G.
- When the player is Suspect or Wanted with G, the nearest G patrol within `hailRange`
  (default 900 px) sends a law hail. Each government sends at most one law hail per system visit,
  and a contraband scan by one of its patrols (§5.2), whatever it finds, counts as that hail: no
  fine hail from G follows a scan until the next visit.
- The law hail card offers Pay fine / Bribe / Refuse (or Run).

## 5. Contraband

### 5.1 Goods

There are three new commodities with `illegalIn`:

| Id | Name | Base price | Illegal in |
|---|---|---|---|
| `stims` | Unlicensed Stims | 600 | concord, free-reach |
| `relics` | Dimming Relics | 900 | concord, unlit |
| `gunparts` | Weapon Parts | 750 | concord, independent |

- Ports whose government outlaws a good don't trade it.
- Two or three fringe ports stock them cheap (`market: low`), chosen in data.
- Lawful ports that allow them buy them at `high`.

### 5.2 Scans

- In a system whose government outlaws any good in your hold, each patrol of that government
  within `scanRange` (default 600 px) scans you once per system visit.
- The scan catches the cargo with probability `catchChance` (default 0.8), drawn from the seeded
  RNG. A scrambler multiplies it by `1 − scramblerCut` (default 0.5), so 0.8 becomes 0.4.
- If you are caught, the scan hail card offers three choices:
  - **Comply:** the illegal cargo is confiscated, you pay a fine of `contrabandFine` (default 100 cr
    per ton) and heat +15.
  - **Bribe:** §4.3 (`bribeMul × contrabandFine × illegal tons`).
  - **Run:** heat +20 and the patrol attacks.
- A clean scan just shows the message "Scan complete. Fly safe."

### 5.3 Scrambler

The scrambler is a new outfit, `scrambler` ("Scan Scrambler", 1 ton, 4,500 cr). It is sold at
fringe outfitters and can't be bought at a Concord port.

## 6. Faction ranks

### 6.1 Ladder

`factions.json` gives each lawful government (concord, free-reach, independent, unlit) five ranks
with point thresholds (defaults 10, 30, 70, 150 and 300), a title each (written per faction, e.g.
Concord: Lamplighter, Warden, Keeper, Beacon, Lanternmarshal) and a perk.

### 6.2 Earning points

| Source | Points |
|---|---|
| Completing a mission offered by that government's port | +2 |
| A combat job (bounty or clear) for it | +4 |
| A story step that changes its standing toward friend | +5 |
| Destroying a raider in its space | +1 |

No points are earned while Wanted or Hunted by that government. Perks the pilot already holds
(discount, salary, mission pay) keep working.

### 6.3 Rivals

`factions.json` lists rivals (default: concord ↔ unlit). Gaining N points with one government
removes ⌊N/2⌋ from each of its rivals, never below 0. A rival's rank can therefore fall.

### 6.4 Perks

Perks are applied by their effect type, with values in data. The default ladder:

| Rank | Perk |
|---|---|
| 1 | The title only. |
| 2 | 5% off ships and outfits at its ports. |
| 3 | A salary of 150 cr, paid once per day on landing at its ports. |
| 4 | Its hub's restricted ships and outfits unlock (`requiresRank`), and its missions pay +10%. |
| 5 | 10% off, and the salary rises to 400 cr. |

Each faction has at least one item that `requiresRank` 4 gates at its hub, chosen in data from
existing high-tier ships or outfits. Rank 4 with Concord also covers today's Concord
`requiresStanding: friend` items, so neither requirement blocks the other.

## 7. UI

Everything is built with `el()`/`button()` and `textContent`, and nothing adds on-screen buttons.

- **Sidebar:** under the nav line, "Law: Clean / Suspect / Wanted / Hunted" for the current
  system's government, coloured by status.
- **Pilot card (main menu):** the legal status per government and the rank title per faction. The
  pause menu has no pilot page, so these lines are on the main-menu pilot card only. Phones show
  no law line in flight (they have no nav line, and no buttons are added).
- **Planet screen:** a "Pay fines" row when fines are owed, and a salary notice when one is paid.
- **Shipyard and outfitter:** prices show the rank discount. Locked items say "Requires
  Concord rank 4 (Beacon)".
- **How to Play:** a law-and-ranks page.

## 8. Save v7

`PilotSave.law: Record<gov, { heat: number }>` and
`ranks: Record<gov, { points: number; salaryDay: number }>`. A v6 save migrates to empty
records (Clean, rank 0). Unknown government ids from a plug-in are kept and ignored.

## 9. Errors

- A bad `law.json` or `factions.json`, or an `illegalIn`/`requiresRank` naming an unknown
  government, fails at load with the file name, like every other data file.
- A save with corrupt law or rank values clamps heat to 0–100 and points to ≥ 0, and still loads.
- If a law hail and a raider demand would both open, the demand goes first and the law hail waits.
  Only one hail card is ever open.

## 10. Testing

- **Unit:**
  - status thresholds; each crime's heat and the cap; decay;
  - fines and bribes (seeded outcomes); landing refusal and the tow skipping hunted ports;
  - scan odds with and without a scrambler; confiscation;
  - rank points and the rival pull; perks (discount, salary once per day, mission pay,
    `requiresRank` unlock);
  - the v6→v7 migration;
  - patrol hostility when Hunted.
- **E2E:**
  - on PC, attack a patrol, become Wanted, get the law hail, pay the fine, and end Clean;
  - on phone, carry contraband into Concord space, get scanned, choose Comply, and see the cargo
    gone and the fine paid;
  - the Pay fines row on the planet screen;
  - rank-up through missions showing the new title, and the discount appearing.
- **Process:** the typecheck, Vitest and the full Playwright suite pass locally and in CI. Then I
  ask the owner before the merge and deploy.

## 11. Out of scope

Bounty hunters sent after the player, faction story chains locked by rank (Nova-style), escorts,
smuggling missions, and police boarding. These are for later cycles.
