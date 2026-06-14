/**
 * Shared tool-call name validation helpers.
 * Keeps model-supplied tool names compact, normalized, and policy-checked
 * before routing them to any tool execution surface.
 */
import { normalizeLowercaseStringOrEmpty } from "@openclaw/normalization-core/string-coerce";

const TOOL_CALL_NAME_MAX_CHARS = 64;
const TOOL_CALL_NAME_RE = /^[A-Za-z0-9_:.-]+$/;
const FUNCTIONS_SPACE_TOOL_CALL_ID_RE = /^functions\s+([A-Za-z0-9_-]+:\d+)$/;
const FUNCTIONS_NAMESPACE_TOOL_NAME_RE = /^functions(?:[.\s]+)([A-Za-z0-9_.-]+)$/i;

/** Normalize the Responses/Kimi functions namespace when a provider serializes it with a space. */
export function normalizeFunctionsToolCallIdPrefix(id: string): string {
  const match = FUNCTIONS_SPACE_TOOL_CALL_ID_RE.exec(id);
  return match ? `functions.${match[1]}` : id;
}

/** Strip the OpenAI Responses functions namespace from a model-facing tool name. */
export function normalizeFunctionsToolNamePrefix(name: string): string | null {
  const match = FUNCTIONS_NAMESPACE_TOOL_NAME_RE.exec(name.trim());
  return match?.[1] ?? null;
}

/** Normalize an optional iterable of allowed tool names for lookup. */
export function normalizeAllowedToolNames(allowedToolNames?: Iterable<string>): Set<string> | null {
  if (!allowedToolNames) {
    return null;
  }
  const normalized = new Set<string>();
  for (const name of allowedToolNames) {
    if (typeof name !== "string") {
      continue;
    }
    const trimmed = name.trim();
    if (!trimmed) {
      continue;
    }
    normalized.add(normalizeLowercaseStringOrEmpty(trimmed));
  }
  return normalized.size > 0 ? normalized : null;
}

/** Return whether a model-supplied tool call name is syntactically and policy allowed. */
export function isAllowedToolCallName(
  name: unknown,
  allowedToolNames: Set<string> | null,
): boolean {
  if (typeof name !== "string") {
    return false;
  }
  const trimmed = name.trim();
  if (!trimmed) {
    return false;
  }
  const normalizedFunctionsName = normalizeFunctionsToolNamePrefix(trimmed);
  const candidateName = normalizedFunctionsName ?? trimmed;
  if (candidateName.length > TOOL_CALL_NAME_MAX_CHARS || !TOOL_CALL_NAME_RE.test(candidateName)) {
    return false;
  }
  if (!allowedToolNames) {
    return true;
  }
  return allowedToolNames.has(normalizeLowercaseStringOrEmpty(candidateName));
}
