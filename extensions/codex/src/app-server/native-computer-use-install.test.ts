import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  installNativeComputerUsePackage,
  type NativeComputerUseNodesRuntime,
} from "./native-computer-use-install.js";

describe("native Computer Use package install", () => {
  const cleanupPaths: string[] = [];

  afterEach(() => {
    for (const cleanupPath of cleanupPaths.splice(0)) {
      fs.rmSync(cleanupPath, { recursive: true, force: true });
    }
  });

  it("streams a Codex Computer Use package to the connected OpenClaw app node", async () => {
    const packagePath = makeComputerUsePackage();
    const invocations: Array<{ command: string; params: Record<string, unknown> }> = [];
    const nodes = createNodesRuntime(invocations);

    await expect(
      installNativeComputerUsePackage(nodes, {
        packagePath,
        pluginName: "computer-use",
        mcpServerName: "computer-use",
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        ready: true,
        nodeId: "mac-node",
        files: 2,
      }),
    );

    expect(invocations.map((call) => call.command)).toEqual([
      "mcp.package.install.begin",
      "mcp.package.install.chunk",
      "mcp.package.install.chunk",
      "mcp.package.install.finish",
    ]);
    const begin = invocations[0]?.params;
    expect(begin).toEqual(
      expect.objectContaining({
        nodeId: "mac-node",
        serverId: "computer-use",
        packageName: "computer-use",
        sourcePath: packagePath,
        fileCount: 2,
      }),
    );
    expect(invocations.slice(1, 3).map((call) => call.params.relativePath)).toEqual([
      ".mcp.json",
      "bin/sky-client",
    ]);
  });

  it("does not resend the package when the native node already advertises ready", async () => {
    const packagePath = makeComputerUsePackage();
    const invocations: Array<{ command: string; params: Record<string, unknown> }> = [];
    const nodes = createNodesRuntime(invocations, {
      mcpServers: [{ id: "computer-use", status: "ready" }],
    });

    await expect(
      installNativeComputerUsePackage(nodes, {
        packagePath,
        pluginName: "computer-use",
        mcpServerName: "computer-use",
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        ready: true,
        nodeId: "mac-node",
        message: "OpenClaw.app already hosts Computer Use on Mac.",
      }),
    );
    expect(invocations).toEqual([]);
  });

  it("cancels the native transfer if a chunk fails", async () => {
    const packagePath = makeComputerUsePackage();
    const invocations: Array<{ command: string; params: Record<string, unknown> }> = [];
    const nodes = createNodesRuntime(invocations, { failCommand: "mcp.package.install.chunk" });

    await expect(
      installNativeComputerUsePackage(nodes, {
        packagePath,
        pluginName: "computer-use",
        mcpServerName: "computer-use",
      }),
    ).rejects.toThrow("chunk failed");
    expect(invocations.at(-1)?.command).toBe("mcp.package.install.cancel");
  });

  it("requires a connected native package host", async () => {
    const packagePath = makeComputerUsePackage();
    const nodes: NativeComputerUseNodesRuntime = {
      list: vi.fn(async () => ({ nodes: [] })),
      invoke: vi.fn(),
    };

    await expect(
      installNativeComputerUsePackage(nodes, {
        packagePath,
        pluginName: "computer-use",
        mcpServerName: "computer-use",
      }),
    ).rejects.toThrow("No connected OpenClaw.app node");
  });

  function makeComputerUsePackage(): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-native-computer-use-"));
    cleanupPaths.push(root);
    const packagePath = path.join(root, "computer-use");
    fs.mkdirSync(path.join(packagePath, "bin"), { recursive: true });
    fs.writeFileSync(
      path.join(packagePath, ".mcp.json"),
      JSON.stringify({
        mcpServers: {
          "computer-use": {
            command: "./bin/sky-client",
            args: ["mcp"],
            cwd: ".",
          },
        },
      }),
    );
    fs.writeFileSync(path.join(packagePath, "bin", "sky-client"), "#!/bin/sh\n");
    fs.chmodSync(path.join(packagePath, "bin", "sky-client"), 0o755);
    return packagePath;
  }
});

function createNodesRuntime(
  invocations: Array<{ command: string; params: Record<string, unknown> }>,
  options: {
    mcpServers?: Array<{ id: string; status?: string }>;
    failCommand?: string;
  } = {},
): NativeComputerUseNodesRuntime {
  return {
    async list() {
      return {
        nodes: [
          {
            nodeId: "mac-node",
            displayName: "Mac",
            connected: true,
            caps: ["mcpHost"],
            commands: [
              "mcp.package.install.begin",
              "mcp.package.install.chunk",
              "mcp.package.install.finish",
              "mcp.package.install.cancel",
            ],
            mcpServers: options.mcpServers,
          },
        ],
      };
    },
    async invoke(params) {
      invocations.push({
        command: params.command,
        params: params.params as Record<string, unknown>,
      });
      if (params.command === options.failCommand) {
        throw new Error("chunk failed");
      }
      return {
        ok: true,
        payloadJSON: JSON.stringify({ ok: true }),
      };
    },
  };
}
