# Cycle 6 — Escorts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the pilot fly with up to three escorts, hired at shipyard ports or kept from a capture. The group takes four orders (Follow, Attack my target, Hold position, Return fire only), jumps with the pilot on its own fuel, and is repaired and paid at ports.

**Architecture:** The saved group lives on the world as `WorldState.escorts` and `escortOrder`, with its rules in a new pure module, `src/sim/escorts.ts`. In flight, each escort becomes a traffic NPC with the new role `escort` (`src/sim/escortNpcs.ts`). Each tick, `stepBattle` steers it with `escortAi` (`src/sim/escortAi.ts`). The controller writes the NPCs' armor and ammo back into the list when the pilot jumps, lands or is towed, and spawns them again on take-off and arrival. All tunables live in `data/escorts.json`. The save moves to v8.

**Tech Stack:** TypeScript, Phaser 4, Zod, Vitest, Playwright.

**Spec:** docs/superpowers/specs/2026-11-01-starwake-cycle6-escorts-design.md

## Global Constraints

- Old saves (v1–v7) must load. They chain to v8 and arrive with no escorts and the order `follow`. A corrupt escort entry never fails a load (spec §6).
- It must work on PC and phone (touch, 844×390), and the PC sidebar must still fit 1280×600.
- The UI is built only with `el()`, `button()` and `textContent`.
- The sim stays pure, seeded (mulberry32/hashString) and fixed-step. No `Math.random` or `Date` in `src/sim`.
- Every tunable goes in `data/escorts.json`, behind the Zod schema `EscortsSchema`. Defaults: `maxEscorts` 3, `maxOffers` 3, `hireFeeMul` 0.1, `wageMul` 0.005, `repairPerArmor` 10, `followDistance` 90, `hireable` [courier, scout, kestrel, warden].
- The group never holds more than `maxEscorts`, whatever the source (hire, keep or save).
- Escorts never block the player's landing, jump or tow. They are never targeted, hailed, scanned or boarded.
- Story ships, raider demands and encounter sites are unchanged. Out of scope (spec §11): carriers and fighters, crew, per-escort orders, a fleet screen, cargo, upgrades and morale.
- No model names in code, docs or commit subjects.
- Each commit message ends with exactly the two attribution trailer lines the controller supplies (not quoted here).
- Playwright runs locally with `npx playwright test -c $PW_LOCAL`. The controller passes in the config path.
- Before claiming done: `npm run typecheck && npx vitest run` and the full Playwright suite pass. Never merge or deploy; the controller asks the owner.

## Decisions (where the spec leaves a choice)

1. **Types and flags.** `Escort` and `EscortOrder` live in `src/sim/types.ts`, beside `Mission`. Besides the spec's eight fields, `Escort` has two optional flags:
   - `waiting?: true`: left behind on a jump. Never saved, because a save is a landed snapshot, and landing rejoins the group.
   - `leaving?: true`: a wage went unpaid. It is saved, and the escort leaves at the next landing.
2. **Escort NPCs.**
   - An escort NPC has the same id as its list entry (`esc-<n>`), `role: 'escort'` and `government: ''` (the player's combatant government).
   - It never uses `Npc.hold`, because `refreshStory` sweeps NPCs that hold. The Hold order is pure AI.
   - A new escort's `n` is 1 + the highest `n` in the group.
3. **Targeting versus battle.** Add `inFlight(n)`, true for the `fly` and `jumpIn` phases. `isTargetable(n)` becomes `n.role !== 'escort' && inFlight(n)`.
   - `stepBattle`'s recharge, combatant and decision lists switch to `inFlight`.
   - `radarBlips` also switches to `inFlight`.
   - Every other caller of `isTargetable` keeps it: target cycling, boarding, law, `nearestHostile` and `targetShip`.
4. **Friendly fire.** `isPlayerSide(id)` (in `combat.ts`) is true for `PLAYER_ID` and any id that starts with `esc-`. Shots and beams from the player's side never hit the player's side. Patrols treat player-side combatants as they treat the player: they are hostile only when that government is angry or hunting. Raiders attack escorts.
5. **escortAi hook.** In `stepBattle` step 3, an escort branch comes after the disabled-drift branch and before the `demand` branch.
   - It calls `escortAi`, moves the ship and fires through the same gun and launcher code as the attack branch. Extract that code into a local `fireAt` helper.
   - The approach and keep-range steering comes out of `decide()` into an exported `engageInput`, with no change in behaviour.
   - Escorts use the `patrol` AI profile from `combat.json` and never flee.
6. **Orders.**
   - Attackers are the ids that have hit the player (a new `Battle.playerAggro`) or any escort (its `aggro`).
   - **Follow:** engage the attackers, plus raiders that would fight the player (not peaceful, not demanding), within `engageRange`. Raiders cost no heat.
   - **Attack:** Follow, but the player's targeted ship comes first, at any range.
   - **Return fire only (`defend`):** engage only the attackers, within `engageRange`.
   - **Hold:** brake to rest and fire only at attackers within `fireRange`, turning but not thrusting toward them.
   - **Formation:** with no target, an escort keeps station on its slot. The slots form an arc `followDistance` behind the player, spread `SLOT_SPREAD = 0.6` rad apart. Within `STATION_RADIUS = 24` px of its slot, an escort copies the player's velocity and heading.
7. **Crimes and credit.** An escort's hit on a lawful ship runs the same code as the player's:
   - `commitCrime` for `hit` (the first player-side hit on that ship), then `disable` and `destroy`;
   - `angerOnHit` (standing and `angry`).

   It never counts toward `stats.kills`, `killCounted`, rank points or clear jobs. The `disabled` and `destroyed` events gain `byEscort: boolean`. The controller's `creditKills` passes escort takedowns of a bounty target to the new `recordBountyDown`.
8. **Lifecycle.**
   - **Jump:** an escort jumps when it is present, not disabled and has fuel ≥ 1. Otherwise it is marked `waiting`. A disabled escort is left behind.
   - **Arrival:** escorts spawn on the arc behind `jumpEndPos`, so they are in formation when the arrive phase ends.
   - **Tow and pod rescue:** they are landings, so every escort rejoins there.
   - **Take-off:** escorts spawn on the arc behind the parked ship.
   - **Spawning:** spawning first removes any escort NPCs already in traffic, so a ship never appears twice.
   - **Disabled on spawn:** a spawned hull below the disable line (`DISABLE_FRACTION` of max armor) starts disabled, as a kept capture does.
9. **Fuel** is counted in jumps. The maximum is `jumpsOf(shipStats(shipId, outfits).fuelCapacity, config.fuelPerJump)`. The maximum armor is `shipStats(shipId, outfits).armor`.
10. **Offers.**
    - A port with a shipyard offers `randInt(1, maxOffers)` escorts, drawn from `hashString(world.seed, 'escortOffers', portId, world.day)`.
    - Each offer is a hireable hull with `techTier ≤ port tier`, and each has a distinct name from `names`.
    - Offer ids are `esc:<portId>:<day>:<i>`, and a hire is recorded in the existing `takenOffers`, whose day filter already parses that shape.
    - `maxOffers` is a tunable the spec names in §10 ("up to 3 offers").
11. **Planet screen.**
    - "Hire escorts" (only with a shipyard) and "Your escorts" (only with an escort) are buttons that open inline lists in the actions column. They are not new screens, and they have no hotkeys.
    - The Repair all row sits in "Your escorts" and shows only when armor is missing.
12. **Phone ORDER button.** It sits in the button rail between the spacer and TGT, `MAP_HEIGHT` tall and as wide as Fire. `railMetrics` gains `order = false`, and the radar gives up room first, as it already does.
13. **Sidebar line.** `Escorts: <n> · <Order>` sits below Law, where `<n>` counts the escort NPCs present. The block grows by 20 px. That fits: the date line ends near y 454 and the Map button starts at y 558 at 600 px.
14. **Colour.** `ESCORT_COLOR = '#5ff0e0'` (in `src/render/hudInfo.ts`) is used for radar dots and sprite tint. It differs from the target green (`#6fe36f`) and from every government colour.
15. **Modules.** `escorts.ts` imports no values from `traffic`, `battle`, `boarding` or `world`, so `world.ts` can call `payWages` without making the cycle worse. `boarding.prizeValue` delegates to the new `escorts.prizeValueOf(data, shipId)`. `Controller.snapshot()` syncs escorts from traffic before saving.

## Review Focus

1. **Escorts hidden by the targeting change.** Excluding escorts from `isTargetable` must not drop them from battle, radar or the drawn view. → Task 4: `an escort is not targetable but still recharges, decides, fires and is hit by raiders`. Task 7: `radarBlips includes an escort in ESCORT_COLOR`.
2. **Friendly fire.** The player's bolts, beams or seekers pass through an escort in the way, and an escort's shots pass through the player. Neither deals damage, adds heat or aggro, nor turns an escort on the player. → Task 4: `player-side shots never hit the player side; no heat, no aggro`.
3. **Duplicate or lost escort NPCs.** Each escort shows as exactly one NPC through land, take-off, jump, tow, pod rescue and load, and none is left in traffic while landed. → Task 5: `land/take-off/jump/tow/load cycle keeps exactly one NPC per present escort`.
4. **A waiting escort.** An escort that is disabled, or has 0 fuel (a fresh kept capture), when the pilot jumps stays behind. It rejoins, refuelled, at the next landing in another system, and is neither lost nor counted present in the meantime. → Task 5: `a disabled or empty escort waits on jump and rejoins at a landing two systems away`.
5. **Wages with low or negative credits.** A multi-day tow can leave too little for wages, or a tow fee can leave credits negative. Credits never go below what they were, and each unpaid escort leaves at the next port with the spec's notice. → Task 3: `payWages over a 3-day advance with credits for one wage pays the first escort once and marks the rest leaving; negative credits pay nothing`.

---

### Task 1: Escort data and schema

**Files:**
- Create: `data/escorts.json`
- Modify: `src/data/schemas.ts` (`EscortsSchema`, `EscortsDef`, `GameData.escorts`), `src/data/load.ts` (`KEYS`, the parse, the cross-check and the `loadGameData` import list), `src/data/testData.ts`, `src/data/load.test.ts` (its `raw()` helper as well)

**Interfaces:**
- Produces: `GameData.escorts: EscortsDef`:
  ```ts
  { maxEscorts: number /* int ≥ 1 */; maxOffers: number /* int ≥ 1 */; hireFeeMul: number; wageMul: number;
    repairPerArmor: number; followDistance: number; hireable: string[] /* ship ids, min 1 */; names: string[] }
  ```
  - The schema is `.strict()`, with a refine that `names.length ≥ maxOffers`.
  - The shipped `names` has at least 12 in-world escort names.

- [ ] **Step 1: Write failing tests in `load.test.ts`:**
  - the shipped escorts data parses with the default values listed under Global Constraints;
  - `hireable` naming an unknown hull is rejected, with `escorts.json` and `hireable.0` in the error;
  - a `unique` hull in `hireable` is rejected;
  - `maxEscorts: 0` and a negative `wageMul` are rejected;
  - too few names for `maxOffers` is rejected.
- [ ] **Step 2: Run** `npx vitest run src/data`. Expect FAIL.
- [ ] **Step 3: Implement** the schema, data and cross-check, mirroring how `law.json` is parsed in `parseGameData`.
- [ ] **Step 4: Run** `npm run typecheck && npx vitest run`. Expect PASS.
- [ ] **Step 5: Commit** `feat(data): escort tunables`.

---

### Task 2: Save v8 and world state

**Files:**
- Create: `src/sim/escorts.ts` (only the helpers below), `src/sim/escorts.test.ts`
- Modify: `src/sim/types.ts`, `src/sim/world.ts` (`newWorld`), `src/save/pilot.ts`, `src/save/pilot.test.ts`

**Interfaces:**
- Consumes: `GameData.escorts` (Task 1).
- Produces:
  ```ts
  // types.ts
  export type EscortOrder = 'follow' | 'attack' | 'hold' | 'defend';
  export interface Escort { id: string; name: string; shipId: string; outfits: Record<string, number>; armor: number;
    fuel: number; hired: boolean; wage: number; waiting?: true; leaving?: true }
  // WorldState gains: escorts: Escort[]; escortOrder: EscortOrder;   (newWorld: [] and 'follow')
  // escorts.ts
  export const ESCORT_ORDERS: readonly EscortOrder[] = ['follow', 'attack', 'hold', 'defend'];
  export function escortMaxArmor(data: GameData, e: Pick<Escort, 'shipId' | 'outfits'>): number;
  export function escortMaxFuel(data: GameData, e: Pick<Escort, 'shipId' | 'outfits'>): number; // in jumps
  ```
  - `CURRENT_SAVE_VERSION = 8`, with the migration `7: (s) => ({ ...s, version: 8, escorts: [], escortOrder: 'follow' })`.
  - **`PilotSaveSchema` (data-free):**
    - `escorts`: when missing, null or not an array, it loads as `[]`.
    - Entries that are not objects are dropped.
    - Non-finite numbers become 0, and `hired` and `leaving` that are not booleans become `false`.
    - `escortOrder`: `z.enum(ESCORT_ORDERS).catch('follow')`.
  - **`worldFromPilot` (data):**
    - drops entries whose hull is unknown, and outfits whose id is unknown;
    - clamps `armor` to [0, `escortMaxArmor`] and `fuel` to [0, `escortMaxFuel`];
    - sets `wage` to 0 when not hired;
    - gives a missing name the hull's name, and a missing or duplicate id a fresh `esc-<n>`;
    - clears `waiting`;
    - cuts the list to `maxEscorts`.
  - `pilotFromWorld` writes every field except `waiting`.

- [ ] **Step 1: Write failing tests in `pilot.test.ts`:**
  - `a v7 save migrates to v8 with no escorts and order follow`;
  - `a v1 save still migrates all the way to v8`;
  - `escorts and order round-trip, leaving kept and waiting dropped`;
  - tolerant load:
    - `escorts: null` and `escorts: 'x'` load as `[]`;
    - a non-object entry is dropped;
    - an unknown hull is dropped;
    - `armor: 1e9` clamps to the hull max, and `NaN` becomes 0;
    - `fuel: -3` becomes 0;
    - five entries are cut to 3;
    - two entries with id `esc-1` end with distinct ids;
    - `escortOrder: 'charge'` loads as `follow`.
- [ ] **Step 2: Run** `npx vitest run src/save`. Expect FAIL.
- [ ] **Step 3: Implement** the fields, the defaults, the migration and the two helpers. The existing `num` and `clamp` cover the number fixes.
- [ ] **Step 4: Run** `npm run typecheck && npx vitest run`. Expect PASS.
- [ ] **Step 5: Commit** `feat(save): v8 escort list and order`.

---

### Task 3: Escort rules: hire, keep, dismiss, wages, repair and orders

**Files:**
- Modify: `src/sim/escorts.ts`, `src/sim/escorts.test.ts`, `src/sim/world.ts` (`advanceDays` calls `payWages` each day, after `decayHeat`), `src/sim/boarding.ts` (`prizeValue` delegates)

**Interfaces:**
- Consumes: Task 2's types and helpers.
- Produces (all in `escorts.ts`):
  ```ts
  export interface EscortOffer { offerId: string; name: string; shipId: string; fee: number; wage: number }
  export const ORDER_LABEL: Record<EscortOrder, string>; // Follow, Attack, Hold, Return fire
  export function hireOffers(world: WorldState, data: GameData, portId: string): EscortOffer[]; // [] without a shipyard; taken offers left out
  export function hireEscort(world: WorldState, data: GameData, portId: string, offerId: string):
    { world: WorldState; escort: Escort } | { error: 'full' | 'short' | 'gone' };
  export function keepCapture(world: WorldState, data: GameData, npc: { name: string; shipId: string; outfits: Record<string, number>; hull: { armor: number } }):
    { world: WorldState; escort: Escort } | { error: 'full' };   // fuel 0, hired false, wage 0, stats.captures + 1
  export function dismissEscort(world: WorldState, id: string): WorldState;
  export function prizeValueOf(data: GameData, shipId: string): number; // round10(prizeFraction × price)
  export function sellEscortPrize(world: WorldState, data: GameData, id: string): { world: WorldState; paid: number } | { error: 'hired' | 'gone' };
  export function payWages(world: WorldState, data: GameData): WorldState; // one day, in list order
  export function landEscorts(world: WorldState, data: GameData): { world: WorldState; notices: string[] }; // leavers go, waiting cleared, fuel to max
  export function repairCost(world: WorldState, data: GameData): number;   // repairPerArmor × Σ missing armor, rounded
  export function repairEscorts(world: WorldState, data: GameData): { world: WorldState; paid: number } | { error: 'short' | 'none' };
  export function nextOrder(o: EscortOrder): EscortOrder;   // follow → attack → hold → defend → follow
  export const HIRE_REFUSAL: Record<'full' | 'short' | 'gone', string>;
  // HIRE_REFUSAL: full 'Your group is full (3 escorts).' (the 3 is maxEscorts), short 'Not enough credits.', gone 'That pilot has moved on.'
  ```
  - A hire charges `fee = round(price × hireFeeMul)` and sets `wage = round(price × wageMul)`, with full armor and fuel and `npcLoadout(def)` outfits.
  - The leave notice is exactly `<name> leaves your service: unpaid wages.`

- [ ] **Step 1: Write failing tests:**
  - **offers:**
    - a tier-3 shipyard port offers 1–3 escorts, all `techTier ≤ 3`, with no warden;
    - a port with no shipyard offers none;
    - the same seed, port and day give the same offers, and the next day differs.
  - **hire:**
    - a courier costs 3000 with a wage of 150;
    - hiring takes the offer out of `hireOffers`;
    - a fourth hire gives `full`, and short credits give `short`, both with no change to the world.
  - **keep:**
    - a kept capture has armor from the hull, its outfits, fuel 0, `hired: false`, wage 0 and `captures + 1`;
    - a fourth keep gives `full`.
  - **dismiss and prize:**
    - dismissing refunds nothing;
    - `sellEscortPrize` pays `prizeValueOf` for a kept capture and refuses a hired escort with `hired`;
    - `boarding.prizeValue` is unchanged.
  - **wages:**
    - `advanceDays(w, 2)` charges 2 × 150 for one courier;
    - `payWages over a 3-day advance with credits for one wage pays the first escort once and marks the rest leaving; negative credits pay nothing`;
    - a kept capture draws no wage.
  - **landing:**
    - `landEscorts` removes the leavers with the exact notice;
    - it refuels every escort to `escortMaxFuel` and clears `waiting`.
  - **repair:**
    - the cost is 10 × missing armor;
    - repairing restores the max armor;
    - it refuses with `short` and no change when credits fall short;
    - it refuses with `none` when there is no damage.
  - **orders:** `nextOrder` cycles through all four.
- [ ] **Step 2: Run** `npx vitest run src/sim/escorts.test.ts src/sim/world.test.ts`. Expect FAIL.
- [ ] **Step 3: Implement** them.
- [ ] **Step 4: Run** `npm run typecheck && npx vitest run`. Expect PASS. The existing `advanceDays`, boarding and world tests are unchanged.
- [ ] **Step 5: Commit** `feat(sim): hire, keep, wages and repair for escorts`.

---

### Task 4: Escort NPCs in traffic and battle

**Files:**
- Create: `src/sim/escortAi.ts`, `src/sim/escortAi.test.ts`, `src/sim/escortNpcs.ts`, `src/sim/escortNpcs.test.ts`
- Modify:
  - `src/sim/ai.ts`: `NpcRole` gains `'escort'`, `isHostileTo` handles the player side, `engageInput` is extracted, and the profile lookup maps `escort` to `patrol`.
  - `src/sim/combat.ts`: `isPlayerSide`.
  - `src/sim/traffic.ts`: `inFlight` and `isTargetable`; `stepNpc` returns an escort untouched; escorts are left out of the spawn count.
  - `src/sim/battle.ts`: the escort branch, `fireAt`, `playerAggro`, friendly-fire filtering, crimes and `byEscort`.
  - `src/sim/combatMissions.ts`: `recordBountyDown`.
  - `src/app/controller.ts`: `creditKills`.
  - Tests: `battle.test.ts`, `traffic.test.ts`, `ai.test.ts`, `combatMissions.test.ts`.

**Interfaces:**
- Consumes: `Escort`, `escortMaxArmor` and `GameData.escorts` (Tasks 1–2).
- Produces:
  ```ts
  // combat.ts
  export const ESCORT_ID_PREFIX = 'esc-';
  export const isPlayerSide = (id: string): boolean;
  // traffic.ts
  export const inFlight = (n: Npc): boolean;            // phase fly | jumpIn
  export const isTargetable = (n: Npc): boolean;        // role !== 'escort' && inFlight(n)
  // ai.ts
  export function engageInput(me: Combatant, target: Combatant, range: number, fireRange: number, profile: AiProfile, data: GameData): { input: FlightInput; fire: boolean };
  // escortNpcs.ts
  export const SLOT_SPREAD = 0.6;
  export function escortSlot(player: ShipState, index: number, count: number, followDistance: number): Vec2;
  export function escortNpc(e: Escort, data: GameData, at: { pos: Vec2; heading: number; vel?: Vec2 }): Npc; // shields full, armor from e; disabled below the disable line
  // escortAi.ts
  export const STATION_RADIUS = 24;
  export interface EscortView {
    me: Combatant; player: Combatant; slot: Vec2; order: EscortOrder; playerTargetId: string | null;
    attackers: ReadonlySet<string>;   // hit the player or any escort this visit
    threats: ReadonlySet<string>;     // raiders that would fight the player (not peaceful, not demanding)
    maxSpeed: number; fireRange: number;
  }
  export function escortTargetId(v: EscortView, others: readonly Combatant[], data: GameData): string | null;
  export function escortAi(v: EscortView, others: readonly Combatant[], data: GameData): AiDecision & { station: boolean };
  // battle.ts
  // Battle gains playerAggro: string[] ([] in newBattle).
  // BattleEvent 'disabled' and 'destroyed' gain byEscort: boolean.
  // combatMissions.ts
  export function recordBountyDown(world: WorldState, npc: { missionId?: string }): WorldState; // bounty jobs only, never clear jobs
  ```
  - In `stepBattle`, escorts get `slot = escortSlot(world.ship, i, count, followDistance)` in traffic order and `order = world.escortOrder`.
  - When `station` is true, the escort's velocity and heading are set to the player's. `engaged` is always true for an escort.

- [ ] **Step 1: Write the failing tests:**
  - **escortAi:**
    - an escort under follow and far from its slot flies toward the slot;
    - inside `STATION_RADIUS`, `station` is true;
    - follow targets an attacker in `engageRange` and a hostile raider, but not a peaceful or demanding raider, nor an untouched trader;
    - attack picks the player's targeted trader first, even beyond `engageRange`;
    - defend ignores a hostile raider that has not fired, and engages it once it is in `attackers`;
    - hold never thrusts, and fires only at an attacker within `fireRange`;
    - no order ever targets a player-side id.
  - **escortSlot:** with 1, 2 and 3 escorts, the slots sit `followDistance` behind the heading and `SLOT_SPREAD` apart.
  - **escortNpc:** a spawned NPC has full shields and the list's armor; one below 10 % armor spawns disabled.
  - **battle:**
    - `an escort is not targetable but still recharges, decides, fires and is hit by raiders`;
    - `player-side shots never hit the player side; no heat, no aggro`: a bolt, a beam and a seeker each pass through, in both directions;
    - an escort's first hit on a Concord trader gives +10 heat, a second hit adds nothing, disabling gives +20 and destroying +40, and the Concord turns angry;
    - an escort's kill does not change `stats.kills` or `killCounted`, gives no raider rank point and does not advance a clear job;
    - `byEscort` is true on its `disabled` and `destroyed` events;
    - a Concord patrol fires on an escort only while the Concord is angry or hunting;
    - a raider hitting the player lands in `playerAggro`.
  - **bounty:** `recordBountyDown` completes the bounty and leaves a clear job alone. The controller test: an escort destroying the bounty target completes the job.
  - **traffic:**
    - `stepTraffic` for 200 s never moves, lands, jumps out or drops an escort, and escorts do not count toward the wanted ship count;
    - `cycleTarget` and `nearestHostile` skip escorts;
    - a disabled escort beside the player is not offered by `CombatControl.boardable`.
  - The existing ai, battle and traffic tests pass unchanged.
- [ ] **Step 2: Run** `npx vitest run src/sim src/app/controller.test.ts`. Expect FAIL.
- [ ] **Step 3: Implement** it.
- [ ] **Step 4: Run** `npm run typecheck && npx vitest run`. Expect PASS.
- [ ] **Step 5: Commit** `feat(sim): escort ships fight beside the player`.

---

### Task 5: Jump, tow and landing lifecycle

**Files:**
- Modify: `src/sim/escortNpcs.ts` (+ test), `src/sim/escorts.ts` (+ test), `src/app/controller.ts` (+ `controller.test.ts`)

**Interfaces:**
- Consumes: Tasks 3–4.
- Produces:
  ```ts
  // escortNpcs.ts
  export function withEscorts(t: Traffic, world: WorldState, data: GameData, around: { pos: Vec2; heading: number }): Traffic; // drops every escort NPC, then spawns non-waiting escorts on the arc
  export function withoutEscorts(t: Traffic): Traffic;
  export function syncEscorts(world: WorldState, data: GameData, t: Traffic): WorldState; // writes back armor (hull.armor) and outfits of present escort NPCs
  export function escortsJump(world: WorldState, data: GameData, t: Traffic): WorldState; // sync, then fuel −1 or waiting
  export function presentEscorts(t: Traffic): Npc[];
  // escorts.ts
  export function escortLosses(world: WorldState, before: Traffic, events: readonly BattleEvent[]): { world: WorldState; messages: string[] }; // type-only imports; '<name> is destroyed.'
  ```
  - **Controller wiring:**
    - `leavePlanet`: `withEscorts` around the parked ship.
    - `jumped`: `escortsJump` on the old traffic before `freshTraffic`, then `withEscorts` around `jumpEndPos` with the jump heading.
    - `landAt`: `syncEscorts`, then `withoutEscorts`, then `landEscorts`. Its notices join `this.notices`. This runs on load too.
    - `callTow` and the pod rescue: `syncEscorts` before the world moves; the landing that follows rejoins every escort.
    - `stepCombat`: `escortLosses`, with the message joined to the battle messages.
    - `snapshot()`: `syncEscorts` first.

- [ ] **Step 1: Write the failing tests:**
  - **escortsJump:** an escort with fuel 2 goes to 1; one with fuel 0 becomes `waiting`; a disabled one becomes `waiting`; an already waiting one stays waiting.
  - **syncEscorts:** it writes armor and spent ammo back, and leaves a waiting escort alone.
  - **withEscorts:** it spawns no waiting escort, places the NPCs on `escortSlot`, and run twice it still gives one NPC per escort.
  - **escortLosses:** a destroyed escort is removed with `Brass Heron is destroyed.`; a disabled one stays.
  - **controller:**
    - `land/take-off/jump/tow/load cycle keeps exactly one NPC per present escort`, with no escort NPC in traffic while landed;
    - `a disabled or empty escort waits on jump and rejoins at a landing two systems away`;
    - escort armor lost in flight is still missing after landing, and the planet's repair cost reflects it;
    - an unpaid escort is gone after landing, and the notice is in `takeNotices()`;
    - fuel is full after landing;
    - with three escorts present, landing, jumping and calling a tow happen on the same tick as with none;
    - the order survives a save and load through `snapshot()` and `worldFromPilot`.
- [ ] **Step 2: Run** `npx vitest run src/sim/escortNpcs.test.ts src/sim/escorts.test.ts src/app/controller.test.ts`. Expect FAIL.
- [ ] **Step 3: Implement** it.
- [ ] **Step 4: Run** `npm run typecheck && npx vitest run`. Expect PASS. The existing jump, tow, landing and story tests are unchanged.
- [ ] **Step 5: Commit** `feat: escorts jump, wait, land and rejoin with the pilot`.

---

### Task 6: Orders key, phone ORDER button and the capture choice

**Files:**
- Modify:
  - `src/input/actions.ts`: `escortOrder` in the flight group, labelled `Escort orders`.
  - `src/input/bindings.ts`: `escortOrder: ['KeyI', null]`.
  - `src/ui/howToPlay.ts`: `PHONE_CONTROLS.escortOrder = 'ORDER button (with escorts)'`.
  - `src/app/controller.ts`: the update loop, `cycleEscortOrder` and `escortsPresent`.
  - `src/app/combatControl.ts`: the `keep` choice and `keepBlocked`.
  - `src/ui/boardingCard.ts`, `src/ui/rails.ts`, `src/input/touch.ts` (`railMetrics`).
  - Tests: `bindings.test.ts`, `controller.test.ts`, `combatControl.test.ts`, `boardingCard.test.ts`, `rails.test.ts`, `touch.test.ts`, `settings.test.ts`.

**Interfaces:**
- Consumes: `nextOrder`, `ORDER_LABEL`, `keepCapture` (Task 3); `escortNpc`, `presentEscorts` (Tasks 4–5).
- Produces:
  ```ts
  // controller.ts
  escortsPresent(): number;
  cycleEscortOrder(): EscortOrder | null; // null (nothing happens) unless flying with ≥ 1 escort present; emits message 'Escorts: <Label>.'
  // combatControl.ts
  // BoardingChoice gains 'keep'; BoardingView gains keepBlocked: string | null ('Your group is full (3 escorts)').
  // touch.ts
  export function railMetrics(layout: Layout, s: Pick<Settings['touch'], 'buttonSize'>, steering: Steering, hint?: boolean, order?: boolean): RailMetrics; // RailMetrics gains order: number (0 when hidden)
  ```
  - **Keep:** the captured stage shows Take command, Sell as prize (N cr), Keep as escort, Leave, with hotkeys 1–4. Keep calls `keepCapture` and replaces the boarded NPC with `escortNpc` in place, keeping its hull. That is disabled, so it drifts. The message is `<name> joins your escort.`
  - **ORDER button:** `data-control="order"`, text `ORDER` and aria-label `Escort orders (now Follow)`. It is shown only when `escortsPresent() > 0`, and a tap presses and releases `escortOrder`.

- [ ] **Step 1: Write the failing tests:**
  - **key:**
    - KeyI cycles the order Follow → Attack → Hold → Return fire → Follow, with the HUD message `Escorts: Attack.`;
    - it does nothing landed, or with no escort present;
    - stored settings that lack `escortOrder` get KeyI, unless the pilot already put KeyI on another flight action, in which case it is left unbound.
  - **capture card:**
    - after a capture, the card lists the four entries in order;
    - Keep turns the ship into an escort NPC in place and the group grows by 1;
    - with 3 escorts, Keep is disabled with `Your group is full (3 escorts)` and the other choices still work.
  - **phone:**
    - ORDER is hidden with no escort present and shown with one;
    - a tap cycles the order;
    - at 844×390 (simple and classic steering, with and without the guide hint), the right stack fits the rail and every button is at least `MIN_BUTTON`;
    - ORDER is `MAP_HEIGHT` tall, and the radar shrinks before any button.
- [ ] **Step 2: Run** `npx vitest run src/input src/app src/ui/boardingCard.test.ts src/ui/rails.test.ts src/save`. Expect FAIL.
- [ ] **Step 3: Implement** it.
- [ ] **Step 4: Run** `npm run typecheck && npx vitest run`. Expect PASS. The existing rail metrics are unchanged when `order` is false.
- [ ] **Step 5: Commit** `feat: escort orders on KeyI and the phone rail; keep a capture as an escort`.

---

### Task 7: Planet screen, sidebar, radar and How to Play

**Files:**
- Modify:
  - `src/app/controller.ts`: the landed methods below.
  - `src/ui/planetScreen.ts`, `src/render/sidebarInfo.ts`, `src/render/sidebar.ts`.
  - `src/render/hudInfo.ts`: `ESCORT_COLOR`.
  - `src/render/SpaceScene.ts`: the tint.
  - `src/ui/howToPlay.ts`: the Escorts tab.
  - `src/ui/styles.css`: if the lists need a row class.
  - Tests: `planetScreen.test.ts`, `sidebarInfo.test.ts`, `howToPlay.test.ts`.

**Interfaces:**
- Consumes: Task 3's rules and `presentEscorts` (Task 5).
- Produces:
  ```ts
  // controller.ts (landed only; refused when not landed)
  escortOffers(): EscortOffer[];
  hireEscort(offerId: string): { ok: true; escort: Escort } | { ok: false; error: 'full' | 'short' | 'gone' };
  dismissEscort(id: string): boolean;
  sellEscort(id: string): { ok: true; paid: number } | { ok: false; error: 'hired' | 'gone' };
  escortRepairCost(): number;
  repairEscorts(): { ok: true; paid: number } | { ok: false; error: 'short' | 'none' };
  // sidebarInfo.ts: SidebarInfo gains escorts: string | null   // 'Escorts: 2 · Follow'; null with none present
  // howToPlay.ts: HowToPlayTab gains 'escorts' (text 'Escorts'), placed before 'controls'
  ```
  - **Hire list:** each offer row reads `<name> — <hull name> · fee <fee> cr · <wage> cr/day [Hire]`. A refusal shows `HIRE_REFUSAL` in the status line with `sw-status-bad`. A hire says `<name> joins your escort.`
  - **Escort list:** each row reads `<name> — <hull name> · armor <a>/<max> · <wage> cr/day` (or `kept capture`), with `[Dismiss]`, plus `[Sell as prize (<v> cr)]` for a kept capture. Then comes `Repair all — <cost> cr [Repair]`, shown only when the cost is above 0. When short, the status line says `Not enough credits.`
  - **Sidebar:** the `escorts` label sits below `law`, in `boxes()` and `place()` (Decision 13).
  - **Radar and sprites:** `radarBlips` uses `inFlight`, so escort dots carry `ESCORT_COLOR`, and `SpaceScene` tints escort sprites with it.
  - **How to Play:** the Escorts tab covers hiring, with the fee and wage percentages read from data; keeping a capture; the four orders, with the bound key and the phone's ORDER; fuel and waiting; repair, at `repairPerArmor` per point; and that escort hits are the pilot's crimes.

- [ ] **Step 1: Write the failing tests:**
  - **planet screen:**
    - at Vanterre, "Hire escorts" lists the offers;
    - Hire charges the fee and the row leaves the list;
    - a fourth hire shows `Your group is full (3 escorts).`;
    - at Halcyon, with no shipyard, there is no Hire button;
    - "Your escorts" lists a damaged escort with its armor;
    - Repair all shows 10 × missing armor and charges it, and the row disappears;
    - short credits show `Not enough credits.`;
    - Dismiss removes the row;
    - Sell as prize appears only for a kept capture and pays its value.
  - **sidebar:** `Escorts: 2 · Follow` shows with two present and is null with none; in the 600 px layout, the boxes do not overlap and end above the Map button.
  - **radar:** `radarBlips includes an escort in ESCORT_COLOR`.
  - **How to Play:** the tab list has seven entries, with Escorts before Controls; the Escorts text contains `10%`, `0.5%`, `KeyI`'s key name and `10 cr`.
- [ ] **Step 2: Run** `npx vitest run src/ui src/render`. Expect FAIL.
- [ ] **Step 3: Implement** the UI, using `el()`, `button()` and `textContent` only.
- [ ] **Step 4: Run** `npm run typecheck && npx vitest run`. Expect PASS.
- [ ] **Step 5: Commit** `feat(ui): hire and manage escorts, sidebar line, radar colour, How to Play`.

---

### Task 8: End-to-end tests and docs

**Files:**
- Create: `tests/e2e/escorts.spec.ts`
- Modify:
  - `src/app/testHook.ts`: `combatState` NPCs gain `pos` and `aggro`. A new `captureWillSucceed(npcId): boolean` wraps `captureSucceeds`.
  - `tests/e2e/helpers.ts`: `quietSky` keeps NPCs with `role === 'escort'`.
  - `tests/e2e/howtoplay.spec.ts`: seven tabs.
  - `docs/design-notes.md`: the escorts architecture; roadmap item 4 marks cycle 6 escorts done, with carriers' fighters still to come.
  - `README.md`: an Escorts feature line.

**Interfaces:**
- Consumes: everything above. Use `window.__starwake` (`teleport`, `spawnHostile`, `disableTarget`, `combatState`, `controller.world`) to set up the scene. Use real keys and taps for the choices under test.

- [ ] **Step 1: Write the e2e tests.** Each one asserts no console errors.
  - **PC:**
    - teleport to `vanterre`, set credits to 50 000, open Hire escorts, hire a courier and leave;
    - after flying ahead for 3 s, the escort is within 2 × `followDistance` of the player;
    - `quietSky`, spawn a hostile, target it with Tab and press KeyI;
    - the HUD shows `Escorts: Attack.`, and the target's `aggro` gains the escort's id within 10 s.
  - **Phone (844×390, touch):**
    - spawn hostiles until `captureWillSucceed` is true for one, target and disable it, tap the context Board button, tap the capture and tap Keep as escort;
    - ORDER appears, and two taps make the order `hold`.
  - **PC jump and land:**
    - with a hired escort, plot a course to a neighbour and jump, as `tests/e2e/land-jump.spec.ts` does, and the escort is present there;
    - set its armor to half and land;
    - the planet screen's Repair all row shows `10 × missing armor` cr, and Repair takes exactly that from the credits.
  - **PC 1280×600:** with an escort present and a target, the sidebar `escorts` line reads `Escorts: 1 · Follow`, every box sits within 0–600, and no two boxes overlap. Reuse the law spec's checks.
- [ ] **Step 2: Run** `npx playwright test -c $PW_LOCAL tests/e2e/escorts.spec.ts --repeat-each 3`, then the full suite with `-c $PW_LOCAL`. Everything must be green.
- [ ] **Step 3: Update the docs:** the design notes and the README line.
- [ ] **Step 4: Run** `npm run typecheck && npx vitest run` and the full Playwright suite twice. Both must be green.
- [ ] **Step 5: Commit** `test(e2e): escorts end to end` and `docs: cycle 6 escorts`.
