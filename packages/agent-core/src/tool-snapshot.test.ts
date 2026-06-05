import { Type } from "typebox";
import { afterEach, describe, expect, it, vi } from "vitest";
import { snapshotAgentTools } from "./tool-snapshot.js";
import type { AgentTool } from "./types.js";

afterEach(() => {
  vi.restoreAllMocks();
});

function createTool(name: string): AgentTool {
  return {
    name,
    label: name,
    description: `${name} tool`,
    parameters: Type.Object({ query: Type.String() }),
    execute: async () => ({
      content: [{ type: "text", text: "done" }],
      details: {},
    }),
  };
}

describe("snapshotAgentTools", () => {
  it("quarantines hostile non-Error tool snapshot failures", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const hostileError = {
      toString() {
        throw new Error("stringification denied");
      },
    };
    const badTool = createTool("bad_lookup");
    Object.defineProperty(badTool, "parameters", {
      get() {
        // oxlint-disable-next-line typescript/only-throw-error -- Regression covers hostile non-Error values from untrusted tool accessors.
        throw hostileError;
      },
    });

    const snapshots = snapshotAgentTools([badTool, createTool("healthy_lookup")], {
      logContext: "agent state",
    });

    expect(snapshots.map((tool) => tool.name)).toEqual(["healthy_lookup"]);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining(
        'skipped invalid agent state tool "bad_lookup": Unknown agent failure',
      ),
    );
  });
});
