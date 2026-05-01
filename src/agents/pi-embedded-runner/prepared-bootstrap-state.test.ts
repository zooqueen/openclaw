import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolveProviderAuthProfileId: vi.fn(),
  ensureAuthProfileStore: vi.fn(),
  resolvePreparedAuthProfileOrder: vi.fn(),
  shouldPreferExplicitConfigApiKeyAuth: vi.fn(),
}));

vi.mock("../../plugins/provider-runtime.js", () => ({
  resolveProviderAuthProfileId: mocks.resolveProviderAuthProfileId,
}));

vi.mock("../auth-profiles.js", () => ({
  ensureAuthProfileStore: mocks.ensureAuthProfileStore,
}));

vi.mock("../model-auth.js", () => ({
  resolvePreparedAuthProfileOrder: mocks.resolvePreparedAuthProfileOrder,
  shouldPreferExplicitConfigApiKeyAuth: mocks.shouldPreferExplicitConfigApiKeyAuth,
}));

import {
  preparePreparedPiRunBootstrapState,
  resetPreparedPiRunBootstrapStateCacheForTest,
  resolvePreparedPiRunBootstrapState,
} from "./prepared-bootstrap-state.js";

describe("resolvePreparedPiRunBootstrapState", () => {
  beforeEach(() => {
    resetPreparedPiRunBootstrapStateCacheForTest();
    mocks.resolveProviderAuthProfileId.mockReset();
    mocks.ensureAuthProfileStore.mockReset();
    mocks.resolvePreparedAuthProfileOrder.mockReset();
    mocks.shouldPreferExplicitConfigApiKeyAuth.mockReset();
  });

  it("prepares and reuses cached PI bootstrap state for the same key", () => {
    const authStore = { version: 1, profiles: {} };
    mocks.ensureAuthProfileStore.mockReturnValue(authStore);
    mocks.shouldPreferExplicitConfigApiKeyAuth.mockReturnValue(false);
    mocks.resolvePreparedAuthProfileOrder.mockReturnValue(["profile-b", "profile-a"]);
    mocks.resolveProviderAuthProfileId.mockReturnValue("profile-a");

    const prepared = preparePreparedPiRunBootstrapState({
      config: {} as never,
      agentDir: "/agent",
      workspaceDir: "/workspace",
      provider: "openai",
      modelId: "gpt-5.4",
    });
    const resolved = resolvePreparedPiRunBootstrapState({
      config: {} as never,
      agentDir: "/agent",
      workspaceDir: "/workspace",
      provider: "openai",
      modelId: "gpt-5.4",
    });

    expect(prepared).toEqual({
      authStore,
      preparedPiProfileOrder: ["profile-b", "profile-a"],
      preparedPiProviderOrderedProfiles: ["profile-a", "profile-b"],
    });
    expect(resolved).toBe(prepared);
    expect(mocks.ensureAuthProfileStore).toHaveBeenCalledWith("/agent", {
      allowKeychainPrompt: false,
    });
    expect(mocks.ensureAuthProfileStore).toHaveBeenCalledTimes(1);
    expect(mocks.resolvePreparedAuthProfileOrder).toHaveBeenCalledTimes(1);
    expect(mocks.resolveProviderAuthProfileId).toHaveBeenCalledTimes(1);
  });

  it("resolves with live fallback and caches the result when startup has not primed yet", () => {
    const authStore = { version: 1, profiles: {} };
    mocks.ensureAuthProfileStore.mockReturnValue(authStore);
    mocks.shouldPreferExplicitConfigApiKeyAuth.mockReturnValue(false);
    mocks.resolvePreparedAuthProfileOrder.mockReturnValue(["profile-a"]);
    mocks.resolveProviderAuthProfileId.mockReturnValue(undefined);

    const result = resolvePreparedPiRunBootstrapState({
      config: {} as never,
      agentDir: "/agent",
      workspaceDir: "/workspace",
      provider: "openai",
      modelId: "gpt-5.4",
    });

    expect(result).toEqual({
      authStore,
      preparedPiProfileOrder: ["profile-a"],
      preparedPiProviderOrderedProfiles: ["profile-a"],
    });
    expect(mocks.ensureAuthProfileStore).toHaveBeenCalledTimes(1);
  });

  it("separates cached bootstrap state by workspace/provider/model key", () => {
    mocks.shouldPreferExplicitConfigApiKeyAuth.mockReturnValue(false);
    mocks.resolvePreparedAuthProfileOrder.mockReturnValue(["profile-a"]);
    mocks.resolveProviderAuthProfileId.mockReturnValue(undefined);
    mocks.ensureAuthProfileStore
      .mockReturnValueOnce({ version: 1, profiles: { one: {} } })
      .mockReturnValueOnce({ version: 1, profiles: { two: {} } });

    const first = preparePreparedPiRunBootstrapState({
      config: {} as never,
      agentDir: "/agent",
      workspaceDir: "/workspace-a",
      provider: "openai",
      modelId: "gpt-5.4",
    });
    const second = preparePreparedPiRunBootstrapState({
      config: {} as never,
      agentDir: "/agent",
      workspaceDir: "/workspace-b",
      provider: "openai",
      modelId: "gpt-5.4",
    });

    expect(first).not.toBe(second);
    expect(mocks.ensureAuthProfileStore).toHaveBeenCalledTimes(2);
  });

  it("skips PI profile bootstrap when explicit config API-key auth is preferred", () => {
    const authStore = { version: 1, profiles: {} };
    mocks.ensureAuthProfileStore.mockReturnValue(authStore);
    mocks.shouldPreferExplicitConfigApiKeyAuth.mockReturnValue(true);

    const result = preparePreparedPiRunBootstrapState({
      config: {} as never,
      agentDir: "/agent",
      workspaceDir: "/workspace",
      provider: "openai",
      modelId: "gpt-5.4",
    });

    expect(result).toEqual({
      authStore,
      preparedPiProfileOrder: [],
      preparedPiProviderOrderedProfiles: [],
    });
    expect(mocks.resolvePreparedAuthProfileOrder).not.toHaveBeenCalled();
    expect(mocks.resolveProviderAuthProfileId).not.toHaveBeenCalled();
  });
});
