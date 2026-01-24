import { describe, expect, it } from "vitest";

import { normalizeWindowsArgv } from "./windows-argv.js";

describe("normalizeWindowsArgv", () => {
  const execPath = "C:\\Program Files\\nodejs\\node.exe";
  const scriptPath = "C:\\clawdbot\\dist\\entry.js";

  it("returns argv unchanged on non-windows platforms", () => {
    const argv = [execPath, scriptPath, "status"];
    expect(normalizeWindowsArgv(argv, { platform: "darwin", execPath })).toBe(argv);
  });

  it("removes duplicate node exec at argv[1]", () => {
    const argv = [execPath, execPath, scriptPath, "status"];
    expect(normalizeWindowsArgv(argv, { platform: "win32", execPath })).toEqual([
      execPath,
      scriptPath,
      "status",
    ]);
  });

  it("removes duplicate node exec at argv[2]", () => {
    const argv = [execPath, scriptPath, execPath, "gateway", "run"];
    expect(normalizeWindowsArgv(argv, { platform: "win32", execPath })).toEqual([
      execPath,
      scriptPath,
      "gateway",
      "run",
    ]);
  });

  it("keeps url arguments that contain node.exe", () => {
    const argv = [execPath, scriptPath, "send", "https://example.com/node.exe"];
    expect(normalizeWindowsArgv(argv, { platform: "win32", execPath })).toEqual(argv);
  });

  it("keeps node.exe paths after the command", () => {
    const argv = [execPath, scriptPath, "send", "C:\\Program Files\\nodejs\\node.exe"];
    expect(normalizeWindowsArgv(argv, { platform: "win32", execPath })).toEqual(argv);
  });
});
