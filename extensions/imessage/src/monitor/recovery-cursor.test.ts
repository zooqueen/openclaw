// Imessage tests cover the downtime-recovery cursor.
import { beforeEach, describe, expect, it } from "vitest";
import { installIMessageStateRuntimeForTest } from "../test-support/runtime.js";
import { advanceIMessageRecoveryCursor, loadIMessageRecoveryCursor } from "./recovery-cursor.js";

describe("iMessage recovery cursor", () => {
  beforeEach(() => {
    installIMessageStateRuntimeForTest();
  });

  it("returns null before anything is recorded", () => {
    expect(loadIMessageRecoveryCursor("default")).toBeNull();
  });

  it("persists the last dispatched rowid", () => {
    advanceIMessageRecoveryCursor("default", 100);
    expect(loadIMessageRecoveryCursor("default")).toBe(100);
  });

  it("advances forward only and never rewinds", () => {
    advanceIMessageRecoveryCursor("default", 100);
    advanceIMessageRecoveryCursor("default", 50);
    expect(loadIMessageRecoveryCursor("default")).toBe(100);
    advanceIMessageRecoveryCursor("default", 150);
    expect(loadIMessageRecoveryCursor("default")).toBe(150);
  });

  it("scopes the cursor per account", () => {
    advanceIMessageRecoveryCursor("work", 10);
    advanceIMessageRecoveryCursor("home", 20);
    expect(loadIMessageRecoveryCursor("work")).toBe(10);
    expect(loadIMessageRecoveryCursor("home")).toBe(20);
  });

  it("ignores non-finite rowids", () => {
    advanceIMessageRecoveryCursor("default", Number.NaN);
    expect(loadIMessageRecoveryCursor("default")).toBeNull();
  });
});
