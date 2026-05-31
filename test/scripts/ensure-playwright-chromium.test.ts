import { describe, expect, it, vi } from "vitest";
import {
  ensurePlaywrightChromium,
  resolvePlaywrightInstallRunner,
} from "../../scripts/ensure-playwright-chromium.mjs";

describe("ensurePlaywrightChromium", () => {
  it("does nothing when the browser binary exists", () => {
    const spawnSync = vi.fn();

    expect(
      ensurePlaywrightChromium({
        executablePath: "/cache/chromium/chrome",
        existsSync: () => true,
        spawnSync,
      }),
    ).toBe(0);
    expect(spawnSync).not.toHaveBeenCalled();
  });

  it("preserves the intentional missing-browser skip mode", () => {
    const logs: string[] = [];
    const spawnSync = vi.fn();

    expect(
      ensurePlaywrightChromium({
        env: { OPENCLAW_UI_E2E_ALLOW_MISSING_CHROMIUM: "1" },
        executablePath: "/cache/chromium/chrome",
        existsSync: () => false,
        log: (line: string) => logs.push(line),
        spawnSync,
      }),
    ).toBe(0);
    expect(spawnSync).not.toHaveBeenCalled();
    expect(logs.join("\n")).toContain("leaves the lane skipped");
  });

  it("installs Chromium through the local Playwright CLI when missing", () => {
    const spawnSync = vi.fn(() => ({ status: 0 }));
    let existsCalls = 0;

    expect(
      ensurePlaywrightChromium({
        cwd: "/repo",
        env: { PATH: "/bin" },
        executablePath: "/cache/chromium/chrome",
        existsSync: () => ++existsCalls > 1,
        nodeExecPath: "/node/bin/node",
        playwrightCliPath: "/repo/node_modules/playwright/cli.js",
        spawnSync,
        stdio: "pipe",
      }),
    ).toBe(0);
    expect(spawnSync).toHaveBeenCalledWith(
      "/node/bin/node",
      ["/repo/node_modules/playwright/cli.js", "install", "chromium"],
      {
        cwd: "/repo",
        env: { PATH: "/bin" },
        shell: false,
        stdio: "pipe",
        windowsVerbatimArguments: undefined,
      },
    );
  });

  it("returns the installer status when Playwright install fails", () => {
    expect(
      ensurePlaywrightChromium({
        executablePath: "/cache/chromium/chrome",
        existsSync: () => false,
        spawnSync: vi.fn(() => ({ status: 23 })),
        stdio: "pipe",
      }),
    ).toBe(23);
  });

  it("uses Node for the Playwright CLI on Windows", () => {
    expect(
      resolvePlaywrightInstallRunner({
        nodeExecPath: "C:\\Program Files\\nodejs\\node.exe",
        playwrightCliPath: "C:\\repo\\node_modules\\playwright\\cli.js",
      }),
    ).toEqual({
      args: ["C:\\repo\\node_modules\\playwright\\cli.js", "install", "chromium"],
      command: "C:\\Program Files\\nodejs\\node.exe",
      shell: false,
    });
  });
});
