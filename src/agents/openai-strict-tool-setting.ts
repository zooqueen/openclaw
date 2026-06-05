/**
 * Strict tool-schema default resolution for native OpenAI-compatible routes.
 *
 * Compatible providers can support strict schemas without inheriting OpenAI's required default.
 */
import { readStringValue } from "@openclaw/normalization-core/string-coerce";
import { resolveProviderRequestCapabilities } from "./provider-attribution.js";

// Resolves OpenAI strict-tool schema defaults. Native OpenAI routes require
// strict=true, while compatible providers that merely support strict mode get
// false so callers can opt in without forcing provider-specific behavior.
type OpenAITransportKind = "stream" | "websocket";

type OpenAIStrictToolModel = {
  provider?: unknown;
  api?: unknown;
  baseUrl?: unknown;
  id?: unknown;
  compat?: unknown;
};

const optionalString = readStringValue;

function readModelField(model: OpenAIStrictToolModel, key: string): unknown {
  let descriptor: PropertyDescriptor | undefined;
  try {
    descriptor = Object.getOwnPropertyDescriptor(model, key);
  } catch {
    return undefined;
  }
  try {
    return descriptor && "value" in descriptor ? descriptor.value : descriptor?.get?.call(model);
  } catch {
    return undefined;
  }
}

function resolvesToNativeOpenAIStrictTools(
  model: OpenAIStrictToolModel,
  transport: OpenAITransportKind,
): boolean {
  const capabilities = resolveProviderRequestCapabilities({
    provider: optionalString(readModelField(model, "provider")),
    api: optionalString(readModelField(model, "api")),
    baseUrl: optionalString(readModelField(model, "baseUrl")),
    capability: "llm",
    transport,
    modelId: optionalString(readModelField(model, "id")),
    compat: readModelField(model, "compat"),
  });
  if (!capabilities.usesKnownNativeOpenAIRoute) {
    return false;
  }
  return (
    capabilities.provider === "openai" ||
    capabilities.provider === "azure-openai" ||
    capabilities.provider === "azure-openai-responses"
  );
}

/** Resolve the strict-tool setting for one OpenAI-compatible model/transport. */
export function resolveOpenAIStrictToolSetting(
  model: OpenAIStrictToolModel,
  options?: { transport?: OpenAITransportKind; supportsStrictMode?: boolean },
): boolean | undefined {
  if (resolvesToNativeOpenAIStrictTools(model, options?.transport ?? "stream")) {
    return true;
  }
  if (options?.supportsStrictMode) {
    return false;
  }
  return undefined;
}
