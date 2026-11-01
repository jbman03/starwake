# Starwake — Cycle 6: Escorts (design)

Status: approved for spec · 2026-11-01

## 1. Goal

Let the pilot fly with a small group of escort ships, as in Escape Velocity: hire them at ports or
keep a ship you captured, give the group simple orders, and take them across the galaxy. It must
stay playable on PC and phone, keep old saves loading, and never break the live game. Carriers'
fighters, crew, wingmen and a nemesis are out of scope (§11).

## 2. Owner decisions (brainstorm)

| Question | Decision |
|---|---|
| Scope | Escorts only. |
| Getting escorts | Hire at ports with a shipyard (fee up front plus a daily wage), and keep a captured ship as an escort (no wage, pays its repairs). |
| Size and orders | Up to 3 escorts. Four orders for the whole group: Follow, Attack my target, Hold position, Return fire only. One key cycles the order on PC; on phones an order button in the existing rail. No new screens. |
| Lifecycle | Escorts jump with you (each uses its own fuel, refilled when you land), wait while you are landed, and are repaired when you land (cost on the planet screen). A destroyed escort is gone for good; a disabled one comes along when you are towed. |
| Law and money | An escort's hit on a lawful ship is your crime. Hired escorts draw a daily wage; one you can't pay leaves at the next port with a message. Escorts never carry cargo. |
| Approach | A: escorts are traffic NPCs with an `escort` role, plus a saved list on the world. |

## 3. Architecture

- **Data (`data/escorts.json`)**, Zod-validated (`EscortsSchema`) and loaded into `GameData.escorts`:
  - `maxEscorts` (3), `hireFeeMul` (0.1 × hull price), `wageMul` (0.005 × hull price per day),
    `repairPerArmor` (10 cr), `followDistance` (90 px), `hireable` (hull ids offered for hire:
    `courier`, `scout`, `kestrel`, `warden`), and `names` (a pool of escort names).
  - A port offers the hireable hulls whose tech tier is at most its own, only if it has a shipyard.
    The offer list is seeded per port and day (`world.seed | port | day`), up to 3 offers.
  - The cross-check in `src/data/load.ts` rejects unknown hull ids.
- **Sim (`src/sim/escorts.ts`)**, pure and seeded. Owns the saved list, hiring, wages, repair and
  orders, and turns the list into traffic NPCs on system entry.
- **Traffic and battle.** `NpcRole` gains `escort`. Escort NPCs are skipped by traffic's errands and
  spawning, and by raider and patrol targeting of friends: nothing in the player's group is hostile
  to the group. `stepBattle` drives them with `escortAi` (§5).
- **Save.** `WorldState.escorts: Escort[]` and `WorldState.escortOrder: EscortOrder`. Version 8.
- **UI.** Planet screen lists, a capture-card choice, an order action, a sidebar line, radar colour,
  a How to Play tab.

## 4. Data model

```ts
type EscortOrder = 'follow' | 'attack' | 'hold' | 'defend';   // defend = "Return fire only"
interface Escort {
  id: string;          // 'esc-<n>', stable for the escort's life
  name: string;
  shipId: string;
  outfits: Record<string, number>;
  armor: number;       // carried between systems; shields refill on entry
  fuel: number;        // jumps left
  hired: boolean;      // false for a kept capture
  wage: number;        // cr per day; 0 when not hired
}
```

`escortOrder` defaults to `follow`. Armor is stored as a number (max comes from the hull). Ammo in
`outfits` is kept, as for the player.

## 5. Behaviour

### 5.1 Getting and losing escorts

- **Hire.** Planet screen → "Hire escorts" (only where the port has a shipyard). Each offer shows
  name, hull, fee and wage. Hire is refused with a reason when the group is full (3) or the credits
  fall short of the fee. A hired escort starts with full armor, full fuel, the hull's default
  outfits, `hired: true` and `wage = round(price × wageMul)`.
- **Keep a capture.** After a successful capture the card offers Take command, Sell as prize, and
  **Keep as escort**. Keep is blocked with "Your group is full (3 escorts)" when full. The kept
  ship keeps its armor, outfits and fuel at 0 jumps until you land; `hired: false`, wage 0. It
  counts as a capture in stats, like the others.
- **Dismiss.** Planet screen → "Your escorts" → Dismiss (no refund). A kept capture can be sold as
  a prize there instead, at the existing prize value.
- **Destroyed.** Removed for good, with a message ("<name> is destroyed.").
- **Unpaid.** Wages are paid as days pass (each day, for each hired escort). If the credits fall
  short, that escort's wage is not paid and it is marked to leave; at the next landing it leaves
  with a planet-screen notice ("<name> leaves your service: unpaid wages."). Credits never go
  negative.

### 5.2 In flight

- **Entry.** On take-off, on arrival after a jump, and after a tow, each escort in the list that is
  with you becomes an NPC beside the player: placed on a small arc behind the ship, shields full,
  armor from the list.
- **Orders** (`escortAi`):
  - `follow`: keep station about `followDistance` behind the player; fire back at anything that
    attacked the player or the escort.
  - `attack`: as follow, but also attack the player's current target when it is a ship.
  - `hold`: stop where they are; fire back only at attackers in range.
  - `defend` (Return fire only): as follow, but never start a fight; fire only at ships that have
    attacked the player or the group.
- **Crimes.** Damage by an escort to a lawful ship goes through the same crime rules as the
  player's own (`hit`, `disable`, `destroy`), charged to the player. Kills by escorts do not credit
  bounty or combat jobs (they are not the player's kills), except that a bounty target disabled or
  destroyed by an escort still completes the bounty (the target is down either way).
- **Disabled escort.** Drifts and can't fight, like any disabled ship. It is not boardable by the
  player. When the player is towed, disabled escorts come along.
- **Leaving the system.** On jump, escorts with fuel ≥ 1 jump with the player and spend 1 fuel;
  one with 0 fuel stays behind and is marked "waiting" and rejoins at the player's next landing
  (wherever that is). When the player lands, all present escorts' armor and ammo are written back.

### 5.3 Landed

- Escorts refuel for free on landing (fuel to full).
- Repair: the planet screen's "Your escorts" list shows each escort's damage and a **Repair all**
  row costing `repairPerArmor × missing armor`. Pay is refused when short ("Not enough credits.");
  partial repair is not offered. Unrepaired escorts take off damaged.
- The order persists across landings and saves.

### 5.4 Controls

- **PC:** bindable action `escortOrder` (default **KeyI**, "Escort orders") cycles Follow → Attack
  → Hold → Return fire → Follow, with a HUD message "Escorts: <order>." Only in flight and only
  with at least one escort present.
- **Phone:** an `ORDER` button in the existing touch rail, shown only with escorts present; it
  cycles the same way. No new screens.
- **Sidebar:** one line, "Escorts: 2 · Follow", shown only with escorts. The sidebar must still fit
  1280×600.
- **Radar and view:** escorts are drawn in a friendly colour (distinct from neutral and hostile).

## 6. Save (v8)

- `CURRENT_SAVE_VERSION` 8; migration 7 → 8 adds `escorts: []` and `escortOrder: 'follow'`.
- Tolerant loading: a missing, null or non-array `escorts` loads as `[]`; entries that are not
  objects, or name an unknown hull, are dropped; numbers that are not finite become 0; armor is
  clamped to [0, hull max], fuel to [0, hull fuel], the list is cut to `maxEscorts`; an unknown
  order loads as `follow`.
- Old saves (v1–v7) chain to v8 and load with no escorts.

## 7. Error handling and edge cases

- A hull removed from data: its escorts are dropped on load (above).
- The group is never larger than `maxEscorts`, whatever the source.
- Escorts never block the player's landing, jump or tow, and are never targets of the player's
  auto-target cycling (`isTargetable` excludes them).
- An escort can't be hailed, scanned or boarded. Patrol scans look only at the player's hold.
- Story ships, raider demands and encounter sites are unchanged.

## 8. Testing

- **Unit:** schema and cross-check; hiring (fee, full group, short credits); keep a capture; dismiss;
  wages per day and leaving when unpaid; repair cost and refusal; spawn placement; each order's AI
  choice; jump with and without fuel; crime attribution for escort damage; bounty completion by an
  escort; v8 migration and tolerant loading.
- **E2E:** PC: hire at a port, take off, the escort follows; press the order key to Attack and it
  attacks the targeted ship. Phone: capture a ship and keep it as an escort; the ORDER button
  cycles. Jump and land: escorts arrive with you, the repair row appears and charges correctly.
  The sidebar fits 1280×600.
- **Process:** typecheck, Vitest and the full Playwright suite pass locally and in CI before the
  owner is asked to approve the merge and deploy.

## 9. Docs

How to Play gets an "Escorts" tab; README gets a line; design-notes roadmap marks cycle 6 escorts.

## 10. Decisions to review with the owner

Tunables chosen in the spec (all in `data/escorts.json`, easy to change):
hire fee 10% of hull price; wage 0.5% of hull price per day; repair 10 cr per armor point; hireable
hulls courier, scout, kestrel, warden; up to 3 offers per port per day; default order key I.

## 11. Out of scope

Carriers and fighters, crew, wingmen, a nemesis, per-escort orders, a fleet screen, escorts
carrying cargo, escort upgrades at the outfitter, and escort loyalty or morale.
