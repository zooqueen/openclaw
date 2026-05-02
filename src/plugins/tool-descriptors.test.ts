import { describe, expect, it } from "vitest";
import { buildToolPlan } from "../tools/planner.js";
import {
  listMissingPluginManifestToolDescriptors,
  listPluginManifestToolDescriptors,
  type PluginToolDescriptorManifestRecord,
} from "./tool-descriptors.js";

function pluginRecord(
  overrides: Partial<PluginToolDescriptorManifestRecord>,
): PluginToolDescriptorManifestRecord {
  return {
    id: "example",
    contracts: {
      tools: ["example_search", "example_hidden"],
    },
    toolMetadata: {
      example_search: {
        descriptor: {
          title: "Example Search",
          description: "Search Example data.",
          inputSchema: {
            type: "object",
            properties: {
              query: { type: "string" },
            },
            required: ["query"],
          },
          annotations: {
            readOnlyHint: true,
          },
          sortKey: "search.example",
        },
      },
    },
    ...overrides,
  };
}

describe("plugin manifest tool descriptors", () => {
  it("builds generic tool descriptors from complete static metadata", () => {
    const descriptors = listPluginManifestToolDescriptors(pluginRecord({}));

    expect(descriptors).toEqual([
      {
        name: "example_search",
        title: "Example Search",
        description: "Search Example data.",
        inputSchema: {
          type: "object",
          properties: {
            query: { type: "string" },
          },
          required: ["query"],
        },
        owner: { kind: "plugin", pluginId: "example" },
        executor: { kind: "plugin", pluginId: "example", toolName: "example_search" },
        annotations: {
          readOnlyHint: true,
        },
        sortKey: "search.example",
      },
    ]);
    expect(buildToolPlan({ descriptors }).visible.map((entry) => entry.descriptor.name)).toEqual([
      "example_search",
    ]);
  });

  it("reports declared plugin tools without complete static descriptors", () => {
    expect(listMissingPluginManifestToolDescriptors(pluginRecord({}))).toEqual(["example_hidden"]);
  });
});
