import { resolveSlackAccount } from "../../../slack/accounts.js";
import { sendMessageSlack } from "../../../slack/send.js";
import { resolveSlackTokenOverride } from "../../../slack/token.js";
import type { ChannelOutboundAdapter } from "../types.js";

export const slackOutbound: ChannelOutboundAdapter = {
  deliveryMode: "direct",
  chunker: null,
  textChunkLimit: 4000,
  resolveTarget: ({ to }) => {
    const trimmed = to?.trim();
    if (!trimmed) {
      return {
        ok: false,
        error: new Error("Delivering to Slack requires --to <channelId|user:ID|channel:ID>"),
      };
    }
    return { ok: true, to: trimmed };
  },
  sendText: async ({ cfg, to, text, accountId, deps, replyToId }) => {
    const send = deps?.sendSlack ?? sendMessageSlack;
    const account = resolveSlackAccount({ cfg, accountId });
    const tokenOverride = resolveSlackTokenOverride({
      botToken: account.botToken,
      userToken: account.userToken,
      userTokenReadOnly: account.config.userTokenReadOnly,
      operation: "write",
    });
    const result = await send(to, text, {
      threadTs: replyToId ?? undefined,
      accountId: accountId ?? undefined,
      ...(tokenOverride ? { token: tokenOverride } : {}),
    });
    return { channel: "slack", ...result };
  },
  sendMedia: async ({ cfg, to, text, mediaUrl, accountId, deps, replyToId }) => {
    const send = deps?.sendSlack ?? sendMessageSlack;
    const account = resolveSlackAccount({ cfg, accountId });
    const tokenOverride = resolveSlackTokenOverride({
      botToken: account.botToken,
      userToken: account.userToken,
      userTokenReadOnly: account.config.userTokenReadOnly,
      operation: "write",
    });
    const result = await send(to, text, {
      mediaUrl,
      threadTs: replyToId ?? undefined,
      accountId: accountId ?? undefined,
      ...(tokenOverride ? { token: tokenOverride } : {}),
    });
    return { channel: "slack", ...result };
  },
};
