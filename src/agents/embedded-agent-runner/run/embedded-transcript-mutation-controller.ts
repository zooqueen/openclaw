/**
 * Central mutation boundary for embedded-run transcript writes.
 *
 * Embedded attempts release their broad session lock while provider I/O is in
 * flight. Any OpenClaw-owned transcript mutation during that window must also
 * publish the owned file fingerprint, otherwise the prompt fence will mistake
 * OpenClaw's own write for an external takeover.
 */
import type { guardSessionManager } from "../../session-tool-result-guard-wrapper.js";

type SessionWriteLockOptions = {
  publishOwnedWrite?: boolean;
};

type WithSessionWriteLock = <T>(
  operation: () => Promise<T> | T,
  options?: SessionWriteLockOptions,
) => Promise<T>;

export type EmbeddedTranscriptMutationReason =
  | "agent-steering"
  | "before-agent-run-block"
  | "bootstrap-completion"
  | "context-engine-maintenance"
  | "google-prompt-cache"
  | "mid-turn-precheck"
  | "orphan-user-repair"
  | "post-prompt-attempt-state"
  | "prompt-error"
  | "session-yield-cleanup";

export type EmbeddedTranscriptSessionManager = ReturnType<typeof guardSessionManager>;

export type EmbeddedTranscriptMutationController = {
  run<T>(
    reason: EmbeddedTranscriptMutationReason,
    operation: (sessionManager: EmbeddedTranscriptSessionManager) => Promise<T> | T,
    options?: { refreshActiveSessionState?: boolean },
  ): Promise<T>;
};

export function createEmbeddedTranscriptMutationController(params: {
  sessionManager: EmbeddedTranscriptSessionManager;
  withSessionWriteLock: WithSessionWriteLock;
  refreshActiveSessionState?: () => void;
}): EmbeddedTranscriptMutationController {
  return {
    async run(reason, operation, options) {
      void reason;
      return await params.withSessionWriteLock(
        async () => {
          const result = await operation(params.sessionManager);
          if (options?.refreshActiveSessionState !== false) {
            params.refreshActiveSessionState?.();
          }
          return result;
        },
        { publishOwnedWrite: true },
      );
    },
  };
}
