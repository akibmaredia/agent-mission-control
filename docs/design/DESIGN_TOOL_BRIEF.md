# Design Tool Brief — Agent Mission Control

Use the reference images in `docs/design/reference/` as the grounding standard.

## What we need from design review

Please critique the current Agent Mission Control UI against the reference standard and propose concrete changes for:

1. **Character design** — make Jarvis, Friday, Tadashi, and subagents feel like tactile modern miniature humans, not flat mascots.
2. **Home diorama/workspace** — turn the scene into a meaningful miniature operations room with work, mission-board, provider/server, walkway, and rest zones.
3. **Mission board** — make the task board feel like a command-board object in the room while preserving useful high-level project/task status.
4. **Visual hierarchy** — keep the home page calm and executive; move dense configuration/admin controls to side routes/drawers.
5. **Clock** — replace the current wrong-looking analog clock with a real-time digital wall clock.

## Hard constraints

- Local-only app.
- Do not expose API keys or secrets.
- Do not mutate OpenClaw runtime config from the UI without explicit approval.
- Preserve current product structure: Vite/React frontend + local Node API server.
