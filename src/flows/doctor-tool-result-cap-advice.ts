/**
 * Doctor advisory for the live tool-result character cap.
 *
 * The runtime keeps tool results bounded via
 * `agents.defaults.contextLimits.toolResultMaxChars` (see
 * `src/agents/pi-embedded-runner/tool-result-truncation.ts`). The schema
 * default is 16,000 chars, which is conservative for frontier models with
 * 100K+ context windows. The runtime additionally clamps the effective cap to
 * roughly 30% of the primary model's context window, so the configurable knob
 * is a ceiling, not a floor.
 *
 * This helper is a pure decision function: given the resolved facts (configured
 * cap, default cap, primary model context window), it returns advisory lines
 * for `openclaw doctor` to surface, or an empty array when no advice applies.
 */

export type ToolResultCapAdviceInput = {
  /** What the user explicitly configured, or undefined when they haven't. */
  configuredCap: number | undefined;
  /** The compiled-in default cap (currently 16_000). */
  defaultCap: number;
  /** The schema's hard upper bound on `toolResultMaxChars` (currently 250_000). */
  schemaMaxCap: number;
  /** Primary configured model's context window in tokens, when known. */
  primaryModelContextWindow: number | undefined;
  /** Human-readable primary model key (e.g. "anthropic/claude-opus-4-7"). */
  primaryModelKey: string | undefined;
};

/**
 * Tokens. Below this, the 16K default is reasonable and we stay quiet to
 * avoid nagging operators on small-context local models.
 */
const ADVISE_CONTEXT_WINDOW_THRESHOLD_TOKENS = 100_000;

/**
 * Suggested values are 4 * tokens * share, rounded down to a friendly number.
 * We never advise above `schemaMaxCap` and never above the runtime 30% share
 * because the runtime already clamps to that share anyway.
 */
const RUNTIME_TOOL_RESULT_CONTEXT_SHARE = 0.3;
const CHARS_PER_TOKEN = 4;
const SUGGESTION_FRACTION_OF_RUNTIME_SHARE = 0.5;

function suggestCap(input: { contextWindowTokens: number; schemaMaxCap: number }): number {
  const runtimeShareChars = Math.floor(
    input.contextWindowTokens * RUNTIME_TOOL_RESULT_CONTEXT_SHARE * CHARS_PER_TOKEN,
  );
  const friendlyChars = Math.floor(runtimeShareChars * SUGGESTION_FRACTION_OF_RUNTIME_SHARE);
  const rounded = Math.max(32_000, Math.round(friendlyChars / 16_000) * 16_000);
  return Math.min(rounded, input.schemaMaxCap);
}

export function formatToolResultCapAdvice(input: ToolResultCapAdviceInput): string[] {
  // The user already made an explicit choice; never override their decision
  // with a recommendation that ignores their context.
  if (typeof input.configuredCap === "number") {
    return [];
  }

  // Without a known context window we cannot tell whether 16K is small or
  // appropriate, so stay quiet rather than guess.
  if (typeof input.primaryModelContextWindow !== "number" || input.primaryModelContextWindow <= 0) {
    return [];
  }

  // For small-context models, the 16K default already exceeds the runtime's
  // 30%-of-context-window share, so raising it would have no effect.
  if (input.primaryModelContextWindow < ADVISE_CONTEXT_WINDOW_THRESHOLD_TOKENS) {
    return [];
  }

  const suggested = suggestCap({
    contextWindowTokens: input.primaryModelContextWindow,
    schemaMaxCap: input.schemaMaxCap,
  });

  const modelLabel = input.primaryModelKey ? `"${input.primaryModelKey}"` : "primary model";
  const contextLabel = formatTokenCount(input.primaryModelContextWindow);
  const defaultLabel = formatCharCount(input.defaultCap);
  const suggestedLabel = formatCharCount(suggested);
  const schemaLabel = formatCharCount(input.schemaMaxCap);

  return [
    `- ${modelLabel} has a ${contextLabel} context window but agents.defaults.contextLimits.toolResultMaxChars is at the ${defaultLabel} default.`,
    `  A single tool result is also runtime-capped to ~30% of the model context window, so values around ${suggestedLabel} are typical for frontier models (schema max ${schemaLabel}).`,
    `  To raise it, edit agents.defaults.contextLimits.toolResultMaxChars in your openclaw.json.`,
  ];
}

function formatTokenCount(tokens: number): string {
  if (tokens >= 1_000_000 && tokens % 1_000_000 === 0) {
    return `${tokens / 1_000_000}M`;
  }
  if (tokens >= 1_000) {
    const k = tokens / 1_000;
    return Number.isInteger(k) ? `${k}K` : `${k.toFixed(1)}K`;
  }
  return `${tokens}`;
}

function formatCharCount(chars: number): string {
  if (chars >= 1_000) {
    const k = chars / 1_000;
    return Number.isInteger(k) ? `${k}K` : `${k.toFixed(1)}K`;
  }
  return `${chars}`;
}
