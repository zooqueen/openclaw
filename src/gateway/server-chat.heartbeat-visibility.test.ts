import { describe, expect, it, vi } from "vitest";

describe("agent event handler (webchat heartbeat visibility)", () => {
  it("suppresses HEARTBEAT_OK-only broadcasts to webchat when showOk is false (context on clientRunId)", async () => {
    vi.resetModules();
    vi.doMock("../config/config.js", () => {
      return {
        loadConfig: vi.fn(() => ({
          agents: {
            defaults: {
              heartbeat: {
                ackMaxChars: 30,
              },
            },
          },
          channels: {
            defaults: {
              heartbeat: {
                showOk: false,
                showAlerts: true,
                useIndicator: true,
              },
            },
          },
        })),
      };
    });

    const { registerAgentRunContext } = await import("../infra/agent-events.js");
    const { createAgentEventHandler, createChatRunState } = await import("./server-chat.js");

    const broadcast = vi.fn();
    const nodeSendToSession = vi.fn();
    const agentRunSeq = new Map<string, number>();
    const chatRunState = createChatRunState();
    chatRunState.registry.add("run-1", { sessionKey: "session-1", clientRunId: "client-1" });

    // server-chat uses clientRunId for the broadcast payload.
    registerAgentRunContext("client-1", { isHeartbeat: true });

    const handler = createAgentEventHandler({
      broadcast,
      nodeSendToSession,
      agentRunSeq,
      chatRunState,
      resolveSessionKeyForRun: () => undefined,
      clearAgentRunContext: vi.fn(),
    });

    handler({
      runId: "run-1",
      seq: 1,
      stream: "assistant",
      ts: Date.now(),
      data: { text: "HEARTBEAT_OK" },
    });

    const chatCalls = broadcast.mock.calls.filter(([event]) => event === "chat");
    expect(chatCalls).toHaveLength(0);

    const sessionChatCalls = nodeSendToSession.mock.calls.filter(([, event]) => event === "chat");
    expect(sessionChatCalls).toHaveLength(1);
  });

  it("suppresses when heartbeat context is only registered under agentRunId (clientRunId differs)", async () => {
    vi.resetModules();
    vi.doMock("../config/config.js", () => {
      return {
        loadConfig: vi.fn(() => ({
          agents: {
            defaults: {
              heartbeat: {
                ackMaxChars: 30,
              },
            },
          },
          channels: {
            defaults: {
              heartbeat: {
                showOk: false,
              },
            },
          },
        })),
      };
    });

    const { registerAgentRunContext } = await import("../infra/agent-events.js");
    const { createAgentEventHandler, createChatRunState } = await import("./server-chat.js");

    const broadcast = vi.fn();
    const nodeSendToSession = vi.fn();
    const agentRunSeq = new Map<string, number>();
    const chatRunState = createChatRunState();

    chatRunState.registry.add("run-1", { sessionKey: "session-1", clientRunId: "client-1" });

    // This matches how agent-runner registers context (runId), while webchat may use a separate clientRunId.
    registerAgentRunContext("run-1", { isHeartbeat: true });

    const handler = createAgentEventHandler({
      broadcast,
      nodeSendToSession,
      agentRunSeq,
      chatRunState,
      resolveSessionKeyForRun: () => undefined,
      clearAgentRunContext: vi.fn(),
    });

    handler({
      runId: "run-1",
      seq: 1,
      stream: "assistant",
      ts: Date.now(),
      data: { text: "HEARTBEAT_OK" },
    });

    const chatCalls = broadcast.mock.calls.filter(([event]) => event === "chat");
    expect(chatCalls).toHaveLength(0);
  });

  it("still broadcasts non-HEARTBEAT_OK heartbeat alerts to webchat when showOk is false", async () => {
    vi.resetModules();
    vi.doMock("../config/config.js", () => {
      return {
        loadConfig: vi.fn(() => ({
          agents: {
            defaults: {
              heartbeat: {
                ackMaxChars: 30,
              },
            },
          },
          channels: {
            defaults: {
              heartbeat: {
                showOk: false,
                showAlerts: true,
                useIndicator: true,
              },
            },
          },
        })),
      };
    });

    const { registerAgentRunContext } = await import("../infra/agent-events.js");
    const { createAgentEventHandler, createChatRunState } = await import("./server-chat.js");

    const broadcast = vi.fn();
    const nodeSendToSession = vi.fn();
    const agentRunSeq = new Map<string, number>();
    const chatRunState = createChatRunState();
    chatRunState.registry.add("run-1", { sessionKey: "session-1", clientRunId: "client-1" });

    registerAgentRunContext("client-1", { isHeartbeat: true });

    const handler = createAgentEventHandler({
      broadcast,
      nodeSendToSession,
      agentRunSeq,
      chatRunState,
      resolveSessionKeyForRun: () => undefined,
      clearAgentRunContext: vi.fn(),
    });

    handler({
      runId: "run-1",
      seq: 1,
      stream: "assistant",
      ts: Date.now(),
      data: { text: "ALERT: something happened" },
    });

    const chatCalls = broadcast.mock.calls.filter(([event]) => event === "chat");
    expect(chatCalls).toHaveLength(1);
  });
});
