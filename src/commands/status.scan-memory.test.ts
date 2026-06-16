// Status memory scan tests cover memory-search manager status and shared-memory snapshot reporting.
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolveMemorySearchConfig: vi.fn(),
  getMemorySearchManager: vi.fn(),
  resolveSharedMemoryStatusSnapshot: vi.fn(),
  callGateway: vi.fn(),
}));

vi.mock("../agents/memory-search.js", () => ({
  resolveMemorySearchConfig: mocks.resolveMemorySearchConfig,
}));

vi.mock("./status.scan.deps.runtime.js", () => ({
  getMemorySearchManager: mocks.getMemorySearchManager,
}));

vi.mock("./status.scan.shared.js", () => ({
  resolveSharedMemoryStatusSnapshot: mocks.resolveSharedMemoryStatusSnapshot,
}));

vi.mock("../gateway/call.js", () => ({
  callGateway: mocks.callGateway,
}));

function createMainAgentStatus() {
  return {
    defaultId: "main",
    totalSessions: 0,
    bootstrapPendingCount: 0,
    agents: [
      {
        id: "main",
        workspaceDir: null,
        bootstrapPending: false,
        sessionsPath: "/tmp/main.json",
        sessionsCount: 0,
        lastUpdatedAt: null,
        lastActiveAgeMs: null,
      },
    ],
  };
}

describe("status.scan-memory", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveSharedMemoryStatusSnapshot.mockResolvedValue({ agentId: "main" });
    mocks.callGateway.mockResolvedValue({
      agentId: "main",
      provider: "qdrant",
      runtime: {
        ok: true,
        backend: "qmd",
        provider: "qdrant",
      },
      embedding: {
        ok: false,
        checked: false,
      },
    });
  });

  it("forwards the shared memory snapshot dependencies", async () => {
    const { resolveStatusMemoryStatusSnapshot } = await import("./status.scan-memory.ts");

    const requireDefaultStore = vi.fn((agentId: string) => `/tmp/${agentId}.sqlite`);
    const agentStatus = createMainAgentStatus();
    await resolveStatusMemoryStatusSnapshot({
      cfg: { agents: {} },
      agentStatus,
      memoryPlugin: { enabled: true, slot: "memory-core" },
      requireDefaultStore,
    });

    expect(mocks.resolveSharedMemoryStatusSnapshot).toHaveBeenCalledWith({
      cfg: { agents: {} },
      agentStatus,
      memoryPlugin: { enabled: true, slot: "memory-core" },
      resolveMemoryConfig: mocks.resolveMemorySearchConfig,
      getMemorySearchManager: mocks.getMemorySearchManager,
      requireDefaultStore,
    });
    expect(mocks.callGateway).not.toHaveBeenCalled();
  });

  it("uses live gateway runtime status when local memory is unavailable", async () => {
    const { resolveStatusMemoryStatusSnapshot } = await import("./status.scan-memory.ts");

    mocks.resolveSharedMemoryStatusSnapshot.mockResolvedValue(null);
    const agentStatus = createMainAgentStatus();

    await expect(
      resolveStatusMemoryStatusSnapshot({
        cfg: { agents: {} },
        agentStatus,
        memoryPlugin: { enabled: true, slot: "memory-qdrant" },
        gatewayReachable: true,
      }),
    ).resolves.toEqual({
      agentId: "main",
      ok: true,
      backend: "qmd",
      provider: "qdrant",
    });

    expect(mocks.callGateway).toHaveBeenCalledWith({
      config: { agents: {} },
      method: "doctor.memory.status",
      params: { agentId: "main", probe: false },
      timeoutMs: 2500,
    });
  });

  it("can skip local materialization and trust live gateway memory evidence", async () => {
    const { resolveStatusMemoryStatusSnapshot } = await import("./status.scan-memory.ts");

    const agentStatus = createMainAgentStatus();
    await expect(
      resolveStatusMemoryStatusSnapshot({
        cfg: { agents: {} },
        agentStatus,
        memoryPlugin: { enabled: true, slot: "memory-qdrant" },
        includeLocal: false,
        gatewayReachable: true,
      }),
    ).resolves.toMatchObject({
      backend: "qmd",
      provider: "qdrant",
    });

    expect(mocks.resolveSharedMemoryStatusSnapshot).not.toHaveBeenCalled();
  });
});
