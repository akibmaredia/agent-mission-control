import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { execFile } from "node:child_process";
import { existsSync, watch, type FSWatcher } from "node:fs";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import crypto from "node:crypto";
import { LANES, type AgentDraftInput, type AgentInfo, type EnvironmentStatus, type MissionSnapshot, type MissionTask, type ModelOption, type ProviderInfo, type ProviderKey, type SearchStrategyInfo, type TaskInput, type TaskLane } from "../shared/types.js";

const execFileAsync = promisify(execFile);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function findProjectRoot(): string {
  const candidates = [process.cwd(), path.resolve(__dirname, ".."), path.resolve(__dirname, "../..")];
  for (const candidate of candidates) {
    if (existsSync(path.join(candidate, "package.json")) && existsSync(path.join(candidate, "docs", "BRIEF.md"))) {
      return candidate;
    }
  }
  return process.cwd();
}

const PROJECT_ROOT = findProjectRoot();
const WORKSPACE_ROOT = process.env.AMC_WORKSPACE_ROOT ?? "/Users/tinker/.openclaw/workspace";
const OPENCLAW_ROOT = process.env.AMC_OPENCLAW_ROOT ?? "/Users/tinker/.openclaw";
const DEFAULT_OPENCLAW_CLI = "/Users/tinker/lib/node_modules/openclaw/dist/index.js";
function resolveOpenClawCli(): string | undefined {
  const candidates = [process.env.OPENCLAW_CLI, DEFAULT_OPENCLAW_CLI].filter((candidate): candidate is string => Boolean(candidate && candidate !== "1"));
  return candidates.find((candidate) => existsSync(candidate));
}
const OPENCLAW_CLI = resolveOpenClawCli();
const HOST = process.env.AMC_HOST ?? "127.0.0.1";
const PORT = Number(process.env.AMC_PORT ?? 4317);
const DATA_DIR = path.join(PROJECT_ROOT, "data");
const AGENT_DRAFTS_PATH = path.join(DATA_DIR, "agents.local.json");
const MANUAL_TASKS_PATH = path.join(DATA_DIR, "tasks.local.json");

const PROVIDERS: Array<{ id: ProviderKey; label: string; authNames: string[]; envKeys: string[] }> = [
  { id: "nvidia", label: "NVIDIA", authNames: ["nvidia"], envKeys: ["NVIDIA_API_KEY"] },
  { id: "openrouter", label: "OpenRouter", authNames: ["openrouter"], envKeys: ["OPENROUTER_API_KEY"] },
  { id: "openai", label: "OpenAI / Codex", authNames: ["openai", "openai-codex"], envKeys: ["OPENAI_API_KEY", "OPENAI_CODEX_API_KEY"] },
  { id: "anthropic", label: "Anthropic / Claude", authNames: ["anthropic", "claude-cli"], envKeys: ["ANTHROPIC_API_KEY"] },
];

const PROVIDER_STRATEGY: Record<ProviderKey, ProviderInfo["strategy"]> = {
  nvidia: {
    role: "High-limit model pool for bounded Friday/Tadashi subagent work.",
    recommendation: "Prefer NVIDIA for lightweight coding/testing/research subagents when auth is present and real-world limits look generous.",
    caution: "V1 can verify auth/catalog presence only; it does not query quota, spend, or remaining limits.",
    priority: "preferred",
  },
  openrouter: {
    role: "Short-term shared route, primarily preserving Perplexity web_search access.",
    recommendation: "Reserve OpenRouter capacity for Perplexity-backed web search unless NVIDIA is unavailable or a specific OpenRouter model is required.",
    caution: "Model work here may consume the same limit pool needed for Perplexity search.",
    priority: "reserved",
  },
  openai: {
    role: "Codex/OpenAI execution pool for core agents and stronger implementation fallback.",
    recommendation: "Use for GPT-5.5/Codex-level engineering work after lightweight/high-limit options are insufficient.",
    caution: "Keep senior/architecture work here; do not burn it on trivial delegated tasks by default.",
    priority: "fallback",
  },
  anthropic: {
    role: "Default strong reasoning/synthesis pool for main-session work and focused fallback.",
    recommendation: "Reserve Claude/Anthropic for judgment-heavy synthesis, repair, and final validation rather than first-pass lightweight tasks.",
    caution: "Configured auth may come from profile/OAuth; values are intentionally hidden.",
    priority: "reserved",
  },
};

interface OpenClawAuthProvider {
  provider?: string;
  effective?: { kind?: string; detail?: string };
  profiles?: { count?: number; oauth?: number; token?: number; apiKey?: number; labels?: string[] };
  syntheticAuth?: { value?: string; source?: string };
}

interface OpenClawStatus {
  defaultModel?: string;
  resolvedDefault?: string;
  allowed?: string[];
  auth?: { providers?: OpenClawAuthProvider[]; missingProvidersInUse?: string[] };
}

interface ProbeResult {
  state: "ok" | "failed" | "skipped";
  data?: OpenClawStatus;
  message?: string;
}

interface SessionSummary {
  owner: string;
  sessionKey?: string;
  provider?: string;
  modelId?: string;
  startedAt?: string;
  endedAt?: string;
  lastAt?: string;
  busy: boolean;
  isSubagent: boolean;
  subagentId?: string;
  file: string;
  probe: boolean;
}

interface LocalAgentDraft extends AgentDraftInput {
  id: string;
  updatedAt: string;
}

let snapshot: MissionSnapshot | undefined;
let probeCache: { expiresAt: number; result: ProbeResult } | undefined;
const sseClients = new Set<ServerResponse>();
const watchers: FSWatcher[] = [];
const watchedPaths = new Set<string>();
let refreshTimer: NodeJS.Timeout | undefined;

const laneSet = new Set<string>(LANES);
const icons = ["🛸", "🛰️", "🚀", "🌙", "🧭", "🔭", "✨", "🌿", "⚙️", "🪐"];

function nowIso(): string {
  return new Date().toISOString();
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64) || crypto.randomUUID().slice(0, 8);
}

function hashId(value: string): string {
  return crypto.createHash("sha1").update(value).digest("hex").slice(0, 10);
}

function normalizeProviderFromModel(model?: string): ProviderKey | "unknown" {
  if (!model) return "unknown";
  if (model.startsWith("anthropic/") || model.startsWith("claude")) return "anthropic";
  if (model.startsWith("openrouter/")) return "openrouter";
  if (model.startsWith("openai/") || model.startsWith("openai-codex/") || model.startsWith("gpt-")) return "openai";
  if (model.startsWith("nvidia/") || model.startsWith("moonshotai/") || model.startsWith("minimaxai/") || model.startsWith("z-ai/")) return "nvidia";
  return "unknown";
}

function normalizeLane(value?: string): TaskLane {
  if (!value) return "Planned";
  const cleaned = value.trim().replace(/\s+/g, " ");
  const found = LANES.find((lane) => lane.toLowerCase() === cleaned.toLowerCase());
  if (found) return found;
  if (/block|wait/i.test(cleaned)) return "Waiting/Blocked";
  if (/progress|doing|active/i.test(cleaned)) return "In Progress";
  if (/done|complete|shipped/i.test(cleaned)) return "Done";
  return "Planned";
}

function stripMarkdown(value: string): string {
  return value
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[#>*_]/g, "")
    .trim();
}

function relativeToWorkspace(filePath: string): string {
  if (filePath.startsWith(WORKSPACE_ROOT)) return path.relative(WORKSPACE_ROOT, filePath);
  if (filePath.startsWith(PROJECT_ROOT)) return path.relative(PROJECT_ROOT, filePath);
  if (filePath.startsWith(OPENCLAW_ROOT)) return path.join("~/.openclaw", path.relative(OPENCLAW_ROOT, filePath));
  return filePath;
}

async function readText(filePath: string): Promise<string | undefined> {
  try {
    return await readFile(filePath, "utf8");
  } catch {
    return undefined;
  }
}

async function readJsonFile<T>(filePath: string, fallback: T): Promise<T> {
  try {
    const text = await readFile(filePath, "utf8");
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}

async function writeJsonFile<T>(filePath: string, value: T): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function ensureDataFiles(): Promise<void> {
  await mkdir(DATA_DIR, { recursive: true });
  if (!existsSync(AGENT_DRAFTS_PATH)) await writeJsonFile<LocalAgentDraft[]>(AGENT_DRAFTS_PATH, []);
  if (!existsSync(MANUAL_TASKS_PATH)) await writeJsonFile<MissionTask[]>(MANUAL_TASKS_PATH, []);
}

async function listFiles(root: string, predicate: (filePath: string) => boolean, max = 500): Promise<string[]> {
  const found: string[] = [];
  async function walk(dir: string): Promise<void> {
    if (found.length >= max) return;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (found.length >= max) break;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name === ".git" || entry.name === "dist" || entry.name === "dist-server") continue;
        await walk(full);
      } else if (entry.isFile() && predicate(full)) {
        found.push(full);
      }
    }
  }
  await walk(root);
  return found;
}

async function readEnvPresence(): Promise<Record<string, boolean>> {
  const envPath = path.join(OPENCLAW_ROOT, ".env");
  const text = await readText(envPath);
  const result: Record<string, boolean> = {};
  if (!text) return result;
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    const value = rawValue.replace(/^['"]|['"]$/g, "").trim();
    result[key] = value.length > 0;
  }
  return result;
}

async function getOpenClawStatus(): Promise<ProbeResult> {
  const now = Date.now();
  if (probeCache && probeCache.expiresAt > now) return probeCache.result;

  if (!OPENCLAW_CLI || !existsSync(OPENCLAW_CLI)) {
    const skipped: ProbeResult = { state: "skipped", message: "OpenClaw CLI not found at configured path." };
    probeCache = { expiresAt: now + 60_000, result: skipped };
    return skipped;
  }

  try {
    const { stdout } = await execFileAsync(process.execPath, [OPENCLAW_CLI, "models", "status", "--json"], {
      timeout: 8_000,
      maxBuffer: 1024 * 1024 * 2,
      env: process.env,
    });
    const raw = stdout.toString();
    const jsonStart = raw.indexOf("{");
    const jsonEnd = raw.lastIndexOf("}");
    if (jsonStart < 0 || jsonEnd < jsonStart) throw new Error("No JSON object returned");
    const parsed = JSON.parse(raw.slice(jsonStart, jsonEnd + 1)) as OpenClawStatus;
    const ok: ProbeResult = { state: "ok", data: parsed, message: "OpenClaw model status probe succeeded." };
    probeCache = { expiresAt: now + 60_000, result: ok };
    return ok;
  } catch (error) {
    const failed: ProbeResult = {
      state: "failed",
      message: error instanceof Error ? `OpenClaw model status probe failed: ${error.message}` : "OpenClaw model status probe failed.",
    };
    probeCache = { expiresAt: now + 30_000, result: failed };
    return failed;
  }
}

function authSourceFromKinds(kinds: Set<string>): ProviderInfo["auth"]["source"] {
  if (kinds.size === 0) return "missing";
  const normalized = new Set<string>();
  for (const kind of kinds) {
    if (kind === "profiles") normalized.add("profile");
    else if (kind === "env") normalized.add("env");
    else if (kind === "synthetic") normalized.add("synthetic");
    else normalized.add(kind);
  }
  if (normalized.size > 1) return "mixed";
  const [only] = [...normalized];
  if (only === "profile" || only === "env" || only === "synthetic" || only === "missing" || only === "unknown") return only;
  return "unknown";
}

async function readCatalogModels(provider: ProviderKey): Promise<ModelOption[]> {
  const pluginDir = path.join("/Users/tinker/lib/node_modules/openclaw/dist/extensions");
  const models: ModelOption[] = [];

  if (provider === "nvidia") {
    const text = await readText(path.join(pluginDir, "nvidia", "openclaw.plugin.json"));
    if (text) {
      const data = JSON.parse(text) as { modelCatalog?: { providers?: Record<string, { models?: Array<{ id: string; name?: string; contextWindow?: number }> }> } };
      for (const model of data.modelCatalog?.providers?.nvidia?.models ?? []) {
        models.push({
          id: model.id,
          name: model.name ?? model.id,
          provider,
          available: true,
          configured: false,
          source: "openclaw-catalog",
          contextWindow: model.contextWindow,
          note: "Static OpenClaw NVIDIA catalog; auth is checked separately.",
        });
      }
    }
  }

  if (provider === "openai") {
    const text = await readText(path.join(pluginDir, "openai", "openclaw.plugin.json"));
    if (text) {
      const data = JSON.parse(text) as { modelCatalog?: { providers?: Record<string, { models?: Array<{ id: string; name?: string; contextWindow?: number }> }> } };
      for (const providerName of ["openai", "openai-codex"] as const) {
        for (const model of data.modelCatalog?.providers?.[providerName]?.models ?? []) {
          const id = model.id.includes("/") ? model.id : `${providerName}/${model.id}`;
          models.push({
            id,
            name: model.name ?? id,
            provider,
            available: true,
            configured: false,
            source: "openclaw-catalog",
            contextWindow: model.contextWindow,
            note: "Static OpenClaw OpenAI/Codex catalog; auth is checked separately.",
          });
        }
      }
    }
  }

  if (provider === "anthropic") {
    for (const id of [
      "anthropic/claude-opus-4-7",
      "anthropic/claude-sonnet-4-6",
      "anthropic/claude-opus-4-6",
      "anthropic/claude-haiku-4-5",
    ]) {
      models.push({ id, name: id.replace("anthropic/", ""), provider, available: true, configured: false, source: "v1-candidate", note: "Known Claude model candidate; OpenClaw allowed models are preferred when present." });
    }
  }

  if (provider === "openrouter") {
    for (const id of [
      "openrouter/qwen/qwen3-coder",
      "openrouter/qwen/qwen-2.5-coder-32b-instruct",
      "openrouter/google/gemma-3-27b-it",
      "openrouter/deepseek/deepseek-v3.2",
    ]) {
      models.push({ id, name: id.replace("openrouter/", ""), provider, available: true, configured: false, source: "v1-candidate", note: "OpenRouter auth-present candidate; V1 does not query quota or full catalog." });
    }
  }

  return models;
}

function modelOptionFromAllowed(id: string, provider: ProviderKey): ModelOption {
  return {
    id,
    name: id.split("/").slice(1).join("/") || id,
    provider,
    available: true,
    configured: true,
    source: "openclaw-status",
    note: "Configured in OpenClaw model status.",
  };
}

async function collectSearchStrategy(): Promise<SearchStrategyInfo> {
  const configPath = path.join(OPENCLAW_ROOT, "openclaw.json");
  const text = await readText(configPath);
  let enabled = false;
  let diskProvider: string | undefined;
  let bravePluginEnabled = false;

  if (text) {
    try {
      const config = JSON.parse(text) as {
        tools?: { web?: { search?: { provider?: string; enabled?: boolean } } };
        plugins?: { entries?: Record<string, { enabled?: boolean }> };
      };
      enabled = Boolean(config.tools?.web?.search?.enabled);
      diskProvider = config.tools?.web?.search?.provider;
      bravePluginEnabled = Boolean(config.plugins?.entries?.brave?.enabled);
    } catch {
      // Keep the policy panel useful even if config parsing fails.
    }
  }

  const shortTermRoute = diskProvider === "perplexity"
    ? "Perplexity via OpenRouter for web_search"
    : diskProvider
      ? `${diskProvider} for web_search`
      : "No web_search provider detected in disk config";

  return {
    enabled,
    diskProvider,
    bravePluginEnabled,
    shortTermRoute,
    durableCandidate: bravePluginEnabled ? "Brave search is enabled in disk config and is the durable candidate to avoid OpenRouter search-limit burn." : "Brave search is the durable candidate, but disk config does not show it enabled yet.",
    runtimeNote: "Do not restart Gateway during this build. Disk config may differ from active runtime until Akib approves a later Gateway restart.",
    recommendation: "Prefer NVIDIA for lightweight/high-limit model work when availability remains healthy; reserve OpenRouter primarily for Perplexity web_search in the short term.",
    sourcePath: relativeToWorkspace(configPath),
  };
}

async function collectProviders(): Promise<{ providers: ProviderInfo[]; probe: ProbeResult }> {
  const checkedAt = nowIso();
  const [envPresence, probe] = await Promise.all([readEnvPresence(), getOpenClawStatus()]);
  const authProviders = probe.data?.auth?.providers ?? [];
  const allowed = probe.data?.allowed ?? [];
  const result: ProviderInfo[] = [];

  for (const providerDef of PROVIDERS) {
    const sourceKinds = new Set<string>();
    const envPresent = providerDef.envKeys.some((key) => envPresence[key]);
    if (envPresent) sourceKinds.add("env");

    for (const authName of providerDef.authNames) {
      const entry = authProviders.find((candidate) => candidate.provider === authName);
      if (!entry) continue;
      if (entry.syntheticAuth) sourceKinds.add("synthetic");
      const effectiveKind = entry.effective?.kind;
      if (effectiveKind && effectiveKind !== "missing") sourceKinds.add(effectiveKind === "profiles" ? "profile" : effectiveKind);
      if ((entry.profiles?.count ?? 0) > 0) sourceKinds.add("profile");
    }

    const authPresent = sourceKinds.size > 0;
    const providerAllowedModels = allowed.filter((model) => {
      if (providerDef.id === "anthropic") return model.startsWith("anthropic/");
      if (providerDef.id === "openrouter") return model.startsWith("openrouter/");
      if (providerDef.id === "openai") return model.startsWith("openai/") || model.startsWith("openai-codex/");
      if (providerDef.id === "nvidia") return normalizeProviderFromModel(model) === "nvidia";
      return false;
    });

    const seenModels = new Set<string>();
    const models: ModelOption[] = [];
    for (const id of providerAllowedModels) {
      if (!seenModels.has(id)) {
        seenModels.add(id);
        models.push(modelOptionFromAllowed(id, providerDef.id));
      }
    }

    if (authPresent) {
      for (const model of await readCatalogModels(providerDef.id)) {
        if (!seenModels.has(model.id)) {
          seenModels.add(model.id);
          models.push({ ...model, available: true });
        }
      }
    }

    result.push({
      id: providerDef.id,
      label: providerDef.label,
      status: authPresent ? "available" : "unavailable",
      auth: { present: authPresent, source: authSourceFromKinds(sourceKinds), checkedAt },
      models: models.map((model) => ({ ...model, available: authPresent && model.available })),
      usage: { status: "not-tracked", note: providerDef.id === "nvidia" ? "Quota/limit generosity is not measurable in V1; treat NVIDIA as preferred only after observed availability stays healthy." : "V1 does not query provider quota/limits; this panel reports auth and capability status only." },
      strategy: PROVIDER_STRATEGY[providerDef.id],
      note: authPresent
        ? "Auth material is present via environment/profile; API key values are never returned."
        : "No auth material found for this provider in .env or OpenClaw model status.",
    });
  }

  return { providers: result, probe };
}

async function collectSessionSummaries(): Promise<SessionSummary[]> {
  const sessionsRoot = path.join(OPENCLAW_ROOT, "agents");
  const files = await listFiles(sessionsRoot, (file) => file.endsWith(".trajectory.jsonl"), 1000);
  const withStats = await Promise.all(
    files.map(async (file) => {
      try {
        const info = await stat(file);
        return { file, mtimeMs: info.mtimeMs };
      } catch {
        return { file, mtimeMs: 0 };
      }
    }),
  );

  const recent = withStats.sort((a, b) => b.mtimeMs - a.mtimeMs).slice(0, 120);
  const summaries: SessionSummary[] = [];

  for (const { file, mtimeMs } of recent) {
    const text = await readText(file);
    if (!text) continue;
    const rel = path.relative(path.join(OPENCLAW_ROOT, "agents"), file).split(path.sep);
    const owner = rel[0] ?? "main";
    const base = path.basename(file);
    const probe = base.startsWith("probe-");
    let sessionKey: string | undefined;
    let provider: string | undefined;
    let modelId: string | undefined;
    let startedAt: string | undefined;
    let endedAt: string | undefined;
    let lastAt: string | undefined;

    for (const line of text.trim().split(/\r?\n/)) {
      if (!line.trim()) continue;
      try {
        const event = JSON.parse(line) as { type?: string; ts?: string; sessionKey?: string; provider?: string; modelId?: string };
        if (event.sessionKey) sessionKey = event.sessionKey;
        if (event.provider) provider = event.provider;
        if (event.modelId) modelId = event.modelId;
        if (event.ts) lastAt = event.ts;
        if (event.type === "session.started" && event.ts) startedAt = event.ts;
        if (event.type === "session.ended" && event.ts) endedAt = event.ts;
      } catch {
        // Ignore malformed trace rows.
      }
    }

    const subagentMatch = sessionKey?.match(/agent:([^:]+):subagent:([^:]+)/);
    const staleMs = Date.now() - mtimeMs;
    summaries.push({
      owner,
      sessionKey,
      provider,
      modelId,
      startedAt,
      endedAt,
      lastAt,
      busy: !endedAt && staleMs < 2 * 60 * 60 * 1000,
      isSubagent: Boolean(subagentMatch),
      subagentId: subagentMatch?.[2],
      file,
      probe,
    });
  }

  return summaries;
}

function summarizeSession(session?: SessionSummary): string {
  if (!session) return "No recent session trace found.";
  const model = [session.provider, session.modelId].filter(Boolean).join("/") || "model unknown";
  const when = session.lastAt ? new Date(session.lastAt).toLocaleString() : "recently";
  return `${session.busy ? "Active" : "Last"} local run ${session.busy ? "on" : "seen"} ${when} using ${model}.`;
}

async function parseAgentFile(file: string): Promise<Partial<AgentInfo>> {
  const text = await readText(file);
  if (!text) return {};
  const name = text.match(/\*\*Name:\*\*\s*([^\n]+)/)?.[1]?.trim();
  const role = text.match(/\*\*Role:\*\*\s*([^\n]+)/)?.[1]?.trim();
  const model = text.match(/\*\*Primary model:\*\*\s*`([^`]+)`/)?.[1]?.trim();
  const reasoning = text.match(/\*\*Reasoning:\*\*\s*([^\n]+)/)?.[1]?.trim() ?? (text.match(/Reasoning:\*\*\s*([^\n]+)/)?.[1]?.trim());
  return { name, role, model, provider: normalizeProviderFromModel(model), reasoning, source: relativeToWorkspace(file) };
}

async function loadAgentDrafts(): Promise<LocalAgentDraft[]> {
  return readJsonFile<LocalAgentDraft[]>(AGENT_DRAFTS_PATH, []);
}

async function saveAgentDraft(input: AgentDraftInput, explicitId?: string): Promise<LocalAgentDraft> {
  const drafts = await loadAgentDrafts();
  const id = explicitId ?? input.id ?? slugify(input.name);
  const existingIndex = drafts.findIndex((draft) => draft.id === id);
  const draft: LocalAgentDraft = {
    id,
    name: input.name.trim(),
    role: input.role.trim(),
    provider: input.provider,
    model: input.model.trim(),
    reasoning: input.reasoning?.trim(),
    icon: input.icon?.trim(),
    updatedAt: nowIso(),
  };
  if (existingIndex >= 0) drafts[existingIndex] = draft;
  else drafts.push(draft);
  await writeJsonFile(AGENT_DRAFTS_PATH, drafts);
  return draft;
}

async function collectAgents(providers: ProviderInfo[], sessions: SessionSummary[], probe: ProbeResult): Promise<AgentInfo[]> {
  const providerDefault = normalizeProviderFromModel(probe.data?.resolvedDefault ?? probe.data?.defaultModel);
  const latestByOwner = new Map<string, SessionSummary>();
  for (const session of sessions.filter((candidate) => !candidate.isSubagent && !candidate.probe)) {
    if (!latestByOwner.has(session.owner)) latestByOwner.set(session.owner, session);
  }

  const core: AgentInfo[] = [];
  const jarvisModel = probe.data?.resolvedDefault ?? probe.data?.defaultModel ?? "unknown";
  core.push({
    id: "jarvis",
    name: "Jarvis",
    role: "Supervisor, strategist, and direct interface with Akib",
    provider: providerDefault,
    model: jarvisModel,
    reasoning: "Main-session reasoning follows OpenClaw runtime settings.",
    status: latestByOwner.get("main")?.busy ? "busy" : latestByOwner.get("main") ? "recent" : "unknown",
    taskSummary: summarizeSession(latestByOwner.get("main")),
    kind: "core",
    source: "AGENTS.md + OpenClaw model status",
    updatedAt: latestByOwner.get("main")?.lastAt,
    icon: "🛰️",
  });

  const friday = await parseAgentFile(path.join(WORKSPACE_ROOT, "agents", "FRIDAY.md"));
  const tadashi = await parseAgentFile(path.join(WORKSPACE_ROOT, "agents", "TADASHI.md"));
  for (const [id, parsed, fallbackIcon] of [
    ["friday", friday, "🧭"],
    ["tadashi", tadashi, "🚀"],
  ] as const) {
    const latest = latestByOwner.get(id);
    core.push({
      id,
      name: parsed.name ?? id[0].toUpperCase() + id.slice(1),
      role: parsed.role ?? (id === "friday" ? "Operations and coordination" : "Engineering and technical lead"),
      provider: parsed.provider ?? "unknown",
      model: parsed.model ?? "unknown",
      reasoning: parsed.reasoning,
      status: latest?.busy ? "busy" : latest ? "recent" : "idle",
      taskSummary: summarizeSession(latest),
      kind: "core",
      source: parsed.source ?? `agents/${id.toUpperCase()}.md`,
      updatedAt: latest?.lastAt,
      icon: fallbackIcon,
    });
  }

  const drafts = await loadAgentDrafts();
  const byId = new Map(core.map((agent) => [agent.id, agent]));
  for (const draft of drafts) {
    const existing = byId.get(draft.id);
    const modelProviderAvailable = providers.find((provider) => provider.id === draft.provider)?.status === "available";
    const agent: AgentInfo = {
      id: draft.id,
      name: draft.name,
      role: draft.role,
      provider: draft.provider,
      model: draft.model,
      reasoning: draft.reasoning,
      status: existing?.status ?? (modelProviderAvailable ? "idle" : "unknown"),
      taskSummary: existing ? `${existing.taskSummary} Local draft model override is staged only.` : "Local draft agent definition; not applied to OpenClaw runtime config.",
      kind: existing?.kind ?? "draft",
      source: existing ? `${existing.source} + data/agents.local.json` : "data/agents.local.json",
      updatedAt: draft.updatedAt,
      icon: draft.icon || existing?.icon || icons[Math.abs(hashId(draft.id).charCodeAt(0)) % icons.length],
    };
    byId.set(draft.id, agent);
  }

  const subagents = sessions
    .filter((session) => session.isSubagent && !session.probe)
    .slice(0, 8)
    .map<AgentInfo>((session, index) => {
      const parent = session.sessionKey?.match(/agent:([^:]+):subagent/)?.[1] ?? session.owner;
      const shortId = session.subagentId?.slice(0, 8) ?? hashId(session.file).slice(0, 8);
      return {
        id: `subagent-${shortId}`,
        name: `${parent[0]?.toUpperCase() ?? "S"}${parent.slice(1)} subagent ${shortId}`,
        role: parent === "tadashi" ? "Delegated engineering task" : parent === "friday" ? "Delegated operations/research task" : "Delegated support task",
        provider: normalizeProviderFromModel(session.provider ? `${session.provider}/${session.modelId ?? ""}` : undefined),
        model: [session.provider, session.modelId].filter(Boolean).join("/") || "unknown",
        reasoning: "Subagent trace metadata only; prompt contents are not exposed.",
        status: session.busy ? "busy" : "recent",
        taskSummary: summarizeSession(session),
        kind: "subagent",
        source: relativeToWorkspace(session.file),
        updatedAt: session.lastAt,
        icon: icons[index % icons.length],
      };
    });

  return [...byId.values(), ...subagents];
}

function parseTaskBoardMarkdown(text: string, sourcePath: string): MissionTask[] {
  const tasks: MissionTask[] = [];
  let currentLane: TaskLane | undefined;
  const lines = text.split(/\r?\n/);

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const heading = line.match(/^##\s+(.+)$/);
    if (heading) {
      currentLane = normalizeLane(stripMarkdown(heading[1]));
      continue;
    }
    const checkbox = line.match(/^-\s+\[([ xX])\]\s+(.+)$/);
    if (!checkbox || !currentLane) continue;
    const done = checkbox[1].toLowerCase() === "x";
    const rawTitle = stripMarkdown(checkbox[2]);
    const idMatch = rawTitle.match(/^([A-Z][A-Z0-9]+-\d+)\s+[—-]\s+(.+)$/);
    const id = idMatch?.[1] ?? `${slugify(path.basename(sourcePath, ".md"))}-${index + 1}`;
    const title = idMatch?.[2] ?? rawTitle;
    tasks.push({
      id,
      title,
      lane: done ? "Done" : currentLane,
      source: "project-doc",
      sourcePath: relativeToWorkspace(sourcePath),
      tags: ["task-board"],
    });
  }

  return tasks;
}

async function parseTaskFile(file: string): Promise<MissionTask | undefined> {
  const text = await readText(file);
  if (!text) return undefined;
  const heading = text.match(/^#\s+(.+)$/m)?.[1] ?? path.basename(file, ".md");
  const titleMatch = stripMarkdown(heading).match(/^([A-Z][A-Z0-9]+-\d+)\s+[—-]\s+(.+)$/);
  const id = titleMatch?.[1] ?? slugify(path.basename(file, ".md"));
  const title = titleMatch?.[2] ?? stripMarkdown(heading);
  const owner = text.match(/^Owner:\s*(.+)$/m)?.[1]?.trim();
  const goal = text.match(/## Goal\s+([\s\S]*?)(?:\n## |$)/)?.[1]?.trim();
  const status = text.match(/^Status:\s*(.+)$/m)?.[1]?.trim();
  const lane = status ? normalizeLane(status) : "Planned";
  return {
    id,
    title,
    lane,
    description: goal ? stripMarkdown(goal).slice(0, 260) : undefined,
    source: "task-file",
    sourcePath: relativeToWorkspace(file),
    owner,
    tags: ["ticket"],
  };
}

function parseActivityLog(text: string, file: string, source: "memory" | "wiki-log", limit = 6): MissionTask[] {
  const entries: MissionTask[] = [];
  const matches = [...text.matchAll(/^##\s+(.+)$/gm)];
  const recent = matches.slice(-limit);
  for (let i = recent.length - 1; i >= 0; i -= 1) {
    const match = recent[i];
    const start = (match.index ?? 0) + match[0].length;
    const next = matches[matches.indexOf(match) + 1];
    const end = next?.index ?? text.length;
    const title = stripMarkdown(match[1]);
    const body = text.slice(start, end);
    const summary = body.match(/\*\*(?:Summary|Outcome):\*\*\s*([^\n]+)/)?.[1] ?? body.match(/\*\*Request:\*\*\s*([^\n]+)/)?.[1];
    const lane: TaskLane = /blocked|waiting/i.test(`${title}\n${body}`)
      ? "Waiting/Blocked"
      : /review/i.test(title)
        ? "Review"
        : /in progress|running|spawned|delegated|started|build requested/i.test(`${title}\n${body}`)
          ? "In Progress"
          : "Done";
    entries.push({
      id: `${source}-${hashId(file + title)}`,
      title,
      lane,
      description: summary ? stripMarkdown(summary).slice(0, 220) : undefined,
      source,
      sourcePath: relativeToWorkspace(file),
      tags: ["activity"],
    });
  }
  return entries;
}

async function loadManualTasks(): Promise<MissionTask[]> {
  return readJsonFile<MissionTask[]>(MANUAL_TASKS_PATH, []);
}

async function saveManualTask(input: TaskInput): Promise<MissionTask> {
  const tasks = await loadManualTasks();
  const cleanTitle = input.title.trim();
  const task: MissionTask = {
    id: `LOCAL-${Date.now().toString(36).toUpperCase()}`,
    title: cleanTitle,
    lane: normalizeLane(input.lane),
    description: input.description?.trim() || undefined,
    owner: input.owner?.trim() || undefined,
    source: "manual",
    sourcePath: "data/tasks.local.json",
    updatedAt: nowIso(),
    tags: [...new Set([...(input.tags ?? []), "manual"].map((tag) => tag.trim()).filter(Boolean))],
  };
  tasks.unshift(task);
  await writeJsonFile(MANUAL_TASKS_PATH, tasks.slice(0, 250));
  return task;
}

async function collectTasks(): Promise<MissionTask[]> {
  const collected: MissionTask[] = [];
  const projectTaskDocs = await listFiles(path.join(WORKSPACE_ROOT, "projects"), (file) => file.endsWith(path.join("docs", "TASKS.md")), 100);
  for (const file of projectTaskDocs) {
    const text = await readText(file);
    if (text) collected.push(...parseTaskBoardMarkdown(text, file));
  }

  const taskFiles = await listFiles(path.join(WORKSPACE_ROOT, "projects"), (file) => file.includes(`${path.sep}.tasks${path.sep}`) && file.endsWith(".md"), 200);
  for (const file of taskFiles) {
    const task = await parseTaskFile(file);
    if (task) collected.push(task);
  }

  const memoryFiles = await listFiles(path.join(WORKSPACE_ROOT, "memory"), (file) => /\d{4}-\d{2}-\d{2}\.md$/.test(file), 60);
  const recentMemory = memoryFiles.sort().slice(-3);
  for (const file of recentMemory) {
    const text = await readText(file);
    if (text) collected.push(...parseActivityLog(text, file, "memory", 5));
  }

  const wikiLog = path.join(WORKSPACE_ROOT, "wiki", "log.md");
  const wikiText = await readText(wikiLog);
  if (wikiText) collected.push(...parseActivityLog(wikiText, wikiLog, "wiki-log", 5));

  collected.push(...(await loadManualTasks()));

  const byId = new Map<string, MissionTask>();
  for (const task of collected) {
    const existing = byId.get(task.id);
    if (!existing) {
      byId.set(task.id, task);
      continue;
    }
    byId.set(task.id, {
      ...existing,
      ...task,
      description: existing.description ?? task.description,
      sourcePath: existing.sourcePath ?? task.sourcePath,
      tags: [...new Set([...existing.tags, ...task.tags])],
    });
  }

  return [...byId.values()].sort((a, b) => {
    const laneDiff = LANES.indexOf(a.lane) - LANES.indexOf(b.lane);
    if (laneDiff !== 0) return laneDiff;
    return (b.updatedAt ?? "").localeCompare(a.updatedAt ?? "");
  });
}

function buildEnvironment(probe: ProbeResult): EnvironmentStatus {
  return {
    host: HOST,
    port: PORT,
    boundTo: HOST,
    workspaceRoot: WORKSPACE_ROOT,
    openClawRoot: OPENCLAW_ROOT,
    lastRefresh: nowIso(),
    watchedPaths: [...watchedPaths].sort(),
    modelStatusProbe: probe.state,
    modelStatusMessage: probe.message,
  };
}

async function buildSnapshot(): Promise<MissionSnapshot> {
  await ensureDataFiles();
  const [{ providers, probe }, sessions, searchStrategy] = await Promise.all([collectProviders(), collectSessionSummaries(), collectSearchStrategy()]);
  const [agents, tasks] = await Promise.all([collectAgents(providers, sessions, probe), collectTasks()]);
  return { agents, providers, tasks, environment: buildEnvironment(probe), searchStrategy };
}

function sendSse(event: string, data: unknown): void {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of sseClients) client.write(payload);
}

async function refresh(reason = "refresh"): Promise<void> {
  snapshot = await buildSnapshot();
  sendSse("snapshot", { reason, snapshot });
}

function scheduleRefresh(reason: string): void {
  if (refreshTimer) clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => {
    refresh(reason).catch((error) => {
      sendSse("error", { message: error instanceof Error ? error.message : "Refresh failed" });
    });
  }, 350);
}

function addWatcher(filePath: string, recursive = false): void {
  if (!existsSync(filePath)) return;
  try {
    const watcher = watch(filePath, { recursive }, () => scheduleRefresh(`file-change:${relativeToWorkspace(filePath)}`));
    watchers.push(watcher);
    watchedPaths.add(relativeToWorkspace(filePath));
  } catch {
    // fs.watch support varies; polling still refreshes.
  }
}

function setupWatchers(): void {
  addWatcher(path.join(WORKSPACE_ROOT, "agents"), true);
  addWatcher(path.join(WORKSPACE_ROOT, "memory"), false);
  addWatcher(path.join(WORKSPACE_ROOT, "wiki", "log.md"), false);
  addWatcher(path.join(WORKSPACE_ROOT, "projects"), true);
  addWatcher(path.join(OPENCLAW_ROOT, ".env"), false);
  addWatcher(path.join(OPENCLAW_ROOT, "agents"), true);
  addWatcher(DATA_DIR, false);
}

function localCorsHeaders(req: IncomingMessage): Record<string, string> {
  const origin = req.headers.origin;
  const allowedOrigin = typeof origin === "string" && /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin) ? origin : "http://127.0.0.1:5178";
  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Methods": "GET,POST,PATCH,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    Vary: "Origin",
  };
}

function sendJson(req: IncomingMessage, res: ServerResponse, statusCode: number, body: unknown): void {
  res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8", ...localCorsHeaders(req) });
  res.end(JSON.stringify(body, null, 2));
}

async function readRequestBody<T>(req: IncomingMessage, maxBytes = 1024 * 1024): Promise<T> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.byteLength;
    if (total > maxBytes) throw new Error("Request body too large");
    chunks.push(buffer);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  return JSON.parse(text || "{}") as T;
}

function validateProvider(value: string): value is ProviderKey {
  return PROVIDERS.some((provider) => provider.id === value);
}

function validateAgentInput(input: Partial<AgentDraftInput>): AgentDraftInput {
  if (!input.name?.trim()) throw new Error("Agent name is required.");
  if (!input.role?.trim()) throw new Error("Agent role is required.");
  if (!input.provider || !validateProvider(input.provider)) throw new Error("Known provider is required.");
  if (!input.model?.trim()) throw new Error("Model id is required.");
  return {
    id: input.id,
    name: input.name.trim(),
    role: input.role.trim(),
    provider: input.provider,
    model: input.model.trim(),
    reasoning: input.reasoning,
    icon: input.icon,
  };
}

function validateTaskInput(input: Partial<TaskInput>): TaskInput {
  if (!input.title?.trim()) throw new Error("Task title is required.");
  if (input.lane && !laneSet.has(input.lane)) throw new Error("Invalid task lane.");
  return {
    title: input.title.trim(),
    lane: input.lane,
    description: input.description,
    owner: input.owner,
    tags: input.tags,
  };
}

async function serveApi(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
  if (!url.pathname.startsWith("/api")) return false;

  if (req.method === "OPTIONS") {
    res.writeHead(204, localCorsHeaders(req));
    res.end();
    return true;
  }

  if (url.pathname === "/api/events" && req.method === "GET") {
    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      ...localCorsHeaders(req),
    });
    res.write(`event: hello\ndata: ${JSON.stringify({ connectedAt: nowIso() })}\n\n`);
    if (snapshot) res.write(`event: snapshot\ndata: ${JSON.stringify({ reason: "initial", snapshot })}\n\n`);
    sseClients.add(res);
    const heartbeat = setInterval(() => res.write(`event: heartbeat\ndata: ${JSON.stringify({ at: nowIso() })}\n\n`), 25_000);
    req.on("close", () => {
      clearInterval(heartbeat);
      sseClients.delete(res);
    });
    return true;
  }

  if (url.pathname === "/api/health" && req.method === "GET") {
    sendJson(req, res, 200, { ok: true, localOnlyDefault: HOST === "127.0.0.1", lastRefresh: snapshot?.environment.lastRefresh });
    return true;
  }

  if (url.pathname === "/api/snapshot" && req.method === "GET") {
    if (!snapshot) snapshot = await buildSnapshot();
    sendJson(req, res, 200, snapshot);
    return true;
  }

  if (url.pathname === "/api/agents" && req.method === "GET") {
    if (!snapshot) snapshot = await buildSnapshot();
    sendJson(req, res, 200, snapshot.agents);
    return true;
  }

  if (url.pathname === "/api/providers" && req.method === "GET") {
    if (!snapshot) snapshot = await buildSnapshot();
    sendJson(req, res, 200, snapshot.providers);
    return true;
  }

  if (url.pathname === "/api/tasks" && req.method === "GET") {
    if (!snapshot) snapshot = await buildSnapshot();
    sendJson(req, res, 200, snapshot.tasks);
    return true;
  }

  if (url.pathname === "/api/tasks" && req.method === "POST") {
    try {
      const input = validateTaskInput(await readRequestBody<Partial<TaskInput>>(req));
      const task = await saveManualTask(input);
      await refresh("task-created");
      sendJson(req, res, 201, task);
    } catch (error) {
      sendJson(req, res, 400, { error: error instanceof Error ? error.message : "Invalid task input" });
    }
    return true;
  }

  if (url.pathname === "/api/agents" && req.method === "POST") {
    try {
      const input = validateAgentInput(await readRequestBody<Partial<AgentDraftInput>>(req));
      const draft = await saveAgentDraft(input);
      await refresh("agent-saved");
      sendJson(req, res, 201, draft);
    } catch (error) {
      sendJson(req, res, 400, { error: error instanceof Error ? error.message : "Invalid agent input" });
    }
    return true;
  }

  const agentPatch = url.pathname.match(/^\/api\/agents\/([^/]+)$/);
  if (agentPatch && req.method === "PATCH") {
    try {
      const input = validateAgentInput({ ...(await readRequestBody<Partial<AgentDraftInput>>(req)), id: decodeURIComponent(agentPatch[1]) });
      const draft = await saveAgentDraft(input, decodeURIComponent(agentPatch[1]));
      await refresh("agent-saved");
      sendJson(req, res, 200, draft);
    } catch (error) {
      sendJson(req, res, 400, { error: error instanceof Error ? error.message : "Invalid agent input" });
    }
    return true;
  }

  sendJson(req, res, 404, { error: "Not found" });
  return true;
}

const contentTypes: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

async function serveStatic(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  const distRoot = path.join(PROJECT_ROOT, "dist");
  if (!existsSync(distRoot)) {
    sendJson(req, res, 404, { error: "Frontend build not found. Run npm run build or use npm run dev:all." });
    return;
  }

  const rawPath = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname);
  const candidate = path.normalize(path.join(distRoot, rawPath));
  const safePath = candidate.startsWith(distRoot) ? candidate : path.join(distRoot, "index.html");
  let filePath = safePath;
  if (!existsSync(filePath)) filePath = path.join(distRoot, "index.html");
  try {
    const data = await readFile(filePath);
    res.writeHead(200, { "Content-Type": contentTypes[path.extname(filePath)] ?? "application/octet-stream" });
    res.end(data);
  } catch {
    sendJson(req, res, 404, { error: "Not found" });
  }
}

async function start(): Promise<void> {
  await ensureDataFiles();
  setupWatchers();
  snapshot = await buildSnapshot();
  setInterval(() => scheduleRefresh("poll"), 15_000).unref();

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? `${HOST}:${PORT}`}`);
    serveApi(req, res, url)
      .then((handled) => {
        if (!handled) return serveStatic(req, res, url);
        return undefined;
      })
      .catch((error) => {
        sendJson(req, res, 500, { error: error instanceof Error ? error.message : "Internal server error" });
      });
  });

  server.listen(PORT, HOST, () => {
    console.log(`Agent Mission Control API listening on http://${HOST}:${PORT}`);
    console.log("Secrets are not exposed; provider checks report presence/capability only.");
  });

  const shutdown = () => {
    for (const watcher of watchers) watcher.close();
    server.close(() => process.exit(0));
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

start().catch((error) => {
  console.error(error);
  process.exit(1);
});
