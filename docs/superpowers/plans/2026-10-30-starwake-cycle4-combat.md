# Cycle 4 — Combat and Boarding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** NPC ships that fight, flee and hunt; weapons from the outfitter; shields → armor → disabled →
destroyed; boarding with loot and capture; an escape pod or a reload on death; bounty and clear-the-lanes
missions; minimal standing loss. Playable on PC and phone.

**Architecture:** Combat lives beside traffic, transient and unsaved. There are four new pure sim
modules: `combat.ts` (hulls, weapons, projectiles), `ai.ts` (one decision per NPC), `battle.ts` (one
fight tick over the player and the traffic) and `boarding.ts`. Two more hold death and raider demands.
A new `src/app/combatControl.ts` owns the battle state for the controller, so `controller.ts` (1,153
lines) only delegates to it. Rendering, HUD, rails and cards follow the existing patterns.

**Tech Stack:** TypeScript 7, Phaser 4.2.1, Zod 4, Vitest 5 (happy-dom), Playwright 1.64.

**Spec:** `docs/superpowers/specs/2026-10-25-starwake-cycle4-combat-design.md`. Every task reads its spec
section(s), named in the task.

## Global Constraints

- Sim code in `src/sim` is pure and deterministic. All randomness goes through `mulberry32(hashString(world.seed, <salt>, ...))`. There is no `Math.random` and no `Date` in the sim. Steps run at a fixed 60 Hz (`dt = 1/60`).
- UI code in `src/ui` builds the DOM with `el()`/`button()` from `src/ui/dom.ts` and sets text through textContent only. It never uses innerHTML.
- Data lives in `data/*.json` and is validated by Zod in `src/data/schemas.ts`. Cross-references are checked in `src/data/load.ts`.
- All names and text are original. Write player-facing copy in plain, short sentences.
- On phones nothing new may be drawn inside the clear view rect except world sprites. Only the bottom-centre context button changes. Do not add rail buttons.
- Every new action is rebindable. Defaults: `cycleSecondary` = `KeyQ`, `board` = `KeyB` (flight group), `encounterChoice4` = `Digit4`, `encounterChoice5` = `Digit5`.
- Saves: `CURRENT_SAVE_VERSION` becomes 6. v1–v5 saves must still load.
- Commits end with the two attribution lines from the session (`Co-Authored-By: …` and `Claude-Session: …`). Never put a model name in code, comments or commit text.
- Work only on branch `claude/ecstatic-dirac-d2obvh`. Never push to `main`.
- After every task, `npm run typecheck` and `npx vitest run` must be green. Run the e2e suite (`npx playwright test`) at tasks 13 and 14.

## Review Focus

1. **Landing or jumping mid-fight.** Projectiles, beams and a pending boarding must clear on a jump or landing. A save taken right after a fight shows full hull. → Task 9 test `clears battle on jump and landing`.
2. **Data rule for ammo.** Ammo with no launcher can't be bought, and selling the last launcher must leave the ammo sellable. The outfitter must never block an ammo sale. → Task 1 test `ammo needs a launcher; ammo always sells`.
3. **A disabled ship that drifts off radar or out of the system** stays boardable while targetable. It must not be despawned by its errand timeout or a jump-out. → Task 5 test `disabled NPC never despawns by errand`.
4. **Old saves.** A v5 shuttle pilot with outfits already filling all 10 t of space still gets the starter gun: the migration must not leave the ship over capacity. → Task 2 test `migration skips the gun when space is full`.
5. **Two hails at once.** A raider demand while an encounter or story hail is pending must not overwrite it; the raider attacks instead. → Task 10 test `raider skips demand when a hail is pending`.

---

## File map

| File | Responsibility |
|---|---|
| `src/data/schemas.ts`, `data/*.json`, `src/data/load.ts` | weapon, ammo and pod outfits, `crew`, `loadout`, `raiders` government, `startOutfits`, the combat mission field (T1) |
| `src/sim/weapons.ts` (new) | `weaponsOf`, `launchersOf`, `ammoCap` — what a set of outfits can fire (T1) |
| `src/save/pilot.ts`, `src/sim/types.ts`, `src/sim/world.ts` | save v6, kills and captures, `Mission.combat`, start outfits, combat rating (T2) |
| `src/sim/combat.ts` (new) | hull state, damage, recharge, shots, projectiles, beams, aim (T3) |
| `src/sim/ai.ts` (new) | NPC decisions (T4) |
| `src/sim/traffic.ts` | roles, spawn rates, safe moments, hull and loadout on each NPC, disabled drift (T5) |
| `src/sim/battle.ts` (new) | one fight tick: player and NPC fire, hits, events, standing, kills (T6) |
| `src/sim/boarding.ts` (new) | loot, capture odds, take command, prize (T7) |
| `src/sim/death.ts` (new) | escape-pod rescue, rescue port (T8) |
| `src/sim/raiders.ts` (new) | demand terms and payment (T10) |
| `src/sim/combatMissions.ts` (new) | bounty and clear offers and progress (T12) |
| `src/app/combatControl.ts` (new) | owns `Battle`; boarding, demand and death flow; test hooks (T9, T10, T11) |
| `src/input/*`, `src/sim/context.ts`, `src/ui/rails.ts`, `src/ui/howToPlay.ts` | actions, bindings, context button, phone gestures (T9, T13) |
| `src/ui/boardingCard.ts`, `src/ui/destroyedCard.ts` (new) | the cards (T11) |
| `src/render/SpaceScene.ts`, `src/render/combatFx.ts` (new), `src/audio/sfx.ts` | shots, beams, explosions, sparks, sounds (T13) |
| `src/render/sidebarInfo.ts`, `src/render/hudInfo.ts`, `src/render/sidebar.ts`, `src/render/hud.ts` | hull bars, secondary and ammo, target bars (T13) |
| `tests/e2e/combat.spec.ts` (new) | desktop and phone e2e (T14) |

---

### Task 1: Combat data — weapons, ammo, pod, crew, raiders

**Spec:** §4, §5 (raiders government), §11 (the mission type field).

**Files:**
- Modify: `src/data/schemas.ts`, `src/data/load.ts`, `data/outfits.json`, `data/ships.json`, `data/governments.json`, `data/config.json`, `src/sim/shipStats.ts`, `src/sim/outfitter.ts`, `src/ui/icons.ts`, `src/ui/outfitter.ts`, `src/data/testData.ts`
- Create: `src/sim/weapons.ts`, `src/sim/weapons.test.ts`
- Test: `src/data/load.test.ts`, `src/sim/outfitter.test.ts`, `src/ui/icons.test.ts`

**Interfaces:**
- Produces, as new `OutfitSchema` members:
  - `gun` with `effect {damage, rate, speed, range, spread, assist}`;
  - `turret` with `effect {damage, rate, speed, range}`;
  - `launcher` with `effect {ammo: string, rate}`;
  - `ammo` with `effect {damage, speed, range, turnRate}`;
  - `beam` with `effect {dps, range}`;
  - `pod` with `effect {pods: 1}`.

  All are `.strict()`. `spread`, `assist` and `turnRate` are nonnegative (0 is allowed); the others
  are positive. Spread and assist are degrees, rate is shots per second, and turnRate is degrees per
  second (0 = unguided).
- Produces: `ShipSchema` gains `crew: z.number().int().positive()` (required) and `loadout: z.record(id, z.number().int().positive()).optional()`. `ConfigSchema` gains `startOutfits: z.record(id, z.number().int().positive())`. `MissionTypeSchema` gains `combat: z.object({ kind: z.enum(['bounty','clear']), count: range.optional() }).optional()`.
- Produces, in `src/sim/weapons.ts`:
  - `type GunDef = Extract<OutfitDef, {category:'gun'|'turret'}>`; `BeamDef`, `LauncherDef` and `AmmoDef` likewise;
  - `weaponsOf(outfits: Record<string, number>, data: GameData): { guns: {def: GunDef; count: number}[]; beams: {def: BeamDef; count: number}[]; launchers: {def: LauncherDef; count: number}[] }`, ordered by outfit id;
  - `ammoCap(outfits, ammoId, data): number`, which is the ammo's `max` × the number of launchers firing it;
  - `hasWeapon(outfits, data): boolean`;
  - `npcLoadout(def: ShipDef): Record<string, number>`, which returns `def.loadout`, or else `{'light-blaster': min(2, floor(crew/2))}` (omitted when that count is 0).

- [ ] **Step 1: Write failing tests.**
  - `load.test.ts`:
    - `parses every new outfit category` (one fixture per category, and a bad one per category, e.g. a gun with `damage: 0`, rejected);
    - `rejects a launcher whose ammo id is missing or not ammo`;
    - `rejects a ship loadout naming an unknown outfit`;
    - `rejects startOutfits naming an unknown outfit`;
    - `every ship has crew`.
  - `weapons.test.ts`:
    - `weaponsOf groups guns/turrets, beams and launchers`;
    - `ammoCap is max × launchers that fire it`;
    - `npcLoadout falls back to light blasters by crew`;
    - `hasWeapon`.
  - `outfitter.test.ts`:
    - `ammo needs a launcher; ammo always sells` (Review Focus 2): buying ammo with no launcher → blocked with a new `OutfitBlock` `'noLauncher'` ("Needs a launcher"); buying beyond `ammoCap` → `'max'`; selling a launcher while its ammo is aboard is allowed, and the ammo can still be sold;
    - `escape pod max 1`.
  - `icons.test.ts`: add the six new categories to `CATEGORIES`.
- [ ] **Step 2: Run** `npx vitest run src/data src/sim/weapons.test.ts src/sim/outfitter.test.ts src/ui/icons.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - Schemas and the load-time cross-checks (launcher → ammo outfit; loadout and startOutfits ids exist).
  - `shipStats` ignores the new categories: they add `space` only.
  - `outfitBuyCheck` uses `ammoCap` as the max for ammo and adds `'noLauncher'`.
  - One original glyph per new category in `icons.ts`.
  - The outfitter detail line per category in `src/ui/outfitter.ts`'s switch, for example "6 dmg · 4/s · range 450" or "Fires Rockets".
  - Data from the spec §4 table:
    - rocket `max` 20, seeker `max` 12, escape-pod `max` 1;
    - gun `max` 4, turret `max` 2, beam `max` 1, launchers `max` 2;
    - `lance-beam` `techTier` 5 with `soldAt` set to the tier-5 hub ports;
    - `light-blaster`: `speed 700, range 450, spread 0, assist 6`;
    - `rapid-cannon`: `speed 800, range 420, spread 3, assist 6`;
    - `heavy-blaster`: `speed 550, range 500, spread 0, assist 4`;
    - `pivot-turret`: `speed 650, range 400`;
    - rocket: `speed 500, range 700, turnRate 0`; seeker: `speed 420, range 900, turnRate 180`;
    - lance-beam: `dps 30, range 350`;
    - launcher rates: rocket-rack 1/s, seeker-launcher 0.7/s.
  - `crew` on every hull: shuttle 2, courier 3, scout 3, mule 6, kestrel 4, liner 12, ironback 10, warden 20, meridian 18, bastion 60, patience 4, lantern-tender 14, freewind 6.
  - Loadouts:
    - kestrel `{rapid-cannon:2, rocket-rack:1, rocket:8}`;
    - warden `{heavy-blaster:2, pivot-turret:1, seeker-launcher:1, seeker:6}`;
    - bastion `{heavy-blaster:2, pivot-turret:2}`;
    - meridian `{pivot-turret:2}`;
    - courier `{light-blaster:2}`.

    Each loadout must fit the hull's `outfitSpace` (a test checks this).
  - `governments.json`: `{ "id": "raiders", "name": "Rimward Raiders", "color": "#d94f4f", … }`.
  - `config.json`: `"startOutfits": {"light-blaster": 1}`.
  - Update `testData.ts` fixtures so existing tests compile.
- [ ] **Step 4: Add the data rule test** `every loadout fits its hull's outfit space` to `load.test.ts`, and run the full `npx vitest run` and `npm run typecheck`. Expected: all PASS.
- [ ] **Step 5: Commit** `feat(data): weapons, ammo, escape pod, crew and raiders`.

### Task 2: Save v6, start outfits and the combat rating

**Spec:** §4 (starter gun), §11 (`Mission.combat`), §13.

**Files:**
- Modify: `src/save/pilot.ts`, `src/sim/types.ts`, `src/sim/world.ts` (`newWorld`), `src/ui/mainMenu.ts` (`pilotCard`)
- Test: `src/save/pilot.test.ts`, `src/sim/world.test.ts`, `src/ui/pilotCard.test.ts`

**Interfaces:**
- Produces:
  - `WorldState.stats: { jobsDone: number; kills: number; captures: number }`;
  - `Mission.combat?: { kind: 'bounty' | 'clear'; systemId: string; shipId?: string; targetName?: string; needed: number; done: number }`;
  - `CURRENT_SAVE_VERSION = 6`;
  - `combatRating(stats: {kills: number; captures: number}): string` in `src/sim/rating.ts` (new). It computes the score `kills + 2×captures` and maps 0 → "Harmless", ≥1 "Green", ≥10 "Steady", ≥30 "Veteran", ≥75 "Ace", ≥150 "Legend".
- `PilotCard` gains `rating: string`.

- [ ] **Step 1: Write failing tests.**
  - `pilot.test.ts`:
    - `v5 → v6 fills kills and captures 0`;
    - `v5 shuttle pilot with no weapon gets a light blaster`;
    - `migration skips the gun when space is full` (Review Focus 4): shuttle with `cargo-pod: 2` (10 t of 10) → no blaster;
    - `v1 save loads to v6`;
    - `round-trips Mission.combat`.

    The migration stays data-free: it hard-codes the shuttle's 10 t space and the outfit space
    table for the starter-era outfits (`cargo-pod` 5, `fuel-tank` 3, `salvage-tank` 6, `frontier-rack`
    5, `local-chart` 0), and treats any other outfit as "space unknown → skip the gun".
  - `world.test.ts`: `newWorld fits config.startOutfits`.
  - `rating.test.ts`: the boundaries 0, 1, 9, 10, 29, 30, 74, 75, 149, 150, captures counted double.
  - `pilotCard.test.ts`: `shows combat rating`.
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3: Implement** the migration `5: (s) => …`, the schema fields, `newWorld` outfits from `config.startOutfits`, `combatRating`, and the pilot card line (e.g. "Rating: Green").
- [ ] **Step 4: Run** `npx vitest run` and `npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(save): v6 with kills, captures, starter gun and combat rating`.

### Task 3: Combat core — hulls, shots, projectiles, beams

**Spec:** §4 (aim assist, turrets, homing, ammo), §7.

**Files:**
- Create: `src/sim/combat.ts`, `src/sim/combat.test.ts`

**Interfaces:**
- Consumes: `weaponsOf`, `GunDef`, `BeamDef`, `LauncherDef`, `AmmoDef` (Task 1); `Vec2` helpers; `wrap` and `turnToward` from `flight.ts`.
- Produces:

```ts
export const DISABLE_FRACTION = 0.1;
export const SHIELD_REGEN_PER_SEC = 0.05; // of max
export const SHIELD_REGEN_DELAY = 2;      // s after the last hit
export const DISABLED_STOP_SEC = 8;       // drift slows to rest over this
export const LOW_ARMOR_FRACTION = 0.25;
export const PLAYER_ID = 'player';

export interface Hull { shields: number; armor: number; maxShields: number; maxArmor: number; disabled: boolean; lastHitSec: number }
export interface Combatant { id: string; government: string; ship: ShipState; radius: number; hull: Hull; outfits: Record<string, number> }
export type ShotKind = 'bolt' | 'rocket' | 'seeker';
export interface Projectile { id: number; ownerId: string; targetId: string | null; kind: ShotKind; pos: Vec2; vel: Vec2; damage: number; ttl: number; turnRate: number }
export interface BeamShot { ownerId: string; from: Vec2; to: Vec2; hitId: string | null }
export interface DamageResult { hull: Hull; shieldHit: boolean; disabledNow: boolean; destroyed: boolean }

export function fullHull(maxShields: number, maxArmor: number): Hull;
export function applyDamage(h: Hull, dmg: number, nowSec: number): DamageResult;
export function rechargeHull(h: Hull, dt: number, nowSec: number): Hull;
export function driftShip(ship: ShipState, dt: number): ShipState;   // disabled: no input, velocity decays to 0 over DISABLED_STOP_SEC
export function leadPoint(from: Vec2, shotSpeed: number, target: { pos: Vec2; vel: Vec2 }): Vec2;
export function gunHeading(shooter: ShipState, target: Combatant | null, gun: GunDef, r: () => number): number; // heading, plus assist bend inside the cone, plus spread
export function turretHeading(shooter: ShipState, target: Combatant | null, gun: GunDef): number | null; // null = no target in range: don't fire
export function stepProjectile(p: Projectile, target: Combatant | undefined, dt: number): Projectile; // homing turns at turnRate toward target.pos
export function hitTest(p: Projectile, c: Combatant): boolean;      // segment-free: dist(p.pos, c.ship.pos) <= c.radius
export function beamTrace(from: Vec2, heading: number, range: number, candidates: Combatant[]): { to: Vec2; hitId: string | null }; // nearest circle hit along the ray
```

Rules: damage goes to shields first, and only the overflow reaches armor.
- `disabledNow` is true when the armor first drops below `DISABLE_FRACTION × maxArmor`.
- `destroyed` is true when a hull that was already disabled before this hit reaches armor ≤ 0. A
  single hit on a healthy ship that would take armor to 0 leaves it disabled at armor 0, EV-style:
  the ship disables, and the next hit destroys it.
- Recharge does nothing while disabled, or until `nowSec - lastHitSec >= SHIELD_REGEN_DELAY`.

- [ ] **Step 1: Write failing tests** in `combat.test.ts`:
  - `damage hits shields then overflows to armor` (shields 10, armor 50, dmg 15 → 0/45, shieldHit true);
  - `disables below 10% armor` (armor 100 → 9 disables);
  - `a big hit on a healthy ship disables at armor 0, never destroys`;
  - `damage to a disabled ship to 0 destroys`;
  - `no recharge within 2 s of a hit; 5%/s after`;
  - `no recharge while disabled`;
  - `driftShip stops in about 8 s`;
  - `gun assist bends inside 6° and not outside`;
  - `spread stays within ±spread`;
  - `turret aims at the lead point; null out of range`;
  - `seeker turns toward its target at turnRate; rocket flies straight`;
  - `projectile ttl = range / speed`;
  - `beamTrace hits the nearest circle only, within range`.
- [ ] **Step 2: Run** `npx vitest run src/sim/combat.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `src/sim/combat.ts` (pure, no imports from traffic or the controller).
- [ ] **Step 4: Run** it. Expected: PASS. Then the full suite and the typecheck.
- [ ] **Step 5: Commit** `feat(sim): combat core — hulls, shots, projectiles, beams`.

### Task 4: NPC AI

**Spec:** §5 (behaviour per role, flee at 30%, keeping range, orbiting).

**Files:**
- Create: `src/sim/ai.ts`, `src/sim/ai.test.ts`

**Interfaces:**
- Consumes: `Combatant`, `leadPoint` (Task 3); `autopilotInput` from `assists.ts`; `faceInput`.
- Produces:

```ts
export type NpcRole = 'trader' | 'patrol' | 'raider';
export const FLEE_FRACTION = 0.3;
export const ENGAGE_RANGE = 900;   // raiders and patrols pick a fight within this
export const KEEP_RANGE = 220;     // attackers hold about this far off
export type AiMode = 'errand' | 'attack' | 'flee';
export interface AiSelf { role: NpcRole; me: Combatant; peaceful: boolean; aggro: readonly string[]; maxSpeed: number; fireRange: number }
export interface AiDecision { mode: AiMode; targetId: string | null; input: FlightInput; fire: boolean; fleeTo: Vec2 | null }
export function isHostileTo(self: AiSelf, other: Combatant, angry: readonly string[]): boolean;
export function decide(self: AiSelf, others: readonly Combatant[], angry: readonly string[], fleeTo: Vec2, data: GameData): AiDecision;
```

Hostility:
- A raider (not peaceful) is hostile to any non-raider.
- A patrol is hostile to raiders, and to the player when its government is in `angry`.
- Any NPC is hostile to the ids in its `aggro`.
- A trader is hostile only to its `aggro`.

Decisions:
- Below `FLEE_FRACTION` armor, a raider or trader flees, with `fleeTo` set.
- A trader whose `aggro` is non-empty and that has no weapons flees.
- With a hostile within `ENGAGE_RANGE`, the NPC attacks the nearest one:
  - it steers to face the lead point;
  - it thrusts when farther than `KEEP_RANGE`;
  - it orbits by turning ±60° from the line at closer range (the side chosen from the id hash);
  - `fire` is true when the target is within `fireRange` and within 10° of the heading.
- Otherwise the mode is `errand`, and its input is ignored by the caller.

- [ ] **Step 1: Write failing tests**:
  - `raider attacks the player in range`;
  - `raider ignores other raiders`;
  - `peaceful raider does not attack`;
  - `patrol attacks raiders, not the player unless angry`;
  - `trader stays on errand until hit, then flees if unarmed`;
  - `armed trader fires back at its attacker`;
  - `flees below 30% armor`;
  - `fires only when lined up and in range`;
  - `holds range instead of ramming` (no thrust inside `KEEP_RANGE`).
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3: Implement** `ai.ts`.
- [ ] **Step 4: Run** it, then the full suite. Expected: PASS.
- [ ] **Step 5: Commit** `feat(sim): NPC combat AI`.

### Task 5: Traffic gains roles, hulls and safe spawning

**Spec:** §5 (roles by system class, safe moments, caps), §7 (disabled drift).

**Files:**
- Modify: `src/sim/traffic.ts`, `src/sim/traffic.test.ts`, `src/app/controller.ts` (only the new `seedTraffic`/`stepTraffic` options parameter)

**Interfaces:**
- Consumes: `NpcRole` (Task 4), `Hull`, `fullHull` and `driftShip` (Task 3), `npcLoadout` (Task 1).
- Produces:
  - `Npc` gains:
    - `role: NpcRole`;
    - `hull: Hull`;
    - `outfits: Record<string, number>` (its loadout, with ammo counts that go down as it fires);
    - `aggro: string[]`;
    - `engaged: boolean`;
    - `peaceful: boolean`;
    - `demand: boolean` (a raider that will hail first);
    - `missionId?: string` (a bounty target).
  - `TrafficOpts = { maxNpcs: number; guideActive: boolean; startSystem: string; clearBoost?: string }`. `clearBoost` is the system id where an active clear job raises the raider chance to 60%.
  - `seedTraffic(world, data, opts: TrafficOpts)` and `stepTraffic(t, world, data, dt, opts: TrafficOpts)` replace the `maxNpcs` number argument.
  - `raiderChance(data, systemId, opts): number` returns:
    - 0 when `guideActive` or `systemId === opts.startSystem`;
    - 0.6 when `clearBoost === systemId`;
    - otherwise 0.05 for Concord, 0.2 for Free Reach, 0.3 for independent, 0.4 for unlit, and 0.4 for any
      system whose ports are all tier ≤ 1.
  - `patrolChance(data, systemId)` = 0.15 in `concord` or `free-reach` systems, else 0.
  - `addBountyNpc(t, spec: {id; name; shipId; missionId; pos: Vec2}): Traffic` adds a raider that is never peaceful and never makes a demand.
- Spawning:
  - The role is drawn from the same seeded `r` after the existing draws (the existing order of
    draws is kept so today's trader tests stay stable).
  - A raider's hull is drawn from the pool: shuttle 3, courier 3, scout 2, kestrel 3, warden 1
    (filtered by tier as now).
  - A raider's `government` is `'raiders'`. A patrol's government is the system's own, and its hull
    is kestrel or warden.
  - `demand` = `r() < 0.5` for raiders.
  - At most 3 non-peaceful raiders at once: a spawn that would exceed this becomes a trader.
- `stepNpc` does not move an NPC that is `engaged` or `hull.disabled`, because battle moves it. A
  disabled NPC never reaches `land`/`jumpOut`/`gone` by its errand, and its timeout does not apply.
- `isTargetable` is unchanged; disabled ships stay in phase `fly`.

- [ ] **Step 1: Write failing tests**:
  - `raider chance by system class` (one system of each class from the real data);
  - `no raiders while the guide runs or in the start system`;
  - `clear job raises the raider chance to 60%`;
  - `patrols only in Concord and Free Reach space`;
  - `at most 3 hostile raiders`;
  - `NPCs spawn with full hull and their loadout`;
  - `disabled NPC never despawns by errand` (Review Focus 3): disable one, step 200 s, it is still present;
  - `engaged NPC is not moved by traffic`;
  - `same seed, same roles` (determinism).

  Update the existing tests to the `TrafficOpts` signature.
- [ ] **Step 2: Run** `npx vitest run src/sim/traffic.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** In the controller, build opts in `maxNpcs()`'s place with `{ maxNpcs: this.maxNpcs(), guideActive: (this.guide?.current() ?? null) !== null, startSystem: this.data.config.startSystemId, clearBoost }`, where `clearBoost` is `undefined` until Task 12.
- [ ] **Step 4: Run** the full suite and the typecheck. Expected: PASS.
- [ ] **Step 5: Commit** `feat(sim): traffic roles, hulls and safe spawning`.

### Task 6: Battle tick

**Spec:** §3 (`stepBattle`), §4 (primary, secondary, cycling, ammo), §7 (kills), §9.

**Files:**
- Create: `src/sim/battle.ts`, `src/sim/battle.test.ts`

**Interfaces:**
- Consumes: Tasks 3–5; `worldStats`; `standingOf` and `STANDING_RANK` from `standing.ts`.
- Produces:

```ts
export interface Battle {
  systemId: string;
  player: Hull;
  projectiles: Projectile[];
  beams: BeamShot[];                 // this tick's beams, for drawing
  cooldowns: Record<string, number>; // `${ownerId}:${outfitId}` -> seconds until the next shot
  secondary: string | null;          // the selected launcher outfit id
  angry: string[];                   // governments hostile to the player this visit
  nextShotId: number;
}
export type BattleEvent =
  | { type: 'shot'; ownerId: string; kind: ShotKind | 'beam' }
  | { type: 'hit'; targetId: string; shield: boolean; pos: Vec2 }
  | { type: 'disabled'; id: string; byPlayer: boolean }
  | { type: 'destroyed'; id: string; byPlayer: boolean; pos: Vec2 }
  | { type: 'playerDisabled' }
  | { type: 'playerDestroyed'; pos: Vec2 }
  | { type: 'lowArmor' }
  | { type: 'angered'; government: string }
  | { type: 'fled'; id: string };
export function newBattle(world: WorldState, data: GameData): Battle; // full hull from worldStats; secondary = first launcher with ammo, or null
export function cycleSecondary(b: Battle, world: WorldState, data: GameData): Battle;
export function playerTargetId(traffic: Traffic): string | null; // traffic.targetId
export function nearestHostile(world: WorldState, traffic: Traffic, b: Battle): string | null; // nearest targetable NPC hostile to the player
export function stepBattle(b: Battle, world: WorldState, traffic: Traffic, input: FrameInput, data: GameData, dt: number):
  { battle: Battle; traffic: Traffic; world: WorldState; events: BattleEvent[] };
```

What `stepBattle` does, in order:
1. Recharge every hull.
2. Player fire. While not disabled and not jumping:
   - `firePrimary` held fires every gun, turret and beam whose cooldown is ≤ 0. The cooldown resets
     to `1/rate` per mount. With count n, a gun fires n bolts from slightly offset points
     (±radius/2 across the nose).
   - `fireSecondary` held fires the selected launcher if `world.outfits[ammo] > 0`, decrementing it
     (and removing the key at 0, keeping the saved-outfit invariant).
   - `cycleSecondary` pressed calls `cycleSecondary`.
   - The `r` for spread comes from `mulberry32(hashString(world.seed, 'spread', b.nextShotId))`.
3. NPC decisions through `decide`:
   - `attack`: set `engaged`, step its ship with `stepShip` and the decision input, and fire as the
     player does, spending `npc.outfits` ammo;
   - `flee`: set `engaged` false, `errand` `'pass'` and `portId` null, so traffic flies it out (emit
     `fled` once);
   - `errand`: set `engaged` false.
   - A disabled NPC calls `driftShip`.
4. Move projectiles and hit-test them against every combatant except their owner. Beams trace
   instantly, at `dps × dt` per tick.
5. Damage. Each damaged NPC adds the owner to its `aggro`. When the owner is the player and the
   NPC is not a raider:
   - if its government is not already in `angry`, add it, drop standing one level (floored at
     `cool`), and emit `angered`;
   - a patrol that becomes `disabledNow` or `destroyed` by the player sets standing to `cool`.
6. Events.
   - When the player's shot causes `disabledNow`, `stats.kills` += 1, and a later `destroyed`
     doesn't add another. Track this through an NPC field `killCounted: boolean` added to `Npc` in
     this task.
   - Remove destroyed NPCs from traffic, and drop the target if it was one.
   - The player's own hull follows the same rules. `playerDisabled` and `playerDestroyed` fire once.
   - `lowArmor` fires once each time armor drops below 25%.

- [ ] **Step 1: Write failing tests** (build a world and traffic by hand with the real data):
  - `primary fires every gun on cooldown`;
  - `secondary spends ammo and stops at 0`;
  - `cycleSecondary skips empty launchers`;
  - `player bolt disables a raider and counts one kill`;
  - `destroying a disabled raider does not count again`;
  - `hitting a Concord trader angers the Concord once per visit and drops standing one level`;
  - `disabling a patrol sets standing cool`;
  - `raiders cost no standing`;
  - `NPC fire damages the player; playerDisabled then playerDestroyed`;
  - `disabled player cannot fire`;
  - `nearestHostile picks the closest hostile only`;
  - `stepBattle is deterministic` (two runs of 600 ticks, deep-equal).
- [ ] **Step 2: Run** `npx vitest run src/sim/battle.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `battle.ts`.
- [ ] **Step 4: Run** the full suite and the typecheck. Expected: PASS.
- [ ] **Step 5: Commit** `feat(sim): battle tick — fire, hits, kills and standing`.

### Task 7: Boarding and capture rules

**Spec:** §8, §9 (capturing a trader or patrol angers its government).

**Files:**
- Create: `src/sim/boarding.ts`, `src/sim/boarding.test.ts`

**Interfaces:**
- Consumes: `Npc` (Task 5), `ammoCap` and `weaponsOf` (Task 1), `tradeInValue` and `shipStats`, `cargoFree` and `berthsFree`.
- Produces:

```ts
export const BOARD_RANGE = 60;
export const BOARD_MAX_SPEED = 40;  // relative speed
export interface Loot { credits: number; cargo: Record<string, number>; ammo: Record<string, number> }
export function canBoard(world: WorldState, npc: Npc): boolean;     // disabled, within range, slow relative to it
export function lootOf(world: WorldState, data: GameData, npc: Npc): Loot; // seeded by (seed, 'loot', npc.id): credits 2–8% of hull price rounded to 10; traders 30–100% of hull cargo in 1–2 goods; ammo = npc.outfits ammo
export function captureOdds(world: WorldState, data: GameData, npc: Npc): number; // clamp(0.05, 0.85, 0.5 × myCrew / theirCrew), rounded to 0.01
export function captureSucceeds(world: WorldState, data: GameData, npc: Npc): boolean; // mulberry32(hashString(seed,'capture',npc.id))() < odds
export function takeCredits(world: WorldState, loot: Loot): { world: WorldState; loot: Loot; text: string };
export function takeCargo(world: WorldState, data: GameData, loot: Loot): { world: WorldState; loot: Loot; text: string }; // up to cargoFree, highest-value goods first
export function takeAmmo(world: WorldState, data: GameData, loot: Loot): { world: WorldState; loot: Loot; text: string }; // only ammo my launchers fire, up to ammoCap
export type CommandCheck = { ok: true } | { ok: false; reason: 'cargo' | 'berths' | 'space' };
export const COMMAND_BLOCK_TEXT: Record<'cargo' | 'berths' | 'space', string>;
export function canTakeCommand(world: WorldState, data: GameData, npc: Npc): CommandCheck;
export function takeCommand(world: WorldState, data: GameData, npc: Npc): WorldState;
export function prizeValue(data: GameData, npc: Npc): number;   // round to 10 of 0.3 × hull price
export function sellPrize(world: WorldState, data: GameData, npc: Npc): WorldState;
```

`takeCommand` works like this:
- `credits += tradeInValue(world)`;
- `shipId = npc.shipId`, and `outfits` = the NPC's outfits;
- cargo and missions stay;
- `shipName` = `npc.name`;
- fuel = min(the current fuel, her capacity);
- `stats.captures += 1`;
- the `'bought:'` flag is not set.

`sellPrize` adds `prizeValue` to credits and `stats.captures += 1`. The caller removes the NPC and
applies standing (Task 9). The hull damage to "25% armor, empty shields" is applied by the caller
on the battle state.

- [ ] **Step 1: Write failing tests**:
  - `canBoard needs disabled, 60 px and slow`;
  - `loot is seeded and stable`;
  - `capture odds: shuttle vs mule = 0.17; warden vs kestrel = 0.85; floor 0.05`;
  - `takeCargo caps at free space, best goods first`;
  - `takeAmmo only for owned launchers, capped`;
  - `takeCommand credits trade-in, swaps hull and outfits, keeps cargo, counts a capture`;
  - `canTakeCommand blocks when cargo or berths would not fit`;
  - `prize is 30% of hull price`.
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3: Implement** `boarding.ts`.
- [ ] **Step 4: Run** the full suite and the typecheck. Expected: PASS.
- [ ] **Step 5: Commit** `feat(sim): boarding loot and capture rules`.

### Task 8: Escape pod and rescue

**Spec:** §10.

**Files:**
- Create: `src/sim/death.ts`, `src/sim/death.test.ts`

**Interfaces:**
- Consumes: `standingOf`, `abandonStory` / the `onLate:'retry'` handling in `storyMissions.ts` (reuse the function that returns a late retry mission to its giver; if it isn't exported, export it as `returnToGiver(world, data, id)`), and `jobMissions`.
- Produces:

```ts
export const POD_ID = 'escape-pod';
export function hasPod(world: WorldState): boolean;
export function rescuePort(world: WorldState, data: GameData): string; // nearest port by hops (then distance) whose government standing is not 'cool'; else config.startPlanetId
export function podRescue(world: WorldState, data: GameData): { world: WorldState; planetId: string; messages: string[] };
```

`podRescue`:
- moves the pilot to the rescue port's system, docked;
- `shipId = config.startShipId`, outfits = `config.startOutfits`, cargo emptied, fuel full;
- job missions with `tons > 0 || passengers > 0` are removed, with a message per failed job;
- story missions whose current step is `deliver` or `ferry` go back to the giver (retry);
- the story's hold entries (`STORY_TYPE`) are removed;
- credits, flags, story, standing, notes and stats are kept;
- `shipName` resets to `''`.

- [ ] **Step 1: Write failing tests**:
  - `rescuePort skips cool governments`;
  - `rescuePort falls back to the start planet`;
  - `podRescue keeps credits and story, drops ship, cargo and outfits, uses the pod`;
  - `cargo and passenger jobs fail; a dump job paid up front also fails`;
  - `a story deliver step goes back to its giver`.
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3: Implement** `death.ts`.
- [ ] **Step 4: Run** the full suite and the typecheck. Expected: PASS.
- [ ] **Step 5: Commit** `feat(sim): escape pod rescue`.

### Task 9: Wire combat into flight — CombatControl, actions and context

**Spec:** §3 (controller), §8 (when Board is offered), §10 (Call a tow), §12 (actions and context priority).

**Files:**
- Create: `src/app/combatControl.ts`, `src/app/combatControl.test.ts`
- Modify: `src/app/controller.ts`, `src/input/actions.ts`, `src/input/bindings.ts`, `src/sim/context.ts`, `src/app/testHook.ts`, `src/ui/howToPlay.ts` (drop `COMING_SOON` entries and add the new actions)
- Test: `src/sim/context.test.ts`, `src/input/bindings.test.ts`, `src/app/controller.test.ts`, `src/save/settings.test.ts`

**Interfaces:**
- Consumes: Tasks 5–7.
- Produces:
  - Actions `cycleSecondary` ('flight', "Cycle secondary", `KeyQ`), `board` ('flight', "Board", `KeyB`), `encounterChoice4` and `encounterChoice5` ('menus', `Digit4`/`Digit5`). Saved settings merge in the new defaults (test).
  - `ContextAction` gains `'board'` and `'callTow'`. `contextAction(world, data, pending, flyToSite, combat?: { board: boolean; disabledCalm: boolean; disabled: boolean })`:
    - `board` outranks everything except `takeControl`;
    - a disabled player gets `'callTow'` when `disabledCalm`, else `null`;
    - nothing else is offered while disabled.
  - `class CombatControl` in `src/app/combatControl.ts`:

```ts
constructor(data: GameData)
battle: Battle
reset(world: WorldState): void                 // newBattle; on arrival, landing and load
tick(world, traffic, input: FrameInput, dt): { world; traffic; events: BattleEvent[] }
boardable(world, traffic): Npc | null          // the targeted (else nearest) NPC canBoard accepts
disabledCalmSec: number                        // time with no hostile within 1500 px while disabled
playerDisabled(): boolean
```

- Controller changes:
  - It owns `combat: CombatControl`.
  - In `update()`, after `stepWorld`, it calls `combat.tick`. While the player is disabled, the
    player's flight input is emptied before `stepWorld` (no thrust or turn).
  - `nearestHostile` pressed → `traffic.targetId = nearestHostile(...)`, clearing the planet and
    site targets.
  - `board` pressed, or the context button on `'board'` → open boarding (Task 11 adds the card;
    until then it emits `{type:'board'}` as a new `ControllerEvent`).
  - Battle events map to the new sfx ids and messages: `angered` → "The {Short} will remember
    that." using `governmentShortName`.
  - `combat.reset(world)` runs on arrival, landing, take-off and `beginSession`.
  - `callTow` reuses the existing `callTow()`/`applyTow` path. `towDestination` today only offers a tow when the pilot is out of fuel, so give it an option `{ disabled: true }` that offers the nearest port whatever the fuel, and test it in `rules.test.ts`.
- Test hooks, in `testHook.ts`:
  - `combatState(): { player: Hull; secondary: string | null; npcs: { id: string; role: string; hull: Hull; hostile: boolean }[] }`;
  - `spawnHostile(shipId?: string): string`, which adds an engaged raider 400 px ahead and returns its id;
  - `disableTarget(): boolean`, which sets the targeted NPC's armor to 1 and disables it.

- [ ] **Step 1: Write failing tests**:
  - `context.test.ts`: `board outranks land and hail`; `disabled player: callTow when calm, nothing otherwise`.
  - `bindings.test.ts`: `new combat defaults do not clash in the flight group`.
  - `settings.test.ts`: `old saved bindings gain cycleSecondary and board`.
  - `combatControl.test.ts`:
    - `firing fills projectiles`;
    - `clears battle on jump and landing` (Review Focus 1): a projectile in flight, then `reset` → none, with full hull;
    - `disabled player input is ignored`;
    - `boardable needs a disabled NPC in reach`.
  - `controller.test.ts`: `R targets the nearest hostile`; `Q cycles the secondary`.
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3: Implement** as above.
- [ ] **Step 4: Run** the full suite and the typecheck. Expected: PASS. Run the e2e suites that touch hotkeys and context (`npx playwright test hotkeys touch flight`). Expected: PASS.
- [ ] **Step 5: Commit** `feat(app): combat in flight — actions, context and CombatControl`.

### Task 10: Raider demands

**Spec:** §6.

**Files:**
- Create: `src/sim/raiders.ts`, `src/sim/raiders.test.ts`
- Modify: `src/app/combatControl.ts`, `src/app/controller.ts` (`PendingEncounter` gains a demand variant), `src/ui/encounterCard.ts` (shows it through the same `EncounterView`)

**Interfaces:**
- Produces:

```ts
export const DEMAND_LAPSE_SEC = 15;
export interface DemandTerms { credits: number; cargo: { good: string; tons: number } | null } // credits = round10(max(300, 5% of credits)); cargo = the {n=10} t worth most, or all if less
export function demandTerms(world: WorldState, data: GameData): DemandTerms;
export function payCredits(world: WorldState, t: DemandTerms): WorldState | null; // null if short of credits
export function dumpCargo(world: WorldState, t: DemandTerms): WorldState | null;
```

- `PendingEncounter` gains `| { kind: 'demand'; npcId: string; npcName: string; terms: DemandTerms; expiresSec: number }`.
- `hailName` and `contextAction` treat it as a hail ("Answer hail"). The HUD banner reads "*Name* (raider) hails you".
- The card's choices are "Pay {c} cr", "Dump {n} t of {good}" (blocked with "Hold is empty" when there is no cargo) and "Refuse".
- Pay or dump sets `npc.peaceful = true` and sends the NPC fleeing (it leaves the system).
- Refusing, lapsing after 15 s, or leaving the system turns `demand` false. The NPC is engaged at once.
- A raider with `demand` that arrives while any pending exists (encounter, story hail or another
  demand) gets `demand = false` and just attacks.
- Before its demand resolves, a demanding raider is `peaceful` for AI purposes.

- [ ] **Step 1: Write failing tests**:
  - `raiders.test.ts`: `terms: 5% of credits, at least 300, rounded to 10`; `dump picks the most valuable 10 t`; `pay refuses when short`.
  - `combatControl.test.ts`:
    - `demand hail resolves to peace on pay`;
    - `refuse or 15 s lapse → attack`;
    - `raider skips demand when a hail is pending` (Review Focus 5).
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the full suite and the typecheck. Expected: PASS.
- [ ] **Step 5: Commit** `feat: raider demands`.

### Task 11: Boarding and Destroyed cards

**Spec:** §8 (the card, one capture try, a scuttle on failure, the after-capture card), §10 (death flow).

**Files:**
- Create: `src/ui/boardingCard.ts`, `src/ui/boardingCard.test.ts`, `src/ui/destroyedCard.ts`, `src/ui/destroyedCard.test.ts`
- Modify: `src/app/combatControl.ts`, `src/app/controller.ts`, `src/ui/ui.ts` or wherever controller events open cards (follow how `{type:'encounter'}` opens `showEncounterCard`), `src/ui/mainMenu.ts` (export the continue-pilot routine for reuse)

**Interfaces:**
- Consumes: Tasks 7 and 8.
- Controller API:

```ts
boardingView(): BoardingView | null
boardChoose(choice: 'credits' | 'cargo' | 'ammo' | 'capture' | 'command' | 'prize' | 'leave'): string[] | null
deathView(): { pod: boolean } | null
continueAfterDeath(): Promise<void>   // pod: podRescue, then landAt(planetId) with autosave; no pod: reload the last save of this pilot through store.load, else main menu
export interface BoardingView { shipLabel: string; stage: 'loot' | 'captured'; rows: { id: 'credits' | 'cargo' | 'ammo' | 'capture'; label: string; blocked: string | null; used: boolean }[]; commandBlocked: string | null; prize: number }
```

- `ControllerEvent` gains `{type:'board'}` (opens the boarding card) and `{type:'destroyed'}`. The destroyed event fires 2 s of sim time after `playerDestroyed`; flight keeps running so the explosion plays.
- **The boarding card:**
  - it pauses flight, like the encounter card;
  - hotkeys `encounterChoice1`–`encounterChoice5` cover the rows plus Leave (`back` also leaves);
  - labels: "Take credits ({n} cr)", "Take cargo ({t} t)", "Take ammo ({n})", "Attempt capture ({p}%)";
  - a used row shows as done;
  - a failed capture shows "The crew drives your party off." Closing it scuttles the ship: it is destroyed 3 s later and the player takes no damage.
  - a success switches to stage `'captured'`, with "Take command" (disabled with the `COMMAND_BLOCK_TEXT` reason) and "Sell as prize ({n} cr)".
  - Take command sets the battle's player hull to 25% armor and 0 shields, and removes the NPC.
  - Capturing a non-raider applies §9 (angered, and patrol → cool).
- **The destroyed card:** "Your ship is destroyed." With a pod it adds "Your escape pod got you clear." and a button "Wake up". Without one it adds "Your ship is lost." and a button "Load last save". Both call `continueAfterDeath`.

- [ ] **Step 1: Write failing tests** (happy-dom, following `encounterCard.test.ts` / `ui.test.ts`):
  - `boarding card lists loot rows with hotkeys`;
  - `take cargo then leave resumes flight`;
  - `capture success shows command and prize`;
  - `command blocked shows its reason`;
  - `failed capture scuttles the ship after 3 s`;
  - `destroyed card with pod wakes at the rescue port with autosave`;
  - `destroyed card without pod reloads the last save`;
  - `no save → main menu`.
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the full suite and the typecheck. Expected: PASS.
- [ ] **Step 5: Commit** `feat(ui): boarding and destroyed cards`.

### Task 12: Bounty and clear-the-lanes missions

**Spec:** §11.

**Files:**
- Create: `src/sim/combatMissions.ts`, `src/sim/combatMissions.test.ts`
- Modify: `data/missionTypes.json`, `src/sim/missions.ts` (offers, completion), `src/app/combatControl.ts` (spawn the bounty, count kills), `src/app/controller.ts` (`clearBoost`), `src/ui/missionText.ts` / `src/ui/missionLog.ts` / the map preview (destination = target system until done)
- Test: `src/sim/missions.test.ts`, `src/data/balance.test.ts`

**Interfaces:**
- Data:
  - `{ "id": "bounty", "combat": {"kind": "bounty"}, "hops": [1, 3], "tons": [0,0], "passengers": [0,0], "deadline": {"perHop": 3, "plus": 2}, "basePay": 2500, "perHop": 800, … }`, with pay scaled by the hull factor `price / 35000` (minimum 1);
  - `{ "id": "clear", "combat": {"kind": "clear", "count": [2, 4]}, "hops": [1, 3], "deadline": {"perHop": 3, "plus": 4}, "basePay": 3000, "perHop": 700, … }` plus 1,500 per raider.
  - The templates are original text using `{system}`, `{target}`, `{count}`, `{pay}` and `{days}`.
- Produces:

```ts
export function combatOffersOk(world: WorldState, data: GameData, portId: string): boolean; // port's government is concord or free-reach, and hasWeapon(world.outfits)
export function buildCombatOffer(world, data, type: MissionTypeDef, portId: string, systemId: string, hops: number, r: () => number, offerId: string): MissionOffer;
// destId = portId (origin: return to collect); combat = { kind, systemId, needed, done: 0, shipId?, targetName? }
export function combatTargetSystem(m: Mission): string | null; // systemId while done < needed, else null
export function recordKill(world: WorldState, systemId: string, npc: { role: string; missionId?: string }): WorldState; // bounty: matching missionId; clear: role raider in its system
export function bountyToSpawn(world: WorldState, systemId: string): Mission[];   // bounty missions not done whose systemId matches
```

- `completeAt` pays a combat mission only when `done >= needed`. Otherwise it stays active.
- `offersAt` adds combat offers (seeded, as for other types) when `combatOffersOk`. The target
  systems are drawn from systems within the hop range that are not Concord core.
- The bounty raider's hull is chosen by the hull weight pool from Task 5, at least courier tier, and
  it spawns 700–1,200 px from the arrival point.

- [ ] **Step 1: Write failing tests**:
  - `combat offers only in Concord/Free Reach ports and only when armed`;
  - `bounty: spawn on arrival, disable counts, pays on return`;
  - `clear: counts raiders in its system only, pays at needed`;
  - `incomplete combat job is not paid on landing`;
  - `deadline fails it like other jobs`;
  - `controller passes clearBoost for an active clear job`.

  Balance: `bounty pays between rush and shipment medians` and `clear pays above the shipment median`.
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the full suite and the typecheck. Expected: PASS.
- [ ] **Step 5: Commit** `feat: bounty and clear-the-lanes missions`.

### Task 13: See and hear the fight — render, sounds, HUD, sidebar, phone rails

**Spec:** §3 (rendering, sound), §12 (display, phone gestures).

**Files:**
- Create: `src/render/combatFx.ts` (pure helpers: particle seeds, bar fractions, colours) and `src/render/combatFx.test.ts`
- Modify: `src/render/SpaceScene.ts`, `src/render/sprites.ts` (a bolt, missile and spark texture), `src/audio/sfx.ts`, `src/render/sidebarInfo.ts`, `src/render/sidebar.ts`, `src/render/hudInfo.ts`, `src/render/hud.ts`, `src/ui/rails.ts`, `src/ui/rails.css`, `src/app/testHook.ts`
- Test: `src/render/sidebarInfo.test.ts`, `src/render/hudInfo.test.ts`, `src/ui/rails.test.ts`, `src/audio/sfx.test.ts`

**Interfaces:**
- `Sfx` gains `'shot' | 'missile' | 'beam' | 'shieldHit' | 'armorHit' | 'explosion' | 'disabled' | 'alarm'`. The beam sound loops while beam events keep arriving, and stops 0.1 s after they end.
- `SidebarInfo` gains:
  - `hull: { shields: number; armor: number }` (fractions 0–1);
  - `secondary: string | null` (e.g. "Seeker Missile ×6", or "None");
  - `targetHull: { shields: number; armor: number; disabled: boolean } | null`.

  `sidebarInfo(…, battle: Battle | null = null)` takes them.
- `HudInfo` gains the same `hull` (the phone rail HUD shows two thin bars).
- `rails.ts`:
  - holding `target` ≥ 500 ms presses `nearestHostile` instead of `nextTarget` (a tap under 500 ms still presses `nextTarget` on release);
  - a small label under MSL (`data-control="secondary"`) shows the short weapon name and ammo, and tapping it presses `cycleSecondary`;
  - the label sits inside the rail's existing box, not the clear view (a rails test asserts its rect is outside `layout.clear`).
- `SpaceScene`:
  - draws projectiles (bolts as short lines, rockets and seekers with a 6-point trail), beams as lines
    for one frame, shield-hit rings, an explosion burst (24 particles, 8 in low quality), sparks on
    disabled ships, and a small two-bar hull gauge under the targeted ship;
  - every new object goes through `addWorldObject`;
  - test hooks: `projectiles?: () => number` and `targetBars?: () => {shields:number; armor:number} | null`.

- [ ] **Step 1: Write failing tests**:
  - `sidebarInfo shows hull, secondary with ammo, target hull`;
  - `hudInfo hull fractions`;
  - `rails: long-press TGT presses nearestHostile; tap presses nextTarget`;
  - `rails: secondary label cycles and sits outside the clear view`;
  - `sfx: new sounds synthesise without throwing (mocked AudioContext)`;
  - `combatFx: low quality uses fewer particles`.
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the full suite and the typecheck, then `npx playwright test` (the full existing e2e suite, to catch layout regressions). Expected: PASS.
- [ ] **Step 5: Commit** `feat(render): combat effects, sounds, hull HUD and phone gestures`.

### Task 14: E2E, docs and the whole-branch check

**Spec:** §14, §15.

**Files:**
- Create: `tests/e2e/combat.spec.ts`
- Modify: `tests/e2e/helpers.ts` (any combat helper), `docs/design-notes.md` (a cycle 4 "Built" entry in the expansion list), `src/ui/howToPlay.ts` (a short "Combat and boarding" section: what disables means, how to board, the pod), `README.md` if it lists features

- [ ] **Step 1: Write the e2e specs** (desktop 1280×800 and phone 844×390, using the test hooks):
  - `desktop: R targets a hostile, Space fires until disabled, B boards, take cargo, capture, take command`. Assert: `combatState` shows the hull falling; the boarding card is visible; after take command, `world().shipId` equals the NPC's hull.
  - `phone: hold TGT targets hostile, FIRE disables, context button reads Board, card opens`. Assert: no new element rect intersects `data-clear` except the context button.
  - `death with pod wakes at a port; without pod reloads the last save`.
  - `raider demand: Y answers, pay, raider leaves`.
  - `bounty: accept, fly, disable, return, paid` (teleport and test hooks keep it short).
  - `rebind fire to KeyZ and it fires`.
- [ ] **Step 2: Run** `npx playwright test tests/e2e/combat.spec.ts`. Expected: PASS after fixing what it finds.
- [ ] **Step 3: Run everything:** `npm run typecheck && npx vitest run && npx playwright test`. Expected: all green. Record the counts.
- [ ] **Step 4: Update the docs** (the design-notes cycle 4 entry and how-to-play), and commit `docs: cycle 4 combat and boarding`.
- [ ] **Step 5: Push** the branch with `git push -u origin claude/ecstatic-dirac-d2obvh`. Do not merge, and do not push to `main`.
