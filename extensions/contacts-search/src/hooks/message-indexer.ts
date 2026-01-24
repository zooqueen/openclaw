import { createHash, randomUUID } from "node:crypto";

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
  event: {
    from: string;
    content: string;
    timestamp?: number;
    metadata?: Record<string, unknown>;
  };
  ctx: {
    channelId: string;
    accountId?: string;
    conversationId?: string;
  };
  logger?: { warn?: (message: string) => void };
}): void {
  const { event, ctx, logger } = params;
  const channelId = (ctx.channelId ?? "").trim();
  if (!channelId) return;

  const metadata = event.metadata ?? {};
  const meta = metadata as {
    senderId?: string;
    messageId?: string;
    senderUsername?: string;
    senderE164?: string;
    senderName?: string;
  };
  const senderId = String(meta.senderId ?? event.from ?? "").trim();
  if (!senderId) return;

  const content = typeof event.content === "string" ? event.content.trim() : "";
  const platform = normalizePlatform(channelId);
  const timestamp =
    typeof event.timestamp === "number" && Number.isFinite(event.timestamp)
      ? event.timestamp
      : Date.now();
  const metadataMessageId = meta.messageId;
  const messageId = resolveMessageId({
    messageId: typeof metadataMessageId === "string" ? metadataMessageId : undefined,
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
      username: typeof meta.senderUsername === "string" ? meta.senderUsername : null,
      phone: typeof meta.senderE164 === "string" ? meta.senderE164 : null,
      displayName: typeof meta.senderName === "string" ? meta.senderName : null,
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
