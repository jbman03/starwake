# Starwake — Sound, Music and the Hyperspace Jump (design)

Status: draft for owner review · 2026-10-30

## 1. Goal

Make Starwake feel alive to the ear and give the jump the weight it had in Escape Velocity:
the ship lines up, the engines wind up, it burns, the stars stretch, a flash, and it streaks into
the next system. Add music where there is none, rework every sound effect, and give players real
volume controls. It must stay playable on PC and phone, keep old saves and settings working, and
never break the live game.

## 2. Owner decisions (brainstorm)

| Question | Decision |
|---|---|
| Music | Generated ambient in code: slow pads and drones, a mood per situation. No audio files. |
| Jump | The full EV sequence (align, charge whine, burn, streaks, flash, whoosh; arrival streak and slow-down), about 2 s, skippable. |
| Effects | Rework every effect with layered synthesis; every recipe lives in a data file. |
| Controls | Separate Music and Effects sliders plus a master mute, saved in settings; a key toggles mute. |
| Approach | A: the jump becomes real phases in the sim; sound and render follow the phase. |

## 3. Architecture

- **Sim (`src/sim`)** owns the jump's phases and timings. It stays pure, seeded and fixed-step.
  Render and audio read `world.jump` and the events the sim emits; they never drive it.
- **Audio (`src/audio`)**, independent of Phaser, split by responsibility:
  - `mixer.ts`: one AudioContext; master, music and effects gain buses; volumes from settings.
  - `sfx.ts`: plays a named effect from its recipe (oscillators, noise, filters, envelopes).
  - `music.ts`: a generative engine that plays a mood and crossfades between moods.
  - `moods.ts`: a pure function from game state to a mood id; no audio objects.
- **Data (`data/audio.json`)**, validated by a Zod `AudioSchema` and loaded into
  `GameData.audio`, holds the effect recipes, the mood definitions and the jump timings, all with
  stable ids (Ruling 5 from cycle 4: tunables live in JSON for the future editor and plug-ins).
- **Render (`src/render`)** draws the jump from `world.jump.phase` and its progress.
- **UI (`src/ui`)** gets the sliders in Settings → General.

## 4. The jump

### 4.1 Phases

`world.jump` becomes `{ toSystemId, phase, t }`, where `t` is seconds into the current phase:

| Phase | Default length | What happens |
|---|---|---|
| `align` | until facing, max 0.6 s | The ship turns toward the destination at its turn rate, coasting. |
| `charge` | 0.7 s | Engines wind up: a rising whine; the engine glow brightens. No thrust yet. |
| `burn` | 0.5 s | Hard acceleration along the heading (3× the ship's normal thrust, uncapped speed); stars stretch into lines. |
| `flash` | 0.15 s | White flash; the deep whoosh; the system change happens at the end of this phase. |
| `arrive` | 0.6 s | In the new system: the ship enters at high speed along the jump line and slows to its normal maximum; streaks shorten; a softer whoosh. |

The total is about 2 s. All lengths and the burn multiplier live in `data/audio.json` →
`jump`. The existing rules stay: input is ignored during the jump (except skip, §4.2), combat
does not run during it, fuel and the day advance as now, and NPC jumps keep their 1 s look
(re-using the same visuals, scaled down).

### 4.2 Skip

A second press of Jump (key J, or the context button / a tap on phones) during `align`,
`charge` or `burn` goes straight to `flash`. Skipping costs nothing and changes nothing but time.
`arrive` cannot be skipped but accepts no input either way; it is short.

### 4.3 Compatibility

- `JUMP_DURATION` is replaced by the phase table. Code and tests that assume a 1 s jump move to
  a helper `jumpTotalSec(data)` or step until the `jumped` event.
- The `jumped` and `arrived` events keep their meaning and order.
- The jump is not saved (it never was); a save made in flight is unchanged.
- Arrival position stays where it is today (just inside the jump boundary); `arrive` only changes
  the ship's speed and heading on the way in, so the "too close to jump again" rule still holds.

## 5. Music

### 5.1 Moods

`moods.ts` exports `moodFor(state): MoodId`, chosen in this priority order:

1. `combat`: a hostile is engaged with the player or the player is disabled.
2. `hyperspace`: the jump is in `charge`, `burn` or `flash`.
3. `docked`: on a planet screen.
4. `fringe`: in a system whose government is independent, unlit or fringe.
5. `core`: anywhere else.

Mood changes crossfade over 3 s (2 s into and out of `combat`). The main menu uses `docked`.

### 5.2 The generator

Each mood is a data record: a root note and scale, a pad voice (oscillator mix and filter), a
drone, tempo of chord changes (slow, 8–20 s), an optional sparse melody voice, and a level.
`music.ts` plays it with a seeded RNG (seeded per mood, so a mood sounds the same each time it
starts but does not loop audibly). Combat adds a low pulse. No audio files are fetched.

### 5.3 Behaviour

Music starts after the first tap or key, as browsers require. It pauses with the game's pause
menu, keeps playing on planet screens, and stops when the tab is hidden. Any audio failure leaves
the game silent and running.

## 6. Sound effects

Every effect is a recipe in `data/audio.json` → `sfx`, keyed by the existing `Sfx` ids (`thrust`,
`jump`, `arrive`, `land`, `takeoff`, `trade`, `paid`, `hail`, `site`, `shot`, `missile`, `beam`,
`shieldHit`, `armorHit`, `explosion`, `disabled`, `alarm`) plus `jumpCharge`, `jumpWhoosh`,
`jumpArrive` and `uiClick`. A recipe is a list of layers; each layer is a tone (wave, start and
end frequency, gain, timing) or a noise burst (filter type and frequency sweep, gain, timing).
The engine hum and the beam loop stay continuous voices driven from code, with their timbre in
data. Volume caps and "at most once per tick" rules from cycle 4 stay.

## 7. Settings and controls

- Settings change from `volume` + `muted` to `musicVolume`, `sfxVolume` (0–1 each) and
  `muted`. Loading old settings sets `sfxVolume` from the old `volume`, and `musicVolume` to
  0.6. Corrupt values fall back to defaults, as now.
- Settings → General gets Music and Effects sliders and the existing mute checkbox; changes apply
  at once.
- A new bindable action `toggleMute`, default key U (free today), and listed in How to Play.
- Phones: no new buttons; the sliders are in Settings.

## 8. Error handling

- No AudioContext, or it fails: every audio call is a no-op; the game runs.
- A bad `data/audio.json` fails Zod validation at load, like every other data file, and the
  tests catch it before deploy.
- Hidden tab: music suspends; effects are dropped, not queued.

## 9. Testing

- **Unit:** the jump phase machine (lengths, align early exit, skip, arrival speed, events in
  order, no combat during it), `moodFor` for every rule and priority, `AudioSchema` accepts the
  shipped data and rejects bad records, settings migration, and the mixer and music engine against
  a fake AudioContext (gains follow the sliders, crossfade timing, mute, failure is silent).
- **E2E:** a full jump on PC and on phone, which arrives and allows play to continue; a skipped
  jump; the sliders save and reload; U toggles mute. Existing specs that time a jump are updated
  to wait for arrival.
- **Process:** the typecheck, Vitest and the full Playwright suite pass locally and in CI before
  I ask the owner to approve the merge and deploy. The owner is asked to listen on PC and on
  iPhone Chrome.

## 10. Out of scope

Recorded music or audio files, positional or stereo sound, per-faction or per-system themes,
voice lines, and a sound editor UI. Any of these can be a later cycle.
