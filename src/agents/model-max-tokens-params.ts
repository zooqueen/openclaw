/**
 * Max-token parameter normalization across provider/native naming variants.
 * Callers canonicalize aliases before dispatch so payloads cannot carry
 * conflicting limits.
 */
const MAX_TOKENS_PARAM_KEYS = ["maxTokens", "max_completion_tokens", "max_tokens"] as const;

/** Return a finite non-negative max-token value, or undefined for invalid input. */
export function resolveNonNegativeMaxTokensParam(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function readMaxTokensParamValue(
  params: Record<string, unknown>,
  key: (typeof MAX_TOKENS_PARAM_KEYS)[number],
): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(params, key);
  return descriptor && "value" in descriptor ? descriptor.value : undefined;
}

function removeMaxTokensParam(
  params: Record<string, unknown>,
  key: (typeof MAX_TOKENS_PARAM_KEYS)[number],
): void {
  try {
    delete params[key];
  } catch {
    throw new Error(`max-token parameter could not be removed: ${key}`);
  }
  if (Object.hasOwn(params, key)) {
    throw new Error(`max-token parameter could not be removed: ${key}`);
  }
}

/** Resolve the first supported max-token parameter present in a params object. */
export function resolveMaxTokensParam(
  params: Record<string, unknown> | undefined,
): number | undefined {
  if (!params) {
    return undefined;
  }
  for (const key of MAX_TOKENS_PARAM_KEYS) {
    const resolved = resolveNonNegativeMaxTokensParam(readMaxTokensParamValue(params, key));
    if (resolved !== undefined) {
      return resolved;
    }
  }
  return undefined;
}

/**
 * Canonicalize merged params to `maxTokens`, preserving source precedence from
 * left to right across the provided source objects.
 */
export function canonicalizeMaxTokensParam(params: {
  merged: Record<string, unknown>;
  sources: Array<Record<string, unknown> | undefined>;
}): void {
  let resolved: number | undefined;
  for (const source of params.sources) {
    const sourceValue = resolveMaxTokensParam(source);
    if (sourceValue !== undefined) {
      resolved = sourceValue;
    }
  }
  if (resolved === undefined) {
    return;
  }
  // Delete every spelling before writing the canonical key so callers cannot
  // send conflicting provider aliases in one payload.
  for (const key of MAX_TOKENS_PARAM_KEYS) {
    removeMaxTokensParam(params.merged, key);
  }
  Object.defineProperty(params.merged, "maxTokens", {
    configurable: true,
    enumerable: true,
    value: resolved,
    writable: true,
  });
}
