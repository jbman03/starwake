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
| C | Commodity exchange (on a planet) |
| M | Mission computer (on a planet); star map (in flight) |
| N | Star map (on a planet) |
| K | Mission log |
| B / S | Buy / sell in the exchange (10 t; hold Shift for 1 t) |
| Esc | Pause / back |

### How to play

**Trading.** Each port's exchange lists its goods with a Low, Med or High
price level. Buy where a good is Low, fly to a port where it is High, and sell.
Prices drift day to day, shift with news events (a surplus or shortage at a
port), and move with your own trading: heavy buying pushes the price up, heavy
selling pushes it down, and both ease back toward normal over a few days. The
shuttle carries 20 t. Credits never drop below zero from trading, and a pilot
in debt (after a tow) can sell but not buy.

**Missions.** The mission computer lists jobs posted at the port: cargo
deliveries, rush deliveries, passenger ferrying and garbage dumping. Each shows its destination, pay and any
deadline. Accept up to eight, then land at the destination port within the
deadline; you are paid on landing (some jobs pay up front). The mission log (K)
tracks active jobs, shows them on the star map, and lets you abandon one.
Plan trips on the star map: pick a known system, set a course, then use
autopilot (G) and jump (J) along the route. Each jump costs fuel and a day.

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
