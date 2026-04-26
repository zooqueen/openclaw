import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Command } from "commander";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const gatewayRuntimeMock = vi.hoisted(() => ({
  callGatewayFromCli: vi.fn(),
}));

vi.mock("openclaw/plugin-sdk/browser-node-runtime", () => gatewayRuntimeMock);

import {
  registerWikiCli,
  runWikiBridgeImport,
  runWikiChatGptImport,
  runWikiChatGptRollback,
  runWikiDoctor,
  runWikiStatus,
} from "./cli.js";
import type { MemoryWikiPluginConfig } from "./config.js";
import { parseWikiMarkdown, renderWikiMarkdown } from "./markdown.js";
import { createMemoryWikiTestHarness } from "./test-helpers.js";

const { createVault } = createMemoryWikiTestHarness();
let suiteRoot = "";
let caseIndex = 0;

describe("memory-wiki cli", () => {
  beforeAll(async () => {
    suiteRoot = await fs.mkdtemp(path.join(os.tmpdir(), "memory-wiki-cli-suite-"));
  });

  afterAll(async () => {
    if (suiteRoot) {
      await fs.rm(suiteRoot, { recursive: true, force: true });
    }
  });

  beforeEach(() => {
    gatewayRuntimeMock.callGatewayFromCli.mockReset();
    vi.spyOn(process.stdout, "write").mockImplementation(
      (() => true) as typeof process.stdout.write,
    );
    process.exitCode = undefined;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.exitCode = undefined;
  });

  async function createCliVault(options?: {
    config?: MemoryWikiPluginConfig;
    initialize?: boolean;
  }) {
    return createVault({
      prefix: "memory-wiki-cli-",
      rootDir: path.join(suiteRoot, `case-${caseIndex++}`),
      initialize: options?.initialize,
      config: options?.config,
    });
  }

  async function createChatGptExport(rootDir: string) {
    const exportDir = path.join(rootDir, "chatgpt-export");
    await fs.mkdir(exportDir, { recursive: true });
    const conversations = [
      {
        conversation_id: "12345678-1234-1234-1234-1234567890ab",
        title: "Travel preference check",
        create_time: 1_712_363_200,
        update_time: 1_712_366_800,
        current_node: "assistant-1",
        mapping: {
          root: {},
          "user-1": {
            parent: "root",
            message: {
              author: { role: "user" },
              content: {
                parts: ["I prefer aisle seats and I don't want a hotel far from the airport."],
              },
            },
          },
          "assistant-1": {
            parent: "user-1",
            message: {
              author: { role: "assistant" },
              content: {
                parts: ["Noted. I will keep travel options close to the airport."],
              },
            },
          },
        },
      },
    ];
    await fs.writeFile(
      path.join(exportDir, "conversations.json"),
      `${JSON.stringify(conversations, null, 2)}\n`,
      "utf8",
    );
    return exportDir;
  }

  it("registers apply synthesis and writes a synthesis page", async () => {
    const { rootDir, config } = await createCliVault();
    const program = new Command();
    program.name("test");
    registerWikiCli(program, config);

    await program.parseAsync(
      [
        "wiki",
        "apply",
        "synthesis",
        "CLI Alpha",
        "--body",
        "Alpha from CLI.",
        "--source-id",
        "source.alpha",
        "--source-id",
        "source.beta",
      ],
      { from: "user" },
    );

    const page = await fs.readFile(path.join(rootDir, "syntheses", "cli-alpha.md"), "utf8");
    expect(page).toContain("Alpha from CLI.");
    expect(page).toContain("source.alpha");
    await expect(fs.readFile(path.join(rootDir, "index.md"), "utf8")).resolves.toContain(
      "[CLI Alpha](syntheses/cli-alpha.md)",
    );
  });

  it("registers apply metadata and preserves the page body", async () => {
    const { rootDir, config } = await createCliVault();
    const targetPath = path.join(rootDir, "entities", "alpha.md");
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.writeFile(
      targetPath,
      renderWikiMarkdown({
        frontmatter: {
          pageType: "entity",
          id: "entity.alpha",
          title: "Alpha",
          sourceIds: ["source.old"],
          confidence: 0.2,
        },
        body: `# Alpha

## Notes
<!-- openclaw:human:start -->
cli note
<!-- openclaw:human:end -->
`,
      }),
      "utf8",
    );

    const program = new Command();
    program.name("test");
    registerWikiCli(program, config);

    await program.parseAsync(
      [
        "wiki",
        "apply",
        "metadata",
        "entity.alpha",
        "--source-id",
        "source.new",
        "--contradiction",
        "Conflicts with source.beta",
        "--question",
        "Still active?",
        "--status",
        "review",
        "--clear-confidence",
      ],
      { from: "user" },
    );

    const page = await fs.readFile(path.join(rootDir, "entities", "alpha.md"), "utf8");
    const parsed = parseWikiMarkdown(page);
    expect(parsed.frontmatter).toMatchObject({
      sourceIds: ["source.new"],
      contradictions: ["Conflicts with source.beta"],
      questions: ["Still active?"],
      status: "review",
    });
    expect(parsed.frontmatter).not.toHaveProperty("confidence");
    expect(parsed.body).toContain("cli note");
  });

  it("runs wiki doctor and sets a non-zero exit code when warnings exist", async () => {
    const { rootDir, config } = await createCliVault({
      config: {
        vaultMode: "bridge",
        bridge: { enabled: false },
      },
    });
    const program = new Command();
    program.name("test");
    registerWikiCli(program, config);
    await fs.rm(rootDir, { recursive: true, force: true });

    await program.parseAsync(["wiki", "doctor", "--json"], { from: "user" });

    expect(process.exitCode).toBe(1);
  });

  it("routes bridge artifact status, doctor, and import through gateway rpc", async () => {
    const { config } = await createCliVault({
      config: {
        vaultMode: "bridge",
        bridge: { enabled: true, readMemoryArtifacts: true },
      },
    });
    const status = {
      vaultMode: "bridge",
      renderMode: "native",
      vaultPath: config.vault.path,
      vaultExists: true,
      bridge: config.bridge,
      bridgePublicArtifactCount: 2,
      obsidianCli: {
        enabled: false,
        requested: false,
        available: false,
        command: null,
      },
      unsafeLocal: {
        allowPrivateMemoryCoreAccess: false,
        pathCount: 0,
      },
      pageCounts: {
        entity: 0,
        concept: 0,
        source: 2,
        synthesis: 0,
        report: 0,
      },
      sourceCounts: {
        native: 0,
        bridge: 2,
        bridgeEvents: 0,
        unsafeLocal: 0,
        other: 0,
      },
      warnings: [],
    };
    const doctor = {
      healthy: true,
      warningCount: 0,
      status,
      fixes: [],
    };
    const importResult = {
      importedCount: 1,
      updatedCount: 1,
      skippedCount: 0,
      removedCount: 0,
      artifactCount: 2,
      workspaces: 1,
      pagePaths: ["sources/memory-bridge-alpha.md"],
      indexesRefreshed: true,
      indexUpdatedFiles: ["index.md"],
      indexRefreshReason: "import-changed",
    };
    gatewayRuntimeMock.callGatewayFromCli
      .mockResolvedValueOnce(status)
      .mockResolvedValueOnce(doctor)
      .mockResolvedValueOnce(importResult);

    await runWikiStatus({
      config,
      json: true,
      gateway: { url: "ws://127.0.0.1:18789", token: "test-token", timeout: "4000" },
    });
    await runWikiDoctor({
      config,
      json: true,
      gateway: { url: "ws://127.0.0.1:18789", token: "test-token", timeout: "4000" },
    });
    await runWikiBridgeImport({
      config,
      json: true,
      gateway: { url: "ws://127.0.0.1:18789", token: "test-token", timeout: "4000" },
    });

    expect(gatewayRuntimeMock.callGatewayFromCli).toHaveBeenNthCalledWith(
      1,
      "wiki.status",
      {
        url: "ws://127.0.0.1:18789",
        token: "test-token",
        timeout: "4000",
        json: true,
      },
      {},
      { expectFinal: false },
    );
    expect(gatewayRuntimeMock.callGatewayFromCli).toHaveBeenNthCalledWith(
      2,
      "wiki.doctor",
      {
        url: "ws://127.0.0.1:18789",
        token: "test-token",
        timeout: "4000",
        json: true,
      },
      {},
      { expectFinal: false },
    );
    expect(gatewayRuntimeMock.callGatewayFromCli).toHaveBeenNthCalledWith(
      3,
      "wiki.bridge.import",
      {
        url: "ws://127.0.0.1:18789",
        token: "test-token",
        timeout: "4000",
        json: true,
      },
      {},
      { expectFinal: false },
    );
  });

  it("keeps bridge artifact-disabled status and import on the local path", async () => {
    const { config } = await createCliVault({
      config: {
        vaultMode: "bridge",
        bridge: { enabled: true, readMemoryArtifacts: false },
      },
    });

    const status = await runWikiStatus({ config, json: true });
    const importResult = await runWikiBridgeImport({ config, json: true });

    expect(status.bridgePublicArtifactCount).toBeNull();
    expect(importResult.artifactCount).toBe(0);
    expect(gatewayRuntimeMock.callGatewayFromCli).not.toHaveBeenCalled();
  });

  it("imports ChatGPT exports with dry-run, apply, and rollback", async () => {
    const { rootDir, config } = await createCliVault({ initialize: true });
    const exportDir = await createChatGptExport(rootDir);

    const dryRun = await runWikiChatGptImport({
      config,
      exportPath: exportDir,
      dryRun: true,
      json: true,
    });
    expect(dryRun.dryRun).toBe(true);
    expect(dryRun.createdCount).toBe(1);
    await expect(fs.readdir(path.join(rootDir, "sources"))).resolves.toEqual([]);

    const applied = await runWikiChatGptImport({
      config,
      exportPath: exportDir,
      json: true,
    });
    expect(applied.runId).toBeTruthy();
    expect(applied.createdCount).toBe(1);
    const sourceFiles = (await fs.readdir(path.join(rootDir, "sources"))).filter(
      (entry) => entry !== "index.md",
    );
    expect(sourceFiles).toHaveLength(1);
    const pageContent = await fs.readFile(path.join(rootDir, "sources", sourceFiles[0]), "utf8");
    expect(pageContent).toContain("ChatGPT Export: Travel preference check");
    expect(pageContent).toContain("I prefer aisle seats");
    expect(pageContent).toContain("Preference signals:");

    const secondDryRun = await runWikiChatGptImport({
      config,
      exportPath: exportDir,
      dryRun: true,
      json: true,
    });
    expect(secondDryRun.createdCount).toBe(0);
    expect(secondDryRun.updatedCount).toBe(0);
    expect(secondDryRun.skippedCount).toBe(1);

    const rollback = await runWikiChatGptRollback({
      config,
      runId: applied.runId!,
      json: true,
    });
    expect(rollback.alreadyRolledBack).toBe(false);
    await expect(
      fs
        .readdir(path.join(rootDir, "sources"))
        .then((entries) => entries.filter((entry) => entry !== "index.md")),
    ).resolves.toEqual([]);
  });
});
