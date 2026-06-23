import { describe, expect, it } from "vitest";
import { applyExecPolicyLayer, type ExecPolicyLayer } from "./exec-policy.js";

describe("applyExecPolicyLayer", () => {
  it("preserves base fields when applying a normalized mode", () => {
    const base = {
      host: "gateway",
      security: "deny",
      ask: "always",
    } satisfies ExecPolicyLayer & { host: string };

    expect(applyExecPolicyLayer(base, { mode: "full" })).toMatchObject({
      host: "gateway",
      mode: "full",
      security: "full",
      ask: "off",
    });
  });

  it("preserves base fields when applying legacy security and ask overrides", () => {
    const base = {
      timeoutSec: 30,
      security: "deny",
      ask: "always",
    } satisfies ExecPolicyLayer & { timeoutSec: number };

    expect(applyExecPolicyLayer(base, { security: "allowlist" })).toEqual({
      timeoutSec: 30,
      security: "allowlist",
      ask: "always",
    });
  });

  it("clears inherited normalized mode when legacy policy fields override it", () => {
    const base = applyExecPolicyLayer(
      {
        host: "gateway",
        security: "deny",
        ask: "always",
      } satisfies ExecPolicyLayer & { host: string },
      { mode: "full" },
    );

    expect(applyExecPolicyLayer(base, { security: "deny" })).toEqual({
      host: "gateway",
      security: "deny",
      ask: "off",
    });
  });
});
