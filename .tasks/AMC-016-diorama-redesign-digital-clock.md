# AMC-016 — Redesign home diorama and replace analog wall clock

## Status
In Progress

## Trigger
Akib rejected the current Agent Mission Control character/workspace pass. The current analog wall clock looks wrong; characters do not meet the tactile modern miniature-human reference standard; the workspace does not read like the intended meaningful operations-room diorama.

## Scope
- Replace analog wall clock with a digital real-time clock synchronized to the browser/system time.
- Rework the home habitat into a meaningful miniature operations-room/diorama, not a green hill/planet/decorative blob.
- Upgrade characters toward tactile modern humanoid figurines: clay/plastic-like, rounded, dimensional, simplified but human, outfit/personality cues, no emoji/anime/pixel/mascot drift.
- Make zones legible: work console/status wall, mission/task board, provider/server alcove, walkway, chill/nap nook.
- Preserve dashboard-first IA and keep dense controls outside the home canvas.
- Build, smoke test, capture screenshot, and commit.

## Notes
Backend/database/caching is acceptable if needed for integrity, but not required for the clock. Use backend/persistence only if the mission board/task state needs it; do not overbuild the visual pass.
