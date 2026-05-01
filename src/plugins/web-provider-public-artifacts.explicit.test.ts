import { beforeEach, describe, expect, it, vi } from "vitest";

const loaderMock = vi.hoisted(() => ({
  loadBundledPluginPublicArtifactModuleSync: vi.fn(
    (params: { artifactBasename: string; dirName: string; installRuntimeDeps?: boolean }) => {
      if (params.artifactBasename.startsWith("web-fetch")) {
        return {
          createMockWebFetchProvider: () => ({
            id: `${params.dirName}-fetch`,
            label: "Mock fetch",
            hint: "Mock fetch",
            envVars: [],
            placeholder: "",
            signupUrl: "",
            credentialPath: "",
            getCredentialValue: () => undefined,
            setCredentialValue: () => undefined,
            createTool: () => null,
          }),
        };
      }
      return {
        createMockWebSearchProvider: () => ({
          id: `${params.dirName}-search`,
          label: "Mock search",
          hint: "Mock search",
          envVars: [],
          placeholder: "",
          signupUrl: "",
          credentialPath: "",
          getCredentialValue: () => undefined,
          setCredentialValue: () => undefined,
          createTool: () => null,
        }),
      };
    },
  ),
}));

vi.mock("./public-surface-loader.js", () => ({
  loadBundledPluginPublicArtifactModuleSync: loaderMock.loadBundledPluginPublicArtifactModuleSync,
  resolveBundledPluginPublicArtifactPath: vi.fn(() => "/tmp/mock-artifact.js"),
}));

import {
  resolveBundledExplicitRuntimeWebSearchProvidersFromPublicArtifacts,
  resolveBundledExplicitWebFetchProvidersFromPublicArtifacts,
  resolveBundledExplicitWebSearchProvidersFromPublicArtifacts,
} from "./web-provider-public-artifacts.explicit.js";

describe("web provider public artifacts explicit loader", () => {
  beforeEach(() => {
    loaderMock.loadBundledPluginPublicArtifactModuleSync.mockClear();
  });

  it("loads web search contract artifacts without runtime dependency installation", () => {
    resolveBundledExplicitWebSearchProvidersFromPublicArtifacts({
      onlyPluginIds: ["brave"],
    });

    expect(loaderMock.loadBundledPluginPublicArtifactModuleSync).toHaveBeenCalledWith({
      dirName: "brave",
      artifactBasename: "web-search-contract-api.js",
      installRuntimeDeps: false,
    });
  });

  it("loads web fetch contract artifacts without runtime dependency installation", () => {
    resolveBundledExplicitWebFetchProvidersFromPublicArtifacts({
      onlyPluginIds: ["firecrawl"],
    });

    expect(loaderMock.loadBundledPluginPublicArtifactModuleSync).toHaveBeenCalledWith({
      dirName: "firecrawl",
      artifactBasename: "web-fetch-contract-api.js",
      installRuntimeDeps: false,
    });
  });

  it("keeps explicit runtime web search compatibility artifacts allowed to install runtime deps", () => {
    resolveBundledExplicitRuntimeWebSearchProvidersFromPublicArtifacts({
      onlyPluginIds: ["google"],
    });

    expect(loaderMock.loadBundledPluginPublicArtifactModuleSync).toHaveBeenCalledWith({
      dirName: "google",
      artifactBasename: "web-search-provider.js",
    });
  });
});
