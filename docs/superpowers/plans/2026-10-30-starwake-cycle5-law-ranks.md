# Cycle 5 — Law, Contraband and Faction Ranks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a per-government legal record (heat → Clean/Suspect/Wanted/Hunted) with patrol hails, fines, bribes and landing refusal; three contraband goods with patrol scans and a scrambler; and a five-rank ladder per lawful faction with perks and rivals.

**Architecture:** Three new pure sim modules: `law.ts`, `contraband.ts` and `ranks.ts`. All their tunables live in the new `data/law.json` and `data/factions.json`, plus additions to `commodities.json`, `outfits.json`, `ships.json` and `planets.json`. Combat feeds crimes in through its existing anger hooks. Scans and law hails reuse the controller's pending-hail card, with a raider demand taking priority. The save moves to v7.

**Tech Stack:** TypeScript, Phaser 4, Zod, Vitest, Playwright.

**Spec:** docs/superpowers/specs/2026-10-30-starwake-cycle5-law-ranks-design.md

## Global Constraints

- The sim stays pure, seeded (mulberry32/hashString) and fixed-step at 60 Hz. No `Math.random` or `Date` in `src/sim`. Bribe and scan outcomes come from the seeded RNG.
- Every tunable lives in `data/*.json` with a Zod schema and stable ids (cycle 4 Ruling 5). Unknown government ids in data fail at load with the file name.
- Heat is 0–100 per government. Status thresholds default to Suspect 10, Wanted 30, Hunted 60. Recovery is always possible: decay, fines or bribes.
- Raiders have no law and no ranks.
- Old saves load. v6 → v7 migrates to empty `law` and `ranks` (Clean, rank 0). Corrupt values clamp: heat to 0–100, points to ≥ 0.
- Phones: no new on-screen buttons. Hails use the existing card and context button.
- UI is built with `el()`/`button()` and `textContent` only.
- Only one hail card is open at a time. A raider demand goes before a law hail or scan.
- Before claiming done: `npm run typecheck && npx vitest run` and the full Playwright suite pass. Never merge or deploy; the controller asks the owner.
- Commits end with the two trailer lines given in the dispatch. No model names anywhere in the repo.

## Review Focus

1. **Hunted by every government near the ship:** a tow (or a disabled ship) must still find somewhere to go, or say clearly that none exists, without soft-locking. → Task 3: `tow when hunted everywhere nearby picks the nearest non-hunting port, or returns null with a message`.
2. **A law hail or scan while a raider demand or story hail is open:** the second waits, and both resolve in turn. → Task 6: `a scan queued behind a demand opens after it resolves`.
3. **Contraband bought legally, then flown into a system that outlaws it:** the scan triggers there, and the illegal port refuses to buy it, with a clear message. → Task 6: `outlawed port lists the good as not traded and refuses a sale`.
4. **A rank perk discount combined with trade-in and the cycle 4 capture credit:** prices never go negative or below the trade-in floor. → Task 4: `discount applies to the purchase price before trade-in and never yields a negative cost`.
5. **Paying a fine with too few credits:** the fine is refused with a message, nothing is partly paid, and in a hail the card stays open with its other choices. → Task 3 (`payFines` refuses when short) and Task 6 (`hail Pay with too few credits keeps the card open`).

---

### Task 1: Law, faction and contraband data

**Files:**
- Create: `data/law.json`, `data/factions.json`
- Modify: `data/commodities.json` (add three goods), `data/planets.json` (black-market `market` entries), `data/outfits.json` (scrambler), `data/ships.json` and `data/outfits.json` (`requiresRank` on at least one item per faction)
- Modify: `src/data/schemas.ts`, `src/data/load.ts`, `src/data/testData.ts`, `src/data/load.test.ts`

**Interfaces:**
- Produces:
  - `GameData.law`:
    ```ts
    {
      thresholds: { suspect: 10; wanted: 30; hunted: 60 };
      crimes: { hit: 10; disable: 20; destroy: 40; contraband: 15; run: 20; board: 15 };
      refuseHeat: 5; decayPerDay: 2; fineRate: 40; bribeMul: 1.5; bribeChance: 0.6;
      bribeFailHeat: 10; hailRange: 900; scanRange: 600; catchChance: 0.8;
      scramblerCut: 0.5; contrabandFine: 100;
    }
    ```
  - `GameData.factions: Record<GovId, { ranks: { title: string; points: number; perk: Perk }[]; hub: string /* planet id */; rivals: string[] }>`, covering concord, free-reach, independent and unlit. Each has exactly 5 ranks, at default points 10, 30, 70, 150 and 300.
  - `Perk = { kind: 'title' } | { kind: 'discount'; pct: number } | { kind: 'salary'; cr: number } | { kind: 'unlock'; missionPayPct: number } | { kind: 'discountSalary'; pct: number; cr: number }`, with default values per spec §6.4: rank 2 = 5%, rank 3 = 150 cr, rank 4 = unlock and +10% mission pay, rank 5 = 10% and 400 cr.
  - Rivals: concord ↔ unlit.
  - `CommodityDef.illegalIn?: string[]`. New goods: `stims` (Unlicensed Stims, 600, illegal in [concord, free-reach]), `relics` (Dimming Relics, 900, [concord, unlit]), `gunparts` (Weapon Parts, 750, [concord, independent]).
  - Black markets: 2–3 fringe ports stock the goods at `low`. Lawful ports that allow a good list it at `high`.
  - `OutfitDef` `scrambler`: "Scan Scrambler", 1 t mass/space, 4500 cr. It isn't sold at any Concord port.
  - `requiresRank?: { government: string; rank: 1|2|3|4|5 }` on `ShipDef` and `OutfitDef`.
  - Rank titles: Concord uses Lamplighter, Warden, Keeper, Beacon, Lanternmarshal. Write in-world titles for the other three factions.

- [ ] **Step 1: Failing tests in `load.test.ts`:**
  - the shipped law and factions data parse;
  - a faction with 4 ranks is rejected, with `factions.json` named in the error;
  - non-increasing rank points are rejected;
  - an `illegalIn`, rival or `requiresRank` naming an unknown government is rejected;
  - a `hub` naming an unknown planet is rejected;
  - a planet whose own government outlaws a good in its `market` is rejected;
  - every lawful faction has at least one `requiresRank` item at rank 4.
- [ ] **Step 2: Run** `npx vitest run src/data`. Expect FAIL.
- [ ] **Step 3: Implement** the schemas, data and cross-checks, mirroring how `combat.json` is loaded and checked in `load.ts`.
- [ ] **Step 4: Run** `npm run typecheck && npx vitest run`. Expect PASS. Existing economy tests must still pass, since no existing price changes.
- [ ] **Step 5: Commit** `feat(data): law, factions and contraband data`.

---

### Task 2: Save v7 and world state

**Files:**
- Modify: `src/save/pilot.ts` (+ test), `src/sim/types.ts`, `src/sim/world.ts` (`newWorld` defaults), and the save↔world mapping (grep for `standing:` in save code and the controller)

**Interfaces:**
- Produces:
  - `WorldState.law: Record<string, { heat: number }>` and `WorldState.ranks: Record<string, { points: number; salaryDay: number }>`. Both default to `{}`.
  - The same fields in `PilotSave`. `CURRENT_SAVE_VERSION = 7`.
  - Migration `6: (s) => ({ ...s, version: 7, law: {}, ranks: {} })`.

- [ ] **Step 1: Failing tests:**
  - `a v6 save migrates to v7 with empty law and ranks`;
  - `a v1 save still migrates all the way`;
  - `corrupt heat clamps to 0–100 and negative points to 0 on load`;
  - `law and ranks round-trip`.
- [ ] **Step 2: Run** the tests. Expect FAIL.
- [ ] **Step 3: Implement** the fields, defaults and migration.
- [ ] **Step 4: Run** `npm run typecheck && npx vitest run`. Expect PASS.
- [ ] **Step 5: Commit** `feat(save): v7 law and rank records`.

---

### Task 3: Law rules

**Files:**
- Create: `src/sim/law.ts`, `src/sim/law.test.ts`
- Modify: `src/sim/world.ts` (`advanceDays` applies decay), `src/sim/rules.ts` (`canLand` refusal, `towDestination` skip), `src/sim/standing.ts` (cap)

**Interfaces:**
- Consumes: `GameData.law` (Task 1), `WorldState.law` (Task 2).
- Produces:
  ```ts
  export type LegalStatus = 'clean' | 'suspect' | 'wanted' | 'hunted';
  export type Crime = 'hit' | 'disable' | 'destroy' | 'contraband' | 'run' | 'board';
  export function heatOf(world: WorldState, gov: string): number;
  export function legalStatus(world: WorldState, data: GameData, gov: string): LegalStatus;
  export function addHeat(world: WorldState, data: GameData, gov: string, amount: number): WorldState; // clamps 0–100; no-op for 'raiders'
  export function commitCrime(world: WorldState, data: GameData, gov: string, crime: Crime): WorldState;
  export function decayHeat(world: WorldState, data: GameData, days: number): WorldState;
  export function fineFor(world: WorldState, data: GameData, gov: string): number; // heat × fineRate, rounded
  export function payFines(world: WorldState, data: GameData, gov: string): { world: WorldState } | { error: 'short' | 'none' };
  export function bribeCost(world: WorldState, data: GameData, gov: string): number;
  export function tryBribe(world: WorldState, data: GameData, gov: string, seed: string): { world: WorldState; ok: boolean } | { error: 'short' };
  export function landingRefused(world: WorldState, data: GameData, planetId: string): boolean; // owner's status is 'hunted'
  ```
  - `standingOf` returns at most `cool` while Wanted or Hunted.
  - `canLand` is false when `landingRefused`. The controller shows the message `Landing refused: you are hunted by the {gov short name}.`
  - `towDestination` skips refused ports.

- [ ] **Step 1: Failing tests:**
  - status at heat 9, 10, 29, 30, 59, 60 and 100;
  - each crime adds its data heat, capped at 100;
  - `raiders` heat stays 0;
  - one day of decay takes 2 heat off every government, never below 0;
  - `payFines` charges heat × 40, zeroes heat, refuses when short with no change, and refuses with `none` when Clean;
  - the bribe costs 1.5× the fine, and its outcome is fixed by the seed. Check several seeds against `bribeChance`: on success heat is unchanged; on failure heat +10;
  - a Hunted port refuses landing, and other ports don't;
  - `tow when hunted everywhere nearby picks the nearest non-hunting port, or returns null with a message`;
  - standing is capped at `cool` while Wanted.
- [ ] **Step 2: Run** them. Expect FAIL.
- [ ] **Step 3: Implement** them.
- [ ] **Step 4: Run** `npm run typecheck && npx vitest run`. Expect PASS, with existing landing and tow tests unchanged.
- [ ] **Step 5: Commit** `feat(sim): law heat, fines, bribes and landing refusal`.

---

### Task 4: Ranks and perks

**Files:**
- Create: `src/sim/ranks.ts`, `src/sim/ranks.test.ts`
- Modify:
  - `src/sim/missions.ts`: `completeAt` awards points and applies the pay bonus.
  - `src/sim/combatMissions.ts`: combat jobs award points.
  - `src/sim/storyMissions.ts`, or wherever story standing effects apply: +5 when standing moves toward friend.
  - `src/sim/shipyard.ts` and `src/sim/outfitter.ts`: the discount and the `requiresRank` gate.
  - `src/app/controller.ts`: the salary on landing.

**Interfaces:**
- Consumes: `GameData.factions`, `WorldState.ranks`, `legalStatus` (Task 3).
- Produces:
  ```ts
  export function rankOf(world: WorldState, data: GameData, gov: string): 0 | 1 | 2 | 3 | 4 | 5;
  export function rankTitle(world: WorldState, data: GameData, gov: string): string | null;
  export function addPoints(world: WorldState, data: GameData, gov: string, n: number): WorldState; // no-op while Wanted/Hunted or for non-factions; rivals lose ⌊n/2⌋, floored at 0
  export function discountPct(world: WorldState, data: GameData, portId: string): number; // from the port owner's best discount perk at or below the current rank
  export function missionPayPct(world: WorldState, data: GameData, gov: string): number;
  export function paySalary(world: WorldState, data: GameData, portId: string): { world: WorldState; paid: number }; // once per world.day per government
  export function rankMet(world: WorldState, data: GameData, req: { government: string; rank: number } | undefined): boolean;
  ```
  - New block reason `'rank'` in the shipyard and outfitter, with the text `Requires {Gov} rank {n} ({Title})`.
  - Point values in `law.json` → `rankPoints: { mission: 2, combatJob: 4, story: 5, raiderKill: 1 }`. Add them to the schema here.

- [ ] **Step 1: Failing tests:**
  - ranks at points 9, 10, 30, 70, 150 and 300;
  - 10 Concord points take 5 from the Unlit, floored at 0;
  - no points while Wanted;
  - completing a Concord mission gives +2 and applies +10% pay at rank 4;
  - a combat job gives +4;
  - a story friend step gives +5;
  - the discount is 0/0/5/5/5/10% at ranks 0–5, applied only at that faction's ports;
  - `discount applies to the purchase price before trade-in and never yields a negative cost`;
  - the salary is 150 at rank 3 and 400 at rank 5, paid once per day per faction;
  - a `requiresRank` 4 item is blocked with the exact text below rank 4 and offered at rank 4;
  - a Concord `requiresStanding: friend` item is also offered at Concord rank 4.
- [ ] **Step 2: Run** them. Expect FAIL.
- [ ] **Step 3: Implement** it.
- [ ] **Step 4: Run** `npm run typecheck && npx vitest run`. Expect PASS. Existing pay and price tests are unchanged at rank 0.
- [ ] **Step 5: Commit** `feat(sim): faction ranks, perks and rivals`.

---

### Task 5: Combat crimes and patrol hostility

**Files:**
- Modify: `src/sim/battle.ts` (`angerOnHit` / `angerGovernment` and the disable, destroy and capture paths), `src/sim/boarding.ts` (board crime), `src/sim/ai.ts` or `src/app/combatControl.ts` (hostility), plus tests

**Interfaces:**
- Consumes: `commitCrime`, `legalStatus` (Task 3) and `addPoints` (Task 4).
- Produces:
  - Crime mapping for a non-raider victim of government G:
    - the first player hit on a ship → `hit`;
    - disabling it → `disable`;
    - destroying or capturing it → `destroy`;
    - boarding it for loot → `board`.
  - A raider destroyed by the player in a faction's space → `addPoints(gov, rankPoints.raiderKill)`.
  - A patrol of G is hostile to the player when G is in `battle.angry` or `legalStatus(G) === 'hunted'`.

- [ ] **Step 1: Failing tests:**
  - shooting a Concord trader once gives +10 heat, and hitting the same ship again adds nothing;
  - disabling gives +20, and destroying +40;
  - boarding gives +15;
  - attacking raiders adds no heat;
  - killing a raider in Concord space gives +1 Concord point;
  - a Concord patrol attacks a Hunted player who has not fired;
  - a Concord patrol ignores a Clean player.
  - The cycle 4 combat tests still pass unchanged.
- [ ] **Step 2: Run** them. Expect FAIL.
- [ ] **Step 3: Implement** it, keeping the cycle 4 standing behaviour as is.
- [ ] **Step 4: Run** `npm run typecheck && npx vitest run`. Expect PASS.
- [ ] **Step 5: Commit** `feat(combat): crimes raise heat; hunted pilots are attacked`.

---

### Task 6: Contraband, scans and law hails

**Files:**
- Create: `src/sim/contraband.ts`, `src/sim/contraband.test.ts`, `src/ui/lawCard.ts` (the hail card, following the demand card's pattern)
- Modify: `src/sim/economy.ts` and the trade code (outlawed goods aren't traded at outlawing ports), `src/app/controller.ts` (pending kinds `scan` and `law`, ordered after `demand`; context and keys), `src/sim/context.ts` (answer hail), plus tests

**Interfaces:**
- Consumes: `GameData.law`, `commitCrime`, `fineFor`, `payFines`, `tryBribe`, `bribeCost` (Task 3).
- Produces:
  ```ts
  export function illegalHeld(world: WorldState, data: GameData, gov: string): Record<string, number>; // commodity → tons outlawed by gov
  export function scanCatches(world: WorldState, data: GameData, gov: string, seed: string): boolean; // catchChance, minus scramblerCut if a scrambler is fitted
  export function confiscate(world: WorldState, data: GameData, gov: string): { world: WorldState; tons: number; fine: number }; // removes illegal cargo, charges contrabandFine × tons (as much as can be paid; the shortfall becomes heat at fineRate), +contraband heat
  ```
  - The controller adds the pending variant `{ kind: 'law'; npcId; gov; reason: 'scan' | 'fine'; expiresSec }`.
  - Card choices:
    - scan: Comply / Bribe / Run;
    - fine: Pay fine / Bribe / Refuse. Refuse is Run when Wanted.
  - Keys are the encounter choices 1/2/3. On phones the context button opens the card ("Answer hail"), as it does for demands.
  - Triggers, once per patrol per system visit:
    - a scan: a G patrol within `scanRange`, and the hold has goods G outlaws;
    - a fine: a G patrol within `hailRange`, and the status with G is Suspect or Wanted.
  - A clean scan shows only the message "Scan complete. Fly safe." A refused Suspect fine adds +5 heat and the patrol stays peaceful. Running adds `run` heat and puts G in `battle.angry`.

- [ ] **Step 1: Failing tests:**
  - the catch rate across seeds is about 0.8 without a scrambler and about 0.4 with one;
  - confiscation removes only the outlawed goods and charges 100 cr/t;
  - Comply leaves the cargo gone, the fine paid and heat +15;
  - Run gives heat +20 and makes the patrol hostile;
  - a successful bribe leaves the patrol gone and heat unchanged;
  - `a scan queued behind a demand opens after it resolves`;
  - `hail Pay with too few credits keeps the card open`;
  - `outlawed port lists the good as not traded and refuses a sale`;
  - each patrol scans at most once per system visit;
  - a Clean pilot with a legal hold is never hailed.
- [ ] **Step 2: Run** them. Expect FAIL.
- [ ] **Step 3: Implement** it.
- [ ] **Step 4: Run** `npm run typecheck && npx vitest run`, then the encounters, combat and story e2e specs with the local config. Expect all to pass. Existing hail and demand behaviour is unchanged.
- [ ] **Step 5: Commit** `feat: contraband scans and law hails`.

---

### Task 7: Law and rank UI

**Files:**
- Modify:
  - `src/ui/sidebar` (wherever the nav line renders) and `src/render/sidebar.ts`, plus the rail if the phone needs it;
  - the pilot card on the main menu and the pause menu's pilot page;
  - the planet screen: the Pay fines row and the salary notice;
  - the shipyard and outfitter screens: discounted prices and the rank lock text;
  - `src/ui/howToPlay.ts`;
  - tests.

**Interfaces:**
- Consumes: `legalStatus`, `fineFor`, `payFines` (Task 3); `rankTitle`, `discountPct`, `paySalary` (Task 4).
- Produces:
  - **Sidebar:** `Law: Clean|Suspect|Wanted|Hunted` for the current system's government. Colours: Clean `#7fd18b`, Suspect `#e0c060`, Wanted `#e08a50`, Hunted `#e05050`.
  - **Pilot card:** a line per government that is not Clean (`Concord: Wanted`) and a line per faction with rank ≥ 1 (`Concord: Keeper`).
  - **Planet screen:** a row per owed government, `Fines owed to {Gov}: {fine} cr [Pay]`. A short-credits refusal shows `Not enough credits.` A paid salary shows the notice `{Gov} salary: +{cr} cr`.
  - **How to Play:** a "Law & ranks" page covering status levels, fines, bribes, scans, the scrambler, ranks and perks.

- [ ] **Step 1: Failing UI unit tests** for each element's text and colour, in the existing screen-test style.
- [ ] **Step 2: Run** them. Expect FAIL.
- [ ] **Step 3: Implement** the UI.
- [ ] **Step 4: Run** `npm run typecheck && npx vitest run`. Expect PASS.
- [ ] **Step 5: Commit** `feat(ui): law status, fines and rank titles`.

---

### Task 8: End-to-end tests and docs

**Files:**
- Create: `tests/e2e/law.spec.ts`
- Modify: `docs/design-notes.md` (fix the roadmap numbering: the sound and music update was not "cycle 5", and cycle 5 is law and ranks), `README.md`

**Interfaces:**
- Consumes: everything above. Use the test hook on `window.__starwake` to set heat, points or cargo where reaching them by play would be slow, as `combat.spec.ts` does. Use real keys and taps for the choices themselves.

- [ ] **Step 1: Write the e2e tests.** Assert no console errors in each.
  - **PC:** attack a Concord patrol until Wanted, receive the law hail, Pay fine, end Clean, and the sidebar reads `Law: Clean`.
  - **Phone:** carry stims into Concord space, get scanned, open the card from the context button, Comply, and the cargo is gone and the credits fall by the fine.
  - **PC:** the planet screen Pay fines row pays and disappears.
  - **PC:** setting points to rank 2 shows the title on the pilot card and a 5% lower shipyard price at a Concord port.
- [ ] **Step 2: Run** the new spec with `--repeat-each 3`, then the full suite with the local config. Everything must be green.
- [ ] **Step 3: Update the docs:** design notes (law, contraband and ranks architecture; corrected roadmap) and a README feature line.
- [ ] **Step 4: Run** `npm run typecheck && npx vitest run` and the full Playwright suite twice. Both must be green.
- [ ] **Step 5: Commit** `test(e2e): law, scans and ranks end to end` and `docs: cycle 5 law and ranks`.
