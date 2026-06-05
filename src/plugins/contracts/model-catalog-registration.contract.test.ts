// Model catalog registration tests cover plugin-owned catalog provider snapshotting.
import {
  createPluginRegistryFixture,
  registerTestPlugin,
} from "openclaw/plugin-sdk/plugin-test-contracts";
import { describe, expect, it } from "vitest";
import { createPluginRecord } from "../status.test-helpers.js";
import type { UnifiedModelCatalogProviderPlugin } from "../types.js";

describe("plugin model catalog registration", () => {
  it("snapshots provider fields before catalog hook resolution", async () => {
    let firstProviderReads = 0;
    let firstKindsReads = 0;
    let firstStaticReads = 0;
    let secondProviderReads = 0;
    let secondKindsReads = 0;
    let secondStaticReads = 0;
    const events: string[] = [];
    const firstStaticCatalog: NonNullable<UnifiedModelCatalogProviderPlugin["staticCatalog"]> =
      function (this: { marker?: string }) {
        events.push(`static:${this.marker ?? "missing"}`);
        return [
          {
            kind: "text",
            provider: "volatile-catalog",
            model: "first-model",
            source: "static",
          },
        ];
      };
    const secondStaticCatalog: NonNullable<UnifiedModelCatalogProviderPlugin["staticCatalog"]> =
      function (this: { marker?: string }) {
        events.push(`static:${this.marker ?? "missing"}`);
        return [
          {
            kind: "text",
            provider: "volatile-catalog",
            model: "second-model",
            source: "static",
          },
        ];
      };
    const { config, registry } = createPluginRegistryFixture();
    registerTestPlugin({
      registry,
      config,
      record: createPluginRecord({
        id: "volatile-model-catalog",
        name: "Volatile Model Catalog",
      }),
      register(api) {
        api.registerModelCatalogProvider({
          marker: "first",
          get provider() {
            firstProviderReads += 1;
            if (firstProviderReads > 1) {
              throw new Error("first provider getter re-read");
            }
            return " volatile-catalog ";
          },
          get kinds() {
            firstKindsReads += 1;
            if (firstKindsReads > 1) {
              throw new Error("first kinds getter re-read");
            }
            return ["text"];
          },
          get staticCatalog() {
            firstStaticReads += 1;
            if (firstStaticReads > 1) {
              throw new Error("first staticCatalog getter re-read");
            }
            return firstStaticCatalog;
          },
        } as UnifiedModelCatalogProviderPlugin & { marker: string });
        api.registerModelCatalogProvider({
          marker: "second",
          get provider() {
            secondProviderReads += 1;
            if (secondProviderReads > 1) {
              throw new Error("second provider getter re-read");
            }
            return "volatile-catalog";
          },
          get kinds() {
            secondKindsReads += 1;
            if (secondKindsReads > 1) {
              throw new Error("second kinds getter re-read");
            }
            return ["text"];
          },
          get staticCatalog() {
            secondStaticReads += 1;
            if (secondStaticReads > 1) {
              throw new Error("second staticCatalog getter re-read");
            }
            return secondStaticCatalog;
          },
        } as UnifiedModelCatalogProviderPlugin & { marker: string });
      },
    });

    expect(registry.registry.diagnostics).toEqual([]);
    expect(registry.registry.modelCatalogProviders).toHaveLength(1);
    const catalogProvider = registry.registry.modelCatalogProviders[0]?.provider;
    expect(catalogProvider?.provider).toBe("volatile-catalog");
    expect(catalogProvider?.kinds).toEqual(["text"]);
    await expect(catalogProvider?.staticCatalog?.({} as never)).resolves.toEqual([
      {
        kind: "text",
        provider: "volatile-catalog",
        model: "first-model",
        source: "static",
      },
      {
        kind: "text",
        provider: "volatile-catalog",
        model: "second-model",
        source: "static",
      },
    ]);
    expect(events).toEqual(["static:first", "static:second"]);
    expect(firstProviderReads).toBe(1);
    expect(firstKindsReads).toBe(1);
    expect(firstStaticReads).toBe(1);
    expect(secondProviderReads).toBe(1);
    expect(secondKindsReads).toBe(1);
    expect(secondStaticReads).toBe(1);
  });
});
