# Starwake: Nov 12 playtest fixes

A small fix pass on the live game before cycle 7. Each item below is from the Nov 12 playtest of
https://jbman03.github.io/starwake/.

## Fixes

1. **Wrong landing target.** The cause: pressing L *during* a landing autopilot cycled to the next port by
   distance from the ship. Just off Pell, a second L press went Glasshouse → Vanterre → Pell, and the autopilot
   landed back at Pell. Now L always lands at the targeted port, or flies there and lands (the nearest port when
   nothing is targeted). Pressing L again keeps the same port. Tab is the one way to change the target.
   The context button already names the port ("LAND ON …"). Tests: `src/sim/world.test.ts` (Tessaly/Pell case
   and the "keeps the same port" case).
2. **Cargo display.** Every screen now shows hold **used / total**: the planet panel, the Exchange, the Mission
   Computer, the bar, the flight HUD and the sidebar. An empty hold reads `Cargo: 0/20 t` and a full one
   `Cargo: 20/20 t`, so "Your hold is full" now sits next to `20/20 t`. There is one helper for all of them:
   `cargoLabel()` in `src/sim/cargo.ts`. The sidebar's "Cargo free:" label is gone. Tests updated in the
   exchange, planet screen, HUD and shops e2e tests, plus a new Mission Computer test.
3. **System count.** The total was already data-driven (`visibleSystems`), not a hard-coded 30. The galaxy has
   41 systems, and 11 of them are hidden behind story lanes: Hushwater, the nine Dimming systems and Longlamp.
   That leaves 30 open. A new test pins the count to `data/systems.json`.
4. **Pell's type.** Added a `moon` port kind (schema, planet screen header, target readout, Editor guide).
   Pell, Merrow, Inkwell and Little Wren are now moons; each description calls it a moon. Moons draw with the
   planet sprite. A data test fails if a description says "moon" and the kind disagrees. Rime Shelf's
   "the size of a moon" is a comparison and is exempt.
5. **Gossip.** The bar's Gossip box no longer repeats the port description. It shows the rumour when one is
   going round, or else "Nobody has news worth repeating tonight."
6. **Clipped map label.** The zoom buttons sat over the map's top-left corner, which is where Quillon is, so the
   label looked cut off at 1024×768, 768×1024, 390×844 and 667×375. The zoom column moved to the bottom-right
   corner, where no system sits whatever lanes are open. On narrow maps, labels near an edge now also slide
   inward so the whole name stays on the map (Coldharbour overflowed at 390 wide). An e2e test checks every
   label at six viewports, with the hidden lanes both closed and open.
7. **Phone landscape.** Leave used to be `position: sticky` inside the list, so it covered rows. It now sits
   below the service list. On short screens (≤ 500 px tall) the list scrolls in its own box above it, with a
   divider. An e2e test at 812×375 checks that every row scrolls into view, uncovered, above Leave.

**Minor (N after undock):** the take-off effect (0.4 s) dropped every key, so an N pressed straight after Leave
was lost, while G or J pressed a moment later worked. The menu keys (pause, map, mission log, fleet) now work
during take-off. Leave also blurs the focused button. Keyboard input listens on the window, so focus was not
the cause, but the blur is harmless. A controller test covers it.

**Also:** both pages had no favicon link, so desktop Chromium's automatic `/favicon.ico` request 404'd. That
failed the console-error checks in local e2e runs; CI's headless shell never asks for it. Both pages now point
at the existing app icon.

## Decisions to review with the owner

- **L no longer cycles ports.** Pressing L again during the landing autopilot used to pick the next port by
  distance, as in classic Escape Velocity. That ordering moves as the ship flies, which caused bug 1. L now
  sticks to the target and Tab changes it. If you want L-cycling back, it could cycle in a fixed order, starting
  from the targeted port.
- **Cargo reads used / total**, not free / total, because that is how most games show a hold. The sidebar label
  changed from "Cargo free:" to "Cargo:".
- **Hidden systems stay out of the total** until their lane opens. A fresh pilot sees "x/30". The total grows by 1
  (Hushwater), 9 (the Dimming) and 1 (Longlamp) as those lanes open, up to 41, so the card never hints at
  secrets. The
  playtest's "41" counted hidden systems.
- **A new `moon` kind** instead of rewording four descriptions. It is a small schema change. Plug-ins that use
  `planet` or `station` are unaffected.
- **A quiet gossip line** instead of hiding the box, so the bar's layout stays steady (and its phone layout tests
  still hold). It could be hidden instead if you prefer.
- **Zoom buttons moved** to the map's bottom-right corner, instead of padding the map. Padding enough to clear
  the buttons on a phone would have cost about a quarter of the map's width.
- **On short screens, about 2½ service rows show at once**, scrolling above Leave. That trades a scroll for never
  hiding anything. On taller screens nothing changes.
