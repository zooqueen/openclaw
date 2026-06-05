// Control UI descriptor contract tests cover plugin metadata projection to Gateway clients.
import {
  createPluginRegistryFixture,
  registerTestPlugin,
} from "openclaw/plugin-sdk/plugin-test-contracts";
import { afterEach, describe, expect, it } from "vitest";
import { pluginHostHookHandlers } from "../../gateway/server-methods/plugin-host-hooks.js";
import type { RespondFn } from "../../gateway/server-methods/types.js";
import { createEmptyPluginRegistry } from "../registry-empty.js";
import { setActivePluginRegistry } from "../runtime.js";
import { createPluginRecord } from "../status.test-helpers.js";

function callPluginUiDescriptorsForTest(): { ok: boolean; payload?: unknown; error?: unknown } {
  let response: { ok: boolean; payload?: unknown; error?: unknown } | undefined;
  const respond: RespondFn = (ok, payload, error) => {
    response = { ok, payload, error };
  };
  void pluginHostHookHandlers["plugins.uiDescriptors"]({
    req: { id: "test", type: "req", method: "plugins.uiDescriptors", params: {} },
    params: {},
    client: null,
    isWebchatConnect: () => false,
    respond,
    context: {} as never,
  });
  return response ?? { ok: false, error: new Error("handler did not respond") };
}

describe("plugin Control UI descriptors", () => {
  afterEach(() => {
    setActivePluginRegistry(createEmptyPluginRegistry());
  });

  it("snapshots descriptor schemas before Gateway projection", () => {
    let schemaReads = 0;
    const schema = {
      type: "object",
      properties: {
        mode: { type: "string" },
      },
    };
    const { config, registry } = createPluginRegistryFixture();
    registerTestPlugin({
      registry,
      config,
      record: createPluginRecord({
        id: "volatile-descriptor-fixture",
        name: "Volatile Descriptor Fixture",
      }),
      register(api) {
        api.registerControlUiDescriptor({
          id: "volatile-schema",
          surface: "session",
          label: "Volatile schema",
          get schema() {
            schemaReads += 1;
            if (schemaReads > 1) {
              throw new Error("descriptor schema getter re-read");
            }
            return schema;
          },
        });
      },
    });
    setActivePluginRegistry(registry.registry);

    expect(registry.registry.controlUiDescriptors?.[0]?.descriptor.schema).toEqual(schema);
    expect(schemaReads).toBe(1);
    expect(callPluginUiDescriptorsForTest()).toEqual({
      ok: true,
      payload: {
        ok: true,
        descriptors: [
          {
            id: "volatile-schema",
            surface: "session",
            label: "Volatile schema",
            schema,
            pluginId: "volatile-descriptor-fixture",
            pluginName: "Volatile Descriptor Fixture",
          },
        ],
      },
      error: undefined,
    });
    expect(schemaReads).toBe(1);
  });
});
