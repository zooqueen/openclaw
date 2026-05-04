import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

type PnpmWorkspaceConfig = {
  blockExoticSubdeps?: unknown;
  onlyBuiltDependencies?: unknown;
};

describe("pnpm workspace config", () => {
  it("keeps the Baileys git-hosted libsignal dependency installable", () => {
    const config = parse(readFileSync("pnpm-workspace.yaml", "utf8")) as PnpmWorkspaceConfig;

    expect(config.blockExoticSubdeps).toBe(false);
    expect(config.onlyBuiltDependencies).toEqual(
      expect.arrayContaining(["@whiskeysockets/baileys"]),
    );
  });
});
