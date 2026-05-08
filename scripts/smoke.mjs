#!/usr/bin/env node
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const host = process.env.AMC_HOST ?? "127.0.0.1";
const port = Number(process.env.AMC_PORT ?? 4317);
const base = `http://${host}:${port}`;
const tasksPath = path.join(process.cwd(), "data", "tasks.local.json");
const agentsPath = path.join(process.cwd(), "data", "agents.local.json");
const beforeTasks = existsSync(tasksPath) ? await readFile(tasksPath, "utf8") : undefined;
const beforeAgents = existsSync(agentsPath) ? await readFile(agentsPath, "utf8") : undefined;

const server = spawn(process.execPath, ["dist-server/server/index.js"], {
  env: { ...process.env, AMC_HOST: host, AMC_PORT: String(port) },
  stdio: ["ignore", "pipe", "pipe"],
});

let logs = "";
server.stdout.on("data", (chunk) => {
  logs += chunk.toString();
});
server.stderr.on("data", (chunk) => {
  logs += chunk.toString();
});

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForHealth() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (server.exitCode !== null) break;
    try {
      const response = await fetch(`${base}/api/health`);
      if (response.ok) return response.json();
    } catch {
      // keep trying while the server boots
    }
    await delay(250);
  }
  throw new Error(`Server did not become healthy. Logs:\n${logs}`);
}

async function getJson(path) {
  const response = await fetch(`${base}${path}`);
  if (!response.ok) throw new Error(`${path} returned ${response.status}`);
  return response.json();
}

async function postJson(path, body) {
  const response = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`${path} returned ${response.status}: ${await response.text()}`);
  return response.json();
}

async function checkSse() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3000);
  try {
    const response = await fetch(`${base}/api/events`, { signal: controller.signal });
    if (!response.ok) throw new Error(`/api/events returned ${response.status}`);
    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.includes("text/event-stream")) throw new Error(`/api/events returned unexpected content type ${contentType}`);
    const reader = response.body?.getReader();
    if (!reader) throw new Error("SSE response did not expose a readable stream");
    const { value } = await reader.read();
    const firstChunk = new TextDecoder().decode(value ?? new Uint8Array());
    if (!firstChunk.includes("event:")) throw new Error("SSE stream did not emit an event chunk");
    await reader.cancel();
    return true;
  } finally {
    clearTimeout(timeout);
    controller.abort();
  }
}

try {
  await waitForHealth();
  const agents = await getJson("/api/agents");
  const providers = await getJson("/api/providers");
  const tasks = await getJson("/api/tasks");
  const created = await postJson("/api/tasks", {
    title: `Smoke check ${new Date().toISOString()}`,
    lane: "Done",
    description: "Created by npm run smoke to verify POST /api/tasks.",
    tags: ["smoke"],
  });
  await checkSse();

  console.log(JSON.stringify({
    ok: true,
    base,
    agents: agents.length,
    providers: providers.length,
    tasksBeforePost: tasks.length,
    createdTask: created.id,
    endpoints: ["GET /api/agents", "GET /api/providers", "GET /api/tasks", "POST /api/tasks", "GET /api/events"],
  }, null, 2));
} finally {
  server.kill("SIGTERM");
  await mkdir(path.dirname(tasksPath), { recursive: true });
  await writeFile(tasksPath, beforeTasks ?? "[]\n", "utf8");
  await writeFile(agentsPath, beforeAgents ?? "[]\n", "utf8");
}
