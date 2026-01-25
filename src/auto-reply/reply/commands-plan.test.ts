import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { ClawdbotConfig } from "../../config/config.js";
import type { MsgContext } from "../templating.js";
import { buildCommandContext, handleCommands } from "./commands.js";
import { parseInlineDirectives } from "./directive-handling.js";

const CANCEL = Symbol.for("clack:cancel");

const hoisted = vi.hoisted(() => {
  const state = {
    selectQueue: [] as any[],
    textQueue: [] as any[],
    confirmQueue: [] as any[],
    multiselectQueue: [] as any[],

    // Embedded runner control
    baseQuestions: [
      {
        id: "budget",
        section: "Constraints",
        prompt: "Budget?",
        kind: "select",
        required: true,
        options: ["$", "$$"],
      },
      {
        id: "deadline",
        section: "Timeline",
        prompt: "Deadline?",
        kind: "text",
      },
    ] as any[],
    extraQuestions: [
      {
        id: "transport",
        section: "Constraints",
        prompt: "Preferred transport?",
        kind: "multiselect",
        required: true,
        options: ["Car", "Plane"],
      },
    ] as any[],
  };

  function resetQueues() {
    state.selectQueue = [];
    state.textQueue = [];
    state.confirmQueue = [];
    state.multiselectQueue = [];
  }

  const clack = {
    select: vi.fn(async ({ options, message }: any) => {
      const queued = state.selectQueue.shift();
      if (queued !== undefined) return queued;

      // Default behavior: choose first section once, then review.
      if (String(message).includes("Choose a section")) {
        // If we already chose a section once, go to review.
        const already = (clack.select as any)._chosenOnce === true;
        (clack.select as any)._chosenOnce = true;
        if (already) return "__review";
        return options[0].value;
      }

      return options[0].value;
    }),
    text: vi.fn(async ({ initialValue }: any) => {
      const queued = state.textQueue.shift();
      if (queued !== undefined) return queued;
      return initialValue ?? "";
    }),
    confirm: vi.fn(async () => {
      const queued = state.confirmQueue.shift();
      if (queued !== undefined) return queued;
      return true;
    }),
    multiselect: vi.fn(async ({ options }: any) => {
      const queued = state.multiselectQueue.shift();
      if (queued !== undefined) return queued;
      return options.map((o: any) => o.value);
    }),
    isCancel: vi.fn((v: any) => v === CANCEL),
  };

  const embedded = {
    runEmbeddedPiAgent: vi.fn(async ({ prompt }: any) => {
      if (String(prompt).includes("Generate a compact questionnaire")) {
        return {
          payloads: [
            {
              text: JSON.stringify({
                goal: "demo",
                questions: state.baseQuestions,
              }),
            },
          ],
        };
      }

      if (String(prompt).includes("propose any missing high-signal questions")) {
        return {
          payloads: [
            {
              text: JSON.stringify({
                goal: "demo",
                questions: state.extraQuestions,
              }),
            },
          ],
        };
      }

      return {
        payloads: [{ text: JSON.stringify({ ok: true }) }],
      };
    }),
  };

  return { state, resetQueues, clack, embedded };
});

// Mock clack prompts to simulate TUI interaction.
vi.mock("@clack/prompts", async () => {
  return {
    confirm: hoisted.clack.confirm,
    isCancel: hoisted.clack.isCancel,
    select: hoisted.clack.select,
    multiselect: hoisted.clack.multiselect,
    text: hoisted.clack.text,
  };
});

// llm-task extension dynamically imports embedded runner in src-first/dist-fallback form.
vi.mock("../../../src/agents/pi-embedded-runner.js", () => ({
  runEmbeddedPiAgent: hoisted.embedded.runEmbeddedPiAgent,
}));
vi.mock("../../../agents/pi-embedded-runner.js", () => ({
  runEmbeddedPiAgent: hoisted.embedded.runEmbeddedPiAgent,
}));

let testWorkspaceDir = os.tmpdir();

beforeAll(async () => {
  testWorkspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "clawdbot-plan-"));
  await fs.writeFile(path.join(testWorkspaceDir, "AGENTS.md"), "# Agents\n", "utf-8");
});

afterAll(async () => {
  await fs.rm(testWorkspaceDir, { recursive: true, force: true });
});

beforeEach(() => {
  hoisted.resetQueues();
  (hoisted.clack.select as any)._chosenOnce = false;
  // defaults
  hoisted.state.baseQuestions = [
    {
      id: "budget",
      section: "Constraints",
      prompt: "Budget?",
      kind: "select",
      required: true,
      options: ["$", "$$"],
    },
    {
      id: "deadline",
      section: "Timeline",
      prompt: "Deadline?",
      kind: "text",
    },
  ];
  hoisted.state.extraQuestions = [
    {
      id: "transport",
      section: "Constraints",
      prompt: "Preferred transport?",
      kind: "multiselect",
      required: true,
      options: ["Car", "Plane"],
    },
  ];
});

function buildParams(commandBody: string, cfg: ClawdbotConfig, ctxOverrides?: Partial<MsgContext>) {
  const ctx = {
    Body: commandBody,
    CommandBody: commandBody,
    CommandSource: "cli",
    CommandAuthorized: true,
    Provider: "cli",
    Surface: "cli",
    ...ctxOverrides,
  } as MsgContext;

  const command = buildCommandContext({
    ctx,
    cfg,
    isGroup: false,
    triggerBodyNormalized: commandBody.trim().toLowerCase(),
    commandAuthorized: true,
  });

  return {
    ctx,
    cfg,
    command,
    directives: parseInlineDirectives(commandBody),
    elevated: { enabled: true, allowed: true, failures: [] },
    sessionKey: "agent:main:main",
    workspaceDir: testWorkspaceDir,
    defaultGroupActivation: () => "mention",
    resolvedVerboseLevel: "off" as const,
    resolvedReasoningLevel: "off" as const,
    resolveDefaultThinkingLevel: async () => undefined,
    provider: "cli",
    model: "test-model",
    contextTokens: 0,
    isGroup: false,
  };
}

async function getLatestPlanDir() {
  const plansDir = path.join(testWorkspaceDir, "plans");
  const entries = await fs.readdir(plansDir, { withFileTypes: true });
  const dirs = entries.filter((e) => e.isDirectory()).map((e) => e.name);
  expect(dirs.length).toBeGreaterThan(0);
  // Sort for determinism (timestamp prefix in name)
  dirs.sort();
  return path.join(plansDir, dirs[dirs.length - 1]);
}

describe("/plan TUI", () => {
  it("creates a plan directory and writes plan.md + answers.json + questions.json", async () => {
    (process.stdin as any).isTTY = true;
    (process.stdout as any).isTTY = true;

    const cfg = {
      commands: { text: true },
      agents: { defaults: { model: { primary: "openai/mock-1" } } },
    } as ClawdbotConfig;

    const result = await handleCommands(buildParams("/plan plan a trip", cfg));

    expect(result.shouldContinue).toBe(false);
    expect(result.reply?.text).toContain("Plan saved");

    const createdDir = await getLatestPlanDir();

    const planMd = await fs.readFile(path.join(createdDir, "plan.md"), "utf-8");
    const answers = JSON.parse(await fs.readFile(path.join(createdDir, "answers.json"), "utf-8"));
    const questions = JSON.parse(
      await fs.readFile(path.join(createdDir, "questions.json"), "utf-8"),
    );

    expect(planMd).toContain("# Plan");
    expect(Object.keys(answers).length).toBeGreaterThan(0);
    expect(questions.questions.length).toBeGreaterThan(0);
  });

  it("supports one-time extension at the end and uses multiselect for extra questions", async () => {
    (process.stdin as any).isTTY = true;
    (process.stdout as any).isTTY = true;

    // Ensure we accept the extra questions and multiselect returns both.
    hoisted.state.confirmQueue.push(true);
    hoisted.state.multiselectQueue.push(["Car", "Plane"]);

    const cfg = {
      commands: { text: true },
      agents: { defaults: { model: { primary: "openai/mock-1" } } },
    } as ClawdbotConfig;

    const result = await handleCommands(buildParams("/plan plan a trip", cfg));
    expect(result.shouldContinue).toBe(false);

    const createdDir = await getLatestPlanDir();
    const answers = JSON.parse(await fs.readFile(path.join(createdDir, "answers.json"), "utf-8"));
    const questions = JSON.parse(
      await fs.readFile(path.join(createdDir, "questions.json"), "utf-8"),
    );

    expect(questions.questions.some((q: any) => q.id === "transport")).toBe(true);
    expect(Array.isArray(answers.transport)).toBe(true);
    expect(answers.transport).toEqual(["Car", "Plane"]);
    expect(hoisted.clack.multiselect).toHaveBeenCalled();
  });

  it("does not ask extension confirm when extension returns no extra questions", async () => {
    (process.stdin as any).isTTY = true;
    (process.stdout as any).isTTY = true;

    hoisted.state.extraQuestions = [];

    const cfg = {
      commands: { text: true },
      agents: { defaults: { model: { primary: "openai/mock-1" } } },
    } as ClawdbotConfig;

    const result = await handleCommands(buildParams("/plan plan a trip", cfg));
    expect(result.shouldContinue).toBe(false);

    // confirm might still be used for other prompts; but in this template it shouldn't.
    // We assert it was not called with the extension message.
    const confirmCalls = (hoisted.clack.confirm as any).mock.calls as any[];
    const extensionCall = confirmCalls.find((c) =>
      String(c?.[0]?.message ?? "").includes("tighter the plan"),
    );
    expect(extensionCall).toBeUndefined();
  });

  it("dedupes extension questions by id", async () => {
    (process.stdin as any).isTTY = true;
    (process.stdout as any).isTTY = true;

    // Extension repeats an existing id.
    hoisted.state.extraQuestions = [
      {
        id: "budget",
        section: "Constraints",
        prompt: "Budget again?",
        kind: "select",
        required: true,
        options: ["$"],
      },
    ];

    const cfg = {
      commands: { text: true },
      agents: { defaults: { model: { primary: "openai/mock-1" } } },
    } as ClawdbotConfig;

    const result = await handleCommands(buildParams("/plan plan a trip", cfg));
    expect(result.shouldContinue).toBe(false);

    const createdDir = await getLatestPlanDir();
    const questions = JSON.parse(
      await fs.readFile(path.join(createdDir, "questions.json"), "utf-8"),
    );
    const ids = questions.questions.map((q: any) => q.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
  });

  it("cancels cleanly if plan name prompt is cancelled", async () => {
    (process.stdin as any).isTTY = true;
    (process.stdout as any).isTTY = true;

    hoisted.state.textQueue.push(CANCEL);

    const cfg = {
      commands: { text: true },
      agents: { defaults: { model: { primary: "openai/mock-1" } } },
    } as ClawdbotConfig;

    const result = await handleCommands(buildParams("/plan plan a trip", cfg));
    expect(result.shouldContinue).toBe(false);
    expect(result.reply?.text).toContain("Cancelled");
  });

  it("errors on required multiselect when user selects nothing", async () => {
    (process.stdin as any).isTTY = true;
    (process.stdout as any).isTTY = true;

    // Force extension with a required multiselect and accept it.
    hoisted.state.confirmQueue.push(true);
    hoisted.state.multiselectQueue.push([]);

    const cfg = {
      commands: { text: true },
      agents: { defaults: { model: { primary: "openai/mock-1" } } },
    } as ClawdbotConfig;

    const result = await handleCommands(buildParams("/plan plan a trip", cfg));
    expect(result.shouldContinue).toBe(false);
    expect(result.reply?.text).toContain("Missing required answer");
  });

  it("does not run TUI handler when not in a TTY", async () => {
    (process.stdin as any).isTTY = false;
    (process.stdout as any).isTTY = false;

    const cfg = {
      commands: { text: true },
      agents: { defaults: { model: { primary: "openai/mock-1" } } },
    } as ClawdbotConfig;

    const result = await handleCommands(buildParams("/plan plan a trip", cfg));
    expect(result.shouldContinue).toBe(true);
  });
});
