# Agent Mission Control

Local mission-control dashboard for Akib's OpenClaw setup: agents, provider/model availability, live task state, and local draft agent definitions.

## Status

V1 is local-only and observational by default. It does **not** mutate OpenClaw runtime config, restart Gateway, display API keys, or make external writes.

## Run

```bash
npm install
npm run build
npm start
```

Open: <http://127.0.0.1:4317>

Development mode:

```bash
npm run dev:all
```

- API/SSE: <http://127.0.0.1:4317>
- Vite UI: <http://127.0.0.1:5178>

## Verification

```bash
npm run build
npm run smoke
```

`npm run smoke` boots the built server, checks the required endpoints, verifies SSE emits an event, tests `POST /api/tasks`, and restores the local task persistence file afterward.

## API

- `GET /api/agents` — core agents, local drafts, and recent subagents from OpenClaw traces
- `POST /api/agents` — save a local draft agent definition in `data/agents.local.json`
- `PATCH /api/agents/:id` — update a local draft/override
- `GET /api/providers` — provider auth/capability status without secrets
- `GET /api/tasks` — board cards from project docs, `.tasks/`, memory, wiki log, and local tasks
- `POST /api/tasks` — create a local manual task in `data/tasks.local.json`
- `GET /api/events` — Server-Sent Events stream with live snapshots
- `GET /api/snapshot` — combined UI snapshot
- `GET /api/health` — local health check

## Architecture

```text
server/index.ts
  ├─ probes OpenClaw model status via `openclaw models status --json`
  ├─ parses auth presence from OpenClaw status + ~/.openclaw/.env without returning key values
  ├─ parses agent briefs, session traces, task docs, daily memory, wiki log, local JSON
  ├─ watches relevant local files and emits SSE refreshes
  └─ serves the built Vite app from dist/

src/App.tsx
  ├─ mission-control dashboard shell
  ├─ agent roster + local draft editor
  ├─ provider/model availability cards
  ├─ provider strategy panel
  └─ task board + local task creator
```

## Provider strategy represented in V1

Current policy is surfaced explicitly:

- **NVIDIA** — preferred lightweight/high-limit pool for bounded Friday/Tadashi subagent work when availability remains healthy.
- **OpenRouter** — reserve primarily for Perplexity-backed `web_search` in the short term to avoid burning shared limits on model work.
- **Perplexity via OpenRouter** — current disk `web_search` route, but active runtime may need a later Akib-approved Gateway restart.
- **Brave** — durable search candidate so search does not consume OpenRouter capacity.
- **OpenAI/Codex + Anthropic** — stronger/core pools reserved for senior judgment, implementation fallback, synthesis, and validation.

V1 reports provider auth/capability status only. It does not claim live quota, remaining spend, or rate-limit headroom.

## Data sources

- `/Users/tinker/.openclaw/workspace/agents/*.md`
- `/Users/tinker/.openclaw/workspace/AGENTS.md`
- `/Users/tinker/.openclaw/workspace/memory/*.md`
- `/Users/tinker/.openclaw/workspace/wiki/log.md`
- `/Users/tinker/.openclaw/workspace/projects/*/docs/TASKS.md`
- `/Users/tinker/.openclaw/workspace/projects/*/.tasks/*.md`
- `/Users/tinker/.openclaw/agents/**/sessions/*.trajectory.jsonl`
- `/Users/tinker/.openclaw/openclaw.json` for disk search routing
- OpenClaw CLI model status when available

## Caveats

- Local draft agents are stored separately and are not applied to OpenClaw runtime config.
- Provider availability means auth/config presence, not verified quota generosity.
- Gateway is not restarted by this app or by the build. Disk config and active runtime can differ until Akib explicitly approves a restart later.
- Session summaries intentionally avoid exposing prompt contents.

## Next tickets

- AMC-009 — guarded OpenClaw config apply flow after explicit approval
- AMC-010 — richer usage-limit tracking where provider APIs expose it
- AMC-011 — animated agent environment polish pass
- AMC-012 — Gateway runtime sync indicator after approved restart flow exists
- AMC-013 — Brave-vs-Perplexity search migration evaluation
