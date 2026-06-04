import { randomUUID } from "node:crypto";
import path from "node:path";
import { resolveAgentIdFromSessionKey } from "../../routing/session-key.js";
import { emitSessionTranscriptUpdate } from "../../sessions/transcript-events.js";
import type { SessionTranscriptUpdate } from "../../sessions/transcript-events.js";
import { getRuntimeConfig } from "../io.js";
import type { OpenClawConfig } from "../types.openclaw.js";
import {
  resolveSessionTranscriptPath,
  resolveSessionTranscriptPathInDir,
  resolveStorePath,
} from "./paths.js";
import { resolveAndPersistSessionFile } from "./session-file.js";
import {
  getSessionEntry,
  cleanupSessionLifecycleArtifacts as cleanupFileSessionLifecycleArtifacts,
  listSessionEntries as listFileSessionEntries,
  loadSessionStore,
  patchSessionEntry as patchFileSessionEntry,
  readSessionUpdatedAt as readFileSessionUpdatedAt,
  resolveSessionStoreEntry,
  updateSessionStoreEntry as updateFileSessionStoreEntry,
  type SessionLifecycleArtifactCleanupParams,
  type SessionLifecycleArtifactCleanupResult,
} from "./store.js";
import { parseSessionThreadInfo } from "./thread-info.js";
import {
  appendSessionTranscriptEvent,
  appendSessionTranscriptMessage,
} from "./transcript-append.js";
import { streamSessionTranscriptLines } from "./transcript-stream.js";
import { resolveSessionTranscriptFile } from "./transcript.js";
import type { SessionEntry } from "./types.js";

/**
 * Identifies a session entry within one agent's session store.
 *
 * `sessionKey` is the caller-facing routing key. Accessors may normalize aliases
 * when reading or writing unless the exact-key variant is used. `agentId` and
 * `storePath` are explicit owner hints for callers that already know the target
 * store; otherwise the owner is derived from the session key and runtime config.
 */
export type SessionAccessScope = {
  /** Agent that owns the session store, when the caller already knows it. */
  agentId?: string;
  /** Return the stored object by reference when false; default reads are cloned. */
  clone?: boolean;
  /** Environment used only while resolving the configured session store path. */
  env?: NodeJS.ProcessEnv;
  /** Disable skill prompt hydration for callers that need raw stored fields. */
  hydrateSkillPromptRefs?: boolean;
  /** Session routing key requested by the caller. */
  sessionKey: string;
  /** Explicit store path for scoped tools, tests, or already-resolved callers. */
  storePath?: string;
};

/**
 * Identifies transcript content for read-only access.
 *
 * A read can target a named transcript artifact directly with `sessionFile`, or
 * resolve the artifact from `sessionId` plus store/agent/thread identity. Reads
 * do not require `sessionKey` because historical projections often already have
 * the persisted session id but not the original routing key.
 */
export type SessionTranscriptReadScope = Omit<SessionAccessScope, "sessionKey"> & {
  /** Explicit transcript artifact path for compatibility and import/export callers. */
  sessionFile?: string;
  /** Stable session identifier stored in the session entry and transcript header. */
  sessionId: string;
  /** Routing key when available; used to preserve scoped agent/thread semantics. */
  sessionKey?: string;
  /** Optional thread discriminator for thread-scoped transcript artifacts. */
  threadId?: string | number;
};

/**
 * Identifies transcript content for operations that must also know the session key.
 */
export type SessionTranscriptAccessScope = SessionTranscriptReadScope & {
  sessionKey: string;
};

/**
 * Identifies transcript content for append/update operations.
 *
 * Writers may create or persist the transcript target, so they require
 * `sessionKey` and either an existing `sessionId` or enough entry context for the
 * caller to supply one later. Direct `sessionFile` remains an explicit artifact
 * target, not the normal identity for runtime callers.
 */
export type SessionTranscriptWriteScope = Omit<SessionTranscriptAccessScope, "sessionId"> & {
  sessionId?: string;
};

/** One listed session entry paired with the routing key used to find it. */
export type SessionEntrySummary = {
  sessionKey: string;
  entry: SessionEntry;
};

/**
 * Session entry read by exact persisted key.
 *
 * Use this when the caller must not cross aliases or normalized account/session
 * keys, such as approval routing and account binding decisions.
 */
export type ExactSessionEntry = {
  sessionKey: string;
  entry: SessionEntry;
};

/** Raw transcript record as stored by the transcript append pipeline. */
export type TranscriptEvent = unknown;

/** Options for appending one projected message to a transcript. */
export type TranscriptMessageAppendOptions<TMessage> = {
  /** Runtime config used by message normalization and transcript append helpers. */
  config?: OpenClawConfig;
  /** Working directory for resolving relative media paths in appended messages. */
  cwd?: string;
  /** Idempotency strategy for callers that already performed duplicate checks. */
  idempotencyLookup?: "scan" | "caller-checked";
  /** Message payload to append after optional idempotency preparation. */
  message: TMessage;
  /** Timestamp override for deterministic tests or replayed events. */
  now?: number;
  /** Last chance to transform or drop a message after idempotency checks pass. */
  prepareMessageAfterIdempotencyCheck?: (message: TMessage) => TMessage | undefined;
  /** Preserve raw message bytes when the existing transcript is linear. */
  useRawWhenLinear?: boolean;
};

/** Result returned when a message append either writes or reuses an idempotent hit. */
export type TranscriptMessageAppendResult<TMessage> = {
  appended: boolean;
  message: TMessage;
  messageId: string;
};

/**
 * Transcript update payload supplied by callers.
 *
 * The accessor resolves the concrete transcript artifact before publishing, so
 * callers provide session identity fields and optional update metadata only.
 */
export type TranscriptUpdatePayload = Omit<SessionTranscriptUpdate, "sessionFile">;

/** Options for updating an existing entry without creating a fallback entry. */
export type SessionEntryUpdateOptions = {
  /** Skip pruning or other maintenance work owned by the backing store. */
  skipMaintenance?: boolean;
  /** Let the update take ownership of any store cache invalidation. */
  takeCacheOwnership?: boolean;
};

/** Options for patching or creating one session entry. */
export type SessionEntryPatchOptions = {
  /** Entry to create when the target key does not currently exist. */
  fallbackEntry?: SessionEntry;
  /** Keep the existing activity timestamp unless the patch changes it explicitly. */
  preserveActivity?: boolean;
  /** Replace the entry with the update result instead of merging fields. */
  replaceEntry?: boolean;
};

/** Existing entry snapshot supplied to patch callbacks. */
export type SessionEntryPatchContext = {
  existingEntry?: SessionEntry;
};

export type { SessionLifecycleArtifactCleanupParams, SessionLifecycleArtifactCleanupResult };

/**
 * Loads one session entry.
 *
 * The returned entry follows normal session-key aliasing rules. Pass
 * `clone: false` only for tightly scoped callers that intentionally mutate or
 * compare the live store object; most callers should use the default cloned
 * value.
 */
export function loadSessionEntry(scope: SessionAccessScope): SessionEntry | undefined {
  if (scope.clone === false) {
    const store = loadSessionStore(resolveAccessStorePath(scope), {
      clone: false,
      ...(scope.hydrateSkillPromptRefs === false ? { hydrateSkillPromptRefs: false } : {}),
    });
    return resolveSessionStoreEntry({ store, sessionKey: scope.sessionKey }).existing;
  }
  return getSessionEntry(scope);
}

/**
 * Loads one entry only when the persisted key exactly matches the requested key.
 * Approval routing uses this to avoid canonical alias lookup crossing accounts.
 */
export function loadExactSessionEntry(scope: SessionAccessScope): ExactSessionEntry | undefined {
  const sessionKey = scope.sessionKey.trim();
  if (!sessionKey) {
    return undefined;
  }
  const store = loadSessionStore(resolveAccessStorePath(scope), {
    ...(scope.clone === false ? { clone: false } : {}),
    ...(scope.hydrateSkillPromptRefs === false ? { hydrateSkillPromptRefs: false } : {}),
  });
  const entry = Object.hasOwn(store, sessionKey) ? store[sessionKey] : undefined;
  return entry ? { sessionKey, entry } : undefined;
}

/**
 * Lists all session entries visible in the resolved store.
 *
 * Each result includes the persisted routing key so callers can preserve the
 * exact key in UI projections, maintenance tasks, and export surfaces.
 */
export function listSessionEntries(
  scope: Partial<Omit<SessionAccessScope, "sessionKey">> = {},
): SessionEntrySummary[] {
  if (scope.clone === false) {
    return Object.entries(
      loadSessionStore(resolveAccessStorePath({ ...scope, sessionKey: "" }), {
        clone: false,
        ...(scope.hydrateSkillPromptRefs === false ? { hydrateSkillPromptRefs: false } : {}),
      }),
    ).map(([sessionKey, entry]) => ({ sessionKey, entry }));
  }
  return listFileSessionEntries(scope);
}

/**
 * Reads the stored session activity timestamp without requiring a full entry projection.
 */
export function readSessionUpdatedAt(scope: SessionAccessScope): number | undefined {
  if (scope.storePath) {
    return readFileSessionUpdatedAt({
      storePath: scope.storePath,
      sessionKey: scope.sessionKey,
    });
  }
  return loadSessionEntry(scope)?.updatedAt;
}

/**
 * Creates or patches one session entry by merging a partial update.
 *
 * Missing entries are created from the supplied patch, including a generated
 * `sessionId` and current `updatedAt` when the patch does not provide them.
 */
export async function upsertSessionEntry(
  scope: SessionAccessScope,
  patch: Partial<SessionEntry>,
): Promise<SessionEntry | null> {
  return await patchFileSessionEntry({
    ...scope,
    fallbackEntry: createFallbackSessionEntry(patch),
    update: () => patch,
  });
}

/**
 * Creates or replaces one session entry with the supplied entry shape.
 */
export async function replaceSessionEntry(
  scope: SessionAccessScope,
  entry: SessionEntry,
): Promise<SessionEntry | null> {
  return await patchFileSessionEntry({
    ...scope,
    fallbackEntry: entry,
    replaceEntry: true,
    update: () => entry,
  });
}

/**
 * Applies a callback-driven patch to one session entry.
 *
 * The callback receives the current entry and may return a partial update, a
 * replacement entry when `replaceEntry` is true, or `null` to leave the entry
 * unchanged. Store-level locking and timestamp handling are owned by the
 * backing implementation.
 */
export async function patchSessionEntry(
  scope: SessionAccessScope,
  update: (
    entry: SessionEntry,
    context: SessionEntryPatchContext,
  ) => Promise<Partial<SessionEntry> | null> | Partial<SessionEntry> | null,
  options: SessionEntryPatchOptions = {},
): Promise<SessionEntry | null> {
  return await patchFileSessionEntry({
    ...scope,
    fallbackEntry: options.fallbackEntry,
    preserveActivity: options.preserveActivity,
    replaceEntry: options.replaceEntry,
    update,
  });
}

/**
 * Updates an existing session entry without creating a fallback entry.
 *
 * Use this when absence is meaningful and the caller should not materialize a
 * new session row. The update callback returns `null` to leave the entry
 * unchanged.
 */
export async function updateSessionEntry(
  scope: SessionAccessScope,
  update: (
    entry: SessionEntry,
  ) => Promise<Partial<SessionEntry> | null> | Partial<SessionEntry> | null,
  options: SessionEntryUpdateOptions = {},
): Promise<SessionEntry | null> {
  return await updateFileSessionStoreEntry({
    storePath: resolveAccessStorePath(scope),
    sessionKey: scope.sessionKey,
    skipMaintenance: options.skipMaintenance,
    takeCacheOwnership: options.takeCacheOwnership,
    update,
  });
}

/**
 * Removes lifecycle-owned session records and transcript artifacts for one scoped target.
 *
 * This operation is for owner-managed cleanup such as reset, archive, delete,
 * or temporary run/session reclamation. It must stay scoped to the requested
 * session identity and report what was removed so callers can make cleanup
 * idempotent.
 */
export async function cleanupSessionLifecycleArtifacts(
  params: SessionLifecycleArtifactCleanupParams,
): Promise<SessionLifecycleArtifactCleanupResult> {
  return await cleanupFileSessionLifecycleArtifacts(params);
}

/**
 * Loads raw transcript events for a resolved transcript target.
 *
 * This is intentionally an event-level API: callers that need projected chat
 * messages should use the transcript reader helpers that preserve projection,
 * bounding, and visibility rules.
 */
export async function loadTranscriptEvents(
  scope: SessionTranscriptReadScope,
): Promise<TranscriptEvent[]> {
  const transcript = await resolveTranscriptReadAccess(scope);
  const events: TranscriptEvent[] = [];
  for await (const line of streamSessionTranscriptLines(transcript.sessionFile)) {
    events.push(JSON.parse(line) as TranscriptEvent);
  }
  return events;
}

/**
 * Appends one raw transcript event to the resolved transcript target.
 *
 * Prefer `appendTranscriptMessage` for normal assistant/user message writes so
 * idempotency and message normalization remain centralized.
 */
export async function appendTranscriptEvent(
  scope: SessionTranscriptAccessScope,
  event: TranscriptEvent,
): Promise<void> {
  const transcript = await resolveTranscriptAccess(scope);
  await appendSessionTranscriptEvent({
    event,
    transcriptPath: transcript.sessionFile,
  });
}

/**
 * Appends one projected transcript message to the resolved transcript target.
 *
 * The overload with `prepareMessageAfterIdempotencyCheck` may return
 * `undefined` when the preparation callback drops the message. Without that
 * callback, successful calls always return the appended or idempotently reused
 * message result.
 */
export async function appendTranscriptMessage<TMessage>(
  scope: SessionTranscriptWriteScope,
  options: TranscriptMessageAppendOptions<TMessage> & {
    prepareMessageAfterIdempotencyCheck: (message: TMessage) => TMessage | undefined;
  },
): Promise<TranscriptMessageAppendResult<TMessage> | undefined>;
export async function appendTranscriptMessage<TMessage>(
  scope: SessionTranscriptWriteScope,
  options: TranscriptMessageAppendOptions<TMessage>,
): Promise<TranscriptMessageAppendResult<TMessage>>;
export async function appendTranscriptMessage<TMessage>(
  scope: SessionTranscriptWriteScope,
  options: TranscriptMessageAppendOptions<TMessage>,
): Promise<TranscriptMessageAppendResult<TMessage> | undefined> {
  const transcript = await resolveTranscriptAccess(scope);
  return await appendSessionTranscriptMessage({
    transcriptPath: transcript.sessionFile,
    message: options.message,
    ...(scope.sessionId ? { sessionId: scope.sessionId } : {}),
    ...(options.cwd ? { cwd: options.cwd } : {}),
    ...(options.config ? { config: options.config } : {}),
    ...(options.idempotencyLookup ? { idempotencyLookup: options.idempotencyLookup } : {}),
    ...(options.now !== undefined ? { now: options.now } : {}),
    ...(options.prepareMessageAfterIdempotencyCheck
      ? { prepareMessageAfterIdempotencyCheck: options.prepareMessageAfterIdempotencyCheck }
      : {}),
    ...(options.useRawWhenLinear !== undefined
      ? { useRawWhenLinear: options.useRawWhenLinear }
      : {}),
  });
}

/**
 * Publishes a transcript update for subscribers of the resolved transcript target.
 *
 * Callers provide storage-neutral identity and update metadata. The accessor
 * resolves the concrete transcript artifact needed by current subscribers and
 * includes it in the emitted event.
 */
export async function publishTranscriptUpdate(
  scope: SessionTranscriptWriteScope,
  update: TranscriptUpdatePayload = {},
): Promise<void> {
  const transcript = await resolveTranscriptAccess(scope);
  emitSessionTranscriptUpdate({
    ...update,
    sessionFile: transcript.sessionFile,
  });
}

function createFallbackSessionEntry(patch: Partial<SessionEntry>): SessionEntry {
  const now = Date.now();
  return {
    sessionId: patch.sessionId ?? randomUUID(),
    updatedAt: patch.updatedAt ?? now,
    ...patch,
  };
}

function resolveAccessStorePath(scope: SessionAccessScope): string {
  if (scope.storePath) {
    return scope.storePath;
  }
  const agentId = scope.agentId ?? resolveAgentIdFromSessionKey(scope.sessionKey);
  return resolveStorePath(getRuntimeConfig().session?.store, {
    agentId,
    env: scope.env,
  });
}

async function resolveTranscriptReadAccess(scope: SessionTranscriptReadScope): Promise<{
  sessionFile: string;
}> {
  if (scope.sessionFile?.trim()) {
    return { sessionFile: scope.sessionFile };
  }
  if (scope.sessionKey) {
    return await resolveTranscriptAccess({ ...scope, sessionKey: scope.sessionKey });
  }
  if (scope.storePath) {
    return {
      sessionFile: resolveSessionTranscriptPathInDir(
        scope.sessionId,
        path.dirname(path.resolve(scope.storePath)),
        scope.threadId,
      ),
    };
  }
  if (scope.agentId) {
    return {
      sessionFile: resolveSessionTranscriptPath(scope.sessionId, scope.agentId, scope.threadId),
    };
  }
  throw new Error(`Cannot resolve transcript read scope without a session target`);
}

async function resolveTranscriptAccess(scope: SessionTranscriptWriteScope): Promise<{
  sessionFile: string;
}> {
  if (scope.sessionFile?.trim()) {
    return { sessionFile: scope.sessionFile };
  }
  if (!scope.sessionId) {
    throw new Error(`Cannot resolve transcript scope without a session id: ${scope.sessionKey}`);
  }
  const agentId = scope.agentId ?? resolveAgentIdFromSessionKey(scope.sessionKey);
  if (!agentId) {
    throw new Error(`Cannot resolve transcript scope without an agent id: ${scope.sessionKey}`);
  }
  const sessionStore = scope.storePath
    ? loadSessionStore(scope.storePath, { skipCache: true })
    : undefined;
  const resolvedStoreEntry = sessionStore
    ? resolveSessionStoreEntry({ store: sessionStore, sessionKey: scope.sessionKey })
    : undefined;
  const sessionEntry = resolvedStoreEntry?.existing ?? loadSessionEntry(scope);
  const sessionKey = resolvedStoreEntry?.normalizedKey ?? scope.sessionKey;
  if (sessionStore && scope.storePath) {
    const sessionsDir = path.dirname(path.resolve(scope.storePath));
    const threadId = scope.threadId ?? parseSessionThreadInfo(scope.sessionKey).threadId;
    const fallbackSessionFile =
      !sessionEntry?.sessionFile && threadId !== undefined
        ? resolveSessionTranscriptPathInDir(scope.sessionId, sessionsDir, threadId)
        : undefined;
    return await resolveAndPersistSessionFile({
      agentId,
      fallbackSessionFile,
      sessionEntry,
      sessionId: scope.sessionId,
      sessionKey,
      sessionStore,
      sessionsDir,
      storePath: scope.storePath,
    });
  }
  return await resolveSessionTranscriptFile({
    agentId,
    sessionEntry,
    sessionId: scope.sessionId,
    sessionKey: scope.sessionKey,
    ...(sessionStore ? { sessionStore } : {}),
    ...(scope.storePath ? { storePath: scope.storePath } : {}),
    ...(scope.threadId !== undefined ? { threadId: scope.threadId } : {}),
  });
}
