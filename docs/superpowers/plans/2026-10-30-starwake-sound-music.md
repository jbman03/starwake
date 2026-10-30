# Sound, Music and the EV-style Jump Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Starwake generated ambient music by mood, reworked data-driven sound effects, Music/Effects volume sliders, and a phased Escape Velocity-style jump.

**Architecture:** The jump becomes real phases in the pure sim (`world.jump.phase`), with timings in `data/config.json` → `jump`; render and audio only follow it. `src/audio` splits into a mixer (buses), effects (recipes from `data/audio.json`), a pure mood selector, and a seeded generative music engine. Settings swap one `volume` for `musicVolume` + `sfxVolume`.

**Tech Stack:** TypeScript, Phaser 4, Web Audio API, Zod, Vitest, Playwright.

**Spec:** docs/superpowers/specs/2026-10-30-starwake-sound-music-design.md

## Global Constraints

- The sim stays pure, seeded (mulberry32/hashString) and fixed-step at 60 Hz; no `Math.random` or `Date` in `src/sim` or in music note choice.
- Every tunable lives in `data/*.json` with a Zod schema and stable ids (cycle 4 Ruling 5). Jump timings are in `data/config.json` → `jump`; sounds and moods are in `data/audio.json`.
- No audio files; everything is synthesised with Web Audio.
- Any audio failure (no AudioContext, a node that throws, a suspended context) is silent and never breaks the game; effects are dropped, not queued.
- Old saves and old settings load. Settings migrate `volume` → `sfxVolume`; `musicVolume` defaults to 0.6.
- Phones: no new on-screen buttons.
- UI is built with `el()`/`button()` and `textContent` only.
- Before claiming done: `npm run typecheck && npx vitest run` and the full Playwright suite pass. Never merge or deploy; the controller asks the owner.
- Commits end with the two trailer lines given in the dispatch; no model names anywhere in the repo.

## Review Focus

1. **A jump started at low frame rate or with a huge dt.** The phase machine must carry leftover time across phase boundaries, never skip `jumped`/`arrived`, and emit each `jumpPhase` exactly once. → Task 3, test "one big step runs every phase in order".
2. **A ship that already faces the destination.** `align` ends on the first tick, not after `alignMaxSec`. → Task 3, test "align ends at once when already facing".
3. **Skip pressed during `flash` or `arrive`.** It is ignored and must not restart or double the system change. → Task 3, test "skip during flash or arrive does nothing".
4. **The mute key or a slider moved while music is playing.** Gains ramp to the new level without a click and without restarting the music. → Task 5, test "apply ramps bus gains, no node recreated".
5. **A hidden tab or the pause menu during a crossfade.** Music suspends and resumes on the current mood, not a stale one. → Task 7, test "hide during crossfade resumes on the latest mood".

---

### Task 1: Settings — Music and Effects volumes

**Files:**
- Modify: `src/save/settings.ts`, `src/save/settings.test.ts`
- Modify: `src/ui/settingsScreen.ts` (the `slider('Volume', …)` line, about :105)
- Modify: `src/audio/sfx.ts` (`level()` reads `sfxVolume`), `src/audio/sfx.test.ts`
- Modify: any other reader of `settings.volume` (grep; `src/app/controller.test.ts` fixtures)

**Interfaces:**
- Produces: `Settings` with `musicVolume: number` (0–1, default 0.6), `sfxVolume: number` (0–1, default 0.8), `muted: boolean`; the `volume` field is removed.

- [ ] **Step 1: Failing tests in `settings.test.ts`**

```ts
it('migrates the old volume to sfxVolume and defaults musicVolume', () => {
  const s = loadFrom({ volume: 0.35, muted: true });
  expect(s.sfxVolume).toBe(0.35);
  expect(s.musicVolume).toBe(0.6);
  expect(s.muted).toBe(true);
  expect('volume' in s).toBe(false);
});
it('clamps and defaults the new volumes', () => {
  expect(loadFrom({ musicVolume: 3, sfxVolume: 'x' })).toMatchObject({ musicVolume: 1, sfxVolume: 0.8 });
});
it('a new sfxVolume wins over a stale volume', () => {
  expect(loadFrom({ volume: 0.2, sfxVolume: 0.9 }).sfxVolume).toBe(0.9);
});
```

(`loadFrom` stands for however the existing tests feed raw JSON to `merge`; reuse that helper.)

- [ ] **Step 2: Run** `npx vitest run src/save/settings.test.ts`; expect FAIL.
- [ ] **Step 3: Implement** in `merge()`: `sfxVolume = num(raw.sfxVolume ?? raw.volume, 0.8, 0, 1)` and `musicVolume = num(raw.musicVolume, 0.6, 0, 1)`. In Settings → General, replace the Volume slider with "Music" and "Effects" sliders (0–100, applied at once) and keep "Mute sound (V)".
- [ ] **Step 4: Run** `npm run typecheck && npx vitest run`; expect PASS. Update `tests/e2e` selectors that named the old "Volume" slider, if any (grep).
- [ ] **Step 5: Commit** `feat(settings): separate Music and Effects volumes`.

---

### Task 2: Audio data — `data/audio.json`, `AudioSchema`, `config.jump`

**Files:**
- Create: `data/audio.json`
- Modify: `src/data/schemas.ts` (add `AudioSchema`, `JumpConfigSchema` in `ConfigSchema`), `src/data/load.ts` (load `audio.json` into `GameData.audio`, as `combat.json` is loaded), `src/data/testData.ts`, `src/data/load.test.ts`
- Modify: `data/config.json` (add `jump`)
- Modify: `src/audio/sfx.ts`: `SoundBoard` reads recipes and voices from data instead of `RECIPES`/`HUM_*`/`BEAM_*` constants; the sounds are unchanged.
- Modify: `src/main.ts` (pass `controller.data.audio` to `SoundBoard`)

**Interfaces:**
- Produces:
  - `type SfxId` = the existing `Sfx` union plus `'jumpCharge' | 'jumpWhoosh' | 'jumpArrive' | 'uiClick'`. Exported from `src/data/schemas.ts`, with `Sfx` in `sfx.ts` becoming an alias.
  - `type SoundLayer = { kind: 'tone'; wave: 'sine'|'square'|'sawtooth'|'triangle'; f0: number; f1?: number; dur: number; gain: number; at?: number } | { kind: 'noise'; filter: 'lowpass'|'highpass'|'bandpass'; c0: number; c1?: number; q?: number; dur: number; gain: number; at?: number }`
  - `GameData.audio: { sfx: Record<Exclude<SfxId,'thrust'|'beam'>, { layers: SoundLayer[] }>; voices: { hum: { gain: number; rampSec: number; f: number }; beam: { gain: number; holdSec: number; fadeSec: number } } }`. Task 7 adds `moods`.
  - `GameData.config.jump: { alignMaxSec: 0.6; alignToleranceDeg: 3; chargeSec: 0.7; burnSec: 0.5; burnThrustMul: 3; flashSec: 0.15; arriveSec: 0.6; arriveSpeedMul: 3 }` (these exact default values).
  - `BEAM_HOLD_SEC` stays exported from `sfx.ts`, now read from data (keep its current value, 0.1).

- [ ] **Step 1: Failing tests in `load.test.ts`**: the shipped `audio.json` parses; a layer with `kind: 'noise'` and no `filter` is rejected with the file name `audio.json` in the error; an `sfx` id outside `SfxId` is rejected; `config.jump` with `chargeSec: -1` is rejected; every `SfxId` except `thrust` and `beam` has a recipe.
- [ ] **Step 2: Run** `npx vitest run src/data`; expect FAIL.
- [ ] **Step 3: Implement.** Port every entry of today's `RECIPES` into `audio.json` exactly: tones become `kind: 'tone'` layers; bursts become `kind: 'noise', filter: 'lowpass'` layers with the same numbers. Port the hum and beam constants into `voices`. Give `jumpCharge`, `jumpWhoosh` and `jumpArrive` today's `jump`/`arrive` recipes for now, and `uiClick` a single 0.03 s, 1800 Hz square tone at gain 0.04. Task 8 redesigns them all.
- [ ] **Step 4: Verify the sounds are unchanged.** Add a test in `sfx.test.ts`, with the existing fake AudioContext, showing that `play('explosion')` creates the same oscillator and noise nodes, frequencies and gains as before the port (snapshot the call log before you change the code). Then run `npm run typecheck && npx vitest run`; expect PASS.
- [ ] **Step 5: Commit** `feat(data): sound recipes and jump timings move into data`.

---

### Task 3: Sim — the phased jump

**Files:**
- Modify: `src/sim/types.ts` (the `jump` type, `JumpPhase`, the `jumpPhase` SimEvent)
- Modify: `src/sim/world.ts` (the jump step at about :304–318, the jump start at about :356–367, `arriveFromJump` at about :226; remove `JUMP_DURATION`; add helpers)
- Modify: `src/sim/flight.ts` (`stepShip` gains optional overrides)
- Modify tests that use `JUMP_DURATION`: `src/sim/world.test.ts`, `src/sim/story.test.ts`, `src/app/controller.test.ts`
- Test: `src/sim/jump.test.ts` (new)

**Interfaces:**
- Consumes: `data.config.jump` (Task 2).
- Produces:
  - `type JumpPhase = 'align' | 'charge' | 'burn' | 'flash' | 'arrive'`
  - `WorldState.jump: { toSystemId: string; phase: JumpPhase; t: number } | null`. During `arrive`, `world.systemId === toSystemId`.
  - `SimEvent` gains `{ type: 'jumpPhase'; phase: JumpPhase }`, emitted once on entering each phase, `align` included.
  - `jumpProgress(jump: NonNullable<WorldState['jump']>, data: GameData): number`: 0–1 within the current phase (`align` uses `alignMaxSec`).
  - `jumpFixedSec(data: GameData): number`: `chargeSec + burnSec + flashSec + arriveSec`.
  - `stepShip(ship, def, input, dt, opts?: { thrustMul?: number; maxSpeed?: number })`
  - Event order at the system change (end of `flash`): `jumped`, then today's `enterSystem`/`advanceDays` events, then `arrived`, then `jumpPhase: arrive`. `world.jump` becomes `null` at the end of `arrive`.

- [ ] **Step 1: Failing tests in `jump.test.ts`.** Step at `dt = 1/60` unless stated.
  - `phases run align → charge → burn → flash → arrive in order, each jumpPhase emitted once`
  - `align ends at once when already facing` (heading set to `jumpHeading`; `charge` starts on tick 1)
  - `align gives up after alignMaxSec` (ship pointed away, a slow turn rate)
  - `charge coasts with no thrust; burn speeds the ship past def.maxSpeed` (speed at the end of burn > `def.maxSpeed`)
  - `one big step runs every phase in order` (a single `stepWorld` with dt = 5 s yields the same event sequence and ends with `jump === null`)
  - `skip during align, charge or burn goes straight to flash` (press `jump` again: next phase is `flash`, with `t` near 0)
  - `skip during flash or arrive does nothing` (exactly one `jumped` and one `arrived`)
  - `arrive starts at arriveSpeedMul × maxSpeed and ends at today's arrival point and speed` (final pos within 1 px of `to.jumpDistance - JUMP_ARRIVAL_INSET` along the arrival line; final speed equals `JUMP_ARRIVAL_SPEED`)
  - `input other than skip is ignored during the jump`; `fuel and day change exactly as before`
  - `a jump can't start while one is running` (`canJump` reason `jumping`, unchanged)
- [ ] **Step 2: Run** `npx vitest run src/sim/jump.test.ts`; expect FAIL.
- [ ] **Step 3: Implement** in `world.ts`.
  - Carry leftover time across phase boundaries in a loop, so one big `dt` runs several phases.
  - Skip: `pressed.has('jump')` during `align`/`charge`/`burn` → `flash`, t = 0.
  - Arrival: the arrive phase starts at `arrivalPoint - heading * travel`, where `travel = (v0 + v1) / 2 * arriveSec`, `v0 = arriveSpeedMul * def.maxSpeed` and `v1 = JUMP_ARRIVAL_SPEED`. Speed falls linearly from `v0` to `v1` along the fixed heading toward the centre.
  - Update the old tests to step until `arrived` (or by `jumpFixedSec(data)` plus the align time) instead of `JUMP_DURATION`. Don't weaken their assertions.
- [ ] **Step 4: Run** `npm run typecheck && npx vitest run`; expect PASS. The `world.jump` checks in `context.ts`, `rules.ts`, `battle.ts`, `combatControl.ts` and `guide/*.ts` should still hold, since `jump` stays non-null for the whole sequence. Confirm with the existing tests.
- [ ] **Step 5: Commit** `feat(sim): EV-style phased jump with skip`.

---

### Task 4: Jump visuals and phase sounds

**Files:**
- Modify: `src/render/SpaceScene.ts` (`drawJumpFx` at about :502; remove the local `ARRIVAL_FX_SEC` arrival timer and the `JUMP_DURATION` import)
- Modify: `src/app/controller.ts` (the `sfx` event union at about :125; the jump-start sfx at about :819 becomes per-phase)
- Modify: `src/main.ts` only if the sfx wiring needs it
- Test: `src/app/controller.test.ts`

**Interfaces:**
- Consumes: `JumpPhase`, the `jumpPhase` SimEvent, `jumpProgress` (Task 3); `SfxId` (Task 2).
- Produces: the controller emits `{ type: 'sfx', sfx }` with `jumpCharge` on entering `charge`, `jumpWhoosh` on entering `flash`, and `jumpArrive` on entering `arrive`. It no longer emits `jump` at the jump start; the `arrive` sfx from the `arrived` event in main.ts is removed so arrival isn't heard twice.

- [ ] **Step 1: Failing controller test** `a jump emits jumpCharge, jumpWhoosh, jumpArrive once each, in order, and no 'jump' sfx`.
- [ ] **Step 2: Run** it; expect FAIL.
- [ ] **Step 3: Implement** the sfx mapping. Render per phase:
  - `align`: nothing extra.
  - `charge`: engine glow brightening with `jumpProgress`.
  - `burn`: streaks growing 0→1 with `jumpProgress`.
  - `flash`: full streaks plus a white flash rising to 1.
  - `arrive`: streaks shrinking 1→0 and the flash fading 1→0.
  NPC jump streaks keep their current look and timing.
- [ ] **Step 4: Run** `npm run typecheck && npx vitest run`, then `npx playwright test tests/e2e/flight.spec.ts tests/e2e/touch.spec.ts` with the local config. Fix any test that timed a 1 s jump by waiting for arrival instead (`waitForFunction` on `world.jump === null` and the new `systemId`), never by loosening an assertion.
- [ ] **Step 5: Commit** `feat(render): jump charge, burn, flash and arrival effects`.

---

### Task 5: Mixer — master, music and effects buses

**Files:**
- Create: `src/audio/mixer.ts`, `src/audio/mixer.test.ts`
- Modify: `src/audio/sfx.ts` (`SoundBoard` takes a `Mixer` and connects to its effects bus; the context and unlock code move to the mixer)
- Modify: `src/main.ts` (create the mixer, call `mixer.apply()` when settings change and on V)

**Interfaces:**
- Produces:
  ```ts
  export class Mixer {
    constructor(getSettings: () => Settings, ctxFactory?: () => AudioContext);
    unlock(): void;              // from a gesture; never throws
    running(): boolean;
    context(): AudioContext | null;
    sfxBus(): GainNode | null;   // null until unlocked or when audio is unavailable
    musicBus(): GainNode | null;
    apply(): void;               // ramp master/music/sfx gains to the settings over 0.05 s
    setHidden(hidden: boolean): void; // suspend/resume the context
  }
  ```
  Bus gain is `muted ? 0 : sfxVolume` for effects and `muted ? 0 : musicVolume` for music; master is 1.

- [ ] **Step 1: Failing tests** with a fake AudioContext:
  - `buses are created once on unlock`
  - `apply ramps bus gains, no node recreated`
  - `muted zeroes both buses`
  - `a factory that throws leaves every call a no-op`
  - `setHidden(true) suspends and setHidden(false) resumes`
- [ ] **Step 2: Run** them; expect FAIL.
- [ ] **Step 3: Implement** the mixer. Move the existing `sfx.test.ts` cases that cover unlock and failure onto the mixer.
- [ ] **Step 4: Run** `npm run typecheck && npx vitest run`; expect PASS.
- [ ] **Step 5: Commit** `feat(audio): mixer with music and effects buses`.

---

### Task 6: Moods — a pure mood selector

**Files:**
- Create: `src/audio/moods.ts`, `src/audio/moods.test.ts`
- Modify: `src/app/controller.ts` (add `musicInput()`), `src/sim/traffic.ts` (export the existing `isFringe`)

**Interfaces:**
- Produces:
  ```ts
  export type MoodId = 'core' | 'fringe' | 'combat' | 'docked' | 'hyperspace';
  export interface MoodInput { screen: 'menu' | 'docked' | 'flying'; jumpPhase: JumpPhase | null; inCombat: boolean; fringe: boolean }
  export function moodFor(i: MoodInput): MoodId;
  // controller
  musicInput(): MoodInput;
  ```
  - **Priority:** combat > hyperspace (jumpPhase `charge`, `burn` or `flash`) > docked (screen `docked` or `menu`) > fringe > core.
  - **`inCombat`:** the player is disabled, or any NPC in the system is `engaged`, not `fled`, and hostile to the player.
  - **`fringe`:** `isFringe(data, systemId)`, or the system's government is `independent` or `unlit`.

- [ ] **Step 1: Failing tests.** One per rule and one per priority clash: combat while jumping is `combat`; charge in a fringe system is `hyperspace`; `align` and `arrive` are not hyperspace; menu is `docked`. Add controller tests: `musicInput` reports `inCombat` with an engaged raider, and `fringe` in an unlit system.
- [ ] **Step 2: Run** them; expect FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm run typecheck && npx vitest run`; expect PASS.
- [ ] **Step 5: Commit** `feat(audio): pick a music mood from game state`.

---

### Task 7: Music — the generative ambient engine

**Files:**
- Create: `src/audio/music.ts`, `src/audio/music.test.ts`
- Modify: `data/audio.json` (add `moods`), `src/data/schemas.ts` (`MoodSchema`), `src/data/load.test.ts`
- Modify: `src/main.ts`: every 250 ms, call `music.setMood(moodFor(controller.musicInput()))`; pause with the pause menu; `mixer.setHidden` on `visibilitychange`.

**Interfaces:**
- Consumes: `Mixer` (Task 5), `MoodId`/`moodFor` (Task 6), `hashString`/`mulberry32`.
- Produces:
  - `GameData.audio.moods: Record<MoodId, { root: number /* Hz */; scale: number[] /* semitone offsets */; chordSec: [number, number] /* min,max seconds per chord, within 8–20 */; pad: { waves: ('sine'|'triangle'|'sawtooth')[]; cutoff: number; gain: number }; drone: { gain: number }; melody: { chance: number /* 0–1 per chord */; gain: number } | null; pulse: { bpm: number; gain: number } | null; level: number }>`. Only `combat` has a `pulse`.
  - `export class Music { constructor(mixer: Mixer, moods: GameData['audio']['moods']); setMood(id: MoodId): void; pause(): void; resume(): void; tick(): void }`
  - Crossfade lasts 3 s, or 2 s into and out of `combat`. Note choice is seeded by `hashString('music:' + moodId)`, advancing each chord. `setMood` with the current mood is a no-op.

- [ ] **Step 1: Failing tests** with a fake AudioContext and a fake clock:
  - `the same mood plays the same chord sequence each time it starts`
  - `setMood crossfades: the old voice ramps to 0 and the new one up over 3 s (2 s for combat)`
  - `setMood with the current mood does nothing`
  - `hide during crossfade resumes on the latest mood`
  - `no musicBus (locked or no audio) makes every call a no-op`
  - `voices are stopped and disconnected after a fade (no node leak after 20 mood changes)`

  In `load.test.ts`: every `MoodId` has a record, `chordSec` is within 8–20, and `pulse` appears only on `combat`.
- [ ] **Step 2: Run** them; expect FAIL.
- [ ] **Step 3: Implement.**
  - **Voices:** a pad of detuned oscillators through a low-pass filter, a drone on the root, an occasional soft melody note from the scale, and a combat pulse.
  - **Scheduling:** use the context's clock; `tick()` schedules about 2 s ahead.
  - **Tuning:** set mood values by ear in the spirit of the spec: `core` calm and warm; `fringe` sparse and minor; `docked` soft; `hyperspace` a rising swell; `combat` tense, low, with the pulse.
- [ ] **Step 4: Run** `npm run typecheck && npx vitest run`; expect PASS. Then smoke-run the game (`npm run dev`, or the e2e suite once) and check there are no console errors.
- [ ] **Step 5: Commit** `feat(audio): generative ambient music by mood`.

---

### Task 8: Sound effects rework

**Files:**
- Modify: `data/audio.json` (`sfx` recipes; `voices`)
- Modify: `src/audio/sfx.ts` (a noise layer honours `filter` and `q`; a layer may set `detune` only if the schema gains it here)
- Modify: `src/ui/dom.ts` (`button()`): play `uiClick` through a hook that main.ts sets, so the UI module stays free of audio imports.
- Test: `src/audio/sfx.test.ts`, `src/data/load.test.ts`

**Interfaces:**
- Consumes: `SoundLayer` and `SfxId` (Task 2), `Mixer` (Task 5).
- Produces: `setUiClickSound(fn: (() => void) | null): void`, exported from `src/ui/dom.ts`.

- [ ] **Step 1: Failing tests.**
  - Each recipe's peak summed gain is ≤ 0.6.
  - `explosion` has a low-pass noise layer and a sub tone under 100 Hz.
  - `shieldHit` uses a high-pass or band-pass noise layer, and `armorHit` a low-pass one.
  - `jumpCharge` rises in pitch over ≥ 0.6 s.
  - `jumpWhoosh` has a noise layer sweeping down over ≥ 0.4 s.
  - A noise layer with `filter: 'highpass'` creates a `BiquadFilterNode` of type `highpass` with the given `q`.
  - `uiClick` plays when a `button()` is clicked once the hook is set.
- [ ] **Step 2: Run** them; expect FAIL.
- [ ] **Step 3: Implement.** Redesign every recipe with layered tones and filtered noise:
  - weapons in distinct voices (blaster chirp, cannon thud, rocket hiss, seeker trill);
  - a shield "zap" versus an armor "crunch";
  - a deep layered explosion;
  - softer UI sounds.

  The engine hum gets a filtered noise rumble layer under its tone. Keep combat sounds short and soft, since they repeat.
- [ ] **Step 4: Run** `npm run typecheck && npx vitest run`; expect PASS.
- [ ] **Step 5: Commit** `feat(audio): layered sound effects from data`.

---

### Task 9: End-to-end tests and docs

**Files:**
- Create: `tests/e2e/audio.spec.ts`
- Modify: `tests/e2e/*` that time a jump (as needed)
- Modify: `docs/design-notes.md`, `src/ui/howToPlay.ts`, `README.md`

**Interfaces:**
- Consumes: everything above; test hooks on `window.__starwake`. Add `musicMood(): MoodId | null` and `jumpPhase(): JumpPhase | null` there if they're missing.

- [ ] **Step 1: Write e2e tests.**
  - **PC:** a full jump passes through every phase in order (poll `jumpPhase`), arrives, and flight continues.
  - **PC:** pressing J again during `charge` jumps to `flash`.
  - **Phone:** a jump from the context button completes.
  - **Settings:** the Music and Effects sliders save, survive a reload, and V toggles mute.
  - **Mood:** `musicMood()` is `docked` on the planet screen and `core` after take-off at Halcyon.

  Assert no console errors.
- [ ] **Step 2: Run** the new spec three times in a row (`--repeat-each 3`), then the full suite with the local config; everything must be green.
- [ ] **Step 3: Update the docs.**
  - **How to Play:** the jump sequence and skip, the sliders, and V mutes everything.
  - **Design notes:** the audio architecture and data files.
  - **README:** a feature line.
- [ ] **Step 4: Run** `npm run typecheck && npx vitest run` and the full Playwright suite twice; both must be green.
- [ ] **Step 5: Commit** `test(e2e): jump, music and sound settings end to end` and `docs: sound, music and the jump`.
