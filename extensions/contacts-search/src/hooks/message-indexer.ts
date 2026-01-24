import { createHash, randomUUID } from "node:crypto";

import type {
  PluginHookMessageContext,
  PluginHookMessageReceivedEvent,
} from "clawdbot/plugin-sdk";

import { importContactFromMessage, getContactStore } from "../contacts/index.js";
import type { Platform } from "../contacts/types.js";

function normalizePlatform(value: string): Platform {
  return value.trim().toLowerCase() as Platform;
}

function resolveMessageId(params: {
  messageId?: string;
  platform: string;
  senderId: string;
  timestamp?: number;
  content: string;
}): string {
  if (params.messageId) {
    return `${params.platform}:${params.messageId}`;
  }
  if (!params.timestamp) return randomUUID();
  const hash = createHash("sha1");
  hash.update(params.platform);
  hash.update("|");
  hash.update(params.senderId);
  hash.update("|");
  hash.update(String(params.timestamp));
  hash.update("|");
  hash.update(params.content);
  return hash.digest("hex");
}

export function indexInboundMessage(params: {
  event: PluginHookMessageReceivedEvent;
  ctx: PluginHookMessageContext;
  logger?: { warn?: (message: string) => void };
}): void {
  const { event, ctx, logger } = params;
  const channelId = (ctx.channelId ?? "").trim();
  if (!channelId) return;

  const senderId = (event.senderId ?? event.from ?? "").trim();
  if (!senderId) return;

  const content = typeof event.content === "string" ? event.content.trim() : "";
  const platform = normalizePlatform(channelId);
  const timestamp =
    typeof event.timestamp === "number" && Number.isFinite(event.timestamp)
      ? event.timestamp
      : Date.now();
  const messageId = resolveMessageId({
    messageId: event.messageId,
    platform,
    senderId,
    timestamp,
    content,
  });
  const conversationId = (ctx.conversationId ?? "").trim() || senderId;

  try {
    const store = getContactStore();
    importContactFromMessage(store, {
      platform,
      platformId: senderId,
      username: event.senderUsername ?? null,
      phone: event.senderE164 ?? null,
      displayName: event.senderName ?? null,
    });

    if (!content) return;

    store.indexMessage({
      id: messageId,
      content,
      contactId: null,
      platform,
      senderId,
      channelId: conversationId,
      timestamp,
      embedding: null,
    });
  } catch (err) {
    logger?.warn?.(
      `[contacts-search] failed indexing message: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
