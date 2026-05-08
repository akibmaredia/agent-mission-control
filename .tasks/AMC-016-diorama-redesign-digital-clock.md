# AMC-016 — Redesign home diorama and replace analog wall clock

## Status
Review

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

## Implementation
- Replaced the analog wall clock with a browser/system-time digital wall clock rendered in the home diorama (`LOCAL TIME`, seconds included).
- Reworked the home environment into an interior miniature operations-room: status wall, mission board, provider alcove, work console, walkway, chill nook, and nap nook are visible zone props.
- Removed outdoor/planet residue from the home canvas, including window/door/plant/tree-like props.
- Replaced floating/truncated agent name tags with small floor plaques/initial badges and kept full names available through hover/ARIA/click-to-drawer behavior.
- Pushed figurines further toward tactile rounded clay/plastic mini-humans with simplified facial detail, soft dimensional shading, and status/outfit color cues.
- Replaced visible home roster emoji chips with small mini-figurine initials to avoid emoji mascot drift on the home page.

## Backend / Persistence Decision
No new backend, database, or cache was added. The live clock is pure frontend state (`setInterval` against `Date`) because it only needs browser/system time. Mission-board integrity continues to rely on the existing local API + JSON/task-file sources; no integrity issue was found that justified extra persistence.

## Verification
- `npm run build` — pass
- `npm run smoke` — pass; verified health, agents, providers, tasks, POST `/api/tasks`, and SSE events
- Headless Chrome screenshot captured and visually QA'd

## Artifact
- `artifacts/screenshots/2026-05-08-111449-amc-home-diorama-redesign.png`

## QA Notes
Implementation-side QA passes the requested rubric: digital clock present, analog clock removed, tactile mini-humanoid direction materially improved, purposeful room zones are legible, mission board reads as an in-room board, and no outdoor/tree/planet residue remains. Leave in Review for Jarvis/Friday visual sign-off because Akib's rejection was design-quality driven.
