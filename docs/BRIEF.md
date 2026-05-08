# Agent Mission Control — Build Brief

## Working Name

**Agent Mission Control** for now. UI direction: playful mission-control / living-system dashboard, not office cubicles.

## Goal

Build a local AI-agent management UI with APIs and real-time updates for Akib's OpenClaw setup. It should let him see agents, providers, models, tasks, status, and configuration without asking Jarvis what is happening.

## Core V1 Functionality

1. **Agent roster**
   - Show Jarvis, Friday, Tadashi, and active subagents.
   - Show each agent's role, configured model, provider, reasoning/thinking mode where available, and busy/idle state.
   - Show current/recent task summary from sessions, memory logs, and task files.

2. **Provider/model availability**
   - Providers: NVIDIA, OpenRouter, OpenAI/OpenAI-Codex, Anthropic/Claude.
   - Show only available providers/models based on runtime auth/config probes.
   - If API keys expire or disappear, hide or mark unavailable.
   - Usage limits are nice-to-have for V1. If unavailable, show capability/auth status instead of faking quota.

3. **Agent/model management UI**
   - Add/edit agent definitions locally.
   - Choose provider/model from dropdown filtered to available providers.
   - No secret display. Only key-present/auth status.
   - V1 may persist proposed/local config separately before applying to OpenClaw runtime config.

4. **Task board**
   - High-level board so Akib can see what work is active without asking.
   - Sources: `memory/YYYY-MM-DD.md`, `wiki/log.md`, `.tasks/` files, project task docs, active session/task summaries.
   - Lanes: Backlog, Planned, In Progress, Waiting/Blocked, Review, Done.
   - Support manual local task creation in V1.

5. **Real-time updates**
   - Local API server bound to `127.0.0.1`.
   - Frontend receives updates via SSE or WebSocket.
   - Watch relevant files/directories and refresh provider/session/task snapshots periodically.

6. **Visual direction**
   - Airbnb-like polish: soft cards, smooth transitions, friendly icons, tasteful gradients, motion that clarifies state.
   - Avoid generic office dashboards.
   - Agents can appear as explorers/rovers/beacons/airships/constellations in a living local environment.
   - Working/deployed/idle states should be visible and charming, not decorative only.

## Non-goals for V1

- No external deployment.
- No cloud database.
- No showing actual API keys or secrets.
- No external writes without Akib approval.
- Do not mutate OpenClaw config blindly. For V1, local draft config is acceptable; applying runtime config can be a guarded action later.
- Do not build a massive plugin system before the dashboard works.

## Suggested Stack

- Vite + React + TypeScript frontend.
- Local Node/TypeScript API server.
- SSE preferred for simple real-time updates.
- File watchers plus safe CLI probes for provider/model status.
- Local JSON persistence for V1 draft agents/tasks.

## Data Sources to Inspect

- `/Users/tinker/.openclaw/workspace/agents/*.md`
- `/Users/tinker/.openclaw/workspace/AGENTS.md`
- `/Users/tinker/.openclaw/workspace/MEMORY.md`
- `/Users/tinker/.openclaw/workspace/memory/*.md`
- `/Users/tinker/.openclaw/workspace/wiki/log.md`
- `/Users/tinker/.openclaw/workspace/projects/*/docs/TASKS.md`
- `/Users/tinker/.openclaw/agents/**/sessions/*.jsonl`
- OpenClaw CLI via `/Users/tinker/lib/node_modules/openclaw/dist/index.js models status --json` if usable; otherwise parse plain output cautiously.

## Acceptance Criteria

- Project has git initialized from day one.
- Project has task files and meaningful commits.
- `npm install` and `npm run build` pass.
- Local app runs on a documented port.
- API exposes at least:
  - `GET /api/agents`
  - `GET /api/providers`
  - `GET /api/tasks`
  - `POST /api/tasks`
  - `GET /api/events` SSE
- UI shows agents, providers/models, task board, and live status updates.
- README documents how to run, architecture, caveats, and next tickets.
