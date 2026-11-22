# Star Map: make active jobs stand out (small change)

**Why:** after taking a first mission on a phone, the owner was lost on the Star Map. A job's destination is marked
by a tiny yellow flag, and the red and amber raider-danger triangles beside many systems drown it out.

**Approved design (owner, Nov 21):**
- **Ring and badge:** every system where one of your jobs or story steps leads gets a bright yellow ring around its
  dot, replacing the tiny flag. When more than one job goes there, a number badge shows how many.
- **Quieter danger marks:** the triangles become smaller and dimmer.
- **Legend:** "◯ Your jobs ▲ Raiders", in the map's corner, shown only while you have a job.
- **"Your jobs" list:** in the map's side panel, each active mission with its destination. Tapping one selects that
  system, so Set course is one tap away.

**Approaches:** the alternative, a HUD arrow in flight, was offered and not picked. Everything is built inside the
existing Star Map (`src/ui/starMap.ts`, `styles.css`), with no new screens.

**Non-goals:** changes in flight or to the HUD, and changing how danger is computed.

**Builder's calls:**
- **Badge and ring colours:** bright lime (#9cff57). Changed from the flag yellow while building, because independent systems are drawn in a near-identical gold and looked like jobs.
- **Legend position:** bottom-left, clear of the bottom-right zoom buttons.
- **List order:** story missions first, then jobs.
- **List row text:** "<title> → <system>", or "→ ?" when the system isn't visible yet.
