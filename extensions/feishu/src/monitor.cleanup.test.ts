import { afterEach, describe, expect, it, vi } from "vitest";
import { botNames, botOpenIds, stopFeishuMonitorState, wsClients } from "./monitor.state.js";
import type { ResolvedFeishuAccount } from "./types.js";

const createFeishuWSClientMock = vi.hoisted(() => vi.fn());

vi.mock("./client.js", () => ({
  createFeishuWSClient: createFeishuWSClientMock,
}));

import { monitorWebSocket } from "./monitor.transport.js";

type MockWsClient = {
  start: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  getReconnectInfo: ReturnType<typeof vi.fn>;
};

type MockWsLifecycleCallbacks = {
  onReady?: () => void;
  onReconnecting?: () => void;
  onReconnected?: () => void;
  onError?: (err: Error) => void;
};

function createAccount(accountId: string): ResolvedFeishuAccount {
  return {
    accountId,
    enabled: true,
    configured: true,
    appId: `cli_${accountId}`,
    appSecret: `secret_${accountId}`, // pragma: allowlist secret
    domain: "feishu",
    config: {
      enabled: true,
      connectionMode: "websocket",
    },
  } as ResolvedFeishuAccount;
}

function createWsClient(): MockWsClient {
  return {
    start: vi.fn(),
    close: vi.fn(),
    getReconnectInfo: vi.fn(() => ({ lastConnectTime: 0, nextConnectTime: 0 })),
  };
}

function getCreateWsClientCallbacks(callIndex: number): MockWsLifecycleCallbacks {
  return (createFeishuWSClientMock.mock.calls[callIndex]?.[1] ?? {}) as MockWsLifecycleCallbacks;
}

afterEach(() => {
  vi.useRealTimers();
  stopFeishuMonitorState();
  vi.clearAllMocks();
});

describe("feishu websocket cleanup", () => {
  it("closes the websocket client when the monitor aborts", async () => {
    const wsClient = createWsClient();
    createFeishuWSClientMock.mockReturnValue(wsClient);

    const abortController = new AbortController();
    const accountId = "alpha";

    botOpenIds.set(accountId, "ou_alpha");
    botNames.set(accountId, "Alpha");

    const monitorPromise = monitorWebSocket({
      account: createAccount(accountId),
      accountId,
      runtime: {
        log: vi.fn(),
        error: vi.fn(),
        exit: vi.fn(),
      },
      abortSignal: abortController.signal,
      eventDispatcher: {} as never,
    });

    await vi.waitFor(() => {
      expect(wsClient.start).toHaveBeenCalledTimes(1);
      expect(wsClients.get(accountId)).toBe(wsClient);
    });

    abortController.abort();
    await monitorPromise;

    expect(wsClient.close).toHaveBeenCalledTimes(1);
    expect(wsClients.has(accountId)).toBe(false);
    expect(botOpenIds.has(accountId)).toBe(false);
    expect(botNames.has(accountId)).toBe(false);
  });

  it("retries with backoff after websocket start rejects", async () => {
    vi.useFakeTimers();
    const failedClient = createWsClient();
    failedClient.start.mockRejectedValueOnce(
      new Error("connect failed\nAuthorization: Bearer token_abc appSecret=secret_abc"),
    );
    const recoveredClient = createWsClient();
    createFeishuWSClientMock
      .mockResolvedValueOnce(failedClient)
      .mockResolvedValueOnce(recoveredClient);

    const abortController = new AbortController();
    const runtime = {
      log: vi.fn(),
      error: vi.fn(),
      exit: vi.fn(),
    };
    const accountId = "retry";

    const monitorPromise = monitorWebSocket({
      account: createAccount(accountId),
      accountId,
      runtime,
      abortSignal: abortController.signal,
      eventDispatcher: {} as never,
    });

    await vi.waitFor(() => {
      expect(failedClient.start).toHaveBeenCalledTimes(1);
      expect(failedClient.close).toHaveBeenCalledTimes(1);
      expect(wsClients.has(accountId)).toBe(false);
    });

    await vi.advanceTimersByTimeAsync(1_000);

    await vi.waitFor(() => {
      expect(recoveredClient.start).toHaveBeenCalledTimes(1);
      expect(wsClients.get(accountId)).toBe(recoveredClient);
    });

    abortController.abort();
    await monitorPromise;

    expect(createFeishuWSClientMock).toHaveBeenCalledTimes(2);
    expect(recoveredClient.close).toHaveBeenCalledTimes(1);
    expect(runtime.error).toHaveBeenCalledWith(
      expect.stringContaining("WebSocket start failed, retrying in 1000ms"),
    );
    const errorMessage = String(runtime.error.mock.calls[0]?.[0] ?? "");
    expect(errorMessage).not.toContain("\n");
    expect(errorMessage).not.toContain("token_abc");
    expect(errorMessage).not.toContain("secret_abc");
    expect(errorMessage).toContain("Authorization: Bearer [redacted]");
    expect(errorMessage).toContain("appSecret=[redacted]");
  });

  it("recreates the websocket client when SDK retry exhaustion fires after start", async () => {
    vi.useFakeTimers();
    const exhaustedClient = createWsClient();
    const recoveredClient = createWsClient();
    createFeishuWSClientMock
      .mockResolvedValueOnce(exhaustedClient)
      .mockResolvedValueOnce(recoveredClient);

    const abortController = new AbortController();
    const runtime = {
      log: vi.fn(),
      error: vi.fn(),
      exit: vi.fn(),
    };
    const accountId = "sdk-exhausted";

    const monitorPromise = monitorWebSocket({
      account: createAccount(accountId),
      accountId,
      runtime,
      abortSignal: abortController.signal,
      eventDispatcher: {} as never,
    });

    await vi.waitFor(() => {
      expect(exhaustedClient.start).toHaveBeenCalledTimes(1);
      expect(wsClients.get(accountId)).toBe(exhaustedClient);
    });

    botOpenIds.set(accountId, "ou_sdk_exhausted");
    botNames.set(accountId, "SDK Exhausted");
    getCreateWsClientCallbacks(0).onReady?.();
    getCreateWsClientCallbacks(0).onError?.(
      new Error("WebSocket reconnect exhausted after 30 attempts"),
    );

    await vi.waitFor(() => {
      expect(exhaustedClient.close).toHaveBeenCalledTimes(1);
      expect(wsClients.has(accountId)).toBe(false);
      expect(botOpenIds.get(accountId)).toBe("ou_sdk_exhausted");
      expect(botNames.get(accountId)).toBe("SDK Exhausted");
    });

    await vi.advanceTimersByTimeAsync(1_000);

    await vi.waitFor(() => {
      expect(recoveredClient.start).toHaveBeenCalledTimes(1);
      expect(wsClients.get(accountId)).toBe(recoveredClient);
    });

    abortController.abort();
    await monitorPromise;

    expect(createFeishuWSClientMock).toHaveBeenCalledTimes(2);
    expect(recoveredClient.close).toHaveBeenCalledTimes(1);
    expect(botOpenIds.has(accountId)).toBe(false);
    expect(botNames.has(accountId)).toBe(false);
    expect(runtime.error).toHaveBeenCalledWith(
      expect.stringContaining("WebSocket supervisor detected SDK retry exhaustion"),
    );
  });

  it("recreates the websocket client when reconnect state stops advancing", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    const stalledClient = createWsClient();
    stalledClient.getReconnectInfo.mockReturnValue({
      lastConnectTime: 900_000,
      nextConnectTime: 939_999,
    });
    const recoveredClient = createWsClient();
    createFeishuWSClientMock
      .mockResolvedValueOnce(stalledClient)
      .mockResolvedValueOnce(recoveredClient);

    const abortController = new AbortController();
    const runtime = {
      log: vi.fn(),
      error: vi.fn(),
      exit: vi.fn(),
    };
    const accountId = "stalled";

    const monitorPromise = monitorWebSocket({
      account: createAccount(accountId),
      accountId,
      runtime,
      abortSignal: abortController.signal,
      eventDispatcher: {} as never,
    });

    await vi.waitFor(() => {
      expect(stalledClient.start).toHaveBeenCalledTimes(1);
    });

    getCreateWsClientCallbacks(0).onReady?.();
    getCreateWsClientCallbacks(0).onReconnecting?.();
    await vi.advanceTimersByTimeAsync(5_000);

    await vi.waitFor(() => {
      expect(stalledClient.close).toHaveBeenCalledTimes(1);
    });

    await vi.advanceTimersByTimeAsync(1_000);

    await vi.waitFor(() => {
      expect(recoveredClient.start).toHaveBeenCalledTimes(1);
      expect(wsClients.get(accountId)).toBe(recoveredClient);
    });

    abortController.abort();
    await monitorPromise;

    expect(createFeishuWSClientMock).toHaveBeenCalledTimes(2);
    expect(recoveredClient.close).toHaveBeenCalledTimes(1);
    expect(runtime.error).toHaveBeenCalledWith(
      expect.stringContaining("WebSocket supervisor detected reconnect state stalled"),
    );
  });

  it("keeps a reconnected websocket client alive when stale reconnect info remains", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    const reconnectedClient = createWsClient();
    reconnectedClient.getReconnectInfo.mockReturnValue({
      lastConnectTime: 900_000,
      nextConnectTime: 939_999,
    });
    createFeishuWSClientMock.mockResolvedValueOnce(reconnectedClient);

    const abortController = new AbortController();
    const runtime = {
      log: vi.fn(),
      error: vi.fn(),
      exit: vi.fn(),
    };
    const accountId = "reconnected";

    const monitorPromise = monitorWebSocket({
      account: createAccount(accountId),
      accountId,
      runtime,
      abortSignal: abortController.signal,
      eventDispatcher: {} as never,
    });

    await vi.waitFor(() => {
      expect(reconnectedClient.start).toHaveBeenCalledTimes(1);
      expect(wsClients.get(accountId)).toBe(reconnectedClient);
    });

    getCreateWsClientCallbacks(0).onReady?.();
    getCreateWsClientCallbacks(0).onReconnecting?.();
    getCreateWsClientCallbacks(0).onReconnected?.();
    await vi.advanceTimersByTimeAsync(65_000);

    expect(createFeishuWSClientMock).toHaveBeenCalledTimes(1);
    expect(reconnectedClient.close).not.toHaveBeenCalled();
    expect(wsClients.get(accountId)).toBe(reconnectedClient);

    abortController.abort();
    await monitorPromise;

    expect(reconnectedClient.close).toHaveBeenCalledTimes(1);
    expect(runtime.error).not.toHaveBeenCalledWith(
      expect.stringContaining("WebSocket supervisor detected reconnect state stalled"),
    );
  });

  it("redacts websocket close errors during abort cleanup", async () => {
    const wsClient = createWsClient();
    wsClient.close.mockImplementationOnce(() => {
      throw new Error("close failed\naccess_token=secret_token");
    });
    createFeishuWSClientMock.mockReturnValue(wsClient);

    const abortController = new AbortController();
    const runtime = {
      log: vi.fn(),
      error: vi.fn(),
      exit: vi.fn(),
    };

    const monitorPromise = monitorWebSocket({
      account: createAccount("close-error"),
      accountId: "close-error",
      runtime,
      abortSignal: abortController.signal,
      eventDispatcher: {} as never,
    });

    await vi.waitFor(() => {
      expect(wsClient.start).toHaveBeenCalledTimes(1);
    });

    abortController.abort();
    await monitorPromise;

    const errorMessage = String(runtime.error.mock.calls[0]?.[0] ?? "");
    expect(errorMessage).toContain("error closing WebSocket client");
    expect(errorMessage).toContain("access_token=[redacted]");
    expect(errorMessage).not.toContain("\n");
    expect(errorMessage).not.toContain("secret_token");
  });

  it("closes targeted websocket clients during stop cleanup", () => {
    const alphaClient = createWsClient();
    const betaClient = createWsClient();

    wsClients.set("alpha", alphaClient as never);
    wsClients.set("beta", betaClient as never);
    botOpenIds.set("alpha", "ou_alpha");
    botOpenIds.set("beta", "ou_beta");
    botNames.set("alpha", "Alpha");
    botNames.set("beta", "Beta");

    stopFeishuMonitorState("alpha");

    expect(alphaClient.close).toHaveBeenCalledTimes(1);
    expect(betaClient.close).not.toHaveBeenCalled();
    expect(wsClients.has("alpha")).toBe(false);
    expect(wsClients.has("beta")).toBe(true);
    expect(botOpenIds.has("alpha")).toBe(false);
    expect(botOpenIds.has("beta")).toBe(true);
    expect(botNames.has("alpha")).toBe(false);
    expect(botNames.has("beta")).toBe(true);
  });

  it("closes all websocket clients during global stop cleanup", () => {
    const alphaClient = createWsClient();
    const betaClient = createWsClient();

    wsClients.set("alpha", alphaClient as never);
    wsClients.set("beta", betaClient as never);
    botOpenIds.set("alpha", "ou_alpha");
    botOpenIds.set("beta", "ou_beta");
    botNames.set("alpha", "Alpha");
    botNames.set("beta", "Beta");

    stopFeishuMonitorState();

    expect(alphaClient.close).toHaveBeenCalledTimes(1);
    expect(betaClient.close).toHaveBeenCalledTimes(1);
    expect(wsClients.size).toBe(0);
    expect(botOpenIds.size).toBe(0);
    expect(botNames.size).toBe(0);
  });
});
