// Qa Lab tests cover qa transport registry plugin behavior.
import { describe, expect, it } from "vitest";
import {
  defaultQaSuiteConcurrencyForTransport,
  formatQaTransportIdHelp,
  normalizeQaTransportId,
} from "./qa-transport-registry.js";

describe("qa transport registry", () => {
  it("selects the first mock channel driver by channel id", () => {
    expect(normalizeQaTransportId("telegram")).toBe("telegram");
    expect(formatQaTransportIdHelp()).toContain("telegram");
    expect(defaultQaSuiteConcurrencyForTransport("telegram")).toBe(1);
  });

  it("does not accept an opaque all-channel mock transport", () => {
    expect(() => normalizeQaTransportId("all-mock-channels")).toThrow(
      "unsupported QA transport: all-mock-channels",
    );
  });

  it("rejects inherited prototype keys as unsupported transport ids", () => {
    expect(() => normalizeQaTransportId("toString")).toThrow("unsupported QA transport: toString");
    expect(() => normalizeQaTransportId("__proto__")).toThrow(
      "unsupported QA transport: __proto__",
    );
  });
});
