# Starwake Editor and plug-ins (design)

Status: approved by the owner ("start the Editor, to see what others come up with") · 2026-11-06

## 1. Goal

Let anyone add to Starwake without touching the code, the way Escape Velocity's plug-ins folder did: new ships,
outfits, goods, systems, ports, encounters and story missions. Players make a **plug-in** in the **Starwake
Editor**, share it as one file, and others turn it on from the game's **Plug-ins** screen. The base game must stay
playable whatever a plug-in contains: a broken plug-in is refused with its errors, never loaded.

It ships in three tested merges:

| Part | What |
|---|---|
| A | The plug-in format, the loader and the in-game Plug-ins screen |
| B | The Editor page: pick a record type, edit records as JSON with live validation, export or install |
| C | Friendlier forms for the common record types, a map view for systems, a guide and a sample plug-in |

## 2. Plug-in format (`.starwake.json`)

```json
{
  "format": "starwake-plugin",
  "formatVersion": 1,
  "id": "rimward-traders",
  "name": "Rimward Traders",
  "version": "1.0.0",
  "author": "Ada",
  "description": "Two new freighters and a fringe port.",
  "data": {
    "ships": [ { "id": "dray", "...": "a whole ship record" } ],
    "outfits": [], "commodities": [], "systems": [], "planets": [], "governments": [],
    "events": [], "missionTypes": [], "encounters": [], "story": []
  }
}
```

- Each list holds **whole records**. A record whose `id` is new is **added**; one whose `id` matches a base
  (or earlier plug-in's) record **replaces** it. That is how a plug-in adds a lane: it replaces the two systems with
  their new `links`.
- Only these list types can be changed. Tunables (`config`, `combat`, `law`, `escorts`, `fleet`, `audio`,
  `factions`, `names`) are not, so a plug-in can't break the game's rules.
- `id`: lowercase letters, digits and dashes. `formatVersion` 1 only; a newer one is refused ("made for a newer
  Starwake").

## 3. Loading

- Plug-ins live in their own IndexedDB store (`starwake-plugins`), each with an `enabled` flag.
- At boot, enabled plug-ins are applied in install order to the raw data, and the result goes through the same
  `parseGameData` validation as the base game. If that fails, the game boots **without any plug-ins** and the
  Plug-ins screen names the problem; no pilot is affected.
- Each plug-in is also checked on its own at import (applied to the base data alone), so a broken file is refused
  at the door with its errors listed.
- Turning a plug-in on or off takes effect on the next start: the screen offers **Restart now**.
- A save that uses plug-in content (a ship, an outfit, a port) can't load while that plug-in is off; the load
  error says which id is missing, as today.

## 4. In-game Plug-ins screen (main menu)

Lists each plug-in (name, version, author, description, what it adds or replaces), an On/Off toggle and Remove,
plus **Import plug-in** (a file picker) and **Open the Editor**. Status lines: "Active", "Off", "Not loaded: …".

## 5. The Editor (`editor.html`, Part B)

A separate page in the same site (works offline like the game). Left: the plug-in's details (id, name, version,
author, description) and the record types with counts. Middle: the records of the chosen type, with New (from a
template, or a copy of any base record) and Delete. Right: the selected record as JSON in an editor with live
validation: errors appear as you type, with the field path. Buttons: **Export** (download `<id>.starwake.json`),
**Import** (open a plug-in file to keep editing) and **Install in the game** (saves it to the Plug-ins store,
turned on). The work in progress is kept in the browser between visits.

## 6. Part C

Forms for ships, outfits, commodities and encounters (fields with ranges and dropdowns for ids); a map view where
a system is placed by dragging; a "How to make a plug-in" guide in How to Play and the README; a sample plug-in.

## 7. Testing

Unit: format validation, apply (add, replace, order), import checks, the store, boot fallback, the editor's model.
E2E: import a plug-in on the Plug-ins screen, restart, see its ship in a shipyard; a broken plug-in is refused;
in the Editor make a ship, install it and find it in the game.

## 8. Decisions to review with the owner

1. **Whole-record add/replace by id**, list types only; no removing base records and no tunables (keeps the base
   game safe and the format simple).
2. **Any broken combination boots the plain game** rather than trying to drop the culprit.
3. **Changes apply on restart**, not live.
4. **The Editor is its own page** in the same site, not a screen inside the game.
5. **Sharing is by file** (export and import); there is no online gallery.
6. **Parts A, B and C shipped as one merge,** so the Plug-ins screen's "Open the Editor" never pointed at a missing page.
7. **Forms are generated from the record** (numbers, text, on/off, dropdowns for references and fixed choices);
   lists and nested parts stay in the JSON view. No per-type hand-made forms, so every record type gets one.
8. **The map edits systems only:** click empty space to place the selected system, click another to toggle a lane
   (both records change; a game system is copied into the plug-in first).
9. **The sample plug-in** ("Sample: Thornwick") is a new system off Skerry with a port, a ship and an outfit.
