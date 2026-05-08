export const LANES = ["Backlog", "Planned", "In Progress", "Waiting/Blocked", "Review", "Done"] as const;

export type TaskLane = (typeof LANES)[number];
export type ProviderKey = "nvidia" | "openrouter" | "openai" | "anthropic";
export type AvailabilityStatus = "available" | "unavailable" | "unknown";
export type AgentStatus = "busy" | "idle" | "recent" | "unknown";

export interface ModelOption {
  id: string;
  name: string;
  provider: ProviderKey;
  available: boolean;
  configured: boolean;
  source: "openclaw-status" | "openclaw-catalog" | "v1-candidate" | "local-draft";
  note?: string;
  contextWindow?: number;
}

export interface ProviderInfo {
  id: ProviderKey;
  label: string;
  status: AvailabilityStatus;
  auth: {
    present: boolean;
    source: "env" | "profile" | "synthetic" | "missing" | "mixed" | "unknown";
    checkedAt: string;
  };
  models: ModelOption[];
  usage: {
    status: "not-tracked" | "unknown";
    note: string;
  };
  note?: string;
}

export interface AgentInfo {
  id: string;
  name: string;
  role: string;
  provider: ProviderKey | "unknown";
  model: string;
  reasoning?: string;
  status: AgentStatus;
  taskSummary: string;
  kind: "core" | "draft" | "subagent";
  source: string;
  updatedAt?: string;
  icon: string;
}

export interface MissionTask {
  id: string;
  title: string;
  lane: TaskLane;
  description?: string;
  source: "project-doc" | "task-file" | "memory" | "wiki-log" | "manual";
  sourcePath?: string;
  owner?: string;
  updatedAt?: string;
  tags: string[];
}

export interface EnvironmentStatus {
  host: string;
  port: number;
  boundTo: string;
  workspaceRoot: string;
  openClawRoot: string;
  lastRefresh: string;
  watchedPaths: string[];
  modelStatusProbe: "ok" | "failed" | "skipped";
  modelStatusMessage?: string;
}

export interface MissionSnapshot {
  agents: AgentInfo[];
  providers: ProviderInfo[];
  tasks: MissionTask[];
  environment: EnvironmentStatus;
}

export interface AgentDraftInput {
  id?: string;
  name: string;
  role: string;
  provider: ProviderKey;
  model: string;
  reasoning?: string;
  icon?: string;
}

export interface TaskInput {
  title: string;
  lane?: TaskLane;
  description?: string;
  owner?: string;
  tags?: string[];
}
