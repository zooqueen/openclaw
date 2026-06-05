// Tests settings persistence error normalization.
import { describe, expect, it } from "vitest";
import { SettingsManager, type SettingsScope, type SettingsStorage } from "./settings-manager.js";

function createHostileThrownValue(): unknown {
  return new Proxy(
    {},
    {
      get() {
        throw new Error("property denied");
      },
      getPrototypeOf() {
        throw new Error("prototype denied");
      },
      ownKeys() {
        throw new Error("keys denied");
      },
    },
  );
}

class ThrowingSettingsStorage implements SettingsStorage {
  constructor(private readonly error: unknown) {}

  withLock(_scope: SettingsScope, _fn: (current: string | undefined) => string | undefined): void {
    throw this.error;
  }
}

class WriteFailingSettingsStorage implements SettingsStorage {
  constructor(private readonly error: unknown) {}

  withLock(_scope: SettingsScope, fn: (current: string | undefined) => string | undefined): void {
    const next = fn("{}");
    if (next !== undefined) {
      throw this.error;
    }
  }
}

describe("SettingsManager error normalization", () => {
  it("records hostile load errors without crashing", () => {
    const manager = SettingsManager.fromStorage(
      new ThrowingSettingsStorage(createHostileThrownValue()),
    );

    const errors = manager.drainErrors();

    expect(errors).toHaveLength(2);
    expect(errors.map((entry) => entry.scope)).toEqual(["global", "project"]);
    expect(errors.map((entry) => entry.error.message)).toEqual([
      "Settings load error",
      "Settings load error",
    ]);
    expect(errors.every((entry) => !Object.hasOwn(entry.error, "cause"))).toBe(true);
  });

  it("records hostile async write errors without crashing", async () => {
    const manager = SettingsManager.fromStorage(
      new WriteFailingSettingsStorage(createHostileThrownValue()),
    );

    manager.setDefaultModel("openai/gpt-5.5");
    await manager.flush();
    const errors = manager.drainErrors();

    expect(errors).toHaveLength(1);
    expect(errors[0]?.scope).toBe("global");
    expect(errors[0]?.error.message).toBe("Settings error");
    expect(Object.hasOwn(errors[0]?.error, "cause")).toBe(false);
  });
});
