// Imessage tests cover the doctor contract for the retired catchup config.
import { describe, expect, it } from "vitest";
import { legacyConfigRules, normalizeCompatibilityConfig } from "../doctor-contract-api.js";

describe("iMessage doctor contract: retired catchup config", () => {
  it("detects a top-level catchup block", () => {
    const cfg = { channels: { imessage: { catchup: { enabled: true } } } } as never;
    const rule = legacyConfigRules[0];
    expect(rule?.match?.((cfg as { channels: { imessage: unknown } }).channels.imessage, cfg)).toBe(
      true,
    );
  });

  it("detects a per-account catchup block", () => {
    const imessage = { accounts: { work: { catchup: { enabled: false } } } };
    const cfg = { channels: { imessage } } as never;
    expect(legacyConfigRules[0]?.match?.(imessage, cfg)).toBe(true);
  });

  it("does not flag a config without catchup", () => {
    const imessage = { dmPolicy: "pairing", accounts: { work: { cliPath: "imsg" } } };
    const cfg = { channels: { imessage } } as never;
    expect(legacyConfigRules[0]?.match?.(imessage, cfg)).toBe(false);
  });

  it("strips top-level and per-account catchup and reports each change", () => {
    const cfg = {
      channels: {
        imessage: {
          catchup: { enabled: true },
          dmPolicy: "pairing",
          accounts: { work: { catchup: { enabled: false }, cliPath: "imsg" } },
        },
      },
    } as never;
    const mutation = normalizeCompatibilityConfig({ cfg });
    expect(mutation.changes).toHaveLength(2);
    const imessage = (mutation.config as { channels: { imessage: Record<string, unknown> } })
      .channels.imessage;
    expect("catchup" in imessage).toBe(false);
    const accounts = imessage.accounts as { work: Record<string, unknown> };
    expect("catchup" in accounts.work).toBe(false);
    expect(accounts.work.cliPath).toBe("imsg");
  });

  it("is a no-op when catchup is absent", () => {
    const cfg = { channels: { imessage: { dmPolicy: "pairing" } } } as never;
    const mutation = normalizeCompatibilityConfig({ cfg });
    expect(mutation.changes).toHaveLength(0);
    expect(mutation.config).toBe(cfg);
  });
});
