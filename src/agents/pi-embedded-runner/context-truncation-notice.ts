export const CONTEXT_LIMIT_TRUNCATION_NOTICE = "more characters truncated";

/**
 * Actionable hint appended to truncation notices so model and operator can see
 * which canonical config path raises the live tool-result cap. Keeping this
 * close to the marker means the recovery instruction lives next to the symptom
 * in the model-facing transcript, not only in operator docs.
 */
export const CONTEXT_LIMIT_TRUNCATION_HINT =
  "raise agents.defaults.contextLimits.toolResultMaxChars to keep more";

export function formatContextLimitTruncationNotice(truncatedChars: number): string {
  const chars = Math.max(1, Math.floor(truncatedChars));
  return `[... ${chars} ${CONTEXT_LIMIT_TRUNCATION_NOTICE}; ${CONTEXT_LIMIT_TRUNCATION_HINT}]`;
}
