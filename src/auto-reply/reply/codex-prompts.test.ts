import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  parseSlashCommand,
  renderCodexPrompt,
  resolveCodexPrompt,
  stripFrontMatter,
} from "./codex-prompts.js";

describe("codex prompts", () => {
  it("parses slash command names and args", () => {
    expect(parseSlashCommand("/landpr 123 abc")).toEqual({ name: "landpr", args: "123 abc" });
    expect(parseSlashCommand("nope")).toBeNull();
  });

  it("resolves prompt files and substitutes args", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "clawdbot-codex-prompts-"));
    const promptDir = path.join(tmp, "prompts");
    await fs.mkdir(promptDir, { recursive: true });
    await fs.writeFile(
      path.join(promptDir, "landpr.md"),
      `---\nsummary: test\n---\nHello $1 [$*] $0\n`,
      "utf-8",
    );

    const prev = process.env.CODEX_HOME;
    process.env.CODEX_HOME = tmp;
    try {
      const resolved = await resolveCodexPrompt("landpr");
      expect(resolved?.path).toContain("landpr.md");
      const stripped = stripFrontMatter(`---\nsummary: test\n---\nHello`);
      expect(stripped).toBe("Hello");
      const rendered = renderCodexPrompt({
        body: resolved?.body ?? "",
        args: "123 abc",
        commandName: "landpr",
      });
      expect(rendered).toContain("Hello 123 [123 abc] landpr");
    } finally {
      if (prev === undefined) {
        delete process.env.CODEX_HOME;
      } else {
        process.env.CODEX_HOME = prev;
      }
    }
  });
});
