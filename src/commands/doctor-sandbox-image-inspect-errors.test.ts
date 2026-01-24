import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ClawdbotConfig } from "../config/config.js";
import type { RuntimeEnv } from "../runtime.js";
import type { DoctorPrompter } from "./doctor-prompter.js";

const runExec = vi.fn();
const runCommandWithTimeout = vi.fn();
const note = vi.fn();

vi.mock("../process/exec.js", () => ({
  runExec,
  runCommandWithTimeout,
}));
vi.mock("../terminal/note.js", () => ({
  note,
}));

describe("maybeRepairSandboxImages", () => {
  beforeEach(() => {
    runExec.mockReset();
    runCommandWithTimeout.mockReset();
    note.mockReset();
  });

  it("logs docker inspect errors and continues", async () => {
    runExec.mockImplementation(async (_command: string, args: string[]) => {
      if (args[0] === "version") return { stdout: "26.0.0", stderr: "" };
      if (args[0] === "image" && args[1] === "inspect") {
        const err = new Error(
          "permission denied while trying to connect to the Docker daemon socket",
        ) as Error & { stderr?: string };
        err.stderr = "permission denied while trying to connect to the Docker daemon socket";
        throw err;
      }
      return { stdout: "", stderr: "" };
    });

    const { maybeRepairSandboxImages } = await import("./doctor-sandbox.js");
    const cfg = {
      agents: {
        defaults: {
          sandbox: {
            mode: "all",
            docker: { image: "custom-sandbox:latest" },
          },
        },
      },
    } satisfies ClawdbotConfig;

    const runtime = { log: vi.fn(), error: vi.fn() } as RuntimeEnv;
    const prompter = { confirmSkipInNonInteractive: vi.fn() } as DoctorPrompter;

    await expect(maybeRepairSandboxImages(cfg, runtime, prompter)).resolves.toBe(cfg);
    expect(note).toHaveBeenCalledWith(
      expect.stringContaining("Unable to inspect sandbox base image (custom-sandbox:latest)"),
      "Sandbox",
    );
    expect(runCommandWithTimeout).not.toHaveBeenCalled();
  });
});
