// Resource loader tests cover compatibility wiring for SDK prompt transform
// aliases.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DefaultResourceLoader } from "./resource-loader.js";

describe("DefaultResourceLoader", () => {
  it("keeps deprecated SDK prompt override aliases wired to prompt transforms", async () => {
    // These aliases are deprecated but shipped SDK surface, so they still map
    // through the same transform path as the current options.
    const root = mkdtempSync(join(tmpdir(), "openclaw-resource-loader-"));
    try {
      const loader = new DefaultResourceLoader({
        cwd: root,
        agentDir: root,
        noExtensions: true,
        noSkills: true,
        noPromptTemplates: true,
        noThemes: true,
        noContextFiles: true,
        systemPrompt: "base",
        appendSystemPrompt: ["tail"],
        systemPromptOverride: (base) => `${base ?? ""} legacy`,
        appendSystemPromptOverride: (base) => [...base, "legacy"],
      });

      await loader.reload();

      expect(loader.getSystemPrompt()).toBe("base legacy");
      expect(loader.getAppendSystemPrompt()).toEqual(["tail", "legacy"]);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it("reports hostile inline extension factory failures without crashing reload", async () => {
    const root = mkdtempSync(join(tmpdir(), "openclaw-resource-loader-"));
    try {
      const hostileError = new Error("inline factory failed");
      Object.defineProperty(hostileError, "message", {
        get() {
          throw new Error("message denied");
        },
      });
      const loader = new DefaultResourceLoader({
        cwd: root,
        agentDir: root,
        noExtensions: true,
        noSkills: true,
        noPromptTemplates: true,
        noThemes: true,
        noContextFiles: true,
        extensionFactories: [
          () => {
            throw hostileError;
          },
        ],
      });

      await loader.reload();

      expect(loader.getExtensions().extensions).toEqual([]);
      expect(loader.getExtensions().errors).toEqual([
        {
          path: "<inline:1>",
          error: "failed to load extension",
        },
      ]);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });
});
