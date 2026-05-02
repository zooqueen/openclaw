import {
  resolvePluginWebFetchProviders,
  resolveRuntimeWebFetchProviders,
} from "../plugins/web-fetch-providers.runtime.js";
import {
  resolvePluginWebSearchProviders,
  resolveRuntimeWebSearchProviders,
} from "../plugins/web-search-providers.runtime.js";

export const runtimeWebToolsFallbackProviders = {
  resolvePluginWebFetchProviders,
  resolvePluginWebSearchProviders,
  resolveRuntimeWebFetchProviders,
  resolveRuntimeWebSearchProviders,
};
