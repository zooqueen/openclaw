/**
 * Resolves provider/model prompt-cache retention behavior.
 */
import { normalizeLowercaseStringOrEmpty } from "@openclaw/normalization-core/string-coerce";
import { resolveAnthropicCacheRetentionFamily } from "../../llm/providers/stream-wrappers/anthropic-family-cache-semantics.js";

type CacheRetention = "none" | "short" | "long";

function readOwnDataProperty(params: Record<string, unknown> | undefined, key: string): unknown {
  if (!params) {
    return undefined;
  }
  const descriptor = Object.getOwnPropertyDescriptor(params, key);
  return descriptor && "value" in descriptor ? descriptor.value : undefined;
}

export function isGooglePromptCacheEligible(params: {
  modelApi?: string;
  modelId?: string;
}): boolean {
  if (params.modelApi !== "google-generative-ai") {
    return false;
  }
  const normalizedModelId = normalizeLowercaseStringOrEmpty(params.modelId);
  return normalizedModelId.startsWith("gemini-2.5") || normalizedModelId.startsWith("gemini-3");
}

export function resolveCacheRetention(
  extraParams: Record<string, unknown> | undefined,
  provider: string,
  modelApi?: string,
  modelId?: string,
  supportsPromptCacheKey?: boolean,
): CacheRetention | undefined {
  const newVal = readOwnDataProperty(extraParams, "cacheRetention");
  const legacy = readOwnDataProperty(extraParams, "cacheControlTtl");
  const hasExplicitCacheConfig = newVal !== undefined || legacy !== undefined;
  const family = resolveAnthropicCacheRetentionFamily({
    provider,
    modelApi,
    modelId,
    hasExplicitCacheConfig,
  });
  const googleEligible = isGooglePromptCacheEligible({ modelApi, modelId });
  // OpenAI-compatible completions backends (oMLX, llama.cpp, etc.) opt into
  // prompt caching via `compat.supportsPromptCacheKey: true`. Without that
  // flag they sit outside the anthropic/google family gates, so issue #81281
  // dropped the user's explicit `cacheRetention` before the transport layer
  // could emit it. Proxies that route non-cacheable models via the same
  // openai-completions wire (amazon-bedrock + amazon.* nova models) leave
  // the flag unset, so the existing family gate still applies to them.
  const cacheKeyEligible = supportsPromptCacheKey === true;

  if (!family && !googleEligible && !cacheKeyEligible) {
    return undefined;
  }

  if (newVal === "none" || newVal === "short" || newVal === "long") {
    return newVal;
  }

  if (legacy === "5m" && (family || googleEligible)) {
    return "short";
  }
  if (legacy === "1h" && (family || googleEligible)) {
    return "long";
  }

  return family === "anthropic-direct" ? "short" : undefined;
}
