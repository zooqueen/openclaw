import { resolvePluginConfigObject } from "openclaw/plugin-sdk/plugin-config-runtime";
import type { OpenClawConfig } from "../runtime-api.js";
import { getOptionalMSTeamsRuntime } from "./runtime.js";

const TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const PERSISTENT_MAX_ENTRIES = 1000;
const PERSISTENT_NAMESPACE = "msteams.sent-messages";
const MSTEAMS_SENT_MESSAGES_KEY = Symbol.for("openclaw.msteamsSentMessages");

type MSTeamsSentMessageRecord = {
  sentAt: number;
};

type MSTeamsSentMessageStore = {
  register(key: string, value: MSTeamsSentMessageRecord, opts?: { ttlMs?: number }): Promise<void>;
  lookup(key: string): Promise<MSTeamsSentMessageRecord | undefined>;
};

let sentMessageCache: Map<string, Map<string, number>> | undefined;
let persistentStore: MSTeamsSentMessageStore | undefined;

function getSentMessageCache(): Map<string, Map<string, number>> {
  if (!sentMessageCache) {
    const globalStore = globalThis as Record<PropertyKey, unknown>;
    sentMessageCache =
      (globalStore[MSTEAMS_SENT_MESSAGES_KEY] as Map<string, Map<string, number>> | undefined) ??
      new Map<string, Map<string, number>>();
    globalStore[MSTEAMS_SENT_MESSAGES_KEY] = sentMessageCache;
  }
  return sentMessageCache;
}

function makePersistentKey(conversationId: string, messageId: string): string {
  return `${conversationId}:${messageId}`;
}

function isPersistentSentMessageCacheEnabled(cfg: OpenClawConfig | undefined): boolean {
  return resolvePluginConfigObject(cfg, "msteams")?.experimentalPersistentState === true;
}

function getPersistentSentMessageStore(): MSTeamsSentMessageStore | undefined {
  if (persistentStore) {
    return persistentStore;
  }
  const runtime = getOptionalMSTeamsRuntime();
  if (!runtime) {
    return undefined;
  }
  persistentStore = runtime.state.openKeyedStore<MSTeamsSentMessageRecord>({
    namespace: PERSISTENT_NAMESPACE,
    maxEntries: PERSISTENT_MAX_ENTRIES,
    defaultTtlMs: TTL_MS,
  });
  return persistentStore;
}

function reportPersistentSentMessageError(error: unknown): void {
  try {
    getOptionalMSTeamsRuntime()
      ?.logging.getChildLogger({ plugin: "msteams", feature: "sent-message-state" })
      .warn("Microsoft Teams persistent sent-message state failed", { error: String(error) });
  } catch {
    // Best effort only: persistent state must never break Teams routing.
  }
}

function cleanupExpired(scopeKey: string, entry: Map<string, number>, now: number): void {
  for (const [id, timestamp] of entry) {
    if (now - timestamp > TTL_MS) {
      entry.delete(id);
    }
  }
  if (entry.size === 0) {
    getSentMessageCache().delete(scopeKey);
  }
}

function rememberPersistentSentMessage(params: {
  cfg?: OpenClawConfig;
  conversationId: string;
  messageId: string;
  sentAt: number;
}): void {
  if (!isPersistentSentMessageCacheEnabled(params.cfg)) {
    return;
  }
  let store: MSTeamsSentMessageStore | undefined;
  try {
    store = getPersistentSentMessageStore();
  } catch (error) {
    reportPersistentSentMessageError(error);
    return;
  }
  if (!store) {
    return;
  }
  void store
    .register(makePersistentKey(params.conversationId, params.messageId), { sentAt: params.sentAt })
    .catch(reportPersistentSentMessageError);
}

async function lookupPersistentSentMessage(params: {
  cfg?: OpenClawConfig;
  conversationId: string;
  messageId: string;
}): Promise<boolean> {
  if (!isPersistentSentMessageCacheEnabled(params.cfg)) {
    return false;
  }
  let store: MSTeamsSentMessageStore | undefined;
  try {
    store = getPersistentSentMessageStore();
  } catch (error) {
    reportPersistentSentMessageError(error);
    return false;
  }
  if (!store) {
    return false;
  }
  try {
    return Boolean(await store.lookup(makePersistentKey(params.conversationId, params.messageId)));
  } catch (error) {
    reportPersistentSentMessageError(error);
    return false;
  }
}

export function recordMSTeamsSentMessage(
  conversationId: string,
  messageId: string,
  opts?: { cfg?: OpenClawConfig },
): void {
  if (!conversationId || !messageId) {
    return;
  }
  const now = Date.now();
  const store = getSentMessageCache();
  let entry = store.get(conversationId);
  if (!entry) {
    entry = new Map<string, number>();
    store.set(conversationId, entry);
  }
  entry.set(messageId, now);
  if (entry.size > 200) {
    cleanupExpired(conversationId, entry, now);
  }
  rememberPersistentSentMessage({ cfg: opts?.cfg, conversationId, messageId, sentAt: now });
}

export function wasMSTeamsMessageSent(conversationId: string, messageId: string): boolean {
  const entry = getSentMessageCache().get(conversationId);
  if (!entry) {
    return false;
  }
  cleanupExpired(conversationId, entry, Date.now());
  return entry.has(messageId);
}

export async function wasMSTeamsMessageSentForConfig(params: {
  cfg?: OpenClawConfig;
  conversationId: string;
  messageId: string;
}): Promise<boolean> {
  if (!params.conversationId || !params.messageId) {
    return false;
  }
  if (wasMSTeamsMessageSent(params.conversationId, params.messageId)) {
    return true;
  }
  return await lookupPersistentSentMessage(params);
}

export function clearMSTeamsSentMessageCache(): void {
  getSentMessageCache().clear();
}
