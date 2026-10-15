# Starwake: Foundation Design (Sub-project 1)

**Date:** 2026-10-15
**Status:** Awaiting review
**Working title:** Starwake (name and trademark check before any public launch)

## 1. Purpose

Starwake is an original 2D space trading, combat and story game inspired by the
classic Escape Velocity series (EV, Override, Nova). It runs in the browser on PC
and phone, installs like an app, and is hosted for free from the owner's GitHub.

The owner's goal is a personal passion project that may be shared publicly later
(Steam, itch.io). So everything must be release-safe: original names, story, art
and sound, or assets whose licenses allow commercial use, recorded in
`CREDITS.md`. No EV content (sprites, text, names, sounds) is used. EV's
*style* is matched; its assets are not copied.

### What the owner values most
- Flying, missions, the battle system, and boarding/capturing ships
- Story-driven unlocking of ships, gear and areas
- Planets with tiered shipyards: the best ships only at higher-tier worlds
- Touch controls on phone that never cover landing, autopilot or fuel info
- A hotkey for every action, rebindable on PC
- Visuals as close as possible to classic EV's rendered look

### Fixes for known EV complaints (from community research)
These are delivered by later sub-projects; listed here so the foundation does
not block them.
1. Only one storyline per playthrough; shared forced mission stretch → multiple
   story arcs per playthrough (sub-project 6)
2. Repetitive cargo missions → varied mission types (6)
3. "Golden" trade routes → prices shift as you sell, plus local events (7)
4. Capture nearly impossible → hard but achievable, odds shown first (5)
5. Too-easy stories, uneven faction balance → tuning pass (4, 6)
6. Stranded with no fuel → tow rescue (this sub-project)
7. Fiddly landing → assisted landing (this sub-project)

## 2. Roadmap (separate design → plan → build cycles)

| # | Sub-project | Scope |
|---|---|---|
| **1** | **Foundation** (this spec) | Flight, input and hotkeys, phone controls, two systems with a basic jump, landing, fuel, autopilot, planet screen, saves, settings, PWA, hosting |
| 2 | Galaxy and travel | Many systems, map, route planning, fuel range warnings |
| 3 | Ships and outfits | Tiered shipyards and outfitters, ship stats, upgrades |
| 4 | Combat | Weapons, shields and armor, AI, pirates, factions, reputation |
| 5 | Boarding and capture | Disabling, plundering, capture odds, crew |
| 6 | Missions and story | Mission board, story-driven unlocks, multiple arcs |
| 7 | Economy | Dynamic trade prices, local events |
| 8 | Art pass | EV-style rendered ships and planets replace placeholders |

## 3. Technology

- **Engine:** Phaser (current stable major version) + TypeScript
- **Build:** Vite. **Tests:** Vitest (unit) and Playwright (browser)
- **App shell:** PWA via `vite-plugin-pwa` (manifest, service worker, offline)
- **Data validation:** Zod schemas
- **Hosting:** public GitHub repo, GitHub Pages, deployed by GitHub Actions on
  every push to `main`
- **License:** "All rights reserved" (no open-source license); public repo for
  free hosting only

## 4. Architecture

The game rules are kept separate from the graphics.

```
src/sim/      Game rules in plain TypeScript, no Phaser imports. Fixed 60 Hz tick.
src/input/    Action definitions, key bindings, touch controls
src/render/   Phaser scenes: draws whatever the sim state says
src/ui/       HTML/CSS overlays: planet screen, settings, hotkey editor, pause
src/save/     Pilot save/load, versioning, backup, import/export
src/data/     Zod schemas and the data loader
data/         ships.json, systems.json, planets.json
public/       Images, sounds, app icons
tests/        Playwright browser tests
```

**Boundaries**
- `sim` exposes `step(state, actions, dt) → state` style functions plus queries
  (e.g. `canLand(state, planetId)`). It never reads the keyboard or draws.
- `input` turns keys, touches (and later gamepads) into a per-tick `ActionSet`.
- `render` reads sim state and draws; it never changes game rules.
- `ui` overlays call into `sim`/`save` through small functions (refuel, leave,
  save pilot), never by poking at Phaser objects.

**Fixed timestep:** the sim advances in fixed 1/60 s ticks using an
accumulator, so behavior is identical on fast PCs and slow phones. Rendering
interpolates between ticks.

## 5. Input and hotkeys

### Actions
`thrust`, `turnLeft`, `turnRight`, `reverse`, `autoStop`, `firePrimary`,
`fireSecondary`, `nextTarget`, `nearestHostile`, `faceTarget`, `land`,
`jump`, `autopilot`, `map`, `pause`.

Actions belong to **groups** by where they apply: *Flight* (the list above),
*Planet screen* (`refuel`, `leave`), and *Menus* (`pause`/back). A key may be
reused across groups (R is Nearest hostile in flight and Refuel on a planet);
conflicts are only checked within a group.

Every new feature in later sub-projects must add an action, which
automatically gives it a hotkey slot in the editor.

`firePrimary`, `fireSecondary` and `nearestHostile` are bound now but do
nothing until combat (sub-project 4). `map` opens a simple placeholder showing
the two systems until sub-project 2.

### Default PC bindings
Movement uses **arrow keys only** by default so letter keys stay free for
actions. Each action may hold up to two keys.

| Action | Default | Action | Default |
|---|---|---|---|
| Thrust | ↑ | Next target | Tab |
| Turn left / right | ← / → | Nearest hostile | R |
| Reverse | ↓ | Face target | F |
| Auto-stop | X | Land / context | L |
| Fire primary | Space | Hyperspace jump | J |
| Fire secondary | Shift | Autopilot | G |
| Map | M | Pause / menu | Esc |

### Hotkey editor (PC only)
- Lists every action with its two key slots; click a slot, press a key.
- On conflict: "J is already used by Jump. Swap?" (Swap / Cancel).
- "Reset to defaults" button. Esc cannot be unbound from Pause.
- Bindings are saved per device in settings.

### Phone controls (side rails)
The game view is a centered area; on screens wider than 16:9 the leftover width
becomes the side rails. On narrower screens the rails are semi-transparent over
the view's outer edges, with a guaranteed clear center region.

- **Left rail:** status bars (shields, armor, fuel in jumps) at top, **Stop**
  button, joystick at bottom.
- **Right rail:** radar at top (tap to open map), **Target** and **Missile**
  buttons, large **Fire** button at bottom.
- **Bottom-center context button** over the game view, shown only when an action
  is available: Land on X / Jump / Take control (Refuel and Board come later).
- **Tap a planet** in the view to select and land on it.
- **Steering modes:** *Point-to-fly* (default): stick direction = desired
  heading, ship turns toward it, thrust when pushed past 60%. *Classic*: stick
  left/right turns only, separate Thrust button.
- **Phone settings:** left-handed mirror, button size (S/M/L), button opacity,
  steering mode, sound, vibration. No key remapping.
- Touch vs keyboard UI is chosen by detecting the input actually used (first
  touch shows rails; keyboard use on a touch laptop hides them).

## 6. Flight

- **Ship stats:** `turnRate` (deg/s), `acceleration` (px/s²), `maxSpeed` (px/s),
  `fuelCapacity` (jumps × 100 units).
- **Thrust** adds velocity along the facing direction. No drag: ships drift.
  Speed is clamped to `maxSpeed`.
- **Reverse:** rotates toward the opposite of the current velocity (no thrust).
- **Auto-stop:** rotate to retrograde, thrust until speed < 1 px/s, then zero it.
- **Face target:** rotate toward the selected target.
- **Rendering:** physics heading is continuous; the drawn sprite uses the
  nearest of **36 frames** (10° steps), EV-style. Camera stays centered on the
  player ship.
- Any manual steering or thrust input cancels an active assist.

## 7. Systems, landing, fuel, autopilot

### Content for the foundation
Two small systems linked to each other:
- **Home system:** a star and 3 planets/stations, all selling fuel.
- **Frontier system:** a star and 2 planets/stations, none selling fuel (so
  fuel planning and tow rescue can be tested).

Planets carry `techTier` (1–5) and `fuelPrice` (absent = no fuel sold) now so
later shipyards can use them.

**New pilot starts** landed on a home-system planet with 10,000 credits, a
placeholder starter ship (`shuttle`), and a full tank of 3 jumps.

### Hyperspace jump (basic)
- Allowed when the player is at least `jumpDistance` from the system center and
  has ≥ 1 jump of fuel.
- Press J (or the context button): ship turns to face the destination, short
  jump effect, arrives at the edge of the destination system. Costs 100 fuel.
- If not far enough: message "Too close to the star to jump" and autopilot can
  take you out.
- Full map, route selection and multi-jump planning are sub-project 2.

### Landing
- **Can land when:** distance to planet ≤ planet radius + margin, and speed ≤
  landing speed limit.
- **L / tap / context button:** if `canLand`, land now. Otherwise autopilot flies
  in, brakes and lands automatically.
- **Target choice:** L lands on the selected planet, else the nearest. Pressing L
  again while not landed cycles to the next nearest planet.
- Landing triggers an autosave, then opens the planet screen.

### Fuel
- HUD shows **"Fuel: N jumps"**: normal color, amber at 1, red at 0.
- Refuel on the planet screen: shows cost (`missing units × fuelPrice`) before
  paying; partial refuel if credits are short.
- Fuel is only used by jumps; flying within a system is free.
- **Tow rescue:** when fuel is 0 and the current system has no planet that
  sells fuel, the pause menu and context button offer "Call for tow". It costs
  `towFee` (in data, default 500 credits; credits may go negative as debt),
  moves the ship to the nearest fuel-selling planet in any system, and lands.

### Autopilot
- Destination: selected planet or jump point. Engage with G or the context
  button.
- Behavior: turn toward the destination, burn, flip at the computed braking
  point, brake, arrive stopped within the arrival radius. Option "auto-land on
  arrival" (default on for planets).
- Cancels on any manual flight input. (Cancel-when-attacked is wired as an
  event hook now and triggered once combat exists.)
- While active: combat buttons fade to 20% opacity, a route banner shows at top
  ("Autopilot → Halcyon · fuel after: 3 jumps"), context button becomes
  **Take control**.

### Planet screen (HTML overlay, EV-style)
- Planet image, name, description, tech tier.
- Buttons in the foundation: **Refuel**, **Leave**. Shipyard, Outfitter, Trade,
  Missions and Bar are added by their sub-projects (not shown as disabled).
- Shows credits and fuel.
- Hotkeys: R refuel, L or Esc leave. These are `refuel` and `leave` actions in
  the "Planet screen" group of the bindings table (see section 5).

## 8. Saving

- **Pilots:** multiple save slots; create, load, rename, delete (delete asks for
  confirmation).
- **When:** autosave on every landing; manual save from the pause menu.
- **Storage:** IndexedDB. Each write keeps the previous save as `backup`; if the
  current save fails to load or validate, the backup is offered.
- **Versioning:** every save has `version`. Loading runs migrations
  step-by-step to the current version; unknown future versions refuse to load
  with a clear message.
- **Export / Import:** download a pilot as a `.starwake.json` file; import one
  on another device. Imported files are validated before use.
- **Contents:** pilot name, credits, ship type, fuel, current system and
  planet, game time. Later sub-projects add fields through migrations.

Settings (bindings, phone layout, audio, graphics) are stored separately per
device, not in the pilot.

## 9. PWA and hosting

- Installable on PC and phone, standalone full screen, offline after first load.
- Manifest orientation `landscape`; in portrait a "Rotate your phone" overlay.
- Screen Wake Lock while in flight (where supported).
- When a new version is deployed: "Update available. Restart?" prompt; never
  reloads mid-flight on its own.
- GitHub Actions builds and deploys to GitHub Pages on push to `main`.

## 10. Error handling

- **Data:** all JSON validated with Zod at load. Failure shows file, path and
  problem (e.g. `ships.json → shuttle.maxSpeed: expected number`).
- **Saves:** invalid save → offer backup; invalid import → message, nothing
  overwritten.
- **Crashes:** global error handler shows "Something went wrong" with
  **Copy error report** (message, stack, version, device info) and **Reload**.

## 11. Testing and definition of done

### Automated unit tests (Vitest, `src/sim`, `src/input`, `src/save`)
- Thrust accelerates along facing; speed clamps at `maxSpeed`; drift with no
  input keeps velocity.
- Reverse turns to retrograde; auto-stop ends at speed 0.
- Autopilot arrives stopped within arrival radius from varied start states.
- `canLand` true/false at the boundaries of distance and speed.
- Jump: blocked when too close or no fuel; succeeds and deducts 100 fuel.
- Refuel cost and partial refuel; tow rescue moves and charges correctly.
- Bindings: default map complete for every action; rebinding; conflict
  detection and swap; reset.
- Saves: round-trip; backup recovery; migration chain; future-version refusal;
  import validation.
- Data: every shipped JSON file passes its schema.

### Automated browser tests (Playwright)
- Game loads with no console errors.
- Arrow keys move the ship; L lands at a planet; J jumps to the other system.
- Phone-size landscape viewport (e.g. 844×390): no touch control overlaps the
  clear game-view region except the bottom-center context button.
- Portrait viewport shows the rotate overlay.

### Owner check
Play from the live GitHub Pages URL on PC and on phone: fly, land, refuel, jump,
autopilot, change a hotkey, install as an app.

## 12. Out of scope for this sub-project
Combat effects, enemies, shipyards/outfitters, trading, missions, boarding,
the full galaxy map, cloud save sync, gamepad support, final art and music.
Placeholder art: simple shaded ship and planet sprites made for this project.
