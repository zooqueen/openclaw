import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

describe("embedded transcript mutation ownership guard", () => {
  it("keeps attempt transcript writes behind the mutation controller", async () => {
    const source = await fs.readFile(
      path.join(path.dirname(fileURLToPath(import.meta.url)), "attempt.ts"),
      "utf8",
    );
    const forbiddenPatterns = [
      /\bactiveSessionManager\.(appendMessage|appendCustomEntry|appendCompaction|branch|resetLeaf|branchWithSummary)\(/,
      /\bsessionManager\.(branch|resetLeaf)\(/,
      /\bsessionLockController\.withSessionWriteLock\(\s*(async\s*)?\(\)\s*=>\s*\{[^}]*\.(appendMessage|appendCustomEntry|appendCompaction|branch|resetLeaf|branchWithSummary)\(/s,
      /withSessionWriteLock:\s*\(\s*operation\s*\)\s*=>/,
    ];

    for (const pattern of forbiddenPatterns) {
      expect(source.match(pattern)?.[0]).toBeUndefined();
    }
  });
});
