import { describe, expect, it } from "vitest";

import { parseSearchArgs } from "./search-args.js";

describe("parseSearchArgs", () => {
  it("handles multi-word --from without quotes", () => {
    const parsed = parseSearchArgs('/search budget --from Sarah Smith');
    expect(parsed.error).toBeUndefined();
    expect(parsed.query).toBe("budget");
    expect(parsed.from).toBe("Sarah Smith");
  });

  it("handles quoted multi-word --from", () => {
    const parsed = parseSearchArgs('/search budget --from "Sarah Smith" --since 1w');
    expect(parsed.error).toBeUndefined();
    expect(parsed.query).toBe("budget");
    expect(parsed.from).toBe("Sarah Smith");
    expect(parsed.since).toBeTypeOf("number");
  });

  it("keeps multi-word query alongside --from", () => {
    const parsed = parseSearchArgs('/search quarterly report --from Sarah Smith');
    expect(parsed.error).toBeUndefined();
    expect(parsed.query).toBe("quarterly report");
    expect(parsed.from).toBe("Sarah Smith");
  });
});
