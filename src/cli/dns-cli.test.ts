import { describe, expect, it, vi } from "vitest";

import { defaultRuntime } from "../runtime.js";

const { buildProgram } = await import("./program.js");

describe("dns cli", () => {
  it("prints setup info (no apply)", async () => {
    const log = vi.spyOn(defaultRuntime, "log").mockImplementation(() => {});
    const program = buildProgram();
    await program.parseAsync(["dns", "setup"], { from: "user" });
    const output = log.mock.calls.map((args) => args.join(" ")).join("\n");
    expect(output).toContain("clawdbot.internal");
  });
});
