import { resolveGlobalDedupeCache } from "openclaw/plugin-sdk/dedupe-runtime";
import { resolvePluginConfigObject } from "openclaw/plugin-sdk/plugin-config-runtime";
import type { OpenClawConfig } from "./runtime-api.js";
import { getOptionalSlackRuntime } from "./runtime.js";

/**
 * In-memory cache of Slack threads the bot has participated in.
 * Used to auto-respond in threads without requiring @mention after the first reply.
 * Follows a similar TTL pattern to the MS Teams and Telegram sent-message caches.
 */

const TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const MAX_ENTRIES = 5000;
const PERSISTENT_MAX_ENTRIES = 1000;
const PERSISTENT_NAMESPACE = "slack.thread-participation";

type SlackThreadParticipationRecord = {
  agentId?: string;
  repliedAt: number;
};

type SlackThreadParticipationStore = {
  register(
    key: string,
    value: SlackThreadParticipationRecord,
    opts?: { ttlMs?: number },
  ): Promise<void>;
  lookup(key: string): Promise<SlackThreadParticipationRecord | undefined>;
};

/**
 * Keep Slack thread participation shared across bundled chunks so thread
 * auto-reply gating does not diverge between prepare/dispatch call paths.
 */
const SLACK_THREAD_PARTICIPATION_KEY = Symbol.for("openclaw.slackThreadParticipation");
const threadParticipation = resolveGlobalDedupeCache(SLACK_THREAD_PARTICIPATION_KEY, {
  ttlMs: TTL_MS,
  maxSize: MAX_ENTRIES,
});

let persistentStore: SlackThreadParticipationStore | undefined;

function makeKey(accountId: string, channelId: string, threadTs: string): string {
  return `${accountId}:${channelId}:${threadTs}`;
}

function isPersistentThreadParticipationEnabled(cfg: OpenClawConfig | undefined): boolean {
  return resolvePluginConfigObject(cfg, "slack")?.experimentalPersistentState === true;
}

function getPersistentThreadParticipationStore(): SlackThreadParticipationStore | undefined {
  if (persistentStore) {
    return persistentStore;
  }
  const runtime = getOptionalSlackRuntime();
  if (!runtime) {
    return undefined;
  }
  persistentStore = runtime.state.openKeyedStore<SlackThreadParticipationRecord>({
    namespace: PERSISTENT_NAMESPACE,
    maxEntries: PERSISTENT_MAX_ENTRIES,
    defaultTtlMs: TTL_MS,
  });
  return persistentStore;
}

function reportPersistentThreadParticipationError(error: unknown): void {
  try {
    getOptionalSlackRuntime()
      ?.logging.getChildLogger({ plugin: "slack", feature: "thread-participation-state" })
      .warn("Slack persistent thread participation state failed", { error: String(error) });
  } catch {
    // Best effort only: persistent state must never break Slack message handling.
  }
}

function rememberPersistentThreadParticipation(params: {
  cfg?: OpenClawConfig;
  key: string;
  agentId?: string;
}): void {
  if (!isPersistentThreadParticipationEnabled(params.cfg)) {
    return;
  }
  let store: SlackThreadParticipationStore | undefined;
  try {
    store = getPersistentThreadParticipationStore();
  } catch (error) {
    reportPersistentThreadParticipationError(error);
    return;
  }
  if (!store) {
    return;
  }
  void store
    .register(params.key, {
      ...(params.agentId ? { agentId: params.agentId } : {}),
      repliedAt: Date.now(),
    })
    .catch(reportPersistentThreadParticipationError);
}

async function lookupPersistentThreadParticipation(params: {
  cfg?: OpenClawConfig;
  key: string;
}): Promise<boolean> {
  if (!isPersistentThreadParticipationEnabled(params.cfg)) {
    return false;
  }
  let store: SlackThreadParticipationStore | undefined;
  try {
    store = getPersistentThreadParticipationStore();
  } catch (error) {
    reportPersistentThreadParticipationError(error);
    return false;
  }
  if (!store) {
    return false;
  }
  try {
    return Boolean(await store.lookup(params.key));
  } catch (error) {
    reportPersistentThreadParticipationError(error);
    return false;
  }
}

export function recordSlackThreadParticipation(
  accountId: string,
  channelId: string,
  threadTs: string,
  opts?: { cfg?: OpenClawConfig; agentId?: string },
): void {
  if (!accountId || !channelId || !threadTs) {
    return;
  }
  const key = makeKey(accountId, channelId, threadTs);
  threadParticipation.check(key);
  rememberPersistentThreadParticipation({ cfg: opts?.cfg, key, agentId: opts?.agentId });
}

export function hasSlackThreadParticipation(
  accountId: string,
  channelId: string,
  threadTs: string,
): boolean {
  if (!accountId || !channelId || !threadTs) {
    return false;
  }
  return threadParticipation.peek(makeKey(accountId, channelId, threadTs));
}

export async function hasSlackThreadParticipationForConfig(params: {
  cfg?: OpenClawConfig;
  accountId: string;
  channelId: string;
  threadTs: string;
}): Promise<boolean> {
  if (!params.accountId || !params.channelId || !params.threadTs) {
    return false;
  }
  const key = makeKey(params.accountId, params.channelId, params.threadTs);
  if (threadParticipation.peek(key)) {
    return true;
  }
  return await lookupPersistentThreadParticipation({ cfg: params.cfg, key });
}

export function clearSlackThreadParticipationCache(): void {
  threadParticipation.clear();
}
