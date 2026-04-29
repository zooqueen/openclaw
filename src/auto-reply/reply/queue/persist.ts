import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { resolveStateDir } from "../../../config/paths.js";
import { normalizeOptionalString } from "../../../shared/string-coerce.js";
import { clearFollowupDrainCallback, scheduleFollowupDrain } from "./drain.js";
import { FOLLOWUP_QUEUES, getFollowupQueue } from "./state.js";
import type { FollowupRun, QueueDropPolicy, QueueMode } from "./types.js";

const PERSISTED_FOLLOWUP_QUEUE_VERSION = 1;
const SNAPSHOT_DIRNAME = "followup-queue-restart";
const SNAPSHOT_FILE_SUFFIX = ".json";
const MAX_PERSISTED_QUEUE_ITEMS = 1_000;
const MAX_PERSISTED_SUMMARY_LINES = 1_000;

type FollowupQueuePersistenceLog = {
  warn?: (message: string) => void;
};

export type PersistedFollowupQueueSnapshot = {
  version: typeof PERSISTED_FOLLOWUP_QUEUE_VERSION;
  key: string;
  savedAt: number;
  mode: QueueMode;
  debounceMs: number;
  cap: number;
  dropPolicy: QueueDropPolicy;
  lastEnqueuedAt: number;
  droppedCount: number;
  summaryLines: string[];
  lastRun?: FollowupRun["run"];
  items: FollowupRun[];
};

export type PersistFollowupQueuesResult = {
  persistedQueues: number;
  persistedItems: number;
};

export type RecoverPersistedFollowupQueuesResult = {
  recoveredQueues: number;
  recoveredItems: number;
  malformedFiles: number;
};

const queueModeSchema = z.enum([
  "steer",
  "followup",
  "collect",
  "steer-backlog",
  "interrupt",
  "queue",
]);

const queueDropPolicySchema = z.enum(["old", "new", "summarize"]);

const jsonObjectSchema = z.record(z.string(), z.unknown());

const followupRunRuntimeSchema = z
  .object({
    agentId: z.string().min(1),
    agentDir: z.string().min(1),
    sessionId: z.string().min(1),
    sessionKey: z.string().optional(),
    runtimePolicySessionKey: z.string().optional(),
    messageProvider: z.string().optional(),
    agentAccountId: z.string().optional(),
    groupId: z.string().optional(),
    groupChannel: z.string().optional(),
    groupSpace: z.string().optional(),
    senderId: z.string().optional(),
    senderName: z.string().optional(),
    senderUsername: z.string().optional(),
    senderE164: z.string().optional(),
    senderIsOwner: z.boolean().optional(),
    traceAuthorized: z.boolean().optional(),
    sessionFile: z.string().min(1),
    workspaceDir: z.string().min(1),
    config: jsonObjectSchema,
    skillsSnapshot: z.unknown().optional(),
    provider: z.string().min(1),
    model: z.string().min(1),
    hasSessionModelOverride: z.boolean().optional(),
    modelOverrideSource: z.enum(["auto", "user"]).optional(),
    authProfileId: z.string().optional(),
    authProfileIdSource: z.enum(["auto", "user"]).optional(),
    thinkLevel: z.string().optional(),
    verboseLevel: z.string().optional(),
    reasoningLevel: z.string().optional(),
    elevatedLevel: z.string().optional(),
    execOverrides: z
      .object({
        host: z.string().optional(),
        security: z.string().optional(),
        ask: z.string().optional(),
        node: z.string().optional(),
      })
      .passthrough()
      .optional(),
    bashElevated: z
      .object({
        enabled: z.boolean(),
        allowed: z.boolean(),
        defaultLevel: z.string(),
      })
      .passthrough()
      .optional(),
    timeoutMs: z.number().finite().nonnegative(),
    blockReplyBreak: z.enum(["text_end", "message_end"]),
    ownerNumbers: z.array(z.string()).optional(),
    inputProvenance: z.unknown().optional(),
    extraSystemPrompt: z.string().optional(),
    sourceReplyDeliveryMode: z.string().optional(),
    silentReplyPromptMode: z.string().optional(),
    extraSystemPromptStatic: z.string().optional(),
    enforceFinalTag: z.boolean().optional(),
    skipProviderRuntimeHints: z.boolean().optional(),
    silentExpected: z.boolean().optional(),
    allowEmptyAssistantReplyAsSilent: z.boolean().optional(),
  })
  .passthrough();

const followupRunSchema = z
  .object({
    prompt: z.string(),
    transcriptPrompt: z.string().optional(),
    messageId: z.string().optional(),
    summaryLine: z.string().optional(),
    enqueuedAt: z.number().finite().nonnegative(),
    images: z
      .array(
        z.object({
          type: z.literal("image"),
          data: z.string(),
          mimeType: z.string(),
        }),
      )
      .optional(),
    imageOrder: z.array(z.enum(["inline", "offloaded"])).optional(),
    originatingChannel: z.string().optional(),
    originatingTo: z.string().optional(),
    originatingAccountId: z.string().optional(),
    originatingThreadId: z.union([z.string(), z.number()]).optional(),
    originatingChatType: z.string().optional(),
    run: followupRunRuntimeSchema,
  })
  .passthrough();

const persistedFollowupQueueSnapshotSchema = z.object({
  version: z.literal(PERSISTED_FOLLOWUP_QUEUE_VERSION),
  key: z.string().min(1),
  savedAt: z.number().finite().nonnegative(),
  mode: queueModeSchema,
  debounceMs: z.number().finite().nonnegative(),
  cap: z.number().finite().int().positive(),
  dropPolicy: queueDropPolicySchema,
  lastEnqueuedAt: z.number().finite().nonnegative(),
  droppedCount: z.number().finite().int().nonnegative(),
  summaryLines: z.array(z.string()).max(MAX_PERSISTED_SUMMARY_LINES),
  lastRun: followupRunRuntimeSchema.optional(),
  items: z.array(followupRunSchema).max(MAX_PERSISTED_QUEUE_ITEMS),
});

function getErrnoCode(err: unknown): string | null {
  return err && typeof err === "object" && "code" in err
    ? String((err as { code?: unknown }).code)
    : null;
}

function warn(log: FollowupQueuePersistenceLog | undefined, message: string): void {
  log?.warn?.(message);
}

async function unlinkBestEffort(filePath: string): Promise<void> {
  await fs.promises.unlink(filePath).catch(() => undefined);
}

async function writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
  const tmpPath = `${filePath}.${process.pid}.tmp`;
  await fs.promises.writeFile(tmpPath, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf-8",
    mode: 0o600,
  });
  await fs.promises.rename(tmpPath, filePath);
}

function snapshotFileNameForKey(key: string): string {
  const digest = createHash("sha256").update(key).digest("hex").slice(0, 32);
  return `${digest}${SNAPSHOT_FILE_SUFFIX}`;
}

async function listSnapshotFiles(queueDir: string): Promise<string[]> {
  let files: string[];
  try {
    files = await fs.promises.readdir(queueDir);
  } catch (err) {
    if (getErrnoCode(err) === "ENOENT") {
      return [];
    }
    throw err;
  }
  return files
    .filter((file) => file.endsWith(SNAPSHOT_FILE_SUFFIX))
    .map((file) => path.join(queueDir, file))
    .toSorted();
}

export function resolvePersistedFollowupQueueDir(stateDir?: string): string {
  return path.join(stateDir ?? resolveStateDir(), SNAPSHOT_DIRNAME);
}

export function buildPersistedFollowupQueueSnapshots(
  savedAt: number = Date.now(),
): PersistedFollowupQueueSnapshot[] {
  const snapshots: PersistedFollowupQueueSnapshot[] = [];
  const entries = [...FOLLOWUP_QUEUES.entries()].toSorted(([left], [right]) =>
    left.localeCompare(right),
  );
  for (const [key, queue] of entries) {
    const cleanedKey = normalizeOptionalString(key);
    if (!cleanedKey) {
      continue;
    }
    const items = [...queue.items];
    const hasReplayableSummary = queue.droppedCount > 0 && Boolean(queue.lastRun ?? items.at(-1));
    if (items.length === 0 && !hasReplayableSummary) {
      continue;
    }
    snapshots.push({
      version: PERSISTED_FOLLOWUP_QUEUE_VERSION,
      key: cleanedKey,
      savedAt,
      mode: queue.mode,
      debounceMs: Math.max(0, queue.debounceMs),
      cap: Math.max(1, Math.floor(queue.cap)),
      dropPolicy: queue.dropPolicy,
      lastEnqueuedAt: Math.max(0, queue.lastEnqueuedAt),
      droppedCount: Math.max(0, Math.floor(queue.droppedCount)),
      summaryLines: [...queue.summaryLines],
      ...(queue.lastRun ? { lastRun: queue.lastRun } : {}),
      items,
    });
  }
  return snapshots;
}

export async function persistFollowupQueuesForRestart(params?: {
  stateDir?: string;
  log?: FollowupQueuePersistenceLog;
}): Promise<PersistFollowupQueuesResult> {
  const queueDir = resolvePersistedFollowupQueueDir(params?.stateDir);
  const snapshots = buildPersistedFollowupQueueSnapshots();
  const persistedItems = snapshots.reduce((sum, snapshot) => sum + snapshot.items.length, 0);
  if (snapshots.length === 0) {
    for (const filePath of await listSnapshotFiles(queueDir)) {
      await unlinkBestEffort(filePath);
    }
    return { persistedQueues: 0, persistedItems: 0 };
  }

  await fs.promises.mkdir(queueDir, { recursive: true, mode: 0o700 });
  const desiredFiles = new Set<string>();
  for (const snapshot of snapshots) {
    const filePath = path.join(queueDir, snapshotFileNameForKey(snapshot.key));
    desiredFiles.add(filePath);
    await writeJsonAtomic(filePath, snapshot);
  }
  for (const filePath of await listSnapshotFiles(queueDir)) {
    if (!desiredFiles.has(filePath)) {
      await unlinkBestEffort(filePath);
    }
  }
  return { persistedQueues: snapshots.length, persistedItems };
}

function parsePersistedFollowupQueueSnapshot(raw: unknown): PersistedFollowupQueueSnapshot | null {
  const parsed = persistedFollowupQueueSnapshotSchema.safeParse(raw);
  if (!parsed.success) {
    return null;
  }
  const snapshot = parsed.data as PersistedFollowupQueueSnapshot;
  if (snapshot.items.length === 0 && snapshot.droppedCount === 0) {
    return null;
  }
  if (snapshot.items.length === 0 && snapshot.droppedCount > 0 && !snapshot.lastRun) {
    return null;
  }
  return snapshot;
}

async function readPersistedFollowupQueueSnapshot(filePath: string): Promise<{
  snapshot: PersistedFollowupQueueSnapshot | null;
  malformed: boolean;
}> {
  try {
    const raw = JSON.parse(await fs.promises.readFile(filePath, "utf-8")) as unknown;
    const snapshot = parsePersistedFollowupQueueSnapshot(raw);
    return { snapshot, malformed: !snapshot };
  } catch {
    return { snapshot: null, malformed: true };
  }
}

export async function loadPersistedFollowupQueueSnapshots(params?: {
  stateDir?: string;
  log?: FollowupQueuePersistenceLog;
}): Promise<{ snapshots: PersistedFollowupQueueSnapshot[]; malformedFiles: number }> {
  const queueDir = resolvePersistedFollowupQueueDir(params?.stateDir);
  const snapshots: PersistedFollowupQueueSnapshot[] = [];
  let malformedFiles = 0;
  for (const filePath of await listSnapshotFiles(queueDir)) {
    const { snapshot, malformed } = await readPersistedFollowupQueueSnapshot(filePath);
    if (!snapshot) {
      if (malformed) {
        malformedFiles++;
        warn(
          params?.log,
          `ignored malformed followup queue restart snapshot: ${path.basename(filePath)}`,
        );
      }
      continue;
    }
    snapshots.push(snapshot);
  }
  return {
    snapshots: snapshots.toSorted((left, right) => left.key.localeCompare(right.key)),
    malformedFiles,
  };
}

export function restorePersistedFollowupQueueSnapshot(
  snapshot: PersistedFollowupQueueSnapshot,
): void {
  const queue = getFollowupQueue(snapshot.key, {
    mode: snapshot.mode,
    debounceMs: snapshot.debounceMs,
    cap: snapshot.cap,
    dropPolicy: snapshot.dropPolicy,
  });
  queue.draining = false;
  queue.lastEnqueuedAt = snapshot.lastEnqueuedAt;
  queue.mode = snapshot.mode;
  queue.debounceMs = snapshot.debounceMs;
  queue.cap = snapshot.cap;
  queue.dropPolicy = snapshot.dropPolicy;
  queue.droppedCount = snapshot.droppedCount;
  queue.summaryLines = [...snapshot.summaryLines];
  queue.lastRun = snapshot.lastRun ?? snapshot.items.at(-1)?.run;
  queue.items = [...snapshot.items];
  clearFollowupDrainCallback(snapshot.key);
}

function inferSessionStorePath(run: FollowupRun["run"]): string | undefined {
  const sessionFile = normalizeOptionalString(run.sessionFile);
  if (!sessionFile) {
    return undefined;
  }
  return path.join(path.dirname(sessionFile), "sessions.json");
}

function createRecoveredFollowupRunner(log?: FollowupQueuePersistenceLog) {
  return async (queued: FollowupRun): Promise<void> => {
    const [{ createFollowupRunner }, { createTypingController }, { loadSessionStore }] =
      await Promise.all([
        import("../followup-runner.js"),
        import("../typing.js"),
        import("../../../config/sessions.js"),
      ]);
    const storePath = inferSessionStorePath(queued.run);
    let sessionStore: ReturnType<typeof loadSessionStore> | undefined;
    if (storePath) {
      try {
        sessionStore = loadSessionStore(storePath);
      } catch (err) {
        warn(log, `followup queue recovery could not load session store: ${String(err)}`);
      }
    }
    const sessionKey = queued.run.sessionKey;
    const sessionEntry = sessionKey ? sessionStore?.[sessionKey] : undefined;
    const runner = createFollowupRunner({
      typing: createTypingController({}),
      typingMode: "never",
      sessionKey,
      storePath,
      sessionStore,
      sessionEntry,
      defaultModel: queued.run.model,
    });
    await runner(queued);
  };
}

export async function recoverPersistedFollowupQueuesForRestart(params?: {
  stateDir?: string;
  log?: FollowupQueuePersistenceLog;
  createRunFollowup?: (
    snapshot: PersistedFollowupQueueSnapshot,
  ) => (run: FollowupRun) => Promise<void>;
  scheduleDrain?: typeof scheduleFollowupDrain;
}): Promise<RecoverPersistedFollowupQueuesResult> {
  const queueDir = resolvePersistedFollowupQueueDir(params?.stateDir);
  let recoveredQueues = 0;
  let recoveredItems = 0;
  let malformedFiles = 0;
  const scheduleDrain = params?.scheduleDrain ?? scheduleFollowupDrain;
  for (const filePath of await listSnapshotFiles(queueDir)) {
    const { snapshot, malformed } = await readPersistedFollowupQueueSnapshot(filePath);
    if (!snapshot) {
      if (malformed) {
        malformedFiles++;
        warn(
          params?.log,
          `removed malformed followup queue restart snapshot: ${path.basename(filePath)}`,
        );
      }
      await unlinkBestEffort(filePath);
      continue;
    }
    restorePersistedFollowupQueueSnapshot(snapshot);
    const runFollowup =
      params?.createRunFollowup?.(snapshot) ?? createRecoveredFollowupRunner(params?.log);
    scheduleDrain(snapshot.key, runFollowup);
    await unlinkBestEffort(filePath);
    recoveredQueues++;
    recoveredItems += snapshot.items.length;
  }
  return { recoveredQueues, recoveredItems, malformedFiles };
}
