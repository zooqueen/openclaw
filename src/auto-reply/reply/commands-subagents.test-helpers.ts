import type { InlineDirectives } from "./directive-handling.js";

export function createEmptyInlineDirectives(): InlineDirectives {
  return {
    cleaned: "",
    hasThinkDirective: false,
    clearThinkLevel: false,
    hasVerboseDirective: false,
    hasFastDirective: false,
    clearFastMode: false,
    hasReasoningDirective: false,
    hasTraceDirective: false,
    hasElevatedDirective: false,
    hasExecDirective: false,
    hasExecOptions: false,
    invalidExecHost: false,
    invalidExecMode: false,
    invalidExecSecurity: false,
    invalidExecAsk: false,
    invalidExecNode: false,
    invalidExecPolicyCombination: false,
    hasStatusDirective: false,
    hasModelDirective: false,
    hasQueueDirective: false,
    queueReset: false,
    hasQueueOptions: false,
  };
}
