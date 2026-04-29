import { Command } from "commander";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  callGateway: vi.fn(async (opts: unknown) => opts),
}));

vi.mock("../gateway/call.js", () => ({
  callGateway: mocks.callGateway,
}));

vi.mock("./progress.js", () => ({
  withProgress: async (_opts: unknown, run: () => Promise<unknown>) => await run(),
}));

const { addGatewayClientOptions, parseGatewayTimeoutMsOption } = await import("./gateway-rpc.js");
const { callGatewayFromCliRuntime } = await import("./gateway-rpc.runtime.js");

function buildCommand(action = vi.fn()) {
  const command = new Command();
  command.exitOverride();
  command.configureOutput({ writeErr: () => {} });
  addGatewayClientOptions(command).action(action);
  return { action, command };
}

describe("gateway RPC timeout option", () => {
  beforeEach(() => {
    mocks.callGateway.mockClear();
  });

  it("parses valid --timeout values before command actions run", async () => {
    const { action, command } = buildCommand();

    await command.parseAsync(["--timeout", "2500"], { from: "user" });

    expect(action.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        timeout: 2500,
      }),
    );
  });

  it.each(["0", "-1", "1.5", "10ms", "nope"])(
    "rejects invalid --timeout value %s before command actions run",
    async (value) => {
      const { action, command } = buildCommand();

      await expect(
        command.parseAsync(["--timeout", value], { from: "user" }),
      ).rejects.toMatchObject({
        code: "commander.invalidArgument",
      });
      expect(action).not.toHaveBeenCalled();
    },
  );

  it("parses gateway runtime timeout values", async () => {
    await callGatewayFromCliRuntime("status", { timeout: "2500" });

    expect(mocks.callGateway).toHaveBeenCalledWith(
      expect.objectContaining({
        timeoutMs: 2500,
      }),
    );
  });

  it("rejects invalid runtime timeout values before opening a gateway call", async () => {
    await expect(callGatewayFromCliRuntime("status", { timeout: "10ms" })).rejects.toThrow(
      "--timeout must be a positive integer (milliseconds)",
    );
    expect(mocks.callGateway).not.toHaveBeenCalled();
  });

  it("uses the same strict positive-integer parser for direct option parsing", () => {
    expect(parseGatewayTimeoutMsOption(" 3000 ")).toBe(3000);
    expect(() => parseGatewayTimeoutMsOption("3000ms")).toThrow(
      "--timeout must be a positive integer (milliseconds)",
    );
  });
});
