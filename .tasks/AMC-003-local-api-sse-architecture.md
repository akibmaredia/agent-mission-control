# AMC-003 — Local API/SSE Architecture

Owner: Tadashi

## Goal
Design and implement the local API + real-time update loop.

## Required Endpoints
- `GET /api/agents`
- `GET /api/providers`
- `GET /api/tasks`
- `POST /api/tasks`
- `GET /api/events`

## Constraints
- Bind local-only by default.
- Never expose API key values.
- Prefer observable file/config status over guessed state.
- Build must pass before surfacing.
