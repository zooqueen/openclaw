import * as providerCatalogRuntime from "openclaw/plugin-sdk/provider-catalog-runtime";
import { describe, expect, it } from "vitest";

describe("plugin-sdk provider-catalog-runtime", () => {
  it("keeps the legacy provider runtime hook cache reset seam exported", () => {
    expect(typeof providerCatalogRuntime.resetProviderRuntimeHookCacheForTest).toBe("function");
    expect(providerCatalogRuntime.resetProviderRuntimeHookCacheForTest()).toBeUndefined();
  });
});
