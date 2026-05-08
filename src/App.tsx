import { useEffect, useMemo, useState } from "react";
import type { CSSProperties, FormEvent } from "react";
import { LANES, type AgentDraftInput, type AgentInfo, type MissionSnapshot, type MissionTask, type ProviderInfo, type ProviderKey, type TaskInput, type TaskLane } from "../shared/types";

type ConnectionState = "connecting" | "live" | "fallback";

type AgentFormState = {
  id?: string;
  name: string;
  role: string;
  provider: ProviderKey | "";
  model: string;
  reasoning: string;
  icon: string;
};

const blankAgentForm: AgentFormState = {
  name: "",
  role: "",
  provider: "",
  model: "",
  reasoning: "",
  icon: "🛰️",
};

const iconChoices = ["🛰️", "🚀", "🛸", "🧭", "🔭", "🌙", "✨", "🌿", "⚙️", "🪐"];

async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json", ...(options?.headers ?? {}) },
    ...options,
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || response.statusText);
  }
  return response.json() as Promise<T>;
}

function statusLabel(status: string): string {
  if (status === "busy") return "In orbit";
  if (status === "recent") return "Recently active";
  if (status === "idle") return "Idle beacon";
  if (status === "available") return "Available";
  if (status === "unavailable") return "Unavailable";
  return "Unknown";
}

function sourceLabel(source: string): string {
  return source.replace(/^~\/\.openclaw\//, "~/.openclaw/").replace(/\//g, " › ");
}

function App() {
  const [snapshot, setSnapshot] = useState<MissionSnapshot | null>(null);
  const [connection, setConnection] = useState<ConnectionState>("connecting");
  const [agentForm, setAgentForm] = useState<AgentFormState>(blankAgentForm);
  const [taskForm, setTaskForm] = useState<TaskInput>({ title: "", lane: "Planned", description: "" });
  const [notice, setNotice] = useState<string>("");

  useEffect(() => {
    let active = true;
    api<MissionSnapshot>("/api/snapshot")
      .then((data) => {
        if (active) setSnapshot(data);
      })
      .catch((error) => {
        setNotice(`Initial snapshot failed: ${error instanceof Error ? error.message : "unknown error"}`);
        setConnection("fallback");
      });

    const events = new EventSource("/api/events");
    events.addEventListener("open", () => setConnection("live"));
    events.addEventListener("snapshot", (event) => {
      const data = JSON.parse((event as MessageEvent).data) as { snapshot: MissionSnapshot; reason: string };
      setSnapshot(data.snapshot);
      setConnection("live");
    });
    events.addEventListener("error", () => setConnection("fallback"));

    return () => {
      active = false;
      events.close();
    };
  }, []);

  const providers = snapshot?.providers ?? [];
  const availableProviders = providers.filter((provider) => provider.status === "available");
  const selectedProvider = providers.find((provider) => provider.id === agentForm.provider);
  const availableModels = selectedProvider?.models.filter((model) => model.available) ?? [];

  const stats = useMemo(() => {
    const agents = snapshot?.agents ?? [];
    const tasks = snapshot?.tasks ?? [];
    return {
      busyAgents: agents.filter((agent) => agent.status === "busy").length,
      activeAgents: agents.filter((agent) => agent.status === "busy" || agent.status === "recent").length,
      availableProviders: providers.filter((provider) => provider.status === "available").length,
      activeTasks: tasks.filter((task) => task.lane === "In Progress" || task.lane === "Waiting/Blocked" || task.lane === "Review").length,
    };
  }, [providers, snapshot]);

  function editAgent(agent: AgentInfo) {
    setAgentForm({
      id: agent.id,
      name: agent.name,
      role: agent.role,
      provider: agent.provider === "unknown" ? "" : agent.provider,
      model: agent.model === "unknown" ? "" : agent.model,
      reasoning: agent.reasoning ?? "",
      icon: agent.icon,
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function providerChanged(providerId: ProviderKey | "") {
    const provider = providers.find((candidate) => candidate.id === providerId);
    const firstModel = provider?.models.find((model) => model.available)?.id ?? "";
    setAgentForm((form) => ({ ...form, provider: providerId, model: firstModel }));
  }

  async function saveAgent(event: FormEvent) {
    event.preventDefault();
    if (!agentForm.provider) return;
    const payload: AgentDraftInput = {
      id: agentForm.id,
      name: agentForm.name,
      role: agentForm.role,
      provider: agentForm.provider,
      model: agentForm.model,
      reasoning: agentForm.reasoning || undefined,
      icon: agentForm.icon || undefined,
    };
    const path = agentForm.id ? `/api/agents/${encodeURIComponent(agentForm.id)}` : "/api/agents";
    await api(path, { method: agentForm.id ? "PATCH" : "POST", body: JSON.stringify(payload) });
    setNotice(`${payload.name} saved as a local draft. OpenClaw runtime config was not changed.`);
    setAgentForm(blankAgentForm);
  }

  async function addTask(event: FormEvent) {
    event.preventDefault();
    if (!taskForm.title.trim()) return;
    await api<MissionTask>("/api/tasks", { method: "POST", body: JSON.stringify(taskForm) });
    setNotice("Task added to the local mission board.");
    setTaskForm({ title: "", lane: "Planned", description: "" });
  }

  if (!snapshot) {
    return (
      <main className="app-shell loading-shell">
        <div className="loader-orb" />
        <h1>Booting Agent Mission Control…</h1>
        <p>Reading local OpenClaw status without exposing secrets.</p>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <section className="hero panel">
        <div>
          <p className="eyebrow">Local-only • 127.0.0.1 by default • no secret display</p>
          <h1>Agent Mission Control</h1>
          <p className="hero-copy">A living room for Jarvis, Friday, Tadashi, subagents, providers, and mission workstreams.</p>
          <div className="hero-actions">
            <span className={`live-pill ${connection}`}>{connection === "live" ? "Live SSE" : connection === "connecting" ? "Connecting" : "Polling fallback"}</span>
            <span>{snapshot.environment.boundTo}:{snapshot.environment.port}</span>
            <span>Last refresh {new Date(snapshot.environment.lastRefresh).toLocaleTimeString()}</span>
          </div>
        </div>
        <MissionEnvironment agents={snapshot.agents} stats={stats} />
      </section>

      {notice && (
        <button className="notice" onClick={() => setNotice("")} type="button">
          {notice}
        </button>
      )}

      <section className="top-grid">
        <AgentComposer
          form={agentForm}
          providers={availableProviders}
          selectedProvider={selectedProvider}
          availableModels={availableModels}
          onChange={setAgentForm}
          onProviderChange={providerChanged}
          onSubmit={saveAgent}
          onCancel={() => setAgentForm(blankAgentForm)}
        />
        <EnvironmentPanel snapshot={snapshot} />
        <SearchStrategyPanel snapshot={snapshot} />
      </section>

      <section className="section-heading">
        <div>
          <p className="eyebrow">Roster</p>
          <h2>Agents and beacons</h2>
        </div>
        <span>{snapshot.agents.length} tracked</span>
      </section>
      <AgentGrid agents={snapshot.agents} onEdit={editAgent} />

      <section className="section-heading">
        <div>
          <p className="eyebrow">Providers</p>
          <h2>Auth and model capability</h2>
        </div>
        <span>{stats.availableProviders}/{providers.length} available</span>
      </section>
      <ProviderGrid providers={providers} />

      <section className="section-heading">
        <div>
          <p className="eyebrow">Task Board</p>
          <h2>High-level workstream map</h2>
        </div>
        <span>{snapshot.tasks.length} cards from docs, memory, logs, and local tasks</span>
      </section>
      <TaskComposer form={taskForm} onChange={setTaskForm} onSubmit={addTask} />
      <TaskBoard tasks={snapshot.tasks} />
    </main>
  );
}

function MissionEnvironment({ agents, stats }: { agents: AgentInfo[]; stats: { busyAgents: number; activeAgents: number; availableProviders: number; activeTasks: number } }) {
  const coreIds = new Set(["jarvis", "friday", "tadashi"]);
  const featured = [
    ...agents.filter((agent) => coreIds.has(agent.id)),
    ...agents.filter((agent) => agent.kind === "subagent" && (agent.status === "busy" || agent.status === "recent")),
    ...agents.filter((agent) => !coreIds.has(agent.id) && agent.kind !== "subagent"),
  ].filter((agent, index, list) => list.findIndex((candidate) => candidate.id === agent.id) === index).slice(0, 6);

  return (
    <div className="environment-card" aria-label="Animated agent habitat showing live agent state">
      <div className="habitat-sky" />
      <div className="moon" />
      <div className="habitat-window" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
      <div className="habitat-board" aria-hidden="true">
        <strong>Mission board</strong>
        <i />
        <i />
        <i />
      </div>
      <div className="habitat-floor" />
      <div className="habitat-path" aria-hidden="true" />
      {featured.map((agent, index) => <HabitatAgent key={agent.id} agent={agent} index={index} />)}
      <div className="environment-stats">
        <strong>{stats.busyAgents}</strong><span>busy</span>
        <strong>{stats.availableProviders}</strong><span>providers</span>
        <strong>{stats.activeTasks}</strong><span>active tasks</span>
      </div>
      <div className="habitat-caption">State-driven diorama · work, check in, rest</div>
    </div>
  );
}

type AgentBehavior = "busy" | "recent" | "idle" | "unknown";

function behaviorForStatus(status: AgentInfo["status"]): { key: AgentBehavior; label: string } {
  if (status === "busy") return { key: "busy", label: "working at a console" };
  if (status === "recent") return { key: "recent", label: "walking the floor" };
  if (status === "idle") return { key: "idle", label: "resting in standby" };
  return { key: "unknown", label: "waiting for signal" };
}

function HabitatAgent({ agent, index }: { agent: AgentInfo; index: number }) {
  const behavior = behaviorForStatus(agent.status);
  return (
    <div
      className={`habitat-agent slot-${index} is-${behavior.key} status-${agent.status}`}
      style={{ "--i": index } as CSSProperties}
      title={`${agent.name}: ${statusLabel(agent.status)} — ${behavior.label}`}
      aria-label={`${agent.name}: ${statusLabel(agent.status)}, ${behavior.label}`}
    >
      <div className="agent-motion">
        <AgentProp behavior={behavior.key} />
        <div className="figurine" aria-hidden="true">
          <span className="figure-head"><span /></span>
          <span className="figure-body"><span className="figure-badge">{agent.icon}</span></span>
          <span className="figure-arm arm-left" />
          <span className="figure-arm arm-right" />
          <span className="figure-leg leg-left" />
          <span className="figure-leg leg-right" />
        </div>
        <span className="figure-shadow" />
        <span className="agent-name-tag">{agent.name}</span>
      </div>
    </div>
  );
}

function AgentProp({ behavior }: { behavior: AgentBehavior }) {
  if (behavior === "busy") {
    return (
      <div className="agent-prop mini-console" aria-hidden="true">
        <span />
        <i />
        <i />
        <i />
      </div>
    );
  }
  if (behavior === "idle") {
    return (
      <div className="agent-prop rest-zone" aria-hidden="true">
        <span className="sleep-bubble" />
        <i className="coffee-cup" />
      </div>
    );
  }
  if (behavior === "recent") {
    return (
      <div className="agent-prop check-board" aria-hidden="true">
        <span />
        <i />
      </div>
    );
  }
  return <div className="agent-prop signal-dish" aria-hidden="true"><span /></div>;
}

function AgentComposer({
  form,
  providers,
  selectedProvider,
  availableModels,
  onChange,
  onProviderChange,
  onSubmit,
  onCancel,
}: {
  form: AgentFormState;
  providers: ProviderInfo[];
  selectedProvider?: ProviderInfo;
  availableModels: ProviderInfo["models"];
  onChange: (form: AgentFormState) => void;
  onProviderChange: (provider: ProviderKey | "") => void;
  onSubmit: (event: FormEvent) => void;
  onCancel: () => void;
}) {
  return (
    <form className="panel composer" onSubmit={onSubmit}>
      <div className="card-title-row">
        <div>
          <p className="eyebrow">Local draft config</p>
          <h2>{form.id ? `Edit ${form.name || form.id}` : "Add or tune an agent"}</h2>
        </div>
        {form.id && <button type="button" className="ghost-button" onClick={onCancel}>New</button>}
      </div>
      <div className="field-row two">
        <label>
          Name
          <input value={form.name} onChange={(event) => onChange({ ...form, name: event.target.value })} placeholder="Navigator" required />
        </label>
        <label>
          Icon
          <select value={form.icon} onChange={(event) => onChange({ ...form, icon: event.target.value })}>
            {iconChoices.map((icon) => <option key={icon} value={icon}>{icon}</option>)}
          </select>
        </label>
      </div>
      <label>
        Role
        <input value={form.role} onChange={(event) => onChange({ ...form, role: event.target.value })} placeholder="Research scout, code reviewer, etc." required />
      </label>
      <div className="field-row two">
        <label>
          Provider
          <select value={form.provider} onChange={(event) => onProviderChange(event.target.value as ProviderKey | "")} required>
            <option value="">Choose an available provider</option>
            {providers.map((provider) => <option key={provider.id} value={provider.id}>{provider.label}</option>)}
          </select>
        </label>
        <label>
          Model
          <select value={form.model} onChange={(event) => onChange({ ...form, model: event.target.value })} required disabled={!selectedProvider || availableModels.length === 0}>
            <option value="">{selectedProvider ? "Choose a model" : "Pick provider first"}</option>
            {availableModels.map((model) => (
              <option key={model.id} value={model.id}>{model.configured ? "★ " : ""}{model.id}</option>
            ))}
          </select>
        </label>
      </div>
      <label>
        Reasoning / notes
        <textarea value={form.reasoning} onChange={(event) => onChange({ ...form, reasoning: event.target.value })} placeholder="Thinking mode, escalation rule, or local note" rows={3} />
      </label>
      <p className="safe-note">Saved to <code>data/agents.local.json</code> only. Runtime OpenClaw config is not mutated.</p>
      <button className="primary-button" type="submit" disabled={!form.provider || !form.model}>Save local agent draft</button>
    </form>
  );
}

function EnvironmentPanel({ snapshot }: { snapshot: MissionSnapshot }) {
  return (
    <aside className="panel environment-panel">
      <p className="eyebrow">Environment</p>
      <h2>Local status</h2>
      <dl>
        <div><dt>API bind</dt><dd>{snapshot.environment.boundTo}:{snapshot.environment.port}</dd></div>
        <div><dt>Model probe</dt><dd className={`probe-${snapshot.environment.modelStatusProbe}`}>{snapshot.environment.modelStatusProbe}</dd></div>
        <div><dt>Workspace</dt><dd title={snapshot.environment.workspaceRoot}>{sourceLabel(snapshot.environment.workspaceRoot)}</dd></div>
        <div><dt>Watched paths</dt><dd>{snapshot.environment.watchedPaths.length}</dd></div>
      </dl>
      <p className="muted">{snapshot.environment.modelStatusMessage}</p>
      <div className="watch-list">
        {snapshot.environment.watchedPaths.slice(0, 6).map((item) => <span key={item}>{sourceLabel(item)}</span>)}
      </div>
    </aside>
  );
}

function SearchStrategyPanel({ snapshot }: { snapshot: MissionSnapshot }) {
  const strategy = snapshot.searchStrategy;
  return (
    <aside className="panel environment-panel strategy-panel">
      <p className="eyebrow">Search + model routing</p>
      <h2>Provider strategy</h2>
      <dl>
        <div><dt>web_search disk route</dt><dd>{strategy.diskProvider ?? "unknown"}</dd></div>
        <div><dt>Search enabled</dt><dd>{strategy.enabled ? "yes" : "no"}</dd></div>
        <div><dt>Brave plugin</dt><dd>{strategy.bravePluginEnabled ? "enabled" : "not enabled"}</dd></div>
      </dl>
      <div className="strategy-callout">
        <strong>{strategy.shortTermRoute}</strong>
        <p>{strategy.recommendation}</p>
      </div>
      <p className="muted">{strategy.durableCandidate}</p>
      <p className="safe-note">{strategy.runtimeNote}</p>
      <small>{sourceLabel(strategy.sourcePath)}</small>
    </aside>
  );
}

function AgentGrid({ agents, onEdit }: { agents: AgentInfo[]; onEdit: (agent: AgentInfo) => void }) {
  return (
    <div className="agent-grid">
      {agents.map((agent) => (
        <article key={agent.id} className={`agent-card panel ${agent.status}`}>
          <div className="card-title-row">
            <div className="agent-identity">
              <div className="agent-icon">{agent.icon}</div>
              <div>
                <h3>{agent.name}</h3>
                <p>{agent.role}</p>
              </div>
            </div>
            <span className={`status-dot ${agent.status}`}>{statusLabel(agent.status)}</span>
          </div>
          <div className="agent-meta">
            <span>{agent.provider}</span>
            <strong>{agent.model}</strong>
          </div>
          {agent.reasoning && <p className="reasoning">{agent.reasoning}</p>}
          <p className="task-summary">{agent.taskSummary}</p>
          <div className="card-footer">
            <span>{sourceLabel(agent.source)}</span>
            {agent.kind !== "subagent" && <button type="button" className="ghost-button" onClick={() => onEdit(agent)}>Edit draft</button>}
          </div>
        </article>
      ))}
    </div>
  );
}

function ProviderGrid({ providers }: { providers: ProviderInfo[] }) {
  return (
    <div className="provider-grid">
      {providers.map((provider) => {
        const configured = provider.models.filter((model) => model.configured).length;
        return (
          <article key={provider.id} className={`provider-card panel ${provider.status}`}>
            <div className="card-title-row">
              <div>
                <h3>{provider.label}</h3>
                <p>{provider.note}</p>
              </div>
              <span className={`status-dot ${provider.status}`}>{statusLabel(provider.status)}</span>
            </div>
            <div className="provider-facts">
              <span>Auth: {provider.auth.present ? provider.auth.source : "missing"}</span>
              <span>{provider.models.filter((model) => model.available).length} models</span>
              <span>{configured} configured</span>
            </div>
            <div className={`strategy-strip ${provider.strategy.priority}`}>
              <strong>{provider.strategy.priority}</strong>
              <span>{provider.strategy.role}</span>
            </div>
            <p className="safe-note">{provider.strategy.recommendation}</p>
            {provider.strategy.caution && <p className="muted">{provider.strategy.caution}</p>}
            <p className="safe-note">{provider.usage.note}</p>
            <div className="model-chips">
              {provider.models.slice(0, 7).map((model) => (
                <span key={model.id} className={model.configured ? "configured" : "candidate"} title={model.note}>{model.configured ? "★ " : ""}{model.id}</span>
              ))}
              {provider.models.length > 7 && <span>+{provider.models.length - 7} more</span>}
            </div>
          </article>
        );
      })}
    </div>
  );
}

function TaskComposer({ form, onChange, onSubmit }: { form: TaskInput; onChange: (form: TaskInput) => void; onSubmit: (event: FormEvent) => void }) {
  return (
    <form className="panel task-composer" onSubmit={onSubmit}>
      <label>
        New local task
        <input value={form.title} onChange={(event) => onChange({ ...form, title: event.target.value })} placeholder="Refine model quota panel" required />
      </label>
      <label>
        Lane
        <select value={form.lane} onChange={(event) => onChange({ ...form, lane: event.target.value as TaskLane })}>
          {LANES.map((lane) => <option key={lane} value={lane}>{lane}</option>)}
        </select>
      </label>
      <label className="wide-field">
        Notes
        <input value={form.description ?? ""} onChange={(event) => onChange({ ...form, description: event.target.value })} placeholder="Optional context" />
      </label>
      <button className="primary-button" type="submit">Add card</button>
    </form>
  );
}

function TaskBoard({ tasks }: { tasks: MissionTask[] }) {
  const tasksByLane = useMemo(() => {
    const result = new Map<TaskLane, MissionTask[]>();
    LANES.forEach((lane) => result.set(lane, []));
    tasks.forEach((task) => result.get(task.lane)?.push(task));
    return result;
  }, [tasks]);

  return (
    <div className="task-board">
      {LANES.map((lane) => (
        <section key={lane} className="lane panel">
          <div className="lane-title"><h3>{lane}</h3><span>{tasksByLane.get(lane)?.length ?? 0}</span></div>
          <div className="task-stack">
            {(tasksByLane.get(lane) ?? []).slice(0, 12).map((task) => (
              <article key={task.id} className={`task-card source-${task.source}`}>
                <div className="task-topline"><strong>{task.id}</strong><span>{task.source}</span></div>
                <h4>{task.title}</h4>
                {task.description && <p>{task.description}</p>}
                <div className="task-tags">
                  {task.owner && <span>{task.owner}</span>}
                  {task.tags.map((tag) => <span key={tag}>{tag}</span>)}
                </div>
                {task.sourcePath && <small>{sourceLabel(task.sourcePath)}</small>}
              </article>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

export default App;
