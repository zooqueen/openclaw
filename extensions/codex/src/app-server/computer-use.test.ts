import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ensureCodexComputerUse,
  installCodexComputerUse,
  readCodexComputerUseStatus,
  setupCodexComputerUsePermissions,
  type CodexComputerUseRequest,
} from "./computer-use.js";

describe("Codex Computer Use setup", () => {
  const cleanupPaths: string[] = [];

  afterEach(() => {
    vi.useRealTimers();
    for (const cleanupPath of cleanupPaths.splice(0)) {
      fs.rmSync(cleanupPath, { recursive: true, force: true });
    }
  });

  it("stays disabled until configured", async () => {
    await expect(
      readCodexComputerUseStatus({ pluginConfig: {}, request: vi.fn() }),
    ).resolves.toEqual(
      expect.objectContaining({
        enabled: false,
        ready: false,
        reason: "disabled",
        message: "Computer Use is disabled.",
      }),
    );
  });

  it("reports an installed Computer Use MCP server from a registered marketplace", async () => {
    const request = createComputerUseRequest({ installed: true });

    await expect(
      readCodexComputerUseStatus({
        pluginConfig: { computerUse: { enabled: true, marketplaceName: "desktop-tools" } },
        request,
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        enabled: true,
        ready: true,
        reason: "ready",
        installed: true,
        pluginEnabled: true,
        mcpServerAvailable: true,
        marketplaceName: "desktop-tools",
        tools: ["list_apps"],
        message: "Computer Use is ready.",
      }),
    );
    expect(request).not.toHaveBeenCalledWith("marketplace/add", expect.anything());
    expect(request).not.toHaveBeenCalledWith(
      "experimentalFeature/enablement/set",
      expect.anything(),
    );
    expect(request).not.toHaveBeenCalledWith("plugin/install", expect.anything());
  });

  it("reports an installed but disabled Computer Use plugin separately", async () => {
    const request = createComputerUseRequest({ installed: true, enabled: false });

    await expect(
      readCodexComputerUseStatus({
        pluginConfig: { computerUse: { enabled: true, marketplaceName: "desktop-tools" } },
        request,
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        ready: false,
        reason: "plugin_disabled",
        installed: true,
        pluginEnabled: false,
        mcpServerAvailable: false,
        message:
          "Computer Use is installed, but the computer-use plugin is disabled. Run /codex computer-use install or enable computerUse.autoInstall to re-enable it.",
      }),
    );
    expect(request).not.toHaveBeenCalledWith("plugin/install", expect.anything());
  });

  it("does not register marketplace sources during status checks", async () => {
    const request = createComputerUseRequest({ installed: true });

    await expect(
      readCodexComputerUseStatus({
        pluginConfig: {
          computerUse: {
            enabled: true,
            marketplaceSource: "github:example/desktop-tools",
          },
        },
        request,
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        ready: true,
        reason: "ready",
        message: "Computer Use is ready.",
      }),
    );
    expect(request).not.toHaveBeenCalledWith("marketplace/add", expect.anything());
    expect(request).not.toHaveBeenCalledWith(
      "experimentalFeature/enablement/set",
      expect.anything(),
    );
  });

  it("fails closed when multiple marketplaces contain Computer Use", async () => {
    const request = createAmbiguousComputerUseRequest();

    await expect(
      readCodexComputerUseStatus({
        pluginConfig: { computerUse: { enabled: true } },
        request,
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        ready: false,
        reason: "marketplace_missing",
        message:
          "Multiple Codex marketplaces contain computer-use. Configure computerUse.marketplaceName or computerUse.marketplacePath to choose one.",
      }),
    );
    expect(request).not.toHaveBeenCalledWith("plugin/read", expect.anything());
  });

  it("installs Computer Use from a configured marketplace source", async () => {
    const request = createComputerUseRequest({ installed: false });

    await expect(
      installCodexComputerUse({
        pluginConfig: {
          computerUse: {
            marketplaceSource: "github:example/desktop-tools",
          },
        },
        request,
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        ready: true,
        reason: "ready",
        installed: true,
        pluginEnabled: true,
        tools: ["list_apps"],
      }),
    );
    expect(request).toHaveBeenCalledWith("experimentalFeature/enablement/set", {
      enablement: { plugins: true },
    });
    expect(request).toHaveBeenCalledWith("marketplace/add", {
      source: "github:example/desktop-tools",
    });
    expect(request).toHaveBeenCalledWith("plugin/install", {
      marketplacePath: "/marketplaces/desktop-tools/.agents/plugins/marketplace.json",
      pluginName: "computer-use",
    });
    expect(request).toHaveBeenCalledWith("config/mcpServer/reload", undefined);
  });

  it("re-enables an installed but disabled Computer Use plugin during install", async () => {
    const request = createComputerUseRequest({ installed: true, enabled: false });

    await expect(
      installCodexComputerUse({
        pluginConfig: { computerUse: { marketplaceName: "desktop-tools" } },
        request,
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        ready: true,
        reason: "ready",
        installed: true,
        pluginEnabled: true,
        message: "Computer Use is ready.",
      }),
    );
    expect(request).toHaveBeenCalledWith("plugin/install", {
      marketplacePath: "/marketplaces/desktop-tools/.agents/plugins/marketplace.json",
      pluginName: "computer-use",
    });
  });

  it("fails closed when Computer Use is required but not installed", async () => {
    const request = createComputerUseRequest({ installed: false });

    await expect(
      ensureCodexComputerUse({
        pluginConfig: { computerUse: { enabled: true, marketplaceName: "desktop-tools" } },
        request,
      }),
    ).rejects.toMatchObject({
      status: expect.objectContaining({
        reason: "plugin_not_installed",
      }),
    });
    expect(request).not.toHaveBeenCalledWith("plugin/install", expect.anything());
  });

  it("skips setup writes when auto-install is already ready", async () => {
    const request = createComputerUseRequest({ installed: true });

    await expect(
      ensureCodexComputerUse({
        pluginConfig: {
          computerUse: {
            enabled: true,
            autoInstall: true,
            marketplaceName: "desktop-tools",
          },
        },
        request,
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        ready: true,
        reason: "ready",
        message: "Computer Use is ready.",
      }),
    );
    expect(request).not.toHaveBeenCalledWith("marketplace/add", expect.anything());
    expect(request).not.toHaveBeenCalledWith(
      "experimentalFeature/enablement/set",
      expect.anything(),
    );
    expect(request).not.toHaveBeenCalledWith("plugin/install", expect.anything());
  });

  it("uses setup writes when auto-install needs to install", async () => {
    const request = createComputerUseRequest({ installed: false });

    await expect(
      ensureCodexComputerUse({
        pluginConfig: {
          computerUse: {
            enabled: true,
            autoInstall: true,
          },
        },
        request,
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        ready: true,
        reason: "ready",
        message: "Computer Use is ready.",
      }),
    );
    expect(request).toHaveBeenCalledWith("experimentalFeature/enablement/set", {
      enablement: { plugins: true },
    });
    expect(request).not.toHaveBeenCalledWith("marketplace/add", expect.anything());
    expect(request).toHaveBeenCalledWith("plugin/install", {
      marketplacePath: "/marketplaces/desktop-tools/.agents/plugins/marketplace.json",
      pluginName: "computer-use",
    });
  });

  it("auto-registers the bundled Codex app marketplace during auto-install", async () => {
    const bundledMarketplacePath = fs.mkdtempSync(
      path.join(os.tmpdir(), "openclaw-codex-bundled-marketplace-"),
    );
    cleanupPaths.push(bundledMarketplacePath);
    const request = createBundledMarketplaceComputerUseRequest(bundledMarketplacePath);

    await expect(
      ensureCodexComputerUse({
        pluginConfig: {
          computerUse: {
            enabled: true,
            autoInstall: true,
          },
        },
        request,
        defaultBundledMarketplacePath: bundledMarketplacePath,
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        ready: true,
        reason: "ready",
        marketplaceName: "openai-bundled",
        message: "Computer Use is ready.",
      }),
    );
    expect(request).toHaveBeenCalledWith("marketplace/add", {
      source: bundledMarketplacePath,
    });
    expect(request).toHaveBeenCalledWith("plugin/install", {
      marketplacePath: `${bundledMarketplacePath}/.agents/plugins/marketplace.json`,
      pluginName: "computer-use",
    });
  });

  it("allows auto-install from a configured local marketplace path", async () => {
    const request = createComputerUseRequest({ installed: false });

    await expect(
      ensureCodexComputerUse({
        pluginConfig: {
          computerUse: {
            enabled: true,
            autoInstall: true,
            marketplacePath: "/marketplaces/desktop-tools/.agents/plugins/marketplace.json",
          },
        },
        request,
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        ready: true,
        reason: "ready",
        message: "Computer Use is ready.",
      }),
    );
    expect(request).not.toHaveBeenCalledWith("marketplace/add", expect.anything());
    expect(request).toHaveBeenCalledWith("plugin/install", {
      marketplacePath: "/marketplaces/desktop-tools/.agents/plugins/marketplace.json",
      pluginName: "computer-use",
    });
  });

  it("requires an explicit install command for configured marketplace sources", async () => {
    const request = createComputerUseRequest({ installed: false });

    await expect(
      ensureCodexComputerUse({
        pluginConfig: {
          computerUse: {
            enabled: true,
            autoInstall: true,
            marketplaceSource: "github:example/desktop-tools",
          },
        },
        request,
      }),
    ).rejects.toMatchObject({
      status: expect.objectContaining({
        reason: "auto_install_blocked",
      }),
    });
    expect(request).not.toHaveBeenCalledWith("marketplace/add", expect.anything());
    expect(request).not.toHaveBeenCalledWith("plugin/install", expect.anything());
  });

  it("fails closed when a configured marketplace name is not discovered", async () => {
    const request = createEmptyMarketplaceComputerUseRequest();

    await expect(
      readCodexComputerUseStatus({
        pluginConfig: {
          computerUse: {
            enabled: true,
            marketplaceName: "missing-marketplace",
          },
        },
        request,
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        ready: false,
        reason: "marketplace_missing",
        message:
          "Configured Codex marketplace missing-marketplace was not found or does not contain computer-use. Run /codex computer-use install with a source or path to install from a new marketplace.",
      }),
    );
    expect(request).not.toHaveBeenCalledWith("plugin/read", expect.anything());
  });

  it("fails closed instead of installing from a remote-only Codex marketplace", async () => {
    const request = createRemoteOnlyComputerUseRequest();

    await expect(
      installCodexComputerUse({
        pluginConfig: { computerUse: { marketplaceName: "openai-curated" } },
        request,
      }),
    ).rejects.toMatchObject({
      status: expect.objectContaining({
        ready: false,
        reason: "remote_install_unsupported",
        installed: false,
        pluginEnabled: false,
        marketplaceName: "openai-curated",
        message:
          "Computer Use is available in remote Codex marketplace openai-curated, but Codex app-server does not support remote plugin install yet. Configure computerUse.marketplaceSource or computerUse.marketplacePath for a local marketplace, then run /codex computer-use install.",
      }),
    });
    expect(request).not.toHaveBeenCalledWith("plugin/install", expect.anything());
  });

  it("waits for the default Codex marketplace during install", async () => {
    vi.useFakeTimers();
    const request = createComputerUseRequest({
      installed: false,
      marketplaceAvailableAfterListCalls: 3,
    });
    const installed = installCodexComputerUse({
      pluginConfig: { computerUse: {} },
      request,
    });

    await vi.advanceTimersByTimeAsync(4_000);

    await expect(installed).resolves.toEqual(
      expect.objectContaining({
        ready: true,
        reason: "ready",
        message: "Computer Use is ready.",
      }),
    );
    expect(request).toHaveBeenCalledWith("plugin/install", {
      marketplacePath: "/marketplaces/desktop-tools/.agents/plugins/marketplace.json",
      pluginName: "computer-use",
    });
    expect(
      vi.mocked(request).mock.calls.filter(([method]) => method === "plugin/list"),
    ).toHaveLength(3);
  });

  it("prefers the official Computer Use marketplace when multiple matches are present", async () => {
    const request = createMultiMarketplaceComputerUseRequest();

    await expect(
      installCodexComputerUse({
        pluginConfig: { computerUse: {} },
        request,
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        ready: true,
        reason: "ready",
        marketplaceName: "openai-curated",
      }),
    );
    expect(request).toHaveBeenCalledWith("plugin/install", {
      marketplacePath: "/marketplaces/openai-curated/.agents/plugins/marketplace.json",
      pluginName: "computer-use",
    });
  });

  it("runs the Computer Use setup probe through app-server MCP", async () => {
    const request = createComputerUseRequest({ installed: false });

    await expect(
      setupCodexComputerUsePermissions({
        pluginConfig: { computerUse: { enabled: true, autoInstall: true } },
        request,
        cwd: "/repo",
      }),
    ).resolves.toEqual({
      status: expect.objectContaining({
        ready: true,
        reason: "ready",
        installed: true,
        pluginEnabled: true,
        tools: ["list_apps"],
      }),
      probe: {
        attempted: true,
        state: "completed",
        toolName: "list_apps",
        threadId: "thread-computer-use-setup",
        message:
          "Computer Use setup probe completed. If a Codex Computer Use permissions window appeared, follow it to finish macOS setup.",
      },
    });
    expect(request).toHaveBeenCalledWith(
      "thread/start",
      expect.objectContaining({
        cwd: "/repo",
        ephemeral: true,
        experimentalRawEvents: false,
        persistExtendedHistory: false,
      }),
    );
    expect(request).toHaveBeenCalledWith("mcpServer/tool/call", {
      threadId: "thread-computer-use-setup",
      server: "computer-use",
      tool: "list_apps",
      arguments: {},
    });
  });

  it("reports pending native permissions from the setup probe", async () => {
    const request = createComputerUseRequest({
      installed: true,
      toolCallText: "Computer Use permissions are still pending.",
      toolCallIsError: true,
    });

    await expect(
      setupCodexComputerUsePermissions({
        pluginConfig: { computerUse: { enabled: true } },
        request,
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        probe: expect.objectContaining({
          attempted: true,
          state: "permissions_pending",
          message:
            "Computer Use opened its permission flow. Finish the Codex Computer Use window and macOS System Settings, then run /codex computer-use setup again.",
        }),
      }),
    );
  });

  it("skips the setup probe when the read-only setup tool is unavailable", async () => {
    const request = createComputerUseRequest({ installed: true, tools: ["get_app_state"] });

    await expect(
      setupCodexComputerUsePermissions({
        pluginConfig: { computerUse: { enabled: true } },
        request,
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        probe: {
          attempted: false,
          state: "skipped",
          toolName: "list_apps",
          message:
            "Computer Use is ready, but setup did not run because the list_apps MCP tool is unavailable.",
        },
      }),
    );
    expect(request).not.toHaveBeenCalledWith("thread/start", expect.anything());
    expect(request).not.toHaveBeenCalledWith("mcpServer/tool/call", expect.anything());
  });
});

function createComputerUseRequest(params: {
  installed: boolean;
  enabled?: boolean;
  marketplaceAvailableAfterListCalls?: number;
  toolCallIsError?: boolean;
  toolCallText?: string;
  tools?: string[];
}): CodexComputerUseRequest {
  let installed = params.installed;
  let enabled = params.enabled ?? installed;
  let pluginListCalls = 0;
  const tools = params.tools ?? ["list_apps"];
  return vi.fn(async (method: string, requestParams?: unknown) => {
    if (method === "experimentalFeature/enablement/set") {
      return { enablement: { plugins: true } };
    }
    if (method === "marketplace/add") {
      return {
        marketplaceName: "desktop-tools",
        installedRoot: "/marketplaces/desktop-tools",
        alreadyAdded: false,
      };
    }
    if (method === "plugin/list") {
      pluginListCalls += 1;
      const marketplaceAvailable =
        pluginListCalls >= (params.marketplaceAvailableAfterListCalls ?? 1);
      return {
        marketplaces: marketplaceAvailable
          ? [
              {
                name: "desktop-tools",
                path: "/marketplaces/desktop-tools/.agents/plugins/marketplace.json",
                interface: null,
                plugins: [pluginSummary(installed, "desktop-tools", enabled)],
              },
            ]
          : [],
        marketplaceLoadErrors: [],
        featuredPluginIds: [],
      };
    }
    if (method === "plugin/read") {
      expect(requestParams).toEqual(
        expect.objectContaining({
          pluginName: "computer-use",
        }),
      );
      return {
        plugin: {
          marketplaceName: "desktop-tools",
          marketplacePath: "/marketplaces/desktop-tools/.agents/plugins/marketplace.json",
          summary: pluginSummary(installed, "desktop-tools", enabled),
          description: "Control desktop apps.",
          skills: [],
          apps: [],
          mcpServers: ["computer-use"],
        },
      };
    }
    if (method === "plugin/install") {
      installed = true;
      enabled = true;
      return { authPolicy: "ON_INSTALL", appsNeedingAuth: [] };
    }
    if (method === "config/mcpServer/reload") {
      return undefined;
    }
    if (method === "mcpServerStatus/list") {
      return {
        data:
          installed && enabled
            ? [
                {
                  name: "computer-use",
                  tools: Object.fromEntries(
                    tools.map((tool) => [tool, { name: tool, inputSchema: { type: "object" } }]),
                  ),
                  resources: [],
                  resourceTemplates: [],
                  authStatus: "unsupported",
                },
              ]
            : [],
        nextCursor: null,
      };
    }
    if (method === "thread/start") {
      return {
        thread: { id: "thread-computer-use-setup", cwd: "/repo" },
        model: "gpt-5.5",
        modelProvider: "openai",
        serviceTier: null,
        cwd: "/repo",
        instructionSources: [],
        approvalPolicy: "never",
        approvalsReviewer: "user",
        sandbox: { type: "dangerFullAccess" },
        permissionProfile: null,
        reasoningEffort: null,
      };
    }
    if (method === "mcpServer/tool/call") {
      return {
        content: [{ type: "text", text: params.toolCallText ?? "[]" }],
        isError: params.toolCallIsError ?? false,
      };
    }
    throw new Error(`unexpected request ${method}`);
  }) as CodexComputerUseRequest;
}

function createRemoteOnlyComputerUseRequest(): CodexComputerUseRequest {
  return vi.fn(async (method: string, requestParams?: unknown) => {
    if (method === "experimentalFeature/enablement/set") {
      return { enablement: { plugins: true } };
    }
    if (method === "plugin/list") {
      return {
        marketplaces: [
          {
            name: "openai-curated",
            path: null,
            interface: null,
            plugins: [pluginSummary(false, "openai-curated", false, "remote")],
          },
        ],
        marketplaceLoadErrors: [],
        featuredPluginIds: [],
      };
    }
    if (method === "plugin/read") {
      expect(requestParams).toEqual({
        remoteMarketplaceName: "openai-curated",
        pluginName: "computer-use",
      });
      return {
        plugin: {
          marketplaceName: "openai-curated",
          marketplacePath: null,
          summary: pluginSummary(false, "openai-curated", false, "remote"),
          description: "Control desktop apps.",
          skills: [],
          apps: [],
          mcpServers: ["computer-use"],
        },
      };
    }
    throw new Error(`unexpected request ${method}`);
  }) as CodexComputerUseRequest;
}

function createAmbiguousComputerUseRequest(): CodexComputerUseRequest {
  return vi.fn(async (method: string) => {
    if (method === "plugin/list") {
      return {
        marketplaces: [
          {
            name: "desktop-tools",
            path: "/marketplaces/desktop-tools/.agents/plugins/marketplace.json",
            interface: null,
            plugins: [pluginSummary(true, "desktop-tools")],
          },
          {
            name: "other-tools",
            path: "/marketplaces/other-tools/.agents/plugins/marketplace.json",
            interface: null,
            plugins: [pluginSummary(true, "other-tools")],
          },
        ],
        marketplaceLoadErrors: [],
        featuredPluginIds: [],
      };
    }
    throw new Error(`unexpected request ${method}`);
  }) as CodexComputerUseRequest;
}

function createEmptyMarketplaceComputerUseRequest(): CodexComputerUseRequest {
  return vi.fn(async (method: string) => {
    if (method === "plugin/list") {
      return {
        marketplaces: [],
        marketplaceLoadErrors: [],
        featuredPluginIds: [],
      };
    }
    throw new Error(`unexpected request ${method}`);
  }) as CodexComputerUseRequest;
}

function createMultiMarketplaceComputerUseRequest(): CodexComputerUseRequest {
  let installed = false;
  return vi.fn(async (method: string, requestParams?: unknown) => {
    if (method === "experimentalFeature/enablement/set") {
      return { enablement: { plugins: true } };
    }
    if (method === "plugin/list") {
      return {
        marketplaces: [
          marketplaceEntry("workspace-tools", false),
          marketplaceEntry("openai-curated", installed),
        ],
        marketplaceLoadErrors: [],
        featuredPluginIds: [],
      };
    }
    if (method === "plugin/read") {
      return {
        plugin: {
          marketplaceName: "openai-curated",
          marketplacePath: "/marketplaces/openai-curated/.agents/plugins/marketplace.json",
          summary: pluginSummary(installed, "openai-curated"),
          description: "Control desktop apps.",
          skills: [],
          apps: [],
          mcpServers: ["computer-use"],
        },
      };
    }
    if (method === "plugin/install") {
      expect(requestParams).toEqual({
        marketplacePath: "/marketplaces/openai-curated/.agents/plugins/marketplace.json",
        pluginName: "computer-use",
      });
      installed = true;
      return { authPolicy: "ON_INSTALL", appsNeedingAuth: [] };
    }
    if (method === "config/mcpServer/reload") {
      return undefined;
    }
    if (method === "mcpServerStatus/list") {
      return {
        data: installed
          ? [
              {
                name: "computer-use",
                tools: {
                  list_apps: {
                    name: "list_apps",
                    inputSchema: { type: "object" },
                  },
                },
                resources: [],
                resourceTemplates: [],
                authStatus: "unsupported",
              },
            ]
          : [],
        nextCursor: null,
      };
    }
    throw new Error(`unexpected request ${method}`);
  }) as CodexComputerUseRequest;
}

function createBundledMarketplaceComputerUseRequest(
  bundledMarketplacePath: string,
): CodexComputerUseRequest {
  let registered = false;
  let installed = false;
  return vi.fn(async (method: string, requestParams?: unknown) => {
    if (method === "experimentalFeature/enablement/set") {
      return { enablement: { plugins: true } };
    }
    if (method === "marketplace/add") {
      expect(requestParams).toEqual({
        source: bundledMarketplacePath,
      });
      registered = true;
      return {
        marketplaceName: "openai-bundled",
        installedRoot: bundledMarketplacePath,
        alreadyAdded: false,
      };
    }
    if (method === "plugin/list") {
      return {
        marketplaces: registered
          ? [
              {
                name: "openai-bundled",
                path: `${bundledMarketplacePath}/.agents/plugins/marketplace.json`,
                interface: null,
                plugins: [pluginSummary(installed, "openai-bundled")],
              },
            ]
          : [],
        marketplaceLoadErrors: [],
        featuredPluginIds: [],
      };
    }
    if (method === "plugin/read") {
      return {
        plugin: {
          marketplaceName: "openai-bundled",
          marketplacePath: `${bundledMarketplacePath}/.agents/plugins/marketplace.json`,
          summary: pluginSummary(installed, "openai-bundled"),
          description: "Control desktop apps.",
          skills: [],
          apps: [],
          mcpServers: ["computer-use"],
        },
      };
    }
    if (method === "plugin/install") {
      installed = true;
      return { authPolicy: "ON_INSTALL", appsNeedingAuth: [] };
    }
    if (method === "config/mcpServer/reload") {
      return undefined;
    }
    if (method === "mcpServerStatus/list") {
      return {
        data: installed
          ? [
              {
                name: "computer-use",
                tools: {
                  list_apps: {
                    name: "list_apps",
                    inputSchema: { type: "object" },
                  },
                },
                resources: [],
                resourceTemplates: [],
                authStatus: "unsupported",
              },
            ]
          : [],
        nextCursor: null,
      };
    }
    throw new Error(`unexpected request ${method}`);
  }) as CodexComputerUseRequest;
}

function marketplaceEntry(marketplaceName: string, installed: boolean) {
  return {
    name: marketplaceName,
    path: `/marketplaces/${marketplaceName}/.agents/plugins/marketplace.json`,
    interface: null,
    plugins: [pluginSummary(installed, marketplaceName)],
  };
}

function pluginSummary(
  installed: boolean,
  marketplaceName = "desktop-tools",
  enabled = installed,
  source: "local" | "remote" = "local",
) {
  return {
    id: `computer-use@${marketplaceName}`,
    name: "computer-use",
    source:
      source === "local"
        ? { type: "local", path: `/marketplaces/${marketplaceName}/plugins/computer-use` }
        : { type: "remote" },
    installed,
    enabled,
    installPolicy: "AVAILABLE",
    authPolicy: "ON_INSTALL",
    interface: null,
  };
}
