import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const repoRoot = process.cwd();
const scale = readFlag("--scale") ?? "deep";
const runId = new Date().toISOString().replace(/[:.]/g, "-");
const artifactRoot = path.resolve(
  readFlag("--out") ?? path.join(".artifacts", "synthetic-io-e2e", runId),
);
const stateRoot = path.join(artifactRoot, "state");
const workspaceRoot = path.join(stateRoot, "workspace");
const tracesRoot = path.join(artifactRoot, "traces");
const logsRoot = path.join(artifactRoot, "logs");
const summariesRoot = path.join(artifactRoot, "summaries");
const gatewayToken = `synthetic-${randomBytes(16).toString("hex")}`;
const gatewayPort = Number(readFlag("--port") ?? 24000 + Math.floor(Math.random() * 1000));

const countsByScale = {
  tiny: {
    sessions: 120,
    transcriptFiles: 40,
    transcriptLines: 4,
    dailyMemoryFiles: 30,
    qmdFiles: 80,
    deliveryFiles: 60,
    cronJobs: 20,
  },
  small: {
    sessions: 800,
    transcriptFiles: 200,
    transcriptLines: 8,
    dailyMemoryFiles: 90,
    qmdFiles: 300,
    deliveryFiles: 200,
    cronJobs: 80,
  },
  deep: {
    sessions: 6000,
    transcriptFiles: 1400,
    transcriptLines: 18,
    dailyMemoryFiles: 420,
    qmdFiles: 1800,
    deliveryFiles: 1200,
    cronJobs: 400,
  },
};

const counts = countsByScale[scale];
if (!counts) {
  throw new Error(`unknown --scale ${scale}`);
}

await fsp.mkdir(tracesRoot, { recursive: true });
await fsp.mkdir(logsRoot, { recursive: true });
await fsp.mkdir(summariesRoot, { recursive: true });

generateSyntheticState();

const cliResults = [];
for (const [label, args, opts] of [
  ["config validate", ["config", "validate", "--json"], { timeoutMs: 20_000, stacks: true }],
  ["status deep", ["status", "--deep", "--json"], { timeoutMs: 45_000, stacks: true }],
  [
    "sessions limit 50",
    ["sessions", "--json", "--limit", "50"],
    { timeoutMs: 45_000, stacks: true },
  ],
  [
    "sessions all agents",
    ["sessions", "--json", "--limit", "50", "--all-agents"],
    { timeoutMs: 45_000 },
  ],
  [
    "memory status deep",
    ["memory", "status", "--json", "--deep"],
    { timeoutMs: 60_000, stacks: true },
  ],
  [
    "memory search qmd",
    ["memory", "search", "gateway rpc synthetic memory", "--json", "--max-results", "20"],
    { timeoutMs: 60_000 },
  ],
  [
    "memory rem harness",
    ["memory", "rem-harness", "--json", "--path", path.join(workspaceRoot, "memory")],
    { timeoutMs: 60_000 },
  ],
  [
    "gateway status no service",
    ["gateway", "status", "--json", "--url", `ws://127.0.0.1:${gatewayPort}`],
    { timeoutMs: 25_000 },
  ],
]) {
  console.log(`[audit] ${label}`);
  cliResults.push(await runOpenClaw(label, args, opts));
}

const gateway = startGateway();
let ready = false;
for (let attempt = 0; attempt < 30; attempt += 1) {
  const result = await runOpenClaw(
    `rpc wait health ${attempt}`,
    [
      "gateway",
      "call",
      "health",
      "--url",
      `ws://127.0.0.1:${gatewayPort}`,
      "--token",
      gatewayToken,
      "--json",
      "--timeout",
      "2000",
    ],
    { timeoutMs: 5_000 },
  );
  if (result.code === 0) {
    ready = true;
    break;
  }
  await delay(500);
}

const rpcResults = [];
if (ready) {
  for (const [label, method, params] of [
    ["rpc health", "health", {}],
    ["rpc status", "status", {}],
    ["rpc diagnostics stability", "diagnostics.stability", {}],
    ["rpc config get", "config.get", {}],
    ["rpc config schema", "config.schema", {}],
    ["rpc commands list", "commands.list", {}],
    ["rpc tools catalog", "tools.catalog", {}],
    [
      "rpc tools effective",
      "tools.effective",
      { sessionKey: "agent:main:synthetic-session-00042" },
    ],
    ["rpc plugins ui descriptors", "plugins.uiDescriptors", {}],
    ["rpc skills status", "skills.status", {}],
    ["rpc agents list", "agents.list", {}],
    ["rpc sessions list bounded", "sessions.list", { limit: 50, agentId: "main" }],
    [
      "rpc sessions list derived",
      "sessions.list",
      { limit: 50, agentId: "main", includeDerivedTitles: true, includeLastMessage: true },
    ],
    [
      "rpc sessions preview",
      "sessions.preview",
      { keys: ["agent:main:synthetic-session-00042"], limit: 6, maxChars: 2000 },
    ],
    [
      "rpc sessions describe",
      "sessions.describe",
      { key: "agent:main:synthetic-session-00042", includeLastMessage: true },
    ],
    [
      "rpc sessions create",
      "sessions.create",
      { agentId: "main", task: "synthetic create smoke", emitCommandHooks: false },
    ],
    ["rpc doctor memory status", "doctor.memory.status", { deep: true }],
    [
      "rpc doctor memory rem harness",
      "doctor.memory.remHarness",
      { path: path.join(workspaceRoot, "memory") },
    ],
    ["rpc logs tail", "logs.tail", { limit: 20 }],
  ]) {
    console.log(`[audit] ${label}`);
    rpcResults.push(
      await runOpenClaw(
        label,
        [
          "gateway",
          "call",
          method,
          "--params",
          JSON.stringify(params),
          "--url",
          `ws://127.0.0.1:${gatewayPort}`,
          "--token",
          gatewayToken,
          "--json",
          "--timeout",
          "20000",
        ],
        { timeoutMs: 30_000, stacks: label.includes("sessions list") || label.includes("memory") },
      ),
    );
  }
}

await stopGateway(gateway);

const gatewayTrace = readGatewayTrace();
const allResults = [...cliResults, ...rpcResults];
const outsideWrites = allResults.flatMap((result) =>
  result.trace.outsideStateWrites.map((entry) => ({ label: result.label, ...entry })),
);
const repoWrites = allResults.flatMap((result) =>
  result.trace.repoWrites.map((entry) => ({ label: result.label, ...entry })),
);
const summary = {
  artifactRoot,
  scale,
  counts,
  gateway: {
    ready,
    port: gatewayPort,
    resource: gateway.resource(),
    trace: gatewayTrace,
    stdoutBytes: Buffer.byteLength(gateway.stdout),
    stderrBytes: Buffer.byteLength(gateway.stderr),
    stderrSample: gateway.stderr.slice(0, 2000),
  },
  rankings: {
    byOps: rank(allResults, (entry) => entry.trace.totalOps),
    byWall: rank(allResults, (entry) => entry.wallMs),
    byRss: rank(allResults, (entry) => entry.resource.maxRssKb),
  },
  failures: allResults
    .filter((result) => result.code !== 0)
    .map((result) => ({
      label: result.label,
      code: result.code,
      signal: result.signal,
      timedOut: result.timedOut,
      stderrSample: result.stderrSample,
    })),
  outsideWrites,
  repoWrites,
};

writeJson(path.join(artifactRoot, "deep-audit-summary.json"), summary);
writeText(path.join(artifactRoot, "deep-audit-report.md"), renderMarkdown(summary));

console.log("OPENCLAW_SYNTHETIC_IO_AUDIT_SUMMARY " + JSON.stringify(compactSummary(summary)));

function readFlag(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) {
    return undefined;
  }
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) {
    return "";
  }
  return value;
}

function generateSyntheticState() {
  writeText(
    path.join(workspaceRoot, "MEMORY.md"),
    [
      "# synthetic memory",
      "",
      "- active memory is enabled for this generated IO audit.",
      "- qmd collections include synthetic operator notes, session exports, and dreams.",
      "",
    ].join("\n"),
  );
  writeText(
    path.join(workspaceRoot, "IDENTITY.md"),
    "# synthetic identity\n\nSynthetic remote audit state.\n",
  );
  writeText(
    path.join(workspaceRoot, "DREAMS.md"),
    [
      "# dreams",
      "",
      "- do not scan every session transcript unless the caller asked.",
      "- memory status should not touch delivery queue artifacts.",
      "",
    ].join("\n"),
  );

  for (let index = 0; index < counts.dailyMemoryFiles; index += 1) {
    const date = dayString(index);
    writeText(
      path.join(workspaceRoot, "memory", `${date}.md`),
      [
        `# ${date}`,
        "",
        "## recall",
        `- synthetic note ${index}: plugin state, session routing, gateway rpc, qmd search.`,
        "",
        "## dreams",
        `- dream ${index}: verify file IO stays inside state/workspace unless explicitly reading repo metadata.`,
        "",
      ].join("\n"),
    );
  }

  for (let index = 0; index < counts.qmdFiles; index += 1) {
    const bucket = String(index % 36).padStart(2, "0");
    writeText(
      path.join(stateRoot, "agents", "main", "qmd", "sessions", bucket, `qmd-${pad(index)}.md`),
      [
        "---",
        `title: qmd synthetic ${index}`,
        `kind: ${index % 4 === 0 ? "dream" : "memory"}`,
        `updated: ${iso(index % 365)}`,
        "---",
        "",
        `Synthetic QMD entry ${index}. Gateway RPC, sessions.list, tools.catalog, plugins.uiDescriptors, memory-core, active memory, and delivery queues.`,
        "",
      ].join("\n"),
    );
  }

  const sessionsDir = path.join(stateRoot, "agents", "main", "sessions");
  const transcriptsDir = path.join(sessionsDir, "transcripts");
  const store = {};
  for (let index = 0; index < counts.sessions; index += 1) {
    const id = `synthetic-session-${pad(index)}`;
    const key = `agent:main:${id}`;
    const sessionFile = path.join(transcriptsDir, `${id}.jsonl`);
    const hasTranscript = index < counts.transcriptFiles;
    if (hasTranscript) {
      const lines = [
        JSON.stringify({
          type: "session_meta",
          sessionId: id,
          version: 1,
          createdAt: iso(index % 120),
        }),
      ];
      for (let line = 0; line < counts.transcriptLines; line += 1) {
        lines.push(
          JSON.stringify({
            type: "response_item",
            role: line % 2 === 0 ? "user" : "assistant",
            content: `synthetic transcript ${index}/${line} memory qmd rpc plugin delivery tui onboarding`,
            usage: {
              input_tokens: 40 + line,
              output_tokens: 80 + line,
              total_tokens: 120 + line * 2,
            },
            createdAt: iso(index % 120, line * 1000),
          }),
        );
      }
      writeText(sessionFile, `${lines.join("\n")}\n`);
      if (index % 3 === 0) {
        writeText(
          path.join(transcriptsDir, `${id}.trajectory.jsonl`),
          `${JSON.stringify({ id, steps: ["tool", "memory", "rpc"], createdAt: iso(index % 90) })}\n`,
        );
      }
    }
    store[key] = {
      sessionId: id,
      key,
      agentId: "main",
      kind: index % 10 === 0 ? "subagent" : "session",
      title: `synthetic session ${index}`,
      label: index % 11 === 0 ? "synthetic-review" : undefined,
      model: index % 2 === 0 ? "gpt-5.5" : "sonnet-4.6",
      modelProvider: index % 2 === 0 ? "openai" : "anthropic",
      channel: index % 6 === 0 ? "discord" : index % 6 === 1 ? "terminal" : "gateway",
      subject: `synthetic subject ${index % 100}`,
      updatedAt: iso(index % 365, index * 1000),
      createdAt: iso((index % 365) + 1, index * 1000),
      totalTokens: 1000 + index,
      totalTokensFresh: true,
      contextTokens: 200000,
      inputTokens: 400 + index,
      outputTokens: 600 + index,
      estimatedCostUsd: Number((index * 0.00003).toFixed(6)),
      sessionFile: hasTranscript ? sessionFile : undefined,
      spawnedBy:
        index % 10 === 0
          ? `agent:main:synthetic-session-${pad(Math.max(0, index - 1))}`
          : undefined,
    };
  }
  writeJson(path.join(sessionsDir, "sessions.json"), store);
  writeJson(path.join(sessionsDir, "deleted-sessions.json"), {
    "agent:main:deleted-synthetic-00001": {
      deletedAt: iso(1),
      sessionId: "deleted-synthetic-00001",
    },
  });

  for (let index = 0; index < counts.deliveryFiles; index += 1) {
    writeJson(
      path.join(
        stateRoot,
        "delivery",
        "queue",
        index % 2 === 0 ? "pending" : "failed",
        `delivery-${pad(index)}.json`,
      ),
      {
        id: `delivery-${index}`,
        sessionKey: `agent:main:synthetic-session-${pad(index % counts.sessions)}`,
        channel: index % 2 === 0 ? "discord" : "telegram",
        createdAt: iso(index % 45),
        payload: "x".repeat(256),
      },
    );
  }

  writeJson(path.join(stateRoot, "cron", "jobs.json"), {
    jobs: Array.from({ length: counts.cronJobs }, (_, index) => ({
      id: `cron-${index}`,
      schedule: `${index % 60} * * * *`,
      command: "memory status",
      enabled: index % 7 !== 0,
      createdAt: iso(index % 100),
    })),
  });
  writeJson(path.join(stateRoot, "tui", "last-session.json"), {
    key: "agent:main:synthetic-session-00042",
    agentId: "main",
    updatedAt: iso(0),
  });
  writeJson(path.join(stateRoot, "agents", "main", "skills", "skills.json"), {
    skills: [
      { name: "synthetic-memory", enabled: true, source: "local" },
      { name: "synthetic-rpc", enabled: true, source: "local" },
    ],
  });
  writeText(
    path.join(stateRoot, "logs", "gateway.log"),
    "synthetic gateway log line\n".repeat(200),
  );

  writeJson(path.join(stateRoot, "openclaw.json"), {
    agents: {
      defaults: {
        workspace: workspaceRoot,
        contextTokens: 200000,
        memorySearch: {
          enabled: true,
          provider: "local",
          sources: ["memory", "sessions"],
          extraPaths: [path.join(stateRoot, "agents", "main", "qmd", "sessions")],
          sync: { maxFileScanEntries: 200000 },
        },
      },
      list: [{ id: "main", default: true, workspace: workspaceRoot }],
    },
    gateway: {
      mode: "local",
      bind: "loopback",
      port: gatewayPort,
      auth: { mode: "none" },
      controlUi: { enabled: false },
      tailscale: { mode: "off", resetOnExit: false },
    },
    memory: {
      backend: "qmd",
      qmd: {
        searchMode: "search",
      },
    },
    plugins: {
      enabled: true,
      bundledDiscovery: "allowlist",
      allow: ["memory-core"],
      slots: { memory: "memory-core" },
      entries: {
        "memory-core": {
          enabled: true,
          config: {},
        },
      },
    },
    tools: { profile: "coding" },
    session: { dmScope: "per-channel-peer", maintenance: { mode: "warn", maxEntries: 200000 } },
  });
}

function runOpenClaw(label, args, opts = {}) {
  const traceOut = path.join(tracesRoot, `${slug(label)}-{pid}.json`);
  const env = {
    ...process.env,
    HOME: path.join(stateRoot, "home"),
    OPENCLAW_HOME: stateRoot,
    OPENCLAW_STATE_DIR: stateRoot,
    OPENCLAW_CONFIG_PATH: path.join(stateRoot, "openclaw.json"),
    OPENCLAW_NO_ONBOARD: "1",
    OPENCLAW_GATEWAY_TOKEN: gatewayToken,
    OPENCLAW_IO_TRACE_OUT: traceOut,
    OPENCLAW_IO_TRACE_ROOTS: [repoRoot, stateRoot, workspaceRoot, artifactRoot].join(
      path.delimiter,
    ),
    FORCE_COLOR: "0",
    NO_COLOR: "1",
    CI: "1",
    ...(opts.stacks ? { OPENCLAW_IO_TRACE_STACKS: "1" } : {}),
  };
  fs.mkdirSync(env.HOME, { recursive: true });
  return runProcess({
    label,
    command: "node",
    args: [
      "--import",
      path.join(repoRoot, "scripts/io-trace-preload.mjs"),
      path.join(repoRoot, "openclaw.mjs"),
      ...args,
    ],
    env,
    timeoutMs: opts.timeoutMs,
  });
}

function runProcess({ label, command, args, env, timeoutMs }) {
  return new Promise((resolve) => {
    const stdoutFile = path.join(logsRoot, `${slug(label)}.stdout`);
    const stderrFile = path.join(logsRoot, `${slug(label)}.stderr`);
    const child = spawn(command, args, {
      cwd: repoRoot,
      env,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const started = Date.now();
    const samples = [];
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const sampleTimer = setInterval(async () => {
      const sample = await sampleProcessGroup(child.pid).catch(() => undefined);
      if (sample) {
        samples.push(sample);
      }
    }, 250);
    const timeout = timeoutMs
      ? setTimeout(() => {
          timedOut = true;
          killGroup(child.pid, "SIGTERM");
          setTimeout(() => killGroup(child.pid, "SIGKILL"), 1500).unref();
        }, timeoutMs)
      : undefined;
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("close", (code, signal) => {
      clearInterval(sampleTimer);
      if (timeout) {
        clearTimeout(timeout);
      }
      writeText(stdoutFile, stdout);
      writeText(stderrFile, stderr);
      const result = {
        label,
        code,
        signal,
        timedOut,
        wallMs: Date.now() - started,
        stdoutBytes: Buffer.byteLength(stdout),
        stderrBytes: Buffer.byteLength(stderr),
        stdoutSample: stdout.slice(0, 1000),
        stderrSample: stderr.slice(0, 1000),
        resource: summarizeSamples(samples),
        trace: readTrace(label),
      };
      writeJson(path.join(summariesRoot, `${slug(label)}.json`), result);
      resolve(result);
    });
  });
}

function startGateway() {
  const env = {
    ...process.env,
    HOME: path.join(stateRoot, "home"),
    OPENCLAW_HOME: stateRoot,
    OPENCLAW_STATE_DIR: stateRoot,
    OPENCLAW_CONFIG_PATH: path.join(stateRoot, "openclaw.json"),
    OPENCLAW_NO_ONBOARD: "1",
    OPENCLAW_GATEWAY_TOKEN: gatewayToken,
    OPENCLAW_IO_TRACE_OUT: path.join(tracesRoot, "gateway-server-{pid}.json"),
    OPENCLAW_IO_TRACE_ROOTS: [repoRoot, stateRoot, workspaceRoot, artifactRoot].join(
      path.delimiter,
    ),
    OPENCLAW_IO_TRACE_STACKS: "1",
    FORCE_COLOR: "0",
    NO_COLOR: "1",
    CI: "1",
  };
  const child = spawn(
    "node",
    [
      "--import",
      path.join(repoRoot, "scripts/io-trace-preload.mjs"),
      path.join(repoRoot, "openclaw.mjs"),
      "gateway",
      "run",
      "--port",
      String(gatewayPort),
      "--auth",
      "none",
      "--bind",
      "loopback",
      "--ws-log",
      "compact",
    ],
    { cwd: repoRoot, env, detached: true, stdio: ["ignore", "pipe", "pipe"] },
  );
  const samples = [];
  const gateway = {
    child,
    stdout: "",
    stderr: "",
    samples,
    resource: () => summarizeSamples(samples),
  };
  child.stdout.on("data", (chunk) => {
    gateway.stdout += chunk;
  });
  child.stderr.on("data", (chunk) => {
    gateway.stderr += chunk;
  });
  gateway.timer = setInterval(async () => {
    const sample = await sampleProcessGroup(child.pid).catch(() => undefined);
    if (sample) {
      samples.push(sample);
    }
  }, 250);
  return gateway;
}

async function stopGateway(gateway) {
  clearInterval(gateway.timer);
  killGroup(gateway.child.pid, "SIGTERM");
  await Promise.race([
    new Promise((resolve) => gateway.child.once("close", resolve)),
    delay(5_000).then(() => {
      killGroup(gateway.child.pid, "SIGKILL");
    }),
  ]);
  writeText(path.join(logsRoot, "gateway.stdout"), gateway.stdout);
  writeText(path.join(logsRoot, "gateway.stderr"), gateway.stderr);
}

async function sampleProcessGroup(pgid) {
  const output = await capture("ps", ["-o", "rss=,pcpu=", "-g", String(pgid)]);
  const rows = output
    .trim()
    .split("\n")
    .map((line) => line.trim().split(/\s+/).map(Number))
    .filter((row) => Number.isFinite(row[0]));
  if (rows.length === 0) {
    return undefined;
  }
  return {
    rssKb: rows.reduce((sum, row) => sum + row[0], 0),
    cpuPct: rows.reduce((sum, row) => sum + (row[1] || 0), 0),
    processes: rows.length,
  };
}

function capture(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "ignore"] });
    let stdout = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.on("error", reject);
    child.on("close", () => resolve(stdout));
  });
}

function killGroup(pid, signal) {
  try {
    process.kill(-pid, signal);
  } catch {}
}

function readTrace(label) {
  const files = fs.existsSync(tracesRoot)
    ? fs
        .readdirSync(tracesRoot)
        .filter((name) => name.startsWith(`${slug(label)}-`) && name.endsWith(".json"))
    : [];
  const ops = files.flatMap((file) => readJson(path.join(tracesRoot, file))?.operations ?? []);
  return summarizeOps(files, ops);
}

function readGatewayTrace() {
  const files = fs.existsSync(tracesRoot)
    ? fs
        .readdirSync(tracesRoot)
        .filter((name) => name.startsWith("gateway-server-") && name.endsWith(".json"))
    : [];
  const ops = files.flatMap((file) => readJson(path.join(tracesRoot, file))?.operations ?? []);
  return summarizeOps(files, ops, 20);
}

function summarizeOps(files, ops, topLimit = 12) {
  return {
    files,
    totalOps: ops.reduce((sum, op) => sum + (op.count ?? 0), 0),
    totalBytes: ops.reduce((sum, op) => sum + (op.bytes ?? 0), 0),
    paths: new Set(ops.map((op) => op.path)).size,
    top: ops.toSorted((left, right) => (right.count ?? 0) - (left.count ?? 0)).slice(0, topLimit),
    outsideStateWrites: ops
      .filter((op) => /write|append|mkdir|rm|unlink/i.test(op.op))
      .filter((op) => !op.path.startsWith(stateRoot) && !op.path.startsWith(artifactRoot))
      .slice(0, 20),
    repoWrites: ops
      .filter((op) => /write|append|mkdir|rm|unlink/i.test(op.op))
      .filter((op) => op.path.startsWith(repoRoot))
      .slice(0, 20),
  };
}

function summarizeSamples(samples) {
  if (samples.length === 0) {
    return { samples: 0, maxRssKb: 0, avgCpuPct: 0, maxProcesses: 0 };
  }
  return {
    samples: samples.length,
    maxRssKb: Math.max(...samples.map((sample) => sample.rssKb)),
    avgCpuPct: Number(
      (samples.reduce((sum, sample) => sum + sample.cpuPct, 0) / samples.length).toFixed(2),
    ),
    maxProcesses: Math.max(...samples.map((sample) => sample.processes)),
  };
}

function compactSummary(summary) {
  return {
    artifactRoot: summary.artifactRoot,
    scale: summary.scale,
    counts: summary.counts,
    gateway: {
      ready: summary.gateway.ready,
      port: summary.gateway.port,
      resource: summary.gateway.resource,
      trace: compactTrace(summary.gateway.trace),
      stdoutBytes: summary.gateway.stdoutBytes,
      stderrBytes: summary.gateway.stderrBytes,
      stderrSample: summary.gateway.stderrSample,
    },
    rankings: summary.rankings,
    failures: summary.failures,
    outsideWrites: summary.outsideWrites.slice(0, 20).map(compactOp),
    repoWrites: summary.repoWrites.slice(0, 20).map(compactOp),
  };
}

function compactTrace(trace) {
  return {
    files: trace.files,
    totalOps: trace.totalOps,
    totalBytes: trace.totalBytes,
    paths: trace.paths,
    top: trace.top.slice(0, 12).map(compactOp),
    outsideStateWrites: trace.outsideStateWrites.slice(0, 20).map(compactOp),
    repoWrites: trace.repoWrites.slice(0, 20).map(compactOp),
  };
}

function compactOp(entry) {
  return {
    label: entry.label,
    op: entry.op,
    path: abbreviatePath(entry.path),
    count: entry.count,
    bytes: entry.bytes,
  };
}

function abbreviatePath(value) {
  if (typeof value !== "string") {
    return value;
  }
  if (value.startsWith(stateRoot)) {
    return `<state>${value.slice(stateRoot.length)}`;
  }
  if (value.startsWith(artifactRoot)) {
    return `<artifact>${value.slice(artifactRoot.length)}`;
  }
  if (value.startsWith(repoRoot)) {
    return `<repo>${value.slice(repoRoot.length)}`;
  }
  return value;
}

function renderMarkdown(summary) {
  const lines = [
    `## Deep synthetic E2E/RPC resource audit (${new Date().toISOString()})`,
    "",
    `Synthetic shape: ${summary.counts.sessions} session rows, ${summary.counts.transcriptFiles} transcript files x ${summary.counts.transcriptLines} events, ${summary.counts.dailyMemoryFiles} daily memory files, ${summary.counts.qmdFiles} QMD files, ${summary.counts.deliveryFiles} delivery queue files, ${summary.counts.cronJobs} cron jobs.`,
    `Gateway RPC server readiness: ${summary.gateway.ready ? "ready" : "not ready"}. Gateway max RSS: ${summary.gateway.resource.maxRssKb} KiB. Server fs ops: ${summary.gateway.trace.totalOps}.`,
    "",
    "Top command/RPC IO counts:",
    "",
    table(summary.rankings.byOps, [
      ["surface", (row) => row.label],
      ["exit", (row) => row.code],
      ["wall", (row) => `${row.wallMs} ms`],
      ["rss", (row) => `${row.maxRssKb} KiB`],
      ["fs ops", (row) => row.ops],
      ["bytes", (row) => formatBytes(row.bytes)],
      ["paths", (row) => row.paths],
    ]),
    "",
    "File-touch audit:",
    "",
    `- Outside-state writes from CLI/RPC traces: ${summary.outsideWrites.length}.`,
    `- Repo writes from CLI/RPC traces: ${summary.repoWrites.length}.`,
    `- Gateway outside-state writes: ${summary.gateway.trace.outsideStateWrites.length}.`,
    ...(summary.failures.length === 0
      ? ["- all audited CLI/RPC calls exited 0."]
      : summary.failures.map(
          (failure) =>
            `- ${failure.label}: exit ${failure.code}, signal ${failure.signal ?? "none"}, timedOut=${failure.timedOut}.`,
        )),
    "",
  ];
  return `${lines.join("\n")}\n`;
}

function rank(results, score) {
  return results
    .toSorted((left, right) => score(right) - score(left))
    .slice(0, 12)
    .map((result) => ({
      label: result.label,
      code: result.code,
      timedOut: result.timedOut,
      wallMs: result.wallMs,
      maxRssKb: result.resource.maxRssKb,
      avgCpuPct: result.resource.avgCpuPct,
      ops: result.trace.totalOps,
      bytes: result.trace.totalBytes,
      paths: result.trace.paths,
    }));
}

function table(rows, columns) {
  return [
    `| ${columns.map(([title]) => title).join(" | ")} |`,
    `| ${columns.map(() => "---").join(" | ")} |`,
    ...rows.map(
      (row) =>
        `| ${columns
          .map(([, render]) => String(render(row)).replaceAll("\n", " ").replaceAll("|", "\\|"))
          .join(" | ")} |`,
    ),
  ].join("\n");
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return undefined;
  }
}

function writeText(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

function pad(value) {
  return String(value).padStart(5, "0");
}

function iso(daysAgo = 0, extraMs = 0) {
  return new Date(Date.now() - daysAgo * 86_400_000 - extraMs).toISOString();
}

function dayString(daysAgo) {
  return new Date(Date.now() - daysAgo * 86_400_000).toISOString().slice(0, 10);
}

function slug(value) {
  return value
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatBytes(value) {
  if (!Number.isFinite(value)) {
    return "n/a";
  }
  if (value > 1024 * 1024) {
    return `${(value / 1024 / 1024).toFixed(1)} MiB`;
  }
  if (value > 1024) {
    return `${(value / 1024).toFixed(1)} KiB`;
  }
  return `${value} B`;
}
