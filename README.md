# Starwake (working title)

An original 2D space trading and combat game inspired by the classic
Escape Velocity series (EV, Override, Nova). It runs in the browser and
installs as an app on PC and phone.

All names, story, art and sound are original. EV's mechanics are the
inspiration; none of its copyrighted content is used.

## Play

https://jbman03.github.io/starwake/

## Development

```
npm install
npm run dev        # dev server at http://localhost:5173
npm test           # unit tests (vitest)
npm run test:e2e   # end-to-end tests (Playwright, chromium)
npm run build      # typecheck + production build into dist/
```

CI (`.github/workflows/ci.yml`) runs typecheck, unit tests and e2e on every
push and pull request. Pushes to `main` deploy to GitHub Pages
(`.github/workflows/deploy.yml`).

## Controls

### PC

Arrow keys fly: Up thrusts, Left/Right turn, Down reverses. Default hotkeys
(rebindable in settings):

| Key | Action |
| --- | --- |
| Space | Fire primary weapon |
| Shift | Fire secondary weapon |
| X | Auto-stop |
| Tab | Next target |
| R | Nearest hostile (refuel while landed) |
| F | Face target |
| L | Land (leave while landed) |
| J | Hyperspace jump |
| G | Autopilot |
| M | Map |
| Esc | Pause / back |

### Phone

- Play in landscape; the on-screen controls sit in side rails.
- Tap a planet to land on it.
- Install it: browser menu, then Add to Home Screen, to run full screen
  and offline.

## Stack

- **Engine:** Phaser + TypeScript, built with Vite
- **App shell:** PWA (installable, full screen, works offline)
- **Hosting:** GitHub Pages, auto-deploy on push to `main`
- **Game data:** JSON files for ships, outfits, systems, missions
- **Saves:** browser storage first, cloud sync later

## Roadmap

1. Flight prototype: one ship in one system, touch + keyboard controls
2. Galaxy: hyperspace jumps, map, landing on planets
3. Economy: trading, shipyard, outfitter
4. Combat and AI: pirates, escorts, factions
5. Missions and storylines

See `docs/design-notes.md` for the game vision.
