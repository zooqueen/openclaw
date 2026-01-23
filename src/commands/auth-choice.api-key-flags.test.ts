import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { RuntimeEnv } from "../runtime.js";
import type { WizardPrompter } from "../wizard/prompts.js";
import { AUTH_STORE_VERSION } from "../agents/auth-profiles/constants.js";
import { applyAuthChoice } from "./auth-choice.js";

const noopAsync = async () => {};
const noop = () => {};
const authProfilePathFor = (agentDir: string) => path.join(agentDir, "auth-profiles.json");

const previousStateDir = process.env.CLAWDBOT_STATE_DIR;
const previousAgentDir = process.env.CLAWDBOT_AGENT_DIR;
const previousPiAgentDir = process.env.PI_CODING_AGENT_DIR;
const previousAnthropicKey = process.env.ANTHROPIC_API_KEY;
const previousOpenaiKey = process.env.OPENAI_API_KEY;
let tempStateDir: string | null = null;

async function setupTempState() {
  tempStateDir = await fs.mkdtemp(path.join(os.tmpdir(), "clawdbot-auth-"));
  process.env.CLAWDBOT_STATE_DIR = tempStateDir;
  process.env.CLAWDBOT_AGENT_DIR = path.join(tempStateDir, "agent");
  process.env.PI_CODING_AGENT_DIR = process.env.CLAWDBOT_AGENT_DIR;
  await fs.mkdir(process.env.CLAWDBOT_AGENT_DIR, { recursive: true });
}

function buildPrompter() {
  const text = vi.fn(async () => "");
  const confirm = vi.fn(async () => false);
  const prompter: WizardPrompter = {
    intro: vi.fn(noopAsync),
    outro: vi.fn(noopAsync),
    note: vi.fn(noopAsync),
    select: vi.fn(async () => "" as never),
    multiselect: vi.fn(async () => []),
    text,
    confirm,
    progress: vi.fn(() => ({ update: noop, stop: noop })),
  };
  return { prompter, text, confirm };
}

const runtime: RuntimeEnv = {
  log: vi.fn(),
  error: vi.fn(),
  exit: vi.fn((code: number) => {
    throw new Error(`exit:${code}`);
  }),
};

afterEach(async () => {
  if (tempStateDir) {
    await fs.rm(tempStateDir, { recursive: true, force: true });
    tempStateDir = null;
  }
  if (previousStateDir === undefined) {
    delete process.env.CLAWDBOT_STATE_DIR;
  } else {
    process.env.CLAWDBOT_STATE_DIR = previousStateDir;
  }
  if (previousAgentDir === undefined) {
    delete process.env.CLAWDBOT_AGENT_DIR;
  } else {
    process.env.CLAWDBOT_AGENT_DIR = previousAgentDir;
  }
  if (previousPiAgentDir === undefined) {
    delete process.env.PI_CODING_AGENT_DIR;
  } else {
    process.env.PI_CODING_AGENT_DIR = previousPiAgentDir;
  }
  if (previousAnthropicKey === undefined) {
    delete process.env.ANTHROPIC_API_KEY;
  } else {
    process.env.ANTHROPIC_API_KEY = previousAnthropicKey;
  }
  if (previousOpenaiKey === undefined) {
    delete process.env.OPENAI_API_KEY;
  } else {
    process.env.OPENAI_API_KEY = previousOpenaiKey;
  }
});

describe("applyAuthChoice with apiKey flags", () => {
  it("uses provided openrouter token when authChoice=apiKey", async () => {
    await setupTempState();
    const agentDir = process.env.CLAWDBOT_AGENT_DIR ?? "";
    const authProfilePath = authProfilePathFor(agentDir);
    await fs.writeFile(
      authProfilePath,
      JSON.stringify({
        version: AUTH_STORE_VERSION,
        profiles: {
          "openrouter:legacy": {
            type: "oauth",
            provider: "openrouter",
            access: "access",
            refresh: "refresh",
            expires: Date.now() + 60_000,
          },
        },
      }),
      "utf8",
    );

    const { prompter, text, confirm } = buildPrompter();
    const result = await applyAuthChoice({
      authChoice: "apiKey",
      config: {},
      prompter,
      runtime,
      setDefaultModel: true,
      opts: {
        tokenProvider: "openrouter",
        token: "sk-openrouter-flag",
      },
    });

    expect(text).not.toHaveBeenCalled();
    expect(confirm).not.toHaveBeenCalled();
    expect(result.config.auth?.profiles?.["openrouter:default"]).toMatchObject({
      provider: "openrouter",
      mode: "api_key",
    });

    const raw = await fs.readFile(authProfilePath, "utf8");
    const parsed = JSON.parse(raw) as { profiles?: Record<string, { key?: string }> };
    expect(parsed.profiles?.["openrouter:default"]?.key).toBe("sk-openrouter-flag");
  });

  it("uses provided openai token when authChoice=apiKey", async () => {
    await setupTempState();
    const { prompter, text, confirm } = buildPrompter();

    await applyAuthChoice({
      authChoice: "apiKey",
      config: {},
      prompter,
      runtime,
      setDefaultModel: true,
      opts: {
        tokenProvider: "openai",
        token: "sk-openai-flag",
      },
    });

    expect(text).not.toHaveBeenCalled();
    expect(confirm).not.toHaveBeenCalled();
    expect(process.env.OPENAI_API_KEY).toBe("sk-openai-flag");
    const envPath = path.join(process.env.CLAWDBOT_STATE_DIR ?? "", ".env");
    const envContents = await fs.readFile(envPath, "utf8");
    expect(envContents).toContain("OPENAI_API_KEY=sk-openai-flag");
  });

  it("uses provided anthropic token when authChoice=apiKey", async () => {
    await setupTempState();
    process.env.ANTHROPIC_API_KEY = "sk-env-test";
    const { prompter, text, confirm } = buildPrompter();

    await applyAuthChoice({
      authChoice: "apiKey",
      config: {},
      prompter,
      runtime,
      setDefaultModel: true,
      opts: {
        tokenProvider: "anthropic",
        token: "sk-anthropic-flag",
      },
    });

    expect(text).not.toHaveBeenCalled();
    expect(confirm).not.toHaveBeenCalled();

    const authProfilePath = authProfilePathFor(process.env.CLAWDBOT_AGENT_DIR ?? "");
    const raw = await fs.readFile(authProfilePath, "utf8");
    const parsed = JSON.parse(raw) as { profiles?: Record<string, { key?: string }> };
    expect(parsed.profiles?.["anthropic:default"]?.key).toBe("sk-anthropic-flag");
  });
});
