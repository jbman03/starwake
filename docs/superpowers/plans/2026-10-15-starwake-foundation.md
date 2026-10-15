# Starwake Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A playable, installable Starwake foundation: EV-style momentum flight in two linked star systems with landing, refueling, jumping, autopilot, tow rescue, pilot saves, rebindable PC hotkeys and phone side-rail touch controls, deployed to GitHub Pages.

**Architecture:** Game rules live in `src/sim` as pure TypeScript functions stepped at a fixed 60 Hz and unit-tested with Vitest. Phaser (`src/render`) only draws sim state. Input from keyboard and touch is converted to named actions (`src/input`). Menus and the planet screen are plain HTML/CSS overlays (`src/ui`). Content is JSON in `data/`, validated with Zod.

**Tech Stack:** TypeScript (strict), Phaser (latest stable, version pinned in package.json), Vite, Vitest, Playwright, Zod, idb-keyval, fake-indexeddb (tests), vite-plugin-pwa, GitHub Actions + GitHub Pages.

**Spec:** `docs/superpowers/specs/2026-10-15-starwake-foundation-design.md`

## Global Constraints

- All content is original. No EV names, text, sprites or sounds. Third-party assets only with commercial-use licenses, each recorded in `CREDITS.md`.
- License: "All rights reserved" (`LICENSE` file); public repo for hosting only.
- `src/sim` must not import Phaser, DOM, or anything from `src/render`/`src/ui`.
- Fixed timestep 1/60 s. All sim units: pixels, seconds, radians internally (data files use degrees for `turnRate`).
- Default movement keys are arrow keys only. Each action holds at most two keys. Esc cannot be unbound from `pause`.
- Fuel: 100 units per jump. HUD shows "Fuel: N jumps"; amber at 1, red at 0.
- Context button is the only touch control allowed inside the clear game-view region.
- Never auto-reload the app mid-flight for an update.
- Settings are per device (localStorage); pilots are in IndexedDB.

## Review Focus

1. **Backgrounded tab / long frame** (phone locks, tab hidden for minutes) → the fixed stepper must clamp elapsed time so the ship does not teleport or run thousands of ticks. Test in Task 3.
2. **Phone rotates or window resizes mid-flight** → rails and clear region recompute; nothing overlaps; sim keeps running. Test in Task 11.
3. **Storage unavailable or corrupted** (private browsing throws, garbage in localStorage) → settings fall back to defaults instead of crashing. Test in Task 7.
4. **Double-press / spam of J or L** during a jump or autopilot landing → actions are idempotent; one jump, one fuel charge, one landing. Test in Task 5.
5. **Negative credits (after a tow) then Refuel** → buys 0 units and says why, never makes credits more negative. Test in Task 5.

---

## File Structure

```
index.html                     App shell: #game canvas host, #ui overlay root
LICENSE, CREDITS.md
vite.config.ts                 Vite + PWA + base path for GitHub Pages
playwright.config.ts
.github/workflows/deploy.yml
data/ships.json  data/systems.json  data/planets.json
src/main.ts                    Boot: load data, settings, show main menu, start Phaser
src/data/schemas.ts            Zod schemas + inferred types
src/data/load.ts               loadGameData(): validates, formats errors
src/sim/vec.ts                 Vec2 helpers
src/sim/types.ts               ShipState, WorldState, FlightInput, SimEvent
src/sim/flight.ts              stepShip, turnToward
src/sim/assists.ts             autoStopInput, faceInput, autopilotInput
src/sim/rules.ts               canLand, pickLandTarget, canJump, refuelQuote, towDestination
src/sim/world.ts               newWorld, stepWorld (orchestrates actions → state + events)
src/sim/context.ts             contextAction()
src/sim/stepper.ts             FixedStepper
src/input/actions.ts           ActionId, groups, ActionSet
src/input/bindings.ts          defaults, rebind, conflicts, reset
src/input/keyboard.ts          KeyboardSource → ActionSet
src/input/touch.ts             TouchSource (joystick, buttons) → ActionSet + stick
src/input/mode.ts              input-mode detection (touch vs keyboard)
src/save/pilot.ts              Pilot types, migrations, validate
src/save/store.ts              IndexedDB pilot store with backup
src/save/transfer.ts           export/import .starwake.json
src/save/settings.ts           Settings load/save (localStorage) with defaults
src/render/game.ts             Phaser.Game config + scene registry
src/render/SpaceScene.ts       starfield, planets, ship, camera, tap-to-select
src/render/sprites.ts          procedural placeholder textures (36-frame ship, planets)
src/render/hud.ts              HUD text/bars (desktop), shared with rails
src/ui/dom.ts                  tiny el()/show()/hide() helpers
src/ui/mainMenu.ts  src/ui/planetScreen.ts  src/ui/pauseMenu.ts
src/ui/settingsScreen.ts  src/ui/hotkeyEditor.ts  src/ui/mapPlaceholder.ts
src/ui/rails.ts                phone side rails layout + context button
src/ui/overlays.ts             crash screen, data error, rotate, update prompt
src/app/controller.ts          glue: stepper ↔ world ↔ input ↔ scene ↔ ui ↔ save
src/app/testHook.ts            window.__starwake (dev/test only)
tests/e2e/*.spec.ts            Playwright
src/**/*.test.ts               Vitest, next to the code
```

---

### Task 1: Project scaffold

**Files:**
- Create: `package.json`, `tsconfig.json`, `vite.config.ts`, `vitest.config.ts` (or `test` block in vite config), `playwright.config.ts`, `index.html`, `src/main.ts`, `LICENSE`, `CREDITS.md`, `src/sim/vec.ts`, `src/sim/vec.test.ts`
- Modify: `.gitignore` (add `playwright-report/`, `test-results/`)

**Interfaces:**
- Produces: npm scripts `dev`, `build`, `preview`, `test` (vitest run), `test:e2e` (playwright), `typecheck` (tsc --noEmit). `Vec2 = { x: number; y: number }` and `add, sub, scale, len, norm, fromAngle(rad), angleOf(v), dist` in `src/sim/vec.ts`.

- [ ] **Step 1:** `npm init -y`; install `phaser zod idb-keyval`; dev: `typescript vite vitest @playwright/test fake-indexeddb vite-plugin-pwa`. Run `npx playwright install chromium`.
- [ ] **Step 2:** tsconfig `strict: true`, `target ES2022`, `moduleResolution: bundler`, `resolveJsonModule: true`. Vite `base: './'`. `index.html` has `<div id="game"></div><div id="ui"></div>`, viewport meta `width=device-width, initial-scale=1, viewport-fit=cover`, `<title>Starwake</title>`. `src/main.ts` temporarily renders "Starwake" text.
- [ ] **Step 3: Write failing tests** `vec.test.ts`: `fromAngle(0)` ≈ `{x:1,y:0}`; `len({x:3,y:4}) === 5`; `norm({x:0,y:0})` returns `{x:0,y:0}` (no NaN); `angleOf(fromAngle(1.2))` ≈ 1.2.
- [ ] **Step 4:** Run `npm test` → FAIL (module missing). Implement `vec.ts`. Run → PASS.
- [ ] **Step 5:** `LICENSE`: "Copyright (c) 2026 jbman. All rights reserved." `CREDITS.md`: heading + "No third-party assets yet."
- [ ] **Step 6:** Verify `npm run build` and `npm run typecheck` succeed.
- [ ] **Step 7: Commit** `chore: scaffold Vite + TypeScript + Phaser project`

---

### Task 2: Game data and validation

**Files:**
- Create: `src/data/schemas.ts`, `src/data/load.ts`, `src/data/load.test.ts`, `data/ships.json`, `data/systems.json`, `data/planets.json`, `data/config.json`

**Interfaces:**
- Produces:
  - `ShipDef { id: string; name: string; turnRate: number /*deg/s*/; acceleration: number; maxSpeed: number; fuelCapacity: number; radius: number }`
  - `SystemDef { id; name; mapPos: Vec2; jumpDistance: number; links: string[]; starRadius: number }`
  - `PlanetDef { id; name; systemId; pos: Vec2; radius: number; techTier: 1|2|3|4|5; fuelPrice?: number; description: string; kind: 'planet'|'station' }`
  - `GameData { ships: Record<string,ShipDef>; systems: Record<string,SystemDef>; planets: Record<string,PlanetDef>; config: GameConfig }`
  - `GameConfig { startSystemId; startPlanetId; startShipId; startCredits: number; towFee: number; landingSpeed: number; landingMargin: number; arrivalRadius: number; fuelPerJump: number }` stored in `data/config.json`
  - `parseGameData(raw: {ships:unknown; systems:unknown; planets:unknown; config:unknown}): GameData` — throws `DataError` with `.file` and `.issues: string[]` formatted `"ships.json → shuttle.maxSpeed: expected number"`.
  - `loadGameData(): Promise<GameData>` (imports the JSON files).
- Content values:
  - Ship `shuttle`: turnRate 180, acceleration 150, maxSpeed 300, fuelCapacity 300, radius 14.
  - Systems: `calder` (home, mapPos 0,0, jumpDistance 2000, links [vesk]); `vesk` (frontier, mapPos 300,-120, jumpDistance 1800, links [calder]).
  - Planets in calder: `halcyon` (tier 3, fuelPrice 2), `merrow` (tier 2, fuelPrice 2), `brigg-station` (station, tier 1, fuelPrice 3). In vesk: `tallow-rock` (tier 1, no fuel), `vesk-outpost` (station, tier 1, no fuel). Positions within 300–1400 px of center, original one-to-two-sentence descriptions.
  - Config: start calder/halcyon/shuttle, startCredits 10000, towFee 500, landingSpeed 60, landingMargin 40, arrivalRadius 30, fuelPerJump 100.

- [ ] **Step 1: Write failing tests:** `shipped data passes validation`; `planet referencing unknown systemId fails with "planets.json → <id>.systemId"`; `link to unknown system fails`; `string maxSpeed fails with "ships.json → shuttle.maxSpeed: expected number"`; `config start planet must be in start system`.
- [ ] **Step 2:** Run → FAIL. Implement schemas + cross-reference checks in `parseGameData`. Run → PASS.
- [ ] **Step 3: Commit** `feat: game data schemas, loader and starter content`

---

### Task 3: Flight physics and fixed stepper

**Files:**
- Create: `src/sim/types.ts`, `src/sim/flight.ts`, `src/sim/flight.test.ts`, `src/sim/stepper.ts`, `src/sim/stepper.test.ts`

**Interfaces:**
- Produces:
  - `ShipState { pos: Vec2; vel: Vec2; heading: number /*rad, 0 = +x*/; fuel: number }`
  - `FlightInput { thrust: boolean; turn: -1 | 0 | 1; targetHeading?: number }` — if `targetHeading` is set, it overrides `turn` and the ship turns toward it at turnRate.
  - `stepShip(ship: ShipState, def: ShipDef, input: FlightInput, dt: number): ShipState` (pure, returns new object).
  - `turnToward(heading: number, target: number, maxDelta: number): number` (shortest way, no overshoot).
  - `class FixedStepper { constructor(step = 1/60, maxFrame = 0.25); advance(elapsedSec: number, tick: (dt:number)=>void): number /*alpha for interpolation*/ }`

- [ ] **Step 1: Write failing tests (flight):** thrust for 1 s from rest at heading 0 gives vel.x ≈ 150; thrusting 10 s gives speed exactly 300 (clamped); no input keeps velocity unchanged and moves pos by vel·dt (drift); turn +1 for 0.5 s changes heading by π/2 (180°/s); `turnToward(0, 3, 0.1) === 0.1`, `turnToward(0.05, 0, 0.1) === 0` (no overshoot), crosses the ±π seam the short way.
- [ ] **Step 2: Write failing tests (stepper):** `advance(1/30)` calls tick twice; `advance(0.01)` then `advance(0.01)` calls tick once total and returns alpha in [0,1); **`advance(600)` (tab hidden 10 min) calls tick at most 15 times** (0.25 s clamp).
- [ ] **Step 3:** Run → FAIL. Implement. Run → PASS.
- [ ] **Step 4: Commit** `feat: momentum flight model and fixed-step loop`

---

### Task 4: Assists (reverse, auto-stop, face target, autopilot)

**Files:**
- Create: `src/sim/assists.ts`, `src/sim/assists.test.ts`

**Interfaces:**
- Consumes: `stepShip`, `turnToward`, `ShipState`, `ShipDef`, `FlightInput`.
- Produces:
  - `reverseInput(ship): FlightInput` — targetHeading = angle of −vel (or current heading if stopped), thrust false.
  - `autoStopInput(ship, def): { input: FlightInput; done: boolean }` — done when speed < 1 (caller then zeroes vel).
  - `faceInput(ship, targetPos: Vec2): FlightInput`
  - `autopilotInput(ship, def, dest: Vec2, arrivalRadius: number, arriveSpeed: number): { input: FlightInput; arrived: boolean }`
- Autopilot algorithm (steering, not phases):
  ```
  toDest = dest - pos; d = len(toDest)
  if d < arrivalRadius and speed < arriveSpeed: arrived
  vDesired = norm(toDest) * min(maxSpeed, sqrt(2 * accel * max(d - arrivalRadius*0.5, 0)) * 0.9)
  dv = vDesired - vel
  targetHeading = angleOf(dv); thrust = len(dv) > 5 and |angleDiff(heading, targetHeading)| < 10°
  ```

- [ ] **Step 1: Write failing tests:** auto-stop from 300 px/s at an arbitrary heading reaches speed < 1 within 6 s of simulated ticks; reverse turns heading to opposite of velocity within 1.1 s; **autopilot arrives** (stopped within 30 px) from each of: rest 1500 px away; moving 300 px/s directly away; moving 300 px/s perpendicular — each within 30 s simulated; face target ends pointing at target ±1°.
- [ ] **Step 2:** Run → FAIL. Implement. Run → PASS.
- [ ] **Step 3: Commit** `feat: flight assists and autopilot steering`

---

### Task 5: World rules and world step

**Files:**
- Create: `src/sim/rules.ts`, `src/sim/rules.test.ts`, `src/sim/world.ts`, `src/sim/world.test.ts`, `src/sim/context.ts`, `src/sim/context.test.ts`
- Modify: `src/sim/types.ts`

**Interfaces:**
- Consumes: Tasks 2–4.
- Produces (types):
  - `Assist = { kind:'none' } | { kind:'reverse' } | { kind:'autoStop' } | { kind:'face' } | { kind:'autopilot'; dest: {type:'planet'; id:string} | {type:'jumpPoint'}; autoLand: boolean }`
  - `WorldState { systemId; ship: ShipState; shipId; credits: number; targetPlanetId: string|null; assist: Assist; jump: { toSystemId: string; t: number } | null; timeSec: number }`
  - `SimEvent = {type:'landed'; planetId} | {type:'jumped'; toSystemId} | {type:'message'; text} | {type:'towed'; planetId}`
  - `FrameInput { actions: ReadonlySet<ActionId>; pressed: ReadonlySet<ActionId>; stick?: { angle: number; magnitude: number; mode: 'point'|'classic' } }` — `actions` = held, `pressed` = went down this tick.
- Produces (functions):
  - `canLand(world, data, planetId): boolean` — distance ≤ radius + landingMargin and speed ≤ landingSpeed.
  - `pickLandTarget(world, data, cycle: boolean): string | null` — selected planet if set and not cycling, else nearest; cycling picks next by distance.
  - `canJump(world, data): { ok: true } | { ok:false; reason:'tooClose'|'noFuel'|'jumping' }`
  - `jumpPoint(world, data): Vec2` — point at jumpDistance+50 from center toward destination system's mapPos.
  - `refuelQuote(fuel, def, planet, credits): { units: number; cost: number; reason?: 'full'|'noFuelSold'|'noCredits' }` — partial if short; 0 units when credits ≤ 0.
  - `towDestination(world, data): string | null` — null unless fuel < fuelPerJump and no planet in current system sells fuel; BFS over links, nearest fuel-selling planet to that system's center.
  - `newWorld(data): WorldState` — start system, ship parked at the start planet's edge with vel 0, full fuel, startCredits (the controller shows the start planet's screen before flight begins).
  - `interruptAutopilot(world): WorldState` — sets assist to none; exported now so combat (sub-project 4) can call it when the player is attacked.
  - `stepWorld(world, data, input: FrameInput, dt, opts: { autoLandOnArrival: boolean }): { world: WorldState; events: SimEvent[] }`
  - `applyRefuel(world, data, planetId): { world; quote }`, `applyTow(world, data): { world; events }`, `departFrom(world, data, planetId): WorldState` (ship placed at planet edge, vel 0).
  - `contextAction(world, data): 'takeControl'|'tow'|'land'|'jump'|null` — priority in that order; `land` when any planet within 600 px; `jump` when canJump ok.
- `stepWorld` rules:
  - Manual flight actions (thrust/turn/reverse key/stick) cancel any assist except when the action *is* that assist.
  - `land` pressed: if `canLand(target)` → event landed; else assist autopilot to target with `autoLand: true`. Pressed again while that landing autopilot is active → `pickLandTarget(..., cycle=true)` retargets to the next nearest planet.
  - `stepWorld` takes `opts: { autoLandOnArrival: boolean }` (from settings); `autopilot` to a planet uses it for `autoLand`.
  - Autopilot arrival with autoLand → landed event; arrival at jumpPoint → assist none.
  - `jump` pressed: if `canJump` ok → `jump = {toSystemId, t:0}`, fuel −= fuelPerJump; after 1.0 s → system switches, ship placed at destination edge (jumpDistance from center, opposite side from origin's mapPos) facing center with speed 100, event jumped. If not ok → message (`"Too close to the star to jump. Press G to autopilot out."`, `"Not enough fuel to jump."`). While `jump` is non-null, all actions are ignored.
  - `autopilot` pressed: destination = targeted planet if any, else jumpPoint. Pressed again while active → cancel.
  - `nextTarget` cycles planets by distance. `faceTarget` sets face assist. `autoStop` sets autoStop. `firePrimary`, `fireSecondary`, `nearestHostile` are accepted and ignored.

- [ ] **Step 1: Write failing tests (rules):** canLand at exactly radius+40 & 60 px/s → true; +1 px or 61 px/s → false; refuel at fuel 100/300, price 2, credits 10000 → 200 units, 400 cost; credits 150 → 75 units; **credits −300 → 0 units, reason 'noCredits'**; planet without fuelPrice → reason 'noFuelSold'; towDestination in vesk with fuel 0 → a calder planet; in calder with fuel 0 → null; canJump at 1999 px in calder → tooClose; fuel 99 → noFuel.
- [ ] **Step 2: Write failing tests (world):** pressing `land` far from planet engages autopilot and eventually emits exactly one landed event; pressing `land` again during that autopilot retargets to a different planet; `autopilot` to a planet with `autoLandOnArrival: false` arrives stopped and emits no landed event; **pressing `jump` on 30 consecutive ticks costs fuel once and emits one jumped event**; after jump systemId is `vesk` and ship is ~jumpDistance from center; thrust input cancels autopilot; `contextAction` returns 'takeControl' while autopilot active, 'tow' when stranded, 'land' near halcyon.
- [ ] **Step 3:** Run → FAIL. Implement. Run → PASS.
- [ ] **Step 4: Commit** `feat: landing, jumping, fuel, tow and world step`

---

### Task 6: Actions, bindings and keyboard input

**Files:**
- Create: `src/input/actions.ts`, `src/input/bindings.ts`, `src/input/bindings.test.ts`, `src/input/keyboard.ts`, `src/input/keyboard.test.ts`

**Interfaces:**
- Produces:
  - `ActionId` union: flight `thrust turnLeft turnRight reverse autoStop firePrimary fireSecondary nextTarget nearestHostile faceTarget land jump autopilot map pause`; planet `refuel leave`; menus `back`.
  - `ACTION_GROUP: Record<ActionId, 'flight'|'planet'|'menus'>`, `ACTION_LABEL: Record<ActionId, string>`.
  - `Bindings = Record<ActionId, [string|null, string|null]>` using `KeyboardEvent.code` values.
  - `DEFAULT_BINDINGS` — flight: ArrowUp, ArrowLeft, ArrowRight, ArrowDown, KeyX, Space, ShiftLeft (second slot ShiftRight), Tab, KeyR, KeyF, KeyL, KeyJ, KeyG, KeyM, Escape; planet: refuel KeyR, leave [KeyL, Escape]; menus: back Escape.
  - `findConflict(b, action, code): ActionId | null` (same group only), `rebind(b, action, slot: 0|1, code): Bindings` (throws for pause/back losing Escape), `swapBinding(b, action, slot, code): Bindings`, `resetBindings(): Bindings`.
  - `class KeyboardSource { constructor(target: EventTarget, getBindings: () => Bindings); poll(group): { actions: Set<ActionId>; pressed: Set<ActionId> }; dispose() }` — `preventDefault` on bound keys (Tab, Space, arrows).

- [ ] **Step 1: Write failing tests:** every ActionId has a default with ≥1 key; no conflicts within any group in defaults; R is allowed in both flight and planet; binding J to `land` reports conflict `jump`; swap moves J to land and land's old key to jump; **unbinding Escape from pause throws**; reset returns defaults; KeyboardSource with a synthetic `keydown ArrowUp` reports `thrust` held and pressed on first poll, held but not pressed on second.
- [ ] **Step 2:** Run → FAIL. Implement. Run → PASS.
- [ ] **Step 3: Commit** `feat: action-based input with rebindable hotkeys`

---

### Task 7: Pilots, saves and settings

**Files:**
- Create: `src/save/pilot.ts`, `src/save/pilot.test.ts`, `src/save/store.ts`, `src/save/store.test.ts`, `src/save/transfer.ts`, `src/save/transfer.test.ts`, `src/save/settings.ts`, `src/save/settings.test.ts`

**Interfaces:**
- Produces:
  - `CURRENT_SAVE_VERSION = 1`; `PilotSave { version: 1; id: string; name: string; credits; shipId; fuel; systemId; planetId: string; gameTimeSec; savedAt: string /*ISO*/ }` (saves only happen landed, so planetId is required).
  - `migrations: Record<number, (s: any) => any>` (empty for v1, structure ready); `upgradeSave(raw: unknown): PilotSave` throws `SaveError('futureVersion'|'invalid')`.
  - `pilotFromWorld(world, planetId, meta:{id,name}): PilotSave`, `worldFromPilot(p, data): WorldState`.
  - `PilotStore` (idb-keyval, key `pilot:<id>`, value `{ current: PilotSave; backup?: PilotSave }`): `list(): Promise<{id,name,savedAt}[]>`, `save(p)` (moves old current to backup), `load(id): Promise<{ pilot: PilotSave; usedBackup: boolean }>` (falls back to backup if current fails `upgradeSave`; throws if both fail), `rename(id, name)`, `remove(id)`.
  - `exportPilot(p): Blob` (`application/json`, filename `<name>.starwake.json`), `importPilot(text: string): PilotSave` (validates, assigns a new id).
  - `Settings { bindings: Bindings; touch: { mirror: boolean; buttonSize: 'S'|'M'|'L'; opacity: number /*0.3–1*/; steering: 'point'|'classic'; vibration: boolean }; volume: number; quality: 'low'|'high'; autoLandOnArrival: boolean /*default true*/ }`; `loadSettings(): Settings`, `saveSettings(s)`, `DEFAULT_SETTINGS`.

- [ ] **Step 1: Write failing tests** (use `import 'fake-indexeddb/auto'`): save/load round-trip; second save keeps first as backup; corrupting `current` makes `load` return backup with `usedBackup: true`; `version: 99` → `futureVersion` error; import of `{}` → `invalid`, import of exported file → same fields with new id; **`loadSettings` when localStorage contains `"{garbage"` returns defaults; when `localStorage.getItem` throws returns defaults; `saveSettings` swallowing a throwing `setItem`**; settings missing new keys get defaults merged in.
- [ ] **Step 2:** Run → FAIL. Implement. Run → PASS.
- [ ] **Step 3: Commit** `feat: pilot saves with backup, versioning, import/export and settings`

---

### Task 8: Flight scene (desktop playable)

**Files:**
- Create: `src/render/game.ts`, `src/render/SpaceScene.ts`, `src/render/sprites.ts`, `src/render/hud.ts`, `src/app/controller.ts`, `src/app/testHook.ts`, `tests/e2e/flight.spec.ts`
- Modify: `src/main.ts`

**Interfaces:**
- Consumes: everything in `src/sim`, `KeyboardSource`, `loadSettings`.
- Produces:
  - `createGame(parent: HTMLElement, controller: Controller): Phaser.Game` — `Scale.RESIZE`, black background.
  - `SpaceScene` reads `controller.view()` each frame: `{ world: WorldState; prevShip: ShipState; alpha: number; data: GameData }` and interpolates ship position.
  - `makeShipTextures(scene, def)` — generates 36 frames (10° steps) of a shaded placeholder hull (canvas gradient, darker edges, cockpit highlight, engine glow) into one texture; frame index = `Math.round(heading / (Math.PI/18)) mod 36`. `makePlanetTexture(scene, planet)` — radial-gradient lit sphere, light from top-left. Stations: shaded disc with ring.
  - `Controller` class: owns `FixedStepper`, current `WorldState`, input sources, and an event bus `on(type, fn)` for `landed|jumped|message|towed|contextChanged`. Methods: `startFlight()`, `pauseFlight()`, `view()`, `currentContext()`, `doContextAction()`, `selectPlanet(id)`.
  - `testHook`: when `import.meta.env.DEV` or URL has `?test`, sets `window.__starwake = { world: () => controller.world, data, controller }`.
  - HUD (desktop): top-left shields/armor bars (static 100% placeholders), "Fuel: N jumps" with amber/red rule, system name, target name and distance; bottom-center message line for `message` events (fades after 3 s).
- Starfield: 3 parallax layers; `quality: 'low'` uses one layer.

- [ ] **Step 1: Write failing e2e test** `flight.spec.ts`: load `/?test` (in this task `main.ts` boots straight into flight from `newWorld`; menus arrive in Task 9 and this test then gains a "new pilot → Leave" prelude); hold ArrowUp 1 s → `world().ship` speed > 100; release, wait 0.5 s → speed unchanged within 1% (drift); no console errors during the run.
- [ ] **Step 2:** Run `npm run test:e2e` → FAIL. Implement scene, sprites, HUD, controller, hook. `main.ts` starts flight directly at the start planet for now. Run → PASS.
- [ ] **Step 3:** Manually run `npm run dev` and check the ship rotates through smooth-looking 36-frame steps and the camera stays centered.
- [ ] **Step 4: Commit** `feat: playable flight scene with placeholder EV-style sprites`

---

### Task 9: Menus, planet screen, landing/jump flow and autosave

**Files:**
- Create: `src/ui/dom.ts`, `src/ui/styles.css`, `src/ui/mainMenu.ts`, `src/ui/planetScreen.ts`, `src/ui/pauseMenu.ts`, `src/ui/mapPlaceholder.ts`, `tests/e2e/land-jump.spec.ts`
- Modify: `src/app/controller.ts`, `src/main.ts`

**Interfaces:**
- Consumes: Controller events, `PilotStore`, `applyRefuel`, `applyTow`, `departFrom`, `exportPilot`, `importPilot`.
- Produces:
  - `showMainMenu(ctx)`: list pilots (name, saved time), New Pilot (name prompt in-page), Load, Rename, Delete (confirm dialog), Import file. Load with `usedBackup` shows "Your last save was damaged; loaded the previous one."
  - `showPlanetScreen(ctx, planetId)`: planet image (from `makePlanetTexture` canvas snapshot), name, kind, "Tech tier N", description, credits, "Fuel: N jumps", **Refuel** (label shows cost, disabled with reason text when quote is 0) and **Leave**. Hotkeys via planet group bindings.
  - `showPauseMenu(ctx)`: Resume, Save, Call for tow (only when `towDestination` non-null, shows fee), Settings, Export pilot, Quit to main menu. Opened by `pause` action; sim paused while open.
  - `showMap(ctx)`: SVG of both systems at mapPos with link line and "you are here"; `map`/`back` closes.
  - Controller: on `landed` → `PilotStore.save` (autosave) then planet screen; on Leave → `departFrom` and resume flight; on `towed` → land at destination planet.

- [ ] **Step 1: Write failing e2e test** `land-jump.spec.ts`: new pilot → planet screen visible with "Halcyon" → press L (leave) → flight; press L → wait until planet screen visible (autopilot lands); assert pilot list now shows a savedAt; Leave; press G with no target → autopilot to jump point (poll until assist none), press J → after ~1.5 s `world().systemId === 'vesk'` and fuel decreased by 100; press Escape → pause menu visible.
- [ ] **Step 2:** Run → FAIL. Implement. Run → PASS.
- [ ] **Step 3: Commit** `feat: main menu, planet screen, pause menu, map and autosave`

---

### Task 10: Settings screen and hotkey editor

**Files:**
- Create: `src/ui/settingsScreen.ts`, `src/ui/hotkeyEditor.ts`, `tests/e2e/hotkeys.spec.ts`

**Interfaces:**
- Consumes: `Settings`, `findConflict`, `rebind`, `swapBinding`, `resetBindings`, `ACTION_LABEL`, `ACTION_GROUP`.
- Produces: `showSettings(ctx, { mode: 'keyboard'|'touch' })`. Tabs: **Controls** (keyboard mode only: hotkey editor grouped Flight / Planet screen / Menus, two slots each), **Touch** (touch mode only: mirror, button size S/M/L, opacity slider 30–100%, steering point/classic, vibration), **General** (volume—stored for later, no sounds yet; graphics quality; auto-land on arrival). Editor: click slot → "Press a key… (Esc to cancel)"; on conflict inline prompt "J is already used by Jump. Swap?" [Swap] [Cancel]; "Reset to defaults" with confirm. Changes save immediately via `saveSettings` and apply live to `KeyboardSource`.

- [ ] **Step 1: Write failing e2e test** `hotkeys.spec.ts`: open settings from pause → Controls; rebind Thrust slot 1 to KeyW; close; in flight hold W → speed increases; reload page → binding persisted; set Land to KeyJ → swap prompt appears → Swap → Jump now shows KeyL; Reset → Thrust is ArrowUp only.
- [ ] **Step 2:** Run → FAIL. Implement. Run → PASS.
- [ ] **Step 3: Commit** `feat: settings screen with rebindable hotkey editor`

---

### Task 11: Phone side-rail touch controls

**Files:**
- Create: `src/input/touch.ts`, `src/input/touch.test.ts`, `src/input/mode.ts`, `src/ui/rails.ts`, `src/ui/rails.css`, `tests/e2e/touch.spec.ts`
- Modify: `src/app/controller.ts`, `src/render/SpaceScene.ts` (camera viewport = clear region; tap planet → `selectPlanet` + land), `src/render/hud.ts` (HUD moves into left rail in touch mode)

**Interfaces:**
- Produces:
  - `computeLayout(w: number, h: number, s: Settings['touch']): { view: Rect; leftRail: Rect; rightRail: Rect; clear: Rect; overlayRails: boolean }` — view is the largest 16:9 rect centered by width; if `w/h > 16/9` rails fill leftover width (min 120 px each, view shrinks if needed); otherwise rails overlay the view's outer 18% at 85% opacity and `clear` = view minus those strips. `mirror` swaps rails.
  - `stickToInput(angle, magnitude, mode, heading): FlightInput` — point: `targetHeading = angle`, `thrust = magnitude > 0.6`; classic: `turn = sign of x component (deadzone 0.25)`, thrust from the Thrust button.
  - `TouchSource` — pointer-event joystick (left rail), buttons Stop (`autoStop`), Fire, Missile (`fireSecondary`), Target (`nextTarget`), radar tap → `map`, classic-mode Thrust button. `poll()` same shape as KeyboardSource plus `stick`.
  - `InputMode` — `'touch'` after first `pointerdown` with `pointerType==='touch'`, `'keyboard'` after any bound keydown; emits change; rails shown only in touch mode.
  - Context button: bottom-center of `view`, label from `contextAction` ("⬇ LAND ON HALCYON", "JUMP TO VESK", "✋ TAKE CONTROL", "CALL TOW (500 cr)"), hidden when null. During autopilot, Fire/Missile/stick at 20% opacity.
  - Button sizes S/M/L = 44/56/68 px base (Fire is 1.4×).

- [ ] **Step 1: Write failing unit tests:** `computeLayout(844, 390)` → rails each ≥120 px wide and `clear` equals `view`; `computeLayout(800, 600)` → `overlayRails: true` and clear excludes the 18% strips; mirror swaps rail x positions; `stickToInput(π/2, 0.7, 'point')` → targetHeading π/2 and thrust true; magnitude 0.5 → thrust false.
- [ ] **Step 2: Write failing e2e test** `touch.spec.ts` (Playwright `hasTouch: true`, viewport 844×390): tap anywhere → rails visible; **every rail control's bounding box does not intersect `clear`**; context button is inside `view` bottom-center; **resize to 932×430 then 780×360 and repeat the no-intersection check**; tap the Halcyon sprite → planet screen opens; viewport 390×844 → rotate overlay visible.
- [ ] **Step 3:** Run → FAIL. Implement. Run → PASS.
- [ ] **Step 4: Commit** `feat: phone side-rail touch controls with context button`

---

### Task 12: PWA, error screens, wake lock and vibration

**Files:**
- Create: `src/ui/overlays.ts`, `public/icons/icon-192.png`, `public/icons/icon-512.png` (generated original placeholder icon), `tests/e2e/errors.spec.ts`
- Modify: `vite.config.ts`, `src/main.ts`, `src/app/controller.ts`

**Interfaces:**
- Produces:
  - vite-plugin-pwa: `registerType: 'prompt'`, manifest `{ name: 'Starwake', short_name: 'Starwake', display: 'fullscreen', orientation: 'landscape', background_color: '#000000', theme_color: '#05070f' }`, precache build output.
  - `showUpdatePrompt(onRestart)` — shown only while on a planet screen or menu; if the update arrives mid-flight, queue it until the next landing.
  - `showCrash(err)` — on `window.onerror`/`unhandledrejection`: "Something went wrong", **Copy error report** (message, stack, app version from package.json, `navigator.userAgent`, screen size), **Reload**.
  - `showDataError(e: DataError)` — lists `e.issues`.
  - `showRotateOverlay()` — CSS `@media (orientation: portrait) and (pointer: coarse)`.
  - Wake lock requested on `startFlight`, released on pause/land; ignore failures. `navigator.vibrate(30)` on landed/jumped when touch vibration setting is on.

- [ ] **Step 1: Write failing e2e test** `errors.spec.ts`: `/?test&crash=1` (test hook throws on boot) → crash screen with Copy button; `/?test&baddata=1` (hook feeds invalid ship JSON) → data error lists `ships.json → shuttle.maxSpeed`.
- [ ] **Step 2:** Run → FAIL. Implement. Run → PASS. Also run `npm run build && npm run preview` and confirm in Chromium devtools that the manifest is valid and the service worker installs.
- [ ] **Step 3: Commit** `feat: installable PWA, crash and data error screens, wake lock`

---

### Task 13: GitHub repo and Pages deploy

**Files:**
- Create: `.github/workflows/deploy.yml`, `.github/workflows/ci.yml`
- Modify: `README.md` (play link, dev commands)

**Interfaces:**
- `ci.yml`: on pull_request and push — `npm ci`, `npm run typecheck`, `npm test`, Playwright e2e (chromium).
- `deploy.yml`: on push to `main` — build, `actions/upload-pages-artifact` (`dist`), `actions/deploy-pages`.

- [ ] **Step 1:** **Ask the owner to confirm** before creating anything on GitHub. Then `gh repo create starwake --public --source . --push` and enable Pages with source "GitHub Actions" (`gh api -X POST repos/jbman03/starwake/pages -f build_type=workflow`).
- [ ] **Step 2:** Push; wait for the deploy workflow; open `https://jbman03.github.io/starwake/` → title "Starwake", main menu visible, no console errors.
- [ ] **Step 3: Commit** `ci: test and deploy to GitHub Pages`
- [ ] **Step 4: Owner check:** play on PC and phone from the live URL—fly, land, refuel, jump to Vesk, tow back, autopilot, rebind a hotkey, install the app.
