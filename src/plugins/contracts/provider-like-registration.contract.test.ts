// Provider-like registration tests cover plugin-owned capability provider snapshotting.
import {
  createPluginRegistryFixture,
  registerTestPlugin,
} from "openclaw/plugin-sdk/plugin-test-contracts";
import { describe, expect, it } from "vitest";
import { createPluginRecord } from "../status.test-helpers.js";
import type { VideoGenerationProviderPlugin } from "../types.js";

describe("plugin provider-like registration", () => {
  it("snapshots provider fields before capability runtime and catalog resolution", async () => {
    let idReads = 0;
    let labelReads = 0;
    let defaultModelReads = 0;
    let modelsReads = 0;
    let capabilitiesReads = 0;
    let generateReads = 0;
    const events: string[] = [];
    const generateVideo: VideoGenerationProviderPlugin["generateVideo"] = async function (this: {
      marker?: string;
    }) {
      events.push(`generate:${this.marker ?? "missing"}`);
      return { videos: [] };
    };
    const { config, registry } = createPluginRegistryFixture();
    registerTestPlugin({
      registry,
      config,
      record: createPluginRecord({
        id: "volatile-video-plugin",
        name: "Volatile Video Plugin",
      }),
      register(api) {
        api.registerVideoGenerationProvider({
          marker: "original",
          get id() {
            idReads += 1;
            if (idReads > 1) {
              throw new Error("video provider id getter re-read");
            }
            return " volatile-video ";
          },
          get label() {
            labelReads += 1;
            if (labelReads > 1) {
              throw new Error("video provider label getter re-read");
            }
            return "Volatile Video";
          },
          get defaultModel() {
            defaultModelReads += 1;
            if (defaultModelReads > 1) {
              throw new Error("video provider defaultModel getter re-read");
            }
            return "video-default";
          },
          get models() {
            modelsReads += 1;
            if (modelsReads > 1) {
              throw new Error("video provider models getter re-read");
            }
            return ["video-default", "video-pro"];
          },
          get capabilities() {
            capabilitiesReads += 1;
            if (capabilitiesReads > 1) {
              throw new Error("video provider capabilities getter re-read");
            }
            return {
              generate: {
                supportedDurationSeconds: [4],
              },
            };
          },
          get generateVideo() {
            generateReads += 1;
            if (generateReads > 1) {
              throw new Error("video provider generateVideo getter re-read");
            }
            return generateVideo;
          },
        } as VideoGenerationProviderPlugin & { marker: string });
      },
    });

    expect(registry.registry.diagnostics).toEqual([]);
    expect(registry.registry.videoGenerationProviders).toHaveLength(1);
    const provider = registry.registry.videoGenerationProviders[0]?.provider;
    expect(provider?.id).toBe("volatile-video");
    await expect(provider?.generateVideo({} as never)).resolves.toEqual({ videos: [] });

    const catalogProvider = registry.registry.modelCatalogProviders[0]?.provider;
    const staticRows = await catalogProvider?.staticCatalog?.({} as never);
    expect(staticRows).toEqual([
      {
        kind: "video_generation",
        provider: "volatile-video",
        model: "video-default",
        label: "Volatile Video",
        source: "static",
        capabilities: {
          generate: {
            supportedDurationSeconds: [4],
          },
        },
        default: true,
      },
      {
        kind: "video_generation",
        provider: "volatile-video",
        model: "video-pro",
        label: "Volatile Video",
        source: "static",
        capabilities: {
          generate: {
            supportedDurationSeconds: [4],
          },
        },
      },
    ]);
    expect(events).toEqual(["generate:original"]);
    expect(idReads).toBe(1);
    expect(labelReads).toBe(1);
    expect(defaultModelReads).toBe(1);
    expect(modelsReads).toBe(1);
    expect(capabilitiesReads).toBe(1);
    expect(generateReads).toBe(1);
  });

  it("preserves prototype methods on class-style providers", async () => {
    let idReads = 0;
    let labelReads = 0;
    let defaultModelReads = 0;
    let modelsReads = 0;
    let capabilitiesReads = 0;
    const events: string[] = [];
    class VolatileVideoProvider {
      marker = "class-original";

      get id() {
        idReads += 1;
        if (idReads > 1) {
          throw new Error("class video provider id getter re-read");
        }
        return " class-video ";
      }

      get label() {
        labelReads += 1;
        if (labelReads > 1) {
          throw new Error("class video provider label getter re-read");
        }
        return "Class Video";
      }

      get defaultModel() {
        defaultModelReads += 1;
        if (defaultModelReads > 1) {
          throw new Error("class video provider defaultModel getter re-read");
        }
        return "class-default";
      }

      get models() {
        modelsReads += 1;
        if (modelsReads > 1) {
          throw new Error("class video provider models getter re-read");
        }
        return ["class-default"];
      }

      get capabilities() {
        capabilitiesReads += 1;
        if (capabilitiesReads > 1) {
          throw new Error("class video provider capabilities getter re-read");
        }
        return {
          generate: {
            supportedDurationSeconds: [8],
          },
        };
      }

      async generateVideo() {
        events.push(`generate:${this.marker}`);
        return { videos: [] };
      }
    }
    const { config, registry } = createPluginRegistryFixture();
    registerTestPlugin({
      registry,
      config,
      record: createPluginRecord({
        id: "class-video-plugin",
        name: "Class Video Plugin",
      }),
      register(api) {
        api.registerVideoGenerationProvider(
          new VolatileVideoProvider() as VideoGenerationProviderPlugin,
        );
      },
    });

    expect(registry.registry.diagnostics).toEqual([]);
    const provider = registry.registry.videoGenerationProviders[0]?.provider;
    await expect(provider?.generateVideo({} as never)).resolves.toEqual({ videos: [] });
    const staticRows = await registry.registry.modelCatalogProviders[0]?.provider.staticCatalog?.(
      {} as never,
    );
    expect(staticRows?.map((row) => row.model)).toEqual(["class-default"]);
    expect(events).toEqual(["generate:class-original"]);
    expect(idReads).toBe(1);
    expect(labelReads).toBe(1);
    expect(defaultModelReads).toBe(1);
    expect(modelsReads).toBe(1);
    expect(capabilitiesReads).toBe(1);
  });

  it("preserves proxy-backed providers that do not enumerate fields", async () => {
    let idReads = 0;
    let labelReads = 0;
    let defaultModelReads = 0;
    let modelsReads = 0;
    let capabilitiesReads = 0;
    let generateReads = 0;
    const events: string[] = [];
    const provider = new Proxy(
      {},
      {
        ownKeys() {
          return [];
        },
        getOwnPropertyDescriptor() {
          return undefined;
        },
        get(_target, prop) {
          switch (prop) {
            case "id":
              idReads += 1;
              if (idReads > 1) {
                throw new Error("proxy video provider id getter re-read");
              }
              return " proxy-video ";
            case "label":
              labelReads += 1;
              if (labelReads > 1) {
                throw new Error("proxy video provider label getter re-read");
              }
              return "Proxy Video";
            case "defaultModel":
              defaultModelReads += 1;
              if (defaultModelReads > 1) {
                throw new Error("proxy video provider defaultModel getter re-read");
              }
              return "proxy-default";
            case "models":
              modelsReads += 1;
              if (modelsReads > 1) {
                throw new Error("proxy video provider models getter re-read");
              }
              return ["proxy-default"];
            case "capabilities":
              capabilitiesReads += 1;
              if (capabilitiesReads > 1) {
                throw new Error("proxy video provider capabilities getter re-read");
              }
              return {
                generate: {
                  supportedDurationSeconds: [12],
                },
              };
            case "generateVideo":
              generateReads += 1;
              if (generateReads > 1) {
                throw new Error("proxy video provider generateVideo getter re-read");
              }
              return function (this: { marker?: string }) {
                events.push(`generate:${this.marker ?? "missing"}`);
                return Promise.resolve({ videos: [] });
              };
            case "marker":
              return "proxy-original";
          }
          return undefined;
        },
      },
    ) as VideoGenerationProviderPlugin;
    const { config, registry } = createPluginRegistryFixture();
    registerTestPlugin({
      registry,
      config,
      record: createPluginRecord({
        id: "proxy-video-plugin",
        name: "Proxy Video Plugin",
      }),
      register(api) {
        api.registerVideoGenerationProvider(provider);
      },
    });

    expect(registry.registry.diagnostics).toEqual([]);
    const registered = registry.registry.videoGenerationProviders[0]?.provider;
    await expect(registered?.generateVideo({} as never)).resolves.toEqual({ videos: [] });
    const staticRows = await registry.registry.modelCatalogProviders[0]?.provider.staticCatalog?.(
      {} as never,
    );
    expect(staticRows?.map((row) => row.model)).toEqual(["proxy-default"]);
    expect(events).toEqual(["generate:proxy-original"]);
    expect(idReads).toBe(1);
    expect(labelReads).toBe(1);
    expect(defaultModelReads).toBe(1);
    expect(modelsReads).toBe(1);
    expect(capabilitiesReads).toBe(1);
    expect(generateReads).toBe(1);
  });
});
