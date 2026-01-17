import { describe, expect, it } from "vitest";

import { formatScpSource, quoteScpPath } from "./remote.js";

describe("quoteScpPath", () => {
  it("wraps paths in single quotes", () => {
    expect(quoteScpPath("/Users/bot/Messages/Attachment One.jpg")).toBe(
      "'/Users/bot/Messages/Attachment One.jpg'",
    );
  });

  it("escapes single quotes for remote shell", () => {
    expect(quoteScpPath("/Users/bot/It's/Photo.jpg")).toBe(
      "'/Users/bot/It'\"'\"'s/Photo.jpg'",
    );
  });
});

describe("formatScpSource", () => {
  it("formats the scp source with quoted path", () => {
    expect(formatScpSource("user@gateway-host", "/Users/bot/Hello World.jpg")).toBe(
      "user@gateway-host:'/Users/bot/Hello World.jpg'",
    );
  });
});
