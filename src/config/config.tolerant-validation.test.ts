import fs from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import {
  createConfigIO,
  readConfigFileSnapshot,
  validateConfigObjectWithPlugins,
} from "./config.js";
import { withTempHome, writeOpenClawConfig } from "./test-helpers.js";

describe("tolerant config reads", () => {
  it("keeps strict config validation for unknown root and nested keys", () => {
    const result = validateConfigObjectWithPlugins({
      gateway: {
        auth: {
          mode: "token",
          token: "test-token",
          staleAuthKey: true,
        },
      },
      staleRootKey: true,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.map((issue) => issue.path)).toEqual(
        expect.arrayContaining(["gateway.auth", ""]),
      );
    }
  });

  it("warns and ignores unknown keys during read snapshots without dropping them from source", async () => {
    await withTempHome(async (home) => {
      await writeOpenClawConfig(home, {
        gateway: {
          mode: "local",
          auth: {
            mode: "token",
            token: "test-token",
            staleAuthKey: true,
          },
        },
        staleRootKey: true,
      });

      const snapshot = await readConfigFileSnapshot();

      expect(snapshot.valid).toBe(true);
      expect(snapshot.issues).toEqual([]);
      expect(snapshot.warnings.map((warning) => warning.path)).toEqual(
        expect.arrayContaining(["gateway.auth.staleAuthKey", "staleRootKey"]),
      );
      expect(
        (snapshot.config.gateway?.auth as Record<string, unknown>).staleAuthKey,
      ).toBeUndefined();
      expect((snapshot.config as Record<string, unknown>).staleRootKey).toBeUndefined();
      expect((snapshot.sourceConfig.gateway?.auth as Record<string, unknown>).staleAuthKey).toBe(
        true,
      );
      expect((snapshot.sourceConfig as Record<string, unknown>).staleRootKey).toBe(true);
    });
  });

  it("keeps semantic config failures fatal after pruning unknown keys", async () => {
    await withTempHome(async (home) => {
      await writeOpenClawConfig(home, {
        gateway: {
          bind: "lan",
          tailscale: { mode: "serve" },
          staleGatewayKey: true,
        },
      });

      const snapshot = await readConfigFileSnapshot();

      expect(snapshot.valid).toBe(false);
      expect(snapshot.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            path: "gateway.bind",
          }),
        ]),
      );
      expect(snapshot.warnings.map((warning) => warning.path)).toContain("gateway.staleGatewayKey");
    });
  });

  it("preserves unknown keys when startup persists generated config fields", async () => {
    await withTempHome(async (home) => {
      const configPath = await writeOpenClawConfig(home, {
        commands: {
          ownerDisplay: "hash",
        },
        staleRootKey: true,
      });
      const logger = { warn: vi.fn(), error: vi.fn() };
      const io = createConfigIO({
        homedir: () => home,
        env: { OPENCLAW_TEST_FAST: "1" } as NodeJS.ProcessEnv,
        logger,
      });

      io.loadConfig();

      await vi.waitFor(async () => {
        const persisted = JSON.parse(await fs.readFile(configPath, "utf-8")) as {
          commands?: { ownerDisplaySecret?: string };
          staleRootKey?: boolean;
        };
        expect(persisted.commands?.ownerDisplaySecret).toEqual(expect.any(String));
        expect(persisted.staleRootKey).toBe(true);
      });
      expect(logger.warn).not.toHaveBeenCalledWith(
        expect.stringContaining("Failed to persist auto-generated commands.ownerDisplaySecret"),
      );
    });
  });
});
