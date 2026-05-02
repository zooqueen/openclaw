import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const tempDirs: string[] = [];
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { force: true, recursive: true });
  }
});

function runWriteConfig(mode: string) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-bundled-channel-config-"));
  tempDirs.push(home);
  execFileSync(
    process.execPath,
    ["scripts/e2e/lib/bundled-channel/write-config.mjs", mode, "test-token", "18789"],
    {
      cwd: repoRoot,
      env: {
        ...process.env,
        HOME: home,
        OPENAI_API_KEY: "sk-test",
      },
    },
  );
  return JSON.parse(fs.readFileSync(path.join(home, ".openclaw", "openclaw.json"), "utf8")) as {
    plugins?: { enabled?: boolean };
    channels?: Record<string, { enabled?: boolean }>;
  };
}

describe("bundled channel write-config helper", () => {
  it("keeps the baseline gateway plugin-light", () => {
    const config = runWriteConfig("baseline");

    expect(config.plugins?.enabled).toBe(false);
    expect(config.channels?.slack?.enabled).toBe(false);
    expect(config.channels?.telegram?.enabled).toBe(false);
  });

  it("enables plugins for the channel-under-test gateway", () => {
    const config = runWriteConfig("slack");

    expect(config.plugins?.enabled).toBe(true);
    expect(config.channels?.slack?.enabled).toBe(true);
    expect(config.channels?.telegram?.enabled).toBe(false);
  });
});
