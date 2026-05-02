import { beforeEach, describe, expect, it, vi } from "vitest";
import { ErrorCodes } from "../protocol/index.js";
import { toolsCatalogHandlers } from "./tools-catalog.js";

vi.mock("../../config/config.js", () => ({
  getRuntimeConfig: vi.fn(() => ({})),
}));

vi.mock("../../agents/agent-scope.js", () => ({
  listAgentIds: vi.fn(() => ["main"]),
  resolveDefaultAgentId: vi.fn(() => "main"),
  resolveAgentWorkspaceDir: vi.fn(() => "/tmp/workspace-main"),
}));

const loadManifestContractSnapshotMock = vi.fn((_params: unknown) => ({
  index: {},
  plugins: [
    {
      id: "voice-call",
      origin: "bundled",
      enabledByDefault: true,
      contracts: { tools: ["voice_call"] },
    },
    {
      id: "matrix",
      origin: "bundled",
      enabledByDefault: true,
      contracts: { tools: ["matrix_room"] },
    },
  ],
}));
const isManifestPluginAvailableForControlPlaneMock = vi.fn((_params: unknown) => true);
const hasManifestToolAvailabilityMock = vi.fn((_params: unknown) => true);

vi.mock("../../plugins/manifest-contract-eligibility.js", () => ({
  loadManifestContractSnapshot: (params: unknown) => loadManifestContractSnapshotMock(params),
  isManifestPluginAvailableForControlPlane: (params: unknown) =>
    isManifestPluginAvailableForControlPlaneMock(params),
}));

vi.mock("../../plugins/manifest-tool-availability.js", () => ({
  hasManifestToolAvailability: (params: unknown) => hasManifestToolAvailabilityMock(params),
}));

vi.mock("../../plugins/runtime.js", () => ({
  getActivePluginRegistry: vi.fn(() => ({
    tools: [
      {
        pluginId: "voice-call",
        names: ["voice_call"],
        optional: true,
      },
      {
        pluginId: "matrix",
        names: ["matrix_room"],
        optional: false,
      },
    ],
    toolMetadata: [
      {
        pluginId: "voice-call",
        metadata: {
          toolName: "voice_call",
          displayName: "Voice call",
          description: "Plugin calling tool",
          risk: "medium",
          tags: ["voice"],
        },
      },
      {
        pluginId: "matrix",
        metadata: {
          toolName: "matrix_room",
          description: "Summarized Matrix room helper.",
        },
      },
    ],
  })),
}));

type RespondCall = [boolean, unknown?, { code: number; message: string }?];

function createInvokeParams(params: Record<string, unknown>, cfg: Record<string, unknown> = {}) {
  const respond = vi.fn();
  return {
    respond,
    invoke: async () =>
      await toolsCatalogHandlers["tools.catalog"]({
        params,
        respond: respond as never,
        context: { getRuntimeConfig: () => cfg } as never,
        client: null,
        req: { type: "req", id: "req-1", method: "tools.catalog" },
        isWebchatConnect: () => false,
      }),
  };
}

describe("tools.catalog handler", () => {
  beforeEach(() => {
    loadManifestContractSnapshotMock.mockClear();
    isManifestPluginAvailableForControlPlaneMock.mockClear();
    hasManifestToolAvailabilityMock.mockClear();
  });

  it("rejects invalid params", async () => {
    const { respond, invoke } = createInvokeParams({ extra: true });
    await invoke();
    const call = respond.mock.calls[0] as RespondCall | undefined;
    expect(call?.[0]).toBe(false);
    expect(call?.[2]?.code).toBe(ErrorCodes.INVALID_REQUEST);
    expect(call?.[2]?.message).toContain("invalid tools.catalog params");
  });

  it("rejects unknown agent ids", async () => {
    const { respond, invoke } = createInvokeParams({ agentId: "unknown-agent" });
    await invoke();
    const call = respond.mock.calls[0] as RespondCall | undefined;
    expect(call?.[0]).toBe(false);
    expect(call?.[2]?.code).toBe(ErrorCodes.INVALID_REQUEST);
    expect(call?.[2]?.message).toContain("unknown agent id");
  });

  it("returns core groups including tts and excludes plugins when includePlugins=false", async () => {
    const { respond, invoke } = createInvokeParams({ includePlugins: false });
    await invoke();
    const call = respond.mock.calls[0] as RespondCall | undefined;
    expect(call?.[0]).toBe(true);
    const payload = call?.[1] as
      | {
          agentId: string;
          groups: Array<{
            id: string;
            source: "core" | "plugin";
            tools: Array<{ id: string; source: "core" | "plugin" }>;
          }>;
        }
      | undefined;
    expect(payload?.agentId).toBe("main");
    expect(payload?.groups.some((group) => group.source === "plugin")).toBe(false);
    const media = payload?.groups.find((group) => group.id === "media");
    expect(media?.tools.some((tool) => tool.id === "tts" && tool.source === "core")).toBe(true);
  });

  it("excludes manifest plugin tools when plugins are globally disabled", async () => {
    const { respond, invoke } = createInvokeParams(
      {},
      {
        plugins: {
          enabled: false,
        },
      },
    );

    await invoke();

    const call = respond.mock.calls[0] as RespondCall | undefined;
    expect(call?.[0]).toBe(true);
    const payload = call?.[1] as
      | {
          groups: Array<{
            source: "core" | "plugin";
          }>;
        }
      | undefined;
    expect(payload?.groups.some((group) => group.source === "plugin")).toBe(false);
    expect(loadManifestContractSnapshotMock).not.toHaveBeenCalled();
  });

  it("includes manifest plugin groups with plugin metadata", async () => {
    const { respond, invoke } = createInvokeParams({});
    await invoke();
    const call = respond.mock.calls[0] as RespondCall | undefined;
    expect(call?.[0]).toBe(true);
    const payload = call?.[1] as
      | {
          groups: Array<{
            source: "core" | "plugin";
            pluginId?: string;
            tools: Array<{
              id: string;
              source: "core" | "plugin";
              pluginId?: string;
              label?: string;
              optional?: boolean;
              risk?: string;
              tags?: string[];
            }>;
          }>;
        }
      | undefined;
    const pluginGroups = (payload?.groups ?? []).filter((group) => group.source === "plugin");
    expect(pluginGroups.length).toBeGreaterThan(0);
    const voiceCall = pluginGroups
      .flatMap((group) => group.tools)
      .find((tool) => tool.id === "voice_call");
    expect(voiceCall).toMatchObject({
      source: "plugin",
      pluginId: "voice-call",
      label: "Voice call",
      optional: true,
      risk: "medium",
      tags: ["voice"],
    });
  });

  it("summarizes plugin tool descriptions the same way as the effective inventory", async () => {
    const { respond, invoke } = createInvokeParams({});
    await invoke();
    const call = respond.mock.calls[0] as RespondCall | undefined;
    expect(call?.[0]).toBe(true);
    const payload = call?.[1] as
      | {
          groups: Array<{
            source: "core" | "plugin";
            tools: Array<{
              id: string;
              description: string;
            }>;
          }>;
        }
      | undefined;
    const matrixRoom = (payload?.groups ?? [])
      .filter((group) => group.source === "plugin")
      .flatMap((group) => group.tools)
      .find((tool) => tool.id === "matrix_room");
    expect(matrixRoom?.description).toBe("Summarized Matrix room helper.");
  });

  it("builds the plugin catalog from manifests instead of materializing tools", async () => {
    const { invoke } = createInvokeParams({});

    await invoke();

    expect(loadManifestContractSnapshotMock).toHaveBeenCalledWith(
      expect.objectContaining({
        config: {},
        workspaceDir: "/tmp/workspace-main",
      }),
    );
    expect(hasManifestToolAvailabilityMock).toHaveBeenCalledWith(
      expect.objectContaining({
        toolNames: ["voice_call"],
      }),
    );
  });
});
