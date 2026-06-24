// Verifies runtime plugin loading scope, disablement, and gateway-bindable mode.
import { beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({
  getCurrentPluginMetadataSnapshot: vi.fn(),
  ensureStandaloneRuntimePluginRegistryLoaded: vi.fn(),
  getLoadedRuntimePluginRegistry: vi.fn(),
  getActivePluginRuntimeSubagentMode: vi.fn<() => "default" | "explicit" | "gateway-bindable">(
    () => "default",
  ),
  getActivePluginRegistryWorkspaceDir: vi.fn<() => string | undefined>(() => undefined),
}));

vi.mock("../plugins/current-plugin-metadata-snapshot.js", () => ({
  getCurrentPluginMetadataSnapshot: hoisted.getCurrentPluginMetadataSnapshot,
}));

vi.mock("../plugins/runtime/standalone-runtime-registry-loader.js", () => ({
  ensureStandaloneRuntimePluginRegistryLoaded: hoisted.ensureStandaloneRuntimePluginRegistryLoaded,
}));

vi.mock("../plugins/active-runtime-registry.js", () => ({
  getLoadedRuntimePluginRegistry: hoisted.getLoadedRuntimePluginRegistry,
}));

vi.mock("../plugins/runtime.js", () => ({
  getActivePluginRuntimeSubagentMode: hoisted.getActivePluginRuntimeSubagentMode,
  getActivePluginRegistryWorkspaceDir: hoisted.getActivePluginRegistryWorkspaceDir,
}));

describe("ensureRuntimePluginsLoaded", () => {
  let ensureRuntimePluginsLoaded: typeof import("./runtime-plugins.js").ensureRuntimePluginsLoaded;

  beforeEach(async () => {
    // Reset modules so each case sees fresh mocked runtime-plugin dependencies.
    hoisted.getCurrentPluginMetadataSnapshot.mockReset();
    hoisted.getCurrentPluginMetadataSnapshot.mockReturnValue(undefined);
    hoisted.ensureStandaloneRuntimePluginRegistryLoaded.mockReset();
    hoisted.ensureStandaloneRuntimePluginRegistryLoaded.mockReturnValue(undefined);
    hoisted.getLoadedRuntimePluginRegistry.mockReset();
    hoisted.getLoadedRuntimePluginRegistry.mockReturnValue(undefined);
    hoisted.getActivePluginRuntimeSubagentMode.mockReset();
    hoisted.getActivePluginRuntimeSubagentMode.mockReturnValue("default");
    hoisted.getActivePluginRegistryWorkspaceDir.mockReset();
    hoisted.getActivePluginRegistryWorkspaceDir.mockReturnValue(undefined);
    vi.resetModules();
    ({ ensureRuntimePluginsLoaded } = await import("./runtime-plugins.js"));
  });

  it("does not reactivate plugins when a process already has an active registry", () => {
    hoisted.ensureStandaloneRuntimePluginRegistryLoaded.mockReturnValue({});

    ensureRuntimePluginsLoaded({
      config: {} as never,
      workspaceDir: "/tmp/workspace",
      allowGatewaySubagentBinding: true,
    });

    expect(hoisted.ensureStandaloneRuntimePluginRegistryLoaded).toHaveBeenCalledTimes(1);
  });

  it("resolves runtime plugins through the shared runtime helper", () => {
    ensureRuntimePluginsLoaded({
      config: {} as never,
      workspaceDir: "/tmp/workspace",
      allowGatewaySubagentBinding: true,
    });

    expect(hoisted.ensureStandaloneRuntimePluginRegistryLoaded).toHaveBeenCalledWith({
      requiredPluginIds: undefined,
      loadOptions: {
        config: {} as never,
        workspaceDir: "/tmp/workspace",
        runtimeOptions: {
          allowGatewaySubagentBinding: true,
        },
      },
    });
  });

  it("does not load runtime plugins when plugins are globally disabled", () => {
    ensureRuntimePluginsLoaded({
      config: {
        plugins: {
          enabled: false,
        },
      } as never,
      workspaceDir: "/tmp/workspace",
      allowGatewaySubagentBinding: true,
    });

    expect(hoisted.getCurrentPluginMetadataSnapshot).not.toHaveBeenCalled();
    expect(hoisted.ensureStandaloneRuntimePluginRegistryLoaded).not.toHaveBeenCalled();
  });

  it("scopes runtime plugin loading to the current gateway startup plan", () => {
    // Startup metadata narrows runtime loading to plugins already planned for gateway startup.
    const config = {} as never;
    hoisted.getCurrentPluginMetadataSnapshot.mockReturnValue({
      startup: {
        pluginIds: ["telegram", "memory-core"],
      },
    });

    ensureRuntimePluginsLoaded({
      config,
      workspaceDir: "/tmp/workspace",
      allowGatewaySubagentBinding: true,
    });

    expect(hoisted.getCurrentPluginMetadataSnapshot).toHaveBeenCalledWith({
      config,
      workspaceDir: "/tmp/workspace",
    });
    expect(hoisted.ensureStandaloneRuntimePluginRegistryLoaded).toHaveBeenCalledWith({
      requiredPluginIds: ["telegram", "memory-core"],
      loadOptions: {
        config,
        workspaceDir: "/tmp/workspace",
        onlyPluginIds: ["telegram", "memory-core"],
        forceFullRuntimeForChannelPlugins: true,
        runtimeOptions: {
          allowGatewaySubagentBinding: true,
        },
      },
    });
  });

  it("delegates startup-scope registry reuse to loader cache compatibility", () => {
    hoisted.getCurrentPluginMetadataSnapshot.mockReturnValue({
      startup: {
        pluginIds: ["telegram"],
      },
    });
    hoisted.getActivePluginRuntimeSubagentMode.mockReturnValue("gateway-bindable");

    ensureRuntimePluginsLoaded({
      config: {} as never,
      workspaceDir: "/tmp/workspace",
      allowGatewaySubagentBinding: true,
    });

    expect(hoisted.ensureStandaloneRuntimePluginRegistryLoaded).toHaveBeenCalledWith({
      requiredPluginIds: ["telegram"],
      loadOptions: {
        config: {} as never,
        onlyPluginIds: ["telegram"],
        workspaceDir: "/tmp/workspace",
        forceFullRuntimeForChannelPlugins: true,
        runtimeOptions: {
          allowGatewaySubagentBinding: true,
        },
      },
    });
  });

  it("reuses the active startup registry workspace only on a compatible cache hit", () => {
    hoisted.getCurrentPluginMetadataSnapshot.mockReturnValue({
      startup: {
        pluginIds: ["telegram"],
      },
    });
    hoisted.getActivePluginRuntimeSubagentMode.mockReturnValue("gateway-bindable");
    hoisted.getActivePluginRegistryWorkspaceDir.mockReturnValue("/tmp/gateway-workspace");
    hoisted.getLoadedRuntimePluginRegistry.mockReturnValue({});

    ensureRuntimePluginsLoaded({
      config: {} as never,
      workspaceDir: "/tmp/agent-workspace",
      allowGatewaySubagentBinding: true,
    });

    expect(hoisted.getCurrentPluginMetadataSnapshot).toHaveBeenCalledWith({
      config: {} as never,
      workspaceDir: "/tmp/agent-workspace",
    });
    expect(hoisted.getLoadedRuntimePluginRegistry).toHaveBeenCalledWith({
      requiredPluginIds: ["telegram"],
      workspaceDir: "/tmp/gateway-workspace",
      loadOptions: {
        config: {} as never,
        onlyPluginIds: ["telegram"],
        workspaceDir: "/tmp/gateway-workspace",
        forceFullRuntimeForChannelPlugins: true,
        runtimeOptions: {
          allowGatewaySubagentBinding: true,
        },
      },
    });
    expect(hoisted.ensureStandaloneRuntimePluginRegistryLoaded).not.toHaveBeenCalled();
  });

  it("loads from the requested workspace when active startup registry reuse misses", () => {
    hoisted.getCurrentPluginMetadataSnapshot.mockReturnValue({
      startup: {
        pluginIds: ["telegram"],
      },
    });
    hoisted.getActivePluginRuntimeSubagentMode.mockReturnValue("gateway-bindable");
    hoisted.getActivePluginRegistryWorkspaceDir.mockReturnValue("/tmp/gateway-workspace");

    ensureRuntimePluginsLoaded({
      config: {} as never,
      workspaceDir: "/tmp/agent-workspace",
      allowGatewaySubagentBinding: true,
    });

    expect(hoisted.getLoadedRuntimePluginRegistry).toHaveBeenCalledWith({
      requiredPluginIds: ["telegram"],
      workspaceDir: "/tmp/gateway-workspace",
      loadOptions: {
        config: {} as never,
        onlyPluginIds: ["telegram"],
        workspaceDir: "/tmp/gateway-workspace",
        forceFullRuntimeForChannelPlugins: true,
        runtimeOptions: {
          allowGatewaySubagentBinding: true,
        },
      },
    });
    expect(hoisted.ensureStandaloneRuntimePluginRegistryLoaded).toHaveBeenCalledWith({
      requiredPluginIds: ["telegram"],
      loadOptions: {
        config: {} as never,
        onlyPluginIds: ["telegram"],
        workspaceDir: "/tmp/agent-workspace",
        forceFullRuntimeForChannelPlugins: true,
        runtimeOptions: {
          allowGatewaySubagentBinding: true,
        },
      },
    });
  });

  it("lets the loader decide when startup ids match but config changes", () => {
    const config = {
      plugins: {
        config: {
          telegram: {
            replyMode: "changed",
          },
        },
      },
    } as never;
    hoisted.getCurrentPluginMetadataSnapshot.mockReturnValue({
      startup: {
        pluginIds: ["telegram"],
      },
    });
    hoisted.getActivePluginRuntimeSubagentMode.mockReturnValue("gateway-bindable");

    ensureRuntimePluginsLoaded({
      config,
      workspaceDir: "/tmp/workspace",
      allowGatewaySubagentBinding: true,
    });

    expect(hoisted.ensureStandaloneRuntimePluginRegistryLoaded).toHaveBeenCalledWith({
      requiredPluginIds: ["telegram"],
      loadOptions: {
        config,
        onlyPluginIds: ["telegram"],
        workspaceDir: "/tmp/workspace",
        forceFullRuntimeForChannelPlugins: true,
        runtimeOptions: {
          allowGatewaySubagentBinding: true,
        },
      },
    });
  });

  it("does not enable gateway subagent binding for normal runtime loads", () => {
    ensureRuntimePluginsLoaded({
      config: {} as never,
      workspaceDir: "/tmp/workspace",
    });

    expect(hoisted.ensureStandaloneRuntimePluginRegistryLoaded).toHaveBeenCalledWith({
      requiredPluginIds: undefined,
      loadOptions: {
        config: {} as never,
        workspaceDir: "/tmp/workspace",
        runtimeOptions: undefined,
      },
    });
  });

  it("inherits gateway-bindable mode from an active gateway registry", () => {
    hoisted.getActivePluginRuntimeSubagentMode.mockReturnValue("gateway-bindable");

    ensureRuntimePluginsLoaded({
      config: {} as never,
      workspaceDir: "/tmp/workspace",
    });

    expect(hoisted.ensureStandaloneRuntimePluginRegistryLoaded).toHaveBeenCalledWith({
      requiredPluginIds: undefined,
      loadOptions: {
        config: {} as never,
        workspaceDir: "/tmp/workspace",
        runtimeOptions: {
          allowGatewaySubagentBinding: true,
        },
      },
    });
  });
});
