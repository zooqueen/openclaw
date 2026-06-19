// Bundled frontmatter tests cover metadata validity for bundled skills.
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseFrontmatter, resolveOpenClawMetadata } from "./frontmatter.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

describe("bundled taskflow skill frontmatter", () => {
  it("keeps the taskflow skills parseable from their shipped files", async () => {
    const skillPaths = [
      "skills/taskflow/SKILL.md",
      "skills/taskflow-inbox-triage/SKILL.md",
    ] as const;

    for (const relativePath of skillPaths) {
      const raw = await fs.readFile(path.join(repoRoot, relativePath), "utf8");
      const frontmatter = parseFrontmatter(raw);

      expect(frontmatter.name, relativePath).toBeTypeOf("string");
      expect(frontmatter.name?.trim(), relativePath).not.toBe("");
      expect(frontmatter.description, relativePath).toBeTypeOf("string");
      expect(frontmatter.description?.trim(), relativePath).not.toBe("");
    }
  });
});

describe("bundled Trello skill frontmatter", () => {
  it("declares curl because the shipped examples require it", async () => {
    const raw = await fs.readFile(path.join(repoRoot, "skills/trello/SKILL.md"), "utf8");
    const metadata = resolveOpenClawMetadata(parseFrontmatter(raw));

    expect(raw).toContain("curl -s ");
    expect(metadata?.requires?.bins).toEqual(expect.arrayContaining(["curl", "jq"]));
  });
});
