// Memory Wiki plugin module implements corpus supplement behavior.
import type { OpenClawConfig } from "../api.js";
import type { ResolvedMemoryWikiConfig } from "./config.js";
import { getMemoryWikiPage, searchMemoryWiki } from "./query.js";

export function createWikiCorpusSupplement(params: {
  config?: ResolvedMemoryWikiConfig;
  resolveConfig?: (agentId?: string) => ResolvedMemoryWikiConfig;
  appConfig?: OpenClawConfig;
}) {
  const resolveConfig = params.resolveConfig ?? (() => params.config as ResolvedMemoryWikiConfig);
  return {
    search: async (input: {
      query: string;
      maxResults?: number;
      agentId?: string;
      agentSessionKey?: string;
    }) =>
      await searchMemoryWiki({
        config: resolveConfig(input.agentId),
        appConfig: params.appConfig,
        agentSessionKey: input.agentSessionKey,
        query: input.query,
        maxResults: input.maxResults,
        searchBackend: "local",
        searchCorpus: "wiki",
      }),
    get: async (input: {
      lookup: string;
      fromLine?: number;
      lineCount?: number;
      agentId?: string;
      agentSessionKey?: string;
    }) =>
      await getMemoryWikiPage({
        config: resolveConfig(input.agentId),
        appConfig: params.appConfig,
        agentSessionKey: input.agentSessionKey,
        lookup: input.lookup,
        fromLine: input.fromLine,
        lineCount: input.lineCount,
        searchBackend: "local",
        searchCorpus: "wiki",
      }),
  };
}
