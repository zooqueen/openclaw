import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

function runUi(args: string[], env: NodeJS.ProcessEnv) {
  return spawnSync(process.execPath, ["scripts/ui.js", ...args], {
    env: { ...process.env, ...env },
    encoding: "utf8",
  });
}

function writeStubPnpm(dir: string) {
  const isWin = process.platform === "win32";
  const name = isWin ? "pnpm.cmd" : "pnpm";
  const target = path.join(dir, name);
  const contents = isWin ? "@echo off\r\nexit /B 0\r\n" : "#!/bin/sh\nexit 0\n";
  fs.writeFileSync(target, contents);
  if (!isWin) fs.chmodSync(target, 0o755);
  return target;
}

describe("scripts/ui.js", () => {
  it("fails with a pnpm-only error when pnpm is missing", () => {
    const result = runUi(["install"], { PATH: "" });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("install pnpm");
    expect(result.stderr.toLowerCase()).not.toContain("bun");
  });

  it("runs pnpm when available", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "clawdbot-ui-"));
    writeStubPnpm(tmp);
    const result = runUi(["install"], { PATH: tmp });
    expect(result.status).toBe(0);
  });
});
