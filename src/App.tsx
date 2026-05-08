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

function useLocalClock(): { label: string; iso: string } {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const tick = () => setNow(new Date());
    tick();
    const interval = window.setInterval(tick, 1000);
    return () => window.clearInterval(interval);
  }, []);

  return {
    label: now.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
    iso: now.toISOString(),
  };
}

function agentInitials(name: string): string {
  return name
    .split(/\s+|\//)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("") || "A";
}

type RouteKey = "home" | "agents" | "providers" | "tasks" | "console";

type RouteItem = {
  key: RouteKey;
  path: string;
  label: string;
  description: string;
};

const routeItems: RouteItem[] = [
  { key: "home", path: "/", label: "Home", description: "Living ops room" },
  { key: "agents", path: "/agents", label: "Agents", description: "Roster + drafts" },
  { key: "providers", path: "/providers", label: "Providers", description: "Auth + model pools" },
  { key: "tasks", path: "/tasks", label: "Tasks", description: "Mission board" },
  { key: "console", path: "/console", label: "Console", description: "Dense admin view" },
];

function routeFromPath(pathname: string): RouteKey {
  if (pathname.startsWith("/agents")) return "agents";
  if (pathname.startsWith("/providers")) return "providers";
  if (pathname.startsWith("/tasks")) return "tasks";
  if (pathname.startsWith("/console") || pathname.startsWith("/settings")) return "console";
  return "home";
}

function App() {
  const [snapshot, setSnapshot] = useState<MissionSnapshot | null>(null);
  const [connection, setConnection] = useState<ConnectionState>("connecting");
  const [agentForm, setAgentForm] = useState<AgentFormState>(blankAgentForm);
  const [taskForm, setTaskForm] = useState<TaskInput>({ title: "", lane: "Planned", description: "" });
  const [notice, setNotice] = useState<string>("");
  const [route, setRoute] = useState<RouteKey>(() => routeFromPath(window.location.pathname));
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);

  useEffect(() => {
    const syncRoute = () => setRoute(routeFromPath(window.location.pathname));
    window.addEventListener("popstate", syncRoute);
    return () => window.removeEventListener("popstate", syncRoute);
  }, []);

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

  const selectedAgent = selectedAgentId ? snapshot?.agents.find((agent) => agent.id === selectedAgentId) : undefined;

  function navigate(path: string) {
    const nextRoute = routeFromPath(path);
    if (window.location.pathname !== path) window.history.pushState(null, "", path);
    setRoute(nextRoute);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function fillAgentForm(agent: AgentInfo) {
    setAgentForm({
      id: agent.id,
      name: agent.name,
      role: agent.role,
      provider: agent.provider === "unknown" ? "" : agent.provider,
      model: agent.model === "unknown" ? "" : agent.model,
      reasoning: agent.reasoning ?? "",
      icon: agent.icon,
    });
  }

  function editAgent(agent: AgentInfo) {
    fillAgentForm(agent);
    setSelectedAgentId(null);
    navigate("/agents");
  }

  function openAgent(agent: AgentInfo) {
    fillAgentForm(agent);
    setSelectedAgentId(agent.id);
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
    setSelectedAgentId(null);
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
    <div className="app-shell shell-layout">
      <ShellSidebar route={route} stats={stats} snapshot={snapshot} connection={connection} onNavigate={navigate} />
      <main className="mission-page">
        <PageTopBar route={route} snapshot={snapshot} connection={connection} />
        {notice && (
          <button className="notice" onClick={() => setNotice("")} type="button">
            {notice}
          </button>
        )}

        {route === "home" && (
          <HomePage
            snapshot={snapshot}
            stats={stats}
            connection={connection}
            onNavigate={navigate}
            onSelectAgent={openAgent}
          />
        )}
        {route === "agents" && (
          <AgentsPage
            snapshot={snapshot}
            form={agentForm}
            providers={availableProviders}
            selectedProvider={selectedProvider}
            availableModels={availableModels}
            onChange={setAgentForm}
            onProviderChange={providerChanged}
            onSubmit={saveAgent}
            onCancel={() => setAgentForm(blankAgentForm)}
            onEdit={editAgent}
          />
        )}
        {route === "providers" && <ProvidersPage snapshot={snapshot} stats={stats} />}
        {route === "tasks" && <TasksPage snapshot={snapshot} form={taskForm} onChange={setTaskForm} onSubmit={addTask} />}
        {route === "console" && (
          <ConsolePage
            snapshot={snapshot}
            stats={stats}
            connection={connection}
            form={agentForm}
            providers={availableProviders}
            selectedProvider={selectedProvider}
            availableModels={availableModels}
            taskForm={taskForm}
            onChange={setAgentForm}
            onProviderChange={providerChanged}
            onSubmit={saveAgent}
            onCancel={() => setAgentForm(blankAgentForm)}
            onTaskChange={setTaskForm}
            onTaskSubmit={addTask}
            onEdit={editAgent}
            onSelectAgent={openAgent}
          />
        )}
      </main>
      {selectedAgent && (
        <AgentDetailDrawer
          agent={selectedAgent}
          form={agentForm}
          providers={availableProviders}
          selectedProvider={selectedProvider}
          availableModels={availableModels}
          onChange={setAgentForm}
          onProviderChange={providerChanged}
          onSubmit={saveAgent}
          onClose={() => setSelectedAgentId(null)}
          onOpenRoute={() => {
            setSelectedAgentId(null);
            navigate("/agents");
          }}
        />
      )}
    </div>
  );
}

function ShellSidebar({ route, stats, snapshot, connection, onNavigate }: { route: RouteKey; stats: { busyAgents: number; activeAgents: number; availableProviders: number; activeTasks: number }; snapshot: MissionSnapshot; connection: ConnectionState; onNavigate: (path: string) => void }) {
  return (
    <aside className="sidebar panel">
      <a
        className="sidebar-brand"
        href="/"
        onClick={(event) => {
          event.preventDefault();
          onNavigate("/");
        }}
      >
        <span className="brand-mark" aria-hidden="true" />
        <div>
          <strong>Mission Control</strong>
          <small>Operations room</small>
        </div>
      </a>
      <nav className="sidebar-nav" aria-label="Mission Control sections">
        {routeItems.map((item) => (
          <a
            key={item.key}
            href={item.path}
            className={route === item.key ? "active" : undefined}
            onClick={(event) => {
              event.preventDefault();
              onNavigate(item.path);
            }}
          >
            <strong>{item.label}</strong>
            <span>{item.description}</span>
          </a>
        ))}
      </nav>
      <div className="sidebar-status">
        <span className={`live-pill ${connection}`}>{connection === "live" ? "Live SSE" : connection === "connecting" ? "Connecting" : "Fallback"}</span>
        <div><strong>{stats.activeAgents}</strong><span>active agents</span></div>
        <div><strong>{stats.availableProviders}/{snapshot.providers.length}</strong><span>providers</span></div>
      </div>
    </aside>
  );
}

function PageTopBar({ route, snapshot, connection }: { route: RouteKey; snapshot: MissionSnapshot; connection: ConnectionState }) {
  const activeRoute = routeItems.find((item) => item.key === route) ?? routeItems[0];
  return (
    <header className="page-topbar">
      <div>
        <p className="eyebrow">{activeRoute.description}</p>
        <h2>{activeRoute.label === "Home" ? "Live Mission Room" : activeRoute.label}</h2>
      </div>
      <div className="hero-actions">
        <span className={`live-pill ${connection}`}>{connection === "live" ? "Live SSE" : connection === "connecting" ? "Connecting" : "Polling fallback"}</span>
        <span>{snapshot.environment.boundTo}:{snapshot.environment.port}</span>
        <span>Last refresh {new Date(snapshot.environment.lastRefresh).toLocaleTimeString()}</span>
      </div>
    </header>
  );
}

function HomePage({ snapshot, stats, connection, onNavigate, onSelectAgent }: { snapshot: MissionSnapshot; stats: { busyAgents: number; activeAgents: number; availableProviders: number; activeTasks: number }; connection: ConnectionState; onNavigate: (path: string) => void; onSelectAgent: (agent: AgentInfo) => void }) {
  return (
    <>
      <section className="hero overview-hero panel">
        <div>
          <p className="eyebrow">Local-only • overview first • config on demand</p>
          <h1>Agent Mission Control</h1>
          <p className="hero-copy">A living operations room for Jarvis, Friday, Tadashi, subagents, providers, and mission workstreams.</p>
          <div className="hero-actions">
            <span className={`live-pill ${connection}`}>{connection === "live" ? "Live SSE" : connection === "connecting" ? "Connecting" : "Polling fallback"}</span>
            <span>{stats.activeAgents} active agents</span>
            <span>{stats.activeTasks} active tasks</span>
          </div>
          <div className="overview-actions">
            <button className="primary-button" type="button" onClick={() => onNavigate("/console")}>Open console</button>
            <button className="ghost-button" type="button" onClick={() => onNavigate("/tasks")}>Review tasks</button>
          </div>
        </div>
        <MissionEnvironment agents={snapshot.agents} stats={stats} onSelectAgent={onSelectAgent} />
      </section>

      <OverviewStats snapshot={snapshot} stats={stats} connection={connection} />

      <section className="overview-grid">
        <AgentGlance agents={snapshot.agents} onSelectAgent={onSelectAgent} onNavigate={onNavigate} />
        <TaskGlance tasks={snapshot.tasks} onNavigate={onNavigate} />
        <ProviderGlance providers={snapshot.providers} onNavigate={onNavigate} />
      </section>
    </>
  );
}

function OverviewStats({ snapshot, stats, connection }: { snapshot: MissionSnapshot; stats: { busyAgents: number; activeAgents: number; availableProviders: number; activeTasks: number }; connection: ConnectionState }) {
  const cards = [
    { label: "Agents active", value: `${stats.activeAgents}/${snapshot.agents.length}`, detail: `${stats.busyAgents} working now` },
    { label: "Providers online", value: `${stats.availableProviders}/${snapshot.providers.length}`, detail: "auth/capability presence" },
    { label: "Active tasks", value: stats.activeTasks.toString(), detail: "in progress, waiting, review" },
    { label: "Runtime link", value: connection === "live" ? "Live" : connection === "connecting" ? "Syncing" : "Fallback", detail: `${snapshot.environment.boundTo}:${snapshot.environment.port}` },
  ];
  return (
    <section className="overview-stats" aria-label="Mission status summary">
      {cards.map((card) => (
        <article key={card.label} className="panel stat-card">
          <span>{card.label}</span>
          <strong>{card.value}</strong>
          <p>{card.detail}</p>
        </article>
      ))}
    </section>
  );
}

function AgentGlance({ agents, onSelectAgent, onNavigate }: { agents: AgentInfo[]; onSelectAgent: (agent: AgentInfo) => void; onNavigate: (path: string) => void }) {
  return (
    <article className="panel glance-panel">
      <div className="glance-heading">
        <div>
          <p className="eyebrow">Agents</p>
          <h3>Roster pulse</h3>
        </div>
        <button type="button" className="ghost-button" onClick={() => onNavigate("/agents")}>Manage</button>
      </div>
      <div className="agent-pulse-list">
        {agents.slice(0, 6).map((agent) => (
          <button key={agent.id} type="button" onClick={() => onSelectAgent(agent)}>
            <span className={`mini-status ${agent.status}`} aria-hidden="true"><span>{agentInitials(agent.name)}</span></span>
            <strong>{agent.name}</strong>
            <small>{statusLabel(agent.status)}</small>
          </button>
        ))}
      </div>
    </article>
  );
}

function TaskGlance({ tasks, onNavigate }: { tasks: MissionTask[]; onNavigate: (path: string) => void }) {
  const activeLanes: TaskLane[] = ["In Progress", "Waiting/Blocked", "Review"];
  const activeTasks = tasks.filter((task) => activeLanes.includes(task.lane)).slice(0, 5);
  const laneCounts = LANES.map((lane) => ({ lane, count: tasks.filter((task) => task.lane === lane).length }));
  return (
    <article className="panel glance-panel">
      <div className="glance-heading">
        <div>
          <p className="eyebrow">Tasks</p>
          <h3>Workstream glance</h3>
        </div>
        <button type="button" className="ghost-button" onClick={() => onNavigate("/tasks")}>Open board</button>
      </div>
      <div className="lane-sparkline">
        {laneCounts.map((item) => <span key={item.lane} title={`${item.lane}: ${item.count}`}>{item.count}</span>)}
      </div>
      <div className="task-glance-list">
        {(activeTasks.length ? activeTasks : tasks.slice(0, 4)).map((task) => (
          <div key={task.id}>
            <strong>{task.title}</strong>
            <small>{task.lane} · {task.source}</small>
          </div>
        ))}
      </div>
    </article>
  );
}

function ProviderGlance({ providers, onNavigate }: { providers: ProviderInfo[]; onNavigate: (path: string) => void }) {
  return (
    <article className="panel glance-panel">
      <div className="glance-heading">
        <div>
          <p className="eyebrow">Providers</p>
          <h3>Model pools</h3>
        </div>
        <button type="button" className="ghost-button" onClick={() => onNavigate("/providers")}>Inspect</button>
      </div>
      <div className="provider-glance-list">
        {providers.map((provider) => (
          <div key={provider.id}>
            <span className={`status-dot ${provider.status}`}>{statusLabel(provider.status)}</span>
            <strong>{provider.label}</strong>
            <small>{provider.models.filter((model) => model.available).length} models · {provider.strategy.priority}</small>
          </div>
        ))}
      </div>
    </article>
  );
}

function AgentsPage({ snapshot, form, providers, selectedProvider, availableModels, onChange, onProviderChange, onSubmit, onCancel, onEdit }: { snapshot: MissionSnapshot; form: AgentFormState; providers: ProviderInfo[]; selectedProvider?: ProviderInfo; availableModels: ProviderInfo["models"]; onChange: (form: AgentFormState) => void; onProviderChange: (provider: ProviderKey | "") => void; onSubmit: (event: FormEvent) => void; onCancel: () => void; onEdit: (agent: AgentInfo) => void }) {
  return (
    <>
      <section className="section-heading route-heading">
        <div>
          <p className="eyebrow">Progressive disclosure</p>
          <h2>Agent roster and local draft config</h2>
        </div>
        <span>{snapshot.agents.length} tracked</span>
      </section>
      <section className="agents-route-grid">
        <AgentComposer form={form} providers={providers} selectedProvider={selectedProvider} availableModels={availableModels} onChange={onChange} onProviderChange={onProviderChange} onSubmit={onSubmit} onCancel={onCancel} />
        <AgentGrid agents={snapshot.agents} onEdit={onEdit} />
      </section>
    </>
  );
}

function ProvidersPage({ snapshot, stats }: { snapshot: MissionSnapshot; stats: { availableProviders: number } }) {
  return (
    <>
      <section className="top-grid route-panels">
        <EnvironmentPanel snapshot={snapshot} />
        <SearchStrategyPanel snapshot={snapshot} />
      </section>
      <section className="section-heading route-heading">
        <div>
          <p className="eyebrow">Providers</p>
          <h2>Auth and model capability</h2>
        </div>
        <span>{stats.availableProviders}/{snapshot.providers.length} available</span>
      </section>
      <ProviderGrid providers={snapshot.providers} />
    </>
  );
}

function TasksPage({ snapshot, form, onChange, onSubmit }: { snapshot: MissionSnapshot; form: TaskInput; onChange: (form: TaskInput) => void; onSubmit: (event: FormEvent) => void }) {
  return (
    <>
      <section className="section-heading route-heading">
        <div>
          <p className="eyebrow">Task Board</p>
          <h2>High-level workstream map</h2>
        </div>
        <span>{snapshot.tasks.length} cards from docs, memory, logs, and local tasks</span>
      </section>
      <TaskComposer form={form} onChange={onChange} onSubmit={onSubmit} />
      <TaskBoard tasks={snapshot.tasks} />
    </>
  );
}

function ConsolePage({ snapshot, stats, connection, form, providers, selectedProvider, availableModels, taskForm, onChange, onProviderChange, onSubmit, onCancel, onTaskChange, onTaskSubmit, onEdit, onSelectAgent }: { snapshot: MissionSnapshot; stats: { busyAgents: number; activeAgents: number; availableProviders: number; activeTasks: number }; connection: ConnectionState; form: AgentFormState; providers: ProviderInfo[]; selectedProvider?: ProviderInfo; availableModels: ProviderInfo["models"]; taskForm: TaskInput; onChange: (form: AgentFormState) => void; onProviderChange: (provider: ProviderKey | "") => void; onSubmit: (event: FormEvent) => void; onCancel: () => void; onTaskChange: (form: TaskInput) => void; onTaskSubmit: (event: FormEvent) => void; onEdit: (agent: AgentInfo) => void; onSelectAgent: (agent: AgentInfo) => void }) {
  return (
    <>
      <section className="hero console-hero panel">
        <div>
          <p className="eyebrow">Dense console • secondary route</p>
          <h1>Console</h1>
          <p className="hero-copy">The original all-up admin surface remains here for focused configuration and inspection.</p>
          <div className="hero-actions">
            <span className={`live-pill ${connection}`}>{connection === "live" ? "Live SSE" : connection === "connecting" ? "Connecting" : "Polling fallback"}</span>
            <span>{snapshot.environment.boundTo}:{snapshot.environment.port}</span>
            <span>Last refresh {new Date(snapshot.environment.lastRefresh).toLocaleTimeString()}</span>
          </div>
        </div>
        <MissionEnvironment agents={snapshot.agents} stats={stats} onSelectAgent={onSelectAgent} />
      </section>
      <section className="top-grid">
        <AgentComposer form={form} providers={providers} selectedProvider={selectedProvider} availableModels={availableModels} onChange={onChange} onProviderChange={onProviderChange} onSubmit={onSubmit} onCancel={onCancel} />
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
      <AgentGrid agents={snapshot.agents} onEdit={onEdit} />
      <section className="section-heading">
        <div>
          <p className="eyebrow">Providers</p>
          <h2>Auth and model capability</h2>
        </div>
        <span>{stats.availableProviders}/{snapshot.providers.length} available</span>
      </section>
      <ProviderGrid providers={snapshot.providers} />
      <section className="section-heading">
        <div>
          <p className="eyebrow">Task Board</p>
          <h2>High-level workstream map</h2>
        </div>
        <span>{snapshot.tasks.length} cards from docs, memory, logs, and local tasks</span>
      </section>
      <TaskComposer form={taskForm} onChange={onTaskChange} onSubmit={onTaskSubmit} />
      <TaskBoard tasks={snapshot.tasks} />
    </>
  );
}

function AgentDetailDrawer({ agent, form, providers, selectedProvider, availableModels, onChange, onProviderChange, onSubmit, onClose, onOpenRoute }: { agent: AgentInfo; form: AgentFormState; providers: ProviderInfo[]; selectedProvider?: ProviderInfo; availableModels: ProviderInfo["models"]; onChange: (form: AgentFormState) => void; onProviderChange: (provider: ProviderKey | "") => void; onSubmit: (event: FormEvent) => void; onClose: () => void; onOpenRoute: () => void }) {
  return (
    <div className="drawer-layer" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <aside className="agent-drawer panel" aria-label={`${agent.name} detail and configuration`}>
        <div className="drawer-header">
          <div className="agent-identity">
            <div className="agent-icon">{agent.icon}</div>
            <div>
              <p className="eyebrow">Agent detail</p>
              <h2>{agent.name}</h2>
              <p>{agent.role}</p>
            </div>
          </div>
          <button type="button" className="ghost-button" onClick={onClose}>Close</button>
        </div>
        <div className="drawer-facts">
          <span className={`status-dot ${agent.status}`}>{statusLabel(agent.status)}</span>
          <span>{agent.provider}</span>
          <strong>{agent.model}</strong>
        </div>
        <p className="task-summary">{agent.taskSummary}</p>
        <p className="safe-note">Source: {sourceLabel(agent.source)}</p>
        {agent.kind === "subagent" ? (
          <p className="safe-note">Subagent traces are observational only. Prompt contents stay hidden; configure parent agents from the roster route.</p>
        ) : (
          <div className="drawer-config">
            <div className="glance-heading">
              <div>
                <p className="eyebrow">Local draft</p>
                <h3>Adjust this agent</h3>
              </div>
              <button type="button" className="ghost-button" onClick={onOpenRoute}>Full route</button>
            </div>
            <AgentComposer form={form} providers={providers} selectedProvider={selectedProvider} availableModels={availableModels} onChange={onChange} onProviderChange={onProviderChange} onSubmit={onSubmit} onCancel={onClose} />
          </div>
        )}
      </aside>
    </div>
  );
}

function MissionEnvironment({ agents, stats, onSelectAgent }: { agents: AgentInfo[]; stats: { busyAgents: number; activeAgents: number; availableProviders: number; activeTasks: number }; onSelectAgent?: (agent: AgentInfo) => void }) {
  const clock = useLocalClock();
  const coreIds = new Set(["jarvis", "friday", "tadashi"]);
  const featured = [
    ...agents.filter((agent) => coreIds.has(agent.id)),
    ...agents.filter((agent) => agent.kind === "subagent" && (agent.status === "busy" || agent.status === "recent")),
    ...agents.filter((agent) => !coreIds.has(agent.id) && agent.kind !== "subagent"),
  ].filter((agent, index, list) => list.findIndex((candidate) => candidate.id === agent.id) === index).slice(0, 6);

  return (
    <div className="environment-card" aria-label="Miniature operations-room diorama showing live agent state">
      <div className="habitat-wall" aria-hidden="true" />
      <div className="habitat-room-line" aria-hidden="true" />
      <time className="habitat-digital-clock" dateTime={clock.iso} aria-label={`Local browser time ${clock.label}`}>
        <span>Local time</span>
        <strong>{clock.label}</strong>
      </time>
      <div className="habitat-status-wall" aria-hidden="true">
        <strong>Status wall</strong>
        <span />
        <i />
      </div>
      <div className="habitat-board" aria-hidden="true">
        <strong>Mission board</strong>
        <div><span>Active</span><b>{stats.activeTasks}</b></div>
        <div><span>Busy</span><b>{stats.busyAgents}</b></div>
        <div><span>Providers</span><b>{stats.availableProviders}</b></div>
      </div>
      <div className="habitat-server-alcove" aria-hidden="true">
        <strong>Provider alcove</strong>
        <span />
        <i />
        <i />
        <i />
      </div>
      <div className="habitat-floor" aria-hidden="true" />
      <div className="habitat-path" aria-hidden="true"><span>Walkway</span></div>
      <div className="habitat-console-zone" aria-hidden="true">
        <strong>Work console</strong>
        <span />
        <i />
        <i />
      </div>
      <div className="habitat-lounge" aria-hidden="true">
        <strong>Chill nook</strong>
        <span />
        <i />
      </div>
      <div className="habitat-nap-bed" aria-hidden="true">
        <strong>Nap nook</strong>
        <span />
        <i />
      </div>
      {featured.map((agent, index) => <HabitatAgent key={agent.id} agent={agent} index={index} onSelectAgent={onSelectAgent} />)}
      <div className="environment-stats">
        <strong>{stats.busyAgents}</strong><span>busy</span>
        <strong>{stats.availableProviders}</strong><span>providers</span>
        <strong>{stats.activeTasks}</strong><span>active tasks</span>
      </div>
      <div className="habitat-caption">State-driven ops room · work, regroup, rest</div>
    </div>
  );
}

type AgentBehavior = "busy" | "recent" | "idle" | "unknown";

const figurePalettes = [
  { skin: "#7b513c", hair: "#211d1b", shirt: "#9ea96e", pants: "#253b5d", shoes: "#263356", accent: "#f0e6c8" },
  { skin: "#b88367", hair: "#2a2724", shirt: "#c96855", pants: "#6a625d", shoes: "#1f2630", accent: "#f4bd4f" },
  { skin: "#c49a78", hair: "#5c6468", shirt: "#d8ded8", pants: "#4b6846", shoes: "#664936", accent: "#75a7e8" },
  { skin: "#e0a17e", hair: "#b45e3e", shirt: "#4f93cf", pants: "#ded9c9", shoes: "#202832", accent: "#ffd76b" },
  { skin: "#8c553c", hair: "#171515", shirt: "#e6bf5d", pants: "#d6a84b", shoes: "#22252a", accent: "#f7e9bd" },
  { skin: "#d0a07f", hair: "#3b2b22", shirt: "#8d7bef", pants: "#48596f", shoes: "#2b3040", accent: "#6ed6a7" },
] as const;

function figureStyleForAgent(index: number): CSSProperties {
  const palette = figurePalettes[index % figurePalettes.length];
  return {
    "--i": index,
    "--skin": palette.skin,
    "--hair": palette.hair,
    "--shirt": palette.shirt,
    "--pants": palette.pants,
    "--shoe": palette.shoes,
    "--figure-accent": palette.accent,
  } as CSSProperties;
}

function behaviorForStatus(status: AgentInfo["status"]): { key: AgentBehavior; label: string } {
  if (status === "busy") return { key: "busy", label: "working at a console" };
  if (status === "recent") return { key: "recent", label: "checking the mission board" };
  if (status === "idle") return { key: "idle", label: "resting in standby" };
  return { key: "unknown", label: "waiting for signal" };
}

function HabitatAgent({ agent, index, onSelectAgent }: { agent: AgentInfo; index: number; onSelectAgent?: (agent: AgentInfo) => void }) {
  const behavior = behaviorForStatus(agent.status);
  return (
    <button
      type="button"
      className={`habitat-agent slot-${index} is-${behavior.key} status-${agent.status}`}
      style={figureStyleForAgent(index)}
      title={`${agent.name}: ${statusLabel(agent.status)} — ${behavior.label}`}
      aria-label={`${agent.name}: ${statusLabel(agent.status)}, ${behavior.label}`}
      onClick={() => onSelectAgent?.(agent)}
    >
      <div className="agent-motion">
        <AgentProp behavior={behavior.key} />
        <div className="figurine" aria-hidden="true">
          <span className="figure-neck" />
          <span className="figure-head"><span className="figure-face" /></span>
          <span className="figure-body"><span className="figure-pin" /></span>
          <span className="figure-arm arm-left" />
          <span className="figure-arm arm-right" />
          <span className="figure-hand hand-left" />
          <span className="figure-hand hand-right" />
          <span className="figure-leg leg-left" />
          <span className="figure-leg leg-right" />
          <span className="figure-shoe shoe-left" />
          <span className="figure-shoe shoe-right" />
        </div>
        <span className="figure-shadow" />
        <span className="agent-floor-plaque" aria-hidden="true">{agentInitials(agent.name)}</span>
      </div>
    </button>
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
