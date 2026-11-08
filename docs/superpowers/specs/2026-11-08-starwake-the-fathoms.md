# The Fathoms: a new region (design)

Status: owner chose "A new region" · 2026-11-08

## Goal

Grow the galaxy the way the EV games did, with a region of its own: a government, ports, goods, ships and
outfits, a storyline, and encounters. Base data only (`data/*.json`); no code changes.

## What it adds

| | Added | Totals after |
|---|---|---|
| Systems | 11 (10 open, 1 hidden) | 41 |
| Ports | 13 | 61 |
| Government | the Tideward Guild (`tideward`), with five ranks | 6 |
| Goods | Rime Ice (common), Kelpford Tidesilk (unique to Kelpford Landing) | 16 |
| Ships | Rimehauler (ice freighter), Gannet Cutter (Guild patrol hull) | 16 |
| Outfits | Harpoon Driver, Pressure Plating, Brine Shroud (rank 4), Longlamp Charts (story reward) | 36 |
| Encounters | 4 (a hauler who points the way in, a calving berg, a diver adrift, wreckers' toll) | 19 |
| Story | "The Longlamp", six missions (side arc, chain `longlamp`) | 35 |

**Map.** South of the independent fringe, y 640–1010. Lanes in from Lastlight (to Sounding) and Brackwater (to
Undertow). Sounding, Kelpford and Gullwing are independent; the other seven are the Guild's. Tidehall in Fathom is
the Guild's hub. Longlamp is hidden behind `longlamp-lane`, opened by the fifth mission.

**Story.** Ysolde Marrick, a Guild diver, hires the pilot at Sounding Line. Depth buoys to Tidehall; a scan off
Rimeshelf that turns out to be an ark's lifeboat; three Kelpford weavers ferried home for their song; a wrecker's
claim settled at Gullwing; the marker buoy found at Glimmer, which opens the lane; and the ark itself, the Longlamp.
The reward is a one-off chart sold at Tidehall. Pays 6,000 to 12,000 cr a mission (47,000 in all), inside the
existing pay rules.

## Decisions to review with the owner

1. **Open from the start**, not hidden behind the main story: it is the first region a new pilot can find by
   flying south, and the hauler encounter points the way.
2. **A new government, the Tideward Guild**, with its own ranks and a rank-4 shield at its hub, like the others.
   No rivals, and no Guild patrols (patrols fly Concord hulls today).
3. **The storyline is a side chain** (arc `side`), so it needs no code change and can be played alongside either
   faction arc.
4. **The ark is a hidden system** opened by the story, like Hushwater and the Dimming.
5. **The two new hulls join traffic everywhere** by tech tier, as every non-unique hull does.
